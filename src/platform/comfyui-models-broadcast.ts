/**
 * 模型四件套广播（给 MCP 用，2026-11-20）
 *
 * 背景：模型映射面板的选择只存在浏览器 localStorage，MCP 是另一个进程读不到，
 * 结果走 MCP 发起的任务永远不带 models，插件退回模板自选 → 挑到 48G bf16 文本编码器（显存事故）。
 * 这里把「当前选中的四件套」写到数据根，MCP 的 director-ops 读同一文件。
 */
import { ensureDir, writeJson } from './fs.js';

export const COMFYUI_MODELS_BROADCAST_PATH = '.lf/zeroexo/app_meta/comfyui-models.json';

export interface ComfyuiModelsBroadcast {
  schemaVersion: 1;
  models: { unet: string; videoVae: string; audioVae: string; clip: string };
  clipType: 'minimax';
  updatedAt: string;
}

export async function publishComfyuiModels(models: {
  unet: string; videoVae: string; audioVae: string; clip: string;
}): Promise<void> {
  // 四个全空 = 用户没选过，没必要写盘；但已写过的旧值不清空（清空会让 MCP 突然报错）
  if (!models.unet && !models.videoVae && !models.audioVae && !models.clip) return;
  try {
    await ensureDir('.lf/zeroexo/app_meta');
    await writeJson(COMFYUI_MODELS_BROADCAST_PATH, {
      schemaVersion: 1,
      models,
      clipType: 'minimax',
      updatedAt: new Date().toISOString(),
    } satisfies ComfyuiModelsBroadcast);
  } catch {
    // 未授权 / fs-server 离线：MCP 会退回「未配置模型」的明确提示
  }
}
