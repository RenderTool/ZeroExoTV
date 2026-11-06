/**
 * subject-page-nav - 主体库页面化（2026-11-05）
 *
 * 三层：列表页 / 主体状态页 / 状态编辑页。本模块只放：
 * - 层级类型与基础状态保留 id；
 * - 按项目记忆（view-prefs.subjectPages，与 canvasTabs 同思路）；
 * - 「当前打开的状态」模块级上下文（资产发送时判断是否直达当前状态）；
 * - history marker 键（浏览器前进/后退还原层级用）。
 *
 * 不在这里写任何主体数据 —— 数据写入统一走 onChangeTree / linkSubjectStateMedia。
 */
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import type { SubjectPageLast } from '@/shared/view-prefs.js';

/** 基础状态的虚拟 stateId（不对应 states[]，只用于状态编辑页路由） */
export const SUBJECT_BASE_STATE_ID = '__base__';

/** history.state 上的命名空间键（不污染其它路由的 history 状态） */
export const SUBJECT_PAGE_HISTORY_KEY = '__subjectPages';

export type SubjectPageLevel =
  | { view: 'list' }
  | { view: 'subject'; rootId: string }
  | { view: 'state'; rootId: string; stateId: string };

/** 当前正停在某个状态编辑页时的发送目标（null = 不在状态页） */
export interface SubjectStateContext {
  projectId: string;
  rootId: string;
  stateId: string;
  subjectName: string;
  stateName: string;
}

let currentStateContext: SubjectStateContext | null = null;

/** 状态编辑页挂载时登记（同一时间只可能有一个） */
export function setCurrentSubjectStateContext(ctx: SubjectStateContext): void {
  currentStateContext = ctx;
}

/** 状态编辑页卸载时注销；只注销自己那一份，避免旧卸载清掉新登记 */
export function clearCurrentSubjectStateContext(projectId: string, rootId: string, stateId: string): void {
  const cur = currentStateContext;
  if (!cur) return;
  if (cur.projectId === projectId && cur.rootId === rootId && cur.stateId === stateId) {
    currentStateContext = null;
  }
}

export function getCurrentSubjectStateContext(): SubjectStateContext | null {
  return currentStateContext;
}

/** 层级 → 持久化形态（列表页不记忆） */
export function levelToLast(level: SubjectPageLevel): SubjectPageLast | null {
  if (level.view === 'list') return null;
  return {
    rootId: level.rootId,
    stateId: level.view === 'state' ? level.stateId : null,
  };
}

/** 持久化形态 → 层级（无记忆 = 列表页） */
export function lastToLevel(last: SubjectPageLast | null | undefined): SubjectPageLevel {
  if (!last) return { view: 'list' };
  if (last.stateId) return { view: 'state', rootId: last.rootId, stateId: last.stateId };
  return { view: 'subject', rootId: last.rootId };
}

/** 读某项目最后停留层级（刷新/重进项目恢复用） */
export function readRememberedSubjectLevel(projectId: string | null | undefined): SubjectPageLevel {
  if (!projectId) return { view: 'list' };
  const last = useViewPrefsStore.getState().subjectPages.lastByProject[projectId];
  return lastToLevel(last);
}

/** 写某项目最后停留层级（列表页 = 清除记忆） */
export function rememberSubjectLevel(projectId: string | null | undefined, level: SubjectPageLevel): void {
  if (!projectId) return;
  useViewPrefsStore.getState().setSubjectPageLast(projectId, levelToLast(level));
}

/** history marker（含 seq：同一项目多次导航也能区分） */
export interface SubjectPageHistoryMarker {
  projectId: string;
  rootId?: string;
  stateId?: string;
  seq: number;
}

export function markerToLevel(marker: SubjectPageHistoryMarker): SubjectPageLevel {
  if (!marker.rootId) return { view: 'list' };
  if (marker.stateId) return { view: 'state', rootId: marker.rootId, stateId: marker.stateId };
  return { view: 'subject', rootId: marker.rootId };
}

export function levelToMarker(projectId: string, level: SubjectPageLevel, seq: number): SubjectPageHistoryMarker {
  if (level.view === 'list') return { projectId, seq };
  if (level.view === 'state') return { projectId, rootId: level.rootId, stateId: level.stateId, seq };
  return { projectId, rootId: level.rootId, seq };
}
