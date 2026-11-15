/**
 * task-queue-store — 任务队列展示层（2026-11-10 用户要求）
 *
 * 2026-11-15：生成任务的**事实源在 MCP**（持久化任务表）。这里只做展示：
 * - broker 任务由 useTaskBrokerSync 同步进来（source='broker'），刷新/换浏览器后列表照旧；
 * - 上传等纯前端任务仍走本地 start/update/finish（source='local'）。
 */
import { create } from 'zustand';
import type { BrokerTask } from './task-broker-client.js';

export type TaskKind = 'image' | 'video' | 'audio' | 'text' | 'upload' | 'director';

export type TaskStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface QueuedTask {
  id: string;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  /** 采样进度（有就显示步数/进度条） */
  progress?: { step: number; totalSteps: number };
  /** 阶段文案（导演台「第 2/5 段 · 采样中」之类） */
  phase?: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** 事实源：broker=MCP 持久化任务；local=仅前端任务（上传） */
  source?: 'local' | 'broker';
  /** broker 任务可取消（排队/运行中） */
  cancelable?: boolean;
  /** 最后一帧预览（broker 落盘的图片 storageKey） */
  previewKey?: string;
  projectId?: string;
}

interface TaskQueueState {
  tasks: QueuedTask[];
  collapsed: boolean;
  /** 开始/续跑一个本地任务（同 id 幂等：已存在则更新为 running） */
  start: (task: { id: string; kind: TaskKind; title: string; phase?: string }) => void;
  update: (id: string, patch: Partial<Pick<QueuedTask, 'title' | 'phase' | 'progress'>>) => void;
  finish: (id: string, status: Exclude<TaskStatus, 'queued' | 'running'>, error?: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** 用 broker 全量列表替换展示列表（本地上传任务保留） */
  applyBrokerTasks: (tasks: QueuedTask[]) => void;
}

/** 最多保留的条目数（连跑几十个作业时只留最近的，防止面板无限长） */
const MAX_TASKS = 50;

const STATUS_BY_STATE: Record<BrokerTask['state'], TaskStatus> = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  failed: 'error',
  canceled: 'cancelled',
};

/** broker 任务 → 展示条目（唯一映射处） */
export function toQueuedTask(task: BrokerTask): QueuedTask {
  const current = task.segments.find((s) => s.index === task.currentSegment);
  const terminal = task.state === 'success' || task.state === 'failed' || task.state === 'canceled';
  const isDirector = task.kind === 'director_run';
  const phase = isDirector
    ? (task.currentSegment ? `第 ${task.currentSegment}/${task.totalCount} 段` : (terminal ? '已结束' : '排队中'))
    : task.totalCount > 1 ? `${task.doneCount}/${task.totalCount} 张` : undefined;
  return {
    id: task.taskId,
    kind: isDirector ? 'director' : 'image',
    title: task.title,
    status: STATUS_BY_STATE[task.state] ?? 'queued',
    progress: current?.progress
      ?? (isDirector && task.state === 'running' && task.totalCount > 1
        ? { step: task.doneCount, totalSteps: task.totalCount }
        : undefined),
    phase,
    startedAt: Date.parse(task.createdAt) || Date.now(),
    ...(terminal ? { finishedAt: Date.parse(task.updatedAt) || Date.now() } : {}),
    ...(task.error ? { error: task.error } : {}),
    source: 'broker',
    cancelable: task.state === 'queued' || task.state === 'running',
    ...(task.previewKey ? { previewKey: task.previewKey } : {}),
    projectId: task.projectId,
  };
}

export const useTaskQueueStore = create<TaskQueueState>((set) => ({
  tasks: [],
  collapsed: false,

  start: (task) => set((s) => {
    const existing = s.tasks.find((t) => t.id === task.id);
    if (existing) {
      return {
        tasks: s.tasks.map((t) => (t.id === task.id
          ? { ...t, status: 'running', title: task.title || t.title, phase: task.phase ?? t.phase, progress: undefined, error: undefined, finishedAt: undefined }
          : t)),
      };
    }
    const next: QueuedTask = {
      id: task.id,
      kind: task.kind,
      title: task.title,
      status: 'running',
      phase: task.phase,
      startedAt: Date.now(),
      source: 'local',
    };
    return { tasks: [next, ...s.tasks].slice(0, MAX_TASKS) };
  }),

  update: (id, patch) => set((s) => ({
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  })),

  finish: (id, status, error) => set((s) => ({
    tasks: s.tasks.map((t) => (t.id === id
      ? { ...t, status, error, finishedAt: Date.now() }
      : t)),
  })),

  remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  clearFinished: () => set((s) => ({
    tasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running'),
  })),

  setCollapsed: (collapsed) => set({ collapsed }),

  applyBrokerTasks: (tasks) => set((s) => {
    const locals = s.tasks.filter((t) => t.source !== 'broker');
    const merged = [...tasks, ...locals].sort((a, b) => b.startedAt - a.startedAt);
    return { tasks: merged.slice(0, MAX_TASKS) };
  }),
}));

/** 未完成（排队/进行中）任务数 */
export function countActiveTasks(tasks: QueuedTask[]): number {
  return tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
}
