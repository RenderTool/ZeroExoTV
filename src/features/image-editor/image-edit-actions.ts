/**
 * image-edit-actions - 图片编辑产物落图（裁剪 / 分割）
 *
 * 节点内编辑（NodeImageEditor）与（如需回退的）弹窗路径共用这一份实现：
 * 产物一律是**新节点 + 连线**（复制语义，原节点不动），失败抛出由调用方给可读提示。
 */

import { AddEdgeCommand, AddNodeCommand, type CommandQueue, type NodeRecord } from '@zeroexo/core';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { cropDataUrl, splitDataUrl } from '@zeroexo/plugin-image-editor';
import type { CropRect, SplitParams } from '@zeroexo/plugin-image-editor';

interface BaseInput {
  node: NodeRecord;
  commandQueue: CommandQueue;
  dataUrl: string;
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}

function nodePrompt(node: NodeRecord): string {
  return (node.data as { prompt?: string } | null)?.prompt ?? '';
}

/** 裁剪：原节点右侧生成一张裁剪结果节点，并连一条 原节点 → 新节点 的边 */
export async function applyCrop({ node, commandQueue, dataUrl, onGetNodeTitle, rect }: BaseInput & { rect: CropRect }): Promise<void> {
  const cropped = await cropDataUrl(dataUrl, rect);
  const img = await uploadImage(cropped);
  const origWidth = node.size?.width ?? 340;
  const newWidth = Math.min(origWidth, Math.max(220, img.width));
  const newHeight = Math.round(newWidth * (img.height / img.width));
  const childId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  commandQueue.execute(
    new AddNodeCommand({
      id: childId,
      type: 'image',
      title: onGetNodeTitle?.('image') ?? '',
      position: { x: node.position.x + origWidth + 96, y: node.position.y },
      size: { width: newWidth, height: newHeight },
      data: {
        prompt: nodePrompt(node),
        content: img.url,
        storageKey: img.storageKey,
        status: 'success',
        naturalWidth: img.width,
        naturalHeight: img.height,
        mimeType: img.mimeType,
        bytes: img.bytes,
      },
    }),
  );
  commandQueue.execute(
    new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: { nodeId: node.id, pinId: 'image' },
      target: { nodeId: childId, pinId: 'prompt' },
    }),
  );
}

/** 分割：按网格生成 N 个切片节点（行高取该行最大片，逐行累加避免重叠），并连边 */
export async function applySplit({
  node, commandQueue, dataUrl, onGetNodeTitle, onNodesCreated, params,
}: BaseInput & { params: SplitParams; onNodesCreated?: (nodeIds: string[]) => void }): Promise<void> {
  const pieces = await splitDataUrl(dataUrl, params);
  const uploaded = await Promise.all(pieces.map((p) => uploadImage(p)));
  const baseX = node.position.x + (node.size?.width ?? 340) + 40;
  const prompt = nodePrompt(node);
  // 计算切图前的同类型节点数量，确保标题编号不跳号
  const existingCount = commandQueue.getState().nodes.filter((n) => n.type === 'image').length;
  const childIds: string[] = [];
  const cellW = 200;
  const cellHeights: number[] = uploaded.map((img) => Math.round(cellW * (img.height / img.width)));
  const rowHeights: number[] = [];
  cellHeights.forEach((h, i) => {
    const row = Math.floor(i / params.columns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
  });
  const rowTop: number[] = [];
  let accY = 0;
  rowHeights.forEach((h, r) => {
    rowTop[r] = accY;
    accY += h + 20;
  });
  uploaded.forEach((img, i) => {
    const row = Math.floor(i / params.columns);
    const col = i % params.columns;
    const childId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    childIds.push(childId);
    const cellH = cellHeights[i] ?? 200;
    commandQueue.execute(
      new AddNodeCommand({
        id: childId,
        type: 'image',
        title: onGetNodeTitle?.('image', i, existingCount) ?? '',
        position: { x: baseX + col * (cellW + 20), y: node.position.y + (rowTop[row] ?? 0) },
        size: { width: cellW, height: cellH },
        // 切片节点去圆角：避免圆角裁掉图片四角导致拼合时角点空洞
        borderRadius: 0,
        data: {
          prompt,
          content: img.url,
          storageKey: img.storageKey,
          status: 'success',
          naturalWidth: img.width,
          naturalHeight: img.height,
          mimeType: img.mimeType,
          bytes: img.bytes,
        },
      }),
    );
    commandQueue.execute(
      new AddEdgeCommand({
        id: `edge-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: node.id, pinId: 'image' },
        target: { nodeId: childId, pinId: 'prompt' },
      }),
    );
  });
  if (childIds.length >= 2 && onNodesCreated) onNodesCreated(childIds);
}
