/**
 * LoRA 串联参数（2026-11-20）
 *
 * ComfyUI 的 LoRA 是 MODEL 的串联 patch：多个 LoraLoaderModelOnly 逐节加权，
 * 所以项目侧只存「有序列表 + 各自强度」，由插件按顺序生成节点链。
 * 网页参数面板与 MCP 共用这份解析，保证两边提交的 payload 一致。
 */

/** 工程护栏：不是模型硬限制，是「再多显存/耗时都会明显变差」的上限 */
export const MAX_LORAS = 4;

/**
 * 推荐 LoRA（H3 8 步 turbo）。2026-11-21 用户口径：
 * LoRA 是可选增强项，**一切以勾选为准** —— 它只在清单里标注「默认推荐」，
 * 默认不勾；不勾 = 插件一条都不加载，不存在任何隐式默认。
 */
export const DEFAULT_LORA_NAME = 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors';

export interface LoraRow {
  name: string;
  strength: number;
}

/** 容错解析：支持 [{name,strength}] / ["a.safetensors"] / JSON 字符串 / 垃圾值 → [] */
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
      const name = String(rec['name'] ?? rec['lora_name'] ?? '').trim();
      if (!name) continue;
      const rawStrength = rec['strength'] ?? rec['strength_model'];
      const strength = Number(rawStrength);
      out.push({ name, strength: Number.isFinite(strength) ? Math.min(2, Math.max(0, strength)) : 1 });
    }
  }
  return out.slice(0, MAX_LORAS);
}
