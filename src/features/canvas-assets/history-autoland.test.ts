/**
 * 历史落库去重（2026-11-11 用户反馈：同一次生成在历史里出现两张卡）。
 * 两条链路同时落同一产物时，CAS 去重检查都还没看到记录 → 各建一条；
 * 在途锁必须保证只 addAsset 一次。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addAssetMock, state } = vi.hoisted(() => ({
  addAssetMock: vi.fn(async () => undefined),
  state: { releaseAdd: null as (() => void) | null },
}));

vi.mock('@/features/asset-picker/services/cas-upload.js', () => ({
  stageCasUpload: async (blob: Blob, kind: 'image' | 'video') => ({
    id: `id-${kind}`,
    cas: { hash: 'h'.repeat(64), path: `media/cas/${'h'.repeat(64)}.png` },
    storageKey: `cas:${'h'.repeat(64)}.png`,
    bytes: blob.size,
    mimeType: 'image/png',
    dedupedExistingAsset: false,
  }),
}));

vi.mock('@/features/asset-picker/asset-store.js', () => ({
  addAsset: addAssetMock,
}));

vi.mock('@/shared/current-canvas-id.js', () => ({
  getCurrentCanvasId: () => 'p1',
}));

vi.mock('@/shared/utils/guide-file.js', () => ({
  cacheGuideLocally: async () => null,
}));

import { autoLandGenerationBlob } from './history-autoland.js';

beforeEach(() => {
  addAssetMock.mockClear();
  state.releaseAdd = null;
});

describe('autoLandGenerationBlob 并发去重', () => {
  it('两条链路同时落同一产物 → 只写一条资产记录', async () => {
    addAssetMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { state.releaseAdd = resolve; });
    });
    const blob = new Blob(['img']);
    const first = autoLandGenerationBlob({ nodeId: 'n1', kind: 'image', title: '图', blob });
    // 让第一条进入 addAsset 的等待后再发起第二条
    await Promise.resolve();
    const second = await autoLandGenerationBlob({ nodeId: 'n1', kind: 'image', title: '图', blob });
    expect(second?.storageKey).toBe(`cas:${'h'.repeat(64)}.png`);
    state.releaseAdd?.();
    await first;
    expect(addAssetMock).toHaveBeenCalledTimes(1);
  });
});
