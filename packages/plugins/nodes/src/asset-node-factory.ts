/**
 * asset-node-factory - 素材 → 节点工厂(Phase D2.5)
 *
 * 将素材 payload 映射为画布节点(NodeRecord),供 drop-handler 和
 * AssetPicker 点击插入使用。
 *
 * 映射规则:
 * | payload.kind | 节点类型 | data 内容 |
 * |--------------|----------|-----------|
 * | image        | image    | { content: blobUrl, storageKey, status: 'success' } |
 * | video        | video    | { content: blobUrl, storageKey, status: 'success' } |
 * | audio        | audio    | { content: blobUrl, storageKey, status: 'success' } |
 * | text         | text     | { content, status: 'idle' } |
 *
 * 关键: 所有媒体节点必须有 storageKey,确保:
 * 1. 刷新后 blob URL 可通过 storageKey 重建
 * 2. useProgressiveImage/useProgressiveVideo 能加载缩略图
 * 3. 云同步能正确上传资源
 *
 * 若资产已有 storageKey(后端 resources/ 或本地 image:/video:),直接使用;
 * 若无(如 data URL 或裸 blob URL),先存入 localforage 生成 storageKey + 缩略图。
 */

import type { NodeRecord } from '@zeroexo/core';
import { uploadImage, uploadMediaFile } from '@zeroexo/plugin-persistence';
import { TEXT_MAX_LENGTH } from '@/shared/constants/text-limits.js';
import {
  TEXT_DEFAULT_SIZE,
  IMAGE_DEFAULT_SIZE,
  VIDEO_DEFAULT_SIZE,
  AUDIO_DEFAULT_SIZE,
  MEDIA_MIN_SIZE,
} from './utils/node-contracts.js';
import { fitContainSize } from './utils/media-fit.js';

// ===== 类型定义 =====

/**
 * 素材节点 payload(与 canvas 的 InsertAssetPayload 结构兼容)
 *
 * 注意: 本类型定义在 nodes 包内,不依赖 app 层的 asset-picker,
 * 通过 TypeScript 结构类型保证兼容性(app 传入 InsertAssetPayload 时自动匹配)。
 */
export type AssetNodePayload =
  | { kind: 'text'; content: string; title: string }
  | { kind: 'image'; dataUrl: string; title: string; storageKey?: string; width?: number; height?: number }
  | { kind: 'video'; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number }
  | { kind: 'audio'; url: string; title: string; storageKey?: string; durationMs?: number };

// ===== 节点默认尺寸(与 createXxxExtension 的 defaultSize 同源: node-contracts.ts 单一事实源) =====
// 禁止在此处自行声明尺寸 —— 改契约只改 node-contracts.ts,所有入口自动跟随

// ===== 主入口 =====

/** 图片节点尺寸选项（缺省全部沿用既有契约，仅「发送到画布」按 320 长边特化） */
export interface CreateAssetNodeOptions {
  /** 长边上限；缺省 = fallback.width（既有 620 行为） */
  maxLongSide?: number;
  /** 无真实尺寸时的中性默认尺寸；缺省 = IMAGE_DEFAULT_SIZE */
  fallbackSize?: { width: number; height: number };
}

/**
 * 根据素材 payload 创建画布节点
 *
 * 异步: 若资产无 storageKey,需先将内容存入 localforage(生成缩略图)。
 *
 * @param payload 素材数据(kind/title/url 或 content/storageKey 等)
 * @param position 节点在世界坐标的位置(drop 落点或点击插入位置)
 * @param options 图片尺寸选项（不传 = 既有行为；尺寸仍由 computeNodeSize 单一函数计算）
 * @returns NodeRecord(可直接传给 AddNodeCommand),若 kind 未知返回 null
 */
