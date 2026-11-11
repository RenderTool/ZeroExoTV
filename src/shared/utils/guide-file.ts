/**
 * guide-file —— 本机 H3 引导数据（safetensors）的取回与下载（2026-11-07）
 *
 * 引导数据落在 ComfyUI 的 `output/zeroexo/guides/gd_xxx.safetensors`，
 * 浏览器经 ComfyUI 原生 `/view` 读取（与视频产物同一取回通道）。
 * 「下载视频+引导」由打包下载统一入 zip；本文件保留单文件下载能力供其他入口使用。
 */

import type { GuideMeta } from '@/features/asset-picker/index.js';
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';

const GUIDE_ID_PATTERN = /^gd_[A-Za-z0-9_-]{4,64}$/;

/** guide 在 ComfyUI 输出目录中的相对位置（插件固定落点） */
const GUIDE_SUBFOLDER = 'zeroexo/guides';

/** guide id 合法性（防路径穿越；凡不是插件生成的 id 一律拒绝） */
export function isGuideId(id: string | undefined): id is string {
  return !!id && GUIDE_ID_PATTERN.test(id);
}

/** 引导文件的 /view URL 候选：当前连接地址优先，其次产出该引导时的地址（换地址/重启后仍可下载） */
export function guideViewUrls(guide: GuideMeta | { id?: string; baseUrl?: string } | null | undefined): string[] {
  if (!isGuideId(guide?.id)) return [];
  const qs = new URLSearchParams({
    filename: `${guide.id}.safetensors`,
    subfolder: GUIDE_SUBFOLDER,
    type: 'output',
  }).toString();
  const bases: string[] = [];
  const current = useComfyuiEndpointStore.getState().address?.replace(/\/+$/, '');
  const origin = (guide as { baseUrl?: string }).baseUrl?.replace(/\/+$/, '');
  if (current) bases.push(current);
  if (origin && !bases.includes(origin)) bases.push(origin);
  return bases.map((base) => `${base}/view?${qs}`);
}

/** 引导文件的 /view URL（无地址/非法 id 返回 null） */
export function guideViewUrl(guide: GuideMeta | { id?: string; baseUrl?: string } | null | undefined): string | null {
  return guideViewUrls(guide)[0] ?? null;
}

/** 取回引导文件字节（按候选地址逐个试；失败返回 null，调用方提示） */
export async function fetchGuideBlob(guide: GuideMeta | { id?: string; baseUrl?: string } | null | undefined): Promise<Blob | null> {
  for (const url of guideViewUrls(guide)) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;
    const blob = await res.blob().catch(() => null);
    if (blob?.size) return blob;
  }
  return null;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 下载引导数据为 `.safetensors`。
 * @returns true = 已触发下载；false = 文件不可取（调用方提示）
 */
export async function downloadGuideFile(
  guide: GuideMeta | { id?: string; baseUrl?: string } | null | undefined,
  baseName: string,
): Promise<boolean> {
  const blob = await fetchGuideBlob(guide);
  if (!blob) return false;
  const name = (baseName ?? '').replace(/[\\/:*?"<>|]+/g, '_').trim() || guide?.id || 'guide';
  triggerDownload(blob, `${name}.safetensors`);
  return true;
}
