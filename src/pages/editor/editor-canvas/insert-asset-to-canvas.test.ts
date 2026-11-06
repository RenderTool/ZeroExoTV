/**
 * insert-asset-to-canvas 单测（2026-11-05）——「发送到画布」落图链路验收：
 * ① store 里真的多了一个节点（storageKey 引用 CAS，无 blob URL）；
 * ② 坐标落在当前视口可命中范围内；级联槽位连续发送不重叠；
 * ③ 成功后经统一导航入口 navigateToView('canvas', { nodeId }) 切页签并触发聚焦
 *    （聚焦执行归画布侧接收端，本助手不再本地 focusOnNode，避免双份动画）；
 * ④ 失败路径全部返回可判别原因（canvas-not-ready / create-failed / navigate-failed），禁止静默。
 *
 * 注：深路径直连源文件，绕开包级 index（plugin-nodes 链到 antd/fluent-emoji，
 * jsdom 无法解析 ESM 目录导入 —— 与 bugfix-20261104.test.tsx 同一规避手法）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 统一导航入口 mock：insert 侧只负责调用，切页签/聚焦由画布接收端单测覆盖
vi.mock('@/features/canvas-tabs/navigate-to-view.js', () => ({
  navigateToView: vi.fn(),
}));

// 真实宽高解析链（不读真实文件）：单测按用例注入 naturalWidth/Height
vi.mock('@/shared/media/resolve-media-blob.js', () => ({
  resolveMediaBlobChain: vi.fn(),
}));
vi.mock('@/features/asset-picker/services/cas-upload.js', () => ({
  readImageDims: vi.fn(),
}));

// createAssetNode 用真实实现（深路径），经 vi.fn 包装以便逐用例改写行为
// 2026-11-05（征集 #174）：尺寸契约提到 asset-node-size.ts 后，本模块从包入口取
// IMAGE_LONG_SIDE，mock 必须一并供出（否则 vitest 报「export not defined」）。
vi.mock('@zeroexo/plugin-nodes', async () => {
  const factory = await import('../../../../packages/plugins/nodes/src/asset-node-factory.js');
  const contracts = await import('../../../../packages/plugins/nodes/src/utils/node-contracts.js');
  return {
    createAssetNode: vi.fn(factory.createAssetNode),
    IMAGE_LONG_SIDE: contracts.IMAGE_LONG_SIDE,
    MEDIA_MIN_SIZE: contracts.MEDIA_MIN_SIZE,
  };
});

import { CommandQueue, EventBus } from '@zeroexo/core';
import { ReactGraphStore } from '../../../../packages/plugins/render-react/src/store.js';
import { createAssetNode } from '@zeroexo/plugin-nodes';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
import { resolveMediaBlobChain } from '@/shared/media/resolve-media-blob.js';
import { readImageDims } from '@/features/asset-picker/services/cas-upload.js';
import { insertAssetToCanvas } from './insert-asset-to-canvas.js';

const mockedCreateAssetNode = vi.mocked(createAssetNode);
const mockedNavigateToView = vi.mocked(navigateToView);
const mockedResolveMedia = vi.mocked(resolveMediaBlobChain);
const mockedReadDims = vi.mocked(readImageDims);

function makeStore(viewport: { x: number; y: number; k: number } = { x: 0, y: 0, k: 1 }) {
  const eventBus = new EventBus();
  const queue = new CommandQueue({ nodes: [], edges: [], viewport, metadata: {} }, eventBus);
  const store = new ReactGraphStore(queue, eventBus);
  return { queue, store };
}

/** 开源导入资产的典型 payload（storageKey 引用 CAS，dataUrl 为空） */
const OPENLIB_IMAGE_PAYLOAD = {
  kind: 'image' as const,
  dataUrl: '',
  storageKey: 'cas:0123abcd.png',
  title: 'むくむくシート',
};

beforeEach(() => {
  mockedNavigateToView.mockReset();
  mockedResolveMedia.mockReset();
  mockedReadDims.mockReset();
  // 默认：解析不到原图 → 走中性默认尺寸
  mockedResolveMedia.mockResolvedValue(null);
  mockedReadDims.mockResolvedValue({ width: 0, height: 0 });
});

