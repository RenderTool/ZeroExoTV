/**
 * guide-resolve - 从资产记录/本机作业解析引导数据（2026-11-07）
 *
 * 新生成的产物直接带 `data.guide`。存量产物（本次改动前生成）可能只有
 * `data.generation.jobId`：若 ComfyUI 进程仍在且作业还在，按 jobId 取回 guide 并回写资产记录，
 * 这样旧产物的「下载视频+引导」也能用；作业已被清理时返回 null（调用方给可读提示）。
 */
import type { Asset, GuideMeta } from '../index.js';
import { getGuideMeta } from '../guide.js';
import { updateAsset } from '../asset-store.js';
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import { fetchZeroexoJob } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

/** 资产是否可能带引导（决定是否展示引导入口）：已有 guide，或本机 zeroexo 生成产物 */
export function assetMayHaveGuide(asset: Asset): boolean {
  if (getGuideMeta(asset.data)) return true;
  const generation = (asset.data as { generation?: { provider?: string; jobId?: string } }).generation;
  // 本机 zeroexo 生成（director provider='zeroexo' / 画布节点 clientJobId=zx_…）
  return generation?.provider === 'zeroexo' || (typeof generation?.jobId === 'string' && generation.jobId.startsWith('zx_'));
}

export async function resolveGuideForAsset(asset: Asset): Promise<GuideMeta | null> {
  const direct = getGuideMeta(asset.data);
  if (direct) return direct;

  const generation = (asset.data as { generation?: { jobId?: string; provider?: string } }).generation;
  const jobId = generation?.jobId;
  if (!jobId) return null;
  const base = useComfyuiEndpointStore.getState().address?.replace(/\/+$/, '');
  if (!base) return null;
  try {
    const status = await fetchZeroexoJob(base, jobId);
    if (!status.guide?.id) return null;
    const guide: GuideMeta = {
      id: status.guide.id,
      path: status.guide.path,
      frames: status.guide.frames,
      sha256: status.guide.sha256,
    };
    // 回写资产记录：下次无需再查作业（失败不影响本次使用）
    await updateAsset(asset.id, { data: { ...(asset.data as object), guide } as Asset['data'] }).catch(() => undefined);
    return guide;
  } catch {
    return null;
  }
}
