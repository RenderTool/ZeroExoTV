/**
 * script-readiness — 剧本定稿度 / 主体完善度检查（2026-11-19 用户要求升级为硬门禁）
 *
 * 只做能确定性判断的事：
 *   剧本：有无剧集、每集有无场次、场次有无正文（动作/对白）、占位词、空场次、极短集
 *   主体：被片段引用的主体有没有图；主体库里的主体有没有人设/图
 * 判定 ready=false 时，拆段 / 写提示词 / 出片都应被拦（用户明确认可可 userOverride）。
 */

import type { ScriptEntity } from "../store/script.js";
import type { StoryboardContainer } from "../store/storyboard.js";

export type ReadinessLevel = "error" | "warn";

export interface ReadinessIssue {
  code: string;
  level: ReadinessLevel;
  message: string;
  fix?: string;
}

export interface ScriptReadiness {
  ready: boolean;
  issues: ReadinessIssue[];
  stats: { episodes: number; scenes: number; emptyScenes: number; totalChars: number };
}

export interface SubjectReadiness {
  ready: boolean;
  issues: ReadinessIssue[];
  stats: { subjects: number; withImage: number; referencedWithoutImage: string[] };
}

const PLACEHOLDER_RE = /待定|待补|待写|TBD|TODO|XXX|占位|未定稿|\?\?\?/i;

function textOf(html: string): string {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** 场次标题判定：中文「场1 / 场景2 / 第3场」或 INT./EXT. */
function isSceneHeading(text: string): boolean {
  return /^(INT\.|EXT\.)/i.test(text)
    || /^第\s*\S+\s*场/.test(text)
    || /^(场|场景)\s*[0-9一二三四五六七八九十]+/.test(text);
}

/** 场次块：优先认 script-scene-heading；否则按行首「场N」文本兜底（import 可能把标题写成 script-action） */
function splitScenes(content: string): Array<{ heading: string; body: string }> {
  const scenes: Array<{ heading: string; body: string }> = [];
  for (const m of (content ?? "").matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const cls = m[1] ?? "";
    const text = textOf(m[2] ?? "");
    if (!text) continue;
    if (/script-scene-heading/i.test(cls) || isSceneHeading(text)) {
      if (!isSceneHeading(text)) continue;
      scenes.push({ heading: text, body: "" });
      continue;
    }
    const cur = scenes[scenes.length - 1];
    if (!cur) continue;
    if (/script-action|script-dialogue/i.test(cls)) cur.body += text;
  }
  return scenes;
}

export function checkScriptReadiness(script: ScriptEntity | null): ScriptReadiness {
  const issues: ReadinessIssue[] = [];
  const episodes = (script?.episodes ?? []) as Array<{ number?: number; content?: string; title?: string }>;
  let scenes = 0;
  let emptyScenes = 0;
  let totalChars = 0;

  if (!script) {
    issues.push({ code: "SCRIPT_MISSING", level: "error", message: "剧本不存在：先 create_project / import_script 落盘", fix: "先 import_script（userConfirmed:true）再拆分镜" });
    return { ready: false, issues, stats: { episodes: 0, scenes: 0, emptyScenes: 0, totalChars: 0 } };
  }
  if (episodes.length === 0) {
    issues.push({ code: "SCRIPT_NO_EPISODE", level: "error", message: "剧本没有任何剧集", fix: "先导入剧本正文" });
  }
  for (const ep of episodes) {
    const label = ep.number ? `第 ${ep.number} 集` : "某集";
    const plain = textOf(ep.content ?? "");
    if (!plain) {
      issues.push({ code: "EPISODE_EMPTY", level: "error", message: `${label} 没有正文`, fix: "补正文或删掉空集" });
      continue;
    }
    totalChars += plain.length;
    if (plain.length < 120) {
      issues.push({ code: "EPISODE_TOO_SHORT", level: "warn", message: `${label} 正文仅 ${plain.length} 字，可能还没定稿`, fix: "确认这集是完整定稿再拆分镜" });
    }
    if (PLACEHOLDER_RE.test(plain)) {
      issues.push({ code: "SCRIPT_PLACEHOLDER", level: "error", message: `${label} 正文含占位词（待定/待补/TBD/???）`, fix: "先把占位内容写实，再拆分镜" });
    }
    const epScenes = splitScenes(ep.content ?? "");
    scenes += epScenes.length;
    if (epScenes.length === 0) {
      issues.push({ code: "EPISODE_NO_SCENE", level: "error", message: `${label} 有正文但没有场次标题（INT./EXT. 或「第N场」）`, fix: "按标准场次格式重排后再拆分镜" });
    }
    for (const sc of epScenes) {
      if (sc.body.replace(/\s+/g, "").length < 8) {
        emptyScenes += 1;
        issues.push({ code: "SCENE_EMPTY", level: "error", message: `${label} 场次「${sc.heading}」没有动作/对白正文`, fix: "补这场戏的动作与对白，或删掉空场" });
      }
    }
  }
  const ready = !issues.some((i) => i.level === "error");
  return { ready, issues, stats: { episodes: episodes.length, scenes, emptyScenes, totalChars } };
}

export function checkSubjectReadiness(
  sb: StoryboardContainer | null,
  shots: Array<{ references?: Array<{ title?: string; storageKey?: string }> }> = [],
): SubjectReadiness {
  const issues: ReadinessIssue[] = [];
  const entities = ((sb?.entities ?? []) as unknown as Array<{ name?: string; images?: unknown[]; profile?: unknown }>);
  const byName = new Map<string, { name: string; images: number }>();
  for (const e of entities) {
    const name = String(e.name ?? "");
    if (!name) continue;
    byName.set(name, { name, images: (e.images ?? []).length });
  }
  const referenced = new Set<string>();
  for (const shot of shots) {
    for (const r of shot.references ?? []) {
      if (r.title) referenced.add(r.title);
    }
  }
  const referencedWithoutImage: string[] = [];
  for (const name of referenced) {
    const ent = byName.get(name);
    if (ent && ent.images === 0) referencedWithoutImage.push(name);
  }
  for (const name of referencedWithoutImage) {
    issues.push({
      code: "SUBJECT_NOT_READY",
      level: "error",
      message: `片段引用的主体「${name}」在主体库里没有图`,
      fix: "先 set_subject_image 挂定妆/场景图（read_asset → 反推 prompt），再写提示词/出片",
    });
  }
  const missingImages = entities.filter((e) => (e.images ?? []).length === 0).map((e) => String(e.name ?? ""));
  if (missingImages.length > 0) {
    issues.push({
      code: "SUBJECTS_INCOMPLETE",
      level: "warn",
      message: `主体库还有 ${missingImages.length} 个主体没有图：${missingImages.slice(0, 6).join("、")}${missingImages.length > 6 ? "…" : ""}`,
      fix: "按出镜顺序补图；不出镜的可以先放着",
    });
  }
  const ready = !issues.some((i) => i.level === "error");
  return {
    ready,
    issues,
    stats: { subjects: entities.length, withImage: entities.filter((e) => (e.images ?? []).length > 0).length, referencedWithoutImage },
  };
}
