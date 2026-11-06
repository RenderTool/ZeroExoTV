/**
 * use-director-run — 导演台真实运行编排（上传/提交 → 轮询 → 逐段落库 → 取消/引导）
 *
 * 状态机：idle → submitting → queued → running → success / error / canceled
 * 双传输模式（getBridgeConfig 决定，参数映射各只有一份定义）：
 * - mode:'openai'  主路径：OpenAI 兼容协议（POST /v1/videos，导演参数映射唯一表 director-protocol-map）；
 * - mode:'direct'  高级：直连 ComfyUI 桥接（zip 包契约 director-pack-builder + /zeroexo/h3/*）。
 *
 * - 轮询 3s（契约 §3 建议区间 2-5s 内取稳态值）；
 * - 每段 state 变 done 立即下载落库（不等全部跑完）：blob → newMediaKey('video') + putMedia（复用
 *   platform/media 的磁盘资产机制，与 platform/cover.ts 同款落位模式）→ 主线程截首帧
 *   （串行队列，project-rules/rules/media-frame-extraction-main-thread.md）→ firstFrameKey；
 * - 取消：direct → POST /zeroexo/h3/cancel；openai → DELETE /v1/videos/{id}；本地立即置 canceled
 *   并停止轮询，提示「已保留 N 段」；
 * - 引导（仅 direct）：当前生成段 N≥2 拉一次 /guidance（404 → null，UI 标未就绪不报错）；
 * - 提交/轮询/下载均带 Authorization 检查：未授权（无 localStorage token）直接报错，
 *   因为 putMedia 需要 CAS 落盘能力（下载了也存不进去）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  cancelBridgeJob,
  downloadBridgeSegment,
  fetchBridgeGuidance,
  fetchBridgeStatus,
  startBridgeRun,
  uploadBridgePack,
  type BridgeGuidance,
  type BridgeRunModels,
} from './comfyui-bridge-client.js';
import type { OpenaiChannelCredentials } from './openai-protocol-client.js';
import {
  cancelProtocolVideoJob,
  downloadProtocolVideo,
  fetchProtocolVideoStatus,
  startProtocolDirectorRun,
} from './openai-protocol-client.js';
import { buildDirectorPack, buildRunOverrides, type RefMediaResolver } from './director-pack-builder.js';
import { createPreviewClientId, DirectorPreviewSocket, type DirectorPreviewFrame } from './comfyui-ws-client.js';
import { newMediaKey, putMedia, resolveMediaUrl } from '@/platform/media.js';
import { isAuthorized } from '@/platform/fs.js';
import type { DirectorModelTier, RunShotLike, SharedParamsLike, SubjectCoverOf } from '@/entities/director-params.js';

export type DirectorRunPhase = 'idle' | 'submitting' | 'queued' | 'running' | 'success' | 'error' | 'canceled';

/** 双传输模式配置（渠道面板产物）：openai 主路径 / direct 高级直连 */
export type DirectorBridgeConfig =
  | { mode: 'openai'; channel: OpenaiChannelCredentials }
  | { mode: 'direct'; baseUrl: string; token?: string; models: BridgeRunModels };

export interface DirectorRunCallbacks {
  /** 段状态变化（选中段进入生成 / 完成 / 失败 / 已取消） */
  onSegmentState(shotId: string, state: 'generating' | 'done' | 'failed' | 'cancelled'): void;
  /** 段完成并已落库（视频 storageKey + 首帧缩略） */
  onSegmentDone(shotId: string, payload: { videoStorageKey: string; firstFrameKey?: string; firstFrameUrl?: string }): void;
  /** 预览区自动跟随最新完成段 */
  onFollowSegment(shotId: string): void;
  /** 非致命提示（下载失败/引导缺失等，不打断运行） */
  onNotice(level: 'info' | 'warning' | 'error', node: ReactNode): void;
}

export interface StartRunArgs {
  selectedIds: string[];
  shots: RunShotLike[];
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  width: number;
  height: number;
  projectId: string;
  episode: string;
  subjectCoverOf?: SubjectCoverOf;
  resolveMedia?: RefMediaResolver;
}

