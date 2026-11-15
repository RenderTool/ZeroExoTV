/**
 * useDirectorTask — 导演台运行编排（MCP Task Broker 驱动，2026-11-15）。
 *
 * 网页不再提交 GPU 作业、不再持有 sessionStorage 续接：
 * - startRun 只把「项目 + 选中片段」提交给 MCP，任务落盘、串行执行、逐段解析 guide 都在 MCP；
 * - 挂载/刷新/多开都从任务表恢复：进度、当前段、最后一帧预览、完成段全部来自持久化任务；
 * - 每段完成回调带 MCP 落库的片段缓存版本（version），宿主合并进本地 shots 后再落盘，不会覆盖 cache。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { resolveMediaUrl } from '@/platform/media.js';
import type { WorkbenchShotVersion } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import {
  cancelBrokerTask,
  submitBrokerTask,
  subscribeBrokerTasks,
  type BrokerSegment,
  type BrokerTask,
} from '@/features/task-center/task-broker-client.js';

export type DirectorRunPhase = 'idle' | 'submitting' | 'queued' | 'running' | 'success' | 'error' | 'canceled';

export interface DirectorSegmentDonePayload {
  videoStorageKey: string;
  firstFrameKey?: string;
  firstFrameUrl?: string;
  guide?: { id: string; path?: string; frames?: number; sha256?: string; localKey?: string };
  /** MCP 落库的片段缓存版本（网页合并进 shot.cache，保证本地落盘不丢版本） */
  version?: WorkbenchShotVersion;
}

export interface DirectorRunCallbacks {
  onSegmentState(shotId: string, state: 'generating' | 'done' | 'failed' | 'cancelled' | 'interrupted'): void;
  onSegmentDone(shotId: string, payload: DirectorSegmentDonePayload): void;
  onFollowSegment(shotId: string): void;
  onNotice(level: 'info' | 'warning' | 'error', node: ReactNode): void;
}

export interface StartRunArgs {
  projectId: string;
  selectedIds: string[];
  episode?: string;
  /** 提交前把导演台容器落盘（MCP 执行时读磁盘，不读网页内存） */
  beforeSubmit?: () => Promise<void>;
}

export interface DirectorRunState {
  phase: DirectorRunPhase;
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
  preview: { image: string; step: number | null; totalSteps: number | null; segmentIndex: number | null } | null;
  livePreviewSupported: boolean;
  startedAt: number;
}

const INITIAL_STATE: DirectorRunState = {
  phase: 'idle',
  taskId: null,
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
  livePreviewSupported: true,
  startedAt: 0,
};

export interface UseDirectorTaskArgs {
  projectId: string | null | undefined;
  callbacks: DirectorRunCallbacks;
}

const PHASE_BY_STATE: Record<BrokerTask['state'], DirectorRunPhase> = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  failed: 'error',
  canceled: 'canceled',
};

