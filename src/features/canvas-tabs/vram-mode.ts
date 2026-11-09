/**
 * vram-mode — 出片显存策略（2026-11-09 用户定稿）
 *
 * 低显存/高显存是服务层决策，不是客户参数：
 * - auto（默认）：按 /system_stats 的总显存自动选；读取不到机器信息时保守走低显存；
 * - low / high：用户在 ComfyUI 连接面板手动兜底（风险自负），持久化到 endpoint prefs。
 */
import {
  fetchComfyuiMachineInfo,
  LOW_VRAM_THRESHOLD_BYTES,
  useComfyuiEndpointStore,
  type ComfyuiMachineInfo,
  type ComfyuiVramMode,
} from './comfyui-endpoint.js';

export function resolveUseLowVram(
  machine: ComfyuiMachineInfo | null | undefined,
  mode: ComfyuiVramMode | undefined,
): boolean {
  if (mode === 'low') return true;
  if (mode === 'high') return false;
  // auto：读不到显存时保守走低显存，避免低显存机器直接 OOM
  const total = machine?.vramTotalBytes;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return true;
  return total < LOW_VRAM_THRESHOLD_BYTES;
}

/** 当前连接下的出片显存策略（同步读 store；调用方应先 ensureComfyuiMachineInfo） */
export function shouldUseLowVram(): boolean {
  const { machine, vramMode } = useComfyuiEndpointStore.getState();
  return resolveUseLowVram(machine, vramMode);
}

/**
 * 出片前补齐机器信息（一次会话缓存；失败不阻断生成，auto 会保守走低显存）。
 * 连接面板测试时通常已经取到，这里只处理直接调 API / 旧缓存场景。
 */
export async function ensureComfyuiMachineInfo(baseUrl: string): Promise<ComfyuiMachineInfo | null> {
  const store = useComfyuiEndpointStore.getState();
  if (store.machine) return store.machine;
  const machine = await fetchComfyuiMachineInfo(baseUrl);
  if (machine) useComfyuiEndpointStore.setState({ machine });
  return machine;
}
