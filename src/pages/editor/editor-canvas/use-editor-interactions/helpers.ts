/**
 * helpers - 独立工具函数
 *
 * 从 use-editor-interactions.ts 提取的 standalone 函数，
 * 不依赖 React hooks 或闭包。
 */

import type { NodeRecord } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import { resolveContentUrl, IMAGE_FIT_BOX, fitMediaSize } from '@zeroexo/plugin-nodes';
import { getMediaBlob } from '@/platform/media.js';
import { fetchGuideBlob } from '@/shared/utils/guide-file.js';
import { downloadFilesAsZip } from '@/features/asset-picker/services/download-asset.js';
import { serializeScriptContent } from '@/features/asset-picker/services/upload-asset.js';

// 画布提示词面板常见的比例档位 → 宽/高比值（与参数面板同一张表）
const IMAGE_ASPECT_RATIO: Record<string, number> = {
  '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16,
  '2:3': 2 / 3, '3:2': 3 / 2, '21:9': 21 / 9, '3:2 ': 3 / 2,
};

/**
 * 参数面板的 size / aspect → 真正提交给生成器的像素尺寸。
 * 2026-11-17 用户实测：面板选 1:1，出图仍是宽的 —— 本地链路此前只读 nodeData.width/height（旧值），
 * 参数面板里的选择根本没进请求。规则：size（如 "1024x1024"）优先，其次 aspect 比例（1024 基准、16 对齐）。
 */
export function resolveRequestedImageSize(
  pv: Record<string, unknown> | undefined,
  fallback?: { width: number; height: number },
): { width: number; height: number } {
  // 参数面板（Qwen/Moss/Krea2）改尺寸时写的是数值 width/height；
  // 历史上还残留过 size:"1024x768" 字符串，若优先读它，用户重新选 9:16 也会按旧值出 4:3。
  // 因此数值尺寸先行，size 字符串只作为没有数值时的兜底。
  const pw = Number(pv?.width);
  const ph = Number(pv?.height);
  if (Number.isFinite(pw) && Number.isFinite(ph) && pw > 0 && ph > 0) return { width: pw, height: ph };
  const sizeStr = typeof pv?.size === 'string' ? pv.size : '';
  const matched = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(sizeStr);
  if (matched) {
    const w = Number(matched[1]);
    const h = Number(matched[2]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  const aspect = typeof pv?.aspect === 'string' ? pv.aspect.trim() : '';
  const ratio = aspect ? IMAGE_ASPECT_RATIO[aspect] : undefined;
  if (ratio) {
    const align = (n: number): number => Math.max(64, Math.round(n / 16) * 16);
    // 参数面板还可选「百万像素」档（2 = 约 200 万像素）：按比例换算长边，缺省 1024
    const mp = Number(pv?.megapixels);
    const pixels = Number.isFinite(mp) && mp > 0 ? mp * 1_048_576 : 1024 * 1024;
    const longSide = align(Math.sqrt(pixels * Math.max(1, ratio)));
    return ratio >= 1
      ? { width: longSide, height: align(longSide / ratio) }
      : { width: align(longSide * ratio), height: longSide };
  }
  if (fallback?.width && fallback?.height) return { width: fallback.width, height: fallback.height };
  return { width: 1024, height: 1024 };
}

// ===== 反推提示词预设 =====
export const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

// 节点类型 → 输入/输出引脚 id
export const NODE_INPUT_PIN: Record<string, string> = { text: 'input', image: 'prompt', video: 'prompt', audio: 'prompt' };
export const NODE_OUTPUT_PIN: Record<string, string> = { text: 'output', image: 'image', video: 'video', audio: 'audio' };

/** 支持下载的类型 */
const DOWNLOADABLE_TYPES = ['text', 'image', 'video', 'audio', 'script'];

/** 节点是否可下载 */
export function isNodeDownloadable(node: NodeRecord): boolean {
  if (!DOWNLOADABLE_TYPES.includes(node.type)) return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  const hasContent = !!((data.content as string | undefined)?.trim());
  const hasStorageKey = !!((data.storageKey as string | undefined)?.trim());
  const hasEpisodes = !!((data.episodes as unknown[] | undefined)?.length);
  return hasContent || hasStorageKey || (node.type === 'script' && hasEpisodes);
}

/** 触发浏览器下载 */
export function triggerAnchorDownload(url: string, filename: string, revoke = false): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revoke) URL.revokeObjectURL(url);
}

/**
 * 生成结果 → 图片节点尺寸（与 image-node-view 的 onload 校正同一规则）：
 * 按原图比例重算宽高，长边 ≤ maxLong、短边 ≥ minShort。
 * 2026-11-11 修复：Krea2/Qwen 返回后节点仍停在旧比例，图片被 contain 出黑边。
 */
export function fitImageNodeSize(
  currentWidth: number,
  naturalWidth: number,
  naturalHeight: number,
  _maxLong = 0,
  minShort = 120,
): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) return { width: currentWidth, height: currentWidth };
  // 统一规则（2026-11-18）：等比装进 620×348 展示框，与空节点/拖入/替换/发送完全同一尺寸。
  return fitMediaSize(naturalWidth, naturalHeight, IMAGE_FIT_BOX, minShort);
}

