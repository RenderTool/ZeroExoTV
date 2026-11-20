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

export function templatePassthrough(shared: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TEMPLATE_PASSTHROUGH_KEYS) {
    const v = shared[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}
