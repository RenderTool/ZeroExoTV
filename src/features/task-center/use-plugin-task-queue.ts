/**
 * 任务队列同步：ComfyUI 插件是生成任务事实源。
 * 网页只拉插件 /zeroexo/v1/tasks（图片 + 导演台批次），刷新/重开后历史任务仍在。
 */
import { useEffect } from 'react';
import { listPluginTasks, type PluginTask, type PluginTaskState } from './plugin-task-client.js';
import { useTaskQueueStore, type QueuedTask, type TaskKind, type TaskStatus } from './task-queue-store.js';

const STATUS: Record<PluginTaskState, TaskStatus> = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  interrupted: 'error',
};

function kindOf(task: PluginTask): TaskKind {
  const k = task.kind ?? '';
  if (k.includes('batch') || k.includes('director')) return 'director';
  if (k.includes('image') || k.includes('qwen') || k.includes('krea') || k.includes('moss')) return 'image';
  return 'video';
}

export function toPluginQueuedTask(task: PluginTask): QueuedTask {
  const kind = kindOf(task);
  const seg = task.currentSegment
    ? (task.segments ?? []).find((s) => s.index === task.currentSegment)
    : undefined;
  const done = task.doneCount ?? (task.segments ?? []).filter((s) => s.state === 'success').length;
  const total = task.totalCount ?? (task.segments?.length || 1);
  const terminal = ['success', 'error', 'cancelled', 'interrupted'].includes(task.state);
  return {
    id: task.taskId,
    kind,
    title: task.title || (kind === 'director' ? '导演台出片' : '图片生成'),
    status: STATUS[task.state] ?? 'queued',
    phase: kind === 'director'
      ? (task.currentSegment ? `第 ${task.currentSegment}/${total} 段` : terminal ? '已结束' : '排队中')
      : (total > 1 ? `${done}/${total}` : undefined),
    ...(seg?.progress ? { progress: seg.progress } : {}),
    startedAt: Date.parse(task.createdAt ?? '') || Date.now(),
    ...(terminal ? { finishedAt: Date.parse(task.updatedAt ?? '') || Date.now() } : {}),
    ...(task.error ? { error: task.error } : {}),
    source: 'plugin',
    cancelable: task.state === 'queued' || task.state === 'running',
    projectId: task.projectId,
  };
}

export function usePluginTaskQueue(projectId: string | null | undefined): void {
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const tasks = await listPluginTasks(projectId);
        if (!cancelled) useTaskQueueStore.getState().applyPluginTasks(tasks.map(toPluginQueuedTask));
      } catch {
        // 插件未启动时保持现有列表
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId]);
}
