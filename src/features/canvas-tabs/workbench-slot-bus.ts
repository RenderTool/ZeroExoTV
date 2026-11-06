/**
 * workbench-slot-bus - 抽屉「发送到导演台当前片段」桥接（2026-11-05 需求定稿）
 *
 * 需求：抽屉里「发送到画布」的按钮要支持发送到导演台当前选中片段的插槽；
 * 槽位满时提示用户自行删除或替换。
 *
 * 设计（不碰 director-prompt-panel / workbench-tab-content——另一线在改）：
 * - 纯函数 computeSegmentInsert 收敛全部判定（可单测，零 UI 依赖）：
 *   无选中片段 → 'no-active-shot'；已在池内 → 'already-in-slot'（复用槽号，不新增）；
 *   该类型槽位满 → 'slot-full'（不入槽、不重排、不改正文，零变化拒绝）；
 *   合法 → 返回带 slotNo pin 的新引用与复算后的完整引用数组（调用方整体写回）。
 * - 入槽语义与提示词面板素材区加号完全一致：assignAssetSlots 唯一槽位分配、
 *   本片段从 1 连续编号（2026-11-05 公共素材 UI 下线：不再按公共池偏移，
 *   Picture1 = 第 1 格）、同资产复用槽号、pin 落库（移除中间槽位不重排）。
 * - 事件桥：抽屉（canvas-assets）emit 'zeroexo:workbench-add-ref'；导演台宿主（workbench-tab-content，
 *   由另一线接线）监听后对 activeShot 调 onShotChange({ references: next }) 落盘——
 *   与素材区加号同一条 persistRef 路径，槽位区缩略图/提示自然出现。
 */

import {
  DIRECTOR_ASSET_CAPS,
  DirectorSlotOverflowError,
  assignAssetSlots,
  type DirectorAssetRef,
  type DirectorModelTier,
} from '@/entities/director-params.js';
import type { Asset } from '@/features/asset-picker/index.js';

export const WORKBENCH_ADD_REF_EVENT = 'zeroexo:workbench-add-ref';

/** 抽屉「发送到导演台」事件载荷 */
export interface WorkbenchAddRefDetail {
  assetId: string;
  ref: DirectorAssetRef;
  projectId: string;
}

/** 资产 → 片段独有素材引用（与 director-prompt-panel.assetToDirectorRef 同一映射，单一事实源） */
export function assetToSegmentRef(a: Asset): DirectorAssetRef | null {
  const kind = a.data.kind;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') return null;
  return {
    id: a.id,
    kind,
    title: a.title,
    storageKey: 'storageKey' in a.data ? a.data.storageKey : undefined,
    url: kind === 'image' ? a.data.dataUrl : a.data.url,
    originScope: a.scope === 'project' ? 'project' : 'library',
  };
}

export type SegmentInsertVerdict =
  | { ok: true; ref: DirectorAssetRef; nextReferences: DirectorAssetRef[]; slotLabel: string }
  | { ok: false; reason: 'no-active-shot' | 'unsupported-kind' | 'already-in-slot' | 'slot-full'; cap?: number; used?: number };

/**
 * 判定：把片段外资产送入当前选中片段的槽位。
 * 零变化铁律：除 ok:true 外，任何失败路径都不得产出可写的引用数组。
 */
export function computeSegmentInsert(args: {
  asset: Asset;
  hasActiveShot: boolean;
  tier: DirectorModelTier;
  segmentAssets: DirectorAssetRef[];
}): SegmentInsertVerdict {
  if (!args.hasActiveShot) return { ok: false, reason: 'no-active-shot' };
  const ref = assetToSegmentRef(args.asset);
  if (!ref) return { ok: false, reason: 'unsupported-kind' };

  const caps = DIRECTOR_ASSET_CAPS[args.tier];

  // 池内已有（本片段池）→ 复用槽号，不新增占位
  try {
    const slots = assignAssetSlots({ shared: [], segment: args.segmentAssets, tier: args.tier });
    if (slots.byAssetId[ref.id]) return { ok: false, reason: 'already-in-slot' };
  } catch { /* 现状已溢出：继续按新增路径判满 */ }

  const kindUsed = args.segmentAssets.filter((a) => a.kind === ref.kind).length;
  if (kindUsed >= caps[ref.kind]) {
    return { ok: false, reason: 'slot-full', cap: caps[ref.kind], used: kindUsed };
  }

  // 先校验再落（不静默截断；溢出抛错→拒写）
  const nextSegment = [...args.segmentAssets, ref];
  try {
    const trial = assignAssetSlots({ shared: [], segment: nextSegment, tier: args.tier });
    const entry = trial.byAssetId[ref.id];
    if (!entry) return { ok: false, reason: 'slot-full', cap: caps[ref.kind], used: kindUsed };
    const pinned: DirectorAssetRef = { ...ref, slotNo: entry.slot };
    return {
      ok: true,
      ref: pinned,
      nextReferences: [...args.segmentAssets, pinned],
      slotLabel: entry.label,
    };
  } catch (err) {
    if (err instanceof DirectorSlotOverflowError) {
      return { ok: false, reason: 'slot-full', cap: err.cap, used: Math.min(kindUsed, err.cap) };
    }
    throw err;
  }
}

/** 抽屉侧发布入槽请求（宿主监听后写容器；无宿主监听时返回 false，供调用方兜底提示） */
export function emitWorkbenchAddRef(detail: WorkbenchAddRefDetail): boolean {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
  return window.dispatchEvent(new CustomEvent<WorkbenchAddRefDetail>(WORKBENCH_ADD_REF_EVENT, { detail }));
}