export function useDirectorTask(args: UseDirectorTaskArgs): DirectorRunState & {
  startRun: (runArgs: StartRunArgs) => Promise<boolean>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<DirectorRunState>(INITIAL_STATE);
  const cbRef = useRef(args.callbacks);
  cbRef.current = args.callbacks;
  const taskRef = useRef<BrokerTask | null>(null);
  /** 已处理过的段状态（shotId → state），用于把任务快照 diff 成宿主回调 */
  const segmentStateRef = useRef<Map<string, string>>(new Map());
  const previewKeyRef = useRef<string | null>(null);
  /** reset 后不再回灌这条任务（否则订阅立刻把它捡回来） */
  const dismissedRef = useRef<Set<string>>(new Set());

  const applyTask = useCallback((task: BrokerTask) => {
    if (dismissedRef.current.has(task.taskId)) return;
    taskRef.current = task;
    const prev = segmentStateRef.current;
    const next = new Map<string, string>();
    let follow: string | null = null;

    const finishSegment = (shotId: string, seg: BrokerSegment): void => {
      const output = seg.output;
      if (!output) return;
      const version = output.version
        ? ({
          ...output.version,
          guide: output.version.guide ?? output.guide ?? null,
        } as WorkbenchShotVersion)
        : undefined;
      const base = {
        videoStorageKey: output.storageKey,
        firstFrameKey: output.previewKey ?? output.firstFrameKey,
        ...(output.guide ? { guide: output.guide } : {}),
        ...(version ? { version } : {}),
      };
      if (!output.previewKey) {
        cbRef.current.onSegmentDone(shotId, base);
        return;
      }
      // 缩略图用 objectURL（与旧链路一致）；解析失败也要把缓存版本交给宿主
      void resolveMediaUrl(output.previewKey)
        .then((url) => cbRef.current.onSegmentDone(shotId, { ...base, firstFrameUrl: url || undefined }))
        .catch(() => cbRef.current.onSegmentDone(shotId, base));
    };

    for (const seg of task.segments) {
      if (!seg.shotId) continue;
      next.set(seg.shotId, seg.state);
      const before = prev.get(seg.shotId);
      if (seg.state === 'success') {
        if (before !== 'success') {
          finishSegment(seg.shotId, seg);
          follow = seg.shotId;
        }
      } else if (seg.state === 'running') {
        if (before !== 'running') cbRef.current.onSegmentState(seg.shotId, 'generating');
      } else if (seg.state === 'failed') {
        if (before !== 'failed') cbRef.current.onSegmentState(seg.shotId, 'failed');
      } else if (seg.state === 'canceled') {
        if (before !== 'canceled') cbRef.current.onSegmentState(seg.shotId, 'cancelled');
      }
    }
    segmentStateRef.current = next;
    if (follow) cbRef.current.onFollowSegment(follow);

    // 最后一帧预览：任务里持久化的 previewKey（刷新/换浏览器后仍能显示）
    if (task.previewKey && task.previewKey !== previewKeyRef.current) {
      previewKeyRef.current = task.previewKey;
      const segmentIndex = task.previewSegment ?? task.currentSegment ?? null;
      const current = task.segments.find((s) => s.index === task.currentSegment);
      void resolveMediaUrl(task.previewKey).then((image) => {
        if (!image || previewKeyRef.current !== task.previewKey) return;
        setState((s) => ({
          ...s,
          preview: {
            image,
            step: current?.progress?.step ?? null,
            totalSteps: current?.progress?.totalSteps ?? null,
            segmentIndex,
          },
        }));
      }).catch(() => undefined);
    }

    const phase = PHASE_BY_STATE[task.state] ?? 'queued';
    setState((s) => ({
      ...s,
      phase,
      taskId: task.taskId,
      jobId: null,
      queueNumber: null,
      currentSegment: task.currentSegment,
      doneCount: task.doneCount,
      totalCount: task.totalCount,
      error: task.state === 'failed' ? (task.error ?? '任务失败') : null,
      canceledKept: task.state === 'canceled' ? task.doneCount : null,
      segmentShotIds: task.segments.map((x) => x.shotId).filter((id): id is string => Boolean(id)),
      startedAt: Date.parse(task.createdAt) || Date.now(),
      livePreviewSupported: true,
    }));
    if (task.state === 'failed' && task.error) {
      cbRef.current.onNotice('error', `生成失败：${task.error}`);
    }
  }, []);

  // 订阅当前项目的导演台任务：刷新/多开都会自动恢复进度与预览
  useEffect(() => {
    const projectId = args.projectId ?? null;
    if (!projectId) {
      setState(INITIAL_STATE);
      return;
    }
    const unsubscribe = subscribeBrokerTasks(projectId, (tasks) => {
      const mine = tasks.filter((t) => t.kind === 'director_run');
      if (mine.length === 0) return;
      const current = taskRef.current
        ? mine.find((t) => t.taskId === taskRef.current?.taskId)
        : undefined;
      const active = mine.find((t) => t.state === 'running' || t.state === 'queued');
      const target = current ?? active ?? mine[0];
      if (!target) return;
      applyTask(target);
    });
    return unsubscribe;
  }, [args.projectId, applyTask]);

  const startRun = useCallback(async (runArgs: StartRunArgs): Promise<boolean> => {
    if (runArgs.selectedIds.length === 0) {
      cbRef.current.onNotice('warning', '请先勾选要运行的片段');
      return false;
    }
    segmentStateRef.current = new Map();
    previewKeyRef.current = null;
    setState({
      ...INITIAL_STATE,
      phase: 'submitting',
      taskId: null,
      totalCount: runArgs.selectedIds.length,
      segmentShotIds: runArgs.selectedIds,
      startedAt: Date.now(),
    });
    try {
      await runArgs.beforeSubmit?.();
      const task = await submitBrokerTask({
        kind: 'director_run',
        projectId: runArgs.projectId,
        request: {
          kind: 'director_run',
          selectedIds: runArgs.selectedIds,
          ...(runArgs.episode ? { episode: runArgs.episode } : {}),
        },
      });
      applyTask(task);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, phase: 'error', error: message }));
      cbRef.current.onNotice('error', `提交任务失败：${message}`);
      return false;
    }
  }, [applyTask]);

  const cancel = useCallback(async (): Promise<void> => {
    const task = taskRef.current;
    if (!task) return;
    try {
      const next = await cancelBrokerTask(task.taskId);
      if (next) applyTask(next);
    } catch (err) {
      cbRef.current.onNotice('warning', `取消请求失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [applyTask]);

  const reset = useCallback((): void => {
    const task = taskRef.current;
    if (task) dismissedRef.current.add(task.taskId);
    taskRef.current = null;
    segmentStateRef.current = new Map();
    previewKeyRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  return { ...state, startRun, cancel, reset };
}
