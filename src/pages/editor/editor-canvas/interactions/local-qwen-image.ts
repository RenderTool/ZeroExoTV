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
  friendlyLocalJobError,
  probeZeroexoPlugin,
  submitQwenImageJob,
  uploadZeroexoReference,
  warmZeroexoConnection,
  zeroexoOutputViewUrl,
  LOCAL_IMAGE_MODEL_KEY,
  type ZeroexoJobState,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { getCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import { recordLastSeed, resolveSeed } from '@/shared/last-seed-store.js';
import { clampQwenSize, QWEN_DEFAULT_STEPS } from '@/features/canvas-tabs/qwen-limits.js';
import {
  createPreviewClientId,
  ComfyuiPreviewSocket,
  type ComfyuiStepProgress,
} from '@/features/canvas-tabs/comfyui-ws-client.js';

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
  /** 采样预览帧（ComfyUI 原生 PREVIEW_IMAGE，dataURL） */
  onPreview?: (dataUrl: string) => void;
  /** 采样步进（ComfyUI 原生 progress 事件） */
  onProgress?: (progress: ComfyuiStepProgress) => void;
  /** 提交成功回写作业身份（刷新后续接预览/进度用） */
  onJobSubmitted?: (job: { jobId: string; clientId: string; base: string }) => void;
  /** 刷新续接：跳过提交，直接接回这个作业 */
  resume?: { jobId: string; clientId: string };
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

/**
 * 首次提交自动重试（2026-11-17 用户实测「图生图要点一次重试才生效」）：
 * 空闲 keep-alive 被网关静默关掉时，浏览器对 POST 不重试，第一次必然报 Failed to fetch。
 * 这里对上传 / 提交各补一次重试，用户点一次就能出图。
 */
async function withSubmitRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err;
    await sleep(800, signal);
    return fn();
  }
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

/**
 * 组装提交给插件的编辑指令。
 *
 * 有输入图时必须以「参考图1：」点名：Qwen Image 的文本编码器不会自动把输入图当参考，
 * 提示词里不出现参考图编号时它会直接按文生图重画（用户实测退化成文生图）。
 * 遮罩 / 透明底是同一句指令的修饰，prefix 放在最外层。
 */
export function buildQwenEditPrompt(input: {
  prompt: string;
  hasInputImage: boolean;
  hasMask: boolean;
  transparentBackground: boolean;
  referenceCount?: number;
}): string {
  // 官方局部编辑原理：遮罩不是 latent mask，而是把区域标红后作为 image_1 的一部分；
  // 服务端模板再按同一遮罩把原图合成回来。这里把指令限定在红区，并要求去掉标记。
  const base = input.hasMask
    ? `Edit only the red-marked area: ${input.prompt}. Remove the red marker and keep everything outside that area unchanged.`
    : input.prompt;
  const withAlpha = input.transparentBackground
    ? `${base} The background must be transparent; output a PNG with an alpha channel.`
    : base;
  if (!input.hasInputImage) return withAlpha;
  const count = Math.max(1, Math.min(16, input.referenceCount ?? 1));
  if (count === 1) return `参考图1：${withAlpha}`;
  const labels = Array.from({ length: count }, (_, i) => `参考图${i + 1}`).join('、');
  return `${labels}：${withAlpha}`;
}

/**
 * 出图尺寸（2026-11-17 用户纠正，硬性）：参考图只做生成引导，不参与尺寸计算。
 * 只有显式「跟随原图」(sizeMode='source') 才用输入图尺寸；其余一律用请求尺寸。
 */
export function resolveQwenTargetSize(input: {
  width?: number;
  height?: number;
  params?: Record<string, unknown>;
  sourceSize?: { width: number; height: number } | null;
  /** 有效参考图数量：多图参考生成没有「原图」概念 */
  referenceCount?: number;
}): { width: number; height: number } {
  const params = input.params ?? {};
  const requested = clampQwenSize(
    num(input.width ?? params.width, 1344),
    num(input.height ?? params.height, 1008),
  );
  const sourceSize = input.sourceSize;
  if (sourceSize && params.sizeMode === 'source' && (input.referenceCount ?? 0) === 1) {
    return clampQwenSize(sourceSize.width, sourceSize.height);
  }
  return requested;
}

