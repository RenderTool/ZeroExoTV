/**
 * image-edit-actions - 图片编辑产物落图（裁剪 / 分割）
 *
 * 节点内编辑（NodeImageEditor）与（如需回退的）弹窗路径共用这一份实现：
 * 产物一律是**新节点 + 连线**（复制语义，原节点不动），失败抛出由调用方给可读提示。
 */

import { AddEdgeCommand, AddNodeCommand, type CommandQueue, type NodeRecord } from '@zeroexo/core';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { cropDataUrl, splitDataUrl, MAX_SPLIT_PIECES } from '@zeroexo/plugin-image-editor';
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

/** 局部遮罩：用本机 Qwen 图像编辑产出的 Blob 生成结果节点（原节点不动） */
export async function applyMaskEdit({ node, commandQueue, blob, prompt, onGetNodeTitle }: {
  node: NodeRecord;
  commandQueue: CommandQueue;
  blob: Blob;
  prompt: string;
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}): Promise<string[]> {
  const objectUrl = URL.createObjectURL(blob);
  const img = await uploadImage(objectUrl);
  URL.revokeObjectURL(objectUrl);
  const origWidth = node.size?.width ?? 340;
  const newWidth = Math.min(origWidth, Math.max(220, img.width ?? origWidth));
  const newHeight = Math.round(newWidth * ((img.height || 1) / (img.width || 1)));
  const childId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  commandQueue.execute(
    new AddNodeCommand({
      id: childId,
      type: 'image',
      title: onGetNodeTitle?.('image') ?? '',
      position: { x: node.position.x + origWidth + 96, y: node.position.y },
      size: { width: newWidth, height: newHeight },
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
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: { nodeId: node.id, pinId: 'image' },
      target: { nodeId: childId, pinId: 'prompt' },
    }),
  );
  return [childId];
}

/** 裁剪：原节点右侧生成一张裁剪结果节点，并连一条 原节点 → 新节点 的边 */
export async function applyCrop({ node, commandQueue, dataUrl, onGetNodeTitle, rect }: BaseInput & { rect: CropRect }): Promise<string[]> {
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
  return [childId];
}

/** 分割切片布局：**同一缩放比例 + 累计边界取整**，保证非均匀切片也能严丝合缝拼回原图 */
export interface SplitPieceDim { width: number; height: number }
export interface SplitCellLayout { x: number; y: number; width: number; height: number }
export const SPLIT_TARGET_TOTAL_WIDTH = 480;

export function computeSplitLayout(
  dims: SplitPieceDim[],
  columns: number,
  targetTotalWidth = SPLIT_TARGET_TOTAL_WIDTH,
): { cells: SplitCellLayout[]; scale: number; totalWidth: number; totalHeight: number } {
  if (columns < 1 || dims.length === 0) return { cells: [], scale: 1, totalWidth: 0, totalHeight: 0 };
  const rows = Math.ceil(dims.length / columns);
  // 列宽取首行每片、行高取首列每片（切分边界对整行/整列一致）
  const colWidths: number[] = [];
  for (let c = 0; c < columns; c++) colWidths.push(dims[c]?.width ?? 1);
  const rowHeights: number[] = [];
  for (let r = 0; r < rows; r++) rowHeights.push(dims[r * columns]?.height ?? 1);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  // 只缩小不放大：小图保持原始像素尺寸
  const scale = totalWidth > 0 ? Math.min(1, targetTotalWidth / totalWidth) : 1;
  // 累计边界分别取整 → 相邻切片共享同一个边界，宽度之和恒等于总宽（无缝、无叠）
  const cumX: number[] = [0];
  for (const w of colWidths) cumX.push(cumX[cumX.length - 1]! + w);
  const cumY: number[] = [0];
  for (const h of rowHeights) cumY.push(cumY[cumY.length - 1]! + h);
  const edgeX = cumX.map((v) => Math.round(v * scale));
  const edgeY = cumY.map((v) => Math.round(v * scale));
  const cells: SplitCellLayout[] = [];
  for (let i = 0; i < dims.length; i++) {
    const r = Math.floor(i / columns);
    const c = i % columns;
    cells.push({
      x: edgeX[c]!,
      y: edgeY[r]!,
      width: Math.max(1, edgeX[c + 1]! - edgeX[c]!),
      height: Math.max(1, edgeY[r + 1]! - edgeY[r]!),
    });
  }
  return { cells, scale, totalWidth: edgeX[edgeX.length - 1]!, totalHeight: edgeY[edgeY.length - 1]! };
}

/** 分割：按网格生成 N 个切片节点（同一缩放比例、零间距紧密拼合），并连边 */
export async function applySplit({
  node, commandQueue, dataUrl, onGetNodeTitle, onNodesCreated, params,
}: BaseInput & { params: SplitParams; onNodesCreated?: (nodeIds: string[]) => void }): Promise<string[]> {
  // 兜底：一次切太多块会同时做 N 次 canvas 编码 + 上传 + 建节点/连线（浏览器会卡死）
  if (params.rows * params.columns > MAX_SPLIT_PIECES) {
    throw new Error(`单次最多切 ${MAX_SPLIT_PIECES} 块（当前 ${params.rows * params.columns} 块）`);
  }
  const pieces = await splitDataUrl(dataUrl, params);
  const uploaded = await Promise.all(pieces.map((p) => uploadImage(p)));
  const baseX = node.position.x + (node.size?.width ?? 340) + 40;
  const prompt = nodePrompt(node);
  // 计算切图前的同类型节点数量，确保标题编号不跳号
  const existingCount = commandQueue.getState().nodes.filter((n) => n.type === 'image').length;
  const childIds: string[] = [];
  const layout = computeSplitLayout(
    uploaded.map((img) => ({ width: img.width, height: img.height })),
    params.columns,
  );
  uploaded.forEach((img, i) => {
    const cell = layout.cells[i] ?? { x: 0, y: 0, width: 200, height: 200 };
    const childId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    childIds.push(childId);
    commandQueue.execute(
      new AddNodeCommand({
        id: childId,
        type: 'image',
        title: onGetNodeTitle?.('image', i, existingCount) ?? '',
        position: { x: baseX + cell.x, y: node.position.y + cell.y },
        size: { width: cell.width, height: cell.height },
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
  return childIds;
}
