/**
 * local-minimax-video — 画布视频节点直连本机 ComfyUI（ComfyUI_ZeroExoNodes 的 /zeroexo/v1/jobs）。
 *
 * 为什么单独一条路：画布节点的生成按钮原本只走 OpenAI 兼容 provider（模型清单来自 AI 渠道），
 * 本机 MiniMax H3 不是渠道、也不在清单里，所以下拉里永远看不到它。这里把「本机」作为
 * 一个伪模型选项接入：提交单段作业 → 轮询 → 取回视频 Blob，节点侧完全复用原有成功/落库链路。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import {
  cancelZeroexoJob,
  fetchZeroexoJob,
  probeZeroexoPlugin,
  submitZeroexoJob,
  uploadZeroexoReference,
  warmZeroexoConnection,
  zeroexoOutputViewUrl,
  LOCAL_VIDEO_MODEL_KEY,
  type ZeroexoJobState,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { ensureComfyuiMachineInfo, shouldUseLowVram } from '@/features/canvas-tabs/vram-mode.js';
import { durationToFrames, resolveVideoSize } from '@/entities/director-params.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { canvasDocNodeKey, getCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import { recordLastSeed, resolveSeed } from '@/shared/last-seed-store.js';
import {
  createPreviewClientId,
  DirectorPreviewSocket,
  type DirectorPreviewFrame,
  type DirectorProgressInfo,
} from '@/features/canvas-tabs/comfyui-ws-client.js';

/** 伪模型 key：node.data.model 里存这个值即走本机链路（与 dock 下拉共用同一常量） */
export { LOCAL_VIDEO_MODEL_KEY };

export interface LocalVideoRequest {
  prompt: string;
  /** 连入本节点的参考图（dataURL；只取第一张，插件节点单参考槽） */
  referenceImages?: string[];
  /** "1280x720" 形式的尺寸 */
  size?: string;
  seconds?: number;
  /** 节点参数面板的原始值（steps / seed / cfg 等） */
  params?: Record<string, unknown>;
  /**
   * 显式引导 id（gd_xxx，2026-11-09）：画布节点也默认产出 guide，用不用由调用方决定；
   * 传了它 → 插件把该引导作为本段 motion context，并强制关闭 use_prev_guide。
   */
  guideId?: string;
  /** 画布节点 id（预览帧按节点回写；可选） */
  nodeId?: string;
  /** 实时预览帧回调（引擎按步解码，经 /ws 的 minimax_director_preview 推送） */
  onPreview?: (frame: DirectorPreviewFrame) => void;
  /** 采样阶段进度回调（/ws 的 minimax_director_progress） */
  onProgress?: (info: DirectorProgressInfo) => void;
  /** 提交成功回调（jobId/clientId/base 写进节点，刷新后续接预览与进度） */
  onJobSubmitted?: (job: { jobId: string; clientId: string; base: string }) => void;
  /** 刷新续接：跳过提交，直接接回这个作业 */
  resume?: { jobId: string; clientId: string };
  signal?: AbortSignal;
}

export interface LocalVideoResult {
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
  mimeType: string;
  bytes: number;
  generationId: string;
  /** 任务所属画布文档（发起时捕获；回写前必须与当前文档一致，防副本任务串到主画布） */
  canvasDocId: string;
  /** 本机链路不返回尾帧（保持与 GeneratedVideo 同形，节点侧尾帧逻辑自然跳过） */
  lastFrameUrl?: string;
  /** 外部渠道产物才有云端资产 id；本机为 undefined */
  assetId?: string;
  /** 本机 H3 同步产出的引导数据（safetensors，供导出/发送导演台） */
  guide?: { id: string; path?: string; frames?: number; sha256?: string };
}

const POLL_MS = 2000;
const MAX_WAIT_MS = 45 * 60 * 1000;

/** 当前节点正在跑的本机作业（按「画布文档 + nodeId」定位：副本与主画布同 id 也不能混） */
const activeLocalJobs = new Map<string, { base: string; jobId: string }>();

/** 立即取消某画布节点的本机作业（供停止按钮调用；无作业时 no-op） */
export async function cancelLocalJob(nodeId: string): Promise<void> {
  const key = canvasDocNodeKey(nodeId);
  const entry = activeLocalJobs.get(key);
  if (!entry) return;
  activeLocalJobs.delete(key);
  await cancelZeroexoJob(entry.base, entry.jobId).catch(() => undefined);
}

