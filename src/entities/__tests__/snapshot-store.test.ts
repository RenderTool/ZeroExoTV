/**
 * snapshot-store 统一快照库单测（2026-11-04 快照/版本功能·断言①②③④⑥）
 *
 * ① 内容 hash 与最新快照相同 → 不生成 auto；
 * ② 5 分钟时间窗内只落 pre-save、不生成 auto；出窗后下一次写盘生成 auto；
 * ③ 回收：每类保留最近 30 份且不早于 7 天；保护最近 3 份与最近 1 份 pre-restore；200MB 总量上限；
 * ④ manual 手动快照不受时间窗限制；
 * ⑥ 老 backups/ 幂等迁移（dry-run → 执行 → 二次运行 0 改动）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/platform/fs', () => {
  const files = new Map<string, { text: string; lastModified: number; size?: number }>();
  let tick = 0;
  return {
    __files: files,
    readJson: async (p: string) => {
      const f = files.get(p);
      return f ? (JSON.parse(f.text) as unknown) : null;
    },
    stat: async (p: string) => {
      const f = files.get(p);
      return f ? { size: f.size ?? f.text.length, lastModified: f.lastModified } : null;
    },
    writeJson: async (p: string, value: unknown) => {
      files.set(p, { text: JSON.stringify(value, null, 2), lastModified: ++tick });
    },
    writeJsonIfUnchanged: async (p: string, value: unknown) => {
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
  writeSnapshot, listSnapshots, recycleSnapshots, afterWriteSnapshot,
  migrateLegacyBackups, ensureLegacyMigrated,
  deleteSnapshotFile, undeleteSnapshot, setSnapshotFavorite,
  SNAPSHOT_KEEP_COUNT, SNAPSHOT_KEEP_MS,
  type EntitySnapshot, type SnapshotListItem,
} from '@/entities/snapshot-store.js';

// 顶层捕获 mock（测试内的动态 import 在 fake timers 下会拿到非 mock 实例，勿在用例内 import）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsMod = (await import('@/platform/fs')) as any;
const files = fsMod.__files as Map<string, { text: string; lastModified: number; size?: number }>;

const DIR = 'projects/p1/entities/snapshots/script';

function snapNames(): string[] {
  return Array.from(files.keys()).filter((k) => k.startsWith(`${DIR}/`)).sort();
}

/** 直接读 files Map（绕开 mock readJson 的实例问题）；snapNames 返回的是完整 key */
function snapAt(i: number): EntitySnapshot | null {
  const names = snapNames();
  const f = files.get(names[i]!);
  return f ? (JSON.parse(f.text) as EntitySnapshot) : null;
}

const entityAt = (i: number): { title: string; episodes: unknown[] } => ({ title: 'T', episodes: [{ content: `第${i}版` }] });

describe('snapshot-store 生成规则（①②④）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('① 内容 hash 与最新快照相同 → 不生成', async () => {
    await writeSnapshot('p1', 'script', entityAt(1), 'manual');
    expect(snapNames()).toHaveLength(1);
    await afterWriteSnapshot('p1', 'script', entityAt(1)); // 同内容
    await afterWriteSnapshot('p1', 'script', entityAt(1));
    expect(snapNames()).toHaveLength(1); // 无新增
  });

  it('② 5 分钟时间窗内不生成 auto；出窗后下一次写盘生成', async () => {
    await writeSnapshot('p1', 'script', entityAt(1), 'manual', { now: new Date('2026-11-04T12:00:00Z') });
    // 窗口内（+1min）：内容变化但不生成 auto
    vi.setSystemTime(new Date('2026-11-04T12:01:00Z'));
    await afterWriteSnapshot('p1', 'script', entityAt(2));
    expect(snapNames()).toHaveLength(1);
    // 仍在窗口内（+4min）：继续不生成
    vi.setSystemTime(new Date('2026-11-04T12:04:00Z'));
    await afterWriteSnapshot('p1', 'script', entityAt(2));
    expect(snapNames()).toHaveLength(1);
    // 出窗（+6min ≥ 5min）：生成 auto
    vi.setSystemTime(new Date('2026-11-04T12:06:00Z'));
    await afterWriteSnapshot('p1', 'script', entityAt(2));
    expect(snapNames()).toHaveLength(2);
    const latest = await snapAt(1);
    expect(latest!.reason).toBe('auto');
  });

  it('④ manual 手动快照不受时间窗限制', async () => {
    await writeSnapshot('p1', 'script', entityAt(1), 'auto');
    vi.setSystemTime(new Date('2026-11-04T12:00:01Z')); // 距上一份仅 1 秒
    await writeSnapshot('p1', 'script', entityAt(1), 'manual', { name: '定稿' });
    expect(snapNames()).toHaveLength(2);
    const manual = await snapAt(1);
    expect(manual!.reason).toBe('manual');
    expect(manual!.name).toBe('定稿');
  });
});

