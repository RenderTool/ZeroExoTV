/**
 * view-prefs - 全局视图偏好持久化 store（2026-11-04 需求定稿）
 *
 * 背景：资产库「公共资产 / 本项目」胶囊 Tab 与顶部四页签（剧本/主体库/导演台/画布）
 * 切换时会卸载重建内容组件，用户主动设置的视图偏好（如剧本编辑器「显示标签/隐藏标签」）
 * 只活在组件内 useState，切走即丢——切换后必须保留上次的视图偏好。
 *
 * 设计（全局一份，不按 Tab 分片——切回去仍保留上次设置）：
 * - 唯一 zustand store，单一 localStorage 键 `assetLibrary.prefs`
 *   （历史命名沿用资产库命名空间；内容含四个功能区的视图偏好切片）；
 * - 带 schemaVersion：结构升级时整体回默认，不读脏字段；
 * - 损坏容错：JSON 解析失败 / 版本不符 / 单字段类型错 → 该字段回默认值，绝不抛异常；
 * - 写入 try/catch（隐私模式 QuotaExceeded 等静默忽略）。
 *
 * 不持久化（数据上下文状态，非用户偏好）：scopeTab 当前段、selectedIds 选中集、
 * multiSelectEnabled 多选模式、page 分页、滚动位置、activeShotId/activeEpisodeId（随实体写回）。
 */

import { create } from 'zustand';
import {
  HIERARCHY_PANEL_DEFAULT_WIDTH,
  isLegacyHierarchyPanelWidth,
} from '@/features/hierarchy/components/panel-width.js';

export const VIEW_PREFS_STORAGE_KEY = 'assetLibrary.prefs';
export const VIEW_PREFS_SCHEMA_VERSION = 1;

// ===== 切片类型 =====

export type AssetLibraryViewMode = 'grid' | 'list';

export interface AssetLibraryViewPrefs {
  /** 网格/列表布局（当前仅 grid，预留） */
  viewMode: AssetLibraryViewMode;
  /** 分组筛选（素材 material / 剧本 script / 层级 hierarchy…） */
  activeGroup: string;
  /** 子类筛选（image/video/audio/text…；null=全部） */
  activeChild: string | null;
  /** 搜索词（需求：切回时保持原状态，故持久化） */
  search: string;
  /** 抽屉内层级类型筛选 */
  hierarchyTypeFilter: string;
}

export interface ScriptEditorViewPrefs {
  /** 剧本编辑器「显示标签」开关（曾出现的偏好丢失项） */
  showLabels: boolean;
}

export interface SubjectLibraryViewPrefs {
  /** 主体库类型筛选（'all' | character | scene | prop） */
  activeKind: string;
  /** 2026-11-05 主体库按集筛选：projectId → 上次选择的集号（null = 全集） */
  activeEpisodeByProject: Record<string, number | null>;
}

/** 主体库页面化（2026-11-05）：某项目最后停留的主体层级 */
export interface SubjectPageLast {
  rootId: string;
  /** null = 主体状态页；有值 = 状态编辑页 */
  stateId: string | null;
}

export interface SubjectPagesViewPrefs {
  /** projectId → 最后停留层级（与 canvasTabs.lastSlotByProject 同思路） */
  lastByProject: Record<string, SubjectPageLast>;
}

export interface WorkbenchViewPrefs {
  /** 导演台时间线缩放（px/s） */
  pixelsPerSecond: number;
  /** 2026-11-13 导演台按集切换：projectId → 上次停留的集 id（'__unassigned__' = 未分集） */
  activeEpisodeByProject: Record<string, string>;
}

/** 2026-11-05 刷新恢复页签：画布页签按项目记忆最后所在槽位（字面量与 canvas-tab-store 同形，shared 不反向依赖 features） */
export type CanvasTabLastSlot = 'script' | 'storyboard' | 'workbench' | 'canvas';

