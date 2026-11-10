/**
 * 导入预检工具：preflight_import。
 *
 * 弱模型（豆包等）拿到源数据会直接开写。这个工具只读、不写盘，把「必须先问用户的问题」
 * 变成结构化输出，并在写工具里用 userConfirmed 闸门兜底。调用顺序：
 * get_current_project → 确认项目 → preflight_import → 逐条问用户 → 写工具(userConfirmed:true)。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readScript } from "../store/script.js";
import { readStoryboard } from "../store/storyboard.js";
import { readWorkbench } from "../store/workbench.js";
import { getProjectOverview } from "../store/projects.js";import { analyzeSource, buildPreflight } from "../lib/preflight.js";
import { defTool, type Ctx } from "./_register.js";

export function registerPreflightTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "preflight_import",
    description:
      "批量导入前的强制预检（只读，不写盘）：判定源文本语言/是否为英文或外部平台格式、识别分集标记、统计主体库与导演台现状，"
      + "返回必须逐条问用户的问题（来源格式 / 集数 / 主体资产 / 对已有片段的影响）。"
      + "拿到 questions 后逐条问用户，用户回答后再写；import_script、split_script_to_shots 缺少 userConfirmed 会直接拒绝。",
    bits: ["script.read", "subject.read", "workbench.read"],
    schema: {
      projectId: z.string(),
      /** 准备导入的剧本原文（可选：只问集数/主体时可不传） */
      sourceText: z.string().optional(),
    },
    handler: async (args) => {
      const project = await getProjectOverview(dataRoot(), args.projectId).catch(() => null);
      if (!project) throw new McpError("NOT_FOUND", `项目不存在: ${args.projectId}`);
      const [script, storyboard, workbench] = await Promise.all([
        readScript(dataRoot(), args.projectId),
        readStoryboard(dataRoot(), args.projectId),
        readWorkbench(dataRoot(), args.projectId),
      ]);
      const subjects = storyboard?.entities ?? [];
      const subjectImages = subjects.reduce((n, s) => n + (s.images?.length ?? 0), 0);
      const shots = workbench?.shots?.length ?? 0;
      const episodes = script?.episodes?.length ?? 0;

      return {
        project: { id: project.id, title: project.title },
        ...buildPreflight({
          projectTitle: project.title,
          analysis: analyzeSource(args.sourceText ?? ""),
          library: { episodes, subjects: subjects.length, subjectImages, shots },
        }),
      };
    },
  });
}
