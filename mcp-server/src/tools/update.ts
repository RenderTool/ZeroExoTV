/**
 * MCP 自我更新工具（2026-11-11 用户要求）
 *
 * 用户不想再被问「MCP 更新了吗」：旧版 MCP 连上新网页后，工具返回里会自动带 `_mcpOutdated`
 * （由 _register 注入），Agent 看到就先调 `mcp_update_status` 说明情况，
 * 用户同意后调 `update_mcp_server` 自动 git 快进 + 重新编译，最后提示重启 MCP 服务。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { buildUpdateStatus, updateMcpServer } from "../lib/update-check.js";
import { defTool, guardUserConfirmed, PROCESS_STARTED_AT, TOOL_REGISTRY, type Ctx } from "./_register.js";

export function registerUpdateTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "mcp_update_status",
    description:
      "MCP 自身版本体检（只读）：对比网页要求的工具清单（.lf/zeroexo/app_meta/mcp-required.json）与本进程的工具，"
      + "报告缺哪些工具、dist 是否比进程新、仓库落后多少提交，并给出下一步（更新 / 重启）。"
      + "工具返回里出现 _mcpOutdated 时先调这个，把结论告诉用户。",
    bits: ["project.read"],
    schema: {},
    handler: async () => {
      const root = dataRoot();
      const status = await buildUpdateStatus({
        root,
        tools: TOOL_REGISTRY,
        serverEntry: process.argv[1] ?? "",
        startedAtMs: PROCESS_STARTED_AT,
      }).catch(() => null);
      if (!status) throw new McpError("IO_ERROR", "读取 MCP 版本信息失败");
      return {
        ...status,
        nextSteps: status.missing.length > 0 || (status.gitBehind ?? 0) > 0
          ? ["把缺的工具/落后提交告诉用户", "用户同意后调 update_mcp_server（userConfirmed:true）", "重启 MCP 服务"]
          : status.distOutdated
            ? ["重启 MCP 服务（代码已重新编译）"]
            : ["已是最新，无需处理"],
      };
    },
  });

  defTool(server, ctx, {
    name: "update_mcp_server",
    description:
      "更新 MCP 自身（写操作，必须用户同意）：git fetch → 工作区干净才 --ff-only 快进 → 重新编译 mcp-server。"
      + "不会覆盖用户未提交的改动；更新后必须重启 MCP 服务（stdio 进程无法热替换已加载代码）。"
      + "只允许用户明确同意后调用，参数 userConfirmed:true。",
    bits: ["project.write"],
    schema: {
      userConfirmed: z.boolean().optional()
        .describe("用户已明确同意自动更新 MCP；必须 true"),
    },
    handler: async (args) => {
      guardUserConfirmed(args, "更新 MCP 会执行 git 快进并重新编译");
      const status = await buildUpdateStatus({
        root: dataRoot(),
        tools: TOOL_REGISTRY,
        serverEntry: process.argv[1] ?? "",
        startedAtMs: PROCESS_STARTED_AT,
      }).catch(() => null);
      if (!status) throw new McpError("IO_ERROR", "读取 MCP 版本信息失败");
      const res = await updateMcpServer(status.repoRoot, status.serverEntry);
      return { ...res, before: { missing: status.missing, gitBehind: status.gitBehind } };
    },
  });
}
