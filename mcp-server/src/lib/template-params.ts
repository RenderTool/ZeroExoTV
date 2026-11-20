/**
 * 模板级参数白名单（MCP 侧，2026-11-20）
 *
 * 只放 `comfyui-plugin/.../templates/reference_video.json` 里真实存在的 `__zx:*` 占位符键。
 * 网页与 MCP 必须用同一份白名单，否则「网页改了 sampler/LoRA」与「MCP 发起」会跑出两种结果。
 */

export const TEMPLATE_PASSTHROUGH_KEYS = [
  'sampler',
  'scheduler',
  'shift_video',
  'shift_audio',
  'clear_vram_between_segments',
  'cache_frames_codec',
  'cache_name',
  'lora_name',
  'lora_strength',
  'use_low_vram',
] as const;

export interface LoraRow {
  name: string;
  strength: number;
}

export const MAX_LORAS = 4;

/** 与网页 `src/entities/director-lora.ts` 同一套语义（两份实现必须保持一致）。 */
export function normalizeLoras(raw: unknown): LoraRow[] {
  let items: unknown[] = [];
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    items = raw;
  }
  const out: LoraRow[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (name) out.push({ name, strength: 1 });
      continue;
    }
    if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? rec.lora_name ?? '').trim();
      if (!name) continue;
      const rawStrength = rec.strength ?? rec.strength_model;
      const strength = Number(rawStrength);
      out.push({ name, strength: Number.isFinite(strength) ? Math.min(2, Math.max(0, strength)) : 1 });
    }
  }
  return out.slice(0, MAX_LORAS);
}

export function templatePassthrough(shared: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_PASSTHROUGH_KEYS) {
    const v = shared[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  /** 多 LoRA 有序列表 + 首条回填旧字段（旧插件至少跑用户选的第一条）。 */
  const loras = normalizeLoras(shared['loras']);
  if (loras.length > 0) {
    out['loras'] = loras;
    out['lora_name'] = loras[0]!.name;
    out['lora_strength'] = loras[0]!.strength;
  }
  return out;
}
