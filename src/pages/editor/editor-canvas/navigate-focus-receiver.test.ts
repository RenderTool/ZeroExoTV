/**
 * navigate-focus-receiver 单测（2026-11-05）——统一导航入口画布侧接收端验收：
 * ① 事件直达：画布已挂载时 NAVIGATE_FOCUS_NODE_EVENT → focusOnNode(nodeId, …)；
 * ② 暂存消费：画布未挂载时 navigateToView 先存 pending，挂载订阅时取走并聚焦（取走即清空）；
 * ③ 双通道防重复：事件处理同步清空暂存，再次「挂载」不对同一目标重复聚焦；
 * ④ 目标节点不存在（已删/未建）→ 不动视口、不抛错。
 *
 * 用真实 navigateToView（真实 pending 模块态），store 用结构兼容桩（getGraph + focusOnNode）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  navigateToView,
  NAVIGATE_FOCUS_NODE_EVENT,
} from '@/features/canvas-tabs/navigate-to-view.js';
import {
  focusNavigateTargetNode,
  subscribeNavigateFocusNode,
  type NavigateFocusNodeStore,
} from './navigate-focus-receiver.js';

const NODE = { id: 'node-1', size: { width: 620, height: 348 } };

function makeStore(nodes: Array<{ id: string; size?: { width?: number; height?: number } }> = [NODE]) {
  const focusOnNode = vi.fn();
  const store: NavigateFocusNodeStore = {
    getGraph: () => ({ nodes }),
    focusOnNode: focusOnNode as unknown as NavigateFocusNodeStore['focusOnNode'],
  };
  return { store, focusOnNode };
}

const CONTAINER = { width: 1400, height: 900 };

describe('focusNavigateTargetNode：nodeId → 视口对准新节点', () => {
  it('真实 store（有 setViewport）→ 节点中心对齐视口中心且 zoom 固定 1', () => {
    const setViewport = vi.fn();
    const store: NavigateFocusNodeStore = {
      getGraph: () => ({ nodes: [{ id: 'node-1', position: { x: 700, y: 450 }, size: { width: 240, height: 320 } }] }),
      setViewport,
      focusOnNode: vi.fn(),
    };
    const ok = focusNavigateTargetNode(store, CONTAINER, 'node-1');
    expect(ok).toBe(true);
    expect(setViewport).toHaveBeenCalledTimes(1);
    // 节点中心 (700+120, 450+160)=(820,610) → 视口原点 = 容器中心(700,450) - 节点中心，k=1
    expect(setViewport).toHaveBeenCalledWith({ x: -120, y: -160, k: 1 });
    // 100% 缩放下节点中心落在视口中心，且完整可见（不因 zoom=1 跑出视口）
    const vp = setViewport.mock.calls[0]![0] as { x: number; y: number; k: number };
    expect(vp.k).toBe(1);
    const screenCenter = { x: (700 + 240 / 2) * vp.k + vp.x, y: (450 + 320 / 2) * vp.k + vp.y };
    expect(screenCenter).toEqual({ x: CONTAINER.width / 2, y: CONTAINER.height / 2 });
    expect(700 + vp.x).toBeGreaterThanOrEqual(0);
    expect(450 + vp.y).toBeGreaterThanOrEqual(0);
    expect(700 + 240 + vp.x).toBeLessThanOrEqual(CONTAINER.width);
    expect(450 + 320 + vp.y).toBeLessThanOrEqual(CONTAINER.height);
  });

  it('节点存在 → focusOnNode 收到 nodeId 与容器尺寸（视图移到该节点）', () => {
    const { store, focusOnNode } = makeStore();
    const ok = focusNavigateTargetNode(store, CONTAINER, 'node-1');
    expect(ok).toBe(true);
    expect(focusOnNode).toHaveBeenCalledTimes(1);
    expect(focusOnNode).toHaveBeenCalledWith('node-1', CONTAINER, 620, 348, 400, 51);
  });

  it('节点不存在 / 未传 nodeId → 不动视口返回 false', () => {
    const { store, focusOnNode } = makeStore();
    expect(focusNavigateTargetNode(store, CONTAINER, 'gone-node')).toBe(false);
    expect(focusNavigateTargetNode(store, CONTAINER, undefined)).toBe(false);
    expect(focusOnNode).not.toHaveBeenCalled();
  });
});

describe('subscribeNavigateFocusNode：事件直达 + 暂存消费双通道', () => {
  let unsubAll: Array<() => void>;

  beforeEach(() => {
    unsubAll = [];
  });

  afterEach(() => {
    unsubAll.forEach((un) => un());
    // 排空 navigate-to-view 模块级暂存，避免用例间串扰
    navigateToView('canvas', {});
  });

  it('画布已挂载：navigateToView 广播事件 → 监听器把 nodeId 传到 focusOnNode', () => {
    const { store, focusOnNode } = makeStore();
    unsubAll.push(subscribeNavigateFocusNode(store, CONTAINER));

    navigateToView('canvas', { nodeId: 'node-1' });

    expect(focusOnNode).toHaveBeenCalledTimes(1);
    expect(focusOnNode).toHaveBeenCalledWith('node-1', CONTAINER, 620, 348, 400, 51);
  });

  it('画布未挂载：navigateToView 先暂存，挂载订阅时取走 pending 并聚焦', () => {
    // 发送时画布接收端尚未挂载（无监听器）→ 只有暂存
    navigateToView('canvas', { nodeId: 'node-1' });

    const { store, focusOnNode } = makeStore();
    unsubAll.push(subscribeNavigateFocusNode(store, CONTAINER));

    expect(focusOnNode).toHaveBeenCalledTimes(1);
    expect(focusOnNode).toHaveBeenCalledWith('node-1', CONTAINER, 620, 348, 400, 51);
  });

  it('双通道防重复：事件直达后暂存被清空，再次「挂载」不重复聚焦同一目标', () => {
    // 第一次挂载（事件直达路径）
    const first = makeStore();
    unsubAll.push(subscribeNavigateFocusNode(first.store, CONTAINER));
    navigateToView('canvas', { nodeId: 'node-1' });
    expect(first.focusOnNode).toHaveBeenCalledTimes(1);

    // 卸载后重新挂载（remount 场景）：暂存已在事件处理时清空，不得重复聚焦
    unsubAll.splice(0).forEach((un) => un());
    const second = makeStore();
    unsubAll.push(subscribeNavigateFocusNode(second.store, CONTAINER));
    expect(second.focusOnNode).not.toHaveBeenCalled();
  });

  it('目标节点不存在 → 切页不聚焦、不抛错', () => {
    const { store, focusOnNode } = makeStore([NODE]);
    unsubAll.push(subscribeNavigateFocusNode(store, CONTAINER));

    expect(() => {
      window.dispatchEvent(
        new CustomEvent(NAVIGATE_FOCUS_NODE_EVENT, { detail: { nodeId: 'deleted-node' } }),
      );
    }).not.toThrow();
    expect(focusOnNode).not.toHaveBeenCalled();
  });
});
