/**
 * subject-profile — 主体人设/场景/道具的强制字段模板（2026-11-13 用户要求）
 *
 * 用户原话：压根没有一个强制约束关系约束他规范生成主体（例如三视图模板 + 人设角色描述）；
 * 有图时必须先看图、按图片反推这些关键信息，再套三视图模板。
 *
 * 本模块是服务端唯一一份：
 * - 每种主体的必填字段（缺一个就拒绝写入，并列出缺哪些）；
 * - 由字段拼出的标准提示词（角色 = 三视图；场景 = 2×2 空场景；道具 = 单品参考图）；
 * - 身份锚点句（写进 ProductionItem.note，供后续分镜提示词逐字复用）。
 */

export type SubjectKindInput = "character" | "scene" | "prop" | "candidate";

/** 出图形态：sheet = 参考图/定妆（三视图/宫格/细节图）；single = 单张；white-bg = 白底快速图（道具） */
export type SubjectRenderMode = "sheet" | "single" | "white-bg";

export type SubjectProfile = Record<string, string>;

type ProfileKind = "character" | "scene" | "prop";

/** 角色必填（candidate 按角色要求） */
const CHARACTER_REQUIRED = [
  "时代基底", "国家朝代", "物种", "族裔", "类型基底", "显著特征",
  "脸型", "发型", "身材", "头身比", "年龄", "性格",
  "变装", "上身着装", "下身着装", "鞋子",
] as const;

const SCENE_REQUIRED = [
  "时代基底", "地点", "建筑风格", "空间结构", "地面", "墙面", "光源",
  "前景", "中景", "远景", "氛围", "色调", "材质与洁净度",
] as const;

const PROP_REQUIRED = [
  "名称", "尺寸", "材质", "颜色", "状态", "边缘与纹理", "光泽", "背景",
] as const;

const REQUIRED: Record<ProfileKind, readonly string[]> = {
  character: CHARACTER_REQUIRED,
  scene: SCENE_REQUIRED,
  prop: PROP_REQUIRED,
};

const LABEL: Record<ProfileKind, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

function normKind(kind: SubjectKindInput): ProfileKind {
  if (kind === "scene" || kind === "prop") return kind;
  return "character"; // candidate 按角色要求
}

function v(profile: SubjectProfile, key: string): string {
  return (profile[key] ?? "").trim();
}

/** 缺失字段（中文名，直接回给 Agent/用户） */
export function missingProfileFields(kind: SubjectKindInput, profile: SubjectProfile): string[] {
  const k = normKind(kind);
  return REQUIRED[k].filter((key) => !v(profile, key));
}

/** 身份锚点句（角色 = 一行外观锁；场景/道具 = 地点/名称一句话） */
export function buildSubjectAnchor(kind: SubjectKindInput, profile: SubjectProfile): string {
  const k = normKind(kind);
  if (k === "scene") {
    return `${v(profile, "时代基底")}·${v(profile, "地点")}：${v(profile, "建筑风格")}；${v(profile, "空间结构")}`;
  }
  if (k === "prop") {
    return `${v(profile, "名称")}：${v(profile, "材质")}，${v(profile, "颜色")}，${v(profile, "尺寸")}，${v(profile, "状态")}`;
  }
  return `${v(profile, "时代基底")}·${v(profile, "国家朝代")}，${v(profile, "物种")}·${v(profile, "族裔")}，`
    + `${v(profile, "年龄")}岁${v(profile, "类型基底")}，${v(profile, "显著特征")}；`
    + `${v(profile, "脸型")}；${v(profile, "发型")}；${v(profile, "身材")}（头身比 ${v(profile, "头身比")}）`;
}

/** 全剧风格块：有全剧预设 → 一行风格片段；没有 → 具体默认（不再写「按剧本…定」） */
function styleBlock(stylePrompt?: string): string {
  const custom = (stylePrompt ?? "").trim();
  if (custom) return `风格：${custom}`;
  return [
    "风格：写实电影定妆照",
    "灯光：自然柔光为主，侧光塑形",
    "色彩：现代自然色调，低饱和",
    "质感：写实电影质感，真实皮肤与布料纹理",
  ].join("\n");
}

