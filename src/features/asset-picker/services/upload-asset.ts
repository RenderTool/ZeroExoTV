/**
 * 素材上传服务(Phase D2.2)
 *
 * 接收 File 对象,优先上传到后端(sharp 多尺寸管道),
 * 完成后端不可用时降级到 localforage 存储。
 *
 * 问题10 扩展: 统一素材保存/上传/插入/编辑复用逻辑
 * - assetInputFromNode: 节点 → CreateAssetInput(直接复用节点已有 storageKey,不重复上传)
 * - nodeDataPatchFromAssetInput: CreateAssetInput → 节点 data patch(供 replace/编辑复用)
 */

import {
  resolveTextContent,
} from '@zeroexo/plugin-persistence';
import type { NodeRecord } from '@zeroexo/core';
import type { Asset, AssetKind, GuideMeta } from '../index.js';
import type { CreateAssetInput } from '../asset-store.js';
import { uploadToBackend } from '@/services/backend-upload.js';
import { getToken } from '@/services/api-client.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { autoEpisodeTitle } from '@/entities/script-store.js';
import { stageCasUpload, readImageDims, readMediaMeta } from './cas-upload.js';

export class UnsupportedFileTypeError extends Error {
  constructor(public fileName: string, public mimeType: string) {
    super(`文件 "${fileName}" 的格式不支持。当前仅支持图片、视频、音频和文本文件。`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export class FileTooLargeError extends Error {
  constructor(public fileName: string, public size: number, public limit: string) {
    super(`文件 "${fileName}" 过大(${(size / 1024 / 1024).toFixed(1)}MB)，超出上传限制(${limit})。`);
    this.name = 'FileTooLargeError';
  }
}

/** 各类文件大小限制 */
const FILE_SIZE_LIMITS: Record<string, number> = {
  image: 50 * 1024 * 1024,   // 50MB
  video: 2 * 1024 * 1024 * 1024,  // 2GB
  audio: 500 * 1024 * 1024,  // 500MB
  text: 20 * 1024 * 1024,    // 20MB
};

/** 已知扩展名 → MIME 类型映射(用于扩展名校验,不信任浏览器 file.type) */
const EXTENSION_MIME_MAP: Record<string, string> = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'jfif': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'avif': 'image/avif',
  'heic': 'image/heic',
  'heif': 'image/heif',
  'bmp': 'image/bmp',
  'tif': 'image/tiff',
  'tiff': 'image/tiff',
  'svg': 'image/svg+xml',
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'ogg': 'video/ogg',
  'mkv': 'video/mkv',
  'mov': 'video/quicktime',
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'aac': 'audio/aac',
  'txt': 'text/plain',
  'md': 'text/markdown',
  'html': 'text/html',
  'htm': 'text/html',
  'json': 'application/json',
  'xml': 'text/xml',
  'csv': 'text/csv',
};

/** 根据文件扩展名推断 MIME 类型(当 file.type 为空时使用) */
function inferMimeType(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  return EXTENSION_MIME_MAP[ext] ?? null;
}

const SUPPORTED_MIME_TYPES = {
  // 2026-11-10 补齐常见图片格式：avif/heic/heif/tiff/jfif 之前会被判「格式不支持」
  image: [
    'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff', 'image/svg+xml',
  ],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska', 'video/mkv', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/aac'],
  text: ['text/plain', 'text/markdown', 'text/html', 'application/json'],
} as const;

const ALL_SUPPORTED_MIME_TYPES = [
  ...SUPPORTED_MIME_TYPES.image,
  ...SUPPORTED_MIME_TYPES.video,
  ...SUPPORTED_MIME_TYPES.audio,
  ...SUPPORTED_MIME_TYPES.text,
];

/** 智能读取文本文件:严格 UTF-8 优先,失败回落 GB18030(经验 #31,禁止裸 readAsText) */
async function readTextWithEncodingDetect(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    // 严格 UTF-8:非法字节序列会抛错,据此判定非 UTF-8 文件
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // GB18030 是 GBK/GB2312 超集,兼容 Windows 中文 txt 常见编码
    return new TextDecoder('gb18030').decode(buf);
  }
}

export function getSupportedFileTypes(): string {
  return [...ALL_SUPPORTED_MIME_TYPES, '.md'].join(',');
}

