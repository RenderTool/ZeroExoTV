/**
 * local-krea2-image — 画布图片节点 · Krea2 文生图（仅线上 ComfyUI）
 *
 * 为什么单独一条：Krea2 需要 krea2 底模 + RES4LYF 的 ClownsharK 采样器，本机没这组模型，
 * 所以本机模式不露出这个模型（`isLocalComfyuiAddress` 门控），走同一套 /zeroexo/v1/jobs 协议。
 *
 * 尺寸规则与现有文生图一致：比例 + 百万像素 + 32 对齐（默认 3MP，1024² 附近质量最稳）。
 * 不支持参考图输入（模型本身没有 image 输入槽）；有连线参考图也不参与。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import {
  cancelZeroexoJob,
  fetchZeroexoJob,
  probeZeroexoPlugin,
  submitKrea2Job,
  warmZeroexoConnection,
  zeroexoOutputViewUrl,
  KREA2_MODEL_KEY,
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

export { KREA2_MODEL_KEY };

/** Krea2 默认采样步数（turbo 底模；与 Qwen 的 25 步不是一套） */
export const KREA2_DEFAULT_STEPS = 10;
/** 默认百万像素（ResolutionSelector 口径）；3MP ≈ 1536×1024 */
export const KREA2_DEFAULT_MEGAPIXELS = 3;

export interface LocalKrea2Request {
  prompt: string;
  /** "16:9" 形式；缺省 1:1 */
  aspect?: string;
  params?: Record<string, unknown>;
  nodeId?: string;
  onPreview?: (dataUrl: string) => void;
  onProgress?: (progress: ComfyuiStepProgress) => void;
  /** 提交成功回写作业身份（刷新后续接预览/进度用） */
  onJobSubmitted?: (job: { jobId: string; clientId: string; base: string }) => void;
  /** 刷新续接：跳过提交，直接接回这个作业 */
  resume?: { jobId: string; clientId: string };
  signal?: AbortSignal;
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 15 * 60 * 1000;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 比例 + 百万像素 → 32 对齐的宽高（Krea2 用 32 对齐的 latent 步长） */
export function resolveKrea2Size(aspect: string | undefined, megapixels = KREA2_DEFAULT_MEGAPIXELS): { width: number; height: number } {
  const align = (n: number): number => Math.max(64, Math.round(n / 32) * 32);
  const m = /^(\d+)\s*:\s*(\d+)$/.exec((aspect ?? '1:1').trim());
  const rw = m ? Number(m[1]) : 1;
  const rh = m ? Number(m[2]) : 1;
  if (!rw || !rh) return { width: 1024, height: 1024 };
  const mp = Math.max(0.5, Math.min(8, Number.isFinite(megapixels) ? megapixels : KREA2_DEFAULT_MEGAPIXELS));
  const ratio = rw / rh;
  const width = Math.sqrt(mp * 1_000_000 * ratio);
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

export async function generateKrea2Image(req: LocalKrea2Request): Promise<LocalImageResult> {
  const jobCanvasDocId = getCurrentCanvasDocId();
  const ep = useComfyuiEndpointStore.getState();
  const base = ep.address.replace(/\/+$/, '');
  if (!base) throw new Error('尚未连接 ComfyUI：先在右上角连接线上 ComfyUI');
  if (!ep.connected && !(await probeZeroexoPlugin(base))) {
    throw new Error('ComfyUI 未连接或 ZeroExo 插件不在线');
  }
  await warmZeroexoConnection(base);

  const params = req.params ?? {};
  const size = resolveKrea2Size(req.aspect, num(params.megapixels, KREA2_DEFAULT_MEGAPIXELS));
  const seed = params.seed === undefined || params.seed === null
    ? (readLastSeed(getCurrentCanvasId()) ?? resolveSeed(-1))
    : resolveSeed(params.seed);

  const clientId = req.resume?.clientId ?? createPreviewClientId();
  let previewSocket: ComfyuiPreviewSocket | null = null;
  if (req.onPreview || req.onProgress) {
    previewSocket = new ComfyuiPreviewSocket(base, clientId, {
      onPreviewImage: req.onPreview,
      onStep: req.onProgress,
    });
    previewSocket.connect();
  }
  let jobId = req.resume?.jobId ?? '';
  try {
    let state: ZeroexoJobState = 'queued';
    if (!req.resume) {
      recordLastSeed(seed, getCurrentCanvasId() ?? undefined);
      const submitted = await submitKrea2Job(base, {
        clientJobId: `zx_krea2_${Date.now()}`,
        clientId,
        project: getCurrentCanvasId() ?? 'canvas',
        episode: 'image',
        params: {
          prompt: req.prompt,
          negative_prompt: String(params.negative_prompt ?? ''),
          seed,
          steps: num(params.steps, KREA2_DEFAULT_STEPS),
          cfg: num(params.cfg, 1),
          eta: num(params.eta, 0.55),
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
      if (Date.now() - startAt > MAX_WAIT_MS) throw new Error('Krea2 生成超时（15 分钟）');
      await sleep(POLL_MS, req.signal);
      const status = await fetchZeroexoJob(base, jobId);
      state = status.state;
      const out = (status.outputs ?? []).find((o) => o.kind === 'image') ?? status.outputs?.[0];
      if (out?.path) outputPath = out.path;
      if (state === 'error') throw new Error(status.error || 'Krea2 执行失败（详见 ComfyUI 日志）');
      if (state === 'cancelled') throw new Error('Krea2 作业已取消');
    }

    const url = outputPath ? zeroexoOutputViewUrl(base, outputPath) : null;
    if (!url) throw new Error('Krea2 完成但找不到可取回的图片路径');
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
    // 用户中止 / 轮询异常：停掉服务端作业（续接模式同样处理，避免白占队列）
    if (jobId) await cancelZeroexoJob(base, jobId).catch(() => undefined);
    throw err;
  } finally {
    previewSocket?.close();
  }
}
