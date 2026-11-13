/** 升级自查工具：get_upgrade_guide / audit_upgrade（2026-11-13） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { readScript } from "../store/script.js";
import { readStoryboard } from "../store/storyboard.js";
import { readWorkbench } from "../store/workbench.js";
import { auditProjectData, UPGRADE_GUIDE } from "../lib/upgrade-audit.js";
import { defTool, type Ctx } from "./_register.js";

export function registerUpgradeTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_upgrade_guide",
    description:
      "读「升级/连上后的查漏补缺」说明：为什么旧项目可能不合当前流程、应先跑 audit_upgrade、怎么把结果报给用户并询问是否修复。",
    bits: [],
    schema: {},
    handler: async () => ({
      guide: UPGRADE_GUIDE,
      checks: [
        "GLOBAL_STYLE_UNSET：全剧风格未设置",
        "SUBJECT_PROMPT_EMPTY：主体基础状态没有提示词",
        "PROMPT_PLACEHOLDER：提示词仍有旧占位话术",
        "SUBJECT_IMAGE_NO_PROMPT：主体图没有反推提示词",
        "SHOT_EPISODE_UNASSIGNED：导演台片段没有分集",
        "SHOT_EPISODE_UNKNOWN：片段指向已删除的集",
        "SHOT_PROMPT_EMPTY：片段提示词为空",
      ],
    }),
  });

  defTool(server, ctx, {
    name: "audit_upgrade",
    description:
      "升级后只读自查：按当前流程检查旧项目可能留下的洞（全剧风格未设、主体无提示词/图无 prompt、" +
      "导演台片段未分集、提示词为空、指向已删集）。返回 findings（严重度/证据/修复工具）与 summary。" +
      "**只读**；先把结果报给用户并问是否修复，不要擅自批量改。",
    bits: ["script.read", "subject.read", "workbench.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) return { ok: false, error: "NOT_FOUND", message: `项目没有剧本: ${args.projectId}` };
      const storyboard = await readStoryboard(dataRoot(), args.projectId);
      const workbench = await readWorkbench(dataRoot(), args.projectId);
      const result = auditProjectData({ script, storyboard, workbench });
      return {
        ...result,
        nextAction: result.ok
          ? "无需修补；可以继续当前流程。"
          : "把 findings 逐条报给用户（旧流程漏了什么 → 现在会怎样 → 用哪个工具修），询问是否现在修复；不要擅自改动。",
      };
    },
  });
}