export interface CanvasTabsViewPrefs {
  /** projectId → 最后所在页签槽位 */
  lastSlotByProject: Record<string, CanvasTabLastSlot>;
  /**
   * Spec（征集#184）：projectId → 打开中的**副本画布 cid** 数组（顺序=页签序）。
   * 只存“开着哪些”，画布内容本身在 projects/<pid>/canvases/*.json（禁双权威）。
   */
  openCanvasesByProject: Record<string, string[]>;
}

/** 画布资产抽屉（HierarchyPanelSidebar）：宽度 = 用户手动拖拽值，0 = 未拖拽过（用推导默认值） */
export interface HierarchyViewPrefs {
  panelWidth: number;
}

/**
 * 2026-11-05 资产抽屉「素材」分组胶囊分段记忆（全局/本项目/主体/开源库，
 * 2026-11-06 用户指令：开源库排最后；「我的资产」改名「全局」与本项目/开源库同语义）。
 * 字面量与 canvas-assets 的 MaterialScopeTab 同形；shared 不反向依赖 features。
 */
export type CanvasDrawerScope = 'library' | 'project' | 'subject';

export interface CanvasDrawerViewPrefs {
  /** projectId → 上次所在分段 */
  materialScopeByProject: Record<string, CanvasDrawerScope>;
}

export interface ViewPrefsSlices {
  assetLibrary: AssetLibraryViewPrefs;
  scriptEditor: ScriptEditorViewPrefs;
  subjectLibrary: SubjectLibraryViewPrefs;
  subjectPages: SubjectPagesViewPrefs;
  workbench: WorkbenchViewPrefs;
  canvasTabs: CanvasTabsViewPrefs;
  hierarchy: HierarchyViewPrefs;
  canvasDrawer: CanvasDrawerViewPrefs;
}

// ===== 默认值 =====

export const DEFAULT_VIEW_PREFS: ViewPrefsSlices = {
  assetLibrary: {
    viewMode: 'grid',
    activeGroup: 'material',
    activeChild: null,
    search: '',
    hierarchyTypeFilter: 'all',
  },
  scriptEditor: { showLabels: true },
  subjectLibrary: { activeKind: 'all', activeEpisodeByProject: {} },
  subjectPages: { lastByProject: {} },
  workbench: { pixelsPerSecond: 40, activeEpisodeByProject: {} },
  canvasTabs: { lastSlotByProject: {}, openCanvasesByProject: {} },
  hierarchy: { panelWidth: 0 },
  canvasDrawer: { materialScopeByProject: {} },
};

