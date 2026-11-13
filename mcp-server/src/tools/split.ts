/** 拆解域：split_script_to_shots（剧本 → 导演台片段草案 → 确认后落 workbench） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readScript, splitToSegmentDrafts } from "../store/script.js";
import { addSegments } from "../store/workbench.js";
import { defTool, guardDryRunConfirm, guardUserConfirmed, type Ctx } from "./_register.js";

export function registerSplitTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "split_script_to_shots",
    description:
      "把剧集剧本按场景切分成导演台片段草案（number/description/duration 默认 5s）。dryRun:true 返回草案清单供确认；confirm:true 携带 workbench 的 baseVersion 落盘。" +
      "草案只是骨架：落盘后必须按 zeroexo://skills/shots-prompts 的「镜头卡」重设 description（职责 / 来源场次 / 起点→唯一动作→终点 / 景别机位运镜 / 声音 / 视觉依据）与时长，不得直接出片。",
    bits: ["split.write", "script.read"],
    schema: {
      projectId: z.string(),
      episodeId: z.string(),
      baseVersion: z.number().int().min(0).describe("workbench.json 的 version；dryRun 时可为 0"),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
      /** 用户已回答拆段方案（段数/时长/是否重拆）——真实落盘必须 true */
      userConfirmed: z.boolean().optional()
        .describe("用户已确认拆段方案（段数/每段时长/对已有片段的处理）。真实落盘必须 true"),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      if (args.dryRun !== true) {
        guardUserConfirmed(args, "拆分镜会改写导演台片段");
      }
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const ep = script.episodes.find((e) => e.id === args.episodeId);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${args.episodeId}`);

      const drafts = splitToSegmentDrafts(ep.content);
      if (args.dryRun) {
        return { written: false, episodeId: ep.id, segmentDrafts: drafts, draftCount: drafts.length };
      }
      const res = await addSegments(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        drafts,
        episodeId: ep.id,
        dryRun: false,
      });
      return {
        written: true,
        workbenchVersion: res.after.version,
        addedCount: drafts.length,
        shots: res.after.shots.map((s) => ({ id: s.id, number: s.number, episodeId: s.episodeId, description: s.description })),
      };
    },
  });
}
