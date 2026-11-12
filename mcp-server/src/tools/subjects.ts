/** 主体域：list_subjects / upsert_subject / link_subject_to_shot */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { auditSubjects, deleteSubject, deleteSubjectImage, matchSubjectCandidates, mergeSubjects, readStoryboard, repairSubjectTrees, setSubjectImage, syncSubjectEpisodes, upsertSubject } from "../store/storyboard.js";
import { linkSubjectToShot } from "../store/workbench.js";
import { readScript } from "../store/script.js";
import { defTool, type Ctx } from "./_register.js";

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** 主体在剧本里出现过的集（按名字/别名匹配；空数组 = 剧本里没出现） */
async function episodesAppearingIn(root: string, projectId: string, names: string[]): Promise<Array<{ id: string; number: number; title: string }>> {
  const script = await readScript(root, projectId).catch(() => null);
  if (!script) return [];
  const needles = names.map((n) => n.trim()).filter((n) => n.length >= 1);
  if (needles.length === 0) return [];
  return script.episodes
    .map((ep) => {
      const text = stripHtml(ep.content ?? "");
      const hit = needles.some((n) => text.includes(n));
      return hit ? { id: ep.id, number: ep.number, title: ep.title } : null;
    })
    .filter((v): v is { id: string; number: number; title: string } => v !== null);
}


function normalizeSubjectName(raw: string): string {
  return raw
    .trim()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .replace(/(状态|形态|时期)$/i, "")
    .toLowerCase();
}


