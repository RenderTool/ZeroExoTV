/**
 * subject-profile — 主体人设/场景/道具的强制字段模板（2026-11-13 用户要求）
 *
 * 用户原话：压根没有一个强制约束关系约束他规范生成主体（例如三视图模板 + 人设角色描述）；
 * 有图时必须先看图、按图片反推这些关键信息，再套三视图模板。
 *
 * 本模块是服务端唯一一份：
 * - 每种主体的必填字段（缺一个就拒绝写入，并列出缺哪些）；
 * - 由字段拼出的标准提示词（角色 = 正面特写 + 正背全身定妆参考图；场景 = 单视角空场景轴图，2×2 宫格仅显式要求；道具 = 单品参考图）；
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

/**
 * 非人角色（兽/机械体）必填：不穿衣服，服装三件与变装对它们只会把提示词写成
 * 「穿战术靴的白化雪豹」，所以这几项不要求；改要求「附着物」（机械义肢/鞍具等）由 显著特征 交代。
 */
const CREATURE_REQUIRED = [
  "时代基底", "国家朝代", "物种", "族裔", "类型基底", "显著特征",
  "脸型", "发型", "身材", "头身比", "年龄", "性格",
] as const;

const HUMAN_SPECIES = /人|人类|华夏|族裔.*人/;
/** 物种写的是兽类/机械体时按非人角色出图（白化雪豹、军犬、机械狼…） */
function isCreature(profile: SubjectProfile): boolean {
  const species = v(profile, "物种");
  if (!species) return false;
  return !HUMAN_SPECIES.test(species) && /豹|虎|狼|狮|犬|猫|兽|熊|马|象|蛇|鹰|鸟|龙|鱼|虫|机械/.test(species);
}

const SCENE_REQUIRED = [
  "时代基底", "地点", "建筑风格", "空间结构", "地面", "墙面", "光源",
  "前景", "中景", "远景", "氛围", "色调", "材质与洁净度",
] as const;

/** 场景可选补充字段（不强制拒绝，但写了就进标准提示词） */
const SCENE_OPTIONAL = ["调度空间", "色光锁句"] as const;

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

/** 年龄字段容错：模型常把「27岁」整句填进来，再拼「岁」会变成「27岁岁」 */
function ageText(profile: SubjectProfile): string {
  return v(profile, "年龄").replace(/岁$/, "");
}

/** 缺失字段（中文名，直接回给 Agent/用户） */
export function missingProfileFields(kind: SubjectKindInput, profile: SubjectProfile): string[] {
  const k = normKind(kind);
  const required = k === "character" && isCreature(profile) ? CREATURE_REQUIRED : REQUIRED[k];
  return required.filter((key) => !v(profile, key));
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
    + `${ageText(profile)}岁${v(profile, "类型基底")}，${v(profile, "显著特征")}；`
    + `${v(profile, "脸型")}；${v(profile, "发型")}；${v(profile, "身材")}（头身比 ${v(profile, "头身比")}）`;
}