describe('insertAssetToCanvas 成功路径', () => {
  it('store 里多一个图片节点：storageKey 引用 CAS、无 blob URL、坐标落在视口内，并经统一导航切页签聚焦', async () => {
    const { queue, store } = makeStore();
    const focusSpy = vi.spyOn(store, 'focusOnNode');
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // ① 节点真的进了 store
    const graph = store.getGraph();
    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0]!;
    const nodeData = node.data as { storageKey?: string; content?: string };
    expect(node.id).toBe(res.nodeId);
    expect(node.type).toBe('image');
    expect(nodeData.storageKey).toBe('cas:0123abcd.png');
    expect(nodeData.content).not.toContain('blob:'); // 引用 storageKey，禁止 blob URL 入节点
    // ② 坐标在视口可命中范围（k=1 时世界坐标=屏幕坐标）
    expect(res.position).toEqual({ x: 700, y: 450 });
    expect(res.position.x).toBeGreaterThanOrEqual(0);
    expect(res.position.y).toBeGreaterThanOrEqual(0);
    expect(res.position.x + (node.size?.width ?? 0)).toBeLessThanOrEqual(1400);
    expect(res.position.y + (node.size?.height ?? 0)).toBeLessThanOrEqual(900);
    // ③ 成功后经统一导航入口切画布页签并携带新节点 id（聚焦由画布侧接收端执行）
    expect(mockedNavigateToView).toHaveBeenCalledTimes(1);
    expect(mockedNavigateToView).toHaveBeenCalledWith('canvas', { nodeId: res.nodeId });
    // 本助手不再本地 focusOnNode（单一聚焦执行方，避免双份动画）
    expect(focusSpy).not.toHaveBeenCalled();
    // 新节点被选中
    expect(store.getSelection().selectedNodeIds.has(res.nodeId)).toBe(true);
  });

  it('连续发送级联摆放：相邻序号节点位置错开不重叠', async () => {
    const { queue, store } = makeStore();
    const positions: { x: number; y: number }[] = [];
    for (let seq = 0; seq < 3; seq++) {
      const res = await insertAssetToCanvas({
        commandQueue: queue,
        store,
        containerSize: { width: 1400, height: 900 },
        payload: OPENLIB_IMAGE_PAYLOAD,
        seq,
      });
      expect(res.ok).toBe(true);
      if (res.ok) positions.push(res.position);
    }
    expect(store.getGraph().nodes).toHaveLength(3);
    expect(mockedNavigateToView).toHaveBeenCalledTimes(3);
    // 级联槽位互不重叠：列步距 360 / 行步距 340 ≥ 图片节点长边 320
    expect(positions[1]!.x - positions[0]!.x).toBe(360);
    expect(positions[2]!.x - positions[0]!.x).toBe(-360);
    // 垂直方向不重叠（槽位 y 各异或错位）
    const rect = (p: { x: number; y: number }) => ({ l: p.x, r: p.x + 320, t: p.y, b: p.y + 240 });
    const a = rect(positions[0]!);
    const b = rect(positions[1]!);
    const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(overlap).toBe(false);
  });

  it('槽位偏出视口同样经导航聚焦兜底：navigateToView 携带 nodeId（接收端把视图移到新节点）', async () => {
    const { queue, store } = makeStore();
    const focusSpy = vi.spyOn(store, 'focusOnNode');
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 1, // 级联槽位 (640,0)：700+640+620 > 1400，必然出视口
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(mockedNavigateToView).toHaveBeenCalledWith('canvas', { nodeId: res.nodeId });
    expect(focusSpy).not.toHaveBeenCalled(); // 聚焦执行归接收端
  });
});

