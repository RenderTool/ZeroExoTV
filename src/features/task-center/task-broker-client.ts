/**
 * MCP Task Broker 客户端（2026-11-15）。
 *
 * 任务由 MCP 持久化并执行，网页只是客户端：提交 → 订阅 → 渲染。
 * 传输复用本地数据服务端口（http-fs，默认 127.0.0.1:8790）：
 * - HTTP：提交 / 查列表 / 查单个 / 取消
 * - SSE：/tasks/events，断线自动回退轮询（多开时每个页面各自订阅）
 */

import { MCP_HTTP_URL } from '@/features/mcp-settings/mcp-client.js';

export type BrokerTaskState = 'queued' | 'running' | 'success' | 'failed' | 'canceled';
export type BrokerSegmentState = 'queued' | 'running' | 'success' | 'failed' | 'canceled';
export type BrokerTaskKind = 'director_run' | 'canvas_image';

export interface BrokerGuide {
  id: string;
  frames?: number;
  sha256?: string;
  localKey?: string;
  /** cache = 时间线上游片段当前缓存；slot = 本段显式引导槽；chain = 批内上一段产出；none = 无引导输入 */
  source: 'cache' | 'slot' | 'chain' | 'none';
  sourceShotId?: string;
}

export interface BrokerGuideFile {
  id: string;
  path?: string;
  frames?: number;
  sha256?: string;
  localKey?: string;
}

export interface BrokerShotVersion {
  id: string;
  storageKey: string;
  previewKey?: string;
  /** 本版本产物自带的引导（下一段可以用它） */
  guide?: BrokerGuideFile | null;
  prompt?: string;
  createdAt: string;
}

export interface BrokerOutput {
  storageKey: string;
  mime: string;
  width?: number;
  height?: number;
  previewKey?: string;
  nodeId?: string;
  firstFrameKey?: string;
  guide?: BrokerGuideFile | null;
  version?: BrokerShotVersion;
}

export interface BrokerSegment {
  index: number;
  shotId: string | null;
  state: BrokerSegmentState;
  prompt: string | null;
  guide: BrokerGuide | null;
  progress: { step: number; totalSteps: number } | null;
  previewKey: string | null;
  output: BrokerOutput | null;
  error: string | null;
}

export interface BrokerImageRequest {
  prompt: string;
  model?: 'moss' | 'krea2' | 'qwen';
  title?: string;
  aspect?: string;
  megapixels?: number;
  steps?: number;
  seed?: number;
  width?: number;
  height?: number;
  negative_prompt?: string;
  sourceStorageKey?: string;
  sourceNodeId?: string;
  maskStorageKey?: string;
  nodeId?: string;
}

export type BrokerRequest =
  | { kind: 'director_run'; selectedIds: string[]; episode?: string; baseUrl?: string }
  | { kind: 'canvas_image'; requests: BrokerImageRequest[] };

export interface BrokerTask {
  taskId: string;
  projectId: string;
  kind: BrokerTaskKind;
  state: BrokerTaskState;
  title: string;
  createdAt: string;
  updatedAt: string;
  totalCount: number;
  doneCount: number;
  currentSegment: number | null;
  previewKey: string | null;
  previewSegment: number | null;
  error: string | null;
  cancelRequested: boolean;
  request?: BrokerRequest;
  segments: BrokerSegment[];
  outputs: BrokerOutput[];
}

/**
 * 任务接口挂在 MCP 自己的端口上（与 /mcp 同一地址，去掉末尾 /mcp）。
 * 2026-11-22：不再复用 8790 那个"文件服务"端口——网页文件读写归浏览器授权，
 * 任务心跳跟 MCP 走：MCP 开着就能查/订阅，没开就是没连上。
 */
function brokerBase(): string | null {
  const base = MCP_HTTP_URL.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
  return base || null;
}

export function brokerOnline(): boolean {
  return brokerBase() !== null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = brokerBase();
  if (!base) throw new Error('本地任务服务未连接（MCP / fs-server 不在线）');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) throw new Error(body?.message ?? `任务服务返回 HTTP ${res.status}`);
  return body as T;
}

export async function submitBrokerTask(input: {
  kind: BrokerTaskKind;
  projectId: string;
  request: BrokerRequest;
  title?: string;
}): Promise<BrokerTask> {
  const body = await requestJson<{ task: BrokerTask }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.task;
}

export async function listBrokerTasks(
  projectId: string,
  opts?: { activeOnly?: boolean },
): Promise<BrokerTask[]> {
  const qs = new URLSearchParams({ projectId });
  if (opts?.activeOnly) qs.set('active', '1');
  const body = await requestJson<{ tasks: BrokerTask[] }>(`/tasks?${qs.toString()}`);
  return body.tasks ?? [];
}

export async function getBrokerTask(taskId: string): Promise<BrokerTask | null> {
  const body = await requestJson<{ task: BrokerTask }>(`/tasks/${encodeURIComponent(taskId)}`);
  return body.task ?? null;
}

export async function cancelBrokerTask(taskId: string): Promise<BrokerTask | null> {
  const body = await requestJson<{ task: BrokerTask }>(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
  });
  return body.task ?? null;
}

/**
 * 订阅某项目任务列表：SSE 优先；不可用/断开自动回退 2.5s 轮询。
 * 返回取消订阅函数。
 */
export function subscribeBrokerTasks(
  projectId: string,
  onTasks: (tasks: BrokerTask[]) => void,
  opts?: { pollMs?: number },
): () => void {
  const base = brokerBase();
  if (!base) return () => undefined;
  let closed = false;
  let source: EventSource | null = null;
  let timer: number | null = null;

  const deliver = (tasks: BrokerTask[]): void => {
    if (closed) return;
    onTasks(tasks);
  };
  const poll = async (): Promise<void> => {
    const tasks = await listBrokerTasks(projectId).catch(() => null);
    if (tasks) deliver(tasks);
  };
  const startPolling = (): void => {
    if (timer !== null || closed) return;
    timer = window.setInterval(() => { void poll(); }, opts?.pollMs ?? 2500);
  };

  if (typeof EventSource === 'function') {
    try {
      source = new EventSource(`${base}/tasks/events?projectId=${encodeURIComponent(projectId)}`);
      source.addEventListener('tasks', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data as string) as { tasks?: BrokerTask[] };
          if (Array.isArray(data.tasks)) deliver(data.tasks);
        } catch {
          // 单帧解析失败忽略，后续帧/轮询兜底
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        startPolling();
      };
    } catch {
      source = null;
      startPolling();
    }
  } else {
    startPolling();
  }
  void poll();
  // SSE 可能被云端网关静默挂起（连接不断、但不再推消息），只靠 onerror 回退会永远停在旧状态。
  // 这里始终叠加低频轮询，SSE 正常时只是多几次幂等列表请求。
  startPolling();

  return () => {
    closed = true;
    source?.close();
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
}
