/**
 * 延续法（H3 段间衔接）计划器 —— 2026-11-11 用户强烈反馈后加
 *
 * 事故：别的 Agent 拿到剧本后，把 30 段按原稿段长直接塞进导演台，既没按 17k+5 重排段长，
 * 也没设计「第 2 段起用上一段尾帧当首帧」，生成时还跳段跑。用户视角这是灾难：看起来「导进去了」，
 * 实际上完全不是可交付的片子，而且外行客户根本看不出问题。
 *
 * 所以把延续法从「散文要求」变成**可计算、可检查、可拒绝**的东西：
 * - 段长必须吸附到 17k+5 帧（引擎按 17 帧块组织 latent，5 是收尾余量）；
 * - 每段可见帧 + 22 帧引导 ≤ 736 帧预算（超过就是 frame-overflow）；
 * - 第 2 段起必须吃上一段的尾帧（22 帧锁定），生成必须按时间线顺序、串行；
 * - 计划写进 shot.paramValues.continuityPlan，run_generation 只认带计划标记的片段。
 */

/** 生成帧率（与前端 shared params 一致） */
export const GEN_FPS = 24;
/** 段间引导固定吃 22 帧尾帧（用户口径：22 帧锁定） */
export const CONTEXT_FRAMES = 22;
/** 单次生成帧预算：align(可见 + 引导) ≤ 736 */
export const MAX_FRAMES_BUDGET = 736;
/** 最大的可见帧（17k+5 且 +22 ≤ 736） */
export const MAX_VISIBLE_FRAMES = 702;
/** 默认每秒朗读/动作字数（中文），仅用于把「只有文本没有时长」的源段折算成秒 */
const CHARS_PER_SECOND = 4.5;

export interface ContinuitySourceSegment {
  /** 对应已有片段 id（可选；不传则按顺序匹配现有 shots） */
  id?: string;
  /** 该段文本（描述/提示词），用于估算时长与给出可读计划 */
  text?: string;
  /** 用户明确给的秒数（会吸附到 17k+5） */
  durationSec?: number;
}

export interface ContinuityPlanSegment {
  index: number;
  sourceId?: string;
  /** 来源摘要（前 40 字），让用户确认这段到底是哪一段 */
  excerpt: string;
  /** 计划使用的可见帧数（17k+5） */
  frames: number;
  /** 计划时长（秒，frames / 24） */
  durationSec: number;
  /** 第 2 段起 = true：用上一段尾帧当首帧 */
  guideFromPrev: boolean;
  /** 引导帧数（第 2 段起固定 22） */
  guideFrames: number;
}

export interface ContinuityPlan {
  ctxFrames: number;
  maxFrames: number;
  segments: ContinuityPlanSegment[];
  totalFrames: number;
  totalSec: number;
  warnings: string[];
}

/**
 * 秒数 → 可见帧：与前端/引擎同口径（fps=24，向上吸附到最近的 17k+5）。
 * 注意不能直接用 store/director-params 的 durationToFrames（那里 fps 默认 17，语义不同）。
 */
export function snapVisibleFrames(seconds: number): number {
  const f = Math.max(1, Math.round(seconds * GEN_FPS));
  return f + ((((5 - f) % 17) + 17) % 17);
}

/** 把秒数吸附到 17k+5 帧，并夹到预算内 */
export function alignVisibleFrames(seconds: number): number {
  const frames = snapVisibleFrames(seconds);
  return Math.min(MAX_VISIBLE_FRAMES, Math.max(5, frames));
}

/** 由文本估算时长（只在源段没有明确秒数时使用，结果仍需用户确认） */
export function estimateSecondsFromText(text: string | undefined): number {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return 5;
  const chars = [...clean].length;
  const estimated = chars / CHARS_PER_SECOND;
  return Math.min(MAX_VISIBLE_FRAMES / GEN_FPS, Math.max(2, estimated));
}

/**
 * 生成延续法计划（纯函数，不读盘不写盘）。
 * 段数 = 源段数；每段 durationSec = frames/GEN_FPS（frames 已吸附 17k+5）。
 */
export function planContinuitySegments(
  sources: ContinuitySourceSegment[],
  opts: { ctxFrames?: number; maxFrames?: number } = {},
): ContinuityPlan {
  const ctxFrames = opts.ctxFrames && opts.ctxFrames > 0 ? Math.round(opts.ctxFrames) : CONTEXT_FRAMES;
  const maxFrames = opts.maxFrames && opts.maxFrames > 0 ? Math.round(opts.maxFrames) : MAX_FRAMES_BUDGET;
  const visibleCap = maxFrames - ctxFrames;
  const warnings: string[] = [];
  const segments = sources.map((src, index) => {
    const rawSeconds = typeof src.durationSec === "number" && src.durationSec > 0
      ? src.durationSec
      : estimateSecondsFromText(src.text);
    // 先按 17k+5 吸附，再对预算做压回（压回也保持 17k+5，否则引擎块对不齐）
    let frames = snapVisibleFrames(rawSeconds);
    if (frames > visibleCap) {
      frames = Math.max(5, Math.floor((visibleCap - 5) / 17) * 17 + 5);
      warnings.push(`第 ${index + 1} 段超出预算（可见帧上限 ${visibleCap}），已压到 ${frames} 帧`);
    }
    frames = Math.max(5, frames);
    const excerpt = (src.text ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    return {
      index,
      sourceId: src.id,
      excerpt,
      frames,
      durationSec: Number((frames / GEN_FPS).toFixed(3)),
      guideFromPrev: index > 0,
      guideFrames: index > 0 ? ctxFrames : 0,
    };
  });

  // 段长必须彼此「接缝」：每段可见帧是 17k+5，相邻段的重叠由引导帧负责，
  // 这里只核算总量与预算，不擅自改用户给定的段数。
  const totalFrames = segments.reduce((sum, s) => sum + s.frames, 0);
  const totalSec = Number((totalFrames / GEN_FPS).toFixed(3));
  if (segments.length === 0) warnings.push("没有任何片段：延续法计划为空");
  if (segments.length > 0 && !segments.some((s) => s.guideFromPrev)) {
    warnings.push("只有 1 段：延续法没有可衔接的下一条，需要至少 2 段才有意义");
  }
  return { ctxFrames, maxFrames, segments, totalFrames, totalSec, warnings };
}

/** 计划是否已覆盖全部片段（run_generation 的准入检查用） */
export function hasContinuityPlan(shot: { paramValues?: Record<string, unknown> | null }): boolean {
  const plan = shot.paramValues?.continuityPlan as { planId?: string } | undefined;
  return typeof plan?.planId === "string" && plan.planId.length > 0;
}
