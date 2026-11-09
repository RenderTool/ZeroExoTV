/**
 * helpers - 独立工具函数
 *
 * 从 use-editor-interactions.ts 提取的 standalone 函数，
 * 不依赖 React hooks 或闭包。
 */

import type { NodeRecord } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import { resolveContentUrl } from '@zeroexo/plugin-nodes';
import { getMediaBlob } from '@/platform/media.js';
import { downloadGuideFile } from '@/shared/utils/guide-file.js';
import { serializeScriptContent } from '@/features/asset-picker/services/upload-asset.js';

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

/** 下载单个节点内容（withGuide=true 时附带本机 H3 引导数据 .safetensors） */
export async function downloadNodeAsFile(
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
  triggerAnchorDownload(URL.createObjectURL(blob), filename, true);
  if (opts?.withGuide) {
    const guide = data.guide as { id?: string } | undefined;
    const guideOk = guide?.id
      ? await downloadGuideFile(guide, `${baseName || '视频'} 引导`)
      : false;
    return { ok: true, guideOk };
  }
  return { ok: true };
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
    const res = await fetch(content);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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