/** 全剧风格块：有全剧预设 → 一行风格片段；没有 → 按主体类型给具体默认（禁止给道具写皮肤/布料） */
function styleBlock(stylePrompt?: string, kind: ProfileKind = "character"): string {
  const custom = (stylePrompt ?? "").trim();
  if (custom) return `风格：${custom}`;
  if (kind === "prop") {
    return [
      "风格：写实电影道具参考图",
      "灯光：均匀柔光 + 单侧塑形光，突出材质与边缘",
      "色彩：真实材质本色，低饱和",
      "质感：真实金属/聚合物/木材/皮革纹理，磨损与做旧自然",
    ].join("\n");
  }
  if (kind === "scene") {
    return [
      "风格：写实电影场景参考图",
      "灯光：自然光 + 环境光遮蔽，方向明确",
      "色彩：场景固有色，低饱和",
      "质感：真实建筑与自然环境材质，光影过渡自然",
    ].join("\n");
  }
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
空场景，画面中不得出现人物、人物外貌描述、动物、可移动道具、食物/水果（如苹果）、日用品、字幕、水印；保持空间结构与材质真实。\n${styleBlock(stylePrompt, "scene")}`;
  }
  if (kind === "prop") {
    return `专业电影级道具参考图。道具：${name}。${desc}
单品居中，无人物、无手、无文字水印；材质与做旧程度与描述一致；不写角色外貌。\n${styleBlock(stylePrompt, "prop")}`;
  }
  return `专业电影级角色定妆参考图（单人）。角色：${name}。${desc}
画面只出现这一个角色，同一张脸、同一套服装；禁止第二个人、多人合照、模特合集、候选人群像。\n${styleBlock(stylePrompt, "character")}`;
}

/** 角色模板：sheet = 正面特写 + 正背全身（画面数量写死）；single/white-bg = 单张定妆照 */
export function buildCharacterPrompt(profile: SubjectProfile, mode: SubjectRenderMode = "sheet", stylePrompt?: string): string {
  const earring = v(profile, "耳饰");
  const creature = isCreature(profile);
  const person = creature
    ? `角色描述：${v(profile, "时代基底")}·${v(profile, "国家朝代")}，${v(profile, "物种")}·${v(profile, "族裔")}，${ageText(profile)}岁${v(profile, "类型基底")}。
显著特征：${v(profile, "显著特征")}。
头部：${v(profile, "脸型")}。
毛发：${v(profile, "发型")}。
体量：${v(profile, "身材")}；头身比 ${v(profile, "头身比")}。
性格：${v(profile, "性格")}。`
    : `角色描述：${v(profile, "时代基底")}·${v(profile, "国家朝代")}，${v(profile, "物种")}·${v(profile, "族裔")}，${ageText(profile)}岁${v(profile, "类型基底")}。
显著特征：${v(profile, "显著特征")}。
脸型：${v(profile, "脸型")}。
发型：${v(profile, "发型")}。${earring ? `耳饰：${earring}。` : ""}
身材：${v(profile, "身材")}；头身比 ${v(profile, "头身比")}。
性格：${v(profile, "性格")}。
服装（${v(profile, "变装")}）：上身着装 ${v(profile, "上身着装")}；下身着装 ${v(profile, "下身着装")}；鞋子 ${v(profile, "鞋子")}。`;
  const whiteBg = mode === "white-bg";
  // 与前端 subject-prompt-templates.ts 的 characterFrontBack 保持同一份规范：
  // 背景纯白、固定 3 个画面、正面特写 + 正面全身 + 背面全身，禁止侧面/额外机位。
  const background = whiteBg
    ? "背景与排版：纯白无缝背景（#FFFFFF），无任何道具、无文字水印；主体完整抠像边缘清晰，柔和接触阴影。"
    : "背景与排版：纯白无缝背景纸（#FFFFFF），无任何道具；极简无衬线字体标注 FRONT 正面 | BACK 背面。";
  /** 非人角色：禁用「真人演员 / 人像镜头 / 人体解剖」这类把人往人形拽的措辞 */
  const consistency = creature
    ? "角色一致性：严格锁定同一只动物（同一副骨相、同一套毛色与同一处机械义肢）。三个画面只允许出现这一只动物，禁止第二只同款、豹群、群像、旁人虚影。"
    : "角色一致性：严格锁定同一角色的同一套造型（实拍角色为同一张脸，卡通角色为同一套造型比例与材质）。三个画面必须保持同一套服装与材质；画面中只允许出现这一个角色，禁止第二个人、多人合照、模特合集、候选人群像、旁人虚影。";
  const posture = creature
    ? "体态：四足自然站姿，重心微移，尾巴自然下垂，杜绝标本摆拍感与人立姿态。"
    : "体态：自然放松站姿（非 T-pose / A-pose），重心微移，手臂自然下垂，杜绝僵硬模型感。";
  const lens = creature
    ? "镜头与质感：200mm 长焦，浅景深；真实毛发层次与骨相，机械义肢的金属、线束与磨损细节；电影级布光。"
    : "镜头与质感：85mm 人像镜头，浅景深；表面质感按项目统一风格（实拍角色按真实肤质与布料，卡通角色按该风格的材质与体积感），服装褶皱、缝线与哑光细节清晰；电影级布光。";
  const quality = creature
    ? "质量标签：AAA 级电影制作质量，超高分辨率，写实动物解剖结构，非动漫，非游戏渲染。"
    : "质量标签：AAA 级电影制作质量，超高分辨率，结构准确，材质按项目统一风格，非游戏渲染。";
  const closeup = creature
    ? "左侧特写：头部与肩部特写，微侧15°，琥珀色兽瞳有真实反光，鼻梁与耳廓结构清晰；质感 极致写实毛发与湿润鼻头；镜头 200mm 长焦，浅景深，电影级布光。"
    : "左侧特写：构图 微侧15°，中性自然表情，真实眼神；质感 表面与角色设定一致（实拍按真实肤质，卡通按该风格的材质与明暗），镜头 85mm 人像镜头，浅景深，电影级布光。";
  if (mode !== "sheet") {
    return `专业电影级角色定妆照（单人${whiteBg ? "，白底快速图" : ""}）。
画面布局：16:9 横向构图，单人${whiteBg ? "正面半身/七分身" : "正面七分身"}居中，画面只出现这一个角色。
禁止侧面视图与多角度拼版。

${person}
${consistency}
${posture}
${lens}
${styleBlock(stylePrompt, "character")}
${background}
${quality}`;
  }
  return `专业电影级角色定妆参考图（正面特写 + 正背全身）。
画面布局：16:9 横向宽银幕构图。画面中固定 3 个画面，数量不得增减：① 左侧 1 个正面大头特写；② 右侧 1 个正面全身；③ 右侧 1 个背面全身。禁止侧面视图、其它机位、第四个主体、多角度拼版。

${person}
${consistency}
${posture}

${closeup}

右侧全身：只有正面全身与背面全身这 2 个视图；${creature ? "四爪着地、底部平齐，毛色与机械义肢在正背两面保持同一位置" : "身高对齐，底部平齐，真实演员试装照风格；服装 高级电影戏服质感，真实布料纹理、自然褶皱、缝线细节、哑光材质"}。

${styleBlock(stylePrompt, "character")}

${background}

${quality}`;
}

/** 场景模板：single（默认）= 单视角空场景轴图；sheet = 2×2 宫格（仅用户明确要四视角时）；white-bg 不适用场景 */
export function buildScenePrompt(profile: SubjectProfile, mode: SubjectRenderMode = "single", stylePrompt?: string): string {
  const blocking = v(profile, "调度空间");
  const paletteLock = v(profile, "色光锁句");
  const layout = mode === "sheet"
    ? `画面布局：16:9（2048×1152），2×2 宫格，四个视角来自同一空间：左上 = 视角1；右上 = 视角2；左下 = 视角3；右下 = 视角4。四格必须是同一地点的连续空间，不得拼成四个不同地方。`
    : `画面布局：21:9 单张轴图，平视大全景，机位选在最能看清空间结构与调度路线的位置；只出一个机位，不要多格拼贴，不要道具居中填满画面的装饰性剧照。`;
  const blockingLine = blocking
    ? `调度空间：${blocking}。入口/门槛、人物站位空地、进出通道必须在画面内可见；前景柱/框只作边缘框景，不得压住动线。`
    : `调度空间：画面内必须留出人物站位空地与进出通道，前景构件只作边缘框景，不得压住动线。`;
  const lockLine = paletteLock
    ? `色光锁句（本场景所有轴图逐字复用，不改写、不换说法，避免同场景色调漂移）：${paletteLock}`
    : "";
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
${blockingLine}
${lockLine}

硬约束：画面中不得出现人物、人物外貌描述、动物、可移动道具、食物/水果（如苹果）、日用品、字幕、水印、标志、文字；不得改变建筑结构。前景/中景/远景只能写固定不可移动的建筑、家具、植被与结构元素，不写苹果/杯子/手机/书这类可移动小物。
${styleBlock(stylePrompt, "scene")}`;
}

