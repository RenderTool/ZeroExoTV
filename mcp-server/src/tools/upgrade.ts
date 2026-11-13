/** 升级自查工具：get_upgrade_guide / audit_upgrade（2026-11-13） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { readScript } from "../store/script.js";
import { readStoryboard } from "../store/storyboard.js";
import { readWorkbench } from "../store/workbench.js";
import { auditProjectData, UPGRADE_GUIDE } from "../lib/upgrade-audit.js";
import { buildMinimalSubjectPrompt } from "../lib/subject-profile.js";
import { updateVersionedJson } from "../store/fs-node.js";
import { paths } from "../config.js";
import { setSubjectProfile } from "../store/storyboard.js";
import type { ScriptEntity } from "../store/script.js";
import { defTool, type Ctx } from "./_register.js";


/** 从第一集正文提炼一句简介（去掉 HTML，取前 80 字） */
function deriveLogline(script: ScriptEntity): string {
  const first = script.episodes?.[0]?.content ?? "";
  const text = String(first).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function registerUpgradeTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_upgrade_guide",
    description:
      "读「升级/连上后的查漏补缺」说明：为什么旧项目可能不合当前流程、应先跑 audit_upgrade、怎么把结果报给用户并询问是否修复。",
    bits: [],
    schema: {},
    handler: async () => ({
      guide: UPGRADE_GUIDE,
      checks: [
        "GLOBAL_STYLE_UNSET：全剧风格未设置",
        "SUBJECT_PROMPT_EMPTY：主体基础状态没有提示词",
        "PROMPT_PLACEHOLDER：提示词仍有旧占位话术",
        "SUBJECT_IMAGE_NO_PROMPT：主体图没有反推提示词",
        "SHOT_EPISODE_UNASSIGNED：导演台片段没有分集",
        "SHOT_EPISODE_UNKNOWN：片段指向已删除的集",
        "SHOT_PROMPT_EMPTY：片段提示词为空",
      ],
    }),
  });

  defTool(server, ctx, {
    name: "audit_upgrade",
    description:
      "升级后只读自查：按当前流程检查旧项目可能留下的洞（全剧风格未设、主体无提示词/图无 prompt、" +
      "导演台片段未分集、提示词为空、指向已删集）。返回 findings（严重度/证据/修复工具）与 summary。" +
      "**只读**；先把结果报给用户并问是否修复，不要擅自批量改。",
    bits: ["script.read", "subject.read", "workbench.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) return { ok: false, error: "NOT_FOUND", message: `项目没有剧本: ${args.projectId}` };
      const storyboard = await readStoryboard(dataRoot(), args.projectId);
      const workbench = await readWorkbench(dataRoot(), args.projectId);
      const result = auditProjectData({ script, storyboard, workbench });
      return {
        ...result,
        nextAction: result.ok
          ? "无需修补；可以继续当前流程。"
          : "把 findings 逐条报给用户（旧流程漏了什么 → 现在会怎样 → 用哪个工具修），询问是否现在修复；不要擅自改动。",
      };
    },
  });

  defTool(server, ctx, {
    name: "ensure_project_ready",
    description:
      "交付前自愈：给还没有提示词的主体补一条最小可用提示词、给没写简介的剧本补一句（从第一集正文提炼），" +
      "并汇报还缺什么（主体没图 / 片段没提示词）。**只补缺，不覆盖已有内容**；默认直接生效，dryRun 可先看。" +
      "Agent 在说「完成 / 可以出片」之前必须先调一次，把 repaired/remaining 用大白话告诉用户。",
    bits: ["script.write", "subject.write"],
    schema: { projectId: z.string(), dryRun: z.boolean().optional() },
    handler: async (args) => {
      const script = await readScript(dataRoot(), args.projectId);
      if (!script) return { ok: false, error: "NOT_FOUND", message: `项目没有剧本: ${args.projectId}` };
      const stylePrompt = script.meta?.visualStyle?.prompt;
      const sb = await readStoryboard(dataRoot(), args.projectId);
      const entities = (sb?.entities ?? []) as Array<{ id?: string; name?: string; kind?: string; note?: string }>;
      const trees = (Array.isArray(sb?.subjectTree) ? sb.subjectTree : []) as Array<{
        itemId?: string; rootId?: string; states?: Array<{ fullPrompt?: string; media?: unknown[] }>;
      }>;
      const promptMissing = entities.filter((e) => {
        if (!e.id) return false;
        const tree = trees.find((t) => t.itemId === e.id || t.rootId === e.id);
        return !String(tree?.states?.[0]?.fullPrompt ?? "").trim();
      });
      const noImage = trees.filter((t) => !(t.states?.[0]?.media ?? []).length);
      const shotMissing = ((await readWorkbench(dataRoot(), args.projectId))?.shots ?? [])
        .filter((s) => !String(s.imagePrompt ?? "").trim() || !String(s.videoPrompt ?? "").trim()).length;
      const needsLogline = !String(script.meta?.logline ?? "").trim();
      const derivedLogline = needsLogline ? deriveLogline(script) : "";
      if (args.dryRun) {
        return {
          dryRun: true,
          willFillSubjectPrompts: promptMissing.map((e) => e.name),
          willFillLogline: Boolean(derivedLogline),
          remaining: { subjectsWithoutImage: noImage.length, shotsWithoutPrompt: shotMissing },
        };
      }
      const repaired: string[] = [];
      for (const e of promptMissing) {
        try {
          const fresh = await readStoryboard(dataRoot(), args.projectId);
          if (!fresh) break;
          const prompt = buildMinimalSubjectPrompt(
            (e.kind as "character" | "scene" | "prop" | "candidate") ?? "character",
            e.name ?? "未命名主体",
            e.note,
            stylePrompt,
          );
          await setSubjectProfile(dataRoot(), args.projectId, {
            baseVersion: fresh.version,
            subjectId: e.id!,
            anchor: e.note ?? "",
            prompt,
          });
          repaired.push(`「${e.name ?? "未命名主体"}」补了提示词`);
        } catch { /* 单个失败继续 */ }
      }
      if (derivedLogline) {
        try {
          const freshScript = await readScript(dataRoot(), args.projectId);
          if (freshScript) {
            await updateVersionedJson<ScriptEntity>(paths.script(args.projectId, dataRoot()), {
              baseVersion: freshScript.version,
              mutate: (s) => { if (!s.meta?.logline) s.meta = { ...(s.meta ?? {}), logline: derivedLogline }; },
            });
            repaired.push("补了本剧一句话简介");
          }
        } catch { /* 忽略 */ }
      }
      return {
        repaired,
        remaining: {
          subjectsWithoutImage: noImage.length,
          shotsWithoutPrompt: shotMissing,
        },
        summary: repaired.length > 0
          ? `已自动补 ${repaired.length} 项；还有 ${noImage.length} 个主体没图、${shotMissing} 段没写提示词。`
          : `没有需要自动补的；还有 ${noImage.length} 个主体没图、${shotMissing} 段没写提示词。`,
        nextAction: "把 summary 用大白话告诉用户；remaining 里缺图/缺提示词的部分问用户要不要现在补，不要提字段名或错误码。",
      };
    },
  });

}
