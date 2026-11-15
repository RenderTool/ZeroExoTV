/**
 * ComfyUI 插件任务接口（MCP 只做代理/控制，不执行生成）。
 */
import { McpError } from "../errors.js";
import { resolveComfyBase } from "./comfy.js";

export type PluginTaskState = "queued" | "running" | "success" | "error" | "cancelled" | "interrupted";

export interface PluginTaskSegment {
  index: number;
  shotId?: string;
  state: PluginTaskState;
  prompt?: string;
  guide?: { mode: "initial" | "chain" | "none"; id?: string; path?: string; frames?: number };
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
  segments: PluginTaskSegment[];
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || body?.ok === false) {
    throw new McpError("IO_ERROR", body?.error || `插件任务接口失败 HTTP ${res.status}`);
  }
  return body as T;
}

export async function listPluginTasks(projectId?: string, base?: string): Promise<PluginTask[]> {
  const b = base ?? (await resolveComfyBase());
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await request<{ tasks: PluginTask[] }>(b, `/zeroexo/v1/tasks${qs}`);
  return Array.isArray(res.tasks) ? res.tasks : [];
}

export async function getPluginTask(taskId: string, base?: string): Promise<PluginTask | null> {
  const b = base ?? (await resolveComfyBase());
  try {
    const res = await request<{ task: PluginTask }>(b, `/zeroexo/v1/tasks/${encodeURIComponent(taskId)}`);
    return res.task ?? null;
  } catch (err) {
    if (err instanceof McpError && /404|not found|不存在/i.test(err.message)) return null;
    throw err;
  }
}

export async function cancelPluginTask(taskId: string, base?: string): Promise<PluginTask> {
  const b = base ?? (await resolveComfyBase());
  const res = await request<{ task: PluginTask }>(
    b,
    `/zeroexo/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return res.task;
}

export async function submitPluginTask(
  payload: Record<string, unknown>,
  base?: string,
): Promise<PluginTask> {
  const b = base ?? (await resolveComfyBase());
  const created = await request<{ jobId: string }>(b, "/zeroexo/v1/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const task = await getPluginTask(created.jobId, b);
  if (!task) throw new McpError("IO_ERROR", `插件任务创建后读取失败: ${created.jobId}`);
  return task;
}