function parseSize(size: string | undefined): { width: number; height: number } {
  const m = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec((size ?? '').trim());
  if (m) {
    // 对齐到 32：MiniMax 侧按 32 倍数切块
    const align = (n: number): number => Math.max(64, Math.round(n / 32) * 32);
    return { width: align(Number(m[1])), height: align(Number(m[2])) };
  }
  // 兜底：按段时长给一个 16:9 的小尺寸，避免误用超大分辨率
  return { width: 432, height: 240 };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function generateLocalMiniMaxVideo(req: LocalVideoRequest): Promise<LocalVideoResult> {
  // 任务归属在发起时固化：之后切换画布文档也不得把结果/预览写进另一份文档
  const jobCanvasDocId = getCurrentCanvasDocId();
  const ep = useComfyuiEndpointStore.getState();
  const base = ep.address.replace(/\/+$/, '');
  if (!base) throw new Error('尚未连接 ComfyUI：先在右上角连接本机 ComfyUI');
  // 画布页可能没跑过自动连接：这里按插件健康接口补一次探测，连得上就直接生成
  if (!ep.connected && !(await probeZeroexoPlugin(base))) {
    throw new Error('尚未连接 ComfyUI：先在右上角连接本机 ComfyUI');
  }
  // 空闲后 keep-alive 会被网关静默关掉，浏览器不重试 POST → 参考图上传会静默失败（参考被丢）。
  // 先打一个 GET 预热连接；不要只靠 ensureComfyuiMachineInfo（有缓存时它一个请求都不发）。
  await warmZeroexoConnection(base);
  // 尺寸以节点参数面板的「比例 + 尺寸系数」为准（与导演台同一套换算），没有再退回字符串尺寸
  const aspect = typeof req.params?.aspect === 'string' ? req.params.aspect : '';
  const scale = Number(req.params?.scaleFactor);
  const resolved = aspect ? resolveVideoSize(aspect, Number.isFinite(scale) ? scale : 1) : null;
  const { width, height } = parseSize(resolved ? `${resolved.width}x${resolved.height}` : req.size);
  const seconds = Math.max(1, Math.min(60, req.seconds ?? 5));
  const frames = durationToFrames(seconds);
  const asNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const steps = Math.max(1, Math.min(100, Math.round(asNumber(req.params?.steps, 8))));
  const cfg = Math.max(0, Math.min(20, asNumber(req.params?.cfg, 1)));
  const seed = resolveSeed(req.params?.seed);

  const clientId = req.resume?.clientId ?? createPreviewClientId();
  // 先连 /ws 再提交：引擎的预览事件按提交时携带的 client_id 定向发送
  let previewSocket: DirectorPreviewSocket | null = null;
  if (req.onPreview || req.onProgress) {
    let lastAt = 0;
    previewSocket = new DirectorPreviewSocket(base, clientId, {
      onFrame: (frame) => {
        const now = Date.now();
        if (now - lastAt < 200) return; // 至多 5fps 回写节点，避免高频重渲染
        lastAt = now;
        // 无图帧（progress-only）也带 step/段号，不能再丢弃
        req.onPreview?.(frame);
      },
      onProgress: (info) => req.onProgress?.(info),
    });
    previewSocket.connect();
  }
  try {
    let jobId = req.resume?.jobId ?? '';
    let state: ZeroexoJobState = 'queued';
    if (!req.resume) {
      // 参考图：连入的图片全部上传（最多 9 张，支持分镜图/站位锁定图等多参考）
      const referenceNames: string[] = [];
      for (const [i, dataUrl] of (req.referenceImages ?? [])
        .filter((u) => typeof u === 'string' && u.startsWith('data:'))
        .slice(0, 9)
        .entries()) {
        const blob = await (await fetch(dataUrl)).blob();
        const name = await uploadZeroexoReference(base, blob, `canvas_ref_${Date.now()}_${i}.png`);
        if (name) referenceNames.push(name);
      }
      const referenceImage = referenceNames[0] ?? '';
      await ensureComfyuiMachineInfo(base);
      const useLowVram = shouldUseLowVram();
      const submitted = await submitZeroexoJob(base, {
        clientJobId: `zx_canvas_${Date.now()}`,
        clientId,
        project: getCurrentCanvasId() ?? 'canvas',
        episode: 'canvas',
        params: {
          prompt: req.prompt,
          negative_prompt: '',
          width,
          height,
          frames,
          steps,
          cfg,
          seed,
          frame_rate: 24,
          guide_frames: 22,
          use_prev_guide: false,
          use_low_vram: useLowVram,
          ...(req.guideId ? { guide_id: req.guideId } : {}),
          reference_image: referenceImage,
        },
      });
      jobId = submitted.jobId;
      state = submitted.state;
      // 提交成功立刻回调，外部把 jobId/clientId 写到节点数据（刷新后续接用）
      req.onJobSubmitted?.({ jobId, clientId, base });
    }

    if (req.nodeId) activeLocalJobs.set(canvasDocNodeKey(req.nodeId, jobCanvasDocId), { base, jobId });

    const startAt = Date.now();
    let outputs: Array<{ kind: string; path: string }> = [];
    let guide: LocalVideoResult['guide'];
    try {
      while (state === 'queued' || state === 'running') {
        if (req.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        if (Date.now() - startAt > MAX_WAIT_MS) throw new Error('本机生成超时（45 分钟）');
        await sleep(POLL_MS, req.signal);
        const status = await fetchZeroexoJob(base, jobId);
        state = status.state;
        outputs = status.outputs ?? [];
        if (status.guide?.id) {
          guide = {
            id: status.guide.id,
            path: status.guide.path,
            frames: status.guide.frames,
            sha256: status.guide.sha256,
          };
        }
        if (state === 'error') throw new Error(status.error || '本机执行失败（详见 ComfyUI 日志）');
        if (state === 'cancelled') throw new Error('本机作业已取消');
      }
    } catch (err) {
      // 用户中止 / 轮询异常：尽量把服务端作业也停掉，避免白占队列
      await cancelZeroexoJob(base, jobId).catch(() => undefined);
      throw err;
    }

    const out = outputs.find((o) => o.kind === 'video') ?? outputs[0];
    const url = out ? zeroexoOutputViewUrl(base, out.path) : null;
    if (!url) throw new Error('本机完成但找不到可取回的视频路径');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`取回视频失败（HTTP ${res.status}）`);
    const blob = await res.blob();
    recordLastSeed(seed, getCurrentCanvasId() ?? undefined);
    return {
      blob,
      width,
      height,
      durationMs: Math.round(seconds * 1000),
      mimeType: blob.type || 'video/mp4',
      bytes: blob.size,
      generationId: jobId,
      canvasDocId: jobCanvasDocId,
      guide,
    };
  } finally {
    if (req.nodeId) activeLocalJobs.delete(canvasDocNodeKey(req.nodeId, jobCanvasDocId));
    previewSocket?.close();
  }
}