describe('snapshot-store 回收（③：30 份 / 7 天 / 保护 / 200MB）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('超出 30 份 → 最旧被回收，恰好保留 30 份（第 31 份生成后最旧删除）', async () => {
    const TOTAL = SNAPSHOT_KEEP_COUNT + 5;
    for (let i = 0; i < TOTAL; i += 1) {
      vi.setSystemTime(new Date(Date.now() + 1000)); // 唯一文件名
      await writeSnapshot('p1', 'script', entityAt(i), 'auto');
    }
    expect(snapNames()).toHaveLength(TOTAL);
    vi.setSystemTime(new Date(Date.now() + 1000));
    await recycleSnapshots('p1', 'script');
    expect(snapNames()).toHaveLength(SNAPSHOT_KEEP_COUNT); // 35 → 30，最旧 5 份被删
    const oldest = await snapAt(0);
    expect(oldest!.entity).toEqual(entityAt(5)); // 保留的是第 5..34 份（0 起）
  });

  it('早于 7 天的快照被回收（保护集除外）', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    // 8 天前 3 份 + 今天 2 份
    for (let i = 0; i < 3; i += 1) {
      await writeSnapshot('p1', 'script', entityAt(i), 'auto', { now: new Date(now.getTime() - SNAPSHOT_KEEP_MS - 86400000 + i * 1000) });
    }
    await writeSnapshot('p1', 'script', entityAt(3), 'auto', { now: new Date(now.getTime() - 2000) });
    await writeSnapshot('p1', 'script', entityAt(4), 'auto', { now: new Date(now.getTime() - 1000) });
    const removed = await recycleSnapshots('p1', 'script', now);
    expect(removed).toBe(2); // 8 天前的第 1、2 份被删
    expect(snapNames()).toHaveLength(3);
    const kept = await snapAt(0);
    expect(kept!.entity).toEqual(entityAt(2)); // 8 天前第 3 份在「最近 3 份」保护集内幸存
  });

  it('保护：最近 1 份 pre-restore 即使超出 7 天也不回收', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    await writeSnapshot('p1', 'script', entityAt(0), 'pre-restore', { now: new Date(now.getTime() - SNAPSHOT_KEEP_MS - 86400000) });
    for (let i = 1; i <= 3; i += 1) {
      await writeSnapshot('p1', 'script', entityAt(i), 'auto', { now: new Date(now.getTime() - SNAPSHOT_KEEP_MS - 86400000 + i * 1000) });
    }
    await recycleSnapshots('p1', 'script', now); // 4 份全部早于 7 天
    const reasons = snapNames().map((_, i) => snapAt(i));
    // 保护集 = 最近 3 份（auto×3）+ 最近 1 份 pre-restore → 4 份全部幸存
    expect(reasons).toHaveLength(4);
    expect(reasons.map((r) => r!.reason)).toEqual(['pre-restore', 'auto', 'auto', 'auto']);
  });

  it('200MB 总量上限：按最旧回收至限额内（跳过保护集）', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    const BIG = 60 * 1024 * 1024;
    for (let i = 0; i < 4; i += 1) {
      const snap = await writeSnapshot('p1', 'script', entityAt(i), 'auto', { now: new Date(now.getTime() + i * 1000) });
      const f = files.get(`${DIR}/${snap.fileName}`)!;
      f.size = BIG; // 模拟单份 60MB（mock stat 优先取 size）
    }
    await recycleSnapshots('p1', 'script', now);
    expect(snapNames()).toHaveLength(3); // 240MB > 200MB → 最旧一份被回收 → 180MB ≤ 200MB
  });
});

