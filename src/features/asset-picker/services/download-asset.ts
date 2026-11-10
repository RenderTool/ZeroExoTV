/**
 * downloadAsset - 资产「下载」唯一实现（素材卡 / 历史卡 / 选择器共用）
 *
 * 2026-11-07 修复「点击下载视频没有任何反应」：
 * - 生成产物的 data.url / data.dataUrl 恒为空，真实文件只在 storageKey（image:/video:/audio:/cas:）；
 *   旧实现用 getResourceUrl(storageKey)（只认后端 resources/ 键）→ undefined → 静默 return。
 * - 这里统一走平台媒体层按 storageKey 读 Blob（磁盘/CAS），再触发浏览器下载；
 *   读不到时回退 dataUrl/url（非 blob:）或 resources/ 认证链。
 * - 返回 false 表示没有任何可下载文件，调用方必须给出可读提示（不再静默）。
 */

import type { Asset, GuideMeta } from '../index.js';
import { getMediaBlob } from '@/platform/media.js';
import { resolveContentUrl } from '@zeroexo/plugin-nodes';
import { fetchGuideBlob } from '@/shared/utils/guide-file.js';
import JSZip from 'jszip';

function extFromMime(mime: string | undefined, kind: string): string {
  const sub = (mime ?? '').split('/')[1]?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (kind === 'image') {
    if (sub === 'jpeg') return 'jpg';
    return sub || 'png';
  }
  if (kind === 'video') return sub || 'mp4';
  if (kind === 'audio') return sub || 'mp3';
  return sub || 'bin';
}

/** 文件名：标题去掉非法字符；已带同扩展名则不重复追加 */
function fileNameFor(asset: Asset, ext: string): string {
  const base = (asset.title ?? '下载').replace(/[\\/:*?"<>|]+/g, '_').trim() || '下载';
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立即 revoke 在部分浏览器会把尚未开始写盘的下载取消；延后一拍释放
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** 解析资产可下载文件（单下载与批量打包共用） */
export async function resolveAssetFile(asset: Asset): Promise<{ blob: Blob; filename: string } | null> {
  const data = asset.data;

  // 文本/剧本：内容即文件
  if (data.kind === 'text' || data.kind === 'script') {
    const ext = data.kind === 'script' ? 'json' : 'txt';
    return {
      blob: new Blob([data.content ?? ''], { type: 'text/plain;charset=utf-8' }),
      filename: fileNameFor(asset, ext),
    };
  }

  const ext = extFromMime(asset.mimeType, data.kind);
  const filename = fileNameFor(asset, ext);
  const storageKey = 'storageKey' in data ? data.storageKey : undefined;
  const fallback = data.kind === 'image' ? data.dataUrl : data.url;

  if (storageKey) {
    const blob = await getMediaBlob(storageKey).catch(() => null);
    if (blob?.size) return { blob, filename };
  }

  if (storageKey) {
    const url = await resolveContentUrl(storageKey, fallback ?? '').catch(() => '');
    if (url) {
      const res = await fetch(url).catch(() => null);
      if (res?.ok) {
        const blob = await res.blob().catch(() => null);
        if (blob?.size) return { blob, filename };
      }
    }
  }

  if (fallback && !fallback.startsWith('blob:')) {
    const res = await fetch(fallback).catch(() => null);
    if (res?.ok) {
      const blob = await res.blob().catch(() => null);
      if (blob?.size) return { blob, filename };
    }
  }

  return null;
}

/**
 * 下载资产文件。
 * @returns true = 已触发下载；false = 无文件可下载（调用方提示用户）
 */
export async function downloadAsset(asset: Asset): Promise<boolean> {
  const file = await resolveAssetFile(asset);
  if (!file) return false;
  triggerDownload(file.blob, file.filename);
  return true;
}

interface BundleFile { blob: Blob; filename: string }

/** 多文件只触发一次浏览器下载，规避连续 a.click 被浏览器多文件拦截 */
export async function downloadFilesAsZip(files: BundleFile[], filename: string): Promise<number> {
  if (files.length === 0) return 0;
  const zip = new JSZip();
  const used = new Map<string, number>();
  for (const file of files) {
    const n = (used.get(file.filename) ?? 0) + 1;
    used.set(file.filename, n);
    const dot = file.filename.lastIndexOf('.');
    const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
    const ext = dot > 0 ? file.filename.slice(dot) : '';
    zip.file(n === 1 ? file.filename : `${base} (${n})${ext}`, file.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  triggerDownload(blob, `${filename}.zip`);
  return files.length;
}

/** 视频 + 引导：打包成单个 zip（引导取不到时退回单文件下载，不丢视频） */
export async function downloadAssetWithGuide(
  asset: Asset,
  guide: GuideMeta | { id?: string } | null | undefined,
): Promise<{ ok: boolean; guideOk: boolean }> {
  const file = await resolveAssetFile(asset).catch(() => null);
  if (!file) return { ok: false, guideOk: false };
  const guideBlob = guide?.id ? await fetchGuideBlob(guide).catch(() => null) : null;
  if (!guideBlob) {
    triggerDownload(file.blob, file.filename);
    return { ok: true, guideOk: false };
  }
  const dot = file.filename.lastIndexOf('.');
  const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
  const count = await downloadFilesAsZip(
    [file, { blob: guideBlob, filename: `${base} 引导.safetensors` }],
    base,
  );
  return { ok: count > 0, guideOk: count > 1 };
}

/** 批量打包下载（生成产物 / 素材 / 历史共用，含每项自带引导）；返回成功打包的资产数 */
export async function downloadAssetsAsZip(assets: Asset[], filename = 'zeroexo-assets'): Promise<number> {
  const files: BundleFile[] = [];
  let count = 0;
  for (const asset of assets) {
    const file = await resolveAssetFile(asset).catch(() => null);
    if (!file) continue;
    files.push(file);
    count += 1;
    const guide = (asset.data as { guide?: { id?: string } } | undefined)?.guide;
    if (guide?.id) {
      const gb = await fetchGuideBlob(guide).catch(() => null);
      if (gb) {
        const dot = file.filename.lastIndexOf('.');
        const base = dot > 0 ? file.filename.slice(0, dot) : file.filename;
        files.push({ blob: gb, filename: `${base} 引导.safetensors` });
      }
    }
  }
  const packed = await downloadFilesAsZip(files, filename);
  return packed > 0 ? count : 0;
}
