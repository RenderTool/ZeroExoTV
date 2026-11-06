/** 拆解域：split_script_to_shots（剧本 → 导演台片段草案 → 确认后落 workbench） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readScript, splitToSegmentDrafts } from "../store/script.js";
import { addSegments } from "../store/workbench.js";
import { defTool, guardDryRunConfirm, type Ctx } from "./_register.js";

export function registerSplitTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "split_script_to_shots",
    description:
      "把剧集剧本按场景切分成导演台片段草案（number/description/duration 默认 5s）。dryRun:true 返回草案清单供确认；confirm:true 携带 workbench 的 baseVersion 落盘。",
    bits: ["split.write", "script.read"],
    schema: {
      projectId: z.string(),
      episodeId: z.string(),
      baseVersion: z.number().int().min(0).describe("workbench.json 的 version；dryRun 时可为 0"),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
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
        dryRun: false,
      });
      return {
        written: true,
        workbenchVersion: res.after.version,
        addedCount: drafts.length,
        shots: res.after.shots.map((s) => ({ id: s.id, number: s.number, description: s.description })),
      };
    },
  });
}
