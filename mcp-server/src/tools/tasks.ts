/**
 * 任务中转服务查询/取消（MCP Task Broker，2026-11-15）。
 *
 * 所有 AI 任务由 MCP 执行并落盘：Agent 用本组工具查进度、取消、看最后一帧预览。
 * 提交入口仍按任务类型分：request_director_run（导演台）/ generate_canvas_images（图片）。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import {
  cancelTask,
  listTasks,
  readTask,
  taskSnapshot,
  taskSummary,
} from "../store/tasks.js";
import { defTool, type Ctx } from "./_register.js";

export function registerTaskTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_generation_tasks",
    description:
      "列出持久化生成任务（导演台出片 / 画布图片）。刷新、关闭、换浏览器都不丢；activeOnly=true 只看排队与运行中。" +
      "任务由 MCP 执行，网页只订阅。",
    bits: ["project.read"],
    schema: {
      projectId: z.string().optional(),
      activeOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    handler: async (args) => {
      const tasks = await listTasks(dataRoot(), {
        projectId: args.projectId,
        activeOnly: args.activeOnly,
        limit: args.limit ?? 20,
      });
      return { total: tasks.length, tasks: tasks.map(taskSummary) };
    },
  });

  defTool(server, ctx, {
    name: "get_generation_task",
    description:
      "查单个生成任务：状态、逐段进度、每段 guide 来源（cache=上一段当前缓存 / slot=显式引导槽 / none）、" +
      "产物 storageKey、最后一帧预览键 previewKey。进度与预览都在 MCP 侧持久化。",
    bits: ["project.read"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const task = await readTask(args.taskId, dataRoot());
      if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${args.taskId}`);
      return taskSnapshot(task);
    },
  });

  defTool(server, ctx, {
    name: "cancel_generation_task",
    description: "取消生成任务：排队中立即取消；运行中由 MCP 在安全点中断当前 ComfyUI 作业并保留已完成段。",
    bits: ["workbench.write"],
    schema: { taskId: z.string() },
    handler: async (args) => {
      const task = await readTask(args.taskId, dataRoot());
      if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${args.taskId}`);
      const canceled = await cancelTask(args.taskId, dataRoot());
      return { ...taskSnapshot(canceled), hint: "已请求取消；进度会由执行器在安全点收尾。" };
    },
  });
}