describe('snapshot-store 星标收藏（2026-11-08：上限 30 + 收藏跳过）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('writeSnapshot 写入 favorite；setSnapshotFavorite 可切换且不改文件名/时间/hash', async () => {
    const snap = await writeSnapshot('p1', 'script', entityAt(0), 'manual', { favorite: true });
    const before = await snapAt(0);
    expect(before?.favorite).toBe(true);
    expect((await listSnapshots('p1', 'script'))[0]?.favorite).toBe(true);

    await setSnapshotFavorite('p1', 'script', snap.fileName, false);
    const off = await snapAt(0);
    expect(off?.favorite).toBeUndefined();
    expect(off?.createdAt).toBe(before?.createdAt);
    expect(off?.hash).toBe(before?.hash);
    expect(snapNames()[0]).toBe(`${DIR}/${snap.fileName}`); // 排序位置不变

    await setSnapshotFavorite('p1', 'script', snap.fileName, true);
    expect((await snapAt(0))?.favorite).toBe(true);
  });

  it('收藏项不占 30 份配额：35 份里 3 份收藏 → 只回收最旧的普通版本', async () => {
    const TOTAL = SNAPSHOT_KEEP_COUNT + 5;
    const favoriteNames: string[] = [];
    for (let i = 0; i < TOTAL; i += 1) {
      vi.setSystemTime(new Date(Date.now() + 1000));
      const fav = i === 0 || i === 1 || i === TOTAL - 1;
      const snap = await writeSnapshot('p1', 'script', entityAt(i), 'auto', fav ? { favorite: true } : {});
      if (fav) favoriteNames.push(snap.fileName);
    }
    expect(snapNames()).toHaveLength(TOTAL);
    await recycleSnapshots('p1', 'script');

    const all = await listSnapshots('p1', 'script');
    const favs = all.filter((s) => s.favorite);
    const normals = all.filter((s) => !s.favorite);
    expect(favs.map((s) => s.fileName).sort()).toEqual(favoriteNames.sort());
    expect(normals).toHaveLength(SNAPSHOT_KEEP_COUNT);
    expect(normals[0]?.entity).toEqual(entityAt(4)); // 最旧两份普通版本被回收
  });

  it('收藏项跳过 7 天 TTL 回收', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    const old = new Date(now.getTime() - SNAPSHOT_KEEP_MS - 86400000);
    const fav = await writeSnapshot('p1', 'script', entityAt(0), 'manual', { now: old, favorite: true });
    await writeSnapshot('p1', 'script', entityAt(1), 'manual', { now: new Date(old.getTime() + 1000) });
    for (let i = 2; i < 5; i += 1) {
      await writeSnapshot('p1', 'script', entityAt(i), 'auto', { now: new Date(now.getTime() - (5 - i) * 1000) });
    }
    await recycleSnapshots('p1', 'script', now);
    const all = await listSnapshots('p1', 'script');
    expect(all.some((s) => s.fileName === fav.fileName && s.favorite)).toBe(true);
  });

  it('收藏项跳过 200MB 总量回收（改删次旧的普通版本）', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    const BIG = 60 * 1024 * 1024;
    const fav = await writeSnapshot('p1', 'script', entityAt(0), 'manual', { now, favorite: true });
    files.get(`${DIR}/${fav.fileName}`)!.size = BIG;
    for (let i = 1; i < 5; i += 1) {
      const s = await writeSnapshot('p1', 'script', entityAt(i), 'auto', { now: new Date(now.getTime() + i * 1000) });
      files.get(`${DIR}/${s.fileName}`)!.size = BIG;
    }
    await recycleSnapshots('p1', 'script', now);
    const all = await listSnapshots('p1', 'script');
    expect(all.some((s) => s.fileName === fav.fileName && s.favorite)).toBe(true);
    expect(all.map((s) => JSON.stringify(s.entity))).not.toContain(JSON.stringify(entityAt(1)));
  });
});

