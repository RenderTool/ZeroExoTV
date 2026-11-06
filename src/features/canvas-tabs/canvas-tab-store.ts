/**
 * canvas-tab-store — 画布固定槽位页签状态（2026-11-04 单例槽位改造）
 *
 * 设计契约（新模型：一个项目 = 1 剧本 + 1 分镜 + 1 出片 + 1 画布的 1:1 流水线）：
 * - 页签 = 流水线上的**固定槽位视图**，不是可增删的文档：
 *   永远只有四个槽位（剧本/分镜/出片/画布），无关闭/删除入口、无"新建页签"。
 * - 槽位顺序默认 [剧本, 分镜, 出片, 画布]，用户可拖拽重排，顺序持久化到 localStorage。
 * - 槽位 → 内容的绑定（slotBindings）由 editor-page 依据项目数据解析：
 *   script → 项目 id（剧本实体）；storyboard/workbench → 画布图中第一个对应类型节点 id（只读图指针）。
 * - openTab 保留旧签名但语义改为"激活槽位"：任意 script/storyboard/workbench 打开请求
 *   一律重定向到对应槽位（幂等）。
 * - 2026-11-04 槽位供应整体下线：页签激活是纯读指针切换，**绝不创建节点/写图**；
 *   无绑定时激活裸 kind key（'storyboard'/'workbench'/'script'），由页级内容组件渲染空态，
 *   初始化节点只能由空态里的显式按钮触发（用户动作），不在激活链路内。
 * - 页签只保存「描述」，不保存编辑器实例：编辑器由 editor-page 的页签内容层挂载，
 *   画布区始终挂载（display:none 隐藏），避免 WebGL/canvas 实例与视口丢失（调研结论）。
 */

import { create } from 'zustand';
import { useViewPrefsStore } from '../../shared/view-prefs.js';

/** 画布底层页签的固定 key（槽位之一，不可关闭） */
export const CANVAS_TAB_KEY = 'canvas';

/**
 * 资源类型（历史数据契约，勿改）：
 * - script 剧本 / storyboard 分镜 / workbench 出片（工作台）/ plan 制作计划
 * 2026-11-04 起这些 kind 不再表示"可增删的文档"，而是四个固定槽位中的三个内容槽位。
 */
export type CanvasTabKind = 'script' | 'storyboard' | 'workbench' | 'plan';

/** 固定槽位种类（canvas = 画布槽位） */
export type FixedSlotKind = 'script' | 'storyboard' | 'workbench' | 'canvas';

/** 默认槽位顺序：①剧本 ②分镜 ③出片 ④画布（用户可拖拽重排，持久化） */
export const DEFAULT_SLOT_ORDER: readonly FixedSlotKind[] = ['script', 'storyboard', 'workbench', 'canvas'];

/** 槽位顺序持久化 key（localStorage，本地级持久化） */
const SLOT_ORDER_STORAGE_KEY = 'zeroexo:canvas-tab-slot-order';

function loadSlotOrder(): FixedSlotKind[] {
  try {
    const raw = localStorage.getItem(SLOT_ORDER_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SLOT_ORDER];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_SLOT_ORDER];
    const valid = parsed.filter((k): k is FixedSlotKind =>
      k === 'script' || k === 'storyboard' || k === 'workbench' || k === 'canvas');
    // 完整性校验：四个槽位必须齐全（防旧版本/脏数据缺槽位）
    if (valid.length !== DEFAULT_SLOT_ORDER.length) return [...DEFAULT_SLOT_ORDER];
    return valid;
  } catch {
    return [...DEFAULT_SLOT_ORDER];
  }
}

function persistSlotOrder(order: FixedSlotKind[]): void {
  try { localStorage.setItem(SLOT_ORDER_STORAGE_KEY, JSON.stringify(order)); } catch { /* 隐私模式等忽略 */ }
}

export interface CanvasTab {
  key: string;
  kind: CanvasTabKind;
  /** 资源 id（剧本=资产 id；分镜/出片=节点 id） */
  id: string;
  title: string;
}

/** 幂等 key：`kind:id`（历史数据契约，勿改） */
export function buildTabKey(kind: CanvasTabKind, id: string): string {
  return `${kind}:${id}`;
}

/** 槽位 → 内容绑定（由 editor-page 解析项目数据后写入；null = 该槽位暂无内容载体） */
export interface SlotBindings {
  script: string | null;
  storyboard: string | null;
  workbench: string | null;
}