export interface UseDirectorRunArgs {
  /** 运行渠道（openai 主路径 / direct 高级直连）+ 各自凭据（渠道面板产物） */
  getBridgeConfig: () => DirectorBridgeConfig | null;
  callbacks: DirectorRunCallbacks;
  /** 轮询间隔（默认 3000ms，测试可注入小值） */
  pollIntervalMs?: number;
}

export interface DirectorRunState {
  phase: DirectorRunPhase;
  jobId: string | null;
  /** /run 返回的队列序号（排队中显示「队列位置 N」） */
  queueNumber: number | null;
  /** 正在生成的段（1 基，含 writing/pending-已开写） */
  currentSegment: number | null;
  doneCount: number;
  totalCount: number;
  /** 提交/运行失败的人话错误 */
  error: string | null;
  /** 取消后保留的已完成段数 */
  canceledKept: number | null;
  /** 本次运行的段 → 片段 id（1 基段号 = 下标+1；宿主映射「第 N 段」用） */
  segmentShotIds: string[];
  /** 段号(1基) → 引导 dataURI（null = 未就绪；不含未拉取的段） */
  guidance: Record<number, { image: string | null }>;
  /** 实时预览帧（/ws，直连模式；null = 无帧；progress-only 事件时 image=null 只带 step） */
  preview: DirectorPreviewFrame | null;
  /** 本次运行是否支持实时帧（direct → true；openai 无 ws → false，UI 标「仅进度」） */
  livePreviewSupported: boolean;
}

const INITIAL_STATE: DirectorRunState = {
  phase: 'idle',
  jobId: null,
  queueNumber: null,
  currentSegment: null,
  doneCount: 0,
  totalCount: 0,
  error: null,
  canceledKept: null,
  segmentShotIds: [],
  guidance: {},
  preview: null,
  livePreviewSupported: false,
};

// ===== 主线程截帧（串行队列：同一时刻只解码一个视频） =====

const extractQueue: Array<() => Promise<void>> = [];
let extractBusy = false;

function runQueue(): void {
  if (extractBusy) return;
  const next = extractQueue.shift();
  if (!next) return;
  extractBusy = true;
  void next().finally(() => {
    extractBusy = false;
    runQueue();
  });
}

function enqueueExtract(task: () => Promise<void>): void {
  extractQueue.push(task);
  runQueue();
}

function waitEvent(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => cleanup(false), timeoutMs);
    const onOk = () => cleanup(true);
    const onErr = () => cleanup(false);
    function cleanup(ok: boolean): void {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      resolve(ok);
    }
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/** 取视频首帧为 WebP blob；任何异常路径都 resolve（null）而非 reject（rules 铁律） */
export function extractFirstFrame(videoBlob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    enqueueExtract(async () => {
      const url = URL.createObjectURL(videoBlob);
      const el = document.createElement('video');
      try {
        el.muted = true;
        el.preload = 'auto';
        el.src = url;
        if (!(await waitEvent(el, 'loadeddata', 8000))) return resolve(null);
        // duration=Infinity 经典坑：先 seek 大值触发修正
        if (!Number.isFinite(el.duration) || el.duration <= 0) {
          el.currentTime = 1e7;
          await waitEvent(el, 'seeked', 2000);
        }
        const t = Number.isFinite(el.duration) ? Math.min(0.04, el.duration) : 0.04;
        el.currentTime = t;
        if (!(await waitEvent(el, 'seeked', 4000))) return resolve(null);
        const canvas = document.createElement('canvas');
        canvas.width = el.videoWidth || 320;
        canvas.height = el.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), 'image/webp', 0.85));
        resolve(blob);
      } catch {
        resolve(null); // 跨域 tainted / 解码异常：静默降级（本流程 blob URL 同源，理论不触发）
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  });
}

// ===== hook =====

