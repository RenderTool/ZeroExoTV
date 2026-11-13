/**
 * comfyui-connection — ComfyUI 桥接连接配置持久化（模式参照 src/shared/view-prefs.ts）
 *
 * - 唯一 localStorage 键 `zeroexo.comfyuiBridge`，envelope { schemaVersion, data }；
 * - 损坏容错：解析失败/版本不符/单字段类型错 → 回默认值，绝不抛异常；
 * - 内容：可选 bridgeToken、上次选中的模型四件套（unet/videoVae/audioVae/clip）；
 *   地址不在本键保存（唯一来源是 zeroexo.comfyuiEndpoint，见 comfyui-endpoint）；
 * - 运行态（jobId/轮询状态等）不持久化——刷新后作业状态随 ComfyUI 侧存续，
 *   前端可通过「连接后重新运行」续跑（契约 §5），不在此处做会话恢复。
 */

import { create } from 'zustand';

export const COMFYUI_CONNECTION_STORAGE_KEY = 'zeroexo.comfyuiBridge';
export const COMFYUI_CONNECTION_SCHEMA_VERSION = 1;

export interface ComfyuiConnectionPrefs {
  /** 桥接 token（ComfyUI 侧设置 ZEROEXO_BRIDGE_TOKEN 时必填） */
  token: string;
  /** 上次选中的模型（文件名清单来自 /zeroexo/h3/models） */
  models: {
    unet: string;
    videoVae: string;
    audioVae: string;
    clip: string;
  };
}

export const DEFAULT_COMFYUI_CONNECTION: ComfyuiConnectionPrefs = {
  token: '',
  models: { unet: '', videoVae: '', audioVae: '', clip: '' },
};

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function sanitize(raw: unknown): ComfyuiConnectionPrefs {
  const d = DEFAULT_COMFYUI_CONNECTION;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const m = (typeof r.models === 'object' && r.models !== null ? r.models : {}) as Record<string, unknown>;
  return {
    token: str(r.token, d.token),
    models: {
      unet: str(m.unet, ''),
      videoVae: str(m.videoVae, ''),
      audioVae: str(m.audioVae, ''),
      clip: str(m.clip, ''),
    },
  };
}

export function loadComfyuiConnection(): ComfyuiConnectionPrefs {
  try {
    const rawText = localStorage.getItem(COMFYUI_CONNECTION_STORAGE_KEY);
    if (!rawText) return DEFAULT_COMFYUI_CONNECTION;
    const parsed = JSON.parse(rawText) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_COMFYUI_CONNECTION;
    const envelope = parsed as Record<string, unknown>;
    if (envelope.schemaVersion !== COMFYUI_CONNECTION_SCHEMA_VERSION) return DEFAULT_COMFYUI_CONNECTION;
    return sanitize(envelope.data);
  } catch {
    return DEFAULT_COMFYUI_CONNECTION;
  }
}

export function saveComfyuiConnection(prefs: ComfyuiConnectionPrefs): void {
  try {
    localStorage.setItem(
      COMFYUI_CONNECTION_STORAGE_KEY,
      JSON.stringify({ schemaVersion: COMFYUI_CONNECTION_SCHEMA_VERSION, data: prefs }),
    );
  } catch { /* 隐私模式 / QuotaExceeded 忽略 */ }
}

export interface ComfyuiConnectionState extends ComfyuiConnectionPrefs {
  /** 运行态（不持久化）：测试连接通过 = true；刷新后需重新测试 */
  connected: boolean;
  /** 运行态（不持久化）：/zeroexo/h3/models 拉到的文件名清单 */
  availableModels: { unet: string[]; vae: string[]; clip: string[] };
  setToken: (token: string) => void;
  setModel: (slot: 'unet' | 'videoVae' | 'audioVae' | 'clip', filename: string) => void;
  setConnected: (connected: boolean, modelsList?: { unet: string[]; vae: string[]; clip: string[] }) => void;
}

export const useComfyuiConnectionStore = create<ComfyuiConnectionState>()((set, get) => {
  const commit = (patch: Partial<ComfyuiConnectionPrefs>): void => {
    set(patch);
    const s = get();
    saveComfyuiConnection({ token: s.token, models: s.models });
  };
  return {
    ...loadComfyuiConnection(),
    connected: false,
    availableModels: { unet: [], vae: [], clip: [] },
    setToken: (token) => commit({ token }),
    setModel: (slot, filename) => commit({ models: { ...get().models, [slot]: filename } }),
    setConnected: (connected, modelsList) =>
      set(connected && modelsList ? { connected, availableModels: modelsList } : { connected, availableModels: { unet: [], vae: [], clip: [] } }),
  };
});

/**
 * 模型清单 → 四件套默认值：各槽自动选文件名含 `minimax_h3` 的项；
 * 用户已选值仍在清单内则保留。clipType 固定 'minimax'（契约 §2.2 样例）。
 */
export function pickDefaultModels(
  models: { unet: string[]; vae: string[]; clip: string[] },
  current: ComfyuiConnectionPrefs['models'],
): { unet: string; videoVae: string; audioVae: string; clip: string } {
  /**
   * 只允许 MiniMax H3 对应的模型：云端/第三方仓库经常混着 LTX、Wan 的 VAE，
   * 名字里没有 h3 的一律不自动选，宁可留空让用户明确选兼容版本（第三方量化也可以）。
   */
  const pick = (list: string[], patterns: RegExp[], currentVal: string): string => {
    const compatible = (name: string): boolean => patterns.some((p) => p.test(name));
    if (currentVal && list.includes(currentVal) && compatible(currentVal)) return currentVal;
    return list.find(compatible) ?? '';
  };
  return {
    unet: pick(models.unet, [/minimax_h3/i, /fasth3/i], current.unet),
    videoVae: pick(models.vae, [/minimax_h3[^/]*video_vae/i, /h3[^/]*video_vae/i, /video_vae[^/]*h3/i], current.videoVae),
    audioVae: pick(models.vae, [/minimax_h3[^/]*audio_vae/i, /h3[^/]*audio_vae/i, /audio_vae[^/]*h3/i], current.audioVae),
    clip: pick(models.clip, [/qwen3vl[^/]*minimax_h3/i, /qwen3vl[^/]*h3/i, /h3[^/]*qwen3vl/i], current.clip),
  };
}
