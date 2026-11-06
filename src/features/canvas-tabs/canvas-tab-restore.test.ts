/**
 * canvas-tab-restore — 刷新恢复页签 + 统一导航入口（2026-11-05 验收）
 *
 * 需求：刷新页面后不回到剧本页签；发送到什么（画布/导演台）就跳转到什么。
 *
 * - 单测 ①：项目内切到导演台（或画布）后「刷新」（偏好从 localStorage 重新水合）→
 *   重进项目恢复到上次所在页签，而不是固定落回剧本；
 * - 单测 ②：不同项目各自独立记忆互不覆盖；无记忆的项目仍默认剧本（2026-11-04 硬约束不破坏）；
 *   且记忆真实落盘在 view-prefs 单键 localStorage（assetLibrary.prefs）；
 * - 单测 ③：navigateToView 统一导航入口——'director' 切导演台槽位（有绑定用绑定 key，
 *   无绑定落裸 kind 空态）、'canvas' 切画布；聚焦 payload 走「事件 + pending」双通道，
 *   pending 取走即清空（不重复触发）；无 shotId/nodeId 不产生聚焦请求。
 *
 * 纯 store 级测试（不渲染重组件）：activateTab 是纯读指针切换，无 DOM 依赖。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANVAS_TAB_KEY, DEFAULT_SLOT_ORDER, useCanvasTabStore } from './canvas-tab-store';
import { loadViewPrefs, useViewPrefsStore, VIEW_PREFS_STORAGE_KEY } from '../../shared/view-prefs.js';
import {
  NAVIGATE_FOCUS_NODE_EVENT,
  NAVIGATE_FOCUS_SHOT_EVENT,
  navigateToView,
  takePendingNavigateFocus,
  type NavigateFocusPayload,
} from './navigate-to-view';

beforeEach(() => {
  localStorage.clear();
  useCanvasTabStore.setState({
    tabs: [],
    activeTabKey: CANVAS_TAB_KEY,
    activeProjectId: null,
    slotOrder: [...DEFAULT_SLOT_ORDER],
    slotBindings: { script: null, storyboard: null, workbench: null },
  });
  useViewPrefsStore.setState({ canvasTabs: { lastSlotByProject: {}, openCanvasesByProject: {} } });
});

/** 模拟刷新：页面重载 → 偏好按线上同路径从 localStorage 重新水合、页签/绑定回到初始态 */
function simulateRefresh(): void {
  useViewPrefsStore.setState(loadViewPrefs());
  useCanvasTabStore.setState({
    activeTabKey: CANVAS_TAB_KEY,
    activeProjectId: null,
    slotBindings: { script: null, storyboard: null, workbench: null },
  });
}

/** 读 view-prefs 单键 localStorage 中 canvasTabs 记忆（验证真实落盘而非只改内存） */
function readPersistedLastSlot(): Record<string, string> {
  const envelope = JSON.parse(localStorage.getItem(VIEW_PREFS_STORAGE_KEY) ?? '{}') as {
    data?: { canvasTabs?: { lastSlotByProject?: Record<string, string> } };
  };
  return envelope.data?.canvasTabs?.lastSlotByProject ?? {};
}

describe('单测 ①：刷新恢复上次所在页签（不再固定落回剧本）', () => {
  it('切到导演台后刷新 → 重进项目仍在导演台', () => {
    // 首次进入项目：默认剧本（2026-11-04 硬约束，无记忆时的行为保持不变）
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('script:p-1');

    // editor-page 解析出导演台载体绑定，用户切到导演台
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-wb' });
    useCanvasTabStore.getState().activateTab('workbench:node-wb');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench:node-wb');

    // 刷新：偏好重新水合、绑定由 editor-page 重新解析，再进项目 → 恢复导演台
    simulateRefresh();
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-wb' });
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench:node-wb');
  });

  it('切到画布后刷新 → 重进项目仍在画布', () => {
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    useCanvasTabStore.getState().activateTab(CANVAS_TAB_KEY);
    expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');

    simulateRefresh();
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');
  });

  it('上次页签的绑定不存在 → 激活裸 kind 空态，不静默跳回剧本', () => {
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-gone' });
    useCanvasTabStore.getState().activateTab('workbench:node-gone');

    // 刷新后该绑定未再解析出来（对应节点不存在）→ 裸 'workbench' 页正常空态
    simulateRefresh();
    useCanvasTabStore.getState().activateProjectEntry('p-1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench');
  });
});

