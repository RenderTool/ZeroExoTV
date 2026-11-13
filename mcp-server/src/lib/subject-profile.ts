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

/** 角色三视图模板 + 人设字段（写死画面数量与单人/同一张脸） */
export function buildCharacterPrompt(profile: SubjectProfile): string {
  const earring = v(profile, "耳饰");
  return `专业电影级角色定妆参考图（三视图：正面特写 + 正面全身 + 背面全身）。
画面布局：16:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。禁止侧面视图、其它机位、第四个人物、多角度拼版。
画面只允许出现这一个角色（同一张脸、同一套服装）：禁止第二个人、多人合照、模特合集、候选人群像、旁人虚影。

人设：${v(profile, "时代基底")}，${v(profile, "国家朝代")}，${v(profile, "物种")}，${v(profile, "族裔")}，${v(profile, "类型基底")}，${v(profile, "年龄")}岁。
显著特征：${v(profile, "显著特征")}。
脸型：${v(profile, "脸型")}。
发型：${v(profile, "发型")}。${earring ? `\n耳饰：${earring}。` : ""}
身材：${v(profile, "身材")}；头身比 ${v(profile, "头身比")}。
性格：${v(profile, "性格")}。
服装（${v(profile, "变装")}）：上身着装 ${v(profile, "上身着装")}；下身着装 ${v(profile, "下身着装")}；鞋子 ${v(profile, "鞋子")}。

体态：自然放松站姿（非 T-pose / A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。
镜头与质感：85mm 人像镜头，浅景深；极致写实皮肤与骨相，真实布料纹理、自然褶皱、缝线细节、哑光材质；电影级布光，按剧本时代与场景定。
色彩：按剧本时代/题材定调（古装暖黄、民国低饱和、现代自然、科幻冷青等），不要硬套年代滤镜。
背景与排版：纯净中性灰(#C8C8C8)无缝背景纸，无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。
质量标签：AAA 级电影制作质量，超高分辨率，写实人体解剖结构，非动漫，非游戏渲染。`;
}

/** 场景 2×2 宫格模板（空场景） */
export function buildScenePrompt(profile: SubjectProfile): string {
  return `专业电影级场景参考图（空场景，无人物）。
画面布局：4:3，2×2 宫格，四个视角来自同一空间：左上 = 视角1；右上 = 视角2；左下 = 视角3；右下 = 视角4。四格必须是同一地点的连续空间，不得拼成四个不同地方。

场景：${v(profile, "时代基底")}；${v(profile, "地点")}；建筑风格 ${v(profile, "建筑风格")}；空间结构 ${v(profile, "空间结构")}。
地面：${v(profile, "地面")}。
墙面：${v(profile, "墙面")}。
门窗：${v(profile, "门窗") || "按空间结构自然衔接，不额外加装饰"}。
光源：${v(profile, "光源")}。
层次：前景 ${v(profile, "前景")}；中景 ${v(profile, "中景")}；远景 ${v(profile, "远景")}。
氛围：${v(profile, "氛围")}。
色调：${v(profile, "色调")}。
材质与洁净度：${v(profile, "材质与洁净度")}。

硬约束：画面中不得出现人物、动物、字幕、水印、标志、文字；不得改变建筑结构；四格光影方向一致。`;
}

/** 道具单品参考图模板 */
export function buildPropPrompt(profile: SubjectProfile): string {
  return `专业电影级道具参考图（Cinematic Prop Reference Sheet）。
画面布局：单品居中、完整入画；右侧/下方允许 1 个细节特写（材质/边缘/工艺），不增加其它物品。
道具：${v(profile, "名称")}；尺寸 ${v(profile, "尺寸")}；材质 ${v(profile, "材质")}；颜色 ${v(profile, "颜色")}。
状态：${v(profile, "状态")}。
边缘与纹理：${v(profile, "边缘与纹理")}。
光泽：${v(profile, "光泽")}。
磨损：${v(profile, "磨损") || "无明显污损"}。
背景：${v(profile, "背景") || "干净中性灰，无杂乱道具"}。

硬约束：无手、无人物、无文字水印；不得出现同款第二件；材质与做旧程度必须与描述一致。`;
}

export interface BuiltSubjectProfile {
  kind: ProfileKind;
  /** 身份锚点句（写 ProductionItem.note） */
  anchor: string;
  /** 标准提示词（写主体树基础状态 fullPrompt/deltaPrompt） */
  prompt: string;
}

/** 校验 + 组装；字段不全返回 missing，不抛错（调用方决定 dryRun / 拒绝） */
export function buildSubjectProfile(
  kind: SubjectKindInput,
  profile: SubjectProfile,
): { missing: string[]; built: BuiltSubjectProfile | null; label: string } {
  const k = normKind(kind);
  const missing = missingProfileFields(k, profile);
  if (missing.length > 0) return { missing, built: null, label: LABEL[k] };
  const prompt = k === "scene" ? buildScenePrompt(profile)
    : k === "prop" ? buildPropPrompt(profile)
      : buildCharacterPrompt(profile);
  return { missing: [], built: { kind: k, anchor: buildSubjectAnchor(k, profile), prompt }, label: LABEL[k] };
}
