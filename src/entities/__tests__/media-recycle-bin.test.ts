/**
 * 媒体回收站（2026-11-10 用户要求）：
 * - 扫描只认 CAS 索引：refs>0 的绝不动；0 引用条目 / 索引外的残留文件才移入回收站
 * - 移入 = 搬文件 + 记账（来源/大小/时间/到期），不是硬删
 * - 到期清理才真删；恢复写回原路径且不覆盖同名文件
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, Uint8Array>();
const jsonFiles = new Map<string, unknown>();
let casIndex: { schemaVersion: number; entries: Record<string, any> } = { schemaVersion: 1, entries: {} };

vi.mock('@/platform/fs', () => ({
  listDir: async (dir: string) => {
    const prefix = `${dir}/`;
    const names = new Set(
      [...files.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)),
    );
    return [...names].filter((n) => !n.includes('/')).map((name) => ({ name, kind: 'file' as const }));
  },
  readFileHandle: async (p: string) => {
    const bytes = files.get(p);
    if (!bytes) return null;
    // 只实现生产代码用到的两个成员（size / arrayBuffer），避免依赖 jsdom 的 Blob 实现
    return {
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Blob;
  },
  writeFile: async (p: string, data: Blob | string) => {
    if (typeof data === 'string') {
      files.set(p, new TextEncoder().encode(data));
      return;
    }
    files.set(p, new Uint8Array(await data.arrayBuffer()));
  },
  removeFile: async (p: string) => { files.delete(p); },
  writeJson: async (p: string, value: unknown) => { jsonFiles.set(p, value); },
  readJson: async (p: string) => (jsonFiles.get(p) ?? null),
  stat: async (p: string) => (files.has(p) ? { size: files.get(p)!.byteLength, lastModified: 1 } : null),
}));

vi.mock('../cas-store', () => ({
  readCasIndex: async () => JSON.parse(JSON.stringify(casIndex)),
  detachEmptyCasEntry: async (hash: string) => {
    const entry = casIndex.entries[hash];
    if (!entry || entry.refCount > 0) return null;
    delete casIndex.entries[hash];
    return entry;
  },
}));

import {
  RECYCLE_INDEX_PATH,
  RECYCLE_RETENTION_DAYS,
  cleanupExpiredRecycleItems,
  formatBytes,
  listRecycleItems,
  purgeRecycleItem,
  restoreRecycleItem,
  scanOrphanMedia,
  sweepOrphansToRecycle,
} from '../media-recycle-bin.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const bytes = (n: number): Uint8Array => new TextEncoder().encode('x'.repeat(n));

function seed(): void {
  files.clear();
  jsonFiles.clear();
  casIndex = {
    schemaVersion: 1,
    entries: {
      // 有引用：绝不能被扫描/移动
      [HASH_A]: { path: `media/cas/${HASH_A}.png`, size: 10, mime: 'image/png', ext: 'png', refCount: 2, createdAt: '2026-11-01T00:00:00.000Z', refs: [{ assetId: 'a1', projectId: 'p' }, { assetId: 'a2', projectId: 'p' }] },
      // 0 引用条目：移入回收站
      [HASH_B]: { path: `media/cas/${HASH_B}.mp4`, size: 20, mime: 'video/mp4', ext: 'mp4', refCount: 0, createdAt: '2026-11-02T00:00:00.000Z', refs: [] },
    },
  };
  files.set(`media/cas/${HASH_A}.png`, bytes(10));
  files.set(`media/cas/${HASH_B}.mp4`, bytes(20));
  // 索引里根本没有的残留文件
  files.set(`media/cas/${HASH_C}.webp`, bytes(30));
}

beforeEach(seed);

describe('scanOrphanMedia', () => {
  it('只挑 0 引用条目 + 索引外残留，有引用的不动', async () => {
    const orphans = await scanOrphanMedia();
    const names = orphans.map((o) => o.name).sort();
    expect(names).toEqual([`${HASH_B}.mp4`, `${HASH_C}.webp`].sort());
    expect(orphans.find((o) => o.hash === HASH_B)?.source).toBe('cas-empty');
    expect(orphans.find((o) => o.hash === HASH_C)?.source).toBe('cas');
    expect(orphans.some((o) => o.hash === HASH_A)).toBe(false);
  });
});

describe('sweepOrphansToRecycle', () => {
  it('搬进回收站并记账：原文件消失、保留 30 天、索引零引用条目被摘掉', async () => {
    const res = await sweepOrphansToRecycle(new Date('2026-11-10T00:00:00.000Z'));
    expect(res.moved).toBe(2);
    expect(files.has(`media/cas/${HASH_B}.mp4`)).toBe(false);
    expect(files.has(`media/cas/${HASH_C}.webp`)).toBe(false);
    expect(files.has(`media/cas/${HASH_A}.png`)).toBe(true); // 有引用的保留
    const items = await listRecycleItems();
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.recycledPath.startsWith('media/recycle/')).toBe(true);
      expect(files.has(item.recycledPath)).toBe(true);
      expect(new Date(item.expiresAt).getTime() - new Date(item.deletedAt).getTime())
        .toBe(RECYCLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    }
    // 条目记账在固定索引文件里
    expect(jsonFiles.get(RECYCLE_INDEX_PATH)).toBeTruthy();
    expect(casIndex.entries[HASH_B]).toBeUndefined();
  });

  it('重复扫描不会重复记账', async () => {
    await sweepOrphansToRecycle(new Date('2026-11-10T00:00:00.000Z'));
    const again = await sweepOrphansToRecycle(new Date('2026-11-10T00:00:00.000Z'));
    expect(again.moved).toBe(0);
    expect(await listRecycleItems()).toHaveLength(2);
  });
});

describe('恢复 / 彻底删除 / 过期清理', () => {
  it('恢复写回原路径并从回收站移除；原路径已存在时拒绝覆盖', async () => {
    await sweepOrphansToRecycle(new Date('2026-11-10T00:00:00.000Z'));
    const [item] = await listRecycleItems();
    await restoreRecycleItem(item!.id);
    expect(files.has(item!.originalPath)).toBe(true);
    expect(files.has(item!.recycledPath)).toBe(false);
    expect(await listRecycleItems()).toHaveLength(1);

    const [rest] = await listRecycleItems();
    files.set(rest!.originalPath, bytes(1)); // 原路径被占用
    await expect(restoreRecycleItem(rest!.id)).rejects.toThrow(/同名文件/);
  });

  it('彻底删除立即移除文件与记录', async () => {
    await sweepOrphansToRecycle(new Date('2026-11-10T00:00:00.000Z'));
    const [item] = await listRecycleItems();
    await purgeRecycleItem(item!.id);
    expect(files.has(item!.recycledPath)).toBe(false);
    expect(await listRecycleItems()).toHaveLength(1); // 另一条还在
  });

  it('过期清理只删到期的，没到期的不动', async () => {
    await sweepOrphansToRecycle(new Date('2026-10-01T00:00:00.000Z'));
    const items = await listRecycleItems();
    expect(items).toHaveLength(2);
    // 只让其中一条过期（手工改到期时间）
    const index = jsonFiles.get(RECYCLE_INDEX_PATH) as { items: any[] };
    index.items[0].expiresAt = '2026-10-02T00:00:00.000Z';
    index.items[1].expiresAt = '2026-12-01T00:00:00.000Z';
    const purged = await cleanupExpiredRecycleItems(new Date('2026-11-10T00:00:00.000Z'));
    expect(purged).toBe(1);
    expect(await listRecycleItems()).toHaveLength(1);
  });
});

describe('formatBytes', () => {
  it('人类可读', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
