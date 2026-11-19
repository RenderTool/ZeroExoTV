/**
 * shot-review — 分镜/提示词质检（0–10 分，<7 不许交付）
 *
 * 只做确定性可判的事，不做审美判断：
 *   1) 结构完整：imagePrompt / videoPrompt 非空、无占位词、视频五段式关键行齐
 *   2) 参考图可用：槽位有 storageKey，正文用 <Subject N> 指代，@PictureN 不悬空
 *   3) 规范清洁：不写外貌/服装/身材（2026-11-18 口径）、不写「三视图」、
 *      负面词不带范畴词、不堆 quality 形容词
 *   4) 帧预算：可见帧 ≤ 736（含 22 引导帧），不超 15s
 *   5) 镜头语言：单镜一个主运镜、动作有终点态
 *
 * 返回逐片段 issues + 总分；error 级 = 阻断（除非用户明确 override）。
 */

import type { WorkbenchContainer, WorkbenchShot } from "../store/workbench.js";
import type { StoryboardContainer } from "../store/storyboard.js";

export type ReviewLevel = "error" | "warn";

export interface ReviewIssue {
  code: string;
  level: ReviewLevel;
  message: string;
  fix?: string;
}

export interface ShotReview {
  shotId: string;
  number: number;
  score: number;
  pass: boolean;
  dimensions: Record<string, number>;
  issues: ReviewIssue[];
}

export interface ProjectReview {
  ok: boolean;
  score: number;
  blocking: number;
  shots: ShotReview[];
  projectIssues: ReviewIssue[];
}

const PASS_SCORE = 7;

/** 外貌/服装/身材描写（主体身份靠参考图锁，提示词只写行为） */
const APPEARANCE_RE =
  /外貌锁定|发型|脸型|鹅蛋脸|瓜子脸|五官|眉毛|睫毛|眼睛色|瞳色|唇形|嘴唇|胡须|肤色|皮肤|身材|头身比|三围|腰臀|长腿|胸围|衣着|穿着|服装样式/;
/** 占位词 */
const PLACEHOLDER_RE = /待补|按剧本|占位|TBD|待定|placeholder/i;
/** 镜头语言：运镜动词计数 */
const CAMERA_RE = /推镜|拉镜|摇镜|移镜|跟拍|升降|环绕|手持|变焦|甩镜/g;
/** 动作终点态 */
const END_STATE_RE = /停住|停手|抵住|贴上|靠在|落定|止步|定格|收势|until|stops?\b/i;
/** 范畴化负面词 */
const CATEGORY_NEG_RE = /no\s+(modern|ancient|old|new)\b|不要现代|不要古装|不要多余/gi;
/** 形容词汤（空泛质量词） */
const SOUP_RE = /氛围感|高级感|电影感拉满|极致|震撼|绝美|完美|超清|8K|masterpiece|best quality/gi;

function clip(text: string, n = 160): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function frameBudget(duration: number, contextFrames: number): number {
  const visible = Math.max(5, Math.round(Number(duration) * 24));
  const aligned = Math.round((visible + contextFrames) / 17) * 17 + 5;
  return Math.max(aligned, visible);
}

