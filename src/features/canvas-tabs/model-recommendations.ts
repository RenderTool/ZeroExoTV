/**
 * model-recommendations — 视频槽位模型的显存档位表 + 自动挑选
 *
 * 2026-11-20 用户硬口径：32B 文本编码器只有显存 ≥ 80G 才允许 bf16（48G 版单个文件 48G，
 * 一张 48G 卡光加载它就满），48G 及以下必须用 int8_convrot，否则必 OOM。
 * 所以档位判断从「统一 24G 阈值」改成「每个文件自己的显存下限」，按文件真实体积定：
 * 26G 的 int8 TE 要 32G 起，48G 的 bf16 TE 要 80G 起。
 */

export type ModelSlot = 'unet' | 'videoVae' | 'audioVae' | 'clip';

export interface ModelTier {
  /** 界面上的推荐标记文案 */
  label: string;
  /** 允许使用该文件的最小总显存（GB）；低于此值不自动选，并给出提示 */
  minGb: number;
}

export const MODEL_RECOMMENDATIONS: Record<ModelSlot, Record<string, ModelTier>> = {
  unet: {
    // 主模型 int8 约 20G
    'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors': { label: '24G 推荐', minGb: 24 },
    'minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors': { label: '24G 推荐', minGb: 24 },
    // 主模型 bf16 约 40G，48G 卡塞不进 TE + 主模型 + 激活值
    'minimax_h3_hybrid_fl2va_ref2va_b25-49-bf16.safetensors': { label: '80G 以上推荐', minGb: 80 },
    'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors': { label: '80G 以上推荐', minGb: 80 },
  },
  videoVae: {
    // VAE int8 约 3G
    'minimax_h3_video_vae_int8_convrot.safetensors': { label: '8G 推荐', minGb: 8 },
  },
  audioVae: {
    'minimax_h3_audio_vae_fp32.safetensors': { label: '通用', minGb: 8 },
  },
  clip: {
    // 32B Qwen3-VL int8 约 26G：8G 机器跑不动，32G 起
    'qwen3vl_32b_minimax_h3_int8_convrot.safetensors': { label: '32G 及以上推荐', minGb: 32 },
    // 32B Qwen3-VL bf16 就是 48G：只有 80G 卡能同时装下主模型
    'qwen3vl_32b_minimax_h3_bf16.safetensors': { label: '80G 以上推荐', minGb: 80 },
  },
};

export function modelTier(slot: ModelSlot, name: string | undefined): ModelTier | undefined {
  if (!name) return undefined;
  return MODEL_RECOMMENDATIONS[slot][name];
}

/** 按「显存下限从高到低」，挑本机真实存在且当前显存允许的第一个推荐模型 */
export function pickPreferredModel(
  slot: ModelSlot,
  options: string[],
  totalGb: number | null,
): string | undefined {
  if (totalGb == null || !Number.isFinite(totalGb) || totalGb <= 0) return undefined;
  const table = MODEL_RECOMMENDATIONS[slot];
  const candidates = Object.entries(table)
    .filter(([, tier]) => tier.minGb <= totalGb)
    .sort((a, b) => b[1].minGb - a[1].minGb);
  for (const [name] of candidates) {
    if (options.includes(name)) return name;
  }
  return undefined;
}

/** 已选模型是否超出当前显存允许范围（用于自动降档与提示） */
export function isModelOverBudget(slot: ModelSlot, name: string | undefined, totalGb: number | null): boolean {
  const tier = modelTier(slot, name);
  if (!tier) return false;
  if (totalGb == null || totalGb <= 0) return false;
  return tier.minGb > totalGb;
}