export function useDirectorRun(args: UseDirectorRunArgs): DirectorRunState & {
  startRun: (runArgs: StartRunArgs) => Promise<boolean>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<DirectorRunState>(INITIAL_STATE);
  const pollTimer = useRef<number | null>(null);
  const doneIndexes = useRef<Set<number>>(new Set());
  const guidanceRequested = useRef<Set<number>>(new Set());
  const canceled = useRef(false);
  const activeJob = useRef<{ mode: 'openai' | 'direct'; jobId: string; segmentShotIds: string[]; projectId: string } | null>(null);
  const cfgRef = useRef(args.getBridgeConfig);
  const cbRef = useRef(args.callbacks);
  const pollMs = args.pollIntervalMs ?? 3000;
  cfgRef.current = args.getBridgeConfig;
  cbRef.current = args.callbacks;

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /** 实时预览 socket（直连模式：/ws + clientId 与 /run 提交同源；结束即关闭） */
  const previewSocket = useRef<DirectorPreviewSocket | null>(null);
  const stopPreview = useCallback(() => {
    previewSocket.current?.close();
    previewSocket.current = null;
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  const patch = useCallback((p: Partial<DirectorRunState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  /** 段完成：下载（按传输模式）→ 落库（video + 首帧）→ 回调宿主 */
  const processDoneSegment = useCallback(
    async (segIndex: number, shotId: string, downloadUrl: string, projectId: string) => {
      const cfg = cfgRef.current();
      try {
        const videoBlob =
          cfg?.mode === 'openai'
            ? await downloadProtocolVideo(cfg.channel, downloadUrl)
            : await downloadBridgeSegment(cfg?.baseUrl ?? '', downloadUrl, cfg?.token);
        if (!isAuthorized()) throw new Error('本地资产库未授权（登录后才能把生成结果存入项目资产）');
        const videoKey = newMediaKey('video', projectId, 'video/mp4');
        await putMedia(videoKey.storageKey, videoBlob, 'video/mp4');
        let firstFrameKey: string | undefined;
        let firstFrameUrl: string | undefined;
        const frame = await extractFirstFrame(videoBlob);
        if (frame) {
          const imgKey = newMediaKey('image', projectId, 'image/webp');
          await putMedia(imgKey.storageKey, frame, 'image/webp');
          firstFrameKey = imgKey.storageKey;
          firstFrameUrl = await resolveMediaUrl(imgKey.storageKey);
        }
        cbRef.current.onSegmentDone(shotId, { videoStorageKey: videoKey.storageKey, firstFrameKey, firstFrameUrl });
        cbRef.current.onFollowSegment(shotId);
      } catch (err) {
        cbRef.current.onNotice(
          'error',
          `第 ${segIndex} 段视频已生成但保存失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [],
  );

  /** 引导拉取（仅 direct：段 N≥2；404 → null 记未就绪，一次/段） */
  const requestGuidance = useCallback(async (jobId: string, segment: number) => {
    if (segment < 2 || guidanceRequested.current.has(segment)) return;
    const cfg = cfgRef.current();
    if (!cfg || cfg.mode !== 'direct') return;
    guidanceRequested.current.add(segment);
    let g: BridgeGuidance | null = null;
    try {
      g = await fetchBridgeGuidance(cfg.baseUrl, jobId, segment, cfg.token);
    } catch {
      g = null;
    }
    setState((s) => ({ ...s, guidance: { ...s.guidance, [segment]: { image: g?.image ?? null } } }));
  }, []);

  const pollTick = useCallback(async () => {
    const job = activeJob.current;
    const cfg = cfgRef.current();
    if (!job || !cfg || canceled.current) return;
    let status;
    try {
      status =
        cfg.mode === 'openai'
          ? await fetchProtocolVideoStatus(cfg.channel, job.jobId, job.segmentShotIds.length)
          : await fetchBridgeStatus(cfg.baseUrl, job.jobId, cfg.token);
    } catch (err) {
      // 网络抖动：保持轮询，只在连续失败时提示（简化：直接 notice，不计数）
      cbRef.current.onNotice('warning', `状态查询失败：${err instanceof Error ? err.message : String(err)}，将继续重试`);
      return;
    }
    if (canceled.current) return; // 取消发生在 await 期间：丢弃本次结果，别把 phase 改回 running
    const segs = status.segments ?? [];
    // 完成段（不等全部跑完，逐段落库）
    for (const seg of segs) {
      if (seg.state === 'done' && !doneIndexes.current.has(seg.index) && seg.downloadUrl) {
        doneIndexes.current.add(seg.index);
        const shotId = job.segmentShotIds[seg.index - 1];
        if (shotId) void processDoneSegment(seg.index, shotId, seg.downloadUrl, job.projectId);
      }
    }
    const doneCount = segs.filter((s) => s.state === 'done').length;
    const next: Partial<DirectorRunState> = {
      doneCount,
      currentSegment: status.currentSegment,
    };
    if (status.state === 'queued') next.phase = 'queued';
    else if (status.state === 'running') next.phase = 'running';
    else if (status.state === 'success') {
      next.phase = 'success';
    } else if (status.state === 'error') {
      next.phase = 'error';
      next.error = status.error ?? '上游执行失败（详见 ComfyUI 侧日志）';
    } else if (status.state === 'canceled') {
      next.phase = 'canceled';
      next.canceledKept = doneCount;
    }
    patch(next);
    if (status.currentSegment !== null && status.currentSegment >= 2) {
      void requestGuidance(job.jobId, status.currentSegment);
    }
    if (status.state === 'success' || status.state === 'error' || status.state === 'canceled') {
      stopPolling();
      stopPreview(); // 结束即清实时帧，预览区切回成品/占位
      setState((s) => ({ ...s, preview: null }));
      activeJob.current = null;
    }
  }, [patch, processDoneSegment, requestGuidance, stopPolling, stopPreview]);

  const startRun = useCallback(
    async (runArgs: StartRunArgs): Promise<boolean> => {
      const cfg = cfgRef.current();
      if (!cfg) {
        patch({ phase: 'error', error: '尚未连接 ComfyUI：请点右上角「ComfyUI」填一个地址并测试连接' });
        return false;
      }
      if (!isAuthorized()) {
        patch({ phase: 'error', error: '本地资产库未授权：生成结果需要落盘到项目资产，请先登录' });
        return false;
      }
      stopPolling();
      stopPreview();
      doneIndexes.current = new Set();
      guidanceRequested.current = new Set();
      canceled.current = false;
      activeJob.current = null;
      setState({
        ...INITIAL_STATE,
        phase: 'submitting',
        totalCount: runArgs.selectedIds.length,
        livePreviewSupported: cfg.mode === 'direct',
      });
      try {
        let jobId: string;
        let queueNumber: number | null = null;
        let segmentShotIds: string[];
        if (cfg.mode === 'openai') {
          // 主路径：OpenAI 兼容协议（媒体内联 dataURL，无 zip 上传环节；参数映射唯一表 director-protocol-map）
          const started = await startProtocolDirectorRun(cfg.channel, {
            shots: runArgs.shots,
            shared: runArgs.shared,
            tier: runArgs.tier,
            selectedIds: runArgs.selectedIds,
            width: runArgs.width,
            height: runArgs.height,
            subjectCoverOf: runArgs.subjectCoverOf,
            resolveMedia: runArgs.resolveMedia,
          });
          if (started.warnings.length > 0) cbRef.current.onNotice('warning', started.warnings.join('；'));
          jobId = started.jobId;
          segmentShotIds = started.segmentShotIds;
        } else {
          // 高级：直连 ComfyUI 桥接（zip 包 → /zeroexo/h3/pack → /run）
          const built = await buildDirectorPack({
            shots: runArgs.shots,
            shared: runArgs.shared,
            tier: runArgs.tier,
            selectedIds: runArgs.selectedIds,
            width: runArgs.width,
            height: runArgs.height,
            subjectCoverOf: runArgs.subjectCoverOf,
            resolveMedia: runArgs.resolveMedia,
          });
          if (built.warnings.length > 0) cbRef.current.onNotice('warning', built.warnings.join('；'));
          const uploaded = await uploadBridgePack(cfg.baseUrl, built.zip, cfg.token);
          const overrides = buildRunOverrides({
            shared: runArgs.shared,
            tier: runArgs.tier,
            width: runArgs.width,
            height: runArgs.height,
            totalFrames: built.totalFrames,
          });
          // 实时预览：先建 /ws（clientId 同源），提交时带给桥接 → H3 节点帧定向发回本端
          const previewClientId = createPreviewClientId();
          const socket = new DirectorPreviewSocket(cfg.baseUrl, previewClientId, {
            onFrame: (frame) => setState((s) => (s.phase === 'running' || s.phase === 'queued' ? { ...s, preview: frame } : s)),
          });
          socket.connect();
          previewSocket.current = socket;
          const run = await startBridgeRun(cfg.baseUrl, {
            packId: uploaded.packId,
            projectId: runArgs.projectId,
            episode: runArgs.episode,
            models: cfg.models,
            overrides,
            clientId: previewClientId,
          }, cfg.token);
          jobId = run.jobId;
          queueNumber = run.number ?? null;
          segmentShotIds = built.segmentShotIds;
        }
        activeJob.current = { mode: cfg.mode, jobId, segmentShotIds, projectId: runArgs.projectId };
        patch({
          phase: 'queued',
          jobId,
          queueNumber,
          totalCount: segmentShotIds.length,
          segmentShotIds,
        });
        for (const shotId of segmentShotIds) cbRef.current.onSegmentState(shotId, 'generating');
        pollTimer.current = window.setInterval(() => void pollTick(), pollMs);
        void pollTick();
        return true;
      } catch (err) {
        stopPreview();
        patch({ phase: 'error', error: err instanceof Error ? err.message : String(err), preview: null });
        return false;
      }
    },
    [patch, pollMs, pollTick, stopPolling, stopPreview],
  );

  const cancel = useCallback(async () => {
    const job = activeJob.current;
    const cfg = cfgRef.current();
    if (!job || !cfg || canceled.current) return;
    canceled.current = true;
    try {
      if (cfg.mode === 'openai' && job.mode === 'openai') {
        await cancelProtocolVideoJob(cfg.channel, job.jobId);
      } else if (cfg.mode === 'direct' && job.mode === 'direct') {
        await cancelBridgeJob(cfg.baseUrl, job.jobId, cfg.token);
      }
    } catch (err) {
      // 取消请求本身失败（ComfyUI 不响应/404）也不能停在「生成中」：本地仍落到确定状态
      cbRef.current.onNotice(
        'warning',
        `取消请求失败（后端未确认）：${err instanceof Error ? err.message : String(err)}，本地已按「已取消」处理`,
      );
    }
    /* 2026-11-05 修复（取消后片段卡片一直显示生成中）：此前 cancel 只改总状态、漏了段条目——
       进行中的段从未被回写。现在不等轮询，立即把未完成的段置「已取消」（cancelled）；
       已完成段（doneIndexes，1 基段号）保持「完成」且产物不动 */
    job.segmentShotIds.forEach((shotId, i) => {
      if (!doneIndexes.current.has(i + 1)) cbRef.current.onSegmentState(shotId, 'cancelled');
    });
    stopPolling(); // 停轮询
    stopPreview(); // 停 WS 预览订阅，不再收帧
    activeJob.current = null;
    setState((s) => ({ ...s, phase: 'canceled', canceledKept: doneIndexes.current.size, preview: null }));
  }, [stopPolling, stopPreview]);

  const reset = useCallback(() => {
    stopPolling();
    stopPreview();
    canceled.current = false;
    activeJob.current = null;
    doneIndexes.current = new Set();
    guidanceRequested.current = new Set();
    setState(INITIAL_STATE);
  }, [stopPolling, stopPreview]);

  return { ...state, startRun, cancel, reset };
}