describe('snapshot-store 老 backups 迁移（⑥：dry-run → 执行 → 幂等）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  function seedLegacyBackups(): void {
    // 上轮 pre-save 备份（包裹形态 { reason, backedAt, entity }）
    files.set('projects/p1/entities/backups/script-presave-20261104090000000.json', {
      text: JSON.stringify({ reason: 'pre-save', backedAt: '2026-11-04T09:00:00.000Z', entity: entityAt(1) }),
      lastModified: 1,
    });
    // 导入覆盖备份（裸实体）
    files.set('projects/p1/entities/backups/script-ep-1-20261104093000.json', {
      text: JSON.stringify(entityAt(2)),
      lastModified: 2,
    });
  }

  it('⑥ dry-run 只列清单不动盘；执行后归并到 snapshots/script/（reason=pre-save）；二次运行 0 改动', async () => {
    seedLegacyBackups();

    // dry-run：返回清单、不迁移
    const plan = await migrateLegacyBackups('p1', { dryRun: true });
    expect(plan).toHaveLength(2);
    // listDir 按文件名排序：script-ep-* 字典序在 script-presave-* 之前
    expect(plan.map((p) => p.from).sort()).toEqual([
      'projects/p1/entities/backups/script-ep-1-20261104093000.json',
      'projects/p1/entities/backups/script-presave-20261104090000000.json',
    ]);
    expect(Array.from(files.keys()).filter((k) => k.includes('/backups/'))).toHaveLength(2); // 未动

    // 执行迁移
    const done = await migrateLegacyBackups('p1');
    expect(done).toHaveLength(2);
    expect(Array.from(files.keys()).filter((k) => k.includes('/backups/'))).toHaveLength(0); // 老 backups 清空
    const snaps = await listSnapshots('p1', 'script');
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => s.reason === 'pre-save')).toBe(true);
    expect(snaps[1]!.entity).toEqual(entityAt(2)); // 文件名字典序：14 位(导入) < 17 位(presave)？

    // 二次运行（非 dryRun）：backups/ 已空 → 0 改动（幂等）
    const again = await migrateLegacyBackups('p1');
    expect(again).toHaveLength(0);
    expect(await listSnapshots('p1', 'script')).toHaveLength(2);

    // 目标已存在时跳过（幂等保护）：老文件重现 → 计划返回但不动盘
    seedLegacyBackups();
    const skip = await migrateLegacyBackups('p1');
    expect(skip).toHaveLength(2); // 仍返回计划
    expect(await listSnapshots('p1', 'script')).toHaveLength(2); // 未重复写入
    expect(Array.from(files.keys()).filter((k) => k.includes('/backups/'))).toHaveLength(2); // 老文件保留待人工确认
  });

  it('ensureLegacyMigrated：会话内只执行一次（重复调用 0 改动）', async () => {
    // 用独立项目，避免与上一用例共享会话级「已迁移」标记
    files.set('projects/p2/entities/backups/script-presave-20261104090000000.json', {
      text: JSON.stringify({ reason: 'pre-save', backedAt: '2026-11-04T09:00:00.000Z', entity: entityAt(1) }),
      lastModified: 1,
    });
    await ensureLegacyMigrated('p2');
    expect(await listSnapshots('p2', 'script')).toHaveLength(1);
    files.set('projects/p2/entities/backups/script-presave-20261104100000000.json', {
      text: JSON.stringify({ reason: 'pre-save', backedAt: '2026-11-04T10:00:00.000Z', entity: entityAt(9) }),
      lastModified: 3,
    });
    await ensureLegacyMigrated('p2'); // 会话级标记：不再迁移
    expect(await listSnapshots('p2', 'script')).toHaveLength(1);
    expect(Array.from(files.keys()).filter((k) => k.includes('projects/p2/entities/backups/'))).toHaveLength(1); // 新老文件未被动
  });
});

