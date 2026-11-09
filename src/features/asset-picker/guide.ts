/**
 * guide - 资产/节点上引导数据的唯一读取口（2026-11-07）
 *
 * 新记录写在 `data.guide`；兼容早期/外部写入的 `data.generation.guide`。
 * 只有带 id 才算有效（没有 id 无法定位/发送给 ComfyUI）。
 */
import type { GuideMeta } from './index.js';

export function getGuideMeta(data: unknown): GuideMeta | undefined {
  const d = data as { guide?: GuideMeta; generation?: { guide?: GuideMeta } } | null | undefined;
  const guide = d?.guide ?? d?.generation?.guide;
  return guide?.id ? guide : undefined;
}