export function registerSubjectTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_subjects",
    description: "列出主体库（角色/场景/道具 ProductionItem：名称、别名、状态图、关联剧集）。",
    bits: ["subject.read"],
    schema: {
      projectId: z.string(),
      kind: z.enum(["character", "scene", "prop", "candidate"]).optional(),
    },
    handler: async (args) => {
      const sb = await readStoryboard(dataRoot(), args.projectId);
      if (!sb) return { version: 0, subjects: [] };
      const list = args.kind ? sb.entities.filter((e) => e.kind === args.kind) : sb.entities;
      const trees = (Array.isArray(sb.subjectTree) ? sb.subjectTree : []) as Array<{
        itemId?: string | null;
        states?: Array<{ media?: Array<{ key: string }> }>;
      }>;
      const byTree = new Map(trees.map((t) => [t.itemId, t]));
      return {
        version: sb.version,
        subjects: list.map((e) => {
          const tree = byTree.get(e.id);
          const keys = new Set((tree?.states ?? []).flatMap((st) => (st.media ?? []).map((m) => m.key)));
          return {
            ...e,
            stateCount: tree?.states?.length ?? 0,
            imagesMapped: e.images.filter((i) => keys.has(i.storageKey)).length,
          };
        }),
      };
    },
  });

  defTool(server, ctx, {
    name: "audit_subjects",
    description:
      "只读自检主体库：主体是否缺树、图是否没映射进状态（页面不显示）、基础状态是否没图、空主体、同名重复。" +
      "写主体后建议先跑它；有 images_not_in_tree / missing_tree 就调用 repair_subject_trees。",
    bits: ["subject.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const audit = await auditSubjects(dataRoot(), args.projectId);
      return audit;
    },
  });

  defTool(server, ctx, {
    name: "repair_subject_trees",
    description:
      "修复主体树：补齐缺失的树、把 entity.images 按 stateTag 映射进基础状态/对应状态（幂等，不删数据、不动已有提示词）。" +
      "写类：先 dryRun 看 mediaFixed/statesCreated，再 userConfirmed:true 落盘。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.userConfirmed) {
        throw new McpError("CONFIRM_REQUIRED", "修复主体树必须 userConfirmed:true（先 dryRun 看会补多少）");
      }
      const res = await repairSubjectTrees(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
      });
      return {
        written: res.written,
        version: res.after.version,
        mediaFixed: res.mediaFixed,
        statesCreated: res.statesCreated,
        treesCreated: res.treesCreated,
      };
    },
  });

  defTool(server, ctx, {
    name: "sync_subject_episodes",
    description:
      "把主体的集数关联同步到主体树：entity.episodeIds ↔ 基础状态 appearEpisodes（页面「出现集数」读的就是它）。" +
      "空关联会按名字/别名在剧本里重新匹配。写类：先 dryRun 看 synced/appeared，再 userConfirmed:true。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      subjectId: z.string().optional(),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.userConfirmed) {
        throw new McpError("CONFIRM_REQUIRED", "同步集数必须 userConfirmed:true（先 dryRun 看影响范围）");
      }
      const res = await syncSubjectEpisodes(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        subjectId: args.subjectId,
        dryRun: args.dryRun,
      });
      return { written: res.written, version: res.after.version, synced: res.synced, appeared: res.appeared };
    },
  });

  defTool(server, ctx, {
    name: "upsert_subject",
    description:
      "新建或更新主体（有 id 更新、无 id 新建 item-…）。写类：baseVersion 必填，0=主体库不存在时创建。" +
      "新建时若未给 episodeIds，会**按名字/别名在剧本里自动关联出现过的集**（避免所有主演默认挂全部集）。" +
      "**同一演员的不同状态/形态禁止新建主体**：同名/同别名会报 SUBJECT_EXISTS，请用 set_subject_image(stateTag=…) 挂到现有主体。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      id: z.string().optional(),
      name: z.string().min(1),
      kind: z.enum(["character", "scene", "prop", "candidate"]),
      aliases: z.array(z.string()).optional(),
      note: z.string().optional(),
      episodeIds: z.array(z.string()).optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const { projectId, baseVersion, dryRun, ...subject } = args;
      let autoEpisodes: Array<{ id: string; number: number; title: string }> | null = null;
      const isCreate = !args.id;
      if (isCreate) {
        // 同一演员不同形态被弱模型新建成第二个主体：同名/同别名直接拒绝，要求挂状态
        const sb = await readStoryboard(dataRoot(), projectId);
        const target = normalizeSubjectName(args.name);
        const dup = sb?.entities.find((e) => {
          if (e.kind !== args.kind) return false;
          return [e.name, ...(e.aliases ?? [])].some((n) => normalizeSubjectName(n) === target);
        });
        if (dup) {
          throw new McpError(
            "VALIDATION",
            `主体「${dup.name}」已存在（id=${dup.id}）。同一演员的不同状态/形态不要新建主体：` +
              `请用 set_subject_image({ subjectId: "${dup.id}", storageKey, stateTag: "美艳态" }) 挂到该主体；` +
              "新建主体只用于不同角色/场景/道具。",
          );
        }
      }
      if (isCreate && args.episodeIds === undefined) {
        autoEpisodes = await episodesAppearingIn(dataRoot(), projectId, [args.name, ...(args.aliases ?? [])]);
        if (autoEpisodes.length > 0) {
          subject.episodeIds = autoEpisodes.map((ep) => ep.id);
        }
      }
      const res = await upsertSubject(dataRoot(), projectId, { baseVersion, subject, dryRun });
      return {
        written: res.written,
        created: res.created,
        version: res.after.version,
        subject: res.subject,
        ...(autoEpisodes
          ? {
              autoEpisodes: autoEpisodes.map((ep) => `第 ${ep.number} 集${ep.title ? ` · ${ep.title}` : ""}`),
              autoEpisodeHint: autoEpisodes.length > 0
                ? "已按剧本出现自动关联集数"
                : "剧本里没找到这个名字：episodeIds 为空（页面会显示为全部集），请在页面上手动选择出现集数",
            }
          : {}),
      };
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
    name: "delete_subject",
    description:
      "删除主体（连同主体树状态）。破坏性写：先 dryRun 给用户看，真实删除必须 userConfirmed:true。只删主体库，不级联删画布/导演台引用。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      subjectId: z.string(),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.userConfirmed) {
        throw new McpError("CONFIRM_REQUIRED", "删除主体必须 userConfirmed:true（先 dryRun 把要删的主体报给用户确认）");
      }
      const res = await deleteSubject(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        subjectId: args.subjectId,
        dryRun: args.dryRun,
      });
      return { written: res.written, deleted: res.deleted, version: res.after.version, subject: res.subject };
    },
  });

  defTool(server, ctx, {
    name: "delete_subject_image",
    description:
      "删除主体的某张状态图（同步清理主体树 media）。破坏性写：需 userConfirmed:true；cover 被删会自动回落下一张。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      subjectId: z.string(),
      storageKey: z.string().min(1),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.userConfirmed) {
        throw new McpError("CONFIRM_REQUIRED", "删除状态图必须 userConfirmed:true（先 dryRun 给用户确认）");
      }
      const res = await deleteSubjectImage(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        subjectId: args.subjectId,
        storageKey: args.storageKey,
        dryRun: args.dryRun,
      });
      return { written: res.written, deleted: res.deleted, version: res.after.version, imageCount: res.subject?.images.length };
    },
  });

  defTool(server, ctx, {
    name: "merge_subjects",
    description:
      "把重复主体并回本体：图片/别名/集数并入 target，状态并进 target 树，然后删除 source。破坏性写：需 userConfirmed:true；先 dryRun 核对数量。",
    bits: ["subject.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      sourceId: z.string(),
      targetId: z.string(),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (!args.dryRun && !args.userConfirmed) {
        throw new McpError("CONFIRM_REQUIRED", "合并主体必须 userConfirmed:true（先 dryRun 确认 source/target 与移动数量）");
      }
      const res = await mergeSubjects(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        sourceId: args.sourceId,
        targetId: args.targetId,
        dryRun: args.dryRun,
      });
      return { written: res.written, merged: res.merged, movedImages: res.movedImages, movedStates: res.movedStates, version: res.after.version };
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
      /** 指定主体的状态图（stateTag，如「美艳」「恶鬼」）；缺省用封面图 */
      state: z.string().optional(),
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
        subject: {
          id: subject.id,
          name: subject.name,
          images: subject.images ?? [],
          coverKey: subject.coverKey,
        },
        state: args.state,
        dryRun: args.dryRun,
      });
      return { written: res.written, version: res.after.version, ref: res.ref };
    },
  });
}
