/**
 * 生成任务查询/取消：任务状态只认 ComfyUI 插件。
 * - 导演台视频批次：插件 output/zeroexo/tasks；
 * - 画布图片/主体图片：插件 /zeroexo/v1/jobs，MCP 只留认领记录（.lf/zeroexo/app_meta/claims）。
 * 查询先问插件、再按认领记录找 jobId；本地旧任务表只作历史兼容。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "../errors.js";
import {
  cancelImageJob,
  cancelPluginTask,
  getImageJob,
  getPluginTask,
  listPluginTasks,
  type PluginTask,
} from "../broker/plugin-client.js";
import { findClaimByJob, listClaims } from "../store/claims.js";
import { cancelTask, listTasks, readTask, taskSnapshot, upsertMirrorTask, type TaskRecord } from "../store/tasks.js";
import { dataRoot } from "../config.js";
import { defTool, type Ctx } from "./_register.js";

interface SegmentView {
  index: number;
  shotId?: string | null;
  state: string;
  guide?: unknown;
  progress?: unknown;
  previewPath?: string | null;
  previewKey?: string | null;
  output?: unknown;
  outputs?: unknown;
  error?: string | null;
}

interface TaskView {
  taskId: string;
  projectId?: string;
  kind?: string;
  state: string;
  title?: string;
  totalCount: number;
  doneCount: number;
  currentSegment: number | null;
  error: string | null;
  createdAt?: string;
  updatedAt?: string;
  segments: SegmentView[];
}

/** 插件状态 → 本地任务表镜像（网页队列在没有云端连接时也能看到 MCP 发起的任务） */
function mirrorState(state: PluginTask["state"]): "queued" | "running" | "success" | "failed" | "canceled" {
  if (state === "queued") return "queued";
  if (state === "running") return "running";
  if (state === "success") return "success";
  if (state === "cancelled") return "canceled";
  return "failed";
}

export async function mirrorPluginTask(task: PluginTask): Promise<void> {
  if (!task.projectId) return;
  try {
    await upsertMirrorTask(dataRoot(), {
      taskId: task.taskId,
      projectId: task.projectId,
      kind: "director_run",
      title: task.title ?? "导演台出片",
      state: mirrorState(task.state),
      currentSegment: task.currentSegment ?? null,
      doneCount: task.doneCount,
      segments: (task.segments ?? []).map((seg) => ({
        index: seg.index,
        shotId: seg.shotId,
        state: mirrorState(seg.state),
        ...(seg.progress ? { progress: seg.progress } : {}),
        ...(seg.error ? { error: seg.error } : {}),
      })),
      error: task.error ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch {
    // 镜像失败不影响主流程（本地任务表只是网页展示用）
  }
}

function pluginView(task: PluginTask): TaskView {
  const segments: SegmentView[] = Array.isArray(task.segments) ? task.segments : [];
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    kind: task.kind,
    state: task.state,
    title: task.title,
    totalCount: task.totalCount ?? segments.length,
    doneCount: task.doneCount ?? segments.filter((s) => s.state === "success").length,
    currentSegment: task.currentSegment ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    segments: segments.map((s) => ({
      index: s.index,
      shotId: s.shotId,
      state: s.state,
      guide: s.guide,
      progress: s.progress,
      previewPath: s.previewPath ?? null,
      outputs: s.outputs,
      error: s.error,
    })),
  };
}

function localView(task: TaskRecord): TaskView {
  const snap = taskSnapshot(task);
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    kind: task.kind,
    state: task.state,
    title: task.title,
    totalCount: task.totalCount,
    doneCount: task.doneCount,
    currentSegment: task.currentSegment ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    segments: (snap.segments as SegmentView[]).map((s) => ({
      index: s.index,
      shotId: s.shotId ?? null,
      state: s.state,
      progress: s.progress ?? null,
      previewKey: s.previewKey ?? null,
      output: s.output ?? null,
      error: s.error ?? null,
    })),
  };
}

export function registerTaskTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_generation_tasks",
    description:
      "列出生成任务：导演台出片任务在 ComfyUI 插件 output/zeroexo/tasks，画布图片任务在数据根 .lf/zeroexo/app_meta/tasks，MCP 合并两边结果。",
    bits: ["project.read"],
    schema: {
      projectId: z.string().optional(),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    handler: async (args) => {
      const pluginTasks = await listPluginTasks(args.projectId).catch(() => [] as PluginTask[]);
      await Promise.all(pluginTasks.map((t) => mirrorPluginTask(t)));
      const claims = await listClaims(args.projectId).catch(() => []);
      const localTasks = await listTasks(undefined, { projectId: args.projectId, limit: 100 }).catch(() => []);
      const merged = [
        ...pluginTasks.map(pluginView),
        ...claims.map((c) => ({
          taskId: c.jobId,
          claimId: c.claimId,
          projectId: c.projectId,
          kind: c.kind,
          state: c.status,
          nodeId: c.nodeId,
          model: c.model,
          prompt: c.prompt,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        ...localTasks.map(localView),
      ];
      const filtered = args.activeOnly
        ? merged.filter((t) => t.state === "queued" || t.state === "running")
        : merged;
      const sorted = filtered.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      const limited = sorted.slice(0, args.limit ?? 20);
      return { total: limited.length, tasks: limited };
    },
  });

  defTool(server, ctx, {
    name: "get_generation_task",
    description:
      "查单个生成任务：状态、逐段进度、guide、每段产物和成品末帧路径。先查 ComfyUI 插件任务表，再回落数据根 MCP 任务表（画布图片）。",
    bits: ["project.read"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const pluginTask = await getPluginTask(args.taskId).catch(() => null);
      if (pluginTask) {
        void mirrorPluginTask(pluginTask);
        return pluginView(pluginTask);
      }
      const claim = await findClaimByJob(args.taskId);
      if (claim) {
        const job = await getImageJob(args.taskId);
        return {
          taskId: args.taskId,
          claimId: claim.claimId,
          projectId: claim.projectId,
          kind: claim.kind,
          state: job?.state ?? "unknown",
          outputs: job?.outputs ?? [],
          error: job?.error ?? null,
          nodeId: claim.nodeId,
          sourceNodeId: claim.sourceNodeId,
          sourceStorageKey: claim.sourceStorageKey,
          prompt: claim.prompt,
          model: claim.model,
          params: claim.params,
          claimStatus: claim.status,
        };
      }
      const local = await readTask(args.taskId).catch(() => null);
      if (local) return localView(local);
      throw new McpError("NOT_FOUND", `任务不存在: ${args.taskId}`);
    },
  });

  defTool(server, ctx, {
    name: "cancel_generation_task",
    description: "取消任务：排队中立即取消；运行中由执行方在安全点中断，已完成段保留。插件任务与画布图片任务都支持。",
    bits: ["workbench.write"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const pluginTask = await getPluginTask(args.taskId).catch(() => null);
      if (pluginTask) {
        const canceled = await cancelPluginTask(args.taskId);
        void mirrorPluginTask(canceled);
        return { ...pluginView(canceled), hint: "已请求取消；已完成段保留。" };
      }
      const claim = await findClaimByJob(args.taskId);
      if (claim) {
        await cancelImageJob(args.taskId);
        return { taskId: args.taskId, claimId: claim.claimId, state: "cancelled", hint: "已请求取消；已完成段保留。" };
      }
      const local = await readTask(args.taskId).catch(() => null);
      if (!local) throw new McpError("NOT_FOUND", `任务不存在: ${args.taskId}`);
      const canceled = await cancelTask(args.taskId);
      return { ...localView(canceled), hint: "已请求取消；已完成段保留。" };
    },
  });
}
