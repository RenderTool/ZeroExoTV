/**
 * 项目进度总览（2026-11-19 用户口径）：
 * 每次进项目先读这一份，不要再让模型全局扫一遍文件才知道缺什么。
 * 明确返回：各阶段状态、缺什么、下一步动作、需要用户确认的点。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot, paths } from "../config.js";
import { readJsonIfExists } from "../store/fs-node.js";
import { readStoryboard } from "../store/storyboard.js";
import { readWorkbench } from "../store/workbench.js";
import { listClaims } from "../store/claims.js";
import { readProjectLog } from "../store/project-log.js";
import { defTool, type Ctx } from "./_register.js";

type StageStatus = "missing" | "partial" | "ready";

function stage(key: string, name: string, status: StageStatus, missing: string[], nextActions: string[]) {
  return { key, name, status, missing, nextActions };
}

export function registerProgressTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_project_progress",
    description:
      "项目进度总览（只读）：剧本/主体/主体图/分镜/分镜提示词/参数/生成任务各阶段是否就绪，" +
      "明确列出缺什么、下一步该做什么，以及需要问用户确认的点。" +
      "每次开始或继续一个项目先调用本工具，不要自己扫目录猜进度。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const root = dataRoot();
      const projectDir = path.join(root, "projects", args.projectId);
      const exists = await fs.stat(projectDir).then((s) => s.isDirectory(), () => false);
      if (!exists) return { projectId: args.projectId, exists: false, stages: [], nextActions: ["项目不存在"] };

      const scriptFile = paths.script(args.projectId, root);
      const script = await readJsonIfExists<{
        version?: number;
        title?: string;
        episodes?: Array<{ id: string; number: number; title?: string; content?: string; status?: string }>;
        meta?: { logline?: string; tags?: string[] };
      }>(scriptFile);
      const episodes = script?.episodes ?? [];
      const scriptMissing: string[] = [];
      if (!script) scriptMissing.push("剧本未导入");
      if (script && !script.meta?.logline) scriptMissing.push("缺本剧一句话概述（logline）");
      if (script && !(script.meta?.tags?.length)) scriptMissing.push("缺推荐标签（tags）");
      const scriptStage = stage(
        "script",
        "剧本",
        !script ? "missing" : scriptMissing.length ? "partial" : "ready",
        scriptMissing,
        !script
          ? ["先 preflight_import 再 import_script（userConfirmed:true）"]
          : scriptMissing.length
            ? ["set_script_meta 补齐 logline/tags"]
            : [],
      );

      const storyboard = await readStoryboard(root, args.projectId);
      const subjects = storyboard?.entities ?? [];
      const byKind = { character: 0, scene: 0, prop: 0 };
      const noImage: Array<{ id: string; name: string; kind: string }> = [];
      for (const s of subjects) {
        const k = s.kind as keyof typeof byKind;
        if (k in byKind) byKind[k] += 1;
        if (!(s.images ?? []).length) noImage.push({ id: s.id, name: s.name, kind: s.kind });
      }
      const subjectStage = stage(
        "subjects",
        "主体库",
        subjects.length === 0 ? "missing" : noImage.length ? "partial" : "ready",
        subjects.length === 0 ? ["主体库为空"] : noImage.map((x) => `${x.name}（${x.kind}）缺图`),
        subjects.length === 0
          ? ["先给主体清单让用户确认，再 upsert_subject + set_subject_profile"]
          : noImage.length
            ? ["缺图主体先补图：生成 2K 概念图/定妆三画面 → read_asset → set_subject_image"]
            : [],
      );

      const wb = await readWorkbench(root, args.projectId);
      const shots = wb?.shots ?? [];
      const perEpisode: Record<string, number> = {};
      for (const s of shots) {
        const ep = (s as { episodeId?: string }).episodeId ?? "未分集";
        perEpisode[ep] = (perEpisode[ep] ?? 0) + 1;
      }
      const noPrompt = shots.filter((s) => !((s as { imagePrompt?: string }).imagePrompt || (s as { videoPrompt?: string }).videoPrompt));
      const shotStage = stage(
        "shots",
        "分镜",
        shots.length === 0 ? "missing" : noPrompt.length ? "partial" : "ready",
        shots.length === 0 ? ["导演台没有片段"] : noPrompt.length ? [`${noPrompt.length} 个片段缺提示词`] : [],
        shots.length === 0
          ? ["用户确认拆段方案后 split_script_to_shots(confirm:true,userConfirmed:true)"]
          : noPrompt.length
            ? ["scaffold_episode 产出占位提示词 → apply_shot_prompts → review_shots ≥7 分"]
            : [],
      );

      const claims = (await listClaims()).filter((c) => c.projectId === args.projectId);
      const pending = claims.filter((c) => c.status === "pending").length;
      const failed = claims.filter((c) => c.status === "failed");
      const genStage = stage(
        "generation",
        "生成任务",
        claims.length === 0 ? "missing" : pending || failed.length ? "partial" : "ready",
        [
          pending ? `${pending} 个作业还在跑` : "",
          failed.length ? `${failed.length} 个作业失败：${failed.map((f) => f.jobId).join("、")}` : "",
        ].filter(Boolean),
        pending ? ["wait_generation_tasks 追到 pending=0，再核对画布落图"] : failed.length ? ["先分析失败原因，不要静默重试"] : [],
      );

      // 用户中途新增素材：扫项目资产目录，未被主体/任务引用的文件单独列出，提示主动询问用户意图
      const assetsDir = path.join(root, "assets", args.projectId);
      let userAdded: string[] = [];
      try {
        const files = await fs.readdir(assetsDir, { recursive: true });
        const referenced = new Set<string>();
        for (const s of subjects) for (const img of (s.images ?? [])) {
          if (typeof img.storageKey === "string") referenced.add(img.storageKey);
        }
        for (const c of claims) {
          if (c.result?.storageKey) referenced.add(c.result.storageKey);
          if (c.sourceStorageKey) referenced.add(c.sourceStorageKey);
        }
        userAdded = files.filter((f) => /\.(png|jpg|jpeg|webp|mp4|wav|mp3)$/i.test(f))
          .filter((f) => ![...referenced].some((k) => k.includes(path.basename(f, path.extname(f)))))
          .slice(0, 30);
      } catch { /* 目录不存在 */ }

      const log = await readProjectLog(root, args.projectId);
      const openRequirements = log.entries.filter((e) => e.kind === "requirement" && e.status === "open");
      const latestProgress = log.entries.filter((e) => e.kind === "progress").slice(-3).reverse();

      const stages = [scriptStage, subjectStage, shotStage, genStage];
      const nextActions = userAdded.length
        ? ["发现项目资产目录里有未关联的新文件，先问用户这些素材的用途（主体图/场景图/参考图/最终交付），不要自行归类"]
        : [];
      return {
        projectId: args.projectId,
        title: script?.title ?? null,
        exists: true,
        counts: {
          episodes: episodes.length,
          subjects: byKind,
          shots: shots.length,
          shotsPerEpisode: perEpisode,
          claims: claims.length,
        },
        stages,
        blockers: stages.filter((s) => s.status !== "ready").flatMap((s) => s.missing),
        nextActions: [...nextActions, ...stages.flatMap((s) => s.nextActions)],
        userAddedAssets: userAdded,
        projectLog: {
          version: log.version,
          updatedAt: log.updatedAt,
          openRequirements,
          latestProgress,
        },
        askUser: userAdded.length
          ? ["你在项目资产里新增了素材，想用作主体图、场景图还是参考图？要挂到哪个主体/片段？"]
          : [],
        scriptVersion: script?.version ?? null,
        storyboardVersion: storyboard?.version ?? null,
        workbenchVersion: wb?.version ?? null,
      };
    },
  });
}
