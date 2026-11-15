/**
 * MCP Task Broker 持久化任务表（2026-11-15 Plan：MCP 任务中转服务改造）。
 *
 * 为什么任务必须落盘：网页刷新/关闭/换浏览器/多开都只应断开订阅，不能丢任务、进度与预览。
 * 唯一事实源 = `<数据根>/.lf/zeroexo/app_meta/tasks/<taskId>.json`，只有 MCP 推进状态。
 *
 * - 状态机：queued → running → success | failed | canceled（终态不再变）
 * - 单写者：任务被 `<taskId>.lease` 认领后，只有 lease 持有者推进；跨进程靠 lease 互斥
 * - 读写：原子写（temp+rename）+ mtime 双因子校验，冲突自动重读重放 mutate
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { fileStat, readJsonIfExists, withFileLock, writeJsonAtomic } from "./fs-node.js";

export const TASKS_REL = path.join(".lf", "zeroexo", "app_meta", "tasks");

export type TaskKind = "director_run" | "canvas_image";
export type TaskState = "queued" | "running" | "success" | "failed" | "canceled";
export type SegmentState = "queued" | "running" | "success" | "failed" | "canceled";

export interface TaskGuide {
  id: string;
  frames?: number;
  sha256?: string;
  localKey?: string;
  /** cache = 时间线上游片段当前缓存版本；slot = 本段显式引导槽；chain = 批内上一段产出；none = 无引导输入 */
  source: "cache" | "slot" | "chain" | "none";
  sourceShotId?: string;
}

export interface TaskGuideFile {
  id: string;
  path?: string;
  frames?: number;
  sha256?: string;
  localKey?: string;
}

/** 片段缓存版本（MCP 落库后回给网页，网页据此更新本地 shots，避免覆盖掉 cache） */
export interface TaskShotVersion {
  id: string;
  storageKey: string;
  previewKey?: string;
  guide?: TaskGuideFile | null;
  prompt?: string;
  createdAt: string;
}

export interface TaskOutput {
  storageKey: string;
  mime: string;
  width?: number;
  height?: number;
  /** 最后一帧预览（MCP 落盘的图片 storageKey） */
  previewKey?: string;
  /** 图片任务对应的画布节点 id（网页据此幂等落图） */
  nodeId?: string;
  /** 视频首帧/片段缓存缩略 */
  firstFrameKey?: string;
  /** 本段产物自带的 guide（下一段可用） */
  guide?: TaskGuideFile | null;
  /** 本次追加的片段缓存版本（网页合并进 shot.cache） */
  version?: TaskShotVersion;
}