/**
 * 最小可用主体提示词（2026-11-13）：新建主体还没跑 set_subject_profile 时兜底，
 * 保证「主体已经有提示词」而不是空白；后续 set_subject_profile 会覆盖成完整模板。
 */
export function buildMinimalSubjectPrompt(
  kind: SubjectKindInput,
  name: string,
  note?: string,
  stylePrompt?: string,
): string {
  const desc = (note ?? "").trim() || `${name}（${kind === "character" ? "角色" : kind === "scene" ? "场景" : "道具"}）`;
  if (kind === "scene") {
    return `专业电影级场景参考图。场景：${name}。${desc}
空场景，画面中不得出现人物、动物、字幕、水印；保持空间结构与材质真实。\n${styleBlock(stylePrompt)}`;
  }
  if (kind === "prop") {
    return `专业电影级道具参考图。道具：${name}。${desc}
单品居中，无人物、无手、无文字水印；材质与做旧程度与描述一致。\n${styleBlock(stylePrompt)}`;
  }
  return `专业电影级角色定妆参考图（单人）。角色：${name}。${desc}
画面只出现这一个角色，同一张脸、同一套服装；禁止第二个人、多人合照、模特合集、候选人群像。\n${styleBlock(stylePrompt)}`;
}

/** 角色模板：sheet = 三视图；single/white-bg = 单张定妆照（白底用于快速抠图） */
export function buildCharacterPrompt(profile: SubjectProfile, mode: SubjectRenderMode = "sheet", stylePrompt?: string): string {
  const earring = v(profile, "耳饰");
  const person = `人设：${v(profile, "时代基底")}，${v(profile, "国家朝代")}，${v(profile, "物种")}，${v(profile, "族裔")}，${v(profile, "类型基底")}，${v(profile, "年龄")}岁。
显著特征：${v(profile, "显著特征")}。
脸型：${v(profile, "脸型")}。
发型：${v(profile, "发型")}。${earring ? `\n耳饰：${earring}。` : ""}
身材：${v(profile, "身材")}；头身比 ${v(profile, "头身比")}。
性格：${v(profile, "性格")}。
服装（${v(profile, "变装")}）：上身着装 ${v(profile, "上身着装")}；下身着装 ${v(profile, "下身着装")}；鞋子 ${v(profile, "鞋子")}。`;
  const common = `体态：自然放松站姿（非 T-pose / A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。
镜头与质感：85mm 人像镜头，浅景深；极致写实皮肤与骨相，真实布料纹理、自然褶皱、缝线细节、哑光材质；电影级布光。
${styleBlock(stylePrompt)}`;
  const whiteBg = mode === "white-bg";
  const background = whiteBg
    ? "背景与排版：纯白(#FFFFFF)无缝背景，无任何道具、无文字水印；人物完整抠像边缘清晰，柔和接触阴影。"
    : "背景与排版：纯净中性灰(#C8C8C8)无缝背景纸，无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。";
  if (mode !== "sheet") {
    return `专业电影级角色定妆照（单人${whiteBg ? "，白底快速图" : ""}）。
画面布局：16:9 横向构图，单人${whiteBg ? "正面半身/七分身" : "正面七分身"}居中，画面只出现这一个角色（同一张脸、同一套服装）：禁止第二个人、多人合照、模特合集、候选人群像、旁人虚影。禁止侧面视图与多角度拼版。

${person}

${common}
${background}
质量标签：AAA 级电影制作质量，超高分辨率，写实人体解剖结构，非动漫，非游戏渲染。`;
  }
  return `专业电影级角色定妆参考图（三视图：正面特写 + 正面全身 + 背面全身）。
画面布局：16:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。禁止侧面视图、其它机位、第四个人物、多角度拼版。
画面只允许出现这一个角色（同一张脸、同一套服装）：禁止第二个人、多人合照、模特合集、候选人群像、旁人虚影。

${person}

${common}
${background}
质量标签：AAA 级电影制作质量，超高分辨率，写实人体解剖结构，非动漫，非游戏渲染。`;
}