// ===== 字段级校验（损坏容错：单字段类型错只回该字段默认，不牵连其他字段） =====

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function strOrNull(v: unknown, fallback: string | null): string | null {
  return typeof v === 'string' || v === null ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function positiveNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

function viewMode(v: unknown, fallback: AssetLibraryViewMode): AssetLibraryViewMode {
  return v === 'grid' || v === 'list' ? v : fallback;
}

/** 页签槽位合法值校验（损坏容错） */
function canvasTabLastSlot(v: unknown): CanvasTabLastSlot | null {
  return v === 'script' || v === 'storyboard' || v === 'workbench' || v === 'canvas' ? v : null;
}

/** 抽屉分段合法值校验（损坏容错） */
function canvasDrawerScope(v: unknown): CanvasDrawerScope | null {
  return v === 'library' || v === 'project' || v === 'subject' ? v : null;
}

/** 从任意解析结果修复出合法切片（逐字段兜底） */
function sanitize(raw: unknown): ViewPrefsSlices {
  const d = DEFAULT_VIEW_PREFS;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const al = (typeof r.assetLibrary === 'object' && r.assetLibrary !== null ? r.assetLibrary : {}) as Record<string, unknown>;
  const se = (typeof r.scriptEditor === 'object' && r.scriptEditor !== null ? r.scriptEditor : {}) as Record<string, unknown>;
  const sl = (typeof r.subjectLibrary === 'object' && r.subjectLibrary !== null ? r.subjectLibrary : {}) as Record<string, unknown>;
  const wb = (typeof r.workbench === 'object' && r.workbench !== null ? r.workbench : {}) as Record<string, unknown>;
  const ct = (typeof r.canvasTabs === 'object' && r.canvasTabs !== null ? r.canvasTabs : {}) as { lastSlotByProject?: unknown; openCanvasesByProject?: unknown; openSubCanvasesByProject?: unknown };
  const sp = (typeof r.subjectPages === 'object' && r.subjectPages !== null ? r.subjectPages : {}) as { lastByProject?: unknown };
  const hp = (typeof r.hierarchy === 'object' && r.hierarchy !== null ? r.hierarchy : {}) as Record<string, unknown>;
  const cd = (typeof r.canvasDrawer === 'object' && r.canvasDrawer !== null ? r.canvasDrawer : {}) as { materialScopeByProject?: unknown };
  const drawerScopeByProject: Record<string, CanvasDrawerScope> = {};
  if (cd.materialScopeByProject && typeof cd.materialScopeByProject === 'object') {
    for (const [projectId, scope] of Object.entries(cd.materialScopeByProject as Record<string, unknown>)) {
      const scopeOk = canvasDrawerScope(scope);
      if (scopeOk && projectId) drawerScopeByProject[projectId] = scopeOk;
    }
  }
  const subjectLastByProject: Record<string, SubjectPageLast> = {};
  if (sp.lastByProject && typeof sp.lastByProject === 'object') {
    for (const [projectId, value] of Object.entries(sp.lastByProject as Record<string, unknown>)) {
      const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
      if (!projectId || typeof v.rootId !== 'string' || !v.rootId) continue;
      const stateId = typeof v.stateId === 'string' && v.stateId ? v.stateId : null;
      subjectLastByProject[projectId] = { rootId: v.rootId, stateId };
    }
  }
  // 导演台按集切换记忆（2026-11-13）：只收非空字符串，脏条目丢弃
  const workbenchEpisodeByProject: Record<string, string> = {};
  if (wb.activeEpisodeByProject && typeof wb.activeEpisodeByProject === 'object') {
    for (const [projectId, value] of Object.entries(wb.activeEpisodeByProject as Record<string, unknown>)) {
      if (projectId && typeof value === 'string' && value) workbenchEpisodeByProject[projectId] = value;
    }
  }
  const lastSlotByProject: Record<string, CanvasTabLastSlot> = {};
  if (ct.lastSlotByProject && typeof ct.lastSlotByProject === 'object') {
    for (const [projectId, slot] of Object.entries(ct.lastSlotByProject as Record<string, unknown>)) {
      const slotOk = canvasTabLastSlot(slot);
      if (slotOk && projectId) lastSlotByProject[projectId] = slotOk;
    }
  }
  // Spec：打开中的副本画布 cid（只收非空字符串，脏条目丢弃不报错）；
  // 旧键名 openSubCanvasesByProject 作为读时兼容回落（不反向写回，避免两套名字长期共存）
  const openCanvasesByProject: Record<string, string[]> = {};
  const openCanvasSource = (ct.openCanvasesByProject && typeof ct.openCanvasesByProject === 'object')
    ? ct.openCanvasesByProject
    : ct.openSubCanvasesByProject;
  if (openCanvasSource && typeof openCanvasSource === 'object') {
    for (const [projectId, ids] of Object.entries(openCanvasSource as Record<string, unknown>)) {
      if (!projectId || !Array.isArray(ids)) continue;
      const clean = ids.filter((id): id is string => typeof id === 'string' && !!id);
      if (clean.length > 0) openCanvasesByProject[projectId] = clean;
    }
  }
  return {
    assetLibrary: {
      viewMode: viewMode(al.viewMode, d.assetLibrary.viewMode),
      activeGroup: str(al.activeGroup, d.assetLibrary.activeGroup),
      activeChild: strOrNull(al.activeChild, d.assetLibrary.activeChild),
      search: str(al.search, d.assetLibrary.search),
      hierarchyTypeFilter: str(al.hierarchyTypeFilter, d.assetLibrary.hierarchyTypeFilter),
    },
    scriptEditor: { showLabels: bool(se.showLabels, d.scriptEditor.showLabels) },
    subjectLibrary: {
      activeKind: str(sl.activeKind, d.subjectLibrary.activeKind),
      activeEpisodeByProject: subjectEpisodeByProject(sl.activeEpisodeByProject),
    },
    subjectPages: { lastByProject: subjectLastByProject },
    workbench: {
      pixelsPerSecond: positiveNumber(wb.pixelsPerSecond, d.workbench.pixelsPerSecond),
      activeEpisodeByProject: workbenchEpisodeByProject,
    },
    canvasTabs: { lastSlotByProject, openCanvasesByProject },
    hierarchy: { panelWidth: positiveNumber(hp.panelWidth, d.hierarchy.panelWidth) },
    canvasDrawer: { materialScopeByProject: drawerScopeByProject },
  };
}

/**
 * 从 localStorage 载入偏好（可单测）：
 * 解析失败 / schemaVersion 不符 / 结构非法 → 回默认值，绝不抛异常。
 * 抽屉宽度为历史默认值时做一次性迁移（改用当前默认值并回写；真实自定义值原样保留）。
 */
export function loadViewPrefs(): ViewPrefsSlices {
  try {
    const rawText = localStorage.getItem(VIEW_PREFS_STORAGE_KEY);
    if (!rawText) return DEFAULT_VIEW_PREFS;
    const parsed = JSON.parse(rawText) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_VIEW_PREFS;
    const envelope = parsed as Record<string, unknown>;
    if (envelope.schemaVersion !== VIEW_PREFS_SCHEMA_VERSION) return DEFAULT_VIEW_PREFS;
    const slices = sanitize(envelope.data);
    if (!isLegacyHierarchyPanelWidth(slices.hierarchy.panelWidth)) return slices;
    // 迁移幂等：回写后再次载入读到的是新默认值，不再命中历史默认值分支
    const migrated: ViewPrefsSlices = {
      ...slices,
      hierarchy: { panelWidth: HIERARCHY_PANEL_DEFAULT_WIDTH },
    };
    saveViewPrefs(migrated);
    return migrated;
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

/** 持久化（纯函数，可单测）；隐私模式等写入失败静默忽略 */
export function saveViewPrefs(slices: ViewPrefsSlices): void {
  try {
    localStorage.setItem(
      VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: VIEW_PREFS_SCHEMA_VERSION, data: slices }),
    );
  } catch { /* 隐私模式 / QuotaExceeded 忽略 */ }
}

// ===== Store =====

export interface ViewPrefsState extends ViewPrefsSlices {
  setAssetLibraryPrefs: (patch: Partial<AssetLibraryViewPrefs>) => void;
  setScriptShowLabels: (next: boolean) => void;
  setSubjectActiveKind: (next: string) => void;
  /** 2026-11-05 主体库按集筛选记忆（null = 全集） */
  setSubjectActiveEpisode: (projectId: string, episode: number | null) => void;
  setWorkbenchPixelsPerSecond: (next: number) => void;
  /** 2026-11-13 导演台按集切换记忆（projectId → 集 id；null = 清除） */
  setWorkbenchActiveEpisode: (projectId: string, episodeId: string | null) => void;
  /** 2026-11-05 刷新恢复页签：记录某项目最后所在页签槽位（projectId 为空忽略） */
  setCanvasTabLastSlot: (projectId: string, slot: CanvasTabLastSlot) => void;
  /** Spec：记录某项目打开中的副本画布 cid 列表 */
  setCanvasTabOpenCanvases: (projectId: string, cids: string[]) => void;
  /** 2026-11-05 主体库页面化：记录某项目最后停留的主体层级（null = 列表页） */
  setSubjectPageLast: (projectId: string, last: SubjectPageLast | null) => void;
  /** 记录用户手动拖拽后的抽屉宽度（<=0 忽略，回默认推导值） */
  setHierarchyPanelWidth: (next: number) => void;
  /** 2026-11-05 资产抽屉分段记忆（全局/本项目/主体/开源库；projectId 为空忽略） */
  setDrawerMaterialScope: (projectId: string, scope: CanvasDrawerScope) => void;
}

/** 主体库按集记忆：projectId → 集号（null 表示全集） */
function subjectEpisodeByProject(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [projectId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!projectId) continue;
    if (value === null) { out[projectId] = null; continue; }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[projectId] = Math.floor(value);
  }
  return out;
}