describe('snapshot-store 手动删除（deleteSnapshotFile / undeleteSnapshot，2026-11-05）', () => {
  beforeEach(() => {
    files.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('deleteSnapshotFile：文件真正消失；重复删除与删除不存在文件均幂等不抛错', async () => {
    const snap = await writeSnapshot('p1', 'script', entityAt(1), 'manual');
    expect(snapNames()).toHaveLength(1);
    await deleteSnapshotFile('p1', 'script', snap.fileName);
    expect(snapNames()).toHaveLength(0);
    await expect(deleteSnapshotFile('p1', 'script', snap.fileName)).resolves.toBeUndefined(); // 已删再删
    await expect(deleteSnapshotFile('p1', 'script', 'snap-999999999999999999.json')).resolves.toBeUndefined(); // 从未存在
    expect(await listSnapshots('p1', 'script')).toHaveLength(0);
  });

  it('undeleteSnapshot：原文件名/原内容写回，排序位置与删除前完全一致', async () => {
    await writeSnapshot('p1', 'script', entityAt(1), 'auto');
    await writeSnapshot('p1', 'script', entityAt(2), 'manual', { name: '定稿' });
    await writeSnapshot('p1', 'script', entityAt(3), 'auto');
    const before = await listSnapshots('p1', 'script');
    expect(before).toHaveLength(3);
    const middle = before[1]!; // 手动删中间一份
    await deleteSnapshotFile('p1', 'script', middle.fileName);
    const withoutMiddle = await listSnapshots('p1', 'script');
    expect(withoutMiddle.map((s) => s.fileName)).toEqual([before[0]!.fileName, before[2]!.fileName]);
    // 撤销：写回后字段逐项一致（含可选 name）、位置还原
    await undeleteSnapshot('p1', 'script', middle);
    const restored = await listSnapshots('p1', 'script');
    expect(restored.map((s) => s.fileName)).toEqual(before.map((s) => s.fileName));
    const back: SnapshotListItem = restored[1]!;
    expect(back.reason).toBe('manual');
    expect(back.name).toBe('定稿');
    expect(back.hash).toBe(middle.hash);
    expect(back.entity).toEqual(middle.entity);
    expect(back.createdAt).toBe(middle.createdAt);
  });

  it('手动删除的条目不再参与自动回收计数；回收规则照常不受影响', async () => {
    const TOTAL = SNAPSHOT_KEEP_COUNT + 1; // 31 份 → 未手动删时回收会裁掉最旧 1 份
    for (let i = 0; i < TOTAL; i += 1) {
      vi.setSystemTime(new Date(Date.now() + 1000)); // 唯一文件名
      await writeSnapshot('p1', 'script', entityAt(i), 'auto');
    }
    const namesBefore = snapNames();
    await deleteSnapshotFile('p1', 'script', namesBefore[0]!.slice(DIR.length + 1)); // 手动删最旧（snapNames 返回完整 key，取文件名段）
    const removed = await recycleSnapshots('p1', 'script');
    expect(removed).toBe(0); // 盘上已 30 份 ≤ 30 → 不再回收（删除项不占计数）
    expect(snapNames()).toEqual(namesBefore.slice(1)); // 手动删除的未被“复活”，其余 30 份原样
    // 回收保护照常：再写 1 份（第 31 份）→ recycle 恢复「保留最近 30」行为
    vi.setSystemTime(new Date(Date.now() + 1000));
    await writeSnapshot('p1', 'script', entityAt(99), 'auto');
    await recycleSnapshots('p1', 'script');
    expect(snapNames()).toHaveLength(SNAPSHOT_KEEP_COUNT);
    const oldest = await snapAt(0);
    expect(oldest!.entity).toEqual(entityAt(2)); // 最旧的 entityAt(1) 被正常回收
  });

  it('listSnapshots withSize=true：逐份填充 sizeBytes（面板计数/占用用）', async () => {
    await writeSnapshot('p1', 'script', entityAt(1), 'auto');
    const sized = await listSnapshots('p1', 'script', { withSize: true });
    expect(sized).toHaveLength(1);
    expect(typeof sized[0]!.sizeBytes).toBe('number');
    expect(sized[0]!.sizeBytes).toBeGreaterThan(0);
    const plain = await listSnapshots('p1', 'script');
    expect(plain[0]!.sizeBytes).toBeUndefined(); // 默认不填充（回收热路径不多耗 IO）
  });
});