export interface TaskSegment {
  /** 1 基序号 */
  index: number;
  shotId?: string;
  state: SegmentState;
  prompt?: string;
  comfyJobId?: string;
  guide?: TaskGuide;
  progress?: { step: number; totalSteps: number };
  previewKey?: string;
  output?: TaskOutput;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ImageTaskRequest {
  prompt: string;
  model?: "moss" | "krea2" | "qwen";
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
  /** 画布节点 id（网页幂等落图用；缺省由 broker 生成） */
  nodeId?: string;
}

export interface DirectorTaskRequest {
  selectedIds: string[];
  episode?: string;
  baseUrl?: string;
  models?: Record<string, string>;
}

export type TaskRequest =
  | { kind: "director_run"; selectedIds: string[]; episode?: string; baseUrl?: string; models?: Record<string, string> }
  | { kind: "canvas_image"; requests: ImageTaskRequest[] };

export interface TaskRecord {
  schemaVersion: 1;
  taskId: string;
  projectId: string;
  kind: TaskKind;
  state: TaskState;
  title: string;
  createdAt: string;
  updatedAt: string;
  request: TaskRequest;
  segments: TaskSegment[];
  totalCount: number;
  doneCount: number;
  currentSegment: number | null;
  /** 最后一帧预览（任一时刻最新画面），刷新/换浏览器后仍能显示 */
  previewKey?: string;
  previewSegment?: number | null;
  outputs: TaskOutput[];
  error?: string;
  attempt: number;
  cancelRequested?: boolean;
  /** 执行参数快照（baseUrl / 预览 clientId） */
  engine?: { baseUrl: string; clientId: string };
  lease?: { owner: string; pid: number; heartbeatAt: string };
}

export function tasksDir(root = dataRoot()): string {
  return path.join(root, TASKS_REL);
}

export function taskPath(taskId: string, root = dataRoot()): string {
  return path.join(tasksDir(root), `${taskId}.json`);
}

function leasePath(taskId: string, root = dataRoot()): string {
  return path.join(tasksDir(root), `${taskId}.lease`);
}

export function newTaskId(): string {
  return `tsk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

/** 进程身份：跨进程 lease 互斥用（同机多开/IDE MCP + fs-server 同时在线） */
export const PROCESS_OWNER = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

const listeners = new Map<string, Set<(task: TaskRecord) => void>>();

/** 订阅某项目的任务变更（SSE 与进程内执行器共用） */
export function subscribeTasks(projectId: string, fn: (task: TaskRecord) => void): () => void {
  const set = listeners.get(projectId) ?? new Set();
  set.add(fn);
  listeners.set(projectId, set);
  return () => {
    const cur = listeners.get(projectId);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) listeners.delete(projectId);
  };
}

function emit(task: TaskRecord): void {
  const set = listeners.get(task.projectId);
  if (!set) return;
  for (const fn of set) {
    try { fn(task); } catch { /* 订阅方异常不影响主流程 */ }
  }
}

export async function readTask(taskId: string, root = dataRoot()): Promise<TaskRecord | null> {
  return readJsonIfExists<TaskRecord>(taskPath(taskId, root));
}

/**
 * 列任务：按 updatedAt 倒序。只读目录，不清理任何文件（历史任务要能一直查）。
 * 损坏的单个任务文件跳过，不阻断列表。
 */
export async function listTasks(
  root = dataRoot(),
  opts: { projectId?: string; activeOnly?: boolean; limit?: number } = {},
): Promise<TaskRecord[]> {
  const dir = tasksDir(root);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const out: TaskRecord[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const rec = await readJsonIfExists<TaskRecord>(path.join(dir, name)).catch(() => null);
    if (!rec?.taskId || !rec.kind) continue;
    if (opts.projectId && rec.projectId !== opts.projectId) continue;
    if (opts.activeOnly && rec.state !== "queued" && rec.state !== "running") continue;
    out.push(rec);
  }
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return out.slice(0, opts.limit ?? 50);
}

export interface CreateTaskInput {
  projectId: string;
  kind: TaskKind;
  title?: string;
  request: TaskRequest;
}

/** 新建任务（queued）。请求形状在这里归一，执行器不再猜。 */
export async function createTask(root: string, input: CreateTaskInput): Promise<TaskRecord> {
  const now = new Date().toISOString();
  const taskId = newTaskId();
  const segments: TaskSegment[] = input.kind === "director_run"
    ? (input.request as Extract<TaskRequest, { kind: "director_run" }>).selectedIds.map((shotId, i) => ({
      index: i + 1, shotId, state: "queued" as const,
    }))
    : (input.request as Extract<TaskRequest, { kind: "canvas_image" }>).requests.map((req, i) => ({
      index: i + 1,
      state: "queued" as const,
      prompt: req.prompt,
      ...(req.nodeId ? { shotId: req.nodeId } : {}),
    }));
  const record: TaskRecord = {
    schemaVersion: 1,
    taskId,
    projectId: input.projectId,
    kind: input.kind,
    state: "queued",
    title: input.title ?? (input.kind === "director_run"
      ? `导演台出片 · ${segments.length} 段`
      : `画布图片 · ${segments.length} 张`),
    createdAt: now,
    updatedAt: now,
    request: input.request,
    segments,
    totalCount: segments.length,
    doneCount: 0,
    currentSegment: null,
    outputs: [],
    attempt: 0,
  };
  await writeJsonAtomic(taskPath(taskId, root), record);
  emit(record);
  return record;
}

/**
 * 原子推进任务：读最新 → mutate → 原始 mtime 未变才落盘，变了就重读重放。
 * 目的：执行器写进度与取消接口写 cancelRequested 互不覆盖。
 */
export async function updateTask(
  taskId: string,
  mutate: (task: TaskRecord) => void,
  root = dataRoot(),
): Promise<TaskRecord> {
  const file = taskPath(taskId, root);
  return withFileLock(file, async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const before = await fileStat(file);
      const task = await readTask(taskId, root);
      if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${taskId}`);
      mutate(task);
      task.updatedAt = new Date().toISOString();
      const now = await fileStat(file);
      const changed = (before === null) !== (now === null)
        || (!!before && !!now && (before.mtimeMs !== now.mtimeMs || before.size !== now.size));
      if (changed) continue; // 别的进程刚写过：重读再改
      await writeJsonAtomic(file, task);
      emit(task);
      return task;
    }
    throw new McpError("VERSION_CONFLICT", `任务连续被外部修改，无法安全落盘: ${taskId}`);
  });
}

