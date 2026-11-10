/**
 * task-queue-store — 任务队列（2026-11-10 用户要求）
 *
 * 画布 / 导演台 / 图片编辑器发起的生成与上传任务，统一登记到这里；
 * 右下角 TaskQueueDock 负责展示排队情况（可收起）。只存轻量状态，不落盘、不进撤销栈。
 */
import { create } from 'zustand';

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
}

interface TaskQueueState {
  tasks: QueuedTask[];
  collapsed: boolean;
  /** 开始/续跑一个任务（同 id 幂等：已存在则更新为 running） */
  start: (task: { id: string; kind: TaskKind; title: string; phase?: string }) => void;
  update: (id: string, patch: Partial<Pick<QueuedTask, 'title' | 'phase' | 'progress'>>) => void;
  finish: (id: string, status: Exclude<TaskStatus, 'queued' | 'running'>, error?: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

/** 最多保留的条目数（连跑几十个作业时只留最近的，防止面板无限长） */
const MAX_TASKS = 50;

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

  clearFinished: () => set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running') })),

  setCollapsed: (collapsed) => set({ collapsed }),
}));

/** 未完成（排队/进行中）任务数 */
export function countActiveTasks(tasks: QueuedTask[]): number {
  return tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
}