function reviewShot(
  shot: WorkbenchShot,
  contextFrames: number,
  subjectHasImage: (slotNo: number, title?: string) => boolean,
): ShotReview {
  const issues: ReviewIssue[] = [];
  const dims: Record<string, number> = {};
  const imagePrompt = String(shot.imagePrompt ?? "");
  const videoPrompt = String(shot.videoPrompt ?? "");
  const refs = Array.isArray(shot.references) ? shot.references : [];

  // 1) 结构完整（2 分）
  let structure = 2;
  if (!imagePrompt.trim()) {
    structure = 0;
    issues.push({ code: "PROMPT_EMPTY", level: "error", message: `片段 ${shot.number} 没有提示词`, fix: "先 apply_shot_prompts 或 set_shot_prompt 写入" });
  }
  if (PLACEHOLDER_RE.test(imagePrompt) || PLACEHOLDER_RE.test(videoPrompt)) {
    structure = Math.min(structure, 1);
    issues.push({ code: "PROMPT_PLACEHOLDER", level: "error", message: `片段 ${shot.number} 提示词里有占位词（待补/按剧本/占位）`, fix: "删掉占位词，写具体的空间/动作/终点态" });
  }
  if (imagePrompt.trim() && !/picture\s*\d|参考图|<Subject\s+\d+>/i.test(imagePrompt)) {
    issues.push({ code: "NO_ANCHOR_TAG", level: "warn", message: `片段 ${shot.number} 没有 @PictureN / <Subject N> 指代`, fix: "挂图后用 <Subject N> 指代，否则参考图会被忽略" });
  }
  dims.structure = structure;

  // 2) 参考图可用（2 分）
  let refs2 = 2;
  if (refs.length === 0) {
    refs2 = 1;
    issues.push({ code: "NO_REFS", level: "warn", message: `片段 ${shot.number} 未挂任何素材（纯文生视频风险高）`, fix: "挂场景/角色参考图，或明确说明用户接受纯文本生成" });
  }
  const slots = new Set(refs.map((r) => r.slotNo ?? 0));
  for (const m of imagePrompt.matchAll(/@Picture(\d+)/g)) {
    if (!slots.has(Number(m[1]))) {
      refs2 = 0;
      issues.push({ code: "ORPHAN_PICTURE", level: "error", message: `片段 ${shot.number} 引用了 @Picture${m[1]} 但没有对应槽位`, fix: "补齐槽位或改成实际存在的 @PictureN" });
    }
  }
  for (const r of refs) {
    const slot = r.slotNo ?? 0;
    if (slot <= 0) continue;
    if (!new RegExp(`<Subject\\s+${slot}>`).test(imagePrompt)) {
      refs2 = 0;
      issues.push({
        code: "SLOT_NOT_ANCHORED",
        level: "error",
        message: `片段 ${shot.number} 的 @Picture${slot}（${r.title ?? "未命名"}）正文没有 <Subject ${slot}> 指代，图会挂空`,
        fix: `在正文首次提到该素材时写 <Subject ${slot}> 名字`,
      });
    }
    if (!r.storageKey) {
      refs2 = 0;
      issues.push({ code: "SLOT_ASSET_MISSING", level: "error", message: `片段 ${shot.number} 槽位 ${slot} 没有 storageKey（图可能被删/回收）`, fix: "重新挂图或监听素材失效并补回" });
    } else if (!subjectHasImage(slot, r.title)) {
      issues.push({ code: "SUBJECT_NO_IMAGE", level: "error", message: `片段 ${shot.number} 引用的主体「${r.title ?? slot}」在主体库里没有图`, fix: "先补主体定妆图，再出片" });
    }
  }
  dims.refs = refs2;

  // 3) 规范清洁（2 分）
  let clean = 2;
  if (APPEARANCE_RE.test(imagePrompt)) {
    clean = 0;
    issues.push({
      code: "APPEARANCE_DESC",
      level: "error",
      message: `片段 ${shot.number} 写了外貌/服装描写（发型/脸/瞳色/身材/衣着）`,
      fix: "身份交给参考图锁；正文只写「谁 · 在哪 · 做什么」的行为句",
    });
  }
  if (/三视图|Lineup Sheet|四视图/i.test(imagePrompt)) {
    clean = Math.min(clean, 1);
    issues.push({ code: "VIEW_INDUCE", level: "warn", message: `片段 ${shot.number} 出现「三视图/Lineup」这类诱导词`, fix: "改写成「画面共 N 个：正面全身 / 背面全身 …」" });
  }
  if (CATEGORY_NEG_RE.test(String(shot.negativePrompt ?? ""))) {
    clean = Math.min(clean, 1);
    issues.push({ code: "NEG_CATEGORY", level: "warn", message: `片段 ${shot.number} 负面词用了范畴词`, fix: "只写本镜真实风险的实例（no wristwatch / no printed logo）" });
  }
  const soupHits = imagePrompt.match(SOUP_RE) ?? [];
  if (soupHits.length > 2) {
    clean = Math.min(clean, 1);
    issues.push({ code: "ADJ_SOUP", level: "warn", message: `片段 ${shot.number} 形容词汤过多（${soupHits.slice(0, 4).join("、")}）`, fix: "换成具体材质/光源/工艺描述" });
  }
  dims.clean = clean;

  // 4) 帧预算（2 分）
  let framesDim = 2;
  const budget = frameBudget(Number(shot.duration) || 0, contextFrames);
  if (budget > 736) {
    framesDim = 0;
    issues.push({ code: "FRAME_BUDGET", level: "error", message: `片段 ${shot.number} 采样 ${budget} 帧 > 736`, fix: "缩短可见时长或减小上下文帧（22 → 5）" });
  } else if ((Number(shot.duration) || 0) > 15) {
    framesDim = 1;
    issues.push({ code: "DURATION_LONG", level: "warn", message: `片段 ${shot.number} 可见 ${shot.duration}s > 15s`, fix: "拆段或压到 15s 内" });
  }
  dims.frames = framesDim;

  // 5) 镜头语言（2 分）
  let lens = 2;
  const cameras = new Set((imagePrompt.match(CAMERA_RE) ?? []));
  if (cameras.size > 1) {
    lens = Math.min(lens, 1);
    issues.push({ code: "MULTI_CAMERA", level: "warn", message: `片段 ${shot.number} 一镜里有多种运镜（${[...cameras].join("/")}）`, fix: "每镜只保留一个主运镜，「不运镜」也是合法选择" });
  }
  if (!END_STATE_RE.test(imagePrompt)) {
    lens = Math.min(lens, 1);
    issues.push({ code: "NO_END_STATE", level: "warn", message: `片段 ${shot.number} 动作没有终点态`, fix: "写成「转身直到侧脸贴上窗边，停住」这类可判定的终点" });
  }
  if (videoPrompt.trim() && !(/声音[:：]/.test(videoPrompt) && /无字幕/.test(videoPrompt))) {
    lens = Math.min(lens, 1);
    issues.push({ code: "VIDEO_FORMAT", level: "warn", message: `片段 ${shot.number} 视频提示词缺五段式关键行（「无字幕…」/「声音：」）`, fix: "按 shots-prompts 技能的五段式补齐" });
  }
  dims.lens = lens;

  const total = structure + refs2 + clean + framesDim + lens;
  return { shotId: shot.id, number: shot.number, score: total, pass: total >= PASS_SCORE && !issues.some((i) => i.level === "error"), dimensions: dims, issues };
}

