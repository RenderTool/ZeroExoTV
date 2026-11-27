/**
 * usePluginDirectorTask — 导演台运行（ComfyUI 插件任务源，2026-11-16）。
 *
 * 与 MCP 版本的区别：
 * - 提交/取消/查询直连 ComfyUI 插件 `/zeroexo/v1/tasks`；
 * - 插件自己持久化任务，关网页/关 MCP 不影响执行；
 * - 网页只负责轮询、把完成段落库到项目、刷新后从插件任务列表恢复。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorkbenchShotVersion } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { PluginBatchPayload } from './director-plugin-payload.js';
import {
  cancelPluginTask,
  listPluginTasks,
  pluginTaskBase,
  submitPluginTask,
  getPluginTask,
  type PluginTask,
  type PluginTaskSegment,
} from '@/features/task-center/plugin-task-client.js';
import { landPluginSegment, pluginViewUrl } from './plugin-task-landing.js';
import { useTaskQueueStore } from '@/features/task-center/task-queue-store.js';
import { recordLastSeed } from '@/shared/last-seed-store.js';
import { consumeFailureNotice, failureNoticeText } from './failure-notice.js';

export type PluginDirectorPhase = 'idle' | 'submitting' | 'queued' | 'running' | 'success' | 'error' | 'canceled';

export interface PluginSegmentDonePayload {
  videoStorageKey: string;
  firstFrameKey?: string;
  firstFrameUrl?: string;
  guide?: { id: string; path?: string; frames?: number; sha256?: string; localKey?: string };
  version?: WorkbenchShotVersion;
}

export interface PluginDirectorCallbacks {
  onSegmentState(shotId: string, state: 'generating' | 'done' | 'failed' | 'cancelled' | 'interrupted'): void;
  onSegmentDone(shotId: string, payload: PluginSegmentDonePayload): void;
  onFollowSegment(shotId: string): void;
  onNotice(level: 'info' | 'warning' | 'error', node: ReactNode): void;
}

export interface PluginStartRunArgs {
  projectId: string;
  selectedIds: string[];
  episode?: string;
  payload: PluginBatchPayload;
  beforeSubmit?: () => Promise<void>;
}

export interface PluginDirectorState {
  phase: PluginDirectorPhase;
  taskId: string | null;
  jobId: string | null;
  queueNumber: number | null;
  currentSegment: number | null;
  doneCount: number;
  totalCount: number;
  error: string | null;
  canceledKept: number | null;
  segmentShotIds: string[];
  guidance: Record<number, { image: string | null }>;
  /** 采样预览：mime=video/mp4 时 src 在 video（<video> 循环播放），否则在 image（<img>） */
  preview: { image: string; video?: string; mime?: string; step: number | null; totalSteps: number | null; segmentIndex: number | null; fps?: number | null } | null;
  livePreviewSupported: boolean;
  startedAt: number;
}

const INITIAL: PluginDirectorState = {
  phase: 'idle', taskId: null, jobId: null, queueNumber: null, currentSegment: null,
  doneCount: 0, totalCount: 0, error: null, canceledKept: null, segmentShotIds: [],
  guidance: {}, preview: null, livePreviewSupported: true, startedAt: 0,
};

/** 连续轮询失败几次后判定 ComfyUI 已断开；2 秒一次，避免一次网络抖动就误报。 */
const POLL_FAILURE_LIMIT = 3;
const OFFLINE_MESSAGE = 'ComfyUI 连接已断开或任务已丢失，无法确认任务状态';
/**
 * 运行时心跳（2026-11-20 用户报障：任务挂了 2 小时，打开 ComfyUI 才发现显存炸了）。
 * 轮询失败时不能只说「连接断开」——要明确提示可能是进程崩溃/显存不足，并给出可执行动作。
 */
const OOM_HINT_MESSAGE =
  'ComfyUI 无响应，任务已挂起。常见原因是进程崩溃或显存不足（OOM）。请查看 ComfyUI 控制台报错，重启 ComfyUI 后重试该段（不是网页失联阈值误判）';

