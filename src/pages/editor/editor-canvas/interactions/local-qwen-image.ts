/**
 * local-qwen-image — 画布图像节点 / 图片编辑直连本机 ComfyUI（Qwen Image 2.1 编辑工作流）。
 *
 * 协议：ComfyUI_ZeroExoNodes 的 `/zeroexo/v1/jobs`（kind = qwen_image_edit）。
 * - 参考图/遮罩先 POST /upload/image 拿 ComfyUI input 文件名；
 * - 有参考图 = 图生图编辑（edit_mode=false）；无参考图 = 文生图（edit_mode=true）；
 * - 有遮罩时服务端选 `qwen_image_edit_mask` 模板（LoadImageMask + SetLatentNoiseMask）。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import {
  cancelZeroexoJob,
  fetchZeroexoJob,
  probeZeroexoPlugin,
  submitQwenImageJob,
  uploadZeroexoReference,
  zeroexoOutputViewUrl,
  LOCAL_IMAGE_MODEL_KEY,
  type ZeroexoJobState,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { getCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import { readLastSeed, recordLastSeed, resolveSeed } from '@/shared/last-seed-store.js';
import { clampQwenSize, QWEN_MAX_EDGE } from '@/features/canvas-tabs/qwen-limits.js';

export { LOCAL_IMAGE_MODEL_KEY };

export interface LocalImageRequest {
  prompt: string;
  /** 输入图（dataURL）；无则走文生图 */
  referenceImages?: string[];
  /** 遮罩（dataURL，白=编辑区）；有则走遮罩模板 */
  maskDataUrl?: string;
  width?: number;
  height?: number;
  /** 节点参数（steps/cfg/denoise/seed/use_llm_enhance） */
  params?: Record<string, unknown>;
  nodeId?: string;
  signal?: AbortSignal;
}

export interface LocalImageResult {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
  generationId: string;
  canvasDocId: string;
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60 * 1000;

async function dataUrlBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const res = await fetch(dataUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 1024, height: 1024 };
  }
}

/** 把输入图按原比例缩到最长边 ≤ maxEdge（超过 2K 的参考图不再按原尺寸采样） */
async function capDataUrlEdge(dataUrl: string, maxEdge = QWEN_MAX_EDGE): Promise<string> {
  const blob = await dataUrlBlob(dataUrl);
  if (!blob) return dataUrl;
  const bitmap = await createImageBitmap(blob);
  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);
    if (maxSide <= maxEdge) return dataUrl;
    const scale = maxEdge / maxSide;
    const w = Math.max(16, Math.round((bitmap.width * scale) / 16) * 16);
    const h = Math.max(16, Math.round((bitmap.height * scale) / 16) * 16);
    return await fitDataUrlToSize(dataUrl, w, h);
  } finally {
    bitmap.close();
  }
}

