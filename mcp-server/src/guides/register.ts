/**
 * 新用户零安装路径：guides 资源 + prompts 注册（SDK 1.32.x 高层 API）。
 * - registerResource(name, uri, config: ResourceMetadata, readCallback) → 固定 URI 静态资源
 * - registerPrompt(name, config: { title?, description?, argsSchema? }, cb) → cb 返回 GetPromptResult
 * 资源/prompts 是静态说明内容，不触数据根，不走 defTool 鉴权链（连接本身即授权）。
 * 五阶段流水线文案从 PIPELINE_STAGES（module-specs.ts 单一数据源）生成，避免两份漂移。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import {
  MODULE_SPECS,
  PIPELINE_STAGES,
  GUIDE_INDEX_URI,
  GUIDE_URI_PREFIX,
  guidesIndexText,
  moduleSpecText,
} from "./module-specs.js";
import {
  PRODUCTION_SKILLS,
  SKILL_INDEX_URI,
  SKILL_URI_PREFIX,
  skillsIndexText,
  skillsPipelineText,
} from "./skills.js";

export function registerGuideResources(server: McpServer): void {
  server.registerResource(
    "zeroexo-guides-index",
    GUIDE_INDEX_URI,
    {
      title: "ZeroExoTV 八模块索引（五阶段流水线）",
      description: "五阶段流水线 + 全部模块的 key/name/purpose/order/stage、资源 URI 与必备资料（requiredInputs）速览。",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [{ uri: uri.toString(), mimeType: "application/json", text: guidesIndexText() }],
    }),
  );

  for (const spec of MODULE_SPECS) {
    server.registerResource(
      `zeroexo-guide-${spec.key}`,
      `${GUIDE_URI_PREFIX}${spec.key}`,
      {
        title: `ZeroExoTV 模块规格：${spec.name}（阶段${spec.stage}）`,
        description: spec.purpose,
        mimeType: "application/json",
      },
      (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: "application/json", text: moduleSpecText(spec) }],
      }),
    );
  }

  // ===== 生产技能（怎么做）=====
  server.registerResource(
    "zeroexo-skills-index",
    SKILL_INDEX_URI,
    {
      title: "ZeroExo 生产技能索引",
      description: "剧本/主体/分镜提示词/参数四个技能的用途与加载时机；开工前先读。",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: skillsIndexText() }],
    }),
  );

  server.registerResource(
    "zeroexo-skills-pipeline",
    `${SKILL_URI_PREFIX}pipeline`,
    {
      title: "ZeroExo 生产流水线（技能合订本）",
      description: "收料 → 剧本 → 主体 → 分镜与提示词 → 参数 → 出片，含每一步的硬停止点。",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: skillsPipelineText() }],
    }),
  );

  for (const skill of PRODUCTION_SKILLS) {
    server.registerResource(
      `zeroexo-skill-${skill.key}`,
      `${SKILL_URI_PREFIX}${skill.key}`,
      {
        title: skill.name,
        description: `${skill.summary}（何时读：${skill.whenToUse}）`,
        mimeType: "text/markdown",
      },
      (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: skill.body }],
      }),
    );
  }
}

// ---------- prompts 文本（阶段文案共用 PIPELINE_STAGES） ----------

const STAGES_BRIEF = PIPELINE_STAGES.map(
  (s) => `阶段${s.stage} ${s.name}：${s.action}。\n  ▼ 本阶段停止点（未过不得进下一阶段）：${s.gate}。`,
).join("\n");

const GET_STARTED_TEXT = `【ZeroExoTV 冷启动引导——五阶段流水线，每阶段停下等用户确认】

ZeroExoTV 是浏览器无限画布式视频项目管理（项目/剧本/主体/资产/导演台片段/运行/导出）。MCP 与网页读写同一数据目录（ZEROEXO_DATA_ROOT，默认 D:\\Test）：你写的数据，网页打开即见。

【最少需要问用户的问题】（缺哪个问哪个，禁止编造，禁止替用户决定格式/集数/策略）：
1. 项目名（非空）；
2. 剧本原文（或参考文件夹/素材图）；
3. 剧本是否要按标准格式整理（优先 normalize_script，用户要求原样导入则直接用 mode:'raw'）；
4. 主体外观与清单确认；
5. 是否拆分镜（用户明确说「可以拆」才拆）；
6. 出片前确认（槽位/缺图/时长检查结果）。

【五阶段流水线——未过 gate 不得进下一阶段】
${STAGES_BRIEF}

细节规格按需取：资源 zeroexo://guides/index（五阶段 + 八模块索引）与 zeroexo://guides/<key>（project / episodes / script / subjects / assets / segments / run / export）。`;

function bootstrapProjectText(scriptContent: string): string {
  const scriptBlock = scriptContent
    ? `\n【用户提供的剧本原文】\n${scriptContent}\n`
    : `\n（本次调用未附剧本原文：先向用户要原文，齐备后再进阶段2。）\n`;
  return `【剧本 → 项目 五阶段分步走查——每阶段停下等用户确认，未过 gate 不得进下一步】${scriptBlock}
阶段1 收料
- 确认资料齐备：项目名（缺就问，禁止编造）+ 剧本原文（已附/去要）+ 素材图（可选）；
- create_project({ title }) → 记住返回的 projectId。

阶段2 转剧本
- 优先 normalize_script({ content }) 出标准格式稿 + 报告（推荐；用户明确要求原样导入可跳过）；
- 先把差异给用户看：标准格式稿与报告数字（discardedSegments 不会入库，必须提示）；
- ▼ 停：等用户确认「开始导入」；
- import_script({ projectId, baseVersion, content, mode: "standard", strategy: "new_episode", dryRun: true }) 看 diff → 用户确认 → confirm: true 入库；
- 用户明确要求原样导入 → mode: "raw" 可直接入库（返回建议提示，不算失败）。

阶段3 提主体
- 从已入库剧本列主体清单（名称/类型/别名/形态/状态/出现集数/身份锚点句/图片来源），**逐主体给用户一张表**，不许只报名字；
- 每个主体逐个走：先 \`list_subjects\` 查重 → 有图先 \`read_asset\` 亲眼看 → 反推提示词 → 给用户确认；
- ▼ 停：等用户确认清单或补图（外观=身份锚点句：性别年龄+面部+发型+体型+服装+标志物；缺图给缺图清单，不许自己找图凑）；
- 确认后 upsert_subject（先 dryRun 再 confirm）→ set_subject_profile 按强制字段表（角色 16 项 / 场景 / 道具）
  生成三视图/场景宫格/道具标准提示词；有图先 read_asset，按图反推字段；
- 挂图必须 read_asset 看过 + 带反推 prompt 的 set_subject_image；多人合照/模特合集/别的角色图一律不许挂；写完 audit_subjects。

阶段4 拆分镜
- ▼ 停：等用户确认「可以拆」才动手（用户未确认拆，就停在阶段3，不擅自拆）；
- split_script_to_shots({ projectId, episodeId, baseVersion, dryRun: true }) 出片段草案 → 用户确认切分 → confirm: true 落盘；
- set_shot_prompt 补景别、时长（默认 5s）与 imagePrompt/videoPrompt 双轨提示词。

阶段5 出片前检查
- 运行前一次性检查槽位、缺图、时长，把结果报给用户；
- set_shared_params 装配并预览（⚠️ 禁止提交真实 GPU 生成任务，真实生成走前端/ComfyUI）；
- ▼ 停：等用户确认检查结果后，open_project 转前端完成导出。

细节规格：资源 zeroexo://guides/<key>。`;
}

// ---------- prompts 注册 ----------

export function registerGuidePrompts(server: McpServer): void {
  server.registerPrompt(
    "get_started",
    {
      title: "ZeroExoTV 冷启动引导",
      description: "新用户零安装上手：五阶段流水线，该问哪些资料、每阶段的停止条件。",
    },
    () => ({
      description: "ZeroExoTV 新用户冷启动引导（五阶段流水线 + 最少需要问的问题清单）",
      messages: [{ role: "user", content: { type: "text", text: GET_STARTED_TEXT } }],
    }),
  );

  server.registerPrompt(
    "produce_episode",
    {
      title: "生产一集：剧本 → 主体 → 分镜提示词 → 参数",
      description: "按生产技能合订本推进，每一步都有硬停止点；写提示词与参数前先读对应技能。",
    },
    () => ({
      description: "ZeroExo 生产流水线（技能合订本）",
      messages: [{ role: "user", content: { type: "text", text: skillsPipelineText() } }],
    }),
  );

  server.registerPrompt(
    "bootstrap_project",
    {
      title: "剧本 → 项目 五阶段引导走查",
      description: "从一段剧本原文走完 收料→转剧本（停等确认导入）→提主体→拆分镜（停等用户确认可以拆）→出片前检查 的分步模板。",
      // zod v3 raw shape 与 SDK ZodRawShapeCompat 结构兼容，做一次性断言（同 defTool 模式）
      argsSchema: {
        script_content: z.string().optional().describe("剧本原文（可选；给了就直接进入阶段2预览环节）"),
      } as unknown as ZodRawShapeCompat,
    },
    (args) => {
      const raw = (args as { script_content?: unknown })?.script_content;
      const scriptContent = typeof raw === "string" ? raw : "";
      return {
        description: "ZeroExoTV 剧本 → 项目 五阶段分步走查（阶段2/阶段4 有显式停止点）",
        messages: [{ role: "user", content: { type: "text", text: bootstrapProjectText(scriptContent) } }],
      };
    },
  );
}