export function reviewProject(
  wb: WorkbenchContainer | null,
  sb: StoryboardContainer | null,
  opts: { scriptHasEpisodes?: boolean } = {},
): ProjectReview {
  const projectIssues: ReviewIssue[] = [];
  if (!wb) projectIssues.push({ code: "NO_WORKBENCH", level: "error", message: "导演台不存在" });
  if (!sb) projectIssues.push({ code: "NO_STORYBOARD", level: "error", message: "主体库不存在" });
  if (opts.scriptHasEpisodes === false) {
    projectIssues.push({ code: "SCRIPT_NOT_READY", level: "error", message: "剧本未入库或没有任何剧集，不允许生成分镜/提示词" });
  }
  const contextFrames = Number(wb?.sharedParams?.params?.continuityOverlapFrames ?? 22) || 22;
  const entities = (sb?.entities ?? []) as Array<{ name?: string; images?: unknown[] }>;
  const subjectHasImage = (_slotNo: number, title?: string): boolean => {
    if (!title) return true;
    const ent = entities.find((e) => e?.name === title);
    if (!ent) return true; // 公共库/画布素材，不在主体库里也不算错
    return (ent.images ?? []).length > 0;
  };
  const shots = (wb?.shots ?? []).map((s) => reviewShot(s, contextFrames, subjectHasImage));
  const blocking = shots.reduce((n, s) => n + s.issues.filter((i) => i.level === "error").length, 0)
    + projectIssues.filter((i) => i.level === "error").length;
  const avg = shots.length ? shots.reduce((n, s) => n + s.score, 0) / shots.length : 0;
  return {
    ok: blocking === 0 && avg >= PASS_SCORE,
    score: Math.round(avg * 10) / 10,
    blocking,
    shots,
    projectIssues,
  };
}

export function reviewSummaryText(review: ProjectReview): string {
  const failed = review.shots.filter((s) => !s.pass);
  const lines = [
    `总分 ${review.score}/10（通过线 ${PASS_SCORE}），阻断 ${review.blocking} 条`,
    ...review.projectIssues.map((i) => `  [${i.level}] ${i.message}`),
    ...failed.slice(0, 12).map(
      (s) => `  片段 ${s.number}：${s.score}/10｜${clip(s.issues.map((i) => i.message).join("；"), 220)}`,
    ),
  ];
  if (failed.length > 12) lines.push(`  …其余 ${failed.length - 12} 个片段同样未过线`);
  return lines.join("\n");
}

export { PASS_SCORE };
