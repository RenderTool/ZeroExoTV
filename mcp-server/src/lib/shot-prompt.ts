/**
 * 片段提示词装配器——按 MiniMax H3 官方 Ref2VA 体例 + 本仓库引擎机制生成。
 *
 * 体例依据（templates/shot-output.md，官方 base-en.txt 的落地版）：
 *   subject_definitions:  <Subject N> 是…，取自 @图片N（图注）：锁什么
 *   detailed_description: 风格句 + [Shot N] 景别/运镜/空间调度/颜色/声音
 *   overall_soundscape:   环境声 + 全段闭唇兜底句
 *   non_diegetic_music:   无叙事性音乐
 *
 * 硬规则（都在模板里写死过，这里照做）：
 * - 正文不写任何视频参数（帧数/采样/可见帧/画幅数值）——那些是节点参数，不是提示词；
 * - 正文不写上下文调度词（承上/上一段落幅/段末交接）——延续由引擎按 22 帧锁定实现；
 * - 不写 HEX 色值（H3 不解析），只写自然语言色名；
 * - 禁用 `|`，分隔用 `；`；禁用英文双引号；
 * - 无对白段必须点名入画角色「双唇紧闭」。
 *
 * 引擎侧依据：engine/pack.py 参考图按槽位落成 Picture1..N（所以是 @PictureN）；
 * engine/frame_align.py 17k+5；engine/segment_continuity.py lock 22 + settling 12 + lookahead 8。
 */

export interface PromptSubject {
  name: string;
  kind: "character" | "scene" | "prop";
  slot?: number;
  state?: string;
  anchor?: string;
}

export interface PromptStyle {
  look: string;
  /** 自然语言色名（主光/辅光/暗部/固有色），不要 HEX */
  colors?: { key?: string; fill?: string; shadow?: string; base?: string[] };
  aspect?: string;
}

export interface Continuation {
  enabled: boolean;
  overlapFrames?: number;
  mode?: "guide" | "continue";
}

export interface ComposeShotInput {
  index: number;
  number: number;
  durationSec: number;
  scene: { name: string; place: "内" | "外"; time: string };
  action: string;
  subjects: PromptSubject[];
  style: PromptStyle;
  dialogue?: string;
  speaker?: string;
  sound?: string;
  assetsBound: boolean;
  continuation?: Continuation;
  previousTail?: string;
}

export const FPS = 24;
export const MAX_GEN_FRAMES = 736;
export const CONTINUITY_SETTLING_FRAMES = 12;
export const CONTINUITY_SOURCE_LOOKAHEAD = 8;
export const DEFAULT_CONTEXT_FRAMES = 22;

export function alignFrames(frames: number): number {
  let n = Math.max(5, Math.round(frames));
  while (n % 17 !== 5) n += 1;
  return n;
}

export function durationToFrames(sec: number): number {
  return alignFrames(Math.round(sec * FPS));
}

export function sampledFrames(visibleFrames: number, continuation: Continuation | undefined): number {
  if (!continuation?.enabled) return alignFrames(visibleFrames);
  const lock = alignFrames(continuation.overlapFrames ?? DEFAULT_CONTEXT_FRAMES);
  return alignFrames(lock + CONTINUITY_SETTLING_FRAMES + visibleFrames + CONTINUITY_SOURCE_LOOKAHEAD);
}

export function clampDuration(sec: number, continuation: Continuation | undefined): number {
  let s = Math.min(30, Math.max(0.5, Number(sec) || 5));
  while (sampledFrames(durationToFrames(s), continuation) > MAX_GEN_FRAMES && s > 0.5) s -= 0.5;
  return s;
}

