/**
 * importOpenLibEntry - 开源素材「缓存 + 引用」入口（2026-11-05 重做；同日补 CDN 失败降级）
 *
 * 铁律：开源素材被使用时只做「下载 → CAS 缓存 + 引用」，禁止写入用户资产索引
 * （不得 addAsset 进「我的资产库」）。节点/导演台槽位通过 storageKey 引用缓存文件。
 *
 * - 原图按需从 cdnUrl 拉取（OpenLibEntry.cdnUrl 语义即「原图按需拉取并缓存到用户 CAS」）
 * - CDN 拉不到（网络中断/跨域被拦/离线/HTTP 错误）→ 降级用随站点同源打包的缩略图
 *   （bundled 条目才有，同源不会再被跨域拦），返回引用带 quality='local-thumb' 降级标记，
 *   UI 据此提示「已使用本地缩略图（高清原图不可用）」；remote 条目无本地缩略图 → 可读报错
 * - 所有 fetch 失败都翻译成带 name/message 的可读文案（不允许只剩一行 Failed to fetch 在控制台）
 * - CAS ref 使用稳定合成 id `openlib:<entryId>`（同一开源条目重复发送幂等，不产生重复 ref）
 * - 返回的 Asset 为一次性引用对象（未登记资产库），供画布插入/导演台发送/@ 面板插入共用
 *   （发送到画布与发送到导演台共用本函数，降级策略天然两路一致）
 * - 失败直接抛错，由调用方（importAndSend）统一 message.error，禁止静默
 */
import { readImageDims, stageCasUpload } from '@/features/asset-picker/services/cas-upload.js';
import { registerCasRef } from '@/entities/cas-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { openLibSiteUrl } from './open-library.js';
import type { OpenLibEntry } from './open-library.js';

/** 开源素材合成资产 id 前缀（同时作为 CAS ref assetId，稳定可去重） */
export const OPENLIB_ASSET_PREFIX = 'openlib:';

/** 引用媒体质量标记：origin = 源站高清原图；local-thumb = 同源打包缩略图（CDN 不可用降级） */
export type OpenLibImportQuality = 'origin' | 'local-thumb';

/** fetch 抛错翻译成可读文案（TypeError: Failed to fetch 浏览器不附带任何原因，必须补话术） */
function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const hint = err instanceof TypeError ? '（网络中断/跨域被拦/离线）' : '';
    return `${err.name}: ${err.message}${hint}`;
  }
  return String(err);
}

/** 拉取一张图：fetch 抛错 / HTTP 非 2xx / 读 body 失败都归一为带场景的可读错误 */
async function fetchImageBlob(url: string, failLabel: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`${failLabel}：${describeFetchError(err)}`);
  }
  if (!res.ok) throw new Error(`${failLabel}（HTTP ${res.status}）`);
  try {
    return await res.blob();
  } catch (err) {
    throw new Error(`${failLabel}：${describeFetchError(err)}`);
  }
}

/**
 * bundled 条目的同源缩略图 URL（cdnUrl 拿不到高清原图时的降级源）。
 * remote 条目只有 CDN 引用、没有随站点打包的缩略图 → null（降级不可用）。
 */
function localThumbUrl(entry: OpenLibEntry): string | null {
  if (entry.storage !== 'bundled') return null;
  if (!entry.imageUrl || /^https?:/i.test(entry.imageUrl)) return null;
  return openLibSiteUrl(entry.imageUrl);
}

export async function importOpenLibEntry(entry: OpenLibEntry): Promise<Asset> {
  // ① 源站高清原图；失败 → ② 同源打包缩略图降级；再失败 → 可读报错（无可用媒体源）
  let blob: Blob;
  let quality: OpenLibImportQuality = 'origin';
  try {
    blob = await fetchImageBlob(entry.cdnUrl, `开源图「${entry.title}」源站原图下载失败`);
  } catch (cdnError) {
    const thumbUrl = localThumbUrl(entry);
    if (!thumbUrl) {
      throw new Error(
        `${cdnError instanceof Error ? cdnError.message : String(cdnError)}；该条目没有随站点打包的本地缩略图，无法降级`,
      );
    }
    blob = await fetchImageBlob(thumbUrl, `开源图「${entry.title}」本地缩略图下载失败`);
    quality = 'local-thumb';
  }

  // CAS ref 使用稳定合成 id（同一开源条目重复发送幂等，不产生重复 ref）
  const stableId = OPENLIB_ASSET_PREFIX + entry.id;
  const staged = await stageCasUpload(blob, 'image', { projectId: 'library', assetId: stableId });
  // 真实宽高随引用一并带上：画布新建节点按比例出（避免 620×348 默认容器造成黑边）
  const dims = await readImageDims(blob);
  // 存量资产去重命中（dedupedExistingAsset）时 stage 侧不挂新 ref：
  // 这里统一补挂 openlib 引用，保证缓存文件始终被节点/槽位引用持有（sameRef 幂等，不会重复）
  await registerCasRef(staged.cas.hash, {
    assetId: stableId,
    projectId: 'library',
    kind: 'image',
  });
  return {
    id: stableId,
    title: entry.title,
    kind: 'image',
    createdAt: new Date().toISOString(),
    bytes: staged.bytes,
    mimeType: staged.mimeType,
    scope: 'library',
    data: {
      kind: 'image',
      dataUrl: '',
      storageKey: staged.storageKey,
      quality,
      ...(dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : {}),
      sourceEntry: { source: 'openlib', galleryId: entry.gallery, entryId: entry.id },
    },
  } as Asset;
}
