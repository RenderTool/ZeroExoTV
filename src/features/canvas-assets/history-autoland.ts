/**
 * canvas-assets/history-autoland - 画布生成产物自动落库（2026-11-04 本地版「历史」分组数据底座）
 *
 * 背景：云端版由后端把生成产物自动落 Asset 素材库（Plan#69），本地版没有后端资产库，
 * 生成结果只活在节点 data 里（图片 dataUrl / 视频 blob URL，刷新即失）。
 * 本模块在生成完成点把产物经 CAS 链路落成「本项目」资产记录：
 * - 字节进 media/cas/<hash>.<ext>（stageCasUpload 同内容天然去重，不复制第二份）；
 * - 资产记录 scope='project' + originNodeId（供历史分组「定位到画布节点」）；
 * - addAsset 事件带 source='autoland'，抽屉只刷新列表、不抢焦点分组；
 * - 同内容已有资产记录（用户已「保存到素材」/重复生成）→ 跳过，不产生重复记录。
 *
 * 失败静默（catch 由调用方兜底打 warn），绝不阻塞生成主流程。
 */

import { stageCasUpload } from '@/features/asset-picker/services/cas-upload.js';
import { addAsset } from '@/features/asset-picker/asset-store.js';
import type { GuideMeta, HistorySource } from '@/features/asset-picker/index.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { cacheGuideLocally } from '@/shared/utils/guide-file.js';

export interface AutoLandInput {
  nodeId: string;
  kind: 'image' | 'video';
  /** 卡片标题（prompt 摘要 / 节点标题） */
  title: string;
  /** 产物内容：dataUrl 或 blob: URL（生成完成当刻可 fetch） */
  content: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bytes?: number;
  mimeType?: string;
  /** 自证来源元数据（provider 返回，尽力而为，可缺省） */
  jobId?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  frames?: number;
  /** 本机 H3 引导数据（与视频一起落资产记录，供「视频+引导」导出/发送导演台） */
  guide?: GuideMeta;
  /**
   * 产出来源（2026-11-07）：抽屉「历史」按「从画布生成 / 从导演台」分 Tab。
   * 缺省 canvas（画布节点生成）；导演台每段落库必须显式传 director。
   */
  originSource?: HistorySource;
}

export interface AutoLandBlobInput extends Omit<AutoLandInput, 'content'> {
  /** 产物 Blob（生成链路已拿到字节时直接落库，不经 blob URL） */
  blob: Blob;
  /** 归属项目（缺省取当前画布 id） */
  projectId?: string;
}

/**
 * 生成产物直接落库（Blob 版）：导演台每段落库后调用，历史分组才能看到「生成历史」。
 * 与 autoLandGenerationOutput 同一套 CAS/资产记录纪律（origin='generation' 唯一判据）。
 *
 * 返回落库结果（storageKey / guide）：节点侧可把它写回 data.storageKey，
 * 刷新后仍能按 key 重新解析媒体（否则只剩会话级 blob: 地址，下载/播放都会失效）。
 */
export async function autoLandGenerationBlob(input: AutoLandBlobInput): Promise<{ storageKey: string; guide?: GuideMeta } | null> {
  const projectId = input.projectId ?? getCurrentCanvasId();
  if (!projectId || !input.blob.size) return null;
  // 2026-11-11：云端 ComfyUI 不持久化，引导必须生成即缓存到本地（media/guides），
  // 历史资产记录拿 localKey，云端清盘后「下载视频+引导/发送引导」依然可用。
  const cachedGuide = input.guide?.id ? await cacheGuideLocally(input.guide).catch(() => null) : null;
  const guideMeta = cachedGuide ?? input.guide;
  const staged = await stageCasUpload(input.blob, input.kind, { projectId });
  // 同内容已有资产记录（用户已保存到素材 / 重复生成同一产物）→ 不重复建记录
  if (staged.dedupedExistingAsset) return { storageKey: staged.storageKey, ...(guideMeta ? { guide: guideMeta } : {}) };
  const generation = {
    jobId: input.jobId,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    durationSec: input.durationMs != null ? Math.round((input.durationMs / 1000) * 100) / 100 : undefined,
    frames: input.frames,
    createdAt: new Date().toISOString(),
  };
  const originSource: HistorySource = input.originSource ?? 'canvas';
  const data: Parameters<typeof addAsset>[0]['data'] =
    input.kind === 'image'
      ? { kind: 'image', dataUrl: '', storageKey: staged.storageKey, width: input.width, height: input.height, originNodeId: input.nodeId, origin: 'generation', originSource, generation }
      : { kind: 'video', url: '', storageKey: staged.storageKey, width: input.width, height: input.height, durationMs: input.durationMs, originNodeId: input.nodeId, origin: 'generation', originSource, generation, ...(guideMeta ? { guide: guideMeta } : {}) };
  await addAsset(
    {
      id: staged.id,
      cas: staged.cas,
      title: input.title || (input.kind === 'image' ? '画布图片产出' : '画布视频产出'),
      kind: input.kind,
      bytes: staged.bytes,
      mimeType: staged.mimeType,
      data,
      scope: 'project',
      projectId,
    },
    { source: 'autoland' },
  );
  return { storageKey: staged.storageKey, ...(guideMeta ? { guide: guideMeta } : {}) };
}

export async function autoLandGenerationOutput(input: AutoLandInput): Promise<{ storageKey: string; guide?: GuideMeta } | null> {
  const projectId = getCurrentCanvasId();
  if (!projectId || !input.content) return null;
  const res = await fetch(input.content);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.size) return null;
  return autoLandGenerationBlob({ ...input, blob, projectId });
}
