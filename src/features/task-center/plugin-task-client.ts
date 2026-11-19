/**
 * ComfyUI 插件任务客户端（网页直连插件，不经过 MCP）。
 *
 * 插件是任务事实源：提交后即使关网页/关 MCP，插件仍继续执行；
 * 网页重开按 projectId 拉任务列表，把已完成段补落库。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import type { PluginBatchPayload } from '@/features/canvas-tabs/director-plugin-payload.js';
import { readCachedGuideBlob } from '@/entities/guide-store.js';

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

/**
 * 双重兜底（2026-11-19 用户拍板）：云端输出是账户制存储，机器换了只要没删引导就还在。
 * 提交前先查 ComfyUI 自己的 output/zeroexo/guides/<id>.safetensors；
 * 缺了再把本地 media/guides 缓存的同一份推上去；两边都没有才报错，不静默降级。
 */
async function ensureGuidesOnComfy(base: string, payload: PluginBatchPayload): Promise<void> {
  const ids = [
    ...new Set(
      (payload.segments ?? [])
        .filter((s) => s.guide?.mode === 'initial' && s.guide?.id)
        .map((s) => s.guide!.id as string),
    ),
  ];
  for (const id of ids) {
    try {
      const head = await fetch(`${base}/zeroexo/v1/guides/${encodeURIComponent(id)}`, { method: 'GET' });
      if (head.ok) continue;
    } catch { /* 探活失败按缺失处理，走本地补传 */ }
    const blob = await readCachedGuideBlob({ id }).catch(() => null);
    if (!blob || !blob.size) {
      throw new Error(`起始引导 ${id} 在 ComfyUI 输出缓存与本地 media/guides 里都不存在，无法续接`);
    }
    const form = new FormData();
    form.append('file', blob, `${id}.safetensors`);
    const res = await fetch(`${base}/zeroexo/v1/guides/${encodeURIComponent(id)}`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`引导 ${id} 上传失败：HTTP ${res.status}`);
  }
}

export async function submitPluginTask(payload: PluginBatchPayload): Promise<PluginTask> {
  const base = pluginTaskBase();
  if (!base) throw new Error('未配置 ComfyUI 地址');
  await ensureGuidesOnComfy(base, payload);
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

/** 真删插件任务事实源（清空已完成用）：只删展示层刷新必复活，必须连插件侧 JSON 一起删 */
export async function deletePluginTask(taskId: string): Promise<void> {
  await request<{ deleted: boolean }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}
