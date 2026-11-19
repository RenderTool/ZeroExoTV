/** 项目档案读写工具（需求/决策/进度/待办），任何 MCP 接入先读再干活。 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { readProjectLog, appendProjectLog, updateProjectLogEntry, compactProjectLog, setPipelineState } from "../store/project-log.js";
import { defTool, type Ctx } from "./_register.js";

export function registerProjectLogTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_project_log",
    description:
      "读项目档案（只读）：需求条目、已定决策、执行进度、待办。换会话/换 LLM/重启后先读它，不要靠聊天记忆重复问需求。" +
      "返回 openRequirements（未完成需求）和 latestProgress（最近进度）。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const log = await readProjectLog(dataRoot(), args.projectId);
      const open = log.entries.filter((e) => e.kind === "requirement" && e.status === "open");
      const latest = log.entries.filter((e) => e.kind === "progress").slice(-5).reverse();
      return {
        projectId: args.projectId,
        version: log.version,
        updatedAt: log.updatedAt,
        counts: {
          requirements: log.entries.filter((e) => e.kind === "requirement").length,
          openRequirements: open.length,
          decisions: log.entries.filter((e) => e.kind === "decision").length,
          progress: log.entries.filter((e) => e.kind === "progress").length,
        },
        openRequirements: open,
        latestProgress: latest,
        entries: log.entries.slice(-40),
      };
    },
  });

  defTool(server, ctx, {
    name: "append_project_log",
    description:
      "向项目档案追加一条记录：用户新需求(requirement)、已确认的决策(decision)、阶段进度(progress)、待办(todo)、产物(artifact)。" +
      "任何时候用户提出新要求或确认一个口径，先写 requirement/decision；每完成一个阶段写 progress，避免新会话丢失上下文。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      kind: z.enum(["requirement", "decision", "progress", "todo", "artifact"]),
      text: z.string().min(1),
      status: z.enum(["open","review","done","dropped"]).optional(),
      by: z.string().optional(),
      refs: z.array(z.string()).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await appendProjectLog(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
        entry: { kind: args.kind, text: args.text, status: args.status ?? (args.kind === "progress" || args.kind === "decision" ? "done" : "open"), by: args.by, refs: args.refs },
      });
      return { written: !args.dryRun, version: res.after.version };
    },
  });

  defTool(server, ctx, {
    name: "update_project_log_entry",
    description: "把项目档案里某条需求/待办标记为 done 或 dropped（完成一个需求就回填，不要只在聊天里说完成）。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      entryId: z.string(),
      status: z.enum(["open","review","done","dropped"]),
      note: z.string().optional(),
    },
    handler: async (args) => {
      const res = await updateProjectLogEntry(dataRoot(), args.projectId, args);
      return { written: true, version: res.after.version };
    },
  });

  defTool(server, ctx, {
    name: "set_project_pipeline",
    description:
      "标记 MCP 当前在哪个阶段工作（script/subjects/shots/generate/review）与状态（working/review/done/blocked）。" +
      "网页已取消独立「需求」页签：需求/决策/进度/待办/审核统一收进「任务队列」面板下方的「项目记忆」区（只读），" +
      "active=true 时该处显示「MCP 代理工作中」。" +
      "开始一项工作前 active=true + 对应阶段 working；完成或等用户审阅时改 review/done；全部收工 active=false。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      phase: z.enum(["script", "subjects", "shots", "generate", "review"]).optional(),
      status: z.enum(["pending", "working", "review", "done", "blocked"]).optional(),
      active: z.boolean().optional(),
      note: z.string().optional(),
      agent: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await setPipelineState(dataRoot(), args.projectId, args);
      return { written: !args.dryRun, version: res.after.version, pipeline: res.after.pipeline };
    },
  });
  defTool(server, ctx, {
    name: "compact_project_log",
    description:
      "压缩项目档案：把已结束（done/dropped）的旧记录清掉，只保留最近 20 条，open 需求永不删除。" +
      "用户说「清理/压缩需求记录」时用；不会动剧本、主体、画布任何数据。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      keepRecent: z.number().int().min(5).max(200).optional(),
    },
    handler: async (args) => {
      const res = await compactProjectLog(dataRoot(), args.projectId, args);
      return { written: true, version: res.after.version, entries: res.after.entries.length };
    },
  });
}