/** 场景模板：sheet = 2×2 宫格；single/white-bg = 单张全景（无人物） */
export function buildScenePrompt(profile: SubjectProfile, mode: SubjectRenderMode = "sheet", stylePrompt?: string): string {
  const layout = mode === "sheet"
    ? `画面布局：4:3，2×2 宫格，四个视角来自同一空间：左上 = 视角1；右上 = 视角2；左下 = 视角3；右下 = 视角4。四格必须是同一地点的连续空间，不得拼成四个不同地方。`
    : `画面布局：16:9 单张全景，站在最能看清空间结构的位置拍摄；不要多格拼贴。`;
  return `专业电影级场景参考图（空场景，无人物）。
${layout}

场景：${v(profile, "时代基底")}；${v(profile, "地点")}；建筑风格 ${v(profile, "建筑风格")}；空间结构 ${v(profile, "空间结构")}。
地面：${v(profile, "地面")}。
墙面：${v(profile, "墙面")}。
门窗：${v(profile, "门窗") || "按空间结构自然衔接，不额外加装饰"}。
光源：${v(profile, "光源")}。
层次：前景 ${v(profile, "前景")}；中景 ${v(profile, "中景")}；远景 ${v(profile, "远景")}。
氛围：${v(profile, "氛围")}。
色调：${v(profile, "色调")}。
材质与洁净度：${v(profile, "材质与洁净度")}。

硬约束：画面中不得出现人物、动物、字幕、水印、标志、文字；不得改变建筑结构。
${styleBlock(stylePrompt)}`;
}

/** 道具模板：sheet = 单品+细节；single = 单张；white-bg = 白底快速图（电商主图） */
export function buildPropPrompt(profile: SubjectProfile, mode: SubjectRenderMode = "sheet", stylePrompt?: string): string {
  const layout = mode === "sheet"
    ? `画面布局：单品居中、完整入画；右侧/下方允许 1 个细节特写（材质/边缘/工艺），不增加其它物品。`
    : mode === "white-bg"
      ? `画面布局：纯白底电商主图，单品居中、完整入画、占画面约 70%，柔和顶部光 + 轻微接触阴影；不要多格拼贴、不要场景道具。`
      : `画面布局：单品居中、完整入画，中性浅灰背景；单张，不要多格拼贴。`;
  const bg = mode === "white-bg" ? "纯白(#FFFFFF)" : (v(profile, "背景") || "干净中性灰");
  return `专业电影级道具参考图（${mode === "white-bg" ? "白底快速图" : "Cinematic Prop Reference Sheet"}）。
${layout}
道具：${v(profile, "名称")}；尺寸 ${v(profile, "尺寸")}；材质 ${v(profile, "材质")}；颜色 ${v(profile, "颜色")}。
状态：${v(profile, "状态")}。
边缘与纹理：${v(profile, "边缘与纹理")}。
光泽：${v(profile, "光泽")}。
磨损：${v(profile, "磨损") || "无明显污损"}。
背景：${bg}。

硬约束：无手、无人物、无文字水印；不得出现同款第二件；材质与做旧程度必须与描述一致。
${styleBlock(stylePrompt)}`;
}

export interface BuiltSubjectProfile {
  kind: ProfileKind;
  /** 身份锚点句（写 ProductionItem.note） */
  anchor: string;
  /** 标准提示词（写主体树基础状态 fullPrompt/deltaPrompt） */
  prompt: string;
  /** 本次出图形态 */
  renderMode: SubjectRenderMode;
}

/** 校验 + 组装；字段不全返回 missing，不抛错（调用方决定 dryRun / 拒绝） */
export function buildSubjectProfile(
  kind: SubjectKindInput,
  profile: SubjectProfile,
  opts: { renderMode?: SubjectRenderMode; stylePrompt?: string } = {},
): { missing: string[]; built: BuiltSubjectProfile | null; label: string } {
  const k = normKind(kind);
  const missing = missingProfileFields(k, profile);
  if (missing.length > 0) return { missing, built: null, label: LABEL[k] };
  const mode: SubjectRenderMode = opts.renderMode ?? "sheet";
  const prompt = k === "scene" ? buildScenePrompt(profile, mode, opts.stylePrompt)
    : k === "prop" ? buildPropPrompt(profile, mode, opts.stylePrompt)
      : buildCharacterPrompt(profile, mode, opts.stylePrompt);
  return { missing: [], built: { kind: k, anchor: buildSubjectAnchor(k, profile), prompt, renderMode: mode }, label: LABEL[k] };
}