function isSupportedType(mimeType: string): boolean {
  return ALL_SUPPORTED_MIME_TYPES.includes(mimeType as typeof ALL_SUPPORTED_MIME_TYPES[number]);
}

export function detectKind(mimeType: string): AssetKind {
  if (SUPPORTED_MIME_TYPES.image.includes(mimeType as typeof SUPPORTED_MIME_TYPES.image[number])) return 'image';
  if (SUPPORTED_MIME_TYPES.video.includes(mimeType as typeof SUPPORTED_MIME_TYPES.video[number])) return 'video';
  if (SUPPORTED_MIME_TYPES.audio.includes(mimeType as typeof SUPPORTED_MIME_TYPES.audio[number])) return 'audio';
  if (SUPPORTED_MIME_TYPES.text.includes(mimeType as typeof SUPPORTED_MIME_TYPES.text[number])) return 'text';
  throw new UnsupportedFileTypeError('', mimeType);
}

export async function uploadAsset(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<CreateAssetInput> {
  // 1. 扩展名校验(不信任浏览器 file.type,防止 .ts→video/mp4 等误识别)
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && !EXTENSION_MIME_MAP[ext]) {
    throw new UnsupportedFileTypeError(file.name, `.${ext}`);
  }

  // 当 file.type 为空时从扩展名推断
  const effectiveMimeType = file.type || inferMimeType(file.name) || 'application/octet-stream';

  if (!isSupportedType(effectiveMimeType)) {
    throw new UnsupportedFileTypeError(file.name, effectiveMimeType);
  }

  const kind = detectKind(effectiveMimeType);
  const title = file.name;

  // 2. 文件大小校验
  const limit = FILE_SIZE_LIMITS[kind];
  if (limit && file.size > limit) {
    throw new FileTooLargeError(file.name, file.size, kind === 'image' ? '50MB' : kind === 'video' ? '2GB' : kind === 'audio' ? '500MB' : '20MB');
  }

  // 优先走后端(带 sharp 多尺寸管道)
  if (getToken()) {
    try {
      const backendResult = await uploadToBackend(file, onProgress);
      const common = {
        title,
        bytes: backendResult.bytes,
        mimeType: backendResult.mimeType,
        coverUrl: backendResult.storageKey,
      };
      if (kind === 'image') {
        return {
          ...common,
          kind: 'image',
          data: {
            kind: 'image',
            dataUrl: '',
            storageKey: backendResult.storageKey,
            width: backendResult.width,
            height: backendResult.height,
          },
        };
      }
      if (kind === 'video') {
        return {
          ...common,
          kind: 'video',
          data: {
            kind: 'video',
            url: '',
            storageKey: backendResult.storageKey,
            width: backendResult.width,
            height: backendResult.height,
          },
        };
      }
      if (kind === 'audio') {
        return {
          ...common,
          kind: 'audio',
          data: {
            kind: 'audio',
            url: '',
            storageKey: backendResult.storageKey,
          },
        };
      }
    } catch {
      // 后端上传失败,降级到本地存储
      console.warn('[uploadAsset] backend upload failed, falling back to localforage');
    }
  }

  // 显示源只认 storageKey：dataUrl / url 一律留空，绝不写 blob: 会话地址。
  // 旧实现把 URL.createObjectURL(file) 持久化进资产记录，刷新后必然成为死地址（破图），
  // 且清洗层剥掉后照样留下空字段；渲染层统一按 storageKey 重新解析落盘文件。

  // 降级:本地 CAS 存储（2026-11-04 内容寻址去重，替代 localforage 桶「每个资产各自一份文件」）
  // 字节只落 media/cas/<sha256>.<ext> 一份；资产记录持 cas 引用(hash+ext)+派生 cas: 键，
  // 读取由 disk-driver 穿透，渲染层零改动；同内容重复上传复用已有资产（不新增记录与 ref）
  if (kind === 'image') {
    const staged = await stageCasUpload(file, 'image');
    const dims = await readImageDims(file);
    return {
      id: staged.id,
      cas: staged.cas,
      title,
      kind: 'image',
      coverUrl: staged.storageKey,
      bytes: staged.bytes,
      mimeType: staged.mimeType,
      data: {
        kind: 'image',
        dataUrl: '',
        storageKey: staged.storageKey,
        width: dims.width,
        height: dims.height,
      },
    };
  }

  if (kind === 'video') {
    const staged = await stageCasUpload(file, 'video');
    const meta = await readMediaMeta(file, 'video');
    return {
      id: staged.id,
      cas: staged.cas,
      title,
      kind: 'video',
      coverUrl: staged.storageKey,
      bytes: staged.bytes,
      mimeType: staged.mimeType,
      data: {
        kind: 'video',
        url: '',
        storageKey: staged.storageKey,
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
      },
    };
  }

  if (kind === 'audio') {
    const staged = await stageCasUpload(file, 'audio');
    const meta = await readMediaMeta(file, 'audio');
    return {
      id: staged.id,
      cas: staged.cas,
      title,
      kind: 'audio',
      coverUrl: staged.storageKey,
      bytes: staged.bytes,
      mimeType: staged.mimeType,
      data: {
        kind: 'audio',
        url: '',
        storageKey: staged.storageKey,
        durationMs: meta.durationMs,
      },
    };
  }

  const content = await readTextWithEncodingDetect(file);
  return {
    title,
    kind: 'text',
    bytes: file.size,
    mimeType: effectiveMimeType,
    data: {
      kind: 'text',
      content,
    },
  };
}

