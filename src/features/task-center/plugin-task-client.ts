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
 * 提交前先查 ComfyUI 自己的 output/zeroexo/guides/<id>.safetensors；确证缺失才补传。
 *
 * 2026-11-20 修正（云端实测）：waas 上插件常常只有读、没有写（POST 405），
 * 且云端 output 里的文件是用户手动上传的，接口探不到不代表文件不存在。
 * 因此探不到一律按「云端可能已有」放行，绝不因探针失败卡住整批提交；
 * 只有「接口明确回 exists:false 且补传失败」才提示用户手动放置。
 */
export interface PluginSubmitResult {
  task: PluginTask;
  /** 需要用户知道的引导问题（明确缺失且没能补传时才产生） */
  warnings: string[];
}

const GUIDE_ROUTE_MISSING = new Set([404, 405, 501]);

function withTimeout(ms: number): AbortSignal {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(ms)
    : new AbortController().signal;
}

async function ensureGuideOnComfy(base: string, id: string): Promise<string | null> {
  const url = `${base}/zeroexo/v1/guides/${encodeURIComponent(id)}`;
  let needUpload = false;
  try {
    const head = await fetch(url, { method: 'GET', signal: withTimeout(8_000) });
    if (head.ok) {
      const body = await head.json().catch(() => null) as { exists?: boolean } | null;
      if (body?.exists !== false) return null; // 云端已有 → 直接用
      needUpload = true;
    } else if (head.status === 404) {
      const body = await head.json().catch(() => null) as { ok?: boolean; exists?: boolean } | null;
      // 只有 0.1.1 的 {ok:true, exists:false} 才算「确证缺失」；其它 404 视为探针不可用 → 放行
      if (body?.ok === true && body?.exists === false) needUpload = true;
      else return null;
    } else {
      return null; // 探针异常（代理/旧插件/500）→ 交给插件运行时自己判断
    }
  } catch {
    return null; // 超时/网络问题不阻塞生成
  }
  if (!needUpload) return null;

  const blob = await readCachedGuideBlob({ id }).catch(() => null);
  if (!blob || !blob.size) return 'local-missing';
  try {
    const form = new FormData();
    form.append('file', blob, `${id}.safetensors`);
    const res = await fetch(url, { method: 'POST', body: form, signal: withTimeout(90_000) });
    if (res.ok) return null;
    if (GUIDE_ROUTE_MISSING.has(res.status)) return `route:${res.status}`;
    if (res.status === 413) return `large:${Math.round(blob.size / 1024 / 1024)}`;
    return `http:${res.status}`;
  } catch {
    return 'unreachable';
  }
}

function guideWarning(id: string, reason: string): string {
  const manual = `本地 <数据根>/media/guides/${id}.safetensors 需放到云端 ComfyUI/output/zeroexo/guides`;
  if (reason.startsWith('route:')) {
    return `云端插件没有引导写入接口（HTTP ${reason.slice(6)}），且查询确认云端没有 ${id}；${manual}（或升级 ComfyUI_ZeroExoNodes 0.1.1）`;
  }
  if (reason.startsWith('large:')) {
    return `网关拒收引导体积 ${reason.slice(6)}MB，且云端没有 ${id}；${manual}`;
  }
  if (reason === 'local-missing') {
    return `云端与本地都没有引导 ${id}；先在项目侧重新生成该引导，或把该段改成无引导`;
  }
  if (reason === 'unreachable') {
    return `引导 ${id} 补传时 ComfyUI 无响应；${manual}`;
  }
  return `引导 ${id} 补传失败（${reason}）；${manual}`;
}

async function ensureGuidesOnComfy(base: string, payload: PluginBatchPayload): Promise<string[]> {
  const ids = [
    ...new Set(
      (payload.segments ?? [])
        .filter((s) => s.guide?.mode === 'initial' && s.guide?.id)
        .map((s) => s.guide!.id as string),
    ),
  ];
  if (ids.length === 0) return [];
  const results = await Promise.all(ids.map(async (id) => ({ id, reason: await ensureGuideOnComfy(base, id) })));
  const warnings: string[] = [];
  for (const { id, reason } of results) {
    if (reason) warnings.push(guideWarning(id, reason));
  }
  return warnings;
}

export async function submitPluginTask(payload: PluginBatchPayload): Promise<PluginSubmitResult> {
  const base = pluginTaskBase();
  if (!base) throw new Error('未配置 ComfyUI 地址');
  const warnings = await ensureGuidesOnComfy(base, payload);
  const created = await request<{ jobId: string }>('/zeroexo/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { task: await getPluginTask(created.jobId), warnings };
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
