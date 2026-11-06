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
