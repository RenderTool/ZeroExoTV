/**
 * ComfyUI 连接状态广播（给 MCP 用，2026-11-14）
 *
 * 背景：地址只存在浏览器 localStorage，MCP 读不到；Agent 于是默认去探 127.0.0.1:8188，
 * 用户明明连了云端还被告知「本机 ComfyUI 没跑」。这里把网页当前连接状态写到数据根，
 * MCP 的 get_comfyui_status 读同一文件，禁止再猜 localhost。
 */
import { ensureDir, writeJson } from './fs.js';

export const COMFYUI_ENDPOINT_BROADCAST_PATH = '.lf/zeroexo/app_meta/comfyui-endpoint.json';

export interface ComfyuiEndpointBroadcast {
  schemaVersion: 1;
  address: string;
  backend: 'direct' | 'openai' | 'zeroexo' | null;
  connected: boolean;
  updatedAt: string;
}

export async function publishComfyuiEndpoint(input: {
  address: string;
  backend?: 'direct' | 'openai' | 'zeroexo' | null;
  connected: boolean;
}): Promise<void> {
  try {
    await ensureDir('.lf/zeroexo/app_meta');
    await writeJson(COMFYUI_ENDPOINT_BROADCAST_PATH, {
      schemaVersion: 1,
      address: input.address,
      backend: input.backend ?? null,
      connected: input.connected,
      updatedAt: new Date().toISOString(),
    } satisfies ComfyuiEndpointBroadcast);
  } catch {
    // 未授权 / fs-server 离线：MCP 会退回「网页未广播」提示
  }
}