/**
 * 项目内“画布副本”页签（征集#184 / Spec，2026-11-06）。
 *
 * 模型定稿：**画布是项目的一等挂载物，1:N**——1 号主画布就是固定槽位 `canvas`（不可关），
 * 其余副本以**同一层并排标签**存在且可 ×。
 * key = `canvas:<cid>`（与 1 号的 `canvas` 不冲突：slotTabKey('canvas') 永远返回裸 'canvas'）。
 * 幂等与关闭回退规则沿用线上 `zeroexo_front` 资源页签契约。
 */
export interface OpenCanvasTab {
  key: string;
  /** 画布 id（entities/canvas-store 的 cid；副本=sc…，1 号不走这里） */
  cid: string;
  title: string;
}

export const CANVAS_TAB_PREFIX = 'canvas:';

/** 副本画布页签 key */
export function canvasTabKeyFor(cid: string): string {
  return `${CANVAS_TAB_PREFIX}${cid}`;
}

/** 是否副本画布页签 key（editor-page 用它排除“剧本/导演台内容层”，并判断当前看的是哪块画布） */
export function isOpenCanvasTabKey(key: string): boolean {
  return key.startsWith(CANVAS_TAB_PREFIX) && key.length > CANVAS_TAB_PREFIX.length;
}

/** 从页签 key 取 cid（非副本页签返回 null） */
export function openCanvasTabCid(key: string): string | null {
  return isOpenCanvasTabKey(key) ? key.slice(CANVAS_TAB_PREFIX.length) : null;
}

/**
 * 图片编辑页签（2026-11-06 用户定稿：像 Photoshop 一样用独立页签编辑该图）：
 * key = `image:<nodeId>`，页面自带工具栏（裁剪/分割/局部遮罩），输出后回到画布。
 */
export interface OpenImageTab {
  key: string;
  nodeId: string;
  title: string;
  /** 打开时直接进入的工具（点节点胶囊哪个按钮就进哪个） */
  mode?: 'crop' | 'split' | 'maskEdit';
}

export const IMAGE_TAB_PREFIX = 'image:';

/** 图片编辑页签 key */
export function imageTabKeyFor(nodeId: string): string {
  return `${IMAGE_TAB_PREFIX}${nodeId}`;
}

/** 是否图片编辑页签 key */
export function isImageTabKey(key: string): boolean {
  return key.startsWith(IMAGE_TAB_PREFIX) && key.length > IMAGE_TAB_PREFIX.length;
}

/** 从图片编辑页签 key 取 nodeId（非图片页签返回 null） */
export function imageTabNodeId(key: string): string | null {
  return isImageTabKey(key) ? key.slice(IMAGE_TAB_PREFIX.length) : null;
}

function isCanvasCopyKey(key: string): boolean {
  return isOpenCanvasTabKey(key);
}

/** 由绑定推导槽位页签 key（无绑定返回 null） */
export function slotTabKey(kind: FixedSlotKind, bindings: SlotBindings): string | null {
  if (kind === 'canvas') return CANVAS_TAB_KEY;
  const id = bindings[kind];
  return id ? buildTabKey(kind, id) : null;
}

/**
 * 被显式删除的画布副本 cid：删除流程先标记，再关页签，
 * 避免「关闭页签 → 切换文档」时把刚删掉的文件又写回来（2026-11-06）。
 */
const discardedCanvasCids = new Set<string>();

export function markCanvasDiscarded(cid: string): void {
  discardedCanvasCids.add(cid);
}

export function unmarkCanvasDiscarded(cid: string): void {
  discardedCanvasCids.delete(cid);
}

export function isCanvasDiscarded(cid: string): boolean {
  return discardedCanvasCids.has(cid);
}

/**
 * 页签 → Agent 关注点映射（Plan#55 Phase B，2026-08-31）：
 * 打开/激活某页签即通知 Agent「用户当前关注 X」（仅声明，不读数据；
 * 用户明确修改意图后由 Agent 走 read_* 工具正式读节点）。
 */
export function syncFocusTarget(_tab: CanvasTab | null): void {
  // 本地版（Plan#83）：无内置 Agent，焦点声明链路已删；保留签名供页签逻辑调用
  void _tab;
}

/** 画布页签激活 → 关注画布（无节点上下文） */
export function syncFocusCanvas(): void {
  // 本地版（Plan#83）：无 Agent 焦点声明
}

