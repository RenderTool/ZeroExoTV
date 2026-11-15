/**
 * ComfyUI 插件任务客户端（网页直连插件，不经过 MCP）。
 *
 * 插件是任务事实源：提交后即使关网页/关 MCP，插件仍继续执行；
 * 网页重开按 projectId 拉任务列表，把已完成段补落库。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import type { PluginBatchPayload } from '@/features/canvas-tabs/director-plugin-payload.js';

export type PluginTaskState = 'queued' | 'running' | 'success' | 'error' | 'cancelled' | 'interrupted';

export interface PluginTaskSegment {
  index: number;
  shotId?: string;
  state: PluginTaskState;
  prompt?: string;
  params?: Record<string, unknown>;
  guide?: { mode: 'initial' | 'chain' | 'none'; id?: string; path?: string; frames?: number };
  progress?: { step: number; totalSteps: number };
  previewPath?: string;
  outputs?: Array<{ kind?: string; path?: string }>;
  error?: string | null;
}

export interface PluginTask {
  taskId: string;
  jobId?: string;
  projectId?: string;
  kind?: string;
  state: PluginTaskState;
  title?: string;
  currentSegment?: number | null;
  doneCount?: number;
  totalCount?: number;
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
  /** 插件子任务的 /ws clientId（重开网页时重连预览用） */
  clientId?: string;
  segments: PluginTaskSegment[];
}

export function pluginTaskBase(): string | null {
  const address = useComfyuiEndpointStore.getState().address;
  if (!address) return null;
  return address.replace(/\/+$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = pluginTaskBase();
  if (!base) throw new Error('未配置 ComfyUI 地址');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as T & { ok?: boolean; error?: string };
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

export async function submitPluginTask(payload: PluginBatchPayload): Promise<PluginTask> {
  const created = await request<{ jobId: string }>('/zeroexo/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return getPluginTask(created.jobId);
}

export async function getPluginTask(taskId: string): Promise<PluginTask> {
  const res = await request<{ task: PluginTask }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}`);
  return res.task;
}

export async function listPluginTasks(projectId: string): Promise<PluginTask[]> {
  const res = await request<{ tasks: PluginTask[] }>(`/zeroexo/v1/tasks?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(res.tasks) ? res.tasks : [];
}

export async function cancelPluginTask(taskId: string): Promise<PluginTask> {
  const res = await request<{ task: PluginTask }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
  return res.task;
}
