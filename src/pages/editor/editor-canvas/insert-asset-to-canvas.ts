/**
 * insertAssetToCanvas - 「发送到画布」统一落图助手（2026-11-05）
 *
 * 职责（对应修复验收 ①②④）：
 * ① 在当前画布新建节点（createAssetNode + AddNodeCommand）
 * ② 摆放在当前视口中心附近的级联槽位（连续发送不重叠）
 * ③ 成功后经统一导航入口 navigateToView('canvas', { nodeId }) 切回画布页签并触发聚焦
 *    （聚焦由画布侧 navigate-focus-receiver 订阅事件/暂存双通道执行，本助手不直接操作视口，
 *     避免双份聚焦动画；统一导航入口单一定义源，不另写跳转逻辑）
 * ④ 全程可判别成功/失败并返回原因（调用方据此给 message 反馈，禁止静默）
 *
 * 注：本助手不直接弹提示（UI 反馈归 use-editor-dialogs.handleAssetInsert），保证可单测。
 *
 * 2026-11-05 热修（征集 #174）：尺寸逻辑（真实宽高补全 + 长边上限）提到
 * `features/asset-picker/services/asset-node-size.ts` 与拖拽链共用，本文件只保留
 * 「视口中心级联摆放 + 建节点 + 统一导航」的发送链路职责。
 */
import { AddEdgeCommand, AddNodeCommand } from '@zeroexo/core';
import type { CommandQueue } from '@zeroexo/core';
import type { NodeRecord } from '@zeroexo/core';
import type { AssetNodePayloadArg } from '@/features/asset-picker/services/asset-node-size.js';
import { createSizedAssetNode } from '@/features/asset-picker/services/asset-node-size.js';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';

/**
 * 级联槽位：以视口中心为基准的固定偏移网格。
 * 列步距 360 / 行步距 340 ≥ 图片节点长边 320，保证连续发送的节点互不重叠；
 * wrap 8 次后回归中心槽位。偏出视口的槽位由导航聚焦兜底（视图移到新节点）。
 */
const CASCADE_OFFSETS: ReadonlyArray<Readonly<{ x: number; y: number }>> = [
  { x: 0, y: 0 },
  { x: 360, y: 0 },
  { x: -360, y: 0 },
  { x: 0, y: 340 },
  { x: 0, y: -340 },
  { x: 360, y: 340 },
  { x: -360, y: 340 },
  { x: 360, y: -340 },
];

/** 视口/聚焦所需的最小 store 结构（避免耦合具体 store 实现，单测可直接造桩） */
export interface CanvasInsertStore {
  getViewport(): { x: number; y: number; k: number };
  setSelection(sel: { selectedNodeIds: Set<string>; selectedEdgeIds: Set<string> }): unknown;
  /** 可选：发送历史图时恢复图生图引用链 */
  getGraph?(): { nodes: Array<{ id: string }> };
}

export interface InsertAssetToCanvasArgs {
  commandQueue: CommandQueue | null;
  store: CanvasInsertStore | null;
  containerSize: { width: number; height: number };
  /** 资产节点 payload（image/video/audio/text；尺寸契约见 asset-node-size.ts） */
  payload: AssetNodePayloadArg;
  /** 连续发送序号（调用方自增），决定级联槽位；wrap 后回归中心 */
  seq: number;
}

export type InsertAssetToCanvasResult =
  | { ok: true; nodeId: string; node: NodeRecord; position: { x: number; y: number } }
  | { ok: false; reason: 'canvas-not-ready' | 'create-failed' | 'navigate-failed'; error?: unknown };

export async function insertAssetToCanvas(args: InsertAssetToCanvasArgs): Promise<InsertAssetToCanvasResult> {
  const { commandQueue, store, containerSize, payload, seq } = args;
  if (!commandQueue || !store) return { ok: false, reason: 'canvas-not-ready' };
  try {
    const vp = store.getViewport();
    const cx = (containerSize.width / 2 - vp.x) / vp.k;
    const cy = (containerSize.height / 2 - vp.y) / vp.k;
    // 容器尺寸退化（未测量/display:none）时只落基准点，避免级联偏移把节点甩出视口
    const hasSize = containerSize.width > 0 && containerSize.height > 0;
    const off = hasSize ? CASCADE_OFFSETS[seq % CASCADE_OFFSETS.length]! : CASCADE_OFFSETS[0]!;
    const pos = { x: cx + off.x, y: cy + off.y };

    // ③ 节点容器比例 = 图片真实比例（长边 320，视口过小按 40% 收敛）；
    //    缺尺寸用中性 1:1，加载后 onload 纠偏。
    //    2026-11-05 热修：与拖拽链共用 createSizedAssetNode，两条入口尺寸行为必须一致。
    const node = await createSizedAssetNode(payload, pos, containerSize);
    if (!node) return { ok: false, reason: 'create-failed' };
    commandQueue.execute(new AddNodeCommand(node));
    // 历史图生图资产：源节点仍在画布上时恢复引用链，而不是只落一张孤立结果
    const generation = (payload as { generation?: { sourceNodeId?: string } }).generation;
    const sourceNodeId = generation?.sourceNodeId;
    if (sourceNodeId && store.getGraph?.().nodes.some((n) => n.id === sourceNodeId)) {
      commandQueue.execute(new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-history`,
        source: { nodeId: sourceNodeId, pinId: 'image' },
        target: { nodeId: node.id, pinId: 'prompt' },
      }));
    }
    store.setSelection({ selectedNodeIds: new Set([node.id]), selectedEdgeIds: new Set() });

    // 统一导航入口：切回画布页签并触发聚焦（画布侧接收端执行 focusOnNode）。
    // 节点已建但切页/聚焦失败必须可判别——返回 navigate-failed，由调用方提示用户手动查看。
    try {
      navigateToView('canvas', { nodeId: node.id });
    } catch (navError) {
      return { ok: false, reason: 'navigate-failed', error: navError };
    }
    return { ok: true, nodeId: node.id, node, position: { x: pos.x, y: pos.y } };
  } catch (error) {
    return { ok: false, reason: 'create-failed', error };
  }
}
