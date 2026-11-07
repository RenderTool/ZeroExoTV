/** 生产编排：从剧本+偏好产出占位主体与占位导演台；素材到位后重写提示词引用。 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readScript } from "../store/script.js";
import {
  addSegment,
  readWorkbench,
  setShotPrompt,
  setSharedParams,
  type WorkbenchShotReference,
} from "../store/workbench.js";
import { readStoryboard, upsertSubject, type ProductionItem } from "../store/storyboard.js";
import {
  composeImagePrompt,
  composeNegativePrompt,
  composeVideoPrompt,
  durationToFrames,
  sampledFrames,
  type PromptStyle,
  type PromptSubject,
} from "../lib/shot-prompt.js";

/** 片段采样帧预算（含延续锁定/烧帧/前瞻） */
function alignedBudget(visibleFrames: number, params: Record<string, unknown> | undefined): number {
  return sampledFrames(visibleFrames, {
    enabled: params?.continuityEnabled === true,
    overlapFrames: Number(params?.continuityOverlapFrames ?? 22) || 22,
  });
}
import { defTool, guardDryRunConfirm, type Ctx } from "./_register.js";

const StyleShape = {
  look: z.string().min(1).describe("画面风格口径，如「1970s 东亚古装电影实景质感，35mm 胶片」"),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).default("16:9"),
  /** 自然语言色名（主光/辅光/暗部/固有色）；不要 HEX，H3 不解析 */
  colors: z
    .object({
      key: z.string().optional(),
      fill: z.string().optional(),
      shadow: z.string().optional(),
      base: z.array(z.string()).optional(),
    })
    .optional(),
};

interface SceneBlock {
  heading: string;
  actions: string[];
  dialogues: string[];
  characters: string[];
}

/** 从剧本 HTML 里抽场次：标题 + 本场动作/台词/角色 */
function parseScenes(html: string): SceneBlock[] {
  const textOf = (s: string): string =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  const scenes: SceneBlock[] = [];
  for (const m of html.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const cls = m[1] ?? "";
    const text = textOf(m[2] ?? "");
    if (!text) continue;
    if (/script-scene-heading/i.test(cls)) {
      // 剧名/集标题也会被转成 scene-heading，只认真正的场次标题（INT./EXT. 或 第N场）
      if (!/^(INT\.|EXT\.)/i.test(text) && !/^第\s*\S+\s*场\s*[:：]/.test(text)) continue;
      scenes.push({ heading: text, actions: [], dialogues: [], characters: [] });
      continue;
    }
    const cur = scenes[scenes.length - 1];
    if (!cur) continue;
    if (/script-character/i.test(cls)) cur.characters.push(text);
    else if (/script-dialogue/i.test(cls)) cur.dialogues.push(text);
    else if (/script-action/i.test(cls)) cur.actions.push(text);
  }
  return scenes;
}

/** 「EXT. 莱州官道 - 夜」→ { name, place, time } */
function sceneMeta(heading: string): { name: string; place: "内" | "外"; time: string } {
  const isExt = /^EXT\./i.test(heading) || /(^|[·・\s])外([·・\s]|$)/.test(heading);
  const place: "内" | "外" = isExt ? "外" : "内";
  const time = /夜/.test(heading) ? "夜" : "日";
  const name = heading
    .replace(/^(INT\.|EXT\.)\s*/i, "")
    .replace(/^第\s*\S+\s*场\s*[:：]?\s*/, "")
    .replace(/\s*[·・]\s*(内|外)(\s*[·・]\s*(日|夜))?$/, "")
    .replace(/\s*-\s*(日|夜)$/, "")
    .trim();
  return { name: name || heading, place, time };
}

