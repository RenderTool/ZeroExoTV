/**
 * script-store 单测：唯一写者契约验证（2026-11-04）
 * 1) writeScript(baseVersion=0) 创建 → readScript 往返一致；
 * 2) 正确 baseVersion 的补丁写入 → version+1、未提及字段保留；
 * 3) 过期 baseVersion → ScriptConflictError 拒绝、磁盘内容不变；
 * 4) watchScript 订阅者在本会话写入时被推送。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/platform/fs', () => {
  const files = new Map<string, { text: string; lastModified: number }>();
  let tick = 0;
  return {
    __files: files,
    readJson: async (p: string) => {
      const f = files.get(p);
      return f ? (JSON.parse(f.text) as unknown) : null;
    },
    stat: async (p: string) => {
      const f = files.get(p);
      return f ? { size: f.text.length, lastModified: f.lastModified } : null;
    },
    writeJsonIfUnchanged: async (p: string, value: unknown, expected: { size: number; lastModified: number } | null) => {
      const cur = files.get(p);
      if (expected && cur && (cur.text.length !== expected.size || cur.lastModified !== expected.lastModified)) {
        throw new Error('ConflictError: file changed externally');
      }
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    // 2026-11-04 保存前备份连带：writeScriptLocked 落盘前会写 backups/ 并回收
    writeJson: async (p: string, value: unknown) => {
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
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

import { readScript, writeScript, watchScript, ensureScript, nextEpisodeNumber, autoEpisodeTitle, isEpisodeBlank, ScriptConflictError, isDefaultEpisodeTitle, isDirtyEpisodeTitle, displayEpisodeTitle, hasCustomEpisodeTitle, planEpisodeTitleRepair } from '@/entities/script-store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const files = (await import('@/platform/fs') as any).__files as Map<string, { text: string; lastModified: number }>;

const seedEpisodes = [
  { id: 'ep-1', number: 1, title: '第1集', content: '<p>开场</p>', status: 'draft' },
];

describe('script-store 唯一写者', () => {
  beforeEach(() => {
    files.clear();
  });

  it('writeScript(baseVersion=0) 创建实体，readScript 往返一致', async () => {
    const created = await writeScript('proj-test-1', {
      baseVersion: 0,
      title: '测试剧',
      activeEpisodeId: 'ep-1',
      episodes: seedEpisodes,
    });
    expect(created.version).toBe(1);

    const back = await readScript('proj-test-1');
    expect(back).not.toBeNull();
    expect(back!.title).toBe('测试剧');
    expect(back!.episodes).toEqual(seedEpisodes);
    expect(back!.version).toBe(1);
    expect(back!.schemaVersion).toBe(1);
  });

  it('正确 baseVersion 的补丁写入：version+1 且未提及字段保留', async () => {
    await writeScript('proj-test-1', { baseVersion: 0, title: 'A', episodes: seedEpisodes, activeEpisodeId: 'ep-1' });
    const next = await writeScript('proj-test-1', { baseVersion: 1, title: 'B' });
    expect(next.version).toBe(2);
    expect(next.title).toBe('B');
    expect(next.episodes).toEqual(seedEpisodes);
  });

  it('过期 baseVersion 被拒绝（ScriptConflictError），磁盘内容不变', async () => {
    await writeScript('proj-test-1', { baseVersion: 0, title: 'A', episodes: seedEpisodes });
    await writeScript('proj-test-1', { baseVersion: 1, title: 'B' }); // 现在 version=2
    await expect(
      writeScript('proj-test-1', { baseVersion: 1, title: 'C' }),
    ).rejects.toBeInstanceOf(ScriptConflictError);
    const back = await readScript('proj-test-1');
    expect(back!.title).toBe('B');
    expect(back!.version).toBe(2);
  });

  it('实体不存在时 baseVersion≠0 同样被拒绝', async () => {
    await expect(
      writeScript('proj-test-1', { baseVersion: 5, title: 'X' }),
    ).rejects.toBeInstanceOf(ScriptConflictError);
    expect(await readScript('proj-test-1')).toBeNull();
  });

  it('watchScript 在本会话写入时推送新实体', async () => {
    const seen: number[] = [];
    const unwatch = watchScript('proj-test-1', (e) => { if (e) seen.push(e.version); });
    await writeScript('proj-test-1', { baseVersion: 0, title: 'A', episodes: seedEpisodes });
    await writeScript('proj-test-1', { baseVersion: 1, title: 'A2' });
    unwatch();
    expect(seen).toEqual([1, 2]);
  });
});

describe('剧集重复/乱名修复（2026-11-04）', () => {
  beforeEach(() => {
    files.clear();
  });

  it('ensureScript 幂等：重复/并发触发不新增实体与剧集', async () => {
    const init = { title: '测试剧', episodes: seedEpisodes };
    const [r1, r2, r3] = await Promise.all([
      ensureScript('proj-test-1', init),
      ensureScript('proj-test-1', init),
      ensureScript('proj-test-1', init),
    ]);
    // 至多一个 created=true，其余收敛到同一实体
    expect([r1.created, r2.created, r3.created].filter(Boolean).length).toBeLessThanOrEqual(1);
    expect(r1.entity.version).toBe(r2.entity.version);
    expect(r2.entity.version).toBe(r3.entity.version);
    const back = await readScript('proj-test-1');
    expect(back!.episodes).toHaveLength(1); // 重复调用不新增 episode
    expect(files.size).toBe(1);             // 同一项目只有一个实体文件
  });

  it('已存在实体时 ensureScript 原样返回、不覆盖内容', async () => {
    await writeScript('proj-test-1', { baseVersion: 0, title: '已有', episodes: seedEpisodes });
    const { entity, created } = await ensureScript('proj-test-1', { title: '别动我', episodes: [] });
    expect(created).toBe(false);
    expect(entity.title).toBe('已有');
    expect(entity.episodes).toHaveLength(1);
  });

  it('自动标题由 number 派生，不拼接旧标题', () => {
    expect(autoEpisodeTitle(1)).toBe('第1集');
    expect(autoEpisodeTitle(2)).toBe('第2集');
    expect(autoEpisodeTitle(12)).toBe('第12集');
    // 下集序号取现有最大 number+1（删除中间集不复用空缺号）
    expect(nextEpisodeNumber([{ number: 1 }, { number: 2 }])).toBe(3);
    expect(nextEpisodeNumber([{ number: 1 }, { number: 5 }])).toBe(6);
    expect(nextEpisodeNumber([])).toBe(1);
  });

  it('isEpisodeBlank：空段落标签判空，有真实内容不判空', () => {
    expect(isEpisodeBlank('')).toBe(true);
    expect(isEpisodeBlank(null)).toBe(true);
    expect(isEpisodeBlank('<p class="script-action"></p>')).toBe(true);
    expect(isEpisodeBlank('<p>&nbsp;</p>')).toBe(true);
    expect(isEpisodeBlank('<p>第一场的戏</p>')).toBe(false);
    expect(isEpisodeBlank('纯文本')).toBe(false);
  });

  // ===== 2026-11-04 抽屉集标题错乱：显示统一 displayEpisodeTitle =====

  it('isDefaultEpisodeTitle：默认标题（含空格变体）判定', () => {
    expect(isDefaultEpisodeTitle('第1集', 1)).toBe(true);
    expect(isDefaultEpisodeTitle('第 1 集', 1)).toBe(true);
    expect(isDefaultEpisodeTitle('第  1  集', 1)).toBe(true);
    expect(isDefaultEpisodeTitle('第1集', 2)).toBe(false); // 数字与 number 不符不算默认
    expect(isDefaultEpisodeTitle('初遇', 1)).toBe(false);
    expect(isDefaultEpisodeTitle('', 1)).toBe(false);
    expect(isDefaultEpisodeTitle(null, 1)).toBe(false);
  });

  it('isDirtyEpisodeTitle：拼接型/重复编号型脏值判定，正常自定义标题不误伤', () => {
    expect(isDirtyEpisodeTitle('第1集2集', 1)).toBe(true); // 历史拼接脏值
    expect(isDirtyEpisodeTitle('第3集4集', 3)).toBe(true);
    expect(isDirtyEpisodeTitle('第2集第2集', 2)).toBe(true); // 重复编号
    expect(isDirtyEpisodeTitle('第1集·第1集', 1)).toBe(true);
    expect(isDirtyEpisodeTitle('第1集', 1)).toBe(false); // 默认标题不算脏
    expect(isDirtyEpisodeTitle('第 1 集', 1)).toBe(false);
    expect(isDirtyEpisodeTitle('第5集·大结局', 5)).toBe(false); // 自定义标题保留
    expect(isDirtyEpisodeTitle('第1集（上）', 1)).toBe(false); // 分集副标保留
    expect(isDirtyEpisodeTitle('我的第3集', 3)).toBe(false);
    expect(isDirtyEpisodeTitle('', 1)).toBe(false);
  });

  it('displayEpisodeTitle：空/默认/脏值按 number 兜底规范名，自定义标题原样（trim）', () => {
    expect(displayEpisodeTitle('', 3)).toBe('第3集');
    expect(displayEpisodeTitle(null, 3)).toBe('第3集');
    expect(displayEpisodeTitle('第 1 集', 1)).toBe('第1集'); // 空格变体规范化
    expect(displayEpisodeTitle('第1集2集', 1)).toBe('第1集'); // 脏值兜底
    expect(displayEpisodeTitle('第2集第2集', 2)).toBe('第2集');
    expect(displayEpisodeTitle('  夜宴  ', 4)).toBe('夜宴'); // 自定义标题 trim 保留
    expect(displayEpisodeTitle('第5集·大结局', 5)).toBe('第5集·大结局');
  });

  it('hasCustomEpisodeTitle：默认/空/脏值为 false（不拼「· 标题」段），自定义为 true', () => {
    expect(hasCustomEpisodeTitle('第1集', 1)).toBe(false);
    expect(hasCustomEpisodeTitle('第 1 集', 1)).toBe(false);
    expect(hasCustomEpisodeTitle('', 1)).toBe(false);
    expect(hasCustomEpisodeTitle('第1集2集', 1)).toBe(false); // 脏值不外显为自定义
    expect(hasCustomEpisodeTitle('夜宴', 4)).toBe(true);
    // 显示层拼法（EpisodeList/抽屉/进度条统一模式）不再出现「第N集 · 第N集」重复与脏名
    const label = (title: string, n: number) =>
      hasCustomEpisodeTitle(title, n) ? `第 ${n} 集 · ${displayEpisodeTitle(title, n)}` : `第${n}集`;
    expect(label('第1集', 1)).toBe('第1集');
    expect(label('第1集2集', 1)).toBe('第1集');
    expect(label('夜宴', 4)).toBe('第 4 集 · 夜宴');
  });

  it('planEpisodeTitleRepair：脏值修复计划 + 幂等二次运行为 0 改动', () => {
    const episodes = [
      { id: 'ep-1', number: 1, title: '第1集2集' },       // 拼接脏值 → 修
      { id: 'ep-2', number: 2, title: '第 2 集' },        // 空格变体 → 规范化
      { id: 'ep-3', number: 3, title: '第7集' },          // 编号错乱（默认模式但数字不符）→ 修
      { id: 'ep-4', number: 4, title: '第4集第4集' },     // 重复编号 → 修
      { id: 'ep-5', number: 5, title: '夜宴' },           // 自定义 → 不动
      { id: 'ep-6', number: 6, title: '' },              // 空 → 不动（显示层兜底）
      { id: 'ep-7', number: 7, title: '第7集' },          // 干净默认 → 不动
    ];
    const plan = planEpisodeTitleRepair(episodes);
    expect(plan).toEqual([
      { episodeId: 'ep-1', from: '第1集2集', to: '第1集' },
      { episodeId: 'ep-2', from: '第 2 集', to: '第2集' },
      { episodeId: 'ep-3', from: '第7集', to: '第3集' },
      { episodeId: 'ep-4', from: '第4集第4集', to: '第4集' },
    ]);
    // 幂等：按 plan 修复后再 plan → 0 改动
    const byId = new Map(plan.map((p) => [p.episodeId, p.to]));
    const repaired = episodes.map((ep) => (byId.has(ep.id) ? { ...ep, title: byId.get(ep.id)! } : ep));
    expect(planEpisodeTitleRepair(repaired)).toHaveLength(0);
  });
});
