/** 主体域：list_subjects / upsert_subject / link_subject_to_shot */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { matchSubjectCandidates, readStoryboard, setSubjectImage, upsertSubject } from "../store/storyboard.js";
import { linkSubjectToShot } from "../store/workbench.js";
import { defTool, type Ctx } from "./_register.js";

export function registerSubjectTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_subjects",
    description: "列出主体库（角色/场景/道具 ProductionItem：名称、别名、状态图、关联剧集）。",
    bits: ["subject.read"],
    schema: {
      projectId: z.string(),
      kind: z.enum(["character", "scene", "prop"]).optional(),
    },
    handler: async (args) => {
      const sb = await readStoryboard(dataRoot(), args.projectId);
      if (!sb) return { version: 0, subjects: [] };
      const list = args.kind ? sb.entities.filter((e) => e.kind === args.kind) : sb.entities;
      return { version: sb.version, subjects: list };
    },
  });

  defTool(server, ctx, {
    name: "upsert_subject",
    description: "新建或更新主体（有 id 更新、无 id 新建 item-…）。写类：baseVersion 必填，0=主体库不存在时创建。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      id: z.string().optional(),
      name: z.string().min(1),
      kind: z.enum(["character", "scene", "prop"]),
      aliases: z.array(z.string()).optional(),
      note: z.string().optional(),
      episodeIds: z.array(z.string()).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const { projectId, baseVersion, dryRun, ...subject } = args;
      const res = await upsertSubject(dataRoot(), projectId, { baseVersion, subject, dryRun });
      return { written: res.written, created: res.created, version: res.after.version, subject: res.subject };
    },
  });

  defTool(server, ctx, {
    name: "set_subject_image",
    description:
      "给主体挂状态图（写 ProductionItem.images[] 与 coverKey）。storageKey 来自 upload_asset 返回的 'cas:<hash>.<ext>'；stateTag=状态名（如「定妆」「美艳态」「恶鬼态」）。幂等：同 storageKey 已存在则原地更新。baseVersion = storyboard version。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      subjectId: z.string(),
      storageKey: z.string().min(1),
      stateTag: z.string().optional(),
      prompt: z.string().optional(),
      note: z.string().optional(),
      cover: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const { projectId, baseVersion, dryRun, ...image } = args;
      const res = await setSubjectImage(dataRoot(), projectId, { baseVersion, image, dryRun });
      return {
        written: res.written,
        version: res.after.version,
        subjectId: res.subject.id,
        imageCount: res.subject.images.length,
        coverKey: res.subject.coverKey,
      };
    },
  });

  defTool(server, ctx, {
    name: "link_subject_to_shot",
    description:
      "把主体关联到导演台片段（写入 shot.references[]）。两种模式：matchByName 给出候选清单（不写盘）；或直接给 subjectId 直写（baseVersion = workbench version）。",
    bits: ["subject.write", "workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      shotId: z.string(),
      subjectId: z.string().optional(),
      matchByName: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const sb = await readStoryboard(dataRoot(), args.projectId);
      if (args.matchByName) {
        const candidates = sb ? matchSubjectCandidates(sb, args.matchByName) : [];
        return { written: false, candidates: candidates.map((c) => ({ id: c.id, name: c.name, kind: c.kind })) };
      }
      if (!args.subjectId) throw new McpError("VALIDATION", "必须提供 subjectId 或 matchByName");
      const subject = sb?.entities.find((e) => e.id === args.subjectId);
      if (!subject) throw new McpError("NOT_FOUND", `主体不存在: ${args.subjectId}`);
      const res = await linkSubjectToShot(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        shotId: args.shotId,
        subjectId: args.subjectId,
        subjectName: subject.name,
        dryRun: args.dryRun,
      });
      return { written: res.written, version: res.after.version, ref: res.ref };
    },
  });
}