/** 取消：排队中直接进终态；运行中只打标记，由执行器在安全点收尾 */
export async function cancelTask(taskId: string, root = dataRoot()): Promise<TaskRecord> {
  return updateTask(taskId, (task) => {
    if (task.state === "success" || task.state === "failed" || task.state === "canceled") return;
    task.cancelRequested = true;
    if (task.state === "queued") {
      task.state = "canceled";
      for (const seg of task.segments) {
        if (seg.state === "queued") seg.state = "canceled";
      }
    }
  }, root);
}

const LEASE_TTL_MS = 25_000;

/**
 * 认领任务：跨进程只有一个执行者。
 * lease 文件用 O_EXCL 创建；已存在且心跳超过 TTL（执行者崩溃/进程被杀）可抢占。
 */
export async function claimTask(taskId: string, root = dataRoot()): Promise<boolean> {
  const file = leasePath(taskId, root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const write = async (): Promise<boolean> => {
    const lease = { owner: PROCESS_OWNER, pid: process.pid, heartbeatAt: new Date().toISOString() };
    try {
      const handle = await fs.open(file, "wx");
      await handle.writeFile(JSON.stringify(lease), "utf8");
      await handle.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") return false;
      const cur = await readJsonIfExists<{ owner?: string; heartbeatAt?: string }>(file).catch(() => null);
      if (!cur) return false;
      if (cur.owner === PROCESS_OWNER) {
        await fs.writeFile(file, JSON.stringify(lease), "utf8");
        return true;
      }
      const beat = Date.parse(cur.heartbeatAt ?? "");
      if (Number.isFinite(beat) && Date.now() - beat < LEASE_TTL_MS) return false;
      await fs.writeFile(file, JSON.stringify(lease), "utf8").catch(() => undefined);
      return true;
    }
  };
  const ok = await write();
  if (!ok) return false;
  await updateTask(taskId, (task) => {
    task.lease = { owner: PROCESS_OWNER, pid: process.pid, heartbeatAt: new Date().toISOString() };
  }, root).catch(() => undefined);
  return true;
}

export async function heartbeatTask(taskId: string, root = dataRoot()): Promise<void> {
  const file = leasePath(taskId, root);
  const cur = await readJsonIfExists<{ owner?: string }>(file).catch(() => null);
  if (cur?.owner !== PROCESS_OWNER) return;
  await fs.writeFile(file, JSON.stringify({
    owner: PROCESS_OWNER, pid: process.pid, heartbeatAt: new Date().toISOString(),
  }), "utf8").catch(() => undefined);
}

export async function releaseTask(taskId: string, root = dataRoot()): Promise<void> {
  const file = leasePath(taskId, root);
  const cur = await readJsonIfExists<{ owner?: string }>(file).catch(() => null);
  if (cur?.owner === PROCESS_OWNER) await fs.rm(file, { force: true }).catch(() => undefined);
  const task = await readTask(taskId, root).catch(() => null);
  if (task?.lease?.owner === PROCESS_OWNER) {
    await updateTask(taskId, (t) => { delete t.lease; }, root).catch(() => undefined);
  }
}

/** 任务摘要（工具/接口返回给 Agent 与人看的形状） */
export function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    kind: task.kind,
    state: task.state,
    title: task.title,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    totalCount: task.totalCount,
    doneCount: task.doneCount,
    currentSegment: task.currentSegment,
    previewKey: task.previewKey ?? null,
    previewSegment: task.previewSegment ?? null,
    error: task.error ?? null,
  };
}

/** 全量任务（含段与产物）：网页订阅与 get_task 用 */
export function taskSnapshot(task: TaskRecord): Record<string, unknown> {
  return {
    ...taskSummary(task),
    cancelRequested: task.cancelRequested === true,
    request: task.request,
    segments: task.segments.map((seg) => ({
      index: seg.index,
      shotId: seg.shotId ?? null,
      state: seg.state,
      prompt: seg.prompt ?? null,
      guide: seg.guide ?? null,
      progress: seg.progress ?? null,
      previewKey: seg.previewKey ?? null,
      output: seg.output ?? null,
      error: seg.error ?? null,
    })),
    outputs: task.outputs,
  };
}
