/**
 * script-store × snapshot-store 集成测试（2026-11-04 快照/版本功能·断言⑤）
 *
 * ⑤ 恢复流程：先落 pre-restore（当前版）再以 writeScript(baseVersion=当前盘上版本) 写入
 *   恢复内容；版本冲突抛 ScriptConflictError 且不覆盖盘上内容。
 * 另覆盖：writeScript 集成下的 pre-save/auto 落库路径与时间窗行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// writeJson 钩子：冲突用例在「pre-restore 落库瞬间」模拟外部写入者抢改主文件
const fsHooks = vi.hoisted(() => ({ onWriteJson: null as null | ((p: string) => void) }));

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
    writeJson: async (p: string, value: unknown) => {
      fsHooks.onWriteJson?.(p);
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    writeJsonIfUnchanged: async (p: string, value: unknown, expected: { size: number; lastModified: number } | null) => {
      const cur = files.get(p);
      if (expected && cur && (cur.text.length !== expected.size || cur.lastModified !== expected.lastModified)) {
        throw new Error('ConflictError: file changed externally');
      }
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

import {
  readScript, writeScript, createScriptSnapshot, restoreScriptSnapshot, ScriptConflictError,
} from '@/entities/script-store.js';
import { listSnapshots } from '@/entities/snapshot-store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const files = (await import('@/platform/fs') as any).__files as Map<string, { text: string; lastModified: number }>;

const SNAP_DIR = 'projects/proj-x/entities/snapshots/script';
const MAIN = 'projects/proj-x/entities/script.json';

const contentAt = (i: number): string => `<p class="script-action">第${i}版正文</p>`;
const episodesAt = (i: number) => [{ id: 'ep-1', number: 1, title: '第1集', content: contentAt(i), status: 'draft' }];

async function writeVersion(baseVersion: number, i: number): Promise<ReturnType<typeof readScript>> {
  return writeScript('proj-x', { baseVersion, title: '快照剧', activeEpisodeId: 'ep-1', episodes: episodesAt(i) });
}

describe('writeScript × 快照库集成（pre-save / auto 落库）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('创建不快照；覆盖在时间窗内只落 pre-save；出窗后元数据-only 写入（pre-save 跳过）落 auto', async () => {
    const v1 = await writeVersion(0, 1); // 创建（无上一版，不快照）
    expect(files.has(MAIN)).toBe(true);
    expect(Array.from(files.keys()).filter((k) => k.startsWith(`${SNAP_DIR}/`))).toHaveLength(0);

    const v2 = await writeVersion(v1!.version, 2); // 覆盖：pre-save(第1版) 落库
    const snaps = await listSnapshots('proj-x', 'script');
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.reason).toBe('pre-save');
    expect((snaps[0]!.entity as { episodes: { content: string }[] }).episodes[0]!.content).toBe(contentAt(1));

    // 时间窗内（0 秒差）元数据-only 写入：pre-save 跳过（内容不变）、auto 不生成（窗内）
    const v3 = await writeScript('proj-x', { baseVersion: v2!.version, activeEpisodeId: 'ep-1' });
    expect(await listSnapshots('proj-x', 'script')).toHaveLength(1);

    // 出窗 ≥ 5min：再次元数据-only 写入 → pre-save 仍跳过，auto(第2版内容) 落库
    vi.setSystemTime(new Date('2026-11-04T12:06:00.000Z'));
    await writeScript('proj-x', { baseVersion: v3.version, activeEpisodeId: 'ep-1' });
    const snaps2 = await listSnapshots('proj-x', 'script');
    expect(snaps2.map((s) => s.reason)).toEqual(['pre-save', 'auto']);
    expect((snaps2[1]!.entity as { episodes: { content: string }[] }).episodes[0]!.content).toBe(contentAt(2));
  });

  it('元数据-only 覆盖：无基线时首写建立 auto 基线；有基线后窗内不新增', async () => {
    const v1 = await writeVersion(0, 1);
    const v2 = await writeScript('proj-x', { baseVersion: v1!.version, activeEpisodeId: 'ep-1' });
    const base = await listSnapshots('proj-x', 'script');
    expect(base.map((s) => s.reason)).toEqual(['auto']); // 无最新快照 → 首次写入建立基线
    expect((base[0]!.entity as { episodes: { content: string }[] }).episodes[0]!.content).toBe(contentAt(1));
    // 基线存在后：窗内元数据-only 写入既不落 pre-save 也不生成 auto
    await writeScript('proj-x', { baseVersion: v2!.version, activeEpisodeId: 'ep-1' });
    expect(await listSnapshots('proj-x', 'script')).toHaveLength(1);
  });

  it('④ manual 手动快照不受时间窗限制（createScriptSnapshot）', async () => {
    const v1 = await writeVersion(0, 1);
    await writeVersion(v1!.version, 2); // 刚落 pre-save（<5min）
    const manual = await createScriptSnapshot('proj-x', '定稿');
    expect(manual).not.toBeNull();
    expect(manual!.reason).toBe('manual');
    expect(manual!.name).toBe('定稿');
    const snaps = await listSnapshots('proj-x', 'script');
    expect(snaps.map((s) => s.reason)).toEqual(['pre-save', 'manual']);
  });
});

describe('恢复流程（⑤：先 pre-restore 再写恢复内容；冲突不覆盖）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('恢复成功：pre-restore(当前版) 入库 → writeScript 写入恢复内容 → 盘上内容 = 快照内容', async () => {
    const v1 = await writeVersion(0, 1);
    const manual = await createScriptSnapshot('proj-x'); // 快照：第1版
    expect(manual).not.toBeNull();
    const v2 = await writeVersion(v1!.version, 2); // 盘上推进到第2版
    expect(readScriptEntity().episodes[0]!.content).toBe(contentAt(2));

    const restored = await restoreScriptSnapshot('proj-x', manual!);
    // 恢复内容 = 第1版，版本继续推进
    expect(restored.episodes[0]!.content).toBe(contentAt(1));
    expect(restored.version).toBe(v2!.version + 1);
    expect(readScriptEntity().episodes[0]!.content).toBe(contentAt(1));

    // pre-restore 快照确实生成且可读回：内容 = 恢复前的第2版
    const snaps = await listSnapshots('proj-x', 'script');
    const preRestore = snaps.find((s) => s.reason === 'pre-restore');
    expect(preRestore).toBeDefined();
    expect((preRestore!.entity as { episodes: { content: string }[] }).episodes[0]!.content).toBe(contentAt(2));
  });

  it('版本冲突：恢复过程中盘上被外部推进 → 抛 ScriptConflictError 且盘上内容不被覆盖', async () => {
    const v1 = await writeVersion(0, 1);
    const manual = await createScriptSnapshot('proj-x'); // 快照：第1版
    await writeVersion(v1!.version, 2); // 盘上第2版（readCurrent 将读到 version=2）

    // 在「pre-restore 快照落库瞬间」模拟外部写入者把主文件推进到 v99：
    // 之后 write(baseVersion=2) 与盘上 version=99 不匹配 → ScriptConflictError，不静默覆盖
    fsHooks.onWriteJson = (p: string) => {
      if (!p.startsWith(SNAP_DIR)) return;
      fsHooks.onWriteJson = null; // 只触发一次
      const external = readScriptEntity();
      external.version = 99;
      external.episodes[0]!.content = contentAt(99);
      files.set(MAIN, { text: JSON.stringify(external, null, 2), lastModified: 999 });
    };

    await expect(restoreScriptSnapshot('proj-x', manual!)).rejects.toBeInstanceOf(ScriptConflictError);
    // 盘上内容仍是外部版本，未被静默覆盖
    expect(readScriptEntity().episodes[0]!.content).toBe(contentAt(99));
    expect(readScriptEntity().version).toBe(99);
    // pre-restore 快照仍已入库（恢复前当前版=第2版，可找回）
    const snaps = await listSnapshots('proj-x', 'script');
    const preRestore = snaps.find((s) => s.reason === 'pre-restore');
    expect(preRestore).toBeDefined();
    expect((preRestore!.entity as { episodes: { content: string }[] }).episodes[0]!.content).toBe(contentAt(2));
  });
});

/** 直接读主文件当前实体（不经 readScript 的路径包装，测试断言用） */
function readScriptEntity(): { version: number; episodes: { content: string }[] } {
  return JSON.parse(files.get(MAIN)!.text) as { version: number; episodes: { content: string }[] };
}
