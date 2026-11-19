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
  const url = `${base.replace(/\/+$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new McpError(
      "IO_ERROR",
      `无法连接 ComfyUI 插件：${base.replace(/\/+$/, "")}（${reason}）。请确认 ComfyUI 已启动、插件已加载。`,
    );
  }
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

/** 单图作业（qwen_image_edit / krea2_t2i / moss_image_t2i）：MCP 只代理提交，生成在插件端 */
export interface PluginImageJobStatus {
  ok: boolean;
  jobId: string;
  state: PluginTaskState;
  outputs?: Array<{ kind?: string; path?: string }>;
  error?: string | null;
  progress?: { step?: number; totalSteps?: number } | null;
}

export async function submitImageJob(
  payload: Record<string, unknown>,
  base?: string,
): Promise<{ jobId: string; state: PluginTaskState; error?: string | null }> {
  const b = base ?? (await resolveComfyBase());
  const created = await request<{ jobId: string; state?: PluginTaskState; error?: string | null }>(
    b,
    "/zeroexo/v1/jobs",
    { method: "POST", body: JSON.stringify(payload) },
  );
  if (!created?.jobId) throw new McpError("IO_ERROR", "插件未返回 jobId");
  return { jobId: created.jobId, state: created.state ?? "queued", error: created.error ?? null };
}

export async function getImageJob(jobId: string, base?: string): Promise<PluginImageJobStatus | null> {
  const b = base ?? (await resolveComfyBase());
  try {
    const res = await request<PluginImageJobStatus>(b, `/zeroexo/v1/jobs/${encodeURIComponent(jobId)}`);
    return res;
  } catch (err) {
    if (err instanceof McpError && /404|not found|不存在/i.test(err.message)) return null;
    throw err;
  }
}

export async function cancelImageJob(jobId: string, base?: string): Promise<void> {
  const b = base ?? (await resolveComfyBase());
  await request<{ ok?: boolean }>(b, `/zeroexo/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    body: "{}",
  }).catch(() => undefined);
}

