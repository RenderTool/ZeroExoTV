/** 全剧风格工具：读预设库、读当前全剧风格、选一套并统一改写主体提示词（2026-11-13） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot, paths } from "../config.js";
import { McpError } from "../errors.js";
import { readScript, type ScriptEntity, type ScriptVisualStyle } from "../store/script.js";
import { readStoryboard, type StoryboardContainer } from "../store/storyboard.js";
import { updateVersionedJson } from "../store/fs-node.js";
import { STYLE_PRESETS, stylePresetById, stylePresetPrompt } from "../lib/style-presets.js";
import { defTool, type Ctx } from "./_register.js";

/** 删旧风格行、末尾追加一行全剧风格（与前端 applyStylePromptToPrompt 保持一致） */
function applyStyle(prompt: string, stylePrompt: string): string {
  const body = (prompt ?? "").trim();
  if (!body || !stylePrompt.trim()) return body;
  const cleaned = body
    .replace(/^(风格|灯光|色彩|质感)：.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${cleaned}\n风格：${stylePrompt.trim()}`;
}

function summarizePreset() {
  return STYLE_PRESETS.map((p) => ({
    id: p.id,
    name: p.nameZh,
    nameEn: p.nameEn,
    category: p.category,
    prompt: stylePresetPrompt(p),
  }));
}

export function registerStyleTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_style_presets",
    description:
      "列出全剧风格预设库（39 套：9 导演 / 6 主流 / 8 动画 / 16 题材，含都市、基础写实、邵氏、经典港片），返回 id / 中文名 / 英文名 / 分类 / 风格片段。" +
      "风格是全剧设定：先把候选 id 报给用户选，再用 set_global_style 落盘。",
    bits: ["script.read"],
    schema: {},
    handler: async () => ({
      count: STYLE_PRESETS.length,
      categories: STYLE_PRESETS.reduce<Record<string, number>>((acc, p) => { acc[p.category] = (acc[p.category] ?? 0) + 1; return acc; }, {}),
      presets: summarizePreset(),
    }),
  });

  defTool(server, ctx, {
    name: "get_global_style",
    description:
      "读取当前项目的全剧风格（script.meta.visualStyle：presetId / name / prompt / image）。未设置时返回 null。" +
      "所有主体提示词都应继承这一套；主体提示词里不应各写一套风格。",
    bits: ["script.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      const visualStyle = script?.meta?.visualStyle ?? null;
      const preset = visualStyle ? stylePresetById(visualStyle.presetId) : null;
      return {
        exists: Boolean(script),
        visualStyle,
        preset: preset
          ? { id: preset.id, name: preset.nameZh, category: preset.category, prompt: stylePresetPrompt(preset) }
          : null,
      };
    },
  });

  defTool(server, ctx, {
    name: "analyze_script_style",
    description:
      "读剧本（可按集）做风格分析：题材关键词打分、对白/动作密度、场次节奏 → 推断题材，给 2–3 个风格候选"
      + "（含组合技）与「为什么/影响什么（构图·节奏·材质）」；有争议时明确要求先问用户。只读，不落盘。",
    bits: ["script.read"],
    schema: {
      projectId: z.string(),
      episodeId: z.string().optional().describe("只分析某一集；不传 = 全部已导入剧集"),
    },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const eps = args.episodeId
        ? script.episodes.filter((e) => e.id === args.episodeId)
        : script.episodes;
      if (eps.length === 0) throw new McpError("VALIDATION", "没有可分析的剧集");
      const html = eps.map((e) => e.content ?? "").join("\n");
      const plain = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      // 2026-11-19 修复：场次/动作原来在「去掉标签后的纯文本」上匹配 class 名，永远是 0。
      // 统计必须在原始 HTML 上做；中文剧本再兜底按「场N / 场景N」行首计数。
      const sceneCount = (html.match(/script-scene-heading/g) ?? []).length
        || (plain.match(/^\s*(场|场景)\s*[0-9一二三四五六七八九十]+/gm) ?? []).length
        || (plain.match(/(INT\.|EXT\.)/g) ?? []).length;
      const actionParas = (html.match(/script-action/g) ?? []).length;
      // 对白：带引号的台词 + 「角色：内容 / 角色（提示）：内容」行（中文剧本常态）
      const quotedDialogue = (plain.match(/[“"「][^”"」]{2,}[”"」]/g) ?? []).length;
      const colonDialogue = (plain.match(/^[^\s：:（）]{1,12}(?:（[^）]{0,12}）)?[：:]\s*\S+/gm) ?? []).length;
      const dialogueCount = quotedDialogue + colonDialogue;
      const chars = plain.replace(/\s+/g, "").length;

      const GENRE_RULES: Array<{ genre: string; cues: string[]; presets: string[] }> = [
        { genre: "科幻/末世", cues: ["机甲", "飞船", "废土", "赛博", "义体", "末世", "量子", "星舰", "末日", "基因", "变异"], presets: ["combo-sci-fi-3d-pbr", "sci-fi-apocalypse", "cyberpunk"] },
        { genre: "都市/犯罪悬疑", cues: ["警", "案", "监控", "审讯", "帮派", "黑", "电话", "酒吧", "暗杀", "证据", "悬疑"], presets: ["combo-real-film", "suspense-crime", "modern-urban"] },
        { genre: "古装/武侠", cues: ["客栈", "江湖", "门派", "剑", "王爷", "师父", "镖", "朝廷", "侠", "刀", "武林"], presets: ["combo-real-film", "costume-xianxia", "shaw-brothers"] },
        { genre: "恐怖/惊悚", cues: ["尸体", "血", "鬼", "惨叫", "漆黑", "阴森", "镜中", "失踪", "诅咒"], presets: ["film-noir", "suspense-crime"] },
        { genre: "合家欢/萌宠", cues: ["宠物", "孩子", "妈妈", "爸爸", "学校", "治愈", "可爱", "毛茸"], presets: ["combo-anime-pbr", "family-life", "pixar-3d-animation"] },
        { genre: "青春/甜宠", cues: ["校园", "同桌", "告白", "学长", "暗恋", "毕业", "操场"], presets: ["japanese-fresh", "campus", "sweet-romance"] },
      ];
      const scored = GENRE_RULES.map((g) => ({
        genre: g.genre,
        score: g.cues.reduce((n, c) => n + (plain.split(c).length - 1), 0),
        presets: g.presets,
      })).sort((a, b) => b.score - a.score);
      const top = scored.filter((s) => s.score > 0).slice(0, 2);
      const fallback = scored[0];

      const candidates = (top.length ? top.flatMap((t) => t.presets.slice(0, 2)) : fallback.presets)
        .slice(0, 3)
        .map((id) => stylePresetById(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({
          id: p.id,
          name: p.nameZh,
          category: p.category,
          prompt: stylePresetPrompt(p),
          why: `题材线索指向「${(top.find((t) => t.presets.includes(p.id))?.genre ?? fallback.genre)}」；这套预设已覆盖材质/光影/颗粒，可直接作为全剧口径`,
          impact: {
            composition: p.category === "combo" ? "按组合技的材质与光照体系重写构图参考，不套单一导演签名" : "按该风格代表作的构图语法重排机位",
            pacing: /noir|suspense|cyberpunk|sci-fi/.test(p.id) ? "镜头偏短、信息密，段长 5–8s" : "允许长镜与留白，段长 8–12s",
            material: p.category === "combo" ? "材质/反射/颗粒按组合技锁定" : "材质服从该风格的介质（胶片/赛璐璐/实拍）",
          },
        }));

      const ambiguous = top.length >= 2 && Math.abs(top[0].score - top[1].score) <= Math.max(2, top[0].score * 0.25);
      const question = ambiguous
        ? `剧本同时命中「${top[0].genre}」(${top[0].score}) 与「${top[1].genre}」(${top[1].score})，两者会改变构图/段长/材质。请用户从候选里选一套（或指定别的组合技），不要替用户拍板。`
        : `题材倾向「${(top[0] ?? fallback).genre}」，先给用户 2–3 个候选确认，再 set_global_style。`;

      return {
        projectId: args.projectId,
        episodeId: args.episodeId ?? null,
        analyzed: { episodes: eps.length, scenes: sceneCount, chars, dialogueCount, actionParas },
        inferredGenres: scored.filter((s) => s.score > 0).map(({ genre, score }) => ({ genre, score })),
        ambiguous,
        candidates,
        recommended: candidates[0]?.id ?? null,
        question,
        next: "先把 candidates 与 question 原样报给用户，用户选定后再 set_global_style（dryRun → userConfirmed + baseVersion）。",
      };
    },
  });

  defTool(server, ctx, {
    name: "set_global_style",
    description:
      "选一套全剧风格：写 script.meta.visualStyle，并把所有主体/状态提示词的风格块统一改写为这套片段" +
      "（删旧「风格/灯光/色彩/质感」行，末尾追加「风格：<片段>」；空提示词不动）。" +
      "会改多个文件：必须先把 presetId 报给用户确认，再带 userConfirmed:true 与 script 的 baseVersion 落盘；dryRun 可先预览。",
    bits: ["script.write", "subject.write"],
    schema: {
      projectId: z.string(),
      presetId: z.string().describe("来自 list_style_presets 的 id"),
      baseVersion: z.number().int().describe("script.json 当前 version；dryRun 可传 0"),
      userConfirmed: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const preset = stylePresetById(args.presetId);
      if (!preset) {
        throw new McpError("VALIDATION", `未知风格预设: ${args.presetId}。先调 list_style_presets 拿 id。`);
      }
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) throw new McpError("NOT_FOUND", `剧本不存在: ${args.projectId}`);
      const visualStyle: ScriptVisualStyle = {
        presetId: preset.id,
        name: preset.nameZh,
        prompt: stylePresetPrompt(preset),
        ...(preset.category === "genre" ? {} : { image: `style-presets/${preset.id}.webp` }),
      };
      const stylePrompt = visualStyle.prompt;
      if (args.dryRun) {
        return {
          dryRun: true,
          preset: { id: preset.id, name: preset.nameZh, category: preset.category },
          visualStyle,
          note: "未落盘。确认后带 userConfirmed:true + baseVersion 再调用。",
        };
      }
      if (!args.userConfirmed) {
        throw new McpError(
          "CONFIRM_REQUIRED",
          "设置全剧风格会改写所有主体/状态提示词的风格块。先把 presetId 与影响报给用户确认，再带 userConfirmed:true。",
        );
      }

      const written = await updateVersionedJson<ScriptEntity>(
        paths.script(args.projectId, dataRoot()),
        {
          baseVersion: args.baseVersion,
          mutate: (s) => {
            s.meta = { ...(s.meta ?? {}), visualStyle };
          },
        },
      );

      let synced = 0;
      let storyboardVersion: number | null = null;
      const sb = await readStoryboard(dataRoot(), args.projectId);
      if (sb) {
        const trees = (Array.isArray(sb.subjectTree) ? sb.subjectTree : []) as Array<{
          states?: Array<Record<string, unknown>>;
        }>;
        const nextTrees = trees.map((tr) => ({
          ...tr,
          states: (tr.states ?? []).map((st) => {
            const prompt = String(st.fullPrompt ?? st.deltaPrompt ?? "");
            if (!prompt.trim()) return st;
            const applied = applyStyle(prompt, stylePrompt);
            if (applied === prompt) return st;
            synced += 1;
            return { ...st, fullPrompt: applied, deltaPrompt: applied };
          }),
        }));
        if (synced > 0) {
          const sbRes = await updateVersionedJson<StoryboardContainer>(
            paths.storyboard(args.projectId, dataRoot()),
            { baseVersion: sb.version, mutate: (s) => { s.subjectTree = nextTrees; } },
          );
          storyboardVersion = sbRes.after.version;
        } else {
          storyboardVersion = sb.version;
        }
      }

      return {
        written: true,
        visualStyle,
        preset: { id: preset.id, name: preset.nameZh, category: preset.category },
        syncedPrompts: synced,
        restyleHint: "风格改变会影响构图/机位/镜头时长；现有片段提示词建议按新风格重写（set_shot_prompt），不要只追加风格行。",
        scriptVersion: written.after.version,
        storyboardVersion,
      };
    },
  });
}
