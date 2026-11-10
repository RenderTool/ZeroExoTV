/**
 * 导入预检（2026-11-10 弱模型事故后加）
 *
 * 事故复盘：豆包这类弱 Agent 拿到一份英文的旧平台源数据，没问集数、没导主体资产，
 * 直接按自己的理解写剧本 + 拆导演台，用户的数据被按别人的格式重排。
 *
 * 对策不是再写一段散文，而是给 Agent 一个「必须先过」的机器检查：
 * preflight_import 读项目现状 + 源文本，返回语言判定、分集标记、主体是否就绪、
 * 以及必须逐条问用户的问题清单；真正的写工具（import_script / split_script_to_shots）
 * 在 userConfirmed 不为 true 时直接 CONFIRM_REQUIRED，逼它回去问人。
 */

export interface EpisodeMarkerHit {
  pattern: string;
  count: number;
  samples: string[];
}

export interface SourceAnalysis {
  /** 语言判定：zh 中文为主 / en 英文为主 / mixed 混排 / unknown 没有正文 */
  language: "zh" | "en" | "mixed" | "unknown";
  charCount: number;
  lineCount: number;
  cjkRatio: number;
  latinRatio: number;
  /** 英文或外部平台特征明显：CJK 占比极低但有大量拉丁字母 */
  foreignLikely: boolean;
  /** 分集标记：第N集 / EP01 / Episode 3 / S01E02 */
  episodeMarkers: EpisodeMarkerHit[];
  /** 按标记推断的集数（没有标记则 null，不能瞎猜 1 集） */
  detectedEpisodeCount: number | null;
  /** 是否像剧本正文（场次/台词/动作关键词），用于阻止把说明文字当剧本导入 */
  looksLikeScript: boolean;
}

const EPISODE_PATTERNS: Array<{ pattern: string; re: RegExp }> = [
  { pattern: "第N集", re: /第\s*[0-9一二三四五六七八九十百]+\s*[集话]/g },
  { pattern: "EPn", re: /\bEP\s*\d{1,4}\b/gi },
  { pattern: "Episode n", re: /\bEpisode\s+\d{1,4}\b/gi },
  { pattern: "SxxExx", re: /\bS\d{1,2}\s*E\d{1,3}\b/gi },
  { pattern: "第n章", re: /第\s*[0-9一二三四五六七八九十百]+\s*章/g },
];

const SCRIPT_HINTS_ZH = ["场景", "场次", "内景", "外景", "台词", "对白", "动作", "旁白", "画外音", "镜头"];
const SCRIPT_HINTS_EN = ["scene", "int.", "ext.", "dialogue", "narration", "action", "cut to", "voiceover"];