export interface CanvasTabState {
  /** @deprecated 单例槽位模型下不再维护可增删的资源页签列表；保留字段仅为兼容旧调用，恒为空数组 */
  tabs: CanvasTab[];
  activeTabKey: string;
  /** 固定槽位顺序（可拖拽重排，localStorage 持久化） */
  slotOrder: FixedSlotKind[];
  /** 槽位 → 内容绑定（editor-page 解析项目数据写入；script=项目 id，storyboard/workbench=只读图指针） */
  slotBindings: SlotBindings;
  /**
   * 页签内容层挂载点（Plan#50）：由 editor-page 的页签内容容器注册，
   * 节点组件（如分镜节点）通过 createPortal 把编辑器渲染到这里，
   * 从而数据/回调仍留在节点组件内，无需把编辑器状态上提。
   */
  contentHost: HTMLElement | null;
  setContentHost: (el: HTMLElement | null) => void;
  /** 画布容器（2026-08-30 征集 #110）：由 editor-page 注册，节点内浮层（如主体库复用 NodeGenerateDock）portal 到此处获得画布坐标系 */
  canvasHost: HTMLElement | null;
  setCanvasHost: (el: HTMLElement | null) => void;
  /** 打开（或复用激活）一个资源页签——2026-11-04 起语义为"激活对应槽位"（重定向，幂等，不再新建页签） */
  openTab: (input: { kind: CanvasTabKind; id: string; title?: string }) => void;
  /** 激活页签（纯读指针切换；接受 'canvas' 与 script|storyboard|workbench 的裸 kind 或 kind:id key；绝不写图） */
  activateTab: (key: string) => void;
  /** @deprecated 固定槽位不可关闭；保留签名兼容旧调用，语义退化为"切回画布槽位" */
  closeTab: (key: string) => void;
  /** 槽位拖拽排序（from→to，四个固定槽位整体参与，顺序持久化） */
  reorderSlots: (from: number, to: number) => void;
  /** 写入槽位绑定（增量合并） */
  setSlotBindings: (patch: Partial<SlotBindings>) => void;
  /**
   * 项目进入默认页签（2026-11-04 硬约束：进入项目默认打开「剧本」，不是画布）：
   * 绑定剧本实体（projectId）并激活剧本页签。取值顺序：首次进入=剧本（editor-page
   * 进入项目 effect 调本方法）；同会话内用户切换页签不被覆盖（effect 按 canvasId 去重）；
   * 2026-11-05 起跨会话记忆：activeTabKey 按项目持久化（view-prefs.canvasTabs.lastSlotByProject，
   * 刷新页面不回到剧本）——刷新/重进恢复到上次所在页签；
   * 上次页签对应绑定不存在时激活裸 kind（渲染该页正常空态），不静默跳回剧本。
   */
  activateProjectEntry: (projectId: string) => void;
  /** 离开画布时复位：回画布槽位并清空绑定（下个项目的绑定由 editor-page 重新解析） */
  closeAllTabs: () => void;
  /** 2026-11-05 页签按项目记忆：当前进入的项目 id（runtime，activateProjectEntry 写入） */
  activeProjectId: string | null;
  /**
   * 打开中的副本画布页签（1 号不在这里，它就是固定槽位 `canvas`）。
   * 顺序=打开序（可拖拽重排），集合同步写 view-prefs.canvasTabs.openCanvasesByProject（刷新恢复）。
   */
  openCanvasTabs: OpenCanvasTab[];
  /** 打开（或复用激活）一个副本画布页签；同一 cid 幂等，只激活并刷新标题 */
  openCanvasTab: (input: { cid: string; title?: string }) => void;
  /** 关闭副本页签：只关页签不删数据；关的是当前激活项 → 回退左侧相邻 → 无剩余 → 回 1 号画布 */
  closeCanvasTab: (key: string) => void;
  /** 副本页签拖拽排序（from→to，仅副本参与） */
  reorderCanvasTabs: (from: number, to: number) => void;
  /** 改名/换标题后同步页签（标题唯一源 = canvas-store 的画布元数据） */
  renameCanvasTab: (cid: string, title: string) => void;
  /** 进入项目时按 view-prefs 恢复打开集合（失效条目过滤由调用方负责） */
  restoreCanvasTabs: (tabs: OpenCanvasTab[]) => void;
  /** 打开中的图片编辑页签（Photoshop 式文档页签，关掉即回画布） */
  openImageTabs: OpenImageTab[];
  /** 打开（或复用激活）图片编辑页签；同一 nodeId 幂等，只更新工具与标题 */
  openImageTab: (input: { nodeId: string; title?: string; mode?: OpenImageTab['mode'] }) => void;
  /** 关闭图片编辑页签：只关页签；关的是当前激活项 → 回画布 */
  closeImageTab: (key: string) => void;
}

/** 把当前项目的副本画布打开集写进 view-prefs（无活跃项目则忽略） */
function recordOpenCanvases(get: () => CanvasTabState): void {
  const { activeProjectId, openCanvasTabs } = get();
  if (!activeProjectId) return;
  useViewPrefsStore.getState().setCanvasTabOpenCanvases(
    activeProjectId,
    openCanvasTabs.map((t) => t.cid),
  );
}

