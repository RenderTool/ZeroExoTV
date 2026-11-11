/**
 * 资产列表存活过滤（2026-11-11 用户反馈）：
 * 文件已经被清理/删除的资产，不应再出现在「资产 → 项目/全局」列表里。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const existingFiles = new Set<string>();
let casIndex: { schemaVersion: number; entries: Record<string, unknown> } = { schemaVersion: 1, entries: {} };

vi.mock('@/entities/cas-store', () => ({
  readCasIndex: async () => JSON.parse(JSON.stringify(casIndex)),
  isCasStorageKey: (key: unknown) => typeof key === 'string' && key.startsWith('cas:'),
  parseCasStorageKey: (key: string) => {
    const m = /^cas:([0-9a-f]{64})\.([a-z0-9]+)$/.exec(key);
    return m ? { hash: m[1], ext: m[2] } : null;
  },
}));

vi.mock('@/platform/fs', () => ({
  stat: async (p: string) => (existingFiles.has(p) ? { size: 1, lastModified: 1 } : null),
}));

import { filterLiveAssets } from './asset-liveness.js';
import type { Asset } from './index.js';

const HASH = 'a'.repeat(64);

const mk = (id: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): Asset => ({
  id, title: id, data, createdAt: new Date().toISOString(), ...extra,
} as unknown as Asset);

beforeEach(() => {
  existingFiles.clear();
  casIndex = { schemaVersion: 1, entries: { [HASH]: { path: `media/cas/${HASH}.png` } } };
});

describe('filterLiveAssets', () => {
  it('cas 索引里还有 → 保留；索引没有 → 隐藏', async () => {
    const live = mk('live', { kind: 'image', storageKey: `cas:${HASH}.png` });
    const dead = mk('dead', { kind: 'image', storageKey: `cas:${'b'.repeat(64)}.png` });
    const kept = await filterLiveAssets([live, dead]);
    expect(kept.map((a) => a.id)).toEqual(['live']);
  });

  it('旧 storageKey：文件存在保留，缺失隐藏', async () => {
    existingFiles.add('media/old.png');
    const live = mk('old-live', { kind: 'image', storageKey: 'media/old.png' });
    const dead = mk('old-dead', { kind: 'image', storageKey: 'media/gone.png' });
    const kept = await filterLiveAssets([live, dead]);
    expect(kept.map((a) => a.id)).toEqual(['old-live']);
  });

  it('文本类直接保留；没有任何落盘键/内容 → 隐藏；内联 dataUrl → 保留', async () => {
    const text = mk('txt', { kind: 'text', content: '内容' });
    const empty = mk('empty', { kind: 'image' });
    const inline = mk('inline', { kind: 'image', dataUrl: 'data:image/png;base64,xx' });
    const kept = await filterLiveAssets([text, empty, inline]);
    expect(kept.map((a) => a.id)).toEqual(['txt', 'inline']);
  });

  it('空列表不读盘，直接返回', async () => {
    await expect(filterLiveAssets([])).resolves.toEqual([]);
  });
});
