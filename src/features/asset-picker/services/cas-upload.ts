/**
 * CAS 上传服务（2026-11-04）
 *
 * 本地上传链路的内容寻址入口：先流式 sha256 → 命中已有资产直接复用（不注册新 ref、
 * addAssets 会按同 storageKey 跳过创建）→ 未命中则 putCas 落 media/cas/<hash>.<ext>
 * 并以预生成资产 id 注册 ref（addAsset/addAssets 原样采纳该 id，ref 不悬空）。
 *
 * 说明：不再经 plugin-persistence 的 image_files/media_files 桶落第二份字节；
 * 读取由 disk-driver 对 cas: 键穿透到 media/cas/ 实际文件。
 *
 * 2026-11-06（征集 #186）：本入口现在自动完成压缩与编码——一次解码产出 thumb(96px)/preview(1024px)
 * 两档 JPEG，落到 media/cas/<hash>.<variant>.jpg；解析侧 resolve-media-blob 按档读取。
 * 所有走 CAS 的入口（本地上传、拖拽、开源库入库、AI 产物落库、晋升公共库）自动覆盖。
 * 派生档缺失（存量数据 / 编码失败）时零迁移回退原图，绝不阻断入库。
 */
import { nanoid } from 'nanoid';
import { generateImageVariantBlobs, casVariantPath } from '@zeroexo/plugin-persistence';
import { putCas, registerCasRef, releaseCas, sha256Hex, casStorageKey, type CasRef } from '@/entities/cas-store.js';
import { writeFileBlob } from '@/platform/fs.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { resolveMediaUrl } from '@/platform/media.js';
import { listAssets, addAsset } from '../asset-store.js';
import type { Asset, AssetKind } from '../index.js';

export interface CasStageResult {
  /** 新内容：预生成资产 id（已注册进 cas_index refs）；命中已有资产：undefined（未注册新 ref） */
  id?: string;
  cas: { hash: string; ext: string };
  storageKey: string;
  bytes: number;
  mimeType: string;
  /** true = 同内容已有资产记录，本次复用其 storageKey（调用方照常构造 input，addAssets 会去重跳过） */
  dedupedExistingAsset: boolean;
}

function extFromMime(kind: AssetKind, mime: string): string {
  const sub = (mime.split('/')[1] ?? '').toLowerCase().split(';')[0]!.trim();
  const table: Record<string, string> = {
    jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', 'svg+xml': 'svg', avif: 'avif',
    mp4: 'mp4', quicktime: 'mov', webm: 'webm', 'x-matroska': 'mkv',
    mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', aac: 'aac', ogg: 'ogg', opus: 'opus', flac: 'flac',
  };
  return table[sub] ?? (kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3');
}

/**
 * 图片入库即派生两档（一次解码 → thumb + preview，避免旧链路 3 次解码）。
 * 非图片 / 矢量 / 解码失败 / 写盘失败一律静默跳过：派生档是加速缓存，缺失由原图兜底。
 */
async function ensureCasImageVariants(file: Blob, hash: string): Promise<void> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return;
  const generated = await generateImageVariantBlobs(file).catch(() => null);
  if (!generated) return;
  await Promise.allSettled(
    (['thumb', 'preview'] as const).map(async (variant) => {
      const blob = generated[variant];
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await writeFileBlob(casVariantPath(hash, variant), bytes, 'image/jpeg');
    }),
  );
}

/**
 * 将文件字节纳入 CAS：
 * 1. 流式算 sha256；
 * 2. 已有同 hash 资产 → 复用其 cas/storageKey（不注册新 ref；存量派生档缺失时按原图兜底）；
 * 3. 否则预生成资产 id 并 putCas（findOrCreate：并发同 hash 只一份物理文件），
 *    图片随即按统一档位契约压缩编码出 thumb/preview 两档。
 */
