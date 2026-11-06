/**
 * script-import-service 单测（2026-11-04）
 * 覆盖：三策略落盘（新建一集/插入新片段/覆盖当前集）、覆盖前自动备份与备份失败中止、
 * ScriptConflictError 透传（不静默覆盖、不自动重试强写）、同次导入连点幂等（只落一次）。
 * 末尾「导入实测证据」用例输出交付要求的实测数字。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/platform/fs', () => {
  const files = new Map<string, { text: string; lastModified: number }>();
  let tick = 0;
  // 测试钩子状态：failNextWrite 让下一次 writeJson 抛错（备份失败场景）；
  // bumpAfterReads 让第 N 次之后的 readJson 返回 version+1（模拟外部会话并发推进版本）
  const state = { failNextWrite: false, bumpAfterReads: -1, reads: 0 };
  return {
    __files: files,
    __state: state,
    readJson: async (p: string) => {
      state.reads += 1;
      const f = files.get(p);
      if (!f) return null;
      const parsed = JSON.parse(f.text) as Record<string, unknown>;
      if (state.bumpAfterReads >= 0 && state.reads > state.bumpAfterReads && typeof parsed.version === 'number') {
        parsed.version += 1;
      }
      return parsed;
    },
    stat: async (p: string) => {
      const f = files.get(p);
      return f ? { size: f.text.length, lastModified: f.lastModified } : null;
    },
    writeJson: async (p: string, value: unknown) => {
      if (state.failNextWrite) {
        state.failNextWrite = false;
        throw new Error('磁盘写入失败（模拟）');
      }
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    writeJsonIfUnchanged: async (p: string, value: unknown, expected: { size: number; lastModified: number } | null) => {
      const cur = files.get(p);
      if (expected && cur && (cur.text.length !== expected.size || cur.lastModified !== expected.lastModified)) {
        throw new Error('ConflictError: file changed externally');
      }
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    // 2026-11-04 保存前备份连带：writeScript 落盘前会写 backups/ 并回收
    listDir: async (dir: string) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        const i = key.lastIndexOf('/');
        const d = i < 0 ? '' : key.slice(0, i);
        if (d === dir) names.add(key.slice(i + 1));
      }
      return Array.from(names)
        .map((name) => ({ name, kind: 'file' as const }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    remove: async (p: string) => {
      files.delete(p);
    },
  };
});

import { readScript, ScriptConflictError } from '@/entities/script-store.js';
import { commitScriptImport, ScriptImportBackupError, scriptBackupPath } from './script-import-service.js';
import { parseScriptImport, scriptContentLength } from './script-import-parser.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const files = (await import('@/platform/fs') as any).__files as Map<string, { text: string; lastModified: number }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (await import('@/platform/fs') as any).__state as { failNextWrite: boolean; bumpAfterReads: number; reads: number };

const ENTITY_PATH = 'projects/p1/entities/script.json';

function seedEntity(content: string, version = 1): void {
  files.set(ENTITY_PATH, {
    text: JSON.stringify({
      schemaVersion: 1,
      version,
      title: '测试剧',
      activeEpisodeId: 'ep-1',
      episodes: [{ id: 'ep-1', number: 1, title: '第1集', content, status: 'draft' }],
      sourceInfo: { origin: 'created', createdBy: 'editor-page' },
      updatedAt: '2026-11-04T00:00:00.000Z',
    }, null, 2),
    lastModified: 1,
  });
}

const SAMPLE_MD = [
  '# 第一集',
  '## 第一场 老张家',
  '老张坐在灯下补网。',
  '老张：狼又来了。',
].join('\n');

function parseSample() {
  return parseScriptImport({ filename: 'sample.md', text: SAMPLE_MD });
}

describe('script-import-service 三策略落盘', () => {
  beforeEach(() => {
    files.clear();
    state.failNextWrite = false;
    state.bumpAfterReads = -1;
    state.reads = 0;
  });

  it('新建一集：序号 max+1、标题自动派生、activeEpisodeId 切到新集、已有集不动', async () => {
    seedEntity('<p class="script-action">旧内容</p>');
    const parsed = parseSample();
    const r = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'new-episode' });
    expect(r.episodeCount).toBe(2);
    expect(r.createdEpisodeIds).toHaveLength(1);
    const created = r.entity.episodes[1]!;
    expect(created.number).toBe(2);
    expect(created.title).toBe('第2集');
    expect(created.status).toBe('draft');
    expect(created.content).toBe(parsed.episodes[0]!.html);
    expect(r.entity.activeEpisodeId).toBe(created.id);
    expect(r.entity.episodes[0]!.content).toBe('<p class="script-action">旧内容</p>');
  });

  it('新建一集（多集 md）：每个解析集各建一集，序号连续递增', async () => {
    seedEntity('');
    const parsed = parseScriptImport({ filename: 'm.md', text: '# 第一集\n内容一。\n# 第二集\n内容二。' });
    const r = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'new-episode' });
    expect(r.episodeCount).toBe(3);
    expect(r.entity.episodes[1]!.number).toBe(2);
    expect(r.entity.episodes[2]!.number).toBe(3);
    expect(r.entity.episodes[1]!.title).toBe('第2集');
    expect(r.entity.episodes[2]!.title).toBe('第3集');
    expect(r.entity.activeEpisodeId).toBe(r.entity.episodes[1]!.id);
  });

  it('插入新片段（默认追加到末尾）：已有内容不动，字符数递增，不产生备份', async () => {
    const old = '<p class="script-action">旧内容</p>';
    seedEntity(old);
    const parsed = parseSample();
    const r = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'append' });
    const target = r.entity.episodes[0]!;
    expect(target.content.startsWith(old)).toBe(true);
    expect(target.content).toContain(parsed.htmlAll);
    expect(r.charBefore).toBe(scriptContentLength(old));
    expect(r.charAfter).toBe(scriptContentLength(target.content));
    expect(r.charAfter).toBeGreaterThan(r.charBefore);
    // 不产生「导入覆盖备份」（script-ep-*）；writeScript 的保存前兜底备份（script-presave-*）不属于导入备份语义
    expect([...files.keys()].filter((k) => k.includes('/backups/script-ep-'))).toHaveLength(0);
  });

  it('插入新片段（插入到开头）：导入内容在前、原文在后', async () => {
    const old = '<p class="script-action">旧内容</p>';
    seedEntity(old);
    const parsed = parseSample();
    const r = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'append', position: 'start' });
    const target = r.entity.episodes[0]!;
    expect(target.content.startsWith(parsed.htmlAll)).toBe(true);
    expect(target.content.endsWith(old)).toBe(true);
  });

  it('覆盖当前集：先备份后替换，备份文件命名合规且 JSON 可校验读', async () => {
    const old = '<p class="script-action">旧内容</p>';
    seedEntity(old);
    const parsed = parseSample();
    const now = new Date(2026, 10, 4, 12, 30, 45);
    const r = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'overwrite', now });
    const expectPath = scriptBackupPath('p1', 'ep-1', now);
    expect(expectPath).toBe('projects/p1/entities/backups/script-ep-1-20261104123045.json');
    expect(r.backupPath).toBe(expectPath);
    // 备份文件存在、可解析、内容是被替换前的完整实体（只数导入备份 script-ep-*，排除 presave 兜底）
    const backups = [...files.keys()].filter((k) => k.includes('/backups/script-ep-'));
    expect(backups).toHaveLength(1);
    const backupEntity = JSON.parse(files.get(backups[0]!)!.text) as { episodes: Array<{ content: string }> };
    expect(backupEntity.episodes[0]!.content).toBe(old);
    // 原内容已被替换
    expect(r.entity.episodes[0]!.content).toBe(parsed.htmlAll);
    expect(r.charBefore).toBe(scriptContentLength(old));
    expect(r.charAfter).toBe(scriptContentLength(parsed.htmlAll));
  });

  it('覆盖：备份失败则中止导入，实体内容不变', async () => {
    const old = '<p class="script-action">旧内容</p>';
    seedEntity(old);
    state.failNextWrite = true;
    const parsed = parseSample();
    await expect(
      commitScriptImport({ projectId: 'p1', parsed, strategy: 'overwrite' }),
    ).rejects.toBeInstanceOf(ScriptImportBackupError);
    const back = await readScript('p1');
    expect(back!.episodes[0]!.content).toBe(old);
    expect(back!.version).toBe(1);
  });

  it('版本冲突：ScriptConflictError 原样上抛，不静默覆盖、不自动重试', async () => {
    const old = '<p class="script-action">旧内容</p>';
    seedEntity(old);
    // 模拟外部会话在「service 读 → writeScript 复核」之间把实体推进到 version 2：
    // 第 1 次 readJson（service 的 readScript）返回 v1，第 2 次（writeScriptLocked 复核）返回 v2
    state.bumpAfterReads = 1;
    const parsed = parseSample();
    await expect(
      commitScriptImport({ projectId: 'p1', parsed, strategy: 'append' }),
    ).rejects.toBeInstanceOf(ScriptConflictError);
    // 冲突拒绝后磁盘内容保持不变（先关掉测试钩子，让验证读拿到磁盘原值）
    state.bumpAfterReads = -1;
    const back = await readScript('p1');
    expect(back!.episodes[0]!.content).toBe(old);
    expect(back!.version).toBe(1);
  });

  it('幂等：同一次导入连点两次（并发同一请求）只落盘一次', async () => {
    seedEntity('');
    const parsed = parseSample();
    const [r1, r2] = await Promise.all([
      commitScriptImport({ projectId: 'p1', parsed, strategy: 'new-episode' }),
      commitScriptImport({ projectId: 'p1', parsed, strategy: 'new-episode' }),
    ]);
    // 两个调用收敛到同一次落盘（同一结果实例）
    expect(r1).toBe(r2);
    const back = await readScript('p1');
    expect(back!.episodes).toHaveLength(2); // 只新建了一集
    expect(back!.version).toBe(2);          // 只写入了一次
  });
});

describe('导入实测证据（同一份 md 走三种策略）', () => {
  beforeEach(() => {
    files.clear();
    state.failNextWrite = false;
    state.bumpAfterReads = -1;
    state.reads = 0;
  });

  it('实测：新建一集 / 插入新片段 / 覆盖当前集', async () => {
    const parsed = parseSample();

    // 策略一：新建一集
    seedEntity('<p class="script-action">旧内容</p>');
    const rNew = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'new-episode' });

    // 策略二：插入新片段（第 1 集，追加到末尾）
    files.clear();
    seedEntity('<p class="script-action">旧内容</p>');
    const rAppend = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'append' });

    // 策略三：覆盖当前集（固定时间戳便于定位备份）
    files.clear();
    seedEntity('<p class="script-action">旧内容</p>');
    const rOver = await commitScriptImport({ projectId: 'p1', parsed, strategy: 'overwrite', now: new Date(2026, 10, 4, 12, 30, 45) });
    const backupCount = [...files.keys()].filter((k) => k.includes('/backups/script-ep-')).length;
    const backupReadable = (() => {
      try {
        JSON.parse(files.get(rOver.backupPath!)!.text);
        return true;
      } catch {
        return false;
      }
    })();

    console.log(
      `导入同一份 md：选『新建一集』后集数 ${rNew.episodeCount}、` +
      `选『插入新片段』后第1集字符数 ${rAppend.charBefore}→${rAppend.charAfter}、` +
      `选『覆盖当前集』后备份文件 ${backupCount} 个且校验可读（${backupReadable ? '通过' : '失败'}）`,
    );

    // 结构断言
    expect(rNew.episodeCount).toBe(2);
    expect(rAppend.charBefore).toBe(3);
    expect(rAppend.charAfter).toBeGreaterThan(rAppend.charBefore);
    expect(backupCount).toBe(1);
    expect(backupReadable).toBe(true);
    expect(rOver.entity.episodes[0]!.content).toBe(parsed.htmlAll);
  });
});
