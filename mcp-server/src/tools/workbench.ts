/** 导演台域：get_workbench / set_shared_params / set_shot_prompt / add_segment */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { DIRECTOR_PRESET_IDS } from "../store/director-params.js";
import { addSegment, mutateWorkbench, readWorkbench, setSharedParams, setShotPrompt } from "../store/workbench.js";
import { McpError } from "../errors.js";
import { defTool, type Ctx } from "./_register.js";

export function registerWorkbenchTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_workbench",
    description: "读取导演台全量（tracks/shots/sharedParams/version）。不存在时返回 null（写工具可用 baseVersion=0 创建）。",
    bits: ["workbench.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const wb = await readWorkbench(dataRoot(), args.projectId);
      return wb ?? { exists: false };
    },
  });

  defTool(server, ctx, {
    name: "set_shared_params",
    description: `更新导演台公共参数（presetId 可选 ${DIRECTOR_PRESET_IDS.join("/")}，params 合并）。重复的公共内容直接写进每段提示词（set_shot_prompt）。baseVersion = workbench version。`,
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      presetId: z.enum(["h3", "sd2.5"]).optional(),
      params: z.record(z.unknown()).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      // 公共提示词层已下线（2026-11-05）：不做兼容——携带即按未知字段报错
      if ("prompt" in args) {
        throw new McpError("VALIDATION", "未知字段 prompt：公共提示词层已下线，重复内容请写入每段提示词（set_shot_prompt）");
      }
      const { projectId, baseVersion, dryRun, ...patch } = args;
      const res = await setSharedParams(dataRoot(), projectId, { baseVersion, dryRun, patch });
      return { written: res.written, version: res.after.version, sharedParams: res.after.sharedParams };
    },
  });

  defTool(server, ctx, {
    name: "set_shot_prompt",
    description:
      "更新导演台片段的双轨提示词（imagePrompt / videoPrompt），可同时改 description/shotType/duration。baseVersion = workbench version。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      shotId: z.string(),
      imagePrompt: z.string().optional(),
      videoPrompt: z.string().optional(),
      description: z.string().optional(),
      shotType: z.string().optional(),
      duration: z.number().positive().optional(),
      episodeId: z.string().optional().describe("所属剧集 id；不给 = 未分集"),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await setShotPrompt(dataRoot(), args.projectId, args);
      const shot = res.after.shots.find((s) => s.id === args.shotId);
      return { written: res.written, version: res.after.version, shot };
    },
  });

  defTool(server, ctx, {
    name: "add_segment",
    description: "导演台新增片段（id=seg-<ts>-<rand>，duration 默认 5s，status=pending）。baseVersion = workbench version，0=创建。episodeId 可选：指定则该片段归入该集（同集内从 1 编号），不给 = 未分集。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      description: z.string().min(1),
      shotType: z.string().optional(),
      duration: z.number().positive().optional(),
      episodeId: z.string().optional().describe("所属剧集 id；不给 = 未分集"),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await addSegment(dataRoot(), args.projectId, args);
      return { written: res.written, version: res.after.version, segment: res.segment };
    },
  });

  defTool(server, ctx, {
    name: "move_segments",
    description: "把已有片段移动到目标集（不重建、不复制）：可指定 beforeShotId 插到该片段之前，否则追加到目标集末尾。同集内自动重新编号。baseVersion = workbench version。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      shotIds: z.array(z.string()).min(1),
      toEpisodeId: z.string().describe("目标剧集 id；空字符串 = 未分集"),
      beforeShotId: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await mutateWorkbench(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
        mutate: (wb) => {
          const moved = wb.shots.filter((s) => args.shotIds.includes(s.id));
          if (moved.length !== args.shotIds.length) throw new McpError("NOT_FOUND", "有片段 id 不存在");
          const rest = wb.shots.filter((s) => !args.shotIds.includes(s.id));
          for (const s of moved) s.episodeId = args.toEpisodeId || undefined;
          const before = args.beforeShotId ? rest.findIndex((s) => s.id === args.beforeShotId) : -1;
          const insertAt = before >= 0
            ? before
            : (() => {
                const same = rest.filter((s) => (s.episodeId ?? "") === (args.toEpisodeId || "")).pop();
                return same ? rest.indexOf(same) + 1 : rest.length;
              })();
          rest.splice(insertAt, 0, ...moved);
          wb.shots = rest;
        },
      });
      return {
        written: res.written, version: res.after.version,
        moved: res.after.shots.filter((s) => args.shotIds.includes(s.id)).map((s) => ({ id: s.id, number: s.number, episodeId: s.episodeId })),
      };
    },
  });

  defTool(server, ctx, {
    name: "delete_segments",
    description: "从导演台删除指定片段（按 id，不会重建/复制），同时移除主轨 clips 并重新编号。baseVersion = workbench version；confirm:true 必填防误删。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      shotIds: z.array(z.string()).min(1),
      confirm: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.confirm) throw new McpError("CONFIRM_REQUIRED", "删除片段必须带 confirm:true");
      const res = await mutateWorkbench(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
        mutate: (wb) => {
          const before = wb.shots.length;
          wb.shots = wb.shots.filter((s) => !args.shotIds.includes(s.id));
          if (wb.shots.length === before) throw new McpError("NOT_FOUND", "没有匹配的片段");
        },
      });
      return { written: res.written, version: res.after.version, remaining: res.after.shots.length };
    },
  });
}