/** 纯函数：分析一段原文，判断语言、分集标记、是否像剧本 */
export function analyzeSource(text: string): SourceAnalysis {
  const raw = text ?? "";
  const cjk = (raw.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (raw.match(/[A-Za-z]/g) ?? []).length;
  const letters = cjk + latin;
  const cjkRatio = letters > 0 ? cjk / letters : 0;
  const latinRatio = letters > 0 ? latin / letters : 0;
  const lines = raw.split(/\r?\n/);
  const lower = raw.toLowerCase();

  let language: SourceAnalysis["language"] = "unknown";
  if (letters >= 20) {
    if (cjkRatio >= 0.55) language = "zh";
    else if (latinRatio >= 0.75) language = "en";
    else language = "mixed";
  }

  const episodeMarkers: EpisodeMarkerHit[] = [];
  let detected: number | null = null;
  for (const { pattern, re } of EPISODE_PATTERNS) {
    const hits = raw.match(re) ?? [];
    if (hits.length > 0) {
      episodeMarkers.push({ pattern, count: hits.length, samples: [...new Set(hits.map((h) => h.trim()))].slice(0, 5) });
      // 取「集数」类标记的最大编号作为推断集数（章不算集）
      if (pattern !== "第n章") {
        for (const hit of hits) {
          const num = hit.match(/\d{1,4}/)?.[0];
          if (num) detected = Math.max(detected ?? 0, Number(num));
        }
        if (detected === null) detected = Math.max(detected ?? 0, hits.length);
      }
    }
  }

  const looksLikeScript = SCRIPT_HINTS_ZH.some((w) => raw.includes(w))
    || SCRIPT_HINTS_EN.some((w) => lower.includes(w));

  return {
    language,
    charCount: raw.length,
    lineCount: lines.length,
    cjkRatio: Number(cjkRatio.toFixed(3)),
    latinRatio: Number(latinRatio.toFixed(3)),
    foreignLikely: language === "en" && raw.length >= 200,
    episodeMarkers,
    detectedEpisodeCount: detected,
    looksLikeScript,
  };
}

export interface PreflightLibraryState {
  episodes: number;
  subjects: number;
  subjectImages: number;
  shots: number;
}

export interface PreflightQuestion {
  key: "sourceFormat" | "episodeCount" | "subjects" | "directorImpact";
  question: string;
}

export interface PreflightResult {
  /** 预检从不写盘，永远 false；Agent 必须先把 questions 问完 */
  canWrite: false;
  blockers: Array<"foreign_source" | "episode_plan_unconfirmed" | "subjects_missing" | "director_conflict">;
  questions: PreflightQuestion[];
  analysis: SourceAnalysis;
  library: PreflightLibraryState;
  next: string;
}

/** 纯函数：把项目现状 + 源分析拼成「必须问用户的问题」 */
export function buildPreflight(input: {
  projectTitle: string;
  analysis: SourceAnalysis;
  library: PreflightLibraryState;
}): PreflightResult {
  const { analysis, library } = input;
  const blockers: PreflightResult["blockers"] = [];
  const questions: PreflightQuestion[] = [];

  if (analysis.foreignLikely) {
    blockers.push("foreign_source");
    questions.push({
      key: "sourceFormat",
      question: `原文看起来是英文/外部平台格式（${analysis.lineCount} 行、中文占比 ${(analysis.cjkRatio * 100).toFixed(0)}%），`
        + "要按 ZeroExo 的「场次 + 动作 + 台词」规范重排，还是保持原文？",
    });
  }

  blockers.push("episode_plan_unconfirmed");
  const markerText = analysis.episodeMarkers.length > 0
    ? `原文检测到 ${analysis.episodeMarkers.map((m) => `${m.pattern}×${m.count}`).join("、")}`
    : "原文里没有可靠的分集标记";
  questions.push({
    key: "episodeCount",
    question: `这次要导入成多少集？${markerText}`
      + `${analysis.detectedEpisodeCount ? `（按编号最多到第 ${analysis.detectedEpisodeCount} 集）` : ""}。`
      + "是按标记拆集、全部放一集，还是你另有集数方案？",
  });

  if (library.subjects === 0) {
    blockers.push("subjects_missing");
    questions.push({
      key: "subjects",
      question: "这个项目的主体库还是空的。要不要先把角色/场景/道具和它们的定妆图导进主体库，再落到剧本？",
    });
  } else {
    questions.push({
      key: "subjects",
      question: `主体库现有 ${library.subjects} 个主体 / ${library.subjectImages} 张状态图：这次导入需要新增主体或换图吗，还是沿用现有？`,
    });
  }

  if (library.shots > 0) {
    blockers.push("director_conflict");
    questions.push({
      key: "directorImpact",
      question: `导演台已有 ${library.shots} 个片段。这次导入/重新拆分要保留它们、追加，还是重建？`,
    });
  }

  return {
    canWrite: false,
    blockers,
    questions,
    analysis,
    library,
    next: "把 questions 逐条问用户并等答复；得到答复后再调写工具，并带 userConfirmed:true"
      + (analysis.foreignLikely ? "（英文/外部平台原文还需 sourceFormatConfirmed:true）" : ""),
  };
}
