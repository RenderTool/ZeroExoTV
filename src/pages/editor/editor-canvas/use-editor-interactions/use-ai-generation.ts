/**
 * use-ai-generation - AI 生成通用逻辑
 *
 * 提取: promptTitleSummary 等通用函数
 */

import { apiGet } from '@/services/api-client.js';
import { AddNodeCommand, AddEdgeCommand, BatchCommand, type Command } from '@zeroexo/core';
import type { NodeRecord } from '@zeroexo/core';
import type { ReferenceItem } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { resolveMediaUrl } from '@/platform/media.js';
import { contentToDataUrl, resolveRequestedImageSize } from './helpers.js';
import type { GenerationMode } from './types.js';
import {
  normalizeLocalModelKey,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';

/**
 * 同款复刻的模型归一（2026-11-18 用户报「点同款后 Qwen 被当成文生图」）：
 * 历史节点可能把模型写成展示名（qwen / QwenImage2.1 / Krea2 / Moss），
 * 这些值不等于本机 channel key，面板会按「只吃文字」处理并丢掉参考图。
 * 空模型的图片节点一律按本机 Qwen Image 2.1 复刻（图像编辑：文本 + 参考图）。
 */
function normalizeReplayModel(raw: string, nodeType?: string): string {
  return normalizeLocalModelKey(raw, nodeType);
}

/** 标题摘要(生成成功后用作节点/资产名称) */
export function promptTitleSummary(prompt: string): string {
  const text = (prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // 短提示词本身就是名字（「咖啡杯变成绿色」），不能再返回空；长提示词取前 30 字
  if (text.length <= 30) return text;
  return `${text.slice(0, 30).trim()}…`;
}

/** 构建模板参数，处理 fallback */
export function buildTemplateParams(
  mode: GenerationMode,
  nodeData: Record<string, unknown>,
): { params: Record<string, unknown>; fallback: { size?: { width: number; height: number }; quality?: string; count?: number; seconds?: number; vquality?: number; generateAudio?: boolean; format?: string; voice?: string; speed?: number; instructions?: string } } {
  const params: Record<string, unknown> = {};
  const fallback: any = {};

  if (mode === 'image' || mode === 'video') {
    params.width = (nodeData.width as number) ?? 1024;
    params.height = (nodeData.height as number) ?? 1024;
    fallback.size = { width: params.width as number, height: params.height as number };
    params.quality = nodeData.quality as string ?? 'standard';
    fallback.quality = params.quality;
    params.count = (nodeData.count as number) ?? 1;
    fallback.count = params.count;
  }
  if (mode === 'video') {
    params.seconds = (nodeData.seconds as number) ?? 5;
    fallback.seconds = params.seconds;
    params.vquality = nodeData.vquality as number ?? 5;
    fallback.vquality = params.vquality;
    params.generateAudio = (nodeData.generateAudio as boolean) ?? true;
    fallback.generateAudio = params.generateAudio;
    params.returnLastFrame = (nodeData.returnLastFrame as boolean) ?? true;
  }
  if (mode === 'audio') {
    params.voice = nodeData.voice as string;
    fallback.voice = params.voice;
    params.speed = (nodeData.speed as number) ?? 1.0;
    fallback.speed = params.speed;
    params.format = nodeData.format as string ?? 'mp3';
    fallback.format = params.format;
    params.instructions = nodeData.instructions as string;
    fallback.instructions = params.instructions;
  }

  return { params, fallback };
}

/**
 * 本机 H3 视频：参数面板把 aspect / scaleFactor / size / steps / seed / seconds 存在
 * node.data.paramValues，而 buildTemplateParams 只有 1024×1024 兜底。不合并就会恒生成 1:1
 * 且丢掉步数/种子/时长，这里统一给出提交用的尺寸、时长与参数。
 */
export function resolveLocalVideoRequest(
  nodeData: Record<string, unknown>,
  baseParams: Record<string, unknown>,
  fallbackSize?: { width: number; height: number },
  fallbackSeconds = 5,
): { size?: string; seconds: number; params: Record<string, unknown> } {
  const pv = (nodeData.paramValues ?? {}) as Record<string, unknown>;
  const size = typeof pv.size === 'string' && /^\d+\s*[x×]\s*\d+$/i.test(pv.size)
    ? pv.size
    : fallbackSize ? `${fallbackSize.width}x${fallbackSize.height}` : undefined;
  const seconds = Number(pv.seconds);
  return {
    size,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds,
    params: { ...baseParams, ...pv },
  };
}

/** 一键同款，复原完整生成链路 */
export async function handleReplayGeneration(
  nodeId: string,
  refs: {
    store?: any;
    commandQueue?: any;
  },
  state: {
    containerSize: { width: number; height: number };
  },
  t: (key: string, opts?: any) => string,
  message: {
    info: (msg: string) => void;
    warning: (msg: string) => void;
    success: (msg: string) => void;
  },
): Promise<{ nodeId: string; mode: string; prompt: string } | null> {
  const store = refs.store;
  const cq = refs.commandQueue;
  if (!store || !cq) return null;
  const srcNode = store.getGraph().nodes.find((n: any) => n.id === nodeId) as NodeRecord | undefined;
  const srcData = (srcNode?.data ?? {}) as Record<string, any>;
  const generationId = srcData?.generationId as string | undefined;
  const pv = (srcData.paramValues ?? {}) as Record<string, any>;
  const modelKey = String(srcData?.model ?? '');
  // 本机/插件链路（Qwen / Krea2 / H3）没有云端 AiGeneration 记录：generationId 只是 ComfyUI jobId，
  // 复刻参数就在节点自己的 model + paramValues 里，不能拿去查 /ai/generations。
  const isLocalNode = Boolean(srcData?.localJob)
    || modelKey.startsWith('zeroexo:')
    || (srcNode?.type === 'video' && Object.keys(pv).length > 0);
  if (!srcNode || (!generationId && !isLocalNode)) {
    message.info(t('editor.replayNoRecord'));
    return null;
  }

  let record: any;
  if (isLocalNode) {
    record = { prompt: srcData.prompt ?? srcData.generatedPrompt ?? '', params: { ...pv, _inputs: [] }, model: srcData.model };
  } else {
    try {
      record = await apiGet(`/ai/generations/${generationId}`);
    } catch {
      message.warning(t('editor.replayNoRecord'));
      return null;
    }
    if (!record) {
      message.warning(t('editor.replayNoRecord'));
      return null;
    }
  }

  const params = (record?.params ?? {}) as Record<string, any>;
  const graph = store.getGraph();
  const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // 同款节点按「这次生成的比例」出生：沿用产物像素尺寸定比例，避免 3:4 的图复制成 340×240 横卡
  const genSize = resolveRequestedImageSize(params, {
    width: Number(srcData?.naturalWidth) || (srcNode.size?.width ?? 340),
    height: Number(srcData?.naturalHeight) || (srcNode.size?.height ?? 240),
  });
  const ratio = genSize.width / genSize.height;
  const w = ratio >= 1 ? 340 : Math.max(140, Math.round(340 * ratio));
  const h = ratio >= 1 ? Math.max(140, Math.round(340 / ratio)) : 340;
  // 同级副本：保持源节点横坐标，往下顺排（与源节点同一列、互为兄弟），
  // 不往右侧下游列放，避免看起来像「接着上一张继续生成」。
  const srcH = Number(srcNode.size?.height) || 240;
  let newPos = { x: srcNode.position.x, y: srcNode.position.y + srcH + 48 };
  const occupied = (graph.nodes as Array<{ id?: string; position?: { x: number; y: number }; size?: { width?: number; height?: number }; _deleted?: boolean }>)
    .filter((n) => !n._deleted && n.id !== nodeId)
    .map((n) => ({ x: n.position?.x ?? 0, y: n.position?.y ?? 0, width: n.size?.width ?? 260, height: n.size?.height ?? 200 }));
  const collides = (x: number, y: number): boolean => occupied.some((o) =>
    x < o.x + o.width + 24 && x + w + 24 > o.x && y < o.y + o.height + 24 && y + h + 24 > o.y);
  for (let i = 0; i < 12 && collides(newPos.x, newPos.y); i += 1) {
    newPos = { x: newPos.x, y: newPos.y + h + 48 };
  }

  let modelValue = '';
  let modelInvalid = false;
  if (record?.providerId && record?.model) {
    try {
      const ch = await apiGet<{ items: Array<{ id: string; models: Array<{ name: string }> }> }>('/ai/channels');
      const channel = (ch.items ?? []).find((c) => c.id === record.providerId);
      if (channel && (channel.models ?? []).some((m) => m.name === record.model)) {
        modelValue = `${record.providerId}::${record.model}`;
      } else {
        modelInvalid = true;
      }
    } catch {
      modelInvalid = true;
    }
  }

  const cleanParams: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith('_') && v !== undefined && v !== null) cleanParams[k] = v;
  }

  const commands: Command[] = [
    new AddNodeCommand({
      id: newId,
      type: srcNode.type,
      position: newPos,
      size: { width: w, height: h },
      title: `${t('editor.replaySuffix')}`,
      data: {
        prompt: record.prompt ?? '',
        ...(record.negativePrompt ? { negativePrompt: record.negativePrompt } : {}),
        status: 'idle',
        // 参数里的目标像素同时写回节点，保证同款生成沿用同一尺寸口径
        width: genSize.width,
        height: genSize.height,
        ...(modelValue ? { model: modelValue } : {}),
        ...(isLocalNode
          ? { model: normalizeReplayModel(String(srcData.model ?? ''), srcNode.type), paramValues: { ...pv } }
          : cleanParams),
      },
    } as NodeRecord),
  ];

  const targetPin: Record<string, string> = { text: 'input', image: 'prompt', video: 'prompt', audio: 'prompt' };
  const refSpecs: Array<{ type: string; storageKey?: string; content?: string; title?: string }> = [];
  let unrestorable = 0;
  const inputs: Array<{ nodeId: string; nodeType: string; assetStorageKey?: string; content?: string; title?: string; textPreview?: string }> =
    Array.isArray(params._inputs) ? params._inputs : [];

  if (inputs.length > 0) {
    for (const it of inputs) {
      const isMedia = it.nodeType === 'image' || it.nodeType === 'video' || it.nodeType === 'audio';
      if (isMedia && it.assetStorageKey) {
        refSpecs.push({ type: it.nodeType, storageKey: it.assetStorageKey, title: it.title });
      } else if (isMedia && it.content) {
        refSpecs.push({ type: it.nodeType, content: it.content, title: it.title });
      } else if (it.nodeType === 'text' && it.textPreview) {
        refSpecs.push({ type: it.nodeType, content: it.textPreview, title: it.title });
      } else {
        unrestorable += 1;
      }
    }
  } else {
    for (const e of graph.edges.filter((ed: any) => ed.target?.nodeId === nodeId)) {
      const src = graph.nodes.find((n: any) => n.id === e.source?.nodeId);
      if (!src) continue;
      const d = (src.data ?? {}) as Record<string, any>;
      if ((src.type === 'image' || src.type === 'video' || src.type === 'audio') && (d.storageKey || d.content)) {
        refSpecs.push({ type: src.type, storageKey: d.storageKey, content: typeof d.content === 'string' ? d.content : undefined, title: src.title });
      } else if (src.type === 'text' && typeof d.content === 'string' && d.content) {
        refSpecs.push({ type: 'text', content: d.content.slice(0, 2000), title: src.title });
      }
    }
  }

  let copiedCount = 0;
  for (const spec of refSpecs) {
    const copyId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-rv${copiedCount}`;
    const isMedia = spec.type === 'image' || spec.type === 'video' || spec.type === 'audio';
    commands.push(new AddNodeCommand({
      id: copyId,
      type: spec.type,
      position: { x: newPos.x - 460, y: newPos.y + copiedCount * 280 },
      title: spec.title || undefined,
      data: isMedia
        ? { storageKey: spec.storageKey, content: spec.content ?? '', status: 'idle' }
        : { content: (spec as any).text ?? spec.content ?? '', prompt: '', status: 'id' },
    } as NodeRecord));
    commands.push(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-r${copiedCount}`,
      source: { nodeId: copyId, pinId: (targetPin[spec.type] ?? 'output') },
      target: { nodeId: newId, pinId: 'prompt' },
    }));
    copiedCount += 1;
  }

  cq.execute(new BatchCommand(commands, 'replay-generation'));
  store.setSelection({ selectedNodeIds: new Set([newId]), selectedEdgeIds: new Set() });

  if (unrestorable > 0) message.warning(t('editor.replayPartial', { n: unrestorable }));
  else if (modelInvalid) message.warning(t('editor.replayModelInvalid'));
  else message.success(t('editor.replayDone', { n: copiedCount }));

  store.focusOnNode(newId, state.containerSize, w, h, 400, 51);
  // 2026-11-13 用户要求：一键同款只建节点并展开提示词，让用户自己改；不在这里发起生成。
  // 即使提示词为空也返回节点，保证编辑器能展开给用户填写。
  const prompt = String(record.prompt ?? srcData.prompt ?? '');
  const mode = (srcNode.type === 'video' || srcNode.type === 'audio' || srcNode.type === 'text' ? srcNode.type : 'image') as string;
  return { nodeId: newId, mode, prompt };
}

