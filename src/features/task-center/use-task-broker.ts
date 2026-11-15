/**
 * useTaskBrokerSync — 把 MCP 持久化任务同步到右下角任务队列（展示用）。
 *
 * 刷新/关闭/换浏览器/多开：任务列表来自 MCP 任务表，不依赖本页内存或 sessionStorage。
 */
import { useEffect } from 'react';
import { subscribeBrokerTasks } from './task-broker-client.js';
import { toQueuedTask, useTaskQueueStore } from './task-queue-store.js';

export function useTaskBrokerSync(projectId: string | null | undefined): void {
  const applyBrokerTasks = useTaskQueueStore((s) => s.applyBrokerTasks);

  useEffect(() => {
    if (!projectId) {
      applyBrokerTasks([]);
      return;
    }
    const unsubscribe = subscribeBrokerTasks(projectId, (tasks) => {
      applyBrokerTasks(tasks.map(toQueuedTask));
    });
    return unsubscribe;
  }, [projectId, applyBrokerTasks]);
}