export const useViewPrefsStore = create<ViewPrefsState>()((set, get) => {
  /** 更新切片并落盘（始终全量写 envelope，保持单键原子性） */
  const commit = (patch: Partial<ViewPrefsSlices>): void => {
    set(patch);
    const s = get();
    saveViewPrefs({
      assetLibrary: s.assetLibrary,
      scriptEditor: s.scriptEditor,
      subjectLibrary: s.subjectLibrary,
      subjectPages: s.subjectPages,
      workbench: s.workbench,
      canvasTabs: s.canvasTabs,
      hierarchy: s.hierarchy,
      canvasDrawer: s.canvasDrawer,
    });
  };
  return {
    ...loadViewPrefs(),
    setAssetLibraryPrefs: (patch) => commit({ assetLibrary: { ...get().assetLibrary, ...patch } }),
    setScriptShowLabels: (next) => commit({ scriptEditor: { showLabels: next } }),
    setSubjectActiveKind: (next) => commit({
      subjectLibrary: { ...get().subjectLibrary, activeKind: next },
    }),
    setSubjectActiveEpisode: (projectId, episode) => {
      if (!projectId) return;
      const current = get().subjectLibrary;
      const nextValue = episode === null ? null : Math.floor(episode);
      if (episode !== null && !(nextValue! > 0)) return;
      commit({
        subjectLibrary: {
          ...current,
          activeEpisodeByProject: { ...current.activeEpisodeByProject, [projectId]: nextValue },
        },
      });
    },
    setWorkbenchPixelsPerSecond: (next) => {
      if (!(next > 0)) return;
      commit({ workbench: { ...get().workbench, pixelsPerSecond: next } });
    },
    setWorkbenchActiveEpisode: (projectId, episodeId) => {
      if (!projectId) return;
      const current = { ...get().workbench.activeEpisodeByProject };
      if (episodeId) current[projectId] = episodeId;
      else delete current[projectId];
      commit({ workbench: { ...get().workbench, activeEpisodeByProject: current } });
    },
    setCanvasTabLastSlot: (projectId, slot) => {
      if (!projectId) return;
      const slotOk = canvasTabLastSlot(slot);
      if (!slotOk) return;
      // 必须合并整个 slice（早期写成只传 lastSlotByProject 会清掉同片其它字段）
      commit({ canvasTabs: { ...get().canvasTabs, lastSlotByProject: { ...get().canvasTabs.lastSlotByProject, [projectId]: slotOk } } });
    },
    /** Spec：记录某项目打开中的副本画布页签（空数组也写，代表“用户全部关完了”） */
    setCanvasTabOpenCanvases: (projectId, cids) => {
      if (!projectId) return;
      const clean = Array.isArray(cids)
        ? cids.filter((id): id is string => typeof id === 'string' && !!id)
        : [];
      commit({
        canvasTabs: {
          ...get().canvasTabs,
          openCanvasesByProject: { ...get().canvasTabs.openCanvasesByProject, [projectId]: clean },
        },
      });
    },
    setHierarchyPanelWidth: (next) => {
      if (!(next > 0)) return;
      commit({ hierarchy: { panelWidth: next } });
    },
    setDrawerMaterialScope: (projectId, scope) => {
      if (!projectId) return;
      const scopeOk = canvasDrawerScope(scope);
      if (!scopeOk) return;
      commit({
        canvasDrawer: {
          materialScopeByProject: { ...get().canvasDrawer.materialScopeByProject, [projectId]: scopeOk },
        },
      });
    },
    setSubjectPageLast: (projectId, last) => {
      if (!projectId) return;
      const current = { ...get().subjectPages.lastByProject };
      if (!last) {
        delete current[projectId];
      } else {
        if (!last.rootId) return;
        const stateId = typeof last.stateId === 'string' && last.stateId ? last.stateId : null;
        current[projectId] = { rootId: last.rootId, stateId };
      }
      commit({ subjectPages: { lastByProject: current } });
    },
  };
});
