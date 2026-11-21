/**
 * LoRA 推荐清单（2026-11-21 用户提供截图 + 口径「加入 lora 推荐清单和强项描述」）
 *
 * 三条原则：
 * 1. **只是建议，不预勾**：清单里出现不等于启用；一切以用户勾选为准（C-15 口径）。
 * 2. **不虚构**：文件全名、强度、触发词全部来自用户给的截图（官方推荐档 / 文戏组合），
 *    本机没有的文件标「本机未下载」并禁用套用，绝不假装可用。
 * 3. **组合即顺序**：组合项按数组顺序串联（先写实的 realism-people，再压镜头感）。
 */
import { MAX_LORAS, type LoraRow } from './director-lora.js';

export interface LoraPresetItem {
  name: string;
  /** 截图里给的强度 */
  strength: number;
  /** 这条在组合里负责什么（一句话） */
  role: string;
}

export interface LoraPreset {
  id: string;
  title: string;
  /** 角标：官方推荐 / 组合技 / 本机自带 */
  badge: string;
  badgeColor: 'blue' | 'purple' | 'green' | 'gold';
  items: LoraPresetItem[];
  /** 强项描述（这是本清单的重点） */
  strengths: string;
  /** 使用注意（触发词、步数、显存） */
  caveat?: string;
}

/** 官方 4 步 turbo（fl2v）：用户截图 1 */
export const LORA_PRESET_TURBO_4STEP_FL2V = 'turbo-4step-fl2v';
/** 文戏组合：用户截图 2（触发词 r34l1sm） */
export const LORA_PRESET_DIALOGUE_COMBO = 'dialogue-combo';
/** 本机自带 8 步 turbo（当前唯一已下载的推荐项） */
export const LORA_PRESET_LOCAL_8STEP_R2V = 'local-8step-r2v';

export const LORA_PRESETS: LoraPreset[] = [
  {
    id: LORA_PRESET_TURBO_4STEP_FL2V,
    title: '官方 4 步 Turbo（fl2v）',
    badge: '官方推荐',
    badgeColor: 'blue',
    items: [
      {
        name: 'minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors',
        strength: 0.70,
        role: '唯一一条：4 步蒸馏主加速',
      },
    ],
    strengths:
      '强项：出片速度。4 步蒸馏（LightX2V 4step）把采样压到 4 步，单段耗时最短，适合「先看节奏/构图对不对」的快速迭代；首尾帧（fl2v）链路是官方给的推荐搭配，强度按截图取 0.70。',
    caveat: '步数才是决定项：这条只换加速档位，steps 与 4 步档对齐（约 4 步）才按设计跑；画面质量最终由你定的步数决定，别先给档位扣分。',
  },
  {
    id: LORA_PRESET_DIALOGUE_COMBO,
    title: '文戏组合（两条串联）',
    badge: '组合技',
    badgeColor: 'purple',
    items: [
      {
        name: 'h3-realism-people-t2v-i2v-r2v.safetensors',
        strength: 0.80,
        role: '第 1 条：写实人物质感',
      },
      {
        name: '电影镜头_000019000.safetensors',
        strength: 0.30,
        role: '第 2 条：电影镜头/构图',
      },
    ],
    strengths:
      '强项：文戏。第 1 条把人物拉回真人质感（皮肤、五官、体态不像塑料模型），支持 t2v/i2v/r2v 三种入口；第 2 条只给 0.30 的轻推，负责景别与电影感构图，压太重会抢戏。两条按 0.80 → 0.30 串联，先立人物再定镜头。',
    caveat: '触发词 r34l1sm 必须写进提示词，漏了就是白挂；两条合计 2.31 GB 权重，8G 卡上会明显吃显存和时间。',
  },
  {
    id: LORA_PRESET_LOCAL_8STEP_R2V,
    title: '本机 8 步 Turbo（r2v）',
    badge: '本机已下',
    badgeColor: 'green',
    items: [
      {
        name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
        strength: 1.00,
        role: '唯一一条：8 步蒸馏参考图驱动',
      },
    ],
    strengths:
      '强项：稳。参考图驱动（r2v）的 8 步蒸馏，768p 分辨率，步数比 4 步档多一倍但结构/一致性更稳；这条是当前这台机器 models/loras 里已经下载好的唯一推荐项，装好即用。',
    caveat: '比 4 步档慢一倍左右；纯提速需求优先 4 步档。',
  },
];

export function loraPresetById(id: string): LoraPreset | undefined {
  return LORA_PRESETS.find((p) => p.id === id);
}

/** 组合里本机缺哪些文件（空数组 = 可套用） */
export function missingPresetFiles(preset: LoraPreset, available: string[]): string[] {
  const set = new Set(available);
  return preset.items.map((i) => i.name).filter((n) => !set.has(n));
}

/**
 * 套用组合 → 有序 LoRA 行。
 * 超过 MAX_LORAS 或本机缺文件一律返回 `{ ok: false, reason }`，不静默截断/跳过。
 */
export function presetToRows(
  preset: LoraPreset,
  available: string[],
): { ok: true; rows: LoraRow[] } | { ok: false; reason: string } {
  const missing = missingPresetFiles(preset, available);
  if (missing.length > 0) {
    return { ok: false, reason: `本机未下载：${missing.join('、')}` };
  }
  if (preset.items.length > MAX_LORAS) {
    return { ok: false, reason: `组合超过 ${MAX_LORAS} 条上限，请手动挑选` };
  }
  return {
    ok: true,
    rows: preset.items.map((i) => ({ name: i.name, strength: i.strength })),
  };
}