export async function createAssetNode(
  payload: AssetNodePayload,
  position: { x: number; y: number },
  options: CreateAssetNodeOptions = {},
): Promise<NodeRecord | null> {
  const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  switch (payload.kind) {
    case 'image': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.dataUrl;
      let naturalWidth = payload.width;
      let naturalHeight = payload.height;

      // 无 storageKey(data URL 或裸 blob URL)→ 存入 localforage,生成 storageKey + 缩略图
      if (!storageKey && payload.dataUrl) {
        try {
          const stored = await uploadImage(payload.dataUrl);
          storageKey = stored.storageKey;
          contentUrl = stored.url;
          if (!naturalWidth) naturalWidth = stored.width;
          if (!naturalHeight) naturalHeight = stored.height;
        } catch (err) {
          console.warn('[createAssetNode] image uploadImage failed, using raw dataUrl:', err);
        }
      }

      const size = computeNodeSize(
        naturalWidth,
        naturalHeight,
        options.fallbackSize ?? IMAGE_DEFAULT_SIZE,
        options.maxLongSide,
      );
      return {
        id,
        type: 'image',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          naturalWidth,
          naturalHeight,
          title: payload.title,
        },
      };
    }

    case 'video': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.url;
      let naturalWidth = payload.width;
      let naturalHeight = payload.height;

      // 无 storageKey(裸 blob URL)→ 存入 localforage,生成 storageKey
      if (!storageKey && payload.url) {
        try {
          const stored = await uploadMediaFile(await (await fetch(payload.url)).blob(), 'video');
          storageKey = stored.storageKey;
          contentUrl = stored.url;
          if (!naturalWidth) naturalWidth = stored.width;
          if (!naturalHeight) naturalHeight = stored.height;
        } catch (err) {
          console.warn('[createAssetNode] video uploadMediaFile failed, using raw url:', err);
        }
      }

      const size = computeNodeSize(naturalWidth, naturalHeight, VIDEO_DEFAULT_SIZE);
      return {
        id,
        type: 'video',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          naturalWidth,
          naturalHeight,
          durationMs: payload.durationMs,
          title: payload.title,
        },
      };
    }

    case 'audio': {
      let storageKey = payload.storageKey;
      let contentUrl = payload.url;

      // 无 storageKey(裸 blob URL)→ 存入 localforage
      if (!storageKey && payload.url) {
        try {
          const stored = await uploadMediaFile(await (await fetch(payload.url)).blob(), 'audio');
          storageKey = stored.storageKey;
          contentUrl = stored.url;
        } catch (err) {
          console.warn('[createAssetNode] audio uploadMediaFile failed, using raw url:', err);
        }
      }

      // 音频气泡固定尺寸(读 audio 扩展契约 360×96,非 16:9)
      const size = AUDIO_DEFAULT_SIZE;
      return {
        id,
        type: 'audio',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          prompt: payload.title,
          content: contentUrl,
          storageKey,
          status: 'success',
          durationMs: payload.durationMs,
          title: payload.title,
        },
      };
    }

    case 'text': {
      // FIX-5 防御:超长文本拒绝创建节点(主入口已拦截,此处兜底防拖拽等旁路)
      if (payload.content.length > TEXT_MAX_LENGTH) return null;
      const size = TEXT_DEFAULT_SIZE;
      return {
        id,
        type: 'text',
        position: centerPosition(position, size),
        size,
        title: payload.title,
        data: {
          content: payload.content,
          prompt: '',
          status: 'idle',
          title: payload.title,
        },
      };
    }

    default:
      return null;
  }
}

// ===== 内部辅助 =====

/**
 * 根据素材原始尺寸计算节点尺寸（容器等比 fit，2026-11-04 修复「导入过大/比例失真」）。
 * 规则: 最长边上限 = fallback.width(620)——超过才缩小,小图保持原始尺寸不放大;
 * 短边低于 MEDIA_MIN_SIZE 时等比放大到下限。宽高比恒不变、不裁切、不拉伸。
 * 例: 1:1 1024² → 620×620；16:9 → 620×349；9:16 → 349×620；100×40 小图 → 100×40。
 * 无原始尺寸时回退 fallback;元数据错误由 ImageNodeView 的 onload 纠偏兜底。
 * 实现委托 utils/media-fit.ts(单一事实源,纯函数可单测)。
 */
function computeNodeSize(
  naturalWidth?: number,
  naturalHeight?: number,
  fallback: { width: number; height: number } = IMAGE_DEFAULT_SIZE,
  maxLongSide?: number,
): { width: number; height: number } {
  return fitContainSize(naturalWidth, naturalHeight, {
    maxLongSide: maxLongSide ?? fallback.width,
    minShortSide: MEDIA_MIN_SIZE.height,
  }) ?? fallback;
}

/** 节点位置直接使用拖拽点作为左上角(用户直观期望) */
function centerPosition(
  pos: { x: number; y: number },
  _size: { width: number; height: number },
): { x: number; y: number } {
  return { x: pos.x, y: pos.y };
}
