/**
 * 导演台槽位/参数纯函数最小移植（来源：src/entities/director-params.ts）。
 * 浏览器包不可被 Node import，这里只移植 MCP M1 需要的语义：
 * - 公共（shared）资产占槽位 1..K，片段（segment）资产从 K+1 起续排；
 * - 超过 MAX_ASSET_SLOTS 抛 DirectorSlotOverflowError；
 * - durationToFrames：17k+5 帧吸附（与前端一致的经验规则）。
 */

import { McpError } from "../errors.js";

export const MAX_ASSET_SLOTS = 8;

export interface DirectorAssetRef {
  slot: number;
  storageKey: string;
  name?: string;
  source: "shared" | "segment";
  subjectId?: string;
}

export class DirectorSlotOverflowError extends Error {
  constructor(needed: number) {
    super(`资产槽位溢出：需要第 ${needed} 槽，上限 ${MAX_ASSET_SLOTS}`);
    this.name = "DirectorSlotOverflowError";
  }
}

/**
 * 为 incoming 分配槽位号：
 * - shared 资产：占用 1..sharedCount 中的空槽；
 * - segment 资产：从 sharedCount+1 起续排，取当前最大槽位 +1。
 */
export function assignAssetSlots(
  existing: DirectorAssetRef[],
  incoming: Omit<DirectorAssetRef, "slot">,
  sharedCount: number,
): DirectorAssetRef {
  let slot: number;
  if (incoming.source === "shared") {
    const used = new Set(existing.filter((r) => r.source === "shared").map((r) => r.slot));
    slot = 0;
    for (let i = 1; i <= Math.max(sharedCount, 1); i++) {
      if (!used.has(i)) {
        slot = i;
        break;
      }
    }
    if (slot === 0) slot = Math.max(sharedCount, 1);
  } else {
    const maxSlot = existing.reduce((m, r) => Math.max(m, r.slot), Math.max(sharedCount, 0));
    slot = maxSlot + 1;
  }
  if (slot > MAX_ASSET_SLOTS) {
    throw new McpError("SLOT_OVERFLOW", `资产槽位溢出：需要第 ${slot} 槽，上限 ${MAX_ASSET_SLOTS}`, {
      needed: slot,
      max: MAX_ASSET_SLOTS,
    });
  }
  return { ...incoming, slot };
}

/** 时长 → 帧数：按 17k+5 吸附（fps=17 节奏），与前端 durationToFrames 语义一致。 */
export function durationToFrames(seconds: number, fps = 17): number {
  const raw = Math.max(Math.round(seconds * fps), 5);
  return Math.round((raw - 5) / 17) * 17 + 5;
}

/** sharedParams.presetId 合法值（对齐 DIRECTOR_PRESETS）。 */
export const DIRECTOR_PRESET_IDS = ["h3", "sd2.5"] as const;
export type DirectorPresetId = (typeof DIRECTOR_PRESET_IDS)[number];

/**
 * 公共参数默认值（对齐前端 DIRECTOR_PRESETS[h3].params，键 = DIRECTOR_PARAM_SCHEMA）。
 * set_shared_params 先铺这层再合并用户值：只给半套键会让页面参数面板回落到默认、
 * 与引擎实际入参不一致（2026-11-07 事故）。
 */
export const DIRECTOR_SHARED_DEFAULTS: Record<string, unknown> = {
  task_type: "t2v",
  cfg: 1.0,
  seed: 0,
  frame_rate: 24.0,
  width: 864,
  height: 480,
  ref_max_size: 864,
  total_frames: 124,
  steps: 25,
  sampler: "res_multistep",
  scheduler: "simple",
  shift_video: 12.0,
  shift_audio: 3.0,
  clear_vram_between_segments: true,
  clear_vram_before_refine: false,
  clear_vram_before_face_refine: false,
  cache_frames_codec: "raw",
  export_source_images: false,
  export_pre_face_refine: false,
  cache_name: "",
  refImageSize: "match",
  continuityEnabled: false,
  continuityOverlapFrames: 22,
  continuityMode: "guide",
  continuityRedraw: 0.1,
  continuityKeepTail: true,
  exportMode: "all",
  maxExportFrames: 0,
  audioMode: "generate",
  commonEnabled: true,
  aspect: "16:9",
  scaleFactor: 1,
};
