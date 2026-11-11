/**
 * 孤立媒体即时清理（2026-11-11 用户要求：不要回收站，定时主动清理）。
 * 只删「确认没有任何引用」的文件：0 引用索引条目 + 索引外残留；有引用的绝不动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Set<string>();
let casIndex: { schemaVersion: number; entries: Record<string, any> } = { schemaVersion: 1, entries: {} };

vi.mock('@/platform/fs', () => ({
  listDir: async (dir: string) => {
    const prefix = `${dir}/`;
    const names = [...files]
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .filter((n) => !n.includes('/'));
    return names.map((name) => ({ name, kind: 'file' as const }));
  },
  removeFile: async (p: string) => { files.delete(p); },
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

import { purgeOrphanMedia } from '../orphan-media.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

beforeEach(() => {
  files.clear();
  casIndex = {
    schemaVersion: 1,
    entries: {
      [HASH_A]: { path: `media/cas/${HASH_A}.png`, refCount: 1, refs: [{ assetId: 'a1', projectId: 'p' }] },
      [HASH_B]: { path: `media/cas/${HASH_B}.mp4`, refCount: 0, refs: [] },
    },
  };
  files.add(`media/cas/${HASH_A}.png`);
  files.add(`media/cas/${HASH_B}.mp4`);
  files.add(`media/cas/${HASH_C}.webp`);
});

describe('purgeOrphanMedia', () => {
  it('删掉 0 引用条目与索引外残留，保留有引用的文件', async () => {
    const res = await purgeOrphanMedia();
    expect(res.removed).toBe(2);
    expect(res.failed).toBe(0);
    expect(files.has(`media/cas/${HASH_A}.png`)).toBe(true); // 有引用，保留
    expect(files.has(`media/cas/${HASH_B}.mp4`)).toBe(false);
    expect(files.has(`media/cas/${HASH_C}.webp`)).toBe(false);
    expect(casIndex.entries[HASH_B]).toBeUndefined();
  });

  it('重复清理幂等：没有新孤儿时 removed=0', async () => {
    await purgeOrphanMedia();
    const again = await purgeOrphanMedia();
    expect(again.removed).toBe(0);
  });

  it('删除文件失败时不摘索引条目（避免断链索引）', async () => {
    const fs = await import('@/platform/fs');
    const spy = vi.spyOn(fs, 'removeFile').mockRejectedValueOnce(new Error('denied'));
    const res = await purgeOrphanMedia();
    expect(res.failed).toBeGreaterThan(0);
    expect(casIndex.entries[HASH_B]).toBeTruthy();
    spy.mockRestore();
  });
});
