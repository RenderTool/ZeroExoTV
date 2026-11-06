/** 剧本域：list_episodes / get_script / create_episode / normalize_script / import_script */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { createEpisode, importScript, readScript } from "../store/script.js";
import { normalizeScript } from "../lib/script-normalize.js";
import { defTool, diffSummary, guardDryRunConfirm, type Ctx } from "./_register.js";

export function registerScriptTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_episodes",
    description: "列出项目剧本的全部剧集（编号/标题/状态/片段数）。",
    bits: ["script.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) return { episodes: [], version: 0 };
      return {
        version: script.version,
        activeEpisodeId: script.activeEpisodeId,
        episodes: script.episodes.map((e) => ({
          id: e.id, number: e.number, title: e.title, status: e.status,
          segmentCount: e.segments?.length ?? 0,
        })),
      };
    },
  });

  defTool(server, ctx, {
    name: "get_script",
    description: "读取剧集全文（HTML content）与当前 version（后续写操作的 baseVersion 来源）。",
    bits: ["script.read"],
    schema: { projectId: z.string(), episodeId: z.string().optional() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const id = args.episodeId ?? script.activeEpisodeId;
      const ep = script.episodes.find((e) => e.id === id);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${id}`);
      return { version: script.version, episode: ep };
    },
  });

  defTool(server, ctx, {
    name: "create_episode",
    description: "新建剧集（number=max+1，标题缺省「第N集」）。写类：baseVersion 必填，0=剧本不存在时创建。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      title: z.string().optional(),
      content: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await createEpisode(dataRoot(), args.projectId, args);
      return { written: res.written, version: res.after.version, episode: res.episode };
    },
  });

  defTool(server, ctx, {
    name: "normalize_script",
    description: "剧本原文 → 标准格式文本 + 报告。不写入项目。推荐在导入前调用（非强制）。",
    bits: ["script.read"],
    schema: { content: z.string().min(1) },
    handler: async (args) => {
      const { normalized, report } = normalizeScript(args.content);
      return { normalized, report };
    },
  });

  defTool(server, ctx, {
    name: "import_script",
    description:
      "导入剧本。mode 必填：standard 标准剧本直接入库；raw 原文导入（允许，建议先 normalize_script 整理）。strategy 决定落点。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      content: z.string().min(1),
      mode: z.enum(["standard", "raw"]),
      strategy: z.enum(["new_episode", "append", "overwrite"]),
      episodeId: z.string().optional(),
      title: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      const res = await importScript(dataRoot(), args.projectId, {
        ...args,
        content: args.content,
        dryRun: args.dryRun === true,
      });
      const result = {
        written: res.written,
        mode: args.mode,
        version: res.after.version,
        backupPath: res.backupPath,
        episodeCount: res.after.episodes.length,
        diff: diffSummary(res.before?.episodes ?? [], res.after.episodes, "episodes"),
      };
      // raw = 允许入库；只给「优先规范化」建议，不报错、不算失败
      return args.mode === "raw"
        ? { ...result, hint: "原文已导入。建议下次先调 normalize_script 按规范整理。" }
        : result;
    },
  });
}
