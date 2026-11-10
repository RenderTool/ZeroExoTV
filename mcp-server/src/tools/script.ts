/** 剧本域：list_episodes / get_script / create_episode / normalize_script / import_script */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import {
  createEpisode, importScript, listScriptBlocks, mergeEpisodeIntoPrev, patchEpisodeBlocks,
  readScript, setEpisodeMeta, setScriptMeta, updateEpisode, SCRIPT_BLOCK_KINDS,
} from "../store/script.js";
import { normalizeScript } from "../lib/script-normalize.js";
import { analyzeSource } from "../lib/preflight.js";
import { defTool, diffSummary, guardDryRunConfirm, guardForeignSource, guardUserConfirmed, type Ctx } from "./_register.js";

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
          meta: e.meta ?? null,
        })),
      };
    },
  });

  defTool(server, ctx, {
    name: "get_script",
    description: "读取剧集全文（HTML content）、可编辑块列表 blocks（index/kind/text）与当前 version（后续写操作的 baseVersion 来源）。",
    bits: ["script.read"],
    schema: { projectId: z.string(), episodeId: z.string().optional() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const id = args.episodeId ?? script.activeEpisodeId;
      const ep = script.episodes.find((e) => e.id === id);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${id}`);
      return { version: script.version, meta: script.meta ?? null, blocks: listScriptBlocks(ep.content ?? ""), episode: ep };
    },
  });

  defTool(server, ctx, {
    name: "set_script_meta",
    description:
      "写「本剧信息」（整部剧一句话概述 logline / 推荐标签 tags），剧本页资产抽屉「本剧信息」分组展示。合并语义：只覆盖传入字段。baseVersion = script.json 当前 version。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      logline: z.string().max(300).optional(),
      tags: z.array(z.string().min(1)).max(20).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const { projectId, baseVersion, dryRun, ...meta } = args;
      if (Object.keys(meta).length === 0) {
        throw new McpError("VALIDATION", "至少提供 logline / tags 之一");
      }
      const res = await setScriptMeta(dataRoot(), projectId, { baseVersion, meta, dryRun });
      return {
        written: res.written,
        // dryRun 时 version = 当前磁盘版本（可直接用作 confirm 的 baseVersion）
        version: dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        meta: res.after.meta ?? null,
      };
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
      return {
        written: res.written,
        version: args.dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        episode: res.episode,
      };
    },
  });

  defTool(server, ctx, {
    name: "update_episode",
    description:
      "编辑已有剧集：改标题 title / 整体替换正文 content（追加请用 import_script append）/ 改状态 status。不改变编号与顺序。baseVersion = script.json 当前 version。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      episodeId: z.string(),
      title: z.string().min(1).optional(),
      content: z.string().optional(),
      status: z.enum(["draft", "ready", "done"]).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (args.title === undefined && args.content === undefined && args.status === undefined) {
        throw new McpError("VALIDATION", "至少提供 title / content / status 之一");
      }
      const res = await updateEpisode(dataRoot(), args.projectId, args);
      return {
        written: res.written,
        version: args.dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        episode: res.episode,
      };
    },
  });

  defTool(server, ctx, {
    name: "patch_episode",
    description:
      "局部改剧本正文：按块下标 append / insert / replace / delete，只传要改的块，不用回传整篇 HTML（一次调用一次写盘）。下标 = get_script 返回的 blocks[].index；多个 op 按顺序执行。baseVersion = script.json 当前 version。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      episodeId: z.string(),
      ops: z.array(z.discriminatedUnion("op", [
        z.object({
          op: z.literal("append"),
          blocks: z.array(z.object({ kind: z.enum(SCRIPT_BLOCK_KINDS), text: z.string() })).min(1),
        }),
        z.object({
          op: z.literal("insert"),
          index: z.number().int().min(0),
          blocks: z.array(z.object({ kind: z.enum(SCRIPT_BLOCK_KINDS), text: z.string() })).min(1),
        }),
        z.object({
          op: z.literal("replace"),
          index: z.number().int().min(0),
          blocks: z.array(z.object({ kind: z.enum(SCRIPT_BLOCK_KINDS), text: z.string() })).min(1),
        }),
        z.object({
          op: z.literal("delete"),
          index: z.number().int().min(0),
          count: z.number().int().min(1).optional(),
        }),
      ])).min(1),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await patchEpisodeBlocks(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        episodeId: args.episodeId,
        ops: args.ops,
        dryRun: args.dryRun,
      });
      return {
        written: res.written,
        version: args.dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        changedBlocks: res.blocks.length,
        blocks: res.blocks,
        content: res.episode.content,
      };
    },
  });

  defTool(server, ctx, {
    name: "merge_episode",
    description:
      "合并到上一集：当前集正文拼到上一集尾部 → 删除当前集 → 其余集编号重排 1..N，activeEpisodeId 指向上一集。与前端「⋮ → 合并到上一集」同一语义。baseVersion = script.json 当前 version。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      episodeId: z.string(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await mergeEpisodeIntoPrev(dataRoot(), args.projectId, args);
      return {
        written: res.written,
        version: args.dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        mergedInto: res.mergedInto,
        episodes: res.after.episodes.map((e) => ({ id: e.id, number: e.number, title: e.title })),
      };
    },
  });

  defTool(server, ctx, {
    name: "set_episode_meta",
    description:
      "写本集信息卡（一句话介绍 logline / 推荐标签 tags / 发布建议 publishNote）。合并语义：只覆盖传入字段（tags 整体替换）。baseVersion = script.json 当前 version；episodeId 缺省 = activeEpisodeId。",
    bits: ["script.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      episodeId: z.string().optional(),
      logline: z.string().max(300).optional(),
      tags: z.array(z.string().min(1)).max(20).optional(),
      publishNote: z.string().max(1000).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const { projectId, baseVersion, episodeId, dryRun, ...meta } = args;
      if (Object.keys(meta).length === 0) {
        throw new McpError("VALIDATION", "至少提供 logline / tags / publishNote 之一");
      }
      const res = await setEpisodeMeta(dataRoot(), projectId, { baseVersion, episodeId, meta, dryRun });
      return {
        written: res.written,
        version: dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
        episode: res.episode,
      };
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
      /** 用户已逐条回答 preflight_import 的问题（集数/来源格式/主体）——真实写入必须 true */
      userConfirmed: z.boolean().optional()
        .describe("用户已回答预检问题（集数/来源格式/主体）。真实写入必须 true；dryRun 不需要"),
      /** 英文/外部平台原文，用户已确认按 ZeroExo 规范重排 */
      sourceFormatConfirmed: z.boolean().optional()
        .describe("英文或外部平台原文：用户已确认按 ZeroExo「场次+动作+台词」规范重排"),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      if (args.dryRun !== true) {
        guardUserConfirmed(args, "导入剧本会新建/覆盖剧集");
        guardForeignSource(analyzeSource(args.content), args);
      }
      const res = await importScript(dataRoot(), args.projectId, {
        ...args,
        content: args.content,
        dryRun: args.dryRun === true,
      });
      const result = {
        written: res.written,
        mode: args.mode,
        // dryRun 时 version = 当前磁盘版本（可直接用作 confirm 的 baseVersion）
        version: args.dryRun ? (res.before?.version ?? 0) : res.after.version,
        nextVersion: res.after.version,
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
