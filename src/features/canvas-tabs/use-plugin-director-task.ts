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
  preview: { image: string; video?: string; mime?: string; step: number | null; totalSteps: number | null; segmentIndex: number | null } | null;
  livePreviewSupported: boolean;
  startedAt: number;
}

const INITIAL: PluginDirectorState = {
  phase: 'idle', taskId: null, jobId: null, queueNumber: null, currentSegment: null,
  doneCount: 0, totalCount: 0, error: null, canceledKept: null, segmentShotIds: [],
  guidance: {}, preview: null, livePreviewSupported: true, startedAt: 0,
};

const PHASE: Record<string, PluginDirectorPhase> = {
  queued: 'queued', running: 'running', success: 'success', error: 'error',
  failed: 'error', cancelled: 'canceled', canceled: 'canceled', interrupted: 'error',
};

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
    const phase = PHASE[task.state] ?? 'queued';
    const current = task.currentSegment ?? null;
    const queue = useTaskQueueStore.getState();
    if (!queueStartedRef.current.has(task.taskId)) {
      queueStartedRef.current.add(task.taskId);
      queue.start({
        id: task.taskId,
        kind: 'director',
        title: task.title || `导演台出片 · ${segs.length} 段`,
        phase: '排队中',
      });
    }
    if (task.state === 'running' || task.state === 'queued') {
      const currentSeg = current ? segs[current - 1] : undefined;
      queue.update(task.taskId, {
        phase: current ? `第 ${current}/${task.totalCount ?? segs.length} 段` : '排队中',
        ...(currentSeg?.progress ? { progress: currentSeg.progress } : {}),
      });
    }
    if (['success', 'error', 'interrupted', 'cancelled'].includes(task.state) && !queueFinishedRef.current.has(task.taskId)) {
      queueFinishedRef.current.add(task.taskId);
      queue.finish(
        task.taskId,
        task.state === 'success' ? 'success' : task.state === 'cancelled' ? 'cancelled' : 'error',
        task.error ?? undefined,
      );
    }

    // 段状态 diff：只在变化时通知宿主
    for (const seg of segs) {
      const shotId = seg.shotId;
      if (!shotId) continue;
      const prev = segmentStateRef.current.get(seg.index);
      if (prev === seg.state) continue;
      segmentStateRef.current.set(seg.index, seg.state);
      if (seg.state === 'running' || seg.state === 'queued') {
        if (seg.state === 'running') cbRef.current.onSegmentState(shotId, 'generating');
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
      if (landedRef.current.has(key)) continue;
      if (!seg.outputs?.some((o) => o.path)) continue;
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
          const version: WorkbenchShotVersion = {
            id: `ver_${task.taskId}_${seg.index}`,
            storageKey: landed.storageKey,
            previewKey: seg.previewPath ? pluginViewUrl(base ?? '', seg.previewPath) ?? undefined : undefined,
            guide: landed.guide ?? (seg.guide?.id ? { id: seg.guide.id, frames: seg.guide.frames } : null),
            prompt: seg.prompt ?? '',
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
    const currentSeg: PluginTaskSegment | undefined = current ? segs[current - 1] : undefined;
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
      error: task.state === 'error' || task.state === 'interrupted'
        ? (task.error ?? '任务失败') : null,
      canceledKept: task.state === 'cancelled' ? (task.doneCount ?? segs.filter((x) => x.state === 'success').length) : null,
      segmentShotIds: segs.map((x) => x.shotId).filter((x): x is string => Boolean(x)),
      startedAt: Date.parse(task.createdAt ?? '') || Date.now(),
      preview: (() => {
        if (!previewUrl) return s.preview;
        // 恢复条件：无预览（刚刷新）/ 换段 / WS 实时帧落后于落盘进度（连接断了或刚打开页面）。
        // WS 帧更新时不动它，避免轮询把新帧盖回旧文件。
        const persistedStep = currentSeg?.progress?.step ?? null;
        const cur = s.preview;
        const needRestore = !cur
          || cur.segmentIndex !== current
          || cur.step === null
          || (persistedStep !== null && cur.step < persistedStep);
        if (!needRestore) return s.preview;
        return previewIsVideo
          ? { image: '', video: previewUrl, mime: previewMime, step: persistedStep, totalSteps: currentSeg?.progress?.totalSteps ?? null, segmentIndex: current }
          : { image: previewUrl, mime: previewMime, step: persistedStep, totalSteps: currentSeg?.progress?.totalSteps ?? null, segmentIndex: current };
      })(),
    }));

    if ((task.state === 'error' || task.state === 'interrupted') && task.error && errorNotifiedRef.current !== task.taskId) {
      errorNotifiedRef.current = task.taskId;
      cbRef.current.onNotice('error', `生成失败：${task.error}`);
    }
    if (['success', 'error', 'interrupted', 'cancelled'].includes(task.state)) {
      stopPolling();
      closePreview();
    }
  }, [args.projectId, stopPolling, closePreview]);

  const poll = useCallback(async (taskId: string) => {
    const task = await getPluginTask(taskId).catch(() => null);
    if (task) await applyTask(task);
  }, [applyTask]);

  const startPolling = useCallback((taskId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(() => { void poll(taskId); }, 2000);
  }, [poll, stopPolling]);

  // 挂载/刷新：从插件任务表恢复（优先进行中，否则最近一条）
  useEffect(() => () => closePreview(), [closePreview]);

  useEffect(() => {
    const projectId = args.projectId ?? null;
    if (!projectId) { setState(INITIAL); return; }
    let cancelled = false;
    void listPluginTasks(projectId).then((tasks) => {
      if (cancelled || tasks.length === 0) return;
      const active = tasks.find((t) => t.state === 'running' || t.state === 'queued');
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
      setState({
        ...INITIAL,
        phase: 'submitting',
        taskId: runArgs.payload.clientJobId,
        totalCount: runArgs.payload.segments.length,
        segmentShotIds: runArgs.selectedIds,
        startedAt: Date.now(),
      });
      const task = await submitPluginTask({ ...runArgs.payload, projectId: runArgs.projectId });
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
    setState(INITIAL);
  }, [stopPolling, closePreview]);

  return { ...state, startRun, cancel, reset };
}