describe('单测 ②：按项目独立记忆 + 真实落盘', () => {
  it('不同项目各自记忆互不覆盖；无记忆项目默认剧本', () => {
    // 项目 A 记住画布
    useCanvasTabStore.getState().activateProjectEntry('p-a');
    useCanvasTabStore.getState().activateTab(CANVAS_TAB_KEY);
    // 项目 B 记住导演台
    useCanvasTabStore.getState().activateProjectEntry('p-b');
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-b' });
    useCanvasTabStore.getState().activateTab('workbench:node-b');

    // 记忆已真实写入 view-prefs 单键 localStorage（不是只改内存）
    expect(readPersistedLastSlot()).toEqual({ 'p-a': 'canvas', 'p-b': 'workbench' });

    // 刷新后各自恢复各自的页签
    simulateRefresh();
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-b' });
    useCanvasTabStore.getState().activateProjectEntry('p-a');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');
    useCanvasTabStore.getState().activateProjectEntry('p-b');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench:node-b');

    // 无记忆的新项目：默认剧本（老硬约束不被刷新恢复破坏）
    useCanvasTabStore.getState().activateProjectEntry('p-fresh');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('script:p-fresh');
  });
});

describe('单测 ③：navigateToView 统一导航入口（发送到什么就跳转什么）', () => {
  it("'director'：切到导演台槽位，shotId 走事件+pending 双通道，pending 取走即清空", () => {
    useCanvasTabStore.getState().setSlotBindings({ workbench: 'node-wb' });
    const seen: Array<NavigateFocusPayload | undefined> = [];
    const onShot = (e: Event): void => {
      seen.push((e as CustomEvent<NavigateFocusPayload>).detail);
    };
    window.addEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onShot);
    try {
      navigateToView('director', { shotId: 'seg-9', projectId: 'p-1' });
      expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench:node-wb');
      // 已挂载目标页 → 事件直达
      expect(seen).toEqual([{ shotId: 'seg-9', nodeId: undefined, projectId: 'p-1' }]);
      // 未挂载目标页 → pending 暂存，take 一次取走即清空（不重复触发）
      const pending = takePendingNavigateFocus();
      expect(pending).toEqual({ shotId: 'seg-9', nodeId: undefined, projectId: 'p-1' });
      expect(takePendingNavigateFocus()).toBeNull();
    } finally {
      window.removeEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onShot);
    }
  });

  it("'canvas'：切到画布页签，nodeId 走事件+pending 双通道", () => {
    const seen: Array<NavigateFocusPayload | undefined> = [];
    const onNode = (e: Event): void => {
      seen.push((e as CustomEvent<NavigateFocusPayload>).detail);
    };
    window.addEventListener(NAVIGATE_FOCUS_NODE_EVENT, onNode);
    try {
      navigateToView('canvas', { nodeId: 'node-1', projectId: 'p-1' });
      expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');
      expect(seen).toEqual([{ shotId: undefined, nodeId: 'node-1', projectId: 'p-1' }]);
      expect(takePendingNavigateFocus()).toEqual({ shotId: undefined, nodeId: 'node-1', projectId: 'p-1' });
    } finally {
      window.removeEventListener(NAVIGATE_FOCUS_NODE_EVENT, onNode);
    }
  });

  it("'director' 无绑定 → 裸 workbench 空态（也算到了导演台）；无聚焦参数 → 不产生事件与 pending", () => {
    const onShot = vi.fn();
    window.addEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onShot);
    try {
      navigateToView('director');
      expect(useCanvasTabStore.getState().activeTabKey).toBe('workbench');
      expect(onShot).not.toHaveBeenCalled();
      expect(takePendingNavigateFocus()).toBeNull();
    } finally {
      window.removeEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onShot);
    }
  });
});
