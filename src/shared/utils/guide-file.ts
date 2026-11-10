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

/** 引导文件的 /view URL（无地址/非法 id 返回 null） */
export function guideViewUrl(guide: GuideMeta | { id?: string } | null | undefined): string | null {
  const base = useComfyuiEndpointStore.getState().address?.replace(/\/+$/, '');
  if (!base || !isGuideId(guide?.id)) return null;
  const qs = new URLSearchParams({
    filename: `${guide.id}.safetensors`,
    subfolder: GUIDE_SUBFOLDER,
    type: 'output',
  }).toString();
  return `${base}/view?${qs}`;
}

/** 取回引导文件字节（失败返回 null，调用方提示） */
export async function fetchGuideBlob(guide: GuideMeta | { id?: string } | null | undefined): Promise<Blob | null> {
  const url = guideViewUrl(guide);
  if (!url) return null;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const blob = await res.blob().catch(() => null);
  return blob?.size ? blob : null;
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
  guide: GuideMeta | { id?: string } | null | undefined,
  baseName: string,
): Promise<boolean> {
  const blob = await fetchGuideBlob(guide);
  if (!blob) return false;
  const name = (baseName ?? '').replace(/[\\/:*?"<>|]+/g, '_').trim() || guide?.id || 'guide';
  triggerDownload(blob, `${name}.safetensors`);
  return true;
}