/**
 * 发起阶段统一编译参考图（2026-11-17 用户定稿）：
 * 连线是自由表达，不在连线时拦；但真正提交前必须编译成一份稳定顺序，
 * 按槽位（连线顺序）保留、去重、按模型能力截断，超出的计入 skipped。
 */
export function compileReferenceImages(images: string[], limit: number): { images: string[]; skipped: number } {
  const uniq: string[] = [];
  for (const src of images) {
    if (!src || uniq.includes(src)) continue;
    uniq.push(src);
  }
  if (limit <= 0) return { images: [], skipped: uniq.length };
  if (uniq.length <= limit) return { images: uniq, skipped: 0 };
  return { images: uniq.slice(0, limit), skipped: uniq.length - limit };
}

/** 处理输入参考的收集，转换为 data URL 供 AI 接口使用 */
export async function collectInputReferences(
  mentionedRefs: ReferenceItem[] | undefined,
  content: string,
): Promise<{ refImages: string[]; refVideos: Array<{ dataUrl?: string; durationMs?: number }>; refAudios: Array<{ dataUrl?: string; durationMs?: number }>; effectivePrompt: string }> {
  const refImages: string[] = [];
  const refVideos: Array<{ dataUrl?: string; durationMs?: number }> = [];
  const refAudios: Array<{ dataUrl?: string; durationMs?: number }> = [];
  let effectivePrompt = content;
  const refTextParts: string[] = [];

  for (const r of mentionedRefs ?? []) {
    if (r.type === 'text') {
      const rawText = r.asset?.content;
      if (typeof rawText === 'string' && rawText.trim()) {
        refTextParts.push(rawText.trim().slice(0, 1500));
      }
      continue;
    }
    // 资产解析：本地 CAS（cas:xxx）只能通过 resolveMediaUrl 读盘成 objectURL，
    // getResourceUrl 只认 backend/data/http 三类键，对 cas: 一律返回 undefined——
    // 这正是「连线了图片却不作为参考图」的根因（MCP 侧按 storageKey 读盘所以一直正常）。
    let src = '';
    if (r.asset?.storageKey) {
      try {
        src = await contentToDataUrl(await resolveMediaUrl(r.asset.storageKey));
      } catch {
        src = '';
      }
    }
    if (!src) {
      const legacy = r.asset?.storageKey ? getResourceUrl(r.asset.storageKey, 'full') : undefined;
      for (const candidate of [legacy, r.asset?.content]) {
        if (!candidate) continue;
        try {
          src = await contentToDataUrl(candidate);
        } catch {
          src = '';
        }
        if (src) break;
      }
    }
    if (!src) continue;
    if (r.type === 'image') refImages.push(src);
    else if (r.type === 'video') refVideos.push({ dataUrl: src });
    else if (r.type === 'audio') refAudios.push({ dataUrl: src });
  }

  if (refTextParts.length > 0) {
    effectivePrompt = `${content}\n\n[参考文本]\n${refTextParts.join('\n---\n')}`;
  }

  return { refImages, refVideos, refAudios, effectivePrompt };
}

/** 生成输入引用列表的格式化 */
export function formatInputRefs(mentionedRefs?: ReferenceItem[]): Array<{
  nodeId: string;
  nodeType: string;
  assetStorageKey?: string;
  content?: string;
  title?: string;
  textPreview?: string;
}> {
  if (!mentionedRefs) return [];
  return mentionedRefs.map((r) => ({
    nodeId: r.id,
    nodeType: r.type,
    assetStorageKey: r.asset?.storageKey,
    content: typeof r.asset?.content === 'string' ? r.asset.content : undefined,
    title: r.title ?? r.name,
    textPreview: r.type === 'text' && r.asset?.content ? r.asset.content.slice(0, 2000) : undefined,
  }));
}