describe('insertAssetToCanvas 节点尺寸按图片真实比例（长边 320）', () => {
  async function insertWithDims(width: number, height: number) {
    mockedResolveMedia.mockResolvedValueOnce({ blob: new Blob(['img'], { type: 'image/png' }) } as any);
    mockedReadDims.mockResolvedValueOnce({ width, height });
    const { queue, store } = makeStore();
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    expect(res.ok).toBe(true);
    const node = store.getGraph().nodes[0]!;
    return node.size!;
  }

  it('3:4 竖图 → 240×320，节点比例与图片比例一致（误差 ≤0.01）', async () => {
    const size = await insertWithDims(1024, 1365);
    // eslint-disable-next-line no-console
    console.log('[3:4] node size', size, 'ratio', size.width / size.height);
    expect(size).toEqual({ width: 240, height: 320 });
    expect(Math.abs(size.width / size.height - 1024 / 1365)).toBeLessThanOrEqual(0.01);
  });

  it('16:9 横图 → 320×180，节点比例与图片比例一致（误差 ≤0.01）', async () => {
    const size = await insertWithDims(1920, 1080);
    // eslint-disable-next-line no-console
    console.log('[16:9] node size', size, 'ratio', size.width / size.height);
    expect(size).toEqual({ width: 320, height: 180 });
    expect(Math.abs(size.width / size.height - 1920 / 1080)).toBeLessThanOrEqual(0.01);
  });

  it('取不到真实尺寸 → 中性 1:1 320×320（不再是旧 620×348 宽幅容器）', async () => {
    mockedResolveMedia.mockResolvedValueOnce(null);
    const { queue, store } = makeStore();
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    expect(res.ok).toBe(true);
    const node = store.getGraph().nodes[0]!;
    // eslint-disable-next-line no-console
    console.log('[unknown] node size', node.size);
    expect(node.size).toEqual({ width: 320, height: 320 });
  });

  it('连续两次发送不重叠（320×240 节点，级联步距 360/340）', async () => {
    const { queue, store } = makeStore();
    const positions: { x: number; y: number }[] = [];
    for (let seq = 0; seq < 2; seq++) {
      const res = await insertAssetToCanvas({
        commandQueue: queue,
        store,
        containerSize: { width: 1400, height: 900 },
        payload: OPENLIB_IMAGE_PAYLOAD,
        seq,
      });
      expect(res.ok).toBe(true);
      if (res.ok) positions.push(res.position);
    }
    const [a, b] = positions as [{ x: number; y: number }, { x: number; y: number }];
    const w = 320;
    const h = 240;
    const overlap = a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;
    expect(overlap).toBe(false);
    // 间距按新尺寸收敛（列步距 360 - 节点长边 320 = 40px 间隙），不会摆到很远空白区
    expect(b.x - a.x - w).toBeGreaterThanOrEqual(0);
    expect(b.x - a.x - w).toBeLessThanOrEqual(60);
  });
});

describe('insertAssetToCanvas 失败路径（必须可判别，禁止静默）', () => {
  it('画布未就绪（commandQueue/store 缺失）→ canvas-not-ready', async () => {
    const res = await insertAssetToCanvas({
      commandQueue: null,
      store: null,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    expect(res).toEqual({ ok: false, reason: 'canvas-not-ready' });
    expect(mockedNavigateToView).not.toHaveBeenCalled();
  });

  it('createAssetNode 抛错 → create-failed 且带原始错误，store 无节点', async () => {
    const { queue, store } = makeStore();
    mockedCreateAssetNode.mockRejectedValueOnce(new Error('下载失败'));
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('create-failed');
    expect((res.error as Error).message).toBe('下载失败');
    expect(store.getGraph().nodes).toHaveLength(0);
    expect(mockedNavigateToView).not.toHaveBeenCalled();
  });

  it('createAssetNode 返回 null（不支持的类型）→ create-failed，store 无节点', async () => {
    const { queue, store } = makeStore();
    mockedCreateAssetNode.mockResolvedValueOnce(null as any);
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    expect(res).toMatchObject({ ok: false, reason: 'create-failed' });
    expect(store.getGraph().nodes).toHaveLength(0);
  });

  it('切页签失败（navigateToView 抛错）→ navigate-failed 且带原始错误，节点仍已建成', async () => {
    const { queue, store } = makeStore();
    mockedNavigateToView.mockImplementationOnce(() => {
      throw new Error('页签切换失败');
    });
    const res = await insertAssetToCanvas({
      commandQueue: queue,
      store,
      containerSize: { width: 1400, height: 900 },
      payload: OPENLIB_IMAGE_PAYLOAD,
      seq: 0,
    });
    // 节点已建成功（不回滚），但必须可判别地报告导航失败，禁止静默
    expect(store.getGraph().nodes).toHaveLength(1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('navigate-failed');
    expect((res.error as Error).message).toBe('页签切换失败');
  });
});