export function registerPlanTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "validate_project",
    description:
      "交付前自检：剧本块/标题泄漏、主体缺图、片段缺提示词或悬空 @PictureN、参数键、帧预算。返回 ok + errors + warnings，红的不许交付。",
    bits: ["project.read", "script.read", "subject.read", "workbench.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const root = dataRoot();
      const errors: string[] = [];
      const warnings: string[] = [];
      const script = await readScript(root, args.projectId);
      if (!script) errors.push("剧本不存在");
      const ep = script?.episodes.find((e) => e.id === script.activeEpisodeId) ?? script?.episodes[0];
      const html = ep?.content ?? "";
      const scenes = parseScenes(html);
      // 每集都查：有正文却没场次 = 错；空集（刚新建）= 警告，不阻断其它集
      let totalScenes = 0;
      for (const e of script?.episodes ?? []) {
        // 空段落（<p class="script-action"></p>）也算空集，别当成「有正文没场次」
        const plain = (e.content ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        if (!plain) {
          warnings.push(`第 ${e.number} 集为空（尚未导入正文）`);
          continue;
        }
        const n = parseScenes(e.content).length;
        totalScenes += n;
        if (n === 0) errors.push(`第 ${e.number} 集有正文但没有场次（script-scene-heading）`);
      }
      if (script && (script.episodes ?? []).length === 0) errors.push("剧本没有任何剧集");
      if (script?.title && html.includes(`>${script.title}<`)) warnings.push("剧名出现在正文里（应只放 ScriptEntity.title）");
      if (ep && /第\s*\S+\s*集[:：]/.test(ep.content) && ep.content.includes(`>${ep.title}<`))
        warnings.push("集名出现在正文里（应只放 Episode.title）");

      const sb = await readStoryboard(root, args.projectId);
      const missing = (sb?.entities ?? []).filter((e) => (e.images ?? []).length === 0);
      if (!sb) errors.push("主体库不存在");
      for (const m of missing) warnings.push(`主体缺图：${m.name}（${m.kind}）`);

      const wb = await readWorkbench(root, args.projectId);
      if (!wb) errors.push("导演台不存在");
      for (const shot of wb?.shots ?? []) {
        if (!(shot.imagePrompt ?? "").trim()) errors.push(`片段 ${shot.number} 没有提示词`);
        if ((shot.references ?? []).length === 0) warnings.push(`片段 ${shot.number} 未挂素材`);
        const refCount = (shot.references ?? []).length;
        // 槽号不保证从 1 连续（删过槽会留空号），按实际 slotNo 集合判悬空
        const slots = new Set((shot.references ?? []).map((r) => r.slotNo ?? 0));
        for (const m of (shot.imagePrompt ?? "").matchAll(/@Picture(\d+)/g)) {
          if (!slots.has(Number(m[1]))) {
            errors.push(`片段 ${shot.number} 引用了 @Picture${m[1]} 但没有对应槽位（悬空引用）`);
          }
        }
        const frames = durationToFrames(shot.duration);
        const budget = alignedBudget(frames, wb?.sharedParams?.params);
        if (budget > 736) errors.push(`片段 ${shot.number} 采样 ${budget} 帧 > 736`);
        if (frames > 362) warnings.push(`片段 ${shot.number} 可见 ${frames} 帧（>15s），质量不推荐`);
      }
      const params = wb?.sharedParams?.params ?? {};
      if (Object.keys(params).length < 20) errors.push("公共参数不完整（<20 键），set_shared_params 重写");
      if (params.steps === undefined) errors.push("缺 steps");
      return {
        ok: errors.length === 0,
        errors,
        warnings,
        stats: {
          episodes: script?.episodes.length ?? 0,
          scenes: totalScenes,
          subjects: sb?.entities.length ?? 0,
          missingSubjectImages: missing.length,
          shots: wb?.shots.length ?? 0,
          shotsWithPrompt: (wb?.shots ?? []).filter((s) => (s.imagePrompt ?? "").trim()).length,
          shotsWithRefs: (wb?.shots ?? []).filter((s) => (s.references ?? []).length > 0).length,
        },
      };
    },
  });

  defTool(server, ctx, {
    name: "scaffold_episode",
    description:
      "从已入库剧本 + 用户偏好，产出占位主体（无图）与占位导演台片段（一场一段，提示词按引擎槽位约定生成），并返回缺哪些资产。素材到位后用 apply_shot_prompts 重写引用。",
    bits: ["subject.write", "workbench.write", "script.read"],
    schema: {
      projectId: z.string(),
      episodeId: z.string().optional(),
      style: z.object(StyleShape),
      durationSec: z.number().positive().max(30).default(5),
      /** 段间引导（H3 延续）：开启后第 2 段起按引擎的锁定帧/燃烧帧预算写接缝 */
      continuation: z
        .object({
          enabled: z.boolean().default(false),
          overlapFrames: z.number().int().min(5).max(56).default(22),
        })
        .optional(),
      sharedParams: z.record(z.unknown()).optional(),
      presetId: z.enum(["h3", "sd2.5"]).optional(),
      baseVersion: z.number().int().min(0).optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      const root = dataRoot();
      const script = await readScript(root, args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const ep = script.episodes.find((e) => e.id === (args.episodeId ?? script.activeEpisodeId));
      if (!ep) throw new McpError("NOT_FOUND", "episode 不存在");

      const scenes = parseScenes(ep.content);
      if (scenes.length === 0) {
        throw new McpError("VALIDATION", "剧本没有场景标题（script-scene-heading），先按标准剧本整理");
      }

      const style: PromptStyle = { ...args.style };
      const wanted = new Map<string, { kind: "scene" | "character"; name: string }>();
      for (const sc of scenes) {
        const meta = sceneMeta(sc.heading);
        wanted.set(`scene:${meta.name}`, { kind: "scene", name: meta.name });
      }
      for (const sc of scenes) {
        for (const c of sc.characters) wanted.set(`character:${c}`, { kind: "character", name: c });
      }

      const existing = await readStoryboard(root, args.projectId);
      const byName = new Map<string, ProductionItem>();
      for (const e of existing?.entities ?? []) byName.set(`${e.kind}:${e.name}`, e);

      if (args.dryRun) {
        return {
          written: false,
          scenes: scenes.map((s) => sceneMeta(s.heading)),
          placeholderSubjects: [...wanted.values()],
          missingAssets: [...wanted.values()].map((v) => ({
            ...v,
            needs: v.kind === "scene" ? "场景宫格图（4:3，2×2，空场景）" : "角色定妆图（16:9，左特写+右三视图）",
          })),
          note: "confirm:true 才写盘；写盘后图片由画布生成或外部制作，再 upload_asset + set_subject_image 挂上",
        };
      }

      let sbVersion = existing?.version ?? 0;
      const created: Array<{ id: string; name: string; kind: string }> = [];
      for (const item of wanted.values()) {
        if (byName.get(`${item.kind}:${item.name}`)) continue;
        const up = await upsertSubject(root, args.projectId, {
          baseVersion: sbVersion,
          subject: { name: item.name, kind: item.kind, aliases: [], note: "" },
        });
        sbVersion = up.after.version;
        created.push({ id: up.subject.id, name: up.subject.name, kind: up.subject.kind });
      }

      const wb = await readWorkbench(root, args.projectId);
      let wbVersion = wb?.version ?? args.baseVersion ?? 0;
      // 导演台首次创建时自带一个空占位段：优先复用它，别多出一段空片段
      const isEmptyShot = (s: { imagePrompt?: string; videoPrompt?: string }): boolean =>
        !(s.imagePrompt ?? "").trim() && !(s.videoPrompt ?? "").trim();
      const shotIds: string[] = [];
      if (wb && wb.shots.length === 1 && isEmptyShot(wb.shots[0]!)) {
        shotIds.push(wb.shots[0]!.id);
      } else if (scenes.length > 1) {
        // 还没有导演台：先建一段（会连带空占位段），两段分别给场景 1/2
        const seed = await addSegment(root, args.projectId, {
          baseVersion: wbVersion,
          description: scenes[1]!.heading,
          duration: args.durationSec,
        });
        wbVersion = seed.after.version;
        const after = await readWorkbench(root, args.projectId);
        const first = after?.shots.find((s) => isEmptyShot(s));
        if (first) shotIds.push(first.id);
        shotIds.push(seed.segment.id);
      }

      let shotCount = 0;
      for (const [i, sc] of scenes.entries()) {
        const meta = sceneMeta(sc.heading);
        const chars = [...new Set(sc.characters)];
        const subjects: PromptSubject[] = [
          { name: meta.name, kind: "scene", slot: 1 },
          ...chars.map((c, j) => ({ name: c, kind: "character" as const, slot: j + 2 })),
        ];
        let shotId = shotIds[i];
        if (!shotId) {
          const add = await addSegment(root, args.projectId, {
            baseVersion: wbVersion,
            description: sc.heading,
            duration: args.durationSec,
          });
          wbVersion = add.after.version;
          shotId = add.segment.id;
          shotIds[i] = shotId;
        }
        const cont = {
          enabled: (args.continuation?.enabled ?? false) && i > 0,
          overlapFrames: args.continuation?.overlapFrames ?? 22,
        };
        const prevScene = scenes[i - 1];
        const previousTail = prevScene ? prevScene.actions[prevScene.actions.length - 1] : undefined;
        const set = await setShotPrompt(root, args.projectId, {
          baseVersion: wbVersion,
          shotId,
          description: sc.heading,
          duration: args.durationSec,
          imagePrompt: composeImagePrompt({
            index: i,
            number: i + 1,
            durationSec: args.durationSec,
            scene: meta,
            action: sc.actions.join(" ") || meta.name,
            subjects,
            style,
            dialogue: sc.dialogues[0],
            assetsBound: false,
            continuation: cont,
            previousTail,
          }),
          videoPrompt: composeVideoPrompt({
            index: i,
            number: i + 1,
            durationSec: args.durationSec,
            scene: meta,
            action: sc.actions.join(" ") || meta.name,
            subjects,
            style,
            assetsBound: false,
            continuation: cont,
            previousTail,
          }),
          negativePrompt: composeNegativePrompt(),
          shotType: "video",
          // 记住原文动作与场次元信息：素材到位重写提示词时不能拿「场次标题」当动作
          paramValues: {
            action: sc.actions.join(" ") || meta.name,
            sceneName: meta.name,
            place: meta.place,
            time: meta.time,
          },
        });
        wbVersion = set.after.version;
        shotCount += 1;
      }

      if (args.sharedParams) {
        const res = await setSharedParams(root, args.projectId, {
          baseVersion: wbVersion,
          patch: { presetId: args.presetId, params: args.sharedParams },
        });
        wbVersion = res.after.version;
      }

      const finalSb = await readStoryboard(root, args.projectId);
      const missingAssets = (finalSb?.entities ?? [])
        .filter((e) => (e.images ?? []).length === 0)
        .map((e) => ({
          id: e.id,
          name: e.name,
          kind: e.kind,
          needs: e.kind === "scene" ? "场景宫格图（4:3，2×2，空场景）" : "角色定妆图（16:9，左特写+右三视图）",
        }));

      return {
        written: true,
        projectId: args.projectId,
        createdSubjects: created,
        createdShots: shotCount,
        missingAssets,
        nextSteps: [
          "缺图主体：用户自己出图后导入，或用画布图像节点生成再落成主体状态图",
          "挂图：upload_asset(refId=subject-state:<主体id>/<状态>) → set_subject_image",
          "挂图后执行 apply_shot_prompts：把 <Subject N> 重写成 @PictureN 并绑定真实槽位",
        ],
      };
    },
  });

  defTool(server, ctx, {
    name: "apply_shot_prompts",
    description:
      "按当前片段 references 与主体库重写 imagePrompt/videoPrompt（引用写成 @PictureN，N = references 槽位序号）。素材变化后调用。",
    bits: ["workbench.write", "subject.read"],
    schema: {
      projectId: z.string(),
      style: z.object(StyleShape),
      shotIds: z.array(z.string()).optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      const root = dataRoot();
      const wb = await readWorkbench(root, args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", "导演台不存在");
      const sb = await readStoryboard(root, args.projectId);
      const subjectsById = new Map((sb?.entities ?? []).map((e) => [e.id, e]));
      const subjectsByName = new Map((sb?.entities ?? []).map((e) => [e.name, e]));

      let version = wb.version;
      const out: Array<{ shotId: string; number: number; refs: number; imagePrompt: string }> = [];
      const continuityOn = wb.sharedParams?.params?.continuityEnabled === true;
      for (const [shotIndex, shot] of wb.shots.entries()) {
        if (args.shotIds && !args.shotIds.includes(shot.id)) continue;
        const refs = [...shot.references].sort((a, b) => (a.slotNo ?? 0) - (b.slotNo ?? 0));
        const subjectOf = (r: WorkbenchShotReference): ProductionItem | undefined =>
          (r.origin?.rootId ? subjectsById.get(r.origin.rootId) : undefined) ??
          subjectsByName.get(r.title ?? "");
        const promptSubjects: PromptSubject[] = refs.map((r) => {
          const subj = subjectOf(r);
          return {
            name: subj?.name ?? r.title ?? "素材",
            kind: (subj?.kind as PromptSubject["kind"]) ?? "character",
            slot: r.slotNo ?? 1,
            state: r.origin?.state,
            anchor: subj?.note,
          };
        });
        const pv = (shot.paramValues ?? {}) as { action?: string; sceneName?: string; place?: "内" | "外"; time?: string };
        const sceneSubject = refs.map(subjectOf).find((s) => s?.kind === "scene");
        const meta: { name: string; place: "内" | "外"; time: string } =
          pv.sceneName
            ? { name: pv.sceneName, place: pv.place ?? "内", time: pv.time ?? "夜" }
            : /^(INT\.|EXT\.)/i.test(shot.description ?? "")
              ? sceneMeta(shot.description)
              : { name: sceneSubject?.name ?? (shot.description || "场景"), place: "内", time: "夜" };
        const input = {
          index: shotIndex,
          number: shot.number,
          durationSec: shot.duration,
          scene: meta,
          action: pv.action ?? (shot.description || meta.name),
          subjects: promptSubjects,
          style: { ...args.style } as PromptStyle,
          assetsBound: refs.length > 0,
          continuation: {
            enabled: continuityOn && shotIndex > 0 && shot.continuation?.enabled !== false,
            overlapFrames: Number(wb.sharedParams?.params?.continuityOverlapFrames ?? 22) || 22,
          },
          previousTail: wb.shots[shotIndex - 1]?.description,
        };
        const imagePrompt = composeImagePrompt(input);
        const videoPrompt = composeVideoPrompt(input);
        if (!args.dryRun) {
          const res = await setShotPrompt(root, args.projectId, {
            baseVersion: version,
            shotId: shot.id,
            imagePrompt,
            videoPrompt,
          });
          version = res.after.version;
        }
        out.push({ shotId: shot.id, number: shot.number, refs: refs.length, imagePrompt });
      }
      return { written: !args.dryRun, shots: out.length, version, samples: out.slice(0, 2) };
    },
  });
}
