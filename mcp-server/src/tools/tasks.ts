/**
 * 生成任务查询/取消：代理 ComfyUI 插件的持久任务表（MCP 不执行、不落任务状态）。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "../errors.js";
import { cancelPluginTask, getPluginTask, listPluginTasks } from "../broker/plugin-client.js";
import { defTool, type Ctx } from "./_register.js";

function summary(task: Awaited<ReturnType<typeof getPluginTask>>) {
  if (!task) return null;
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    state: task.state,
    title: task.title,
    totalCount: task.totalCount ?? task.segments.length,
    doneCount: task.doneCount ?? task.segments.filter((s) => s.state === "success").length,
    currentSegment: task.currentSegment ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    segments: task.segments.map((s) => ({
      index: s.index,
      shotId: s.shotId,
      state: s.state,
      guide: s.guide,
      progress: s.progress,
      previewPath: s.previewPath,
      outputs: s.outputs,
      error: s.error,
    })),
  };
}

export function registerTaskTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_generation_tasks",
    description:
      "列出 ComfyUI 插件持有的生成任务（导演台出片 / 画布图片）。任务事实源在插件 output/zeroexo/tasks，MCP 只代理查询。",
    bits: ["project.read"],
    schema: {
      projectId: z.string().optional(),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    handler: async (args) => {
      const tasks = await listPluginTasks(args.projectId);
      const filtered = args.activeOnly
        ? tasks.filter((t) => t.state === "queued" || t.state === "running")
        : tasks;
      const limited = filtered.slice(0, args.limit ?? 20);
      return { total: limited.length, tasks: limited.map(summary).filter(Boolean) };
    },
  });

  defTool(server, ctx, {
    name: "get_generation_task",
    description:
      "查单个生成任务：状态、逐段进度、guide、每段产物和成品末帧路径。任务由 ComfyUI 插件持久化，关网页/关 MCP 都不会中断。",
    bits: ["project.read"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const task = await getPluginTask(args.taskId);
      if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${args.taskId}`);
      return summary(task);
    },
  });

  defTool(server, ctx, {
    name: "cancel_generation_task",
    description: "取消插件任务：排队中立即取消；运行中由插件在安全点中断，已完成段保留。",
    bits: ["workbench.write"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const task = await cancelPluginTask(args.taskId);
      return { ...summary(task), hint: "已请求取消；已完成段保留。" };
    },
  });
}