export async function stageCasUpload(
  file: Blob,
  kind: 'image' | 'video' | 'audio',
  ctx: { projectId?: string; assetId?: string } = {},
): Promise<CasStageResult> {
  const mimeType = file.type || (kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/mpeg');
  const hash = await sha256Hex(file);

  // 存量资产去重：同内容已有资产记录 → 复用其引用，不产生新 ref / 新记录
  const existing = (await listAssets()).find((a) => a.cas?.hash === hash);
  if (existing?.cas) {
    return {
      cas: existing.cas,
      storageKey: casStorageKey(hash, existing.cas.ext),
      bytes: existing.bytes,
      mimeType: existing.mimeType ?? mimeType,
      dedupedExistingAsset: true,
    };
  }

  const id = ctx.assetId ?? nanoid();
  const ref: CasRef = { assetId: id, projectId: ctx.projectId ?? getCurrentCanvasId() ?? 'library', kind };
  const put = await putCas({ data: file, mime: mimeType, ext: extFromMime(kind, mimeType), ref });
  // 任何经本入口传入的图片都自动完成压缩 + 编码（失败静默，零迁移回退原图）
  if (kind === 'image') await ensureCasImageVariants(file, hash);
  return {
    id,
    cas: { hash, ext: put.ext },
    storageKey: put.storageKey,
    bytes: put.size,
    mimeType,
    dedupedExistingAsset: false,
  };
}

/**
 * 「加入资产库」（2026-11-04 抽屉历史分组）：把项目资产晋升/复制一条公共库记录。
 * 全程不复制第二份字节——
 * - 有 cas 引用：仅 registerCasRef 给新资产 id 补挂一条 ref（refCount+1）；
 * - 存量无 cas：读原文件字节走 stageCasUpload 入 CAS（同 hash 天然去重）；
 * - 公共库已有同 hash 资产 → 返回 null（调用方提示「已存在」）。
 * 返回新建的公共库资产；已存在/不可晋升时返回 null。
 */
export async function promoteAssetToLibrary(asset: Asset): Promise<Asset | null> {
  if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio') return null;
  const d = asset.data as { storageKey?: string; width?: number; height?: number; durationMs?: number };

  // 公共库同内容去重（hash 口径）
  if (asset.cas?.hash) {
    const twin = (await listAssets()).find(
      (a) => (a.scope ?? 'library') === 'library' && a.cas?.hash === asset.cas!.hash,
    );
    if (twin) return null;
  }

  let id: string;
  let cas: { hash: string; ext: string };
  let storageKey: string;
  let bytes = asset.bytes;
  let mimeType = asset.mimeType ?? (asset.kind === 'image' ? 'image/png' : asset.kind === 'video' ? 'video/mp4' : 'audio/mpeg');

  if (asset.cas) {
    id = nanoid();
    cas = asset.cas;
    storageKey = casStorageKey(cas.hash, cas.ext);
    await registerCasRef(cas.hash, { assetId: id, projectId: 'library', kind: asset.kind });
  } else {
    // 存量资产无 cas 字段：读字节入 CAS（同内容天然只落一份物理文件）
    const url = await resolveMediaUrl(d.storageKey);
    if (!url) throw new Error(`无法读取资产文件: ${asset.title}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法读取资产文件: HTTP ${res.status}`);
    const staged = await stageCasUpload(await res.blob(), asset.kind, { projectId: 'library' });
    cas = staged.cas;
    storageKey = staged.storageKey;
    bytes = staged.bytes;
    mimeType = staged.mimeType;
    // 公共库已有同 hash 资产 → 不重复建；若 stage 已注册过 ref 需摘掉（不遗留悬空引用）
    const libTwin = (await listAssets()).find(
      (a) => (a.scope ?? 'library') === 'library' && a.cas?.hash === cas.hash,
    );
    if (libTwin) {
      if (!staged.dedupedExistingAsset && staged.id) {
        await releaseCas(cas.hash, { assetId: staged.id, projectId: 'library' }).catch(() => undefined);
      }
      return null;
    }
    if (staged.dedupedExistingAsset) {
      // 同内容已有其他作用域的资产记录（stage 未注册新 ref）：为公共库记录补挂 ref
      id = nanoid();
      await registerCasRef(cas.hash, { assetId: id, projectId: 'library', kind: asset.kind });
    } else {
      id = staged.id!;
    }
  }

  const data: Asset['data'] =
    asset.kind === 'image'
      ? { kind: 'image', dataUrl: '', storageKey, width: d.width, height: d.height }
      : asset.kind === 'video'
        ? { kind: 'video', url: '', storageKey, width: d.width, height: d.height, durationMs: d.durationMs }
        : { kind: 'audio', url: '', storageKey, durationMs: d.durationMs };

  try {
    return await addAsset({
      id,
      cas,
      title: asset.title,
      kind: asset.kind,
      bytes,
      mimeType,
      data,
      scope: 'library',
    });
  } catch (err) {
    // addAsset 失败时摘掉刚挂的 ref，不遗留悬空引用
    await releaseCas(cas.hash, { assetId: id, projectId: 'library' }).catch(() => undefined);
    throw err;
  }
}

/** 读图片宽高（createImageBitmap；失败回退 0x0，不阻断上传） */
export async function readImageDims(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** 读视频宽高+时长 / 音频时长（元素 onloadedmetadata；失败回退默认，不阻断上传） */
export function readMediaMeta(
  blob: Blob,
  kind: 'video' | 'audio',
): Promise<{ width?: number; height?: number; durationMs?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const done = (meta: { width?: number; height?: number; durationMs?: number }): void => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    if (kind === 'video') {
      const video = document.createElement('video');
      const finish = (): void =>
        done({
          width: video.videoWidth || 1280,
          height: video.videoHeight || 720,
          durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
        });
      video.onloadedmetadata = finish;
      video.onerror = () => done({ width: 1280, height: 720 });
      video.src = url;
      return;
    }
    const audio = document.createElement('audio');
    const finish = (): void =>
      done({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
    audio.onloadedmetadata = finish;
    audio.onerror = () => done({});
    audio.src = url;
  });
}