export function getAssetStorageKey(asset: Asset): string | undefined {
  // text/script 均为纯元数据资产,无存储文件,不参与存储键/引用计数链路(同 storageKey 治理契约)
  if (asset.data.kind === 'text' || asset.data.kind === 'script') return undefined;
  return asset.data.storageKey;
}

/** 将剧本节点的 episodes 序列化为纯文本(用于下载) */
export function serializeScriptContent(node: NodeRecord): string {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const episodes = (data.episodes as Array<{ title?: string; content?: string }> | undefined) ?? [];
  if (episodes.length === 0) {
    // 兼容旧数据:直接使用 content 字段
    return (data.content as string) ?? '';
  }
  return episodes
    .map((ep, idx) => {
      // 2026-11-04：兜底标题统一 autoEpisodeTitle（按集号优先，无集号才退下标——修前下标自拼会在删集/乱序后错号）
      const heading = ep.title?.trim() || autoEpisodeTitle((ep as { number?: number }).number ?? idx + 1);
      const body = (ep.content ?? '').trim();
      return `${heading}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

/** 将剧本节点的 episodes 序列化为剧本资产契约 JSON(存入 kind='script' 资产的 content);
 *  与剧本编辑器「加入资产」链路同契约(资产库 script-card/handleOpenScriptAsset 按此解析集数) */
export function serializeScriptEpisodesJson(node: NodeRecord): string | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const episodes = (data.episodes as Array<{ id?: string; number?: number; title?: string; content?: string }> | undefined) ?? [];
  if (episodes.length === 0) return null;
  return JSON.stringify(episodes.map((ep, idx) => ({
    id: ep.id ?? `ep-${idx}`,
    number: ep.number ?? idx + 1,
    title: ep.title ?? '',
    content: ep.content ?? '',
  })));
}

export function assetInputFromNode(node: NodeRecord): CreateAssetInput | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const content = (data.content as string) ?? '';
  const storageKey = data.storageKey as string | undefined;
  const prompt = (data.prompt as string) ?? '';
  const title = prompt.slice(0, 24) || '画布素材';
  const bytes = (data.bytes as number) ?? 0;
  const mimeType = data.mimeType as string | undefined;

  if (node.type === 'text') {
    if (!content.trim()) return null;
    return {
      title,
      kind: 'text',
      coverUrl: undefined,
      bytes: content.length,
      mimeType: 'text/plain',
      data: { kind: 'text', content },
    };
  }

  if (node.type === 'script') {
    // 剧本节点 → 剧本资产(非文本):content 存 episodes JSON,资产库按剧本分组展示,
    // 可经剧本编辑器回读/回发画布(修复:发送剧本节点到资产却变成文本)
    const scriptJson = serializeScriptEpisodesJson(node);
    if (scriptJson) {
      const scriptTitle = (node.title ?? '剧本').slice(0, 24);
      return {
        title: scriptTitle,
        kind: 'script',
        coverUrl: undefined,
        bytes: new Blob([scriptJson]).size,
        mimeType: 'application/json',
        // 本地版（2026-11-02）：剧本按画布绑定（一个画布一个剧本）
        data: { kind: 'script', content: scriptJson, canvasId: getCurrentCanvasId() ?? undefined },
      };
    }
    // 无 episodes(旧数据/空节点)降级纯文本,避免保存失败无反馈;空内容仍拒保(返回 null)
    const scriptText = serializeScriptContent(node);
    if (!scriptText.trim()) return null;
    const scriptTitle = (node.title ?? '剧本').slice(0, 24);
    return {
      title: scriptTitle,
      kind: 'text',
      coverUrl: undefined,
      bytes: scriptText.length,
      mimeType: 'text/plain',
      data: { kind: 'text', content: scriptText },
    };
  }

  if (node.type === 'image') {
    if (!content) return null;
    const width = (data.naturalWidth as number) ?? (node.size?.width ?? 0);
    const height = (data.naturalHeight as number) ?? (node.size?.height ?? 0);
    return {
      title,
      kind: 'image',
      coverUrl: storageKey || content,
      bytes,
      mimeType: mimeType ?? 'image/png',
      data: {
        kind: 'image',
        dataUrl: storageKey ? '' : content,
        storageKey,
        width,
        height,
      },
    };
  }

  if (node.type === 'video') {
    if (!content) return null;
    const width = (data.naturalWidth as number) ?? (node.size?.width ?? 0);
    const height = (data.naturalHeight as number) ?? (node.size?.height ?? 0);
    const durationMs = data.durationMs as number | undefined;
    const guide = data.guide as GuideMeta | undefined;
    return {
      title,
      kind: 'video',
      coverUrl: undefined,
      bytes,
      mimeType: mimeType ?? 'video/mp4',
      data: {
        kind: 'video',
        url: content,
        storageKey,
        width,
        height,
        durationMs,
        ...(guide?.id ? { guide } : {}),
      },
    };
  }

  if (node.type === 'audio') {
    if (!content) return null;
    const durationMs = data.durationMs as number | undefined;
    return {
      title,
      kind: 'audio',
      coverUrl: undefined,
      bytes,
      mimeType: mimeType ?? 'audio/mpeg',
      data: {
        kind: 'audio',
        url: content,
        storageKey,
        durationMs,
      },
    };
  }

  return null;
}

/**
 * 节点 → CreateAssetInput（异步变体，覆盖 novel 长文本）。
 * novel 正文为工作区 text: 资源（Plan#74 Phase D），需先 resolveTextContent 取回正文再生成 kind:'text' 资产；
 * 其余类型透传同步的 assetInputFromNode。用于「保存到素材」入口。
 */
export async function buildNodeAssetInput(node: NodeRecord): Promise<CreateAssetInput | null> {
  if (node.type === 'novel') {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const storageKey = data.storageKey as string | undefined;
    if (!storageKey) return null;
    const content = await resolveTextContent(storageKey);
    if (!content.trim()) return null;
    const novelTitle = ((node.title as string) || '长文本').slice(0, 24);
    return {
      title: novelTitle,
      kind: 'text',
      coverUrl: undefined,
      bytes: content.length,
      mimeType: 'text/plain',
      data: { kind: 'text', content },
    };
  }
  return assetInputFromNode(node);
}

export function nodeDataPatchFromAssetInput(
  input: CreateAssetInput,
): Record<string, unknown> | null {
  if (input.data.kind === 'image') {
    return {
      content: input.data.dataUrl,
      storageKey: input.data.storageKey,
      naturalWidth: input.data.width,
      naturalHeight: input.data.height,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  if (input.data.kind === 'video') {
    return {
      content: input.data.url,
      storageKey: input.data.storageKey,
      naturalWidth: input.data.width,
      naturalHeight: input.data.height,
      durationMs: input.data.durationMs,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  if (input.data.kind === 'audio') {
    return {
      content: input.data.url,
      storageKey: input.data.storageKey,
      durationMs: input.data.durationMs,
      mimeType: input.mimeType,
      bytes: input.bytes,
      status: 'success',
    };
  }
  return null;
}
