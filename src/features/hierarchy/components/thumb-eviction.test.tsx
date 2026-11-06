/**
 * 回归（2026-11-05 第三次「预览图/视频失效」·媒体 URL 层重做后的层级缩略契约）
 *
 * 历史根因：hierarchy-list-view 的 thumbCache LRU 逐出时 revokeObjectURL 释放了不属于自己的
 * blob URL（第一次修复=逐出不再 revoke）；同批根因还有 authorized-media/use-auth-image 的
 * 「url 变化时 revoke 外部传入的 blob: URL」、storeVideoThumbnail 覆盖写 revoke 旧 URL、
 * hydrate makeResizedVariant LRU 逐出 revoke 在用 URL、uploadAsset 把会话 blob URL 持久化进
 * 资产实体（刷新后必然 ERR_FILE_NOT_FOUND）。
 *
 * 本轮重做：层级缩略图不再持有任何「字符串 URL 缓存」，统一经 useMediaObjectUrl →
 * media-url-provider（会话级单一所有权 + LRU 上限）：挂载 acquire、卸载不 revoke、
 * onError 自愈重试一次、内容更新事件全持有者换新、刷新后按 storageKey 重新解析。
 * 2026-11-06 征集 #186：明确缓存策略——会话内复用同一 URL，仅在超上限时回收闲置条目。
 *
 * 断言：
 * 1) 行为：挂载 300 个缩略 → 每个存储键只解析一次、全程零 revoke；
 *    全部卸载后 URL 仍由会话级缓存持有；重新挂载直接复用同一 URL（零重复解析）。
 * 2) 结构：hierarchy-list-view 仅剩 ZIP 导出一处合法 revoke；无模块级 URL 缓存；
 *    makeResizedVariant 不再带 LRU 逐出回收（provider 所有权接管）。
 * 3) 结构：四处渲染点（资产库卡片 / 抽屉 / 画布节点 / 导演台槽位）路由到同一共享解析链。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ===== mock 变体链解析（media-url-provider 的 loader 数据源，可编程） =====
const { chainMock } = vi.hoisted(() => ({
  chainMock: vi.fn(async (k?: string): Promise<{ blob: Blob; origin: string } | null> => {
    if (!k || !k.startsWith('image:')) return null;
    return { blob: new Blob(['x']), origin: 'preview' };
  }),
}));
vi.mock('@/shared/media/resolve-media-blob.js', () => ({
  resolveMediaBlob: vi.fn(),
  resolveMediaBlobChain: (k?: string) => chainMock(k),
}));
// ===== provider 用真实实现（本套件验证 refCount 契约），仅桩掉层级用不到的云链 =====
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zeroexo/plugin-persistence')>();
  return {
    ...actual,
    IMAGE_CONTENT_UPDATED_EVENT: 'zeroexo:image-content-updated',
    resolveVideoThumbnail: vi.fn(async () => ''),
  };
});
vi.mock('@zeroexo/plugin-nodes', () => ({
  buildBackendUrl: () => null,
  resolveContentUrl: async (_k: string | undefined, c: string) => c,
}));
// 鉴权媒体组件会 fetch blob: URL，测试环境无网络语义，mock 成占位渲染
vi.mock('@/shared/components/authorized-media.js', () => ({
  AuthorizedImage: () => null,
  AuthorizedVideo: () => null,
}));

import { __configureMediaUrlProviderForTests } from '@zeroexo/plugin-persistence';
import { HierarchyThumbnail } from './hierarchy-list-view.js';

const THUMB_PROPS = { content: '', isVideo: false, borderColor: '#000', mutedColor: '#888' };
let revokeSpy: ReturnType<typeof vi.fn>;
let createSpy: ReturnType<typeof vi.fn>;

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
}

describe('层级缩略：media-url-provider 所有权契约（预览消失根因回归）', () => {
  beforeEach(() => {
    revokeSpy = vi.fn();
    createSpy = vi.fn((): string => `blob:hier:${createSpy.mock.calls.length + 1}`);
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    chainMock.mockClear();
    // 重置会话级 LRU 缓存（每用例独立；上限与回收策略由 provider 契约覆盖）
    __configureMediaUrlProviderForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('300 个缩略：每键解析一次、全程零 revoke；卸载后会话级缓存复用（超上限才按 LRU 回收闲置项）', async () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      createElement(HierarchyThumbnail, { key: i, ...THUMB_PROPS, storageKey: `image:k${i}` }));
    const { unmount } = render(createElement('div', null, rows));

    // 每个存储键只解析一次；300 < MAX_CACHED_URLS(512)，不触发 LRU 回收
    await waitFor(() => { expect(chainMock).toHaveBeenCalledTimes(300); });
    expect(createSpy).toHaveBeenCalledTimes(300);
    expect(revokeSpy).toHaveBeenCalledTimes(0);

    // 全部卸载 → 会话级缓存不 revoke（URL 生命周期与组件挂载解耦，绝不击穿在用的 <img>）
    unmount();
    expect(revokeSpy).toHaveBeenCalledTimes(0);

    // 重新挂载（模拟滚动回来/切页返回）：命中缓存直接复用同一 URL，零重复读盘/解码/创建
    chainMock.mockClear();
    const { container } = render(createElement(HierarchyThumbnail, { ...THUMB_PROPS, storageKey: 'image:k0' }));
    await waitFor(() => { expect(container.querySelector('img')).toBeTruthy(); });
    const src = container.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).toMatch(/^blob:hier:/);
    expect(chainMock).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(300);
    expect(revokeSpy).toHaveBeenCalledTimes(0); // 挂载中的 URL 永不回收
  });

  it('结构断言：hierarchy-list-view 无模块级 URL 缓存，仅剩 ZIP 导出一处合法 revoke', () => {
    const src = readSrc('./hierarchy-list-view.tsx');
    expect(src).not.toContain('thumbCache'); // 字符串缓存已删除（所有权归 provider）
    expect(src).toContain('useMediaObjectUrl'); // 缩略统一经 provider hook
    expect(src).toContain('markError'); // onError 自愈入口已接线
    // 自建自释的 ZIP 导出下载链不受影响（仅此一处属合法释放）
    expect(src.match(/revokeObjectURL/g)?.length).toBe(1);
  });

  it('结构断言：hydrate 缩放桶不再自带 LRU 逐出回收（所有权已移交 provider）', () => {
    const hydrate = readSrc('../../../../packages/plugins/nodes/src/utils/hydrate.ts');
    expect(hydrate).not.toContain('RESIZED_CACHE_MAX'); // 旧 LRU 上限已删除
    expect(hydrate).not.toContain('resizedVariantCache'); // 旧字符串缓存已删除
    expect(hydrate).toContain('acquireMediaObjectUrl'); // 经 provider 持有
    expect(hydrate).toContain('releaseResizedVariant'); // 卸载释放所有权
  });
});

describe('结构断言：四处渲染点共用同一持久解析链（修复必须全链路生效）', () => {
  it('资产库页卡片 / 抽屉素材分组 / 画布节点缩略 / 导演台槽位各文件断言', () => {
    // 1) 资产库页：卡片经 usePreviewImage → resolvePreviewUrl/resolveImageUrl 共享缓存
    const card = readSrc('../../asset-library/cards/asset-card.tsx');
    expect(card).toContain('usePreviewImage(');
    // 2) 抽屉素材分组：与资产库卡片同一解析入口
    const drawer = readSrc('../../canvas-assets/groups/HistoryGroup.tsx');
    expect(drawer).toContain('usePreviewImage(');
    // 3) 画布节点缩略：useProgressiveImage → resolveThumbnailUrl/resolvePreviewUrl 共享缓存
    const node = readSrc('../../../../packages/plugins/nodes/src/nodes/image-node-view.tsx');
    expect(node).toContain('useProgressiveImage(');
    // 4) 导演台槽位：ThumbImage/useResolvedThumb → 同一派生链
    const slot = readSrc('../../canvas-tabs/director-prompt-panel.tsx');
    expect(slot).toContain('ThumbImage');
    // 四处均不得自己 revoke 解析链返回的 URL（所有权归共享会话级缓存）
    expect(card).not.toContain('revokeObjectURL');
    expect(drawer).not.toContain('revokeObjectURL');
    expect(node).not.toContain('revokeObjectURL');
    expect(slot).not.toContain('revokeObjectURL');
  });
});
