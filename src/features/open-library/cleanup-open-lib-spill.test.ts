/**
 * cleanupOpenLibSpillAssets 单测（2026-11-05）——误入库条目自动清理验收：
 * - 旧版「发送到画布」误把开源素材 addAsset 进个人资产库（sourceEntry.source='openlib' 标记）；
 * - 未被任何项目图真实引用的误入库条目 → 自动删除；
 * - 被项目图节点引用的条目 → 保留（真实使用）；
 * - 普通用户资产 → 不受影响；
 * - runOpenLibSpillCleanupOnce 会话级幂等（重复调用不重复执行）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// asset-store 内存桩：listAssets/removeAssets 可编程
const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assets: [] as any[],
  removeCalls: [] as string[][],
}));
vi.mock('@/features/asset-picker/asset-store.js', () => ({
  listAssets: async () => state.assets,
  removeAssets: async (ids: string[]) => {
    state.removeCalls.push(ids);
    state.assets = state.assets.filter((a) => !ids.includes(a.id as string));
    return state.assets;
  },
}));

// 项目图桩：可编程 listProjects/loadProjectGraph
const graphs = vi.hoisted(() => ({
  projects: [] as string[],
  byProject: {} as Record<string, unknown>,
}));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()),
  listProjects: async () => graphs.projects.map((id) => ({ id })),
  loadProjectGraph: async (id: string) => graphs.byProject[id] ?? null,
}));

import { cleanupOpenLibSpillAssets, runOpenLibSpillCleanupOnce } from './cleanup-open-lib-spill.js';
import type { Asset } from '@/features/asset-picker/index.js';

function spillAsset(id: string, storageKey: string): Asset {
  return {
    id,
    title: `误入库-${id}`,
    kind: 'image',
    scope: 'library',
    createdAt: '2026-11-05T00:00:00.000Z',
    bytes: 10,
    mimeType: 'image/png',
    data: { kind: 'image', dataUrl: '', storageKey, sourceEntry: { source: 'openlib', galleryId: 'g1', entryId: id } },
  } as Asset;
}

function userAsset(id: string): Asset {
  return {
    id,
    title: `我的资产-${id}`,
    kind: 'image',
    scope: 'library',
    createdAt: '2026-11-05T00:00:00.000Z',
    bytes: 10,
    mimeType: 'image/png',
    data: { kind: 'image', dataUrl: '', storageKey: `image:${id}` },
  } as Asset;
}

describe('cleanupOpenLibSpillAssets 误入库清理', () => {
  beforeEach(() => {
    state.assets = [];
    state.removeCalls = [];
    graphs.projects = [];
    graphs.byProject = {};
  });

  it('未被真实引用的误入库条目被删除；普通用户资产保留', async () => {
    state.assets = [spillAsset('openlib:e1', 'cas:aaa.png'), spillAsset('openlib:e2', 'cas:bbb.png'), userAsset('u1')];
    const removed = await cleanupOpenLibSpillAssets();

    expect(removed).toEqual(['openlib:e1', 'openlib:e2']);
    expect(state.removeCalls).toEqual([['openlib:e1', 'openlib:e2']]);
    // 普通资产不受影响
    expect(state.assets.map((a) => a.id)).toEqual(['u1']);
  });

  it('被项目图真实引用的条目保留（storageKey 出现在图数据中）', async () => {
    state.assets = [spillAsset('openlib:e1', 'cas:aaa.png'), spillAsset('openlib:e2', 'cas:bbb.png')];
    graphs.projects = ['p1'];
    graphs.byProject['p1'] = {
      nodes: [{ id: 'n1', type: 'image', data: { storageKey: 'cas:aaa.png' } }],
      edges: [],
    };
    const removed = await cleanupOpenLibSpillAssets();

    expect(removed).toEqual(['openlib:e2']);
    expect(state.assets.map((a) => a.id)).toEqual(['openlib:e1']);
  });

  it('无需清理时不动资产库', async () => {
    state.assets = [userAsset('u1')];
    const removed = await cleanupOpenLibSpillAssets();
    expect(removed).toEqual([]);
    expect(state.removeCalls).toEqual([]);
  });

  it('runOpenLibSpillCleanupOnce 会话级幂等：两次调用只执行一次清理', async () => {
    state.assets = [spillAsset('openlib:e1', 'cas:aaa.png')];
    const r1 = await runOpenLibSpillCleanupOnce();
    const r2 = await runOpenLibSpillCleanupOnce();
    expect(r1).toEqual(['openlib:e1']);
    expect(r2).toEqual(r1);
    expect(state.removeCalls).toHaveLength(1);
  });
});