/** 2026-11-05 刷新恢复页签：进入项目期间的用户切页动作 → 按项目记入 view-prefs（无活跃项目则忽略） */
function recordLastSlot(
  get: () => CanvasTabState,
  slot: 'script' | 'storyboard' | 'workbench' | 'canvas',
): void {
  const projectId = get().activeProjectId;
  if (!projectId) return;
  useViewPrefsStore.getState().setCanvasTabLastSlot(projectId, slot);
}

export const useCanvasTabStore = create<CanvasTabState>((set, get) => ({
  tabs: [],
  activeTabKey: CANVAS_TAB_KEY,
  activeProjectId: null,
  slotOrder: loadSlotOrder(),
  slotBindings: { script: null, storyboard: null, workbench: null },
  openCanvasTabs: [],
  openImageTabs: [],
  contentHost: null,
  setContentHost: (el) => set({ contentHost: el }),
  canvasHost: null,
  setCanvasHost: (el) => set({ canvasHost: el }),

  openTab: ({ kind }) => {
    // 单例槽位语义：任何"打开某资源"请求一律重定向到该类型的固定槽位（忽略传入 id/title）。
    // 2026-11-04 供应下线：无绑定时激活裸 kind key，由页级内容组件渲染空态——激活链路绝不写图。
    if (kind === 'storyboard' || kind === 'workbench' || kind === 'script') {
      const key = slotTabKey(kind, get().slotBindings) ?? kind;
      get().activateTab(key);
      return;
    }
    // plan 等历史 kind：槽位模型下无对应槽位，切回画布
    get().activateTab(CANVAS_TAB_KEY);
  },

  activateTab: (key) => {
    const { activeTabKey } = get();
    if (key === CANVAS_TAB_KEY) {
      if (activeTabKey !== key) set({ activeTabKey: key });
      recordLastSlot(get, 'canvas');
      syncFocusCanvas();
      return;
    }
    // 副本画布页签（Spec）：只能激活已打开的项（用户点 × 关完不得自动重开）。
    // 不写 lastSlotByProject——该记忆只存四个固定槽位（副本页签的恢复走 openCanvasesByProject）。
    if (isCanvasCopyKey(key)) {
      if (!get().openCanvasTabs.some((t) => t.key === key)) return;
      if (activeTabKey !== key) set({ activeTabKey: key });
      return;
    }
    // 图片编辑页签：只能激活已打开的项（关掉后不自动重开）
    if (isImageTabKey(key)) {
      if (!get().openImageTabs.some((t) => t.key === key)) return;
      if (activeTabKey !== key) set({ activeTabKey: key });
      return;
    }
    // 2026-11-04 供应下线：页签不再以"画布上存在绑定节点"为前提——
    // 裸 kind（无载体，页级组件渲染空态）与 kind:id（有载体，节点 portal 供内容）均为合法 key；
    // 激活只是切换指针，不创建节点、不写图。其余非法 key 一律忽略。
    if (!/^(script|storyboard|workbench)(:.+)?$/.test(key)) return;
    if (activeTabKey === key) return;
    set({ activeTabKey: key });
    // 2026-11-05 刷新恢复页签：按项目记录用户最后所在页签（view-prefs 持久化）
    recordLastSlot(get, key.split(':')[0] as 'script' | 'storyboard' | 'workbench');
  },

  closeTab: (key) => {
    // 固定槽位不可关闭：仅当"关闭"的恰是当前激活槽位时，退化为切回画布槽位（兼容旧调用）
    if (get().activeTabKey === key) {
      set({ activeTabKey: CANVAS_TAB_KEY });
      syncFocusCanvas();
    }
  },

  reorderSlots: (from, to) => {
    const { slotOrder } = get();
    if (from === to || from < 0 || from >= slotOrder.length || to < 0 || to >= slotOrder.length) return;
    const next = [...slotOrder];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    persistSlotOrder(next);
    set({ slotOrder: next });
  },

  setSlotBindings: (patch) => set({ slotBindings: { ...get().slotBindings, ...patch } }),

  openImageTab: ({ nodeId, title, mode }) => {
    if (!nodeId) return;
    const key = imageTabKeyFor(nodeId);
    const existing = get().openImageTabs.find((t) => t.key === key);
    if (existing) {
      // 幂等：已打开 → 只激活；点不同工具进来时切到那个工具
      set({
        activeTabKey: key,
        openImageTabs: get().openImageTabs.map((t) => (t.key === key
          ? { ...t, title: title?.trim() || t.title, mode: mode ?? t.mode }
          : t)),
      });
      return;
    }
    set({
      openImageTabs: [...get().openImageTabs, { key, nodeId, title: title?.trim() || '图片编辑', mode }],
      activeTabKey: key,
    });
  },

  closeImageTab: (key) => {
    const { openImageTabs, activeTabKey } = get();
    if (!openImageTabs.some((t) => t.key === key)) return;
    set({ openImageTabs: openImageTabs.filter((t) => t.key !== key) });
    if (activeTabKey === key) {
      set({ activeTabKey: CANVAS_TAB_KEY });
      syncFocusCanvas();
    }
  },

  openCanvasTab: ({ cid, title }) => {
    if (!cid) return;
    const key = canvasTabKeyFor(cid);
    const existing = get().openCanvasTabs.find((t) => t.key === key);
    if (existing) {
      // 幂等：已打开 → 只激活；标题跟随画布元数据重命名（与线上 openTab 同一规则）
      set({
        activeTabKey: key,
        openCanvasTabs: title && title !== existing.title
          ? get().openCanvasTabs.map((t) => (t.key === key ? { ...t, title } : t))
          : get().openCanvasTabs,
      });
      return;
    }
    const created: OpenCanvasTab = { key, cid, title: title?.trim() || '画布副本' };
    set({ openCanvasTabs: [...get().openCanvasTabs, created], activeTabKey: key });
    recordOpenCanvases(get);
  },

  closeCanvasTab: (key) => {
    const { openCanvasTabs, activeTabKey } = get();
    const idx = openCanvasTabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    const next = openCanvasTabs.filter((t) => t.key !== key);
    set({ openCanvasTabs: next });
    recordOpenCanvases(get);
    if (activeTabKey !== key) return;
    // 关的是当前激活项 → 回退左侧相邻（线上契约），无剩余 → 回 1 号画布槽位
    const fallback = next[idx - 1] ?? next[idx] ?? null;
    set({ activeTabKey: fallback ? fallback.key : CANVAS_TAB_KEY });
    if (!fallback) syncFocusCanvas();
  },

  reorderCanvasTabs: (from, to) => {
    const { openCanvasTabs } = get();
    if (from === to || from < 0 || from >= openCanvasTabs.length || to < 0 || to >= openCanvasTabs.length) return;
    const next = [...openCanvasTabs];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    set({ openCanvasTabs: next });
    recordOpenCanvases(get);
  },

  renameCanvasTab: (cid, title) => {
    const key = canvasTabKeyFor(cid);
    const next = get().openCanvasTabs.map((t) => (t.key === key ? { ...t, title } : t));
    if (next.some((t, i) => t.title !== get().openCanvasTabs[i]?.title)) set({ openCanvasTabs: next });
  },

  restoreCanvasTabs: (tabs) => {
    // 只恢复“开着哪些”，不抢用户当前页签（刷新后 activeTabKey 已由 activateProjectEntry 定好）
    set({ openCanvasTabs: tabs.filter((t) => !!t.cid) });
  },

  activateProjectEntry: (projectId) => {
    set({ slotBindings: { ...get().slotBindings, script: projectId }, activeProjectId: projectId });
    // 2026-11-05 刷新恢复页签：优先恢复该项目上次所在页签；无记忆 → 默认剧本（2026-11-04 硬约束）
    const last = useViewPrefsStore.getState().canvasTabs.lastSlotByProject[projectId];
    if (last === 'canvas') {
      get().activateTab(CANVAS_TAB_KEY);
      return;
    }
    if (last === 'storyboard' || last === 'workbench') {
      // 绑定未解析（对应节点不存在）→ 裸 kind：该页渲染正常空态，不静默跳回剧本
      get().activateTab(slotTabKey(last, get().slotBindings) ?? last);
      return;
    }
    get().activateTab(`script:${projectId}`);
  },

  closeAllTabs: () => {
    set({
      tabs: [],
      activeTabKey: CANVAS_TAB_KEY,
      slotBindings: { script: null, storyboard: null, workbench: null },
      activeProjectId: null,
      // 离开画布时副本页签也清空（打开集合已按项目写进 view-prefs，下次进入恢复）；图片编辑页签一并清空
      openCanvasTabs: [],
      openImageTabs: [],
    });
    syncFocusCanvas();
  },
}));

/** 非 hook 场景（事件总线/命令层）打开页签——2026-11-04 起语义为"激活对应槽位" */
export function openCanvasTab(input: { kind: CanvasTabKind; id: string; title?: string }): void {
  useCanvasTabStore.getState().openTab(input);
}