/** 把输入图按「填满并居中裁切」缩放到指定尺寸；用于用户显式选择输出尺寸的编辑。 */
async function fitDataUrlToSize(dataUrl: string, width: number, height: number): Promise<string> {
  const blob = await dataUrlBlob(dataUrl);
  if (!blob) return dataUrl;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width === width && bitmap.height === height) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.drawImage(bitmap, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
    return canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

export async function generateLocalQwenImage(req: LocalImageRequest): Promise<LocalImageResult> {
  const jobCanvasDocId = getCurrentCanvasDocId();
  const ep = useComfyuiEndpointStore.getState();
  const base = ep.address.replace(/\/+$/, '');
  if (!base) throw new Error('尚未连接 ComfyUI：先在右上角连接本机 ComfyUI');
  if (!ep.connected && !(await probeZeroexoPlugin(base))) {
    throw new Error('本机 ComfyUI 未连接或 ZeroExo 插件不在线');
  }

  const params = req.params ?? {};
  const source = req.referenceImages?.[0];
  const requested = clampQwenSize(num(params.width, 1344), num(params.height, 1008));
  // 有参考图且用户选「跟随原图」→ 输出跟随输入图（超过 2K 先按原比例缩到 2K）；
  // 显式选尺寸 → 先把输入图缩放到目标尺寸（目标也受 2K 限制）。
  const followSource = Boolean(source) && params.sizeMode !== 'custom';
  const outWidth = followSource ? undefined : requested.width;
  const outHeight = followSource ? undefined : requested.height;
  let inputSource = source;
  if (source && followSource) {
    inputSource = await capDataUrlEdge(source);
  } else if (source && outWidth && outHeight) {
    inputSource = await fitDataUrlToSize(source, outWidth, outHeight);
  }
  let inputName = '';
  if (inputSource) {
    const blob = await dataUrlBlob(inputSource);
    if (!blob) throw new Error('输入图读取失败');
    inputName = (await uploadZeroexoReference(base, blob, 'zx_qwen_input.png')) ?? '';
    if (!inputName) throw new Error('输入图上传 ComfyUI 失败');
  }
  let maskName = '';
  if (req.maskDataUrl) {
    const blob = await dataUrlBlob(req.maskDataUrl);
    if (!blob) throw new Error('遮罩读取失败');
    maskName = (await uploadZeroexoReference(base, blob, 'zx_qwen_mask.png')) ?? '';
    if (!maskName) throw new Error('遮罩上传 ComfyUI 失败');
  }

  const seed = params.seed === undefined || params.seed === null
    ? (readLastSeed(getCurrentCanvasId()) ?? resolveSeed(-1))
    : resolveSeed(params.seed);
  recordLastSeed(seed, getCurrentCanvasId() ?? undefined);
  // 官方局部编辑原理：遮罩不是 latent mask，而是把区域标红后作为 image_1 的一部分；
  // 服务端模板再按同一遮罩把原图合成回来。这里把指令限定在红区，并要求去掉标记。
  const basePrompt = req.maskDataUrl
    ? `Edit only the red-marked area: ${req.prompt}. Remove the red marker and keep everything outside that area unchanged.`
    : req.prompt;
  const editPrompt = params.transparent_background === true
    ? `${basePrompt} The background must be transparent; output a PNG with an alpha channel.`
    : basePrompt;
  const submitted = await submitQwenImageJob(base, {
    clientJobId: `zx_qwen_${Date.now()}`,
    project: getCurrentCanvasId() ?? 'canvas',
    episode: 'image',
    params: {
      edit_prompt: editPrompt,
      negative_prompt: String(params.negative_prompt ?? ''),
      input_image: inputName,
      mask_image: maskName,
      seed,
      steps: num(params.steps, 8),
      cfg: num(params.cfg, 1),
      denoise: num(params.denoise, 1),
      edit_mode: !inputName,
      use_llm_enhance: params.use_llm_enhance === true,
      width: outWidth ?? 1024,
      height: outHeight ?? 1024,
    },
  });

  let state: ZeroexoJobState = submitted.state;
  const startAt = Date.now();
  let outputPath = '';
  try {
    while (state === 'queued' || state === 'running') {
      if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (Date.now() - startAt > MAX_WAIT_MS) throw new Error('本机图像生成超时（15 分钟）');
      await sleep(POLL_MS, req.signal);
      const status = await fetchZeroexoJob(base, submitted.jobId);
      state = status.state;
      const out = (status.outputs ?? []).find((o) => o.kind === 'image') ?? status.outputs?.[0];
      if (out?.path) outputPath = out.path;
      if (state === 'error') throw new Error(status.error || '本机图像执行失败（详见 ComfyUI 日志）');
      if (state === 'cancelled') throw new Error('本机图像作业已取消');
    }
  } catch (err) {
    await cancelZeroexoJob(base, submitted.jobId).catch(() => undefined);
    throw err;
  }

  const url = outputPath ? zeroexoOutputViewUrl(base, outputPath) : null;
  if (!url) throw new Error('本机完成但找不到可取回的图片路径');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`取回图片失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  const size = await readImageSize(blob);
  return {
    blob,
    width: size.width,
    height: size.height,
    mimeType: blob.type || 'image/png',
    bytes: blob.size,
    generationId: submitted.jobId,
    canvasDocId: jobCanvasDocId,
  };
}