/** 下载单个节点内容（withGuide=true 时附带本机 H3 引导数据 .safetensors） */export async function downloadNodeAsFile(
  node: NodeRecord,
  opts?: { withGuide?: boolean },
): Promise<{ ok: boolean; guideOk?: boolean }> {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (node.type === 'script') {
    const text = serializeScriptContent(node);
    if (!text.trim()) return { ok: false };
    triggerAnchorDownload(
      URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })),
      `${(node.title ?? '剧本').trim() || '剧本'}.txt`,
      true,
    );
    return { ok: true };
  }
  if (node.type === 'text') {
    const text = (data.content as string) ?? '';
    if (!text.trim()) return { ok: false };
    triggerAnchorDownload(
      URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })),
      `${(node.title ?? '文本').trim() || '文本'}.txt`,
      true,
    );
    return { ok: true };
  }
  const content = (data.content as string | undefined) ?? '';
  const storageKey = data.storageKey as string | undefined;
  if (!content && !storageKey) return { ok: false };
  const mimeType = (data.mimeType as string) || '';
  const ext = mimeType
    ? (mimeType.split('/')[1] || 'bin')
    : (node.type === 'image' ? 'png' : node.type === 'video' ? 'mp4' : node.type === 'audio' ? 'mp3' : 'bin');
  const baseName = (node.title ?? '').trim();
  let filename = baseName ? `${baseName}.${ext}` : '';
  if (!filename) {
    const now = new Date();
    const pad = (n: number): string => n.toString().padStart(2, '0');
    filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${ext}`;
  }
  // 2026-11-07：优先按 storageKey 直接读盘/CAS（content 可能是不再有效的 blob: 会话地址）
  let blob: Blob | null = null;
  if (storageKey) blob = await getMediaBlob(storageKey).catch(() => null);
  if (!blob?.size && storageKey) {
    const resolved = await resolveContentUrl(storageKey, content).catch(() => '');
    if (resolved) {
      const res = await fetch(resolved).catch(() => null);
      if (res?.ok) blob = await res.blob().catch(() => null);
    }
  }
  if (!blob?.size && content && !content.startsWith('blob:')) {
    const res = await fetch(content).catch(() => null);
    if (res?.ok) blob = await res.blob().catch(() => null);
  }
  if (!blob?.size) return { ok: false };
  const guide = opts?.withGuide ? (data.guide as { id?: string; baseUrl?: string } | undefined) : undefined;
  // 引导按「当前连接地址 → 产出时的地址 → 节点 localJob.base」逐个试，换地址/重启后仍能打包
  const guideRef = guide?.id
    ? {
        ...guide,
        baseUrl: guide.baseUrl ?? (data.localJob as { base?: string } | undefined)?.base,
      }
    : undefined;
  const guideBlob = guideRef ? await fetchGuideBlob(guideRef).catch(() => null) : null;
  // 下载即回填本地缓存：老产物（生成时还没做自动缓存）也能在云端清盘前落到 media/guides
  if (guideBlob && guideRef?.id) {
    void import('@/entities/guide-store.js').then((m) => m.writeGuideBlob(guideRef.id!, guideBlob)).catch(() => undefined);
  }
  if (guideBlob) {
    const zipBase = (baseName || '视频').replace(/[\\/:*?"<>|]+/g, '_').trim() || '视频';
    await downloadFilesAsZip(
      [{ blob, filename }, { blob: guideBlob, filename: `${zipBase} 引导.safetensors` }],
      zipBase,
    );
    return { ok: true, guideOk: true };
  }
  triggerAnchorDownload(URL.createObjectURL(blob), filename, true);
  return { ok: true, guideOk: opts?.withGuide ? false : undefined };
}

/** 分镜列锚点：取剧本下游已连分镜中最靠下的一个 */
export function storyboardColumnAnchor(
  graph: { nodes: Array<{ id: string; type: string; position: { x: number; y: number }; size?: { width: number; height: number } }>; edges: Array<{ source: unknown; target: unknown }> },
  scriptNode: { id: string; position: { x: number; y: number }; size?: { width: number; height: number } },
): { position: { x: number; y: number }; size?: { width: number; height: number } } {
  const downstream = new Set<string>();
  for (const e of graph.edges) {
    const src = typeof e.source === 'object' && e.source !== null ? (e.source as { nodeId?: string }).nodeId : e.source;
    if (src !== scriptNode.id) continue;
    const tgt = typeof e.target === 'object' && e.target !== null ? (e.target as { nodeId?: string }).nodeId : e.target;
    if (typeof tgt === 'string') downstream.add(tgt);
  }
  let bottom: { position: { x: number; y: number }; size?: { width: number; height: number } } | null = null;
  for (const n of graph.nodes) {
    if (n.type !== 'storyboard' || !downstream.has(n.id)) continue;
    const bottomEdge = (bottom?.position.y ?? -Infinity) + (bottom?.size?.height ?? 0);
    if (!bottom || (n.position.y + (n.size?.height ?? 0)) > bottomEdge) bottom = n;
  }
  return bottom ?? scriptNode;
}

/** content 转为 dataUrl */
export async function contentToDataUrl(content: string): Promise<string> {
  if (content.startsWith('data:')) return content;
  if (content.startsWith('blob:')) {
    // blob: 地址刷新/被回收后会失效，fetch 直接抛 TypeError: Failed to fetch。
    // 参考图转换失败只能返回空串（上层退回 storageKey），绝不能把整次生成打断。
    try {
      const res = await fetch(content);
      if (!res.ok) return '';
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  }
  return content;
}

/** 剧本剧集 HTML → 纯文本 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 计算节点列表包围盒 */
export function computeNodesBounds(nodes: NodeRecord[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    const { width: w, height: h } = resolveNodeSize(n);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}