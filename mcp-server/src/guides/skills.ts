/** 生产技能正文已迁到 skills-md/*.md，由 tools/gen-skills.mjs 生成 skills.generated.ts */
import { SCRIPT_IMPORT, SUBJECTS, SHOTS_PROMPTS, IMAGE_PROMPTS, PARAMS, PIPELINE } from "./skills.generated.js";

/**
 * 生产技能（Skill）——MCP 的「怎么做」层。
 *
 * 工具只能回答「能做什么」；这一层回答「按什么顺序、用什么规则做出能交付的结果」。
 * 内容源自 zerovideoAgent 的 skills/，按本项目重构后的数据模型与工具名重写：
 * - 数据落点：projects/<id>/entities/{script,storyboard,workbench}.json（不是旧项目的 md 目录树）
 * - 工具名：本 MCP 的工具名（import_script / split_script_to_shots / set_shot_prompt …）
 * - 参数键：director-params.DIRECTOR_PARAM_SCHEMA（aspect / scaleFactor / steps / total_frames …）
 *
 * 交付要求：任何 Agent 连上 MCP，读 zeroexo://skills/index 就能知道每一环怎么做，
 * 不需要外部仓库、不需要人肉口传。
 */

export interface ProductionSkill {
  key: string;
  name: string;
  summary: string;
  /** 什么时候必须读它（路由用） */
  whenToUse: string;
  body: string;
}

export const PRODUCTION_SKILLS: ProductionSkill[] = [
  {
    key: "script-import",
    name: "剧本落地（script-import）",
    summary: "剧本原文/分镜 Markdown → 标准剧本 → entities/script.json（HTML 段落）",
    whenToUse: "用户给剧本、转写稿或分镜 Markdown，要进「剧本」页签时",
    body: SCRIPT_IMPORT,
  },
  {
    key: "subjects",
    name: "主体库（subjects）",
    summary: "角色/场景/道具的收录标准、身份锚点句、状态图规格与挂接",
    whenToUse: "要把角色/场景/道具做成可复用主体、挂定妆图时",
    body: SUBJECTS,
  },
  {
    key: "shots-prompts",
    name: "分镜与视频提示词（shots-prompts）",
    summary: "片段切分、时长判定、无旁白版五段式提示词、十二条铁律与质量门",
    whenToUse: "要把剧本变成导演台片段并写出可投喂的提示词时",
    body: SHOTS_PROMPTS,
  },
  {
    key: "image-prompts",
    name: "画布图片提示词（image-prompts）",
    summary: "Moss / Krea2 / Qwen 三种文生图的提示词写法、尺寸参数口径、generate_canvas_images 投递与验收",
    whenToUse: "要在画布上生成图片、写图片提示词、或选择图片模型与尺寸时",
    body: IMAGE_PROMPTS,
  },
  {
    key: "params",
    name: "参数与 H3 延续法（params）",
    summary: "参数键位、必须问用户的项、自检小参数、22 帧引导与接缝预算",
    whenToUse: "要装配公共参数、准备出片或联调生成时",
    body: PARAMS,
  },
];

export const SKILL_URI_PREFIX = "zeroexo://skills/";
export const SKILL_INDEX_URI = "zeroexo://skills/index";

export function getSkill(key: string): ProductionSkill | undefined {
  return PRODUCTION_SKILLS.find((s) => s.key === key);
}

export function skillsIndexText(): string {
  const rows = PRODUCTION_SKILLS.map(
    (s) => `- ${SKILL_URI_PREFIX}${s.key}｜${s.name}：${s.summary}\n  何时读：${s.whenToUse}`,
  ).join("\n");
  return `# ZeroExo 生产技能索引\n\n工具只回答「能做什么」，这些技能回答「怎么做」。开工前先读对应技能，禁止凭感觉写提示词或参数。\n\n${rows}\n\n完整流水线：zeroexo://skills/pipeline（收料 → 剧本 → 主体 → 分镜 → 提示词 → 参数 → 出片）。`;
}

export function skillsPipelineText(): string {
  return PIPELINE;
}
