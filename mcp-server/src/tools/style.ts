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
