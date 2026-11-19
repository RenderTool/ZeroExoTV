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
  /** 事实源：broker=MCP 旧任务；plugin=ComfyUI 插件持久任务；local=仅前端任务 */
  source?: 'local' | 'broker' | 'plugin';
  /** broker 任务可取消（排队/运行中） */
  cancelable?: boolean;
  /** 最后一帧预览（broker 落盘的图片 storageKey） */
  previewKey?: string;
  projectId?: string;
}

interface TaskQueueState {
  tasks: QueuedTask[];
  collapsed: boolean;
  /** 用户已「清空已完成」的任务 id：插件历史再次同步时不再冒出来 */
  dismissed: Set<string>;
  /** 开始/续跑一个本地任务（同 id 幂等：已存在则更新为 running） */
  start: (task: { id: string; kind: TaskKind; title: string; phase?: string }) => void;
  update: (id: string, patch: Partial<Pick<QueuedTask, 'title' | 'phase' | 'progress'>>) => void;
  finish: (id: string, status: Exclude<TaskStatus, 'queued' | 'running'>, error?: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** 用 broker 全量列表替换展示列表（本地上传任务保留） */
  applyBrokerTasks: (tasks: QueuedTask[]) => void;
  /** 用插件持久任务列表替换展示列表（本地上传任务保留） */
  applyPluginTasks: (tasks: QueuedTask[]) => void;
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

const DISMISS_KEY = 'zeroexo.taskQueue.dismissed';
function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set<string>(raw ? JSON.parse(raw) as string[] : []);
  } catch {
    return new Set();
  }
}
function writeDismissed(ids: Set<string>): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids].slice(-200)));
  } catch { /* ignore */ }
}

/**
 * 任务队列历史持久化（2026-11-17 用户要求）：
 * 队列是「历史」不是「本次会话状态」——刷新后必须还在，只有用户点「清空已完成」才消失。
 * 刷新时仍在 running/queued 的条目（本地登记，插件/broker 侧可能没有）标为已中断，避免永远转圈。
 */
const TASKS_KEY = 'zeroexo.taskQueue.tasks';
function readPersistedTasks(): QueuedTask[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? JSON.parse(raw) as QueuedTask[] : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string')
      .map((t) => (t.status === 'running' || t.status === 'queued'
        ? { ...t, status: 'cancelled' as TaskStatus, phase: t.phase ?? '已中断' }
        : t))
      .slice(0, MAX_TASKS);
  } catch {
    return [];
  }
}
function writePersistedTasks(tasks: QueuedTask[], dismissed: Set<string>): void {
  try {
    const visible = tasks.filter((t) => !dismissed.has(t.id)).slice(0, MAX_TASKS);
    localStorage.setItem(TASKS_KEY, JSON.stringify(visible));
  } catch { /* ignore */ }
}

export const useTaskQueueStore = create<TaskQueueState>((set) => ({
  tasks: readPersistedTasks(),
  collapsed: false,
  dismissed: readDismissed(),

  start: (task) => set((s) => {
    const existing = s.tasks.find((t) => t.id === task.id);
    if (existing) {
      return {
        tasks: s.tasks.map((t) => (t.id === task.id
          ? { ...t, status: 'running', title: task.title || t.title, phase: task.phase ?? t.phase, progress: undefined, error: undefined, finishedAt: undefined }
          : t)),
      };
    }
    // 用户已「清空已完成」的任务（如刷新后从插件任务表恢复的旧任务）不再冒出来（2026-11-16 用户反馈）
    if (s.dismissed.has(task.id)) return {};
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

  clearFinished: () => set((s) => {
    const terminal = s.tasks.filter((t) => t.status !== 'queued' && t.status !== 'running');
    const dismissed = new Set(s.dismissed);
    for (const t of terminal) dismissed.add(t.id);
    writeDismissed(dismissed);
    return {
      tasks: s.tasks.filter((t) => t.status === 'queued' || t.status === 'running'),
      dismissed,
    };
  }),

  setCollapsed: (collapsed) => set({ collapsed }),

  applyBrokerTasks: (tasks) => set((s) => {
    // 已清空的终态任务不再随 broker 全量同步回来（与 applyPluginTasks 同口径）
    // 2026-11-17 用户实测：画布发起生成后队列里没有任务 —— 本地登记（source='local'）此前被同步整批丢掉，
    // 这里保留所有本地任务（上传与画布生成），只按 dismissed 过滤。
    const locals = s.tasks.filter((t) => t.source === 'local' && !s.dismissed.has(t.id));
    const visible = tasks.filter((t) => !s.dismissed.has(t.id));
    const merged = [...visible, ...locals].sort((a, b) => b.startedAt - a.startedAt);
    return { tasks: merged.slice(0, MAX_TASKS) };
  }),

  applyPluginTasks: (tasks) => set((s) => {
    // 插件是生成任务事实源；保留本地任务（上传 + 画布发起且插件里没有记录的生成），已清空的终态不再回来
    const locals = s.tasks.filter((t) => t.source === 'local' && !s.dismissed.has(t.id));
    const visible = tasks.filter((t) => !s.dismissed.has(t.id));
    const merged = [...visible, ...locals].sort((a, b) => b.startedAt - a.startedAt);
    return { tasks: merged.slice(0, MAX_TASKS) };
  }),
}));

// 任何变更都落盘（历史跨刷新保留，只有「清空已完成」才会移除）
useTaskQueueStore.subscribe((s, prev) => {
  if (s.tasks === prev.tasks && s.dismissed === prev.dismissed) return;
  writePersistedTasks(s.tasks, s.dismissed);
});

/** 未完成（排队/进行中）任务数 */
export function countActiveTasks(tasks: QueuedTask[]): number {
  return tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;
}
