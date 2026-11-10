/**
 * node-send — 画布节点「发送到…」统一入口（2026-11-10 用户要求统一文案与入口）
 *
 * 目的地只有两个真实归属：本项目资产（project）与全局资产（library）。
 * 「另存为资产」= 用自定义标题存到本项目；「发送到主体」走既有 subject-link 弹层。
 * 右键菜单与节点胶囊共用本模块，禁止两处各写一套。
 */
import type { NodeRecord } from '@zeroexo/core';
import { addAssets, resolveUploadScope } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { buildNodeAssetInput } from '@/features/asset-picker/services/upload-asset.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';

/** 发送目的地：本项目资产 / 全局资产 */
export type NodeSendDestination = 'project' | 'library';

/** 节点是否具备「发送到资产」的内容（文本/图片/视频/音频且已有内容或落盘键） */
export function canSendNode(node: NodeRecord | undefined | null): boolean {
  if (!node) return false;
  if (!['text', 'image', 'video', 'audio'].includes(node.type)) return false;
  const d = (node.data ?? {}) as Record<string, unknown>;
  return Boolean(d.storageKey || d.content);
}

/**
 * 发送节点内容到资产库。
 * @param destination project = 本项目资产；library = 全局资产
 * @param opts.title 自定义资产标题（「另存为资产」用）
 */
export async function sendNodeToAssets(
  node: NodeRecord,
  destination: NodeSendDestination,
  opts: { title?: string } = {},
): Promise<Asset[]> {
  const input = await buildNodeAssetInput(node);
  if (!input) return [];
  const scope = resolveUploadScope(destination, getCurrentCanvasId());
  const created = await addAssets([{
    ...input,
    ...(opts.title?.trim() ? { title: opts.title.trim() } : {}),
    ...scope,
  }]);
  for (const asset of created) onAssetCreated(asset.id);
  return created;
}
