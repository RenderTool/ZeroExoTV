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
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';

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
}

export async function autoLandGenerationOutput(input: AutoLandInput): Promise<void> {
  const projectId = getCurrentCanvasId();
  if (!projectId || !input.content) return;
  const res = await fetch(input.content);
  if (!res.ok) return;
  const blob = await res.blob();
  if (!blob.size) return;
  const staged = await stageCasUpload(blob, input.kind, { projectId });
  // 同内容已有资产记录（用户已保存到素材 / 重复生成同一产物）→ 不重复建记录
  if (staged.dedupedExistingAsset) return;
  // 来源自证标记：历史分组唯一判据 data.origin='generation'（手动上传路径永不写入）
  const generation = {
    jobId: input.jobId,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    durationSec: input.durationMs != null ? Math.round((input.durationMs / 1000) * 100) / 100 : undefined,
    frames: input.frames,
    createdAt: new Date().toISOString(),
  };
  const data: Parameters<typeof addAsset>[0]['data'] =
    input.kind === 'image'
      ? { kind: 'image', dataUrl: '', storageKey: staged.storageKey, width: input.width, height: input.height, originNodeId: input.nodeId, origin: 'generation', generation }
      : { kind: 'video', url: '', storageKey: staged.storageKey, width: input.width, height: input.height, durationMs: input.durationMs, originNodeId: input.nodeId, origin: 'generation', generation };
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
}