/**
 * 道具模板（2026-11-18 用户口径：形态由道具自身复杂度决定，不是一刀切单视图）：
 * - single（默认）：单品单视图，单品居中，不拼版；
 * - sheet：结构复杂、要交代多部件/工艺/边缘的道具才用——整体 + 1 个细节特写；
 * - white-bg：白底快速图。
 */
export function buildPropPrompt(profile: SubjectProfile, mode: SubjectRenderMode = "single", stylePrompt?: string): string {
  const whiteBg = mode === "white-bg";
  const detail = mode === "sheet";
  const title = detail
    ? "专业电影级道具参考图（单品 + 细节）"
    : whiteBg
      ? "专业电影级道具白底快速图"
      : "专业电影级道具参考图（单品单视图）";
  const layout = detail
    ? `画面布局：单品居中、完整入画；另给 1 个细节特写（材质/边缘/工艺），最多 1 个，不增加其它物品、不出现同款第二件。`
    : whiteBg
      ? `画面布局：纯白底电商主图，单品居中、完整入画、占画面约 70%，柔和顶部光 + 轻微接触阴影；不要多格拼贴、不要场景道具。`
      : `画面布局：16:9 横向构图，单品居中、完整入画，占画面约 70%；单张单视图，不要多格拼贴、不要细节拼版、不要同款第二件。`;
  const bg = whiteBg ? "纯白(#FFFFFF)" : (v(profile, "背景") || "干净中性灰");
  return `${title}。
${layout}
道具：${v(profile, "名称")}；尺寸 ${v(profile, "尺寸")}；材质 ${v(profile, "材质")}；颜色 ${v(profile, "颜色")}。
状态：${v(profile, "状态")}。
边缘与纹理：${v(profile, "边缘与纹理")}。
光泽：${v(profile, "光泽")}。
磨损：${v(profile, "磨损") || "无明显污损"}。
背景：${bg}。

硬约束：无手、无人物、无文字水印；不得出现同款第二件；材质与做旧程度必须与描述一致。
${styleBlock(stylePrompt, "prop")}`;
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
  // 角色默认要定妆参考图（锁脸+服装）；场景/道具没有多视图的必要，
  // 默认单张概念图即可——可直接复用已有分镜概念帧，不强制生成轴图/细节图。
  // 道具形态由复杂度决定（2026-11-18 用户纠正）：默认 single；结构复杂、要多部件/工艺细节时才显式传 sheet。
  const requested = opts.renderMode;
  const mode: SubjectRenderMode = requested ?? (k === "character" ? "sheet" : "single");
  const prompt = k === "scene" ? buildScenePrompt(profile, mode, opts.stylePrompt)
    : k === "prop" ? buildPropPrompt(profile, mode, opts.stylePrompt)
      : buildCharacterPrompt(profile, mode, opts.stylePrompt);
  return { missing: [], built: { kind: k, anchor: buildSubjectAnchor(k, profile), prompt, renderMode: mode }, label: LABEL[k] };
}
