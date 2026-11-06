/**
 * workbench-send - 抽屉「发送到导演台当前片段」状态桥（2026-11-05 约定）
 *
 * 抽屉与导演台分属不同 React 子树，选中片段/公共池/预设 tier 都活在导演台宿主的
 * useRef/useState 里。为了让抽屉在判定前拿到同一份事实源，宿主每次渲染后
 * 调用 syncWorkbenchSendContext 发布快照；抽屉 sendToWorkbenchShot 据此走
 * computeSegmentInsert 判定（唯一槽位分配 assignAssetSlots，不另造一套）。
 */

import { DIRECTOR_ASSET_CAPS, type DirectorAssetRef, type DirectorModelTier } from '@/entities/director-params.js';

export interface WorkbenchSendContext {
  /** 宿主项目 id：入槽事件的目标（发送目标 = 当前导演台宿主，与资产自身归属无关）。
   *  开源库导入资产 scope='library' 无 projectId，若按资产归属发事件会被宿主
   *  projectId 过滤静默丢弃（2026-11-05 修复：事件 projectId 一律取本快照） */
  projectId: string;
  /** 当前选中/激活片段 id；无片段或导演台未打开时为 null */
  activeShotId: string | null;
  /** 当前选中片段的独有素材引用（槽号本片段从 1 连续编号；公共素材 UI 已下线） */
  segmentAssets: DirectorAssetRef[];
  /** 当前模型预设（槽位上限口径） */
  tier: DirectorModelTier;
}

let ctx: WorkbenchSendContext | null = null;

/** 宿主（workbench-tab-content）每次渲染后发布快照 */
export function syncWorkbenchSendContext(next: WorkbenchSendContext | null): void {
  ctx = next;
}

/** 抽屉侧读取；导演台未打开/未渲染时为 null */
export function getWorkbenchSendContext(): WorkbenchSendContext | null {
  return ctx;
}

export interface WorkbenchSendVerdict {
  ok: boolean;
  /** 面向用户的提示文案（ok=true 时为入槽成功提示） */
  message: string;
  /** 槽位满时给出可执行提示（上限/已用） */
  reason?: 'no-active-shot' | 'unsupported-kind' | 'already-in-slot' | 'slot-full';
}

const KIND_LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频' };

/** 抽屉侧统一提示组装（入槽/复用/满员/无选中），文案口径唯一出处 */
export function verdictToMessage(v: {
  ok: boolean;
  reason?: string;
  slotLabel?: string;
  kind?: string;
  cap?: number;
  used?: number;
}): WorkbenchSendVerdict {
  if (v.ok) {
    return { ok: true, message: `已送入当前片段素材池（${v.slotLabel ?? ''}）` };
  }
  switch (v.reason) {
    case 'no-active-shot':
      return { ok: false, reason: 'no-active-shot', message: '请先在导演台选中一个片段' };
    case 'unsupported-kind':
      return { ok: false, reason: 'unsupported-kind', message: '该素材类型不支持入导演台槽位' };
    case 'already-in-slot':
      return { ok: false, reason: 'already-in-slot', message: '该资产已在当前片段素材池，复用原槽位' };
    case 'slot-full':
      return {
        ok: false, reason: 'slot-full',
        message: `${KIND_LABEL[v.kind ?? 'image'] ?? '素材'}槽位已满（${v.used}/${v.cap}），请先在素材区移除或替换一个素材`,
      };
    default:
      return { ok: false, message: '无法送入导演台' };
  }
}

export { DIRECTOR_ASSET_CAPS };