/** 心跳探活：/zeroexo/v1/health 短超时；返回 false 说明 ComfyUI 进程本身不响应 */
async function probeComfyHeartbeat(base: string | null): Promise<boolean> {
  if (!base) return false;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base.replace(/\/+$/, '')}/zeroexo/v1/health`, { signal: controller.signal });
    window.clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

const PHASE: Record<string, PluginDirectorPhase> = {
  queued: 'queued', running: 'running', success: 'success', error: 'error',
  failed: 'error', cancelled: 'canceled', canceled: 'canceled', interrupted: 'error',
};

/** 任务表里可能同时存在「排队」和「运行」两批（网页点一次、MCP 又提交一次）。
 *  接管必须优先 running：此前按数组顺序取第一个 active，刷新后接到的往往是排队批次，
 *  页面就显示「排队中」骨架 + 片段「未生成」，真正的运行批次和实时预览反而不见。
 *
 *  另外必须过滤「死任务」：云端 ComfyUI 重启/掉线后，旧批次会一直挂在 queued/running，
 *  没有任何心跳。接管它会把这批的片段点亮成「生成中」，用户点第 2 段却看到第 1 段在转，
 *  其实云端什么都没跑。
 *
 *  2026-11-19 用户纠正：不能用「15 分钟没更新」判死 —— 高分辨率长片单批跑到 1–2 小时是常态，
 *  中途采样不写 updatedAt 很常见，短阈值会把正在跑的真任务误判成失联、直接把批次打成 error。
 *  阈值放宽到「排队 1 小时 / 运行 4 小时」只用于兜真正的僵尸任务；连不上服务仍由轮询失败 3 次判定。 */
const STALE_QUEUED_MS = 60 * 60 * 1000;
const STALE_RUNNING_MS = 4 * 60 * 60 * 1000;

function pickActiveTask(tasks: PluginTask[]): PluginTask | null {
  const score = (t: PluginTask) => Date.parse(t.updatedAt ?? t.createdAt ?? '') || 0;
  const now = Date.now();
  const fresh = (t: PluginTask) => {
    const at = score(t);
    if (!at) return true;
    return now - at <= (t.state === 'running' ? STALE_RUNNING_MS : STALE_QUEUED_MS);
  };
  /**
   * 2026-11-27 用户报障「生成完成后再次发起的任务看不到进度和预览」：
   * 上一批已经出完片的批次，插件侧可能永远停在 running（回调丢了/进程重启），
   * 它会一直排在 running 队首，4 秒一次的接管轮询就把本页刚提交的新批次抢掉 ——
   * 页面回到全「完成」，新任务的进度与预览彻底不可见。
   * 段全 success 的任务一律不算活跃（它就是「已完成」），不允许再被接管。
   */
  const allSegsSuccess = (t: PluginTask) => {
    const segs = t.segments ?? [];
    return segs.length > 0 && segs.every((x) => x.state === 'success');
  };
  const running = tasks.filter((t) => t.state === 'running' && fresh(t) && !allSegsSuccess(t)).sort((a, b) => score(b) - score(a));
  if (running.length > 0) return running[0]!;
  const queued = tasks.filter((t) => t.state === 'queued' && fresh(t) && !allSegsSuccess(t)).sort((a, b) => score(b) - score(a));
  return queued[0] ?? null;
}

export function usePluginDirectorTask(args: {
  projectId: string | null | undefined;
  callbacks: PluginDirectorCallbacks;
}): PluginDirectorState & {
  startRun: (runArgs: PluginStartRunArgs) => Promise<boolean>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<PluginDirectorState>(INITIAL);
  const cbRef = useRef(args.callbacks);
  cbRef.current = args.callbacks;
  const taskRef = useRef<PluginTask | null>(null);
  const segmentStateRef = useRef<Map<number, string>>(new Map());
  const landedRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const errorNotifiedRef = useRef<string | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());
  const queueStartedRef = useRef<Set<string>>(new Set());
  const queueFinishedRef = useRef<Set<string>>(new Set());
  const pollFailuresRef = useRef(0);
  const offlineNotifiedRef = useRef<string | null>(null);
  /** 心跳连续失败计数 / 已提示过的任务（同一批只提示一次，不刷屏） */
  const heartbeatFailRef = useRef(0);
  const heartbeatNotifiedRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  /** 直连 ComfyUI /ws：插件子任务用同一 clientId 推 minimax_director_preview。 */
  const connectPreview = useCallback((clientId: string) => {
    closePreview();
    const base = pluginTaskBase();
    if (!base || !clientId || typeof WebSocket !== 'function') return;
    const url = base.replace(/^http/i, 'ws').replace(/\/+$/, '') + `/ws?clientId=${encodeURIComponent(clientId)}`;
    try {
      (window as unknown as { __zxPreviewWs?: string }).__zxPreviewWs = url;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          let msg: { type?: string; data?: Record<string, unknown> };
          try { msg = JSON.parse(ev.data) as { type?: string; data?: Record<string, unknown> }; } catch { return; }
          if (msg.type !== 'minimax_director_preview' && msg.type !== 'progress') return;
          const d = msg.data ?? {};
          const b64 = typeof d.image_b64 === 'string' ? d.image_b64 : '';
          const mime = typeof d.mime === 'string' ? d.mime : 'image/jpeg';
          const step = typeof d.step === 'number' ? d.step : (typeof d.value === 'number' ? d.value : null);
          const totalSteps = typeof d.total_steps === 'number' ? d.total_steps : (typeof d.max === 'number' ? d.max : null);
          const segmentIndex = typeof d.segment_index === 'number' ? d.segment_index + 1 : null;
          if (!b64 && step === null) return;
          const isVideo = mime === 'video/mp4';
          // 2026-11-21（C-20）预览帧率：插件按 mime=video / webp 时给 fps，缺了就不推帧号
          const fps = typeof d.fps === 'number' && d.fps > 0 ? d.fps : null;
          setState((s) => ({
            ...s,
            preview: {
              // video/mp4 → <video> 循环播放整段采样片段；webp/jpeg → <img>
              ...(isVideo
                ? { video: b64 ? `data:${mime};base64,${b64}` : s.preview?.video, image: '' }
                : { image: b64 ? `data:${mime};base64,${b64}` : (s.preview?.image ?? '') }),
              mime,
              step,
              totalSteps,
              segmentIndex: segmentIndex ?? s.preview?.segmentIndex ?? null,
              fps: fps ?? s.preview?.fps ?? null,
            },
          }));
          return;
        }
        // ComfyUI 原生 PREVIEW_IMAGE：4 字节事件类型 + 直接 JPEG 字节（无额外图片类型头）
        const raw = ev.data instanceof ArrayBuffer ? ev.data : null;
        if (!raw || raw.byteLength <= 4) return;
        const view = new DataView(raw);
        if (view.getUint32(0) !== 1) return;
        const bytes = new Uint8Array(raw, 4);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
        setState((s) => ({ ...s, preview: { image: `data:image/jpeg;base64,${btoa(bin)}`, step: s.preview?.step ?? null, totalSteps: s.preview?.totalSteps ?? null, segmentIndex: s.preview?.segmentIndex ?? null } }));
      };
      ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null; };
      wsRef.current = ws;
    } catch { /* 预览不可用不阻断任务 */ }
  }, [closePreview]);

  const applyTask = useCallback(async (task: PluginTask) => {
    if (dismissedRef.current.has(task.taskId)) return;
    taskRef.current = task;
    const base = pluginTaskBase();
    const segs = task.segments ?? [];
    // 2026-11-19 用户实测「早就出片了，网页一直显示生成中」：
    // 插件/MCP 的任务记录会卡在 running（回调丢了），或整批段都 success 但任务没翻状态。
    // 这里以「段事实」为准兜底：段全 success → 直接按 success 收口；任务记录长时间没心跳
    // 也按失联处理，不能让片段永久转圈。
    const allSegsSuccess = segs.length > 0 && segs.every((x) => x.state === 'success');
    const updatedAt = Date.parse(task.updatedAt ?? task.createdAt ?? '') || 0;
    const staleActive = updatedAt > 0 && (Date.now() - updatedAt) > (task.state === 'running' ? STALE_RUNNING_MS : STALE_QUEUED_MS);
    const stateKey = allSegsSuccess ? 'success' : staleActive ? 'error' : task.state;
    const phase = PHASE[stateKey] ?? 'queued';
    const current = allSegsSuccess ? null : task.currentSegment ?? null;
    const queue = useTaskQueueStore.getState();
    // 用户已「清空已完成」的任务不再入队（刷新恢复也不能复活）；落库流程不受影响。
    const queueDismissed = queue.dismissed.has(task.taskId);
    if (!queueDismissed && !queueStartedRef.current.has(task.taskId)) {
      queueStartedRef.current.add(task.taskId);
      queue.start({
        id: task.taskId,
        kind: 'director',
        title: task.title || `导演台出片 · ${segs.length} 段`,
        phase: '排队中',
      });
    }
    if (!queueDismissed && (task.state === 'running' || task.state === 'queued')) {
      const currentSeg = current ? segs[current - 1] : undefined;
      queue.update(task.taskId, {
        phase: current ? `第 ${current}/${task.totalCount ?? segs.length} 段` : '排队中',
        ...(currentSeg?.progress ? { progress: currentSeg.progress } : {}),
      });
    }
    if (!queueDismissed && ['success', 'error', 'interrupted', 'cancelled'].includes(stateKey) && !queueFinishedRef.current.has(task.taskId)) {
      queueFinishedRef.current.add(task.taskId);
      queue.finish(
        task.taskId,
        stateKey === 'success' ? 'success' : stateKey === 'cancelled' ? 'cancelled' : 'error',
        task.error ?? (staleActive ? OFFLINE_MESSAGE : undefined),
      );
    }

    // 段状态 diff：只在变化时通知宿主
    // 插件任务仍在 running/queued 时，段级 interrupted 可能只是网页刷新导致
    // WebSocket 短暂断开后的瞬态值：此时不能写回「中断/未生成」，
    // 否则刷新一次就把正在生成的片段抹成 pending（2026-11-18 实测）。
    const taskActive = stateKey === 'running' || stateKey === 'queued';
    for (const seg of segs) {
      const shotId = seg.shotId;
      if (!shotId) continue;
      if (taskActive && seg.state === 'interrupted') continue;
      const prev = segmentStateRef.current.get(seg.index);
      if (prev === seg.state) continue;
      segmentStateRef.current.set(seg.index, seg.state);
      if (seg.state === 'running' || seg.state === 'queued') {
        // 2026-11-19 刷新丢状态：排队中的段也要把片段标成生成中，
        // 否则刷新后插件任务还在跑，网页却把片段显示成「未生成」。
        cbRef.current.onSegmentState(shotId, 'generating');
      } else if (seg.state === 'cancelled') {
        cbRef.current.onSegmentState(shotId, 'cancelled');
      } else if (seg.state === 'error') {
        cbRef.current.onSegmentState(shotId, 'failed');
      } else if (seg.state === 'interrupted') {
        cbRef.current.onSegmentState(shotId, 'interrupted');
      }
    }

    if (current && segs[current - 1]?.shotId) {
      cbRef.current.onFollowSegment(segs[current - 1]!.shotId!);
    }

    // 完成段落库（幂等；刷新后也会把已完成段补回来）
    for (const seg of segs) {
      if (seg.state !== 'success' || !seg.shotId) continue;
      const key = `${task.taskId}:${seg.shotId}`;
      // 2026-11-19：success 段因「已落过库 / outputs 缺 path / 落库失败」跳过落库时，
      // 也必须把片段从「生成中」收口（有片段的保留成片，没片段的回到未生成），
      // 否则任务早已结束，网页却一直转圈。
      if (landedRef.current.has(key) || !seg.outputs?.some((o) => o.path)) {
        cbRef.current.onSegmentState(seg.shotId, 'done');
        landedRef.current.add(key);
        continue;
      }
      landedRef.current.add(key);
      try {
        const landed = await landPluginSegment({
          base: base ?? '',
          projectId: task.projectId || args.projectId || '',
          shotId: seg.shotId,
          segment: seg,
          title: `片段 ${seg.index}`,
        });
        if (landed) {
          // 2026-11-19 用户实测：出片后「上次种子」还是暂无、历史记录也没有参数/提示词。
          // 原因是从插件的段里没把真实参数带进版本记录 —— 这里统一补上：
          // 版本 params 存插件回传的真实参数（尺寸/步数/seed），并把实际种子记到项目级「上次种子」。
          const segParams = (seg.params ?? {}) as Record<string, unknown>;
          const usedSeed = Number(segParams.seed);
          if (Number.isFinite(usedSeed)) {
            recordLastSeed(usedSeed, task.projectId || args.projectId || '');
          }
          const version: WorkbenchShotVersion = {
            id: `ver_${task.taskId}_${seg.index}`,
            storageKey: landed.storageKey,
            previewKey: seg.previewPath ? pluginViewUrl(base ?? '', seg.previewPath) ?? undefined : undefined,
            guide: landed.guide ?? (seg.guide?.id ? { id: seg.guide.id, frames: seg.guide.frames } : null),
            prompt: seg.prompt ?? String(segParams.prompt ?? ''),
            params: segParams,
            createdAt: new Date().toISOString(),
            status: 'done',
          };
          cbRef.current.onSegmentDone(seg.shotId, {
            videoStorageKey: landed.storageKey,
            firstFrameKey: version.previewKey,
            guide: version.guide ?? undefined,
            version,
          });
        }
      } catch (err) {
        // 落库失败允许下次刷新重试
        landedRef.current.delete(key);
        cbRef.current.onNotice('error', `片段 ${seg.index} 落库失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 当前段预览恢复（刷新不丢）：插件每步采样都把最新预览落盘并写回段 previewPath，
    // 这里按扩展名判断 mp4（<video>）或 webp/jpg/png（<img>），直接还原最近一次预览画面。
    // 2026-11-19 刷新实测：任务还在排队（currentSegment 为空）时，也要从「第一个排队/运行段」
    // 的 previewPath 还原上一张预览，否则刷新后预览区直接空白。
    const currentSeg: PluginTaskSegment | undefined = current
      ? segs[current - 1]
      : segs.find((x) => x.state === 'running' || x.state === 'queued');
    const previewSegmentNo = current ?? (currentSeg ? currentSeg.index : null);
    const previewUrl = currentSeg?.previewPath ? pluginViewUrl(base ?? '', currentSeg.previewPath) : null;
    const previewExt = (currentSeg?.previewPath ?? '').toLowerCase().split('.').pop() ?? '';
    const previewIsVideo = previewExt === 'mp4';
    const previewMime = previewIsVideo ? 'video/mp4' : previewExt === 'webp' ? 'image/webp' : 'image/jpeg';
    setState((s) => ({
      ...s,
      phase,
      taskId: task.taskId,
      jobId: task.taskId,
      currentSegment: current,
      doneCount: task.doneCount ?? segs.filter((x) => x.state === 'success').length,
      totalCount: task.totalCount ?? segs.length,
      error: stateKey === 'error' || stateKey === 'interrupted'
        ? (task.error ?? (staleActive ? OFFLINE_MESSAGE : '任务失败')) : null,
      canceledKept: stateKey === 'cancelled' ? (task.doneCount ?? segs.filter((x) => x.state === 'success').length) : null,
      // 2026-11-27 报障「重跑看不到进度」：插件刚创建任务时 segments 还是空数组，
      // 若直接用它覆盖 segmentShotIds，本页刚提交的段集合会被清空 → 卡片立刻回落到旧成片「完成」。
      // 段清单为空时保留提交时的集合，等插件回传段后再对齐。
      segmentShotIds: (() => {
        const fromTask = segs.map((x) => x.shotId).filter((x): x is string => Boolean(x));
        return fromTask.length > 0 ? fromTask : s.segmentShotIds;
      })(),
      startedAt: Date.parse(task.createdAt ?? '') || Date.now(),
      preview: (() => {
        if (!previewUrl) return s.preview;
        // 恢复条件：无预览（刚刷新）/ 换段 / WS 实时帧落后于落盘进度（连接断了或刚打开页面）。
        // WS 帧更新时不动它，避免轮询把新帧盖回旧文件。
        const persistedStep = currentSeg?.progress?.step ?? null;
        const cur = s.preview;
        const needRestore = !cur
          || cur.segmentIndex !== previewSegmentNo
          || cur.step === null
          || (persistedStep !== null && cur.step < persistedStep);
        if (!needRestore) return s.preview;
        return previewIsVideo
          ? { image: '', video: previewUrl, mime: previewMime, step: persistedStep, totalSteps: currentSeg?.progress?.totalSteps ?? null, segmentIndex: previewSegmentNo }
          : { image: previewUrl, mime: previewMime, step: persistedStep, totalSteps: currentSeg?.progress?.totalSteps ?? null, segmentIndex: previewSegmentNo };
      })(),
    }));

    if ((stateKey === 'error' || stateKey === 'interrupted') && (task.error || staleActive) && errorNotifiedRef.current !== task.taskId) {
      errorNotifiedRef.current = task.taskId;
      // 2026-11-22：同一条失败只弹一次（跨切页/刷新），文案不再出现「生成失败：生成失败」
      if (consumeFailureNotice(`director-plugin:${args.projectId ?? ''}`, task.taskId)) {
        cbRef.current.onNotice('error', failureNoticeText(task.error ?? OFFLINE_MESSAGE));
      }
    }
    if (['success', 'error', 'interrupted', 'cancelled'].includes(stateKey)) {
      stopPolling();
      closePreview();
    }
  }, [args.projectId, stopPolling, closePreview]);

  const poll = useCallback(async (taskId: string) => {
    let task: PluginTask | null = null;
    try {
      task = await getPluginTask(taskId);
    } catch {
      task = null;
    }
    if (!task) {
      pollFailuresRef.current += 1;
      // 2026-11-20：任务轮询不到时先做一次心跳探活，区分「只是任务记录取不到」与「ComfyUI 进程挂了」。
      // 连续两次心跳失败就明确提示显存不足/进程崩溃，并把队列行标成「ComfyUI 无响应」。
      if (pollFailuresRef.current >= 2) {
        const alive = await probeComfyHeartbeat(pluginTaskBase());
        heartbeatFailRef.current = alive ? 0 : heartbeatFailRef.current + 1;
        if (!alive && heartbeatFailRef.current >= 2) {
          const queue = useTaskQueueStore.getState();
          queue.update(taskId, { phase: 'ComfyUI 无响应' });
          if (heartbeatNotifiedRef.current !== taskId) {
            heartbeatNotifiedRef.current = taskId;
            cbRef.current.onNotice('error', OOM_HINT_MESSAGE);
          }
        }
      }
      if (pollFailuresRef.current < POLL_FAILURE_LIMIT) return;
      // 连续失败后不能继续显示“生成中”：ComfyUI 可能已经退出，任务状态未知。
      stopPolling();
      closePreview();
      setState((s) => ({ ...s, phase: 'error', error: OFFLINE_MESSAGE }));
      if (offlineNotifiedRef.current !== taskId) {
        offlineNotifiedRef.current = taskId;
        cbRef.current.onNotice('error', OFFLINE_MESSAGE);
      }
      return;
    }
    heartbeatFailRef.current = 0;
    pollFailuresRef.current = 0;
    await applyTask(task);
  }, [applyTask, stopPolling, closePreview]);

  const startPolling = useCallback((taskId: string) => {
    stopPolling();
    pollFailuresRef.current = 0;
    offlineNotifiedRef.current = null;
    heartbeatFailRef.current = 0;
    heartbeatNotifiedRef.current = null;
    pollRef.current = window.setInterval(() => { void poll(taskId); }, 2000);
  }, [poll, stopPolling]);

  // 挂载/刷新：从插件任务表恢复（优先进行中，否则最近一条）
  useEffect(() => () => closePreview(), [closePreview]);

  // 2026-11-19：任务表是唯一事实源，MCP / 另一个页面提交的批次本页也必须看见。
  // 之前只在挂载时 list 一次，运行中任务由 MCP 提交时本页永远拿不到 → 片段不亮「生成中」、无预览。
  useEffect(() => {
    const projectId = args.projectId ?? null;
    if (!projectId) return;
    const timer = window.setInterval(() => {
      if (pollRef.current !== null) return; // 自己正在轮询，不抢
      // 本页正在跟踪一个新鲜活跃任务（排队/运行）时，绝不让别的批次接管：
      // 否则重跑新批次会被上一条卡死的 running 任务抢回，进度与预览全部不可见。
      const mine = taskRef.current;
      if (mine && (mine.state === 'queued' || mine.state === 'running')) {
        const at = Date.parse(mine.updatedAt ?? mine.createdAt ?? '') || Date.now();
        const mineFresh = Date.now() - at <= (mine.state === 'running' ? STALE_RUNNING_MS : STALE_QUEUED_MS);
        if (mineFresh) return;
      }
      void listPluginTasks(projectId).then((tasks) => {
        const active = pickActiveTask(tasks);
        if (!active || active.taskId === taskRef.current?.taskId) return;
        void applyTask(active).then(() => {
          connectPreview(active.clientId || active.taskId);
          startPolling(active.taskId);
        });
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [args.projectId, applyTask, connectPreview, startPolling]);

  useEffect(() => {
    const projectId = args.projectId ?? null;
    if (!projectId) { setState(INITIAL); return; }
    let cancelled = false;
    void listPluginTasks(projectId).then((tasks) => {
      if (cancelled || tasks.length === 0) return;
      const active = pickActiveTask(tasks);
      const target = active ?? tasks[0]!;
      void applyTask(target).then(() => {
        if (active) {
          connectPreview(active.clientId || active.taskId);
          startPolling(active.taskId);
        }
      });
    }).catch(() => undefined);
    return () => { cancelled = true; stopPolling(); };
  }, [args.projectId, applyTask, connectPreview, startPolling, stopPolling]);

  const startRun = useCallback(async (runArgs: PluginStartRunArgs): Promise<boolean> => {
    if (runArgs.selectedIds.length === 0) {
      cbRef.current.onNotice('warning', '请先勾选要运行的片段');
      return false;
    }
    try {
      await runArgs.beforeSubmit?.();
      segmentStateRef.current = new Map();
      landedRef.current = new Set();
      errorNotifiedRef.current = null;
      pollFailuresRef.current = 0;
      offlineNotifiedRef.current = null;
      setState({
        ...INITIAL,
        phase: 'submitting',
        taskId: runArgs.payload.clientJobId,
        totalCount: runArgs.payload.segments.length,
        segmentShotIds: runArgs.selectedIds,
        startedAt: Date.now(),
      });
      const { task, warnings } = await submitPluginTask({ ...runArgs.payload, projectId: runArgs.projectId });
      if (warnings.length) {
        cbRef.current.onNotice('warning', `引导提示：${warnings.join('；')}`);
      }
      connectPreview(runArgs.payload.clientId);
      await applyTask(task);
      startPolling(task.taskId);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: 'error', error: message }));
      cbRef.current.onNotice('error', `提交插件任务失败：${message}`);
      return false;
    }
  }, [applyTask, startPolling, connectPreview]);

  const cancel = useCallback(async (): Promise<void> => {
    const task = taskRef.current;
    if (!task) return;
    try {
      const next = await cancelPluginTask(task.taskId);
      await applyTask(next);
      const kept = next.doneCount ?? (next.segments ?? []).filter((s) => s.state === 'success').length;
      cbRef.current.onNotice('info', `已取消，已保留 ${kept} 段`);
    } catch (err) {
      cbRef.current.onNotice('error', `取消失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [applyTask]);

  const reset = useCallback((): void => {
    const task = taskRef.current;
    if (task) dismissedRef.current.add(task.taskId);
    taskRef.current = null;
    stopPolling();
    closePreview();
    segmentStateRef.current = new Map();
    landedRef.current = new Set();
    pollFailuresRef.current = 0;
    offlineNotifiedRef.current = null;
    setState(INITIAL);
  }, [stopPolling, closePreview]);

  return { ...state, startRun, cancel, reset };
}