function clean(text: string): string {
  return text.replace(/[|｜"“”]/g, "").replace(/\s+/g, " ").trim().replace(/[。；;，,\s]+$/g, "");
}

const shotSize = ["中景", "中近景", "近景", "特写"];

/** 正文里的主体名首次出现时补上 <Subject N>，否则参考图等于挂空 */
export function anchorSubjectMentions(text: string, subjects: PromptSubject[]): string {
  let t = text;
  for (const s of subjects) {
    const slot = s.slot ?? 0;
    if (slot <= 0) continue;
    const plain = s.name.replace(/（.*?）/g, "").trim();
    if (!plain) continue;
    const idx = t.indexOf(plain);
    if (idx < 0) continue;
    if (/<Subject\s+\d+>\s*$/.test(t.slice(Math.max(0, idx - 14), idx))) continue;
    t = `${t.slice(0, idx)}<Subject ${slot}> ${plain}${t.slice(idx + plain.length)}`;
  }
  return t;
}


function subjectDefinition(s: PromptSubject, assetsBound: boolean, sceneOnly: boolean): string {
  const n = s.slot ?? 0;
  const ref = `@Picture${n}`;
  const state = s.state ? `（${s.state}）` : "";
  if (s.kind === "scene") {
    return assetsBound && n > 0
      ? sceneOnly
        ? `<Subject ${n}> 是本段场景${s.name}${state}，取自 ${ref}（场景概念图）：以该图为画面基准，锁定建筑形制、空间结构、地平线、机位高度与构图；运镜只做轻微推近/横移，不得换场景、换建筑或改变前中后景关系。`
        : `<Subject ${n}> 是本段场景${s.name}${state}，取自 ${ref}（场景概念图）：锁定建筑形制、空间结构、地平线与光位，构图可随角色调度调整，不得换场景或换建筑。`
      : `<Subject ${n}> 是本段场景${s.name}${state}，纯文字定义不设参考图：只作空间结构、材质与光位基准。`;
  }
  if (s.kind === "character") {
    return assetsBound && n > 0
      ? `<Subject ${n}> 是角色${s.name}${state}，取自 ${ref}（定妆图）：只锁身份，不描述外貌；姿势与构图随本段调度。`
      : `<Subject ${n}> 是角色${s.name}${state}，纯文字定义不设参考图：只锁身份，不描述外貌。`;
  }
  return assetsBound && n > 0
    ? `<Subject ${n}> 是${s.name}${state}，取自 ${ref}（道具图）：只作道具形制与材质基准。`
    : `<Subject ${n}> 是${s.name}${state}，纯文字定义：只作道具形制基准。`;
}

/** 片段提示词（前端大文本框 imagePrompt）：官方四段式，参数与调度词一律不写 */
export function composeImagePrompt(input: ComposeShotInput): string {
  const dur = clampDuration(input.durationSec, input.continuation);
  const subjects = [...input.subjects].filter((s) => (s.slot ?? 0) > 0).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const scene = subjects.find((s) => s.kind === "scene");
  const chars = subjects.filter((s) => s.kind === "character");
  const props = subjects.filter((s) => s.kind === "prop");
  const sceneRef = scene ? `Subject ${scene.slot}` : "";
  // 无角色的场景段 = 概念图就是画面本体：锁构图/机位，避免「塔在左、成片中右」的漂移。
  const sceneOnly = !!scene && chars.length === 0;
  const action = anchorSubjectMentions(clean(input.action), subjects);
  const colors = input.style.colors;
  const colorText = colors
    ? [
        colors.key ? `主光${colors.key}` : "",
        colors.fill ? `辅光${colors.fill}` : "",
        colors.shadow ? `暗部${colors.shadow}` : "",
        colors.base?.length ? `固有色${colors.base.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("、")
    : "";

  const defs = [
    ...subjects.map((s) => subjectDefinition(s, input.assetsBound, sceneOnly)),
    props.length === 0 && !subjects.some((s) => s.kind === "prop") ? "" : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 主体定义行已经写明 `<Subject N> → 名称/参考图/锁什么`；不再追加一行「主体锚定」重复映射，
  // 也不在定义里复述角色外貌（2026-11-18 用户两次强调：前面已锚定，别再重复）。
  const defsText = sceneOnly
    ? `${defs}\n本段无角色，场景概念图即画面基准：建筑形制、地平线、机位与构图全部以该图为准，禁止另起构图。`
    : defs;

  const size = shotSize[input.number % shotSize.length]!;
  const cam = input.index === 0 ? "固定机位，缓慢推近" : "固定机位";
  // 2026-11-19 用户口径：台词不能塞进空间调度句里（塞进去模型会把台词当画面描述，
  // 还会出现「某某说：」这种叙述，H3 只认 <d> 里那一段声音）。台词单独成块：
  // 说话人：<d>[Chinese] 台词</d>，一句一行，描述里不再重复。
  const speaker = input.speaker ?? chars[0]?.name ?? "在场角色";
  const dialogueBlock = input.dialogue
    ? `台词（仅声音，画外念出，绝不渲染成画面文字）：\n${speaker}：<d>[Chinese] ${clean(input.dialogue)}</d>`
    : "";
  const shotLine =
    `[Shot 1] ${size}，${cam}，机位在${scene?.name ?? input.scene.name}一侧、轴线固定。` +
    `空间调度：${action}，动作到终点态即停，不转身离画。` +
    (sceneRef ? `以 <${sceneRef}> 为空间基准。` : "") +
    (colorText ? `颜色锁定 ${colorText}。` : "") +
    `声音：${input.sound ? clean(input.sound) : "环境声与动作音效"}。`;

  const names = chars.map((c) => c.name).join("、");
  const closedMouth = chars.length
    ? `${names}皆双唇紧闭、不做任何说话口型${input.dialogue ? "（仅台词处开口）" : ""}。`
    : "";

  return [
    "subject_definitions:",
    defsText,
    "",
    "detailed_description:",
    "画面为干净画面：无字幕、无字卡、无屏显文字、无任何可读文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。" +
      `目标视频为${input.style.look}；非动画、非游戏渲染。无字幕。无字卡。无屏显文字。`,
    shotLine,
    "",
    ...(dialogueBlock ? [dialogueBlock, ""] : []),
    "overall_soundscape:",
    `本段仅环境声与动作音效：${input.sound ? clean(input.sound) : "风声、脚步与器物轻响"}。全段无人旁白；${closedMouth}`,
    "",
    "non_diegetic_music:",
    "无叙事性音乐。不添加任何背景音乐与旋律乐器；仅保留叙事环境声与物理音效。",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

/** 运镜/动作备注（videoPrompt 轨道；不写进 imagePrompt） */
export function composeVideoPrompt(input: ComposeShotInput): string {
  const chars = input.subjects
    .filter((s) => s.kind === "character" && (s.slot ?? 0) > 0)
    .map((s) => `<Subject ${s.slot}>（${s.name}）`)
    .join("、");
  return [
    `运镜：${input.index === 0 ? "固定机位，缓慢推近" : "固定机位"}，不切镜、不甩镜。`,
    `动作：${clean(input.action)}；到终点态停止。`,
    chars ? `主体：${chars}走位沿用首帧。` : "",
    input.dialogue ? "口型：仅台词处开口。" : "口型：全程闭口。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeNegativePrompt(kindHints: string[] = []): string {
  const base = [
    "no text",
    "no subtitle",
    "no watermark",
    "no logo",
    "no modern objects",
    "no plastic",
    "no wristwatch",
    "no printed patterns",
  ];
  return [...new Set([...base, ...kindHints])].join(", ");
}
