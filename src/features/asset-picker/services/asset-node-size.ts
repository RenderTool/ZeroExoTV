/**
 * asset-node-size - 资产落画布的节点尺寸契约（单一来源，2026-11-05 热修）
 *
 * 用户反馈（征集 #174）：「资产或者提示词拖入画布和直接发送到画布行为不一致！
 * 表现为节点尺寸没有和内容对齐」。
 *
 * 根因：真实宽高补全 + 长边上限 320 只写在「发送到画布」链路
 * （`pages/editor/editor-canvas/insert-asset-to-canvas.ts`），而拖拽链
 * （`features/canvas-interaction/drop-handler.ts` 的素材库卡片 / 开源卡片 /
 * AssetPicker / 外部文件四个调用点）全部裸调 `createAssetNode(payload, pos)`，
 * 于是落到 `IMAGE_DEFAULT_SIZE`(620×348 宽幅容器) → 竖图/方图两侧留黑边。
 *
 * 铁律：**任何把资产放进画布的入口都必须走 createSizedAssetNode**，
 * 禁止再写第二套尺寸逻辑（尺寸上限常量本身仍归 packages 的 node-contracts）。
 */
import { createAssetNode, IMAGE_LONG_SIDE } from '@zeroexo/plugin-nodes';
import type { NodeRecord } from '@zeroexo/core';
import { readImageDims } from './cas-upload.js';
import { resolveMediaBlobChain } from '@/shared/media/resolve-media-blob.js';

/** 建节点入参形状（与 createAssetNode 完全一致，避免第二份类型定义） */
export type AssetNodePayloadArg = Parameters<typeof createAssetNode>[0];
/** 画布容器像素尺寸（用于按视口收敛长边） */
export type CanvasContainerSize = { width: number; height: number };

/** 长边不超过视口短边的 40%（小窗口下再收，100% 缩放时不会占满屏）；下限 80 与节点最小尺寸一致 */
const IMAGE_VIEWPORT_SHARE = 0.4;

/** 按视口推导本次落图的图片长边：默认契约值 IMAGE_LONG_SIDE(320)，视口过小则按占比收敛 */
export function pickImageLongSide(containerSize: CanvasContainerSize): number {
  if (containerSize.width <= 0 || containerSize.height <= 0) return IMAGE_LONG_SIDE;
  const shareCap = Math.round(Math.min(containerSize.width, containerSize.height) * IMAGE_VIEWPORT_SHARE);
  return Math.max(80, Math.min(IMAGE_LONG_SIDE, shareCap));
}

/**
 * 补全图片真实宽高（2026-11-05 修复「节点是 291×164 宽幅容器、图片左右黑边」）：
 * toInsertPayload 只在素材记录自带 width/height 时才有尺寸，开源导入/存量记录常常缺失，
 * 于是落到宽幅默认容器——与真实比例不符就出现黑边。
 * 这里用既有 storageKey 解析链读原图 Blob（不建 object URL、不 revoke），再读 naturalWidth/Height。
 * 拿不到（无 key / 文件缺失 / 环境不支持解码）→ 原样返回，由 createAssetNode 既有默认尺寸
 * + ImageNodeView 的 onload 纠偏兜底，绝不另行写一套尺寸逻辑。
 */
export async function withNaturalImageSize(payload: AssetNodePayloadArg): Promise<AssetNodePayloadArg> {
  if (payload.kind !== 'image') return payload;
  if (payload.width && payload.height) return payload;
  const storageKey = payload.storageKey;
  if (!storageKey) return payload;
  try {
    const hit = await resolveMediaBlobChain(storageKey, 'image', ['orig']);
    if (!hit) return payload;
    const dims = await readImageDims(hit.blob);
    if (dims.width > 0 && dims.height > 0) return { ...payload, width: dims.width, height: dims.height };
  } catch {
    // 尺寸解析失败不阻断插入：退回默认尺寸（节点视图 onload 纠偏）
  }
  return payload;
}

/**
 * 按统一尺寸契约建资产节点（两条链路唯一共用入口）：
 * - 图片：先补真实宽高，再按长边上限（视口收敛后的 IMAGE_LONG_SIDE）等比 fit；
 * - 取不到真实尺寸：不拿宽幅默认值糊弄，用中性 1:1（图片可加载时 onload 会按真实比例纠正）；
 * - 视频/音频/文本：不传 options，沿用各自节点契约（行为与「发送到画布」一致）。
 */
export async function createSizedAssetNode(
  payload: AssetNodePayloadArg,
  position: { x: number; y: number },
  containerSize: CanvasContainerSize,
): Promise<NodeRecord | null> {
  const longSide = pickImageLongSide(containerSize);
  return createAssetNode(await withNaturalImageSize(payload), position, {
    maxLongSide: longSide,
    fallbackSize: { width: longSide, height: longSide },
  });
}
