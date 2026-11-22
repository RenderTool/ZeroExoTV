/**
 * Task Broker HTTP / SSE（挂在 MCP 自己的端口，默认 8787，与 /mcp 同一端口）。
 *
 * 浏览器没有 MCP 客户端，但需要一个能查进度、能订阅的 HTTP 通道：
 * 提交/查询/取消/订阅都走这里，任务本身仍由 MCP worker 执行并落盘。
 * 2026-11-22：不再复用 8790 本地文件服务端口（该服务已移除）。
 *
 * 接口：
 * - POST /tasks                {kind, projectId, request, title?} → task
 * - GET  /tasks?projectId=     最近任务（网页刷新/换浏览器后恢复列表）
 * - GET  /tasks/:id            单个任务（含段与预览键）
 * - POST /tasks/:id/cancel     取消（排队中立即取消；运行中让执行器在安全点收尾）
 * - GET  /tasks/events?projectId=  SSE：首次推全量，变更/定时指纹变化再推全量
 */

import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { dataRoot } from "../config.js";
import { subscribeTasks, listTasks, readTask, taskSnapshot, cancelTask } from "../store/tasks.js";
import { submitDirectorTask, submitImageTask } from "./executor.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function taskIdOf(pathname: string): string | null {
  const m = /^\/tasks\/([A-Za-z0-9_-]+)$/.exec(pathname);
  return m ? m[1]! : null;
}

/** 返回值 = 是否已处理（false 交回数据服务原有路由） */
export async function handleBrokerRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  if (p !== "/tasks" && !p.startsWith("/tasks/")) return false;

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  const root = dataRoot();
  try {
    if (p === "/tasks" && req.method === "POST") {
      return await createTaskViaHttp(req, res);
    }
    if (p === "/tasks" && req.method === "GET") {
      const projectId = url.searchParams.get("projectId") ?? undefined;
      const activeOnly = url.searchParams.get("active") === "1";
      const tasks = await listTasks(root, { projectId, activeOnly, limit: 50 });
      sendJson(res, 200, { tasks: tasks.map(taskSnapshot) });
      return true;
    }
    if (p === "/tasks/events") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
        return true;
      }
      await streamEvents(req, res, url.searchParams.get("projectId") ?? undefined);
      return true;
    }
    const cancelId = /^\/tasks\/([A-Za-z0-9_-]+)\/cancel$/.exec(p)?.[1];
    if (cancelId && req.method === "POST") {
      const task = await readTask(cancelId, root);
      if (!task) {
        sendJson(res, 404, { error: "NOT_FOUND", taskId: cancelId });
        return true;
      }
      const canceled = await cancelTask(cancelId, root);
      sendJson(res, 200, { task: taskSnapshot(canceled) });
      return true;
    }
    const id = taskIdOf(p);
    if (id && req.method === "GET") {
      const task = await readTask(id, root);
      if (!task) {
        sendJson(res, 404, { error: "NOT_FOUND", taskId: id });
        return true;
      }
      sendJson(res, 200, { task: taskSnapshot(task) });
      return true;
    }
    sendJson(res, 404, { error: "NOT_FOUND", endpoint: p });
    return true;
  } catch (err) {
    sendJson(res, 500, {
      error: "TASK_ERROR",
      message: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

async function createTaskViaHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const body = await readJsonBody(req);
  const kind = String(body.kind ?? "");
  const projectId = String(body.projectId ?? "").trim();
  if (!projectId) {
    sendJson(res, 400, { error: "VALIDATION", message: "缺少 projectId" });
    return true;
  }
  const projectDir = path.join(dataRoot(), "projects", projectId);
  const exists = await fs.stat(projectDir).then((s) => s.isDirectory(), () => false);
  if (!exists) {
    sendJson(res, 404, { error: "NOT_FOUND", message: `项目不存在: ${projectId}` });
    return true;
  }
  const request = (body.request ?? {}) as Record<string, unknown>;
  try {
    const task = kind === "director_run"
      ? await submitDirectorTask({
        projectId,
        selectedIds: Array.isArray(request.selectedIds)
          ? (request.selectedIds as unknown[]).filter((v): v is string => typeof v === "string")
          : [],
        ...(typeof request.episode === "string" ? { episode: request.episode } : {}),
        ...(typeof request.baseUrl === "string" ? { baseUrl: request.baseUrl } : {}),
        ...(request.models && typeof request.models === "object"
          ? { models: request.models as Record<string, string> }
          : {}),
      })
      : await submitImageTask({
        projectId,
        title: typeof body.title === "string" ? body.title : undefined,
        requests: Array.isArray(request.requests) ? request.requests as never[] : [],
      });
    sendJson(res, 200, { task: taskSnapshot(task) });
  } catch (err) {
    sendJson(res, 400, {
      error: "TASK_REJECTED",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

/** SSE：全量快照 + 变更推送（跨进程靠目录指纹轮询兜底） */
async function streamEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectId?: string,
): Promise<void> {
  res.writeHead(200, {
    ...CORS,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  const root = dataRoot();
  let closed = false;
  let signature = "";

  const snapshot = async (): Promise<void> => {
    if (closed) return;
    const tasks = await listTasks(root, { projectId, limit: 40 });
    const next = tasks.map((t) => `${t.taskId}:${t.updatedAt}`).join("|");
    signature = next;
    res.write(`event: tasks\ndata: ${JSON.stringify({ tasks: tasks.map(taskSnapshot) })}\n\n`);
  };

  const onTask = (): void => { void snapshot(); };
  const unsubscribe = projectId ? subscribeTasks(projectId, onTask) : () => undefined;

  // 跨进程写盘不会触发本进程事件：定时比对目录指纹，变了就推全量
  const timer = setInterval(() => {
    void (async () => {
      if (closed) return;
      const tasks = await listTasks(root, { projectId, limit: 40 });
      const next = tasks.map((t) => `${t.taskId}:${t.updatedAt}`).join("|");
      if (next !== signature) await snapshot();
      else res.write(": ping\n\n");
    })();
  }, 1800);
  if (typeof timer.unref === "function") timer.unref();

  const cleanup = (): void => {
    closed = true;
    clearInterval(timer);
    unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);

  await snapshot();
}
