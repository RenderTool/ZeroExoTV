/**
 * navigate-to-view —— 统一视图导航入口（2026-11-05 约定：发送到什么就跳转到什么）。
 *
 * 供所有"发送"动作调用（发送到画布 / 发送到导演台），避免各处各写一份路由逻辑。
 *
 * 签名：navigateToView('canvas' | 'director', { shotId?, nodeId?, projectId? })
 * - 'canvas'   → 切到画布页签；传 nodeId 时广播 NAVIGATE_FOCUS_NODE_EVENT，画布侧订阅后聚焦该节点
 *                （画布聚焦由画布线自己监听实现，本入口不直接操作画布 API）；
 * - 'director' → 切到导演台页签；传 shotId 时广播 NAVIGATE_FOCUS_SHOT_EVENT，
 *                导演台（workbench-tab-content）订阅后选中该片段并滚动可见，右侧预览跟随切换。
 *
 * 平滑性（不闪跳）：切页签只改 canvas-tab-store 指针；聚焦动作通过「pending 暂存 + 事件广播」
 * 双通道送达——目标页已挂载则事件立即生效；刚切换尚未挂载则目标页 mount 时调
 * takePendingNavigateFocus() 取走暂存请求（取走即清空，不重复触发）。
 *
 * 其他线（如 canvas-assets 的发送实现）只需：
 *   import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
 *   navigateToView('canvas', { nodeId, projectId });
 */

import { CANVAS_TAB_KEY, slotTabKey, useCanvasTabStore } from './canvas-tab-store.js';

export type NavigateViewKind = 'canvas' | 'director' | 'subject';

export interface NavigateToViewOptions {
  /** director：切换后要选中的片段 id（导演台选中 + 滚动可见 + 右侧预览跟随） */
  shotId?: string;
  /** canvas：切换后要聚焦的画布节点 id（由画布侧订阅 NAVIGATE_FOCUS_NODE_EVENT 处理） */
  nodeId?: string;
  /** subject：目标主体 rootId（主体库页面化层级） */
  rootId?: string;
  /** subject：目标状态 id（缺省 = 主体状态页） */
  stateId?: string;
  /** 目标项目 id（可选，仅供聚焦方校验上下文；与当前绑定不符时只切页不聚焦） */
  projectId?: string;
}

export interface NavigateFocusPayload {
  shotId?: string;
  nodeId?: string;
  rootId?: string;
  stateId?: string;
  projectId?: string;
}

/** 导演台片段聚焦事件（window CustomEvent，detail = NavigateFocusPayload） */
export const NAVIGATE_FOCUS_SHOT_EVENT = 'zeroexo:navigate-focus-shot';
/** 画布节点聚焦事件（window CustomEvent，detail = NavigateFocusPayload） */
export const NAVIGATE_FOCUS_NODE_EVENT = 'zeroexo:navigate-focus-node';
/** 主体库层级聚焦事件（window CustomEvent，detail = NavigateFocusPayload） */
export const NAVIGATE_FOCUS_SUBJECT_EVENT = 'zeroexo:navigate-focus-subject';

/** 目标页未挂载时的暂存请求（mount 后 takePendingNavigateFocus 取走，取走即清空） */
let pendingFocus: NavigateFocusPayload | null = null;

export function takePendingNavigateFocus(): NavigateFocusPayload | null {
  const p = pendingFocus;
  pendingFocus = null;
  return p;
}

export function navigateToView(view: NavigateViewKind, options: NavigateToViewOptions = {}): void {
  const tabStore = useCanvasTabStore.getState();
  if (view === 'canvas') {
    tabStore.activateTab(CANVAS_TAB_KEY);
  } else if (view === 'subject') {
    // 主体库：优先绑定 key（有载体）；无绑定 → 裸 storyboard 空态也算"到了主体库"
    tabStore.activateTab(slotTabKey('storyboard', tabStore.slotBindings) ?? 'storyboard');
  } else {
    // 导演台：优先绑定 key（有载体）；无绑定 → 裸 kind（导演台空态也算"到了导演台"）
    tabStore.activateTab(slotTabKey('workbench', tabStore.slotBindings) ?? 'workbench');
  }
  const hasSubjectFocus = view === 'subject' && Boolean(options.rootId);
  // canvas/director 的 payload 形状保持原样（不引入 rootId/stateId 键），避免改变既有订阅方契约
  const payload: NavigateFocusPayload = view === 'subject'
    ? { rootId: options.rootId, stateId: options.stateId, projectId: options.projectId }
    : {
        shotId: options.shotId,
        nodeId: options.nodeId,
        projectId: options.projectId,
      };
  const hasFocus = hasSubjectFocus || Boolean(options.shotId || options.nodeId);
  pendingFocus = hasFocus ? payload : null;
  // 双通道：目标页已挂载 → 事件直达；未挂载 → mount 时取 pending
  if (hasFocus) {
    const eventName = view === 'subject'
      ? NAVIGATE_FOCUS_SUBJECT_EVENT
      : view === 'director' ? NAVIGATE_FOCUS_SHOT_EVENT : NAVIGATE_FOCUS_NODE_EVENT;
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }
}
