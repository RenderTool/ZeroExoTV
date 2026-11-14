/**
 * local-moss-image — 画布图片节点 · Moss Image 文生图（仅线上 ComfyUI）
 *
 * Moss Image：moss_image_sft_int8（UNet）+ qwen3.5_9b（文本编码，type=moss_image）+ flux2 VAE；
 * 采样 er_sde / simple / cfg 2.5 / 25 步。Flux2 latent 要求宽高 **16 对齐**。
 *
 * 尺寸规则：比例 + 百万像素（1MP = 1024²），默认 1MP；默认 1024×1024。
 * 不支持参考图输入（纯文生图）。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import {
  cancelZeroexoJob,
  fetchZeroexoJob,
  probeZeroexoPlugin,
  submitMossJob,
  warmZeroexoConnection,
  zeroexoOutputViewUrl,
  MOSS_MODEL_KEY,
  type ZeroexoJobState,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { getCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import { readLastSeed, recordLastSeed, resolveSeed } from '@/shared/last-seed-store.js';
import {
  createPreviewClientId,
  ComfyuiPreviewSocket,
  type ComfyuiStepProgress,
} from '@/features/canvas-tabs/comfyui-ws-client.js';
import type { LocalImageResult } from './local-qwen-image.js';

export { MOSS_MODEL_KEY };

/** Moss 默认采样步数（moss_image_sft 官方工作流 25 步 / cfg 2.5） */
export const MOSS_DEFAULT_STEPS = 25;
export const MOSS_DEFAULT_CFG = 2.5;
/** 默认百万像素：1MP = 1024×1024 */
export const MOSS_DEFAULT_MEGAPIXELS = 4;

export interface LocalMossRequest {
  prompt: string;
  /** "16:9" 形式；缺省 1:1 */
  aspect?: string;
  params?: Record<string, unknown>;
  nodeId?: string;
  onPreview?: (dataUrl: string) => void;
  onProgress?: (progress: ComfyuiStepProgress) => void;
  onJobSubmitted?: (job: { jobId: string; clientId: string; base: string }) => void;
  resume?: { jobId: string; clientId: string };
  signal?: AbortSignal;
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60 * 1000;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 比例 + 百万像素 → 16 对齐的宽高（Moss/Flux2 latent 步长） */
export function resolveMossSize(aspect: string | undefined, megapixels = MOSS_DEFAULT_MEGAPIXELS): { width: number; height: number } {
  const align = (n: number): number => Math.max(64, Math.round(n / 16) * 16);
  const m = /^(\d+)\s*:\s*(\d+)$/.exec((aspect ?? '1:1').trim());
  const rw = m ? Number(m[1]) : 1;
  const rh = m ? Number(m[2]) : 1;
  if (!rw || !rh) return { width: 1024, height: 1024 };
  const mp = Math.max(0.5, Math.min(8, Number.isFinite(megapixels) ? megapixels : MOSS_DEFAULT_MEGAPIXELS));
  const ratio = rw / rh;
  const total = mp * 1024 * 1024;
  const width = Math.sqrt(total * ratio);
  return { width: align(width), height: align(width / ratio) };
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

export async function generateMossImage(req: LocalMossRequest): Promise<LocalImageResult> {
  const jobCanvasDocId = getCurrentCanvasDocId();
  const ep = useComfyuiEndpointStore.getState();
  const base = ep.address.replace(/\/+$/, '');
  if (!base) throw new Error('尚未连接 ComfyUI：先在右上角连接线上 ComfyUI');
  if (!ep.connected && !(await probeZeroexoPlugin(base))) {
    throw new Error('ComfyUI 未连接或 ZeroExo 插件不在线');
  }
  await warmZeroexoConnection(base);

  const params = req.params ?? {};
  const size = resolveMossSize(req.aspect, num(params.megapixels, MOSS_DEFAULT_MEGAPIXELS));
  const seed = params.seed === undefined || params.seed === null
    ? (readLastSeed(getCurrentCanvasId()) ?? resolveSeed(-1))
    : resolveSeed(params.seed);

  const clientId = req.resume?.clientId ?? createPreviewClientId();
  let previewSocket: ComfyuiPreviewSocket | null = null;
  if (req.onPreview || req.onProgress) {
    previewSocket = new ComfyuiPreviewSocket(base, clientId, {
      onPreviewImage: req.onPreview,
      onStep: req.onProgress,
      expectedSteps: num(req.params?.['steps'], MOSS_DEFAULT_STEPS),
    });
    previewSocket.connect();
  }
  let jobId = req.resume?.jobId ?? '';
  try {
    let state: ZeroexoJobState = 'queued';
    if (!req.resume) {
      recordLastSeed(seed, getCurrentCanvasId() ?? undefined);
      const submitted = await submitMossJob(base, {
        clientJobId: `zx_moss_${Date.now()}`,
        clientId,
        project: getCurrentCanvasId() ?? 'canvas',
        episode: 'image',
        params: {
          prompt: req.prompt,
          negative_prompt: String(params.negative_prompt ?? ''),
          seed,
          steps: num(params.steps, MOSS_DEFAULT_STEPS),
          cfg: num(params.cfg, MOSS_DEFAULT_CFG),
          width: size.width,
          height: size.height,
        },
      });
      jobId = submitted.jobId;
      state = submitted.state;
      req.onJobSubmitted?.({ jobId, clientId, base });
    }

    const startAt = Date.now();
    let outputPath = '';
    while (state === 'queued' || state === 'running') {
      if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (Date.now() - startAt > MAX_WAIT_MS) throw new Error('Moss 生成超时（15 分钟）');
      await sleep(POLL_MS, req.signal);
      const status = await fetchZeroexoJob(base, jobId);
      state = status.state;
      const out = (status.outputs ?? []).find((o) => o.kind === 'image') ?? status.outputs?.[0];
      if (out?.path) outputPath = out.path;
      if (state === 'error') throw new Error(status.error || 'Moss 执行失败（详见 ComfyUI 日志）');
      if (state === 'cancelled') throw new Error('Moss 作业已取消');
    }

    const url = outputPath ? zeroexoOutputViewUrl(base, outputPath) : null;
    if (!url) throw new Error('Moss 完成但找不到可取回的图片路径');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`取回图片失败（HTTP ${res.status}）`);
    const blob = await res.blob();
    const imageSize = await readImageSize(blob);
    return {
      blob,
      width: imageSize.width,
      height: imageSize.height,
      mimeType: blob.type || 'image/png',
      bytes: blob.size,
      generationId: jobId,
      canvasDocId: jobCanvasDocId,
    };
  } catch (err) {
    if (jobId) await cancelZeroexoJob(base, jobId).catch(() => undefined);
    throw err;
  } finally {
    previewSocket?.close();
  }
}