export async function generateLocalQwenImage(req: LocalImageRequest): Promise<LocalImageResult> {
  const jobCanvasDocId = getCurrentCanvasDocId();
  const ep = useComfyuiEndpointStore.getState();
  const base = ep.address.replace(/\/+$/, '');
  if (!base) throw new Error('尚未连接 ComfyUI：先在右上角连接本机 ComfyUI');
  if (!ep.connected) {
    // 首次点击时插件探测常因冷启动/空闲连接失败，表现为「再点一次就好」。这里补一次探测。
    let ok = await probeZeroexoPlugin(base);
    if (!ok) {
      await sleep(600);
      ok = await probeZeroexoPlugin(base);
    }
    if (!ok) throw new Error('本机 ComfyUI 未连接或 ZeroExo 插件不在线');
  }
  // 空闲后 keep-alive 会被网关静默关掉，浏览器不重试 POST → 首次提交必报 Failed to fetch。
  // 先打一个 GET 预热，后面的上传 / 提交就走新连接（否则表现为「点两次才生成」）。
  await warmZeroexoConnection(base);

  const params = req.params ?? {};
  const source = req.referenceImages?.[0];
  // 2026-11-17 用户实测「设了 16:9 2MP 出图永远 1:1」：参考图只做生成引导，
  // 它的尺寸绝不参与出图尺寸计算。只有显式选择「跟随原图」(sizeMode='source') 才按原图；
  // 其余一律用请求尺寸（参数面板的 size / aspect + 百万像素换算结果）。
  const sourceBlob = source ? await dataUrlBlob(source) : null;
  const sourceSize = sourceBlob ? await readImageSize(sourceBlob) : null;
  const target = resolveQwenTargetSize({
    width: req.width,
    height: req.height,
    params,
    sourceSize,
    referenceCount: req.referenceImages?.length ?? 0,
  });
  const outWidth = target.width;
  const outHeight = target.height;
  const clientId = req.resume?.clientId ?? createPreviewClientId();
  // 先连 /ws 再提交：插件把 clientId 透传进 /prompt，ComfyUI 才会把 progress / 预览帧发给这个连接
  let previewSocket: ComfyuiPreviewSocket | null = null;
  if (req.onPreview || req.onProgress) {
    previewSocket = new ComfyuiPreviewSocket(base, clientId, {
      onPreviewImage: req.onPreview,
      onStep: req.onProgress,
      // Qwen 缓存节点按 token 块上报 progress（max=4096），折算回请求的采样步数
      expectedSteps: num(req.params?.['steps'], QWEN_DEFAULT_STEPS),
    });
    previewSocket.connect();
  }
  try {
    let jobId = req.resume?.jobId ?? '';
    let state: ZeroexoJobState = 'queued';
    if (!req.resume) {
      // 参考图原样上传：只做生成引导，绝不按出图尺寸拉伸（拉伸会改变主体比例）；
      // 出图尺寸由 width/height 决定，Qwen 编码器自己按 resolution=0 处理参考图尺寸。
      let inputName = '';
      const extraNames: string[] = [];
      if (source) {
        const blob = await dataUrlBlob(source);
        if (!blob) throw new Error('输入图读取失败');
        // 上传前再预热一次：把可能已被网关关掉的空闲连接换成新连接
        await warmZeroexoConnection(base);
        inputName = await withSubmitRetry(() => uploadZeroexoReference(base, blob, 'zx_qwen_input.png'), req.signal) ?? '';
        // 有参考图却上传失败 = 静默退化成文生图（用户实测「不 @图片就不带参考图」的真正原因之一）。
        // 这里必须报错，不能悄悄按文生图跑。
        if (!inputName) throw new Error('参考图上传 ComfyUI 失败（连接被重置），已阻止退化成文生图，请重试');
        // 多图参考：连入的每一张都按槽位顺序上传并交给模型，用不用是模型自己的事
        // 参考图不再缩放：只做引导，拉伸会改变主体比例；尺寸一律由请求参数决定
        for (const [i, extra] of (req.referenceImages ?? []).slice(1, 16).entries()) {
          const b = await dataUrlBlob(extra);
          if (!b) continue;
          const name = await withSubmitRetry(() => uploadZeroexoReference(base, b, `zx_qwen_input_${i + 2}.png`), req.signal) ?? '';
          if (name) extraNames.push(name);
        }
      }
      let maskName = '';
      if (req.maskDataUrl) {
        const maskFitted = await fitDataUrlToSize(req.maskDataUrl, outWidth, outHeight);
        const blob = await dataUrlBlob(maskFitted);
        if (!blob) throw new Error('遮罩读取失败');
        maskName = await withSubmitRetry(() => uploadZeroexoReference(base, blob, 'zx_qwen_mask.png'), req.signal) ?? '';
        if (!maskName) throw new Error('遮罩上传 ComfyUI 失败');
      }

      // 2026-11-17 用户实测「同提示词再生成，返回的还是那张图」：seed 缺省时此前复用「上次种子」，
      // 同 prompt + 同 seed = 完全同一张图（再落库时按 CAS 去重，看着像没生成）。缺省一律随机。
      const seed = resolveSeed(params.seed);
      recordLastSeed(seed, getCurrentCanvasId() ?? undefined);
      // 有输入图（图生图 / 遮罩）时提示词点名「参考图1」，否则 Qwen Image 会退化成文生图
      const editPrompt = buildQwenEditPrompt({
        prompt: req.prompt,
        hasInputImage: Boolean(inputName),
        hasMask: Boolean(req.maskDataUrl),
        transparentBackground: params.transparent_background === true,
        referenceCount: 1 + extraNames.length,
      });
      const submitted = await withSubmitRetry(() => submitQwenImageJob(base, {
        clientJobId: `zx_qwen_${Date.now()}`,
        clientId,
        project: getCurrentCanvasId() ?? 'canvas',
        episode: 'image',
        params: {
          edit_prompt: editPrompt,
          negative_prompt: String(params.negative_prompt ?? ''),
          input_image: inputName,
          input_images: extraNames.length ? [inputName, ...extraNames].join(',') : '',
          mask_image: maskName,
          seed,
          steps: num(params.steps, QWEN_DEFAULT_STEPS),
          cfg: num(params.cfg, 1),
          denoise: num(params.denoise, 1),
          // 出图尺寸只认参数面板：参考图只做生成引导，不参与尺寸。
          // 旧逻辑 edit_mode=!inputName，有参考图时会走「参考图 latent」，导致永远按原图比例出图（选 4:3 仍出 1:1）。
          edit_mode: true,
          use_llm_enhance: params.use_llm_enhance === true,
          width: outWidth ?? 1024,
          height: outHeight ?? 1024,
        },
      }), req.signal);
      jobId = submitted.jobId;
      state = submitted.state;
      req.onJobSubmitted?.({ jobId, clientId, base });
    }

    const startAt = Date.now();
    let outputPath = '';
    try {
      while (state === 'queued' || state === 'running') {
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (Date.now() - startAt > MAX_WAIT_MS) throw new Error('本机图像生成超时（15 分钟）');
        await sleep(POLL_MS, req.signal);
        const status = await fetchZeroexoJob(base, jobId);
        state = status.state;
        const out = (status.outputs ?? []).find((o) => o.kind === 'image') ?? status.outputs?.[0];
        if (out?.path) outputPath = out.path;
        if (state === 'error') throw new Error(friendlyLocalJobError(status.error) || '本机图像执行失败（详见 ComfyUI 日志）');
        if (state === 'cancelled') throw new Error('本机图像作业已取消');
      }
    } catch (err) {
      await cancelZeroexoJob(base, jobId).catch(() => undefined);
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
      generationId: jobId,
      canvasDocId: jobCanvasDocId,
    };
  } finally {
    previewSocket?.close();
  }
}
