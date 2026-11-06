/**
 * navigate-focus-receiver - 统一导航入口（navigate-to-view）画布侧接收端（2026-11-05）
 *
 * 「发送到画布」成功后 insert-asset-to-canvas 调 navigateToView('canvas', { nodeId })：
 * 切画布页签 + 双通道把聚焦目标送达本接收端——
 * - 画布已挂载 → NAVIGATE_FOCUS_NODE_EVENT 事件直达（事件处理时同步清空暂存，
 *   防下次挂载对同一目标重复聚焦）；
 * - 画布刚切换尚未挂载 → navigateToView 暂存请求，本接收端挂载时调
 *   takePendingNavigateFocus() 取走（取走即清空）。
 *
 * 由 use-editor-interactions 挂 useEffect 接线（画布已有交互 hook 内，不造全局单例）；
 * 纯函数 + 订阅器形态，便于单测。
 */

import {
  NAVIGATE_FOCUS_NODE_EVENT,
  takePendingNavigateFocus,
  type NavigateFocusPayload,
} from '@/features/canvas-tabs/navigate-to-view.js';

/** 聚焦所需的最小 store 结构（结构兼容 ReactGraphStore，单测可造桩） */
export interface NavigateFocusNodeStore {
  getGraph(): {
    nodes: ReadonlyArray<{
      id: string;
      position?: { x?: number; y?: number } | undefined;
      size?: { width?: number; height?: number } | undefined;
    }>;
  };
  /**
   * 固定 1:1 对准节点（2026-11-05 约定：发送后视口对准新节点、zoom 固定 1）。
   * 真实 store 均有此方法；桩未提供时退回 focusOnNode（既有自适应缩放）。
   */
  setViewport?(viewport: { x: number; y: number; k: number }): void;
  focusOnNode(
    nodeId: string,
    containerSize: { width: number; height: number },
    nodeWidth?: number,
    nodeHeight?: number,
    durationMs?: number,
    capsuleHeight?: number,
  ): void;
}

/**
 * 按导航目标聚焦画布节点。
 * 节点不存在（已删/未建成）→ 不动视口返回 false（与页签切换互不影响）。
 * 优先 setViewport：节点中心对齐视口中心且 k=1（不做自动缩放）；
 * 无 setViewport 的桩退回 focusOnNode，保持既有聚焦算法。
 */
export function focusNavigateTargetNode(
  store: NavigateFocusNodeStore,
  containerSize: { width: number; height: number },
  nodeId: string | undefined,
): boolean {
  if (!nodeId) return false;
  const node = store.getGraph().nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const w = node.size?.width ?? 200;
  const h = node.size?.height ?? 100;
  if (store.setViewport) {
    const nx = node.position?.x ?? 0;
    const ny = node.position?.y ?? 0;
    store.setViewport({
      x: containerSize.width / 2 - (nx + w / 2),
      y: containerSize.height / 2 - (ny + h / 2),
      k: 1,
    });
    return true;
  }
  store.focusOnNode(nodeId, containerSize, node.size?.width, node.size?.height, 400, 51);
  return true;
}

/**
 * 挂载期接线：注册 NAVIGATE_FOCUS_NODE_EVENT 监听 + 消费一次 pendingFocus。
 * 返回退订函数（useEffect cleanup 用）。
 */
export function subscribeNavigateFocusNode(
  store: NavigateFocusNodeStore,
  containerSize: { width: number; height: number },
): () => void {
  const onEvent = (e: Event) => {
    // 事件直达 = 本接收端在挂载态，同步清空暂存，防 remount 后对同一目标重复聚焦
    takePendingNavigateFocus();
    focusNavigateTargetNode(store, containerSize, (e as CustomEvent<NavigateFocusPayload>).detail?.nodeId);
  };
  window.addEventListener(NAVIGATE_FOCUS_NODE_EVENT, onEvent);
  // 刚切页签未挂载场景：挂载即取走暂存请求（取走即清空，不重复触发）
  const pending = takePendingNavigateFocus();
  if (pending?.nodeId) focusNavigateTargetNode(store, containerSize, pending.nodeId);
  return () => window.removeEventListener(NAVIGATE_FOCUS_NODE_EVENT, onEvent);
}
