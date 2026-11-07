/**
 * 八模块规格 + 五阶段流水线——新用户零安装路径的单一数据源（纯 TS 常量，可 JSON 化）。
 * 消费方：server instructions（src/guides/instructions.ts 引用 PIPELINE_STAGES 拼装阶段文案）、
 * prompts（src/guides/register.ts）、resources zeroexo://guides/<key>、测试 test/guides.test.ts。
 * 内容依据：project-rules/docs/script-import-contract.md、src/tools/*.ts 工具 description、
 * zerovideoAgent 剧本规范要点（身份锚点句逐字复用 / 主体三表筛选原则）。
 */

/** 流水线阶段：分阶段逐步确认，未过 gate 不得进下一步 */
export interface PipelineStage {
  /** 阶段编号（1 起） */
  stage: number;
  /** 阶段名（收料 / 转剧本 / 提主体 / 拆分镜 / 出片前检查） */
  name: string;
  /** 本阶段做什么（正文） */
  action: string;
  /** 进入下一阶段的 gate；未满足即停（含「不满足条件不得进下一步」的硬条件） */
  gate: string;
}

/** 五阶段流水线（instructions / prompts 的阶段文案全部由此生成，避免两份漂移） */
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    stage: 1,
    name: "收料",
    action:
      "确认用户给的是原文/剧本/参考文件夹；列出缺什么（项目名？剧本原文？素材图？），缺哪样问哪样，禁止编造",
    gate: "项目名与剧本原文齐备才进阶段2",
  },
  {
    stage: 2,
    name: "转剧本",
    action:
      "优先 normalize_script 出标准格式稿+报告（推荐，非强制）；差异先给用户看；用户确认后 import_script(mode:'standard') 入库；用户明确要求原样导入时 mode:'raw' 可直接入库（返回建议提示）；dryRun/confirm 纪律不变",
    gate: "用户确认转换结果且剧本入库后才进阶段3——未入库不得提主体、不得拆分镜",
  },
  {
    stage: 3,
    name: "提主体",
    action:
      "从已入库剧本列主体清单（名称/可能状态/出现集数）→ 先给用户确认或补图（外观=身份锚点句：性别年龄+面部+发型+体型+服装+标志物，锁定后同场景逐字复用），再 upsert_subject / set_subject_image 建主体与状态",
    gate: "主体清单经用户确认才建状态、才进阶段4——清单未确认不得 upsert、不得建状态",
  },
  {
    stage: 4,
    name: "拆分镜",
    action:
      "必须等用户明确说「可以拆」之后，才 split_script_to_shots 进导演台并生成提示词（先 dryRun 出草案→用户确认切分→confirm 落盘），再 set_shot_prompt 补景别、时长（默认 5s）与双轨提示词",
    gate: "用户没说拆不动手——剧本未入库不得拆分镜；草案未确认不得 confirm",
  },
  {
    stage: 5,
    name: "出片前检查",
    action:
      "运行前一次性检查槽位、缺图、时长并报给用户；set_shared_params 装配并预览——⚠️ 禁止提交任何真实 GPU 生成任务（真实生成走前端/ComfyUI）；导出用 open_project 打开前端编辑器完成",
    gate: "检查结果经用户确认才导出",
  },
];

/** 单模块规格 */
export interface ModuleSpec {
  /** 模块 key（资源 URI 后缀）：zeroexo://guides/<key> */
  key: string;
  /** 模块名 */
  name: string;
  /** 一句话用途 */
  purpose: string;
  /** 必须准备的输入（缺了必须回头问用户，不许编造） */
  requiredInputs: string[];
  /** 可选输入 */
  optionalInputs: string[];
  /** 标准流程顺序（1 起） */
  order: number;
  /** 所属流水线阶段（1-5，见 PIPELINE_STAGES） */
  stage: number;
  /** 本模块可用的 MCP 工具 */
  mcpTools: string[];
  /** 注意事项 / 禁止事项（首条 = 前置阶段 gate，未满足即停） */
  caveats: string[];
}

export const GUIDE_URI_PREFIX = "zeroexo://guides/";
export const GUIDE_INDEX_URI = "zeroexo://guides/index";

export const MODULE_SPECS: ModuleSpec[] = [
  {
    key: "project",
    name: "项目（Project）",
    purpose: "视频项目管理的容器：create_project 写 projects.json 信封 + 建 projects/<id>/entities 目录骨架（画布 graph 留前端首开自建）。",
    requiredInputs: [
      "项目名 title（非空；必须问用户，禁止自行编名）",
    ],
    optionalInputs: [
      "标签 tags（字符串数组，项目分类/检索用）",
    ],
    order: 1,
    stage: 1,
    mcpTools: [
      "list_projects", "get_project", "open_project", "create_project",
      // 画布是项目的一等挂载物（Spec v2 / 征集#184）：1 号主画布 + N 份副本均属本项目
      "list_canvases", "get_canvas", "patch_canvas_nodes",
    ],
    caveats: [
      "前置阶段1 收料：项目名必须用户给出（gate：项目名与剧本原文齐备才进阶段2）",
      "create_project 只写项目信封与目录骨架，不写画布 graph（前端首开自建）",
      "open_project 返回前端编辑器 URL（#/editor/<id>），可直接给用户点开核对",
      "list_projects / get_project 按 token 作用域过滤：看不到不等于不存在",
      "画布存在 projects/<pid>/canvases/*.json（副本，裸 JSON）；1 号主画布的图在 .lf/zeroexo/graph_data/zeroexo:graph:<pid>.json。用 list_canvases / get_canvas 读（**1 号也可读**），patch_canvas_nodes 只能改**副本**里既有节点的 data/title/position；**1 号对 MCP 只读**（前端防抖自动保存，外部写会互相覆盖），且**不得自己拼 graph 结构写盘**（节点/连线增删属前端命令语义，裸写容易造坏图）。",
    ],
  },
  {
    key: "episodes",
    name: "剧集（Script / Episodes）",
    purpose: "剧本剧集管理：列出剧集、读取剧集全文（HTML content + version）、新建剧集。",
    requiredInputs: [
      "projectId（建项目后获得）",
      "（新建剧集时）baseVersion：script.json 当前 version；0 = 剧本尚不存在时创建",
    ],
    optionalInputs: [
      "episodeId（读取指定剧集；缺省读 activeEpisodeId）",
      "title（新剧集标题；缺省「第N集」，number 自动 = max+1）",
      "content（初始正文；正文一般不手写，走 script 模块导入）",
      "logline / tags / publishNote（set_episode_meta 写本集信息卡：一句话介绍 / 推荐标签 / 发布建议）",
    ],
    order: 2,
    stage: 2,
    mcpTools: ["list_episodes", "get_script", "create_episode", "update_episode", "patch_episode", "merge_episode", "set_episode_meta", "set_script_meta"],
    caveats: [
      "前置阶段2 转剧本：get_script 的 version 是剧本写操作 baseVersion 的唯一来源（gate：mode 未确认不得 import）",
      "剧本正文优先走 script 模块（normalize_script / import_script）导入，不手敲 HTML",
      "本集信息卡（set_episode_meta）是剧本页右侧抽屉展示的发布信息，不写进正文",
    ],
  },
  {
    key: "script",
    name: "剧本导入（Script Import）",
    purpose: "软件只校验格式；规范化属于 MCP 流程：优先 normalize_script 转标准格式，import_script 的 mode 决定标准稿(standard)/原文(raw)入库。",
    requiredInputs: [
      "projectId",
      "剧本原文 content（非空；问用户要原文，禁止替用户改写）",
      "mode：'standard'（已符合规范，直接入库，必填）；'raw'（原文直接入库，返回「先 normalize_script」建议，不报错）",
      "strategy：'new_episode'（新建剧集）| 'append'（追加到指定剧集）| 'overwrite'（全量覆盖，自动备份到 entities/backups/）",
      "baseVersion（script.json 当前 version）",
      "dryRun:true 或 confirm:true（显式其一：dryRun 返回 diff，confirm 才入库）",
    ],
    optionalInputs: [
      "episodeId（append / overwrite 时指定目标剧集）",
      "title（新剧集标题）",
    ],
    order: 3,
    stage: 2,
    mcpTools: ["normalize_script", "import_script"],
    caveats: [
      "脚本规范化属于 MCP 流程，软件只做校验",
      "前置阶段2 转剧本：normalize_script 预览→用户确认→dryRun→confirm（gate：剧本未入库不得提主体、不得拆分镜）",
      "先把标准格式稿与报告数字给用户看（discardedSegments 不会入库，必须原样展示供确认）",
      "mode 与 strategy 正交：mode 管文本形态（standard 规范化稿 / raw 原样稿，均允许入库），strategy 管落点，互不默认",
      "标准剧本格式：# 剧名 / ## 第N集：标题 / ### 第M场：场景名 · 内|外 · 日|夜 / 动作行 / 角色名：台词 / [主体 @名称]",
    ],
  },
  {
    key: "subjects",
    name: "主体（Subjects）",
    purpose: "角色/场景/道具三类主体的唯一事实源（storyboard.json）：名称、别名、身份锚点、状态图、与片段的关联。",
    requiredInputs: [
      "projectId",
      "name 主体名称（从剧本提取后必须列清单让用户确认）",
      "kind：'character' | 'scene' | 'prop'",
      "（character 必备）外观描述 note——身份锚点句：性别年龄 + 面部特征 + 发型 + 体型 + 服装 + 标志物，一句话封装",
      "baseVersion（storyboard.json 当前 version；0 = 主体库不存在时创建）",
    ],
    optionalInputs: [
      "aliases 别名数组（剧本内多个称呼归并到同一主体）",
      "episodeIds 关联剧集",
      "状态图：先 upload_asset 拿 storageKey，再 set_subject_image 挂 images[]（stateTag=状态名，如「定妆」）；画布里的图先 import_media_to_cas 转 CAS",
    ],
    order: 4,
    stage: 3,
    mcpTools: ["list_subjects", "upsert_subject", "set_subject_image", "link_subject_to_shot"],
    caveats: [
      "前置阶段3 提主体：主体清单（名称/可能状态/出现集数）先给用户确认或补图（gate：清单未确认不得 upsert、不得建状态，不得进阶段4）",
      "身份锚点句一经锁定，同场景所有提示词逐字复用；改写 = 视觉漂移",
      "场景只收录 ≥2 场复用或承载关键剧情的；道具只收有剧情推动或象征意义的（通常一部短片 0-5 个）",
      "link_subject_to_shot 可先 matchByName 拿候选清单（不写盘），再给 subjectId 直写",
    ],
  },
  {
    key: "assets",
    name: "资产（Assets / CAS）",
    purpose: "内容寻址资产库：upload_asset 按 SHA-256 去重落 media/cas/，挂到主体状态图或导演台槽位。",
    requiredInputs: [
      "projectId",
      "filename 文件名（决定扩展名）",
      "dataBase64 文件内容（base64）",
      "mime 类型（如 image/png）",
    ],
    optionalInputs: [
      "name 挂槽时的显示名",
      "shotId 挂到指定片段槽（不给 shotId 则挂公共槽 1..K，片段槽 K+1 续排）",
      "baseVersion（attach_asset_to_slot 需要，= workbench version）",
      "scope（list_assets）：'project'（本项目引用）| 'library'（全局去重视图）",
    ],
    order: 5,
    stage: 3,
    mcpTools: ["list_assets", "upload_asset", "attach_asset_to_slot", "read_asset", "import_media_to_cas", "ingest_storyboard_images"],
    caveats: [
      "前置阶段3 提主体 / 阶段4 拆分镜：状态图挂主体属阶段3（用户补图确认后），槽位挂片段属阶段4（拆分镜落盘后）；gate：无 storageKey 不得挂",
      "upload_asset 返回 storageKey='cas:<hash>.<ext>'，是 set_subject_image / attach_asset_to_slot 的唯一钥匙",
      "SHA-256 去重：同文件重复上传仅 refCount+1，不产生新文件",
      "ingest_storyboard_images 是分镜图比对预览：M1 一律不落盘（返回 pending_confirm 清单），确认后走 upload_asset + attach_asset_to_slot",
      "槽位超限返回 SLOT_OVERFLOW，不许静默挤掉已有资产",
    ],
  },
  {
    key: "segments",
    name: "导演台片段（Director Track / Segments）",
    purpose: "导演台（workbench.json）：公共参数 sharedParams、片段序列 shots、每片段双轨提示词与景别/时长。",
    requiredInputs: [
      "projectId",
      "（拆分镜）episodeId：要拆的剧集",
      "（落盘）baseVersion：workbench version（dryRun 时可为 0）",
      "片段切分草案须经用户确认：split_script_to_shots 先 dryRun:true 出草案清单",
    ],
    optionalInputs: [
      "每片段 description 描述 / shotType 景别（远|全|中|近|特）/ duration 时长秒（默认 5）",
      "sharedParams：presetId（'h3' | 'sd2.5'）/ params（不存在公共提示词字段，重复内容直接写每段提示词）",
      "imagePrompt / videoPrompt 双轨提示词",
    ],
    order: 6,
    stage: 4,
    mcpTools: ["get_workbench", "split_script_to_shots", "add_segment", "set_shared_params", "set_shot_prompt"],
    caveats: [
      "前置阶段4 拆分镜：必须等用户明确说「可以拆」才 split（gate：剧本未入库不得拆分镜；草案未确认不得 confirm）",
      "标准拆分镜顺序：split_script_to_shots dryRun:true → 用户确认切分 → confirm:true + 最新 baseVersion 落盘",
      "片段属性写具体可观察项：景别、运镜（自然语言）、时长秒数；禁形容词汤",
      "双轨提示词：imagePrompt 管首帧画面，videoPrompt 管运动与变化；同场景身份锚点逐字复用",
      "写前 get_workbench 重读 version；遇 VERSION_CONFLICT 重读再写，不盲目重试",
    ],
  },
  {
    key: "run",
    name: "运行（Run / 生成参数装配）",
    purpose: "生成参数装配与预览：把片段 + 主体锚点 + 公共参数组装成可执行的生成参数，供前端/ComfyUI 侧执行。",
    requiredInputs: [
      "projectId",
      "片段就绪：shots 已有 description / 时长 / 双轨提示词",
      "主体锚点已锁定：身份锚点句在同场景所有片段提示词中逐字一致",
    ],
    optionalInputs: [
      "presetId（'h3' | 'sd2.5'）",
      "params 模型参数对象（分辨率/帧率等）",
    ],
    order: 7,
    stage: 5,
    mcpTools: ["get_workbench", "set_shared_params", "set_shot_prompt"],
    caveats: [
      "前置阶段5 出片前检查：运行前一次性检查槽位/缺图/时长并报给用户（gate：禁止提交任何真实 GPU 生成任务——本 MCP 只做参数装配与预览，真实生成由前端 / ComfyUI 执行）",
      "装配结果先给用户过目（dryRun / 预览），不静默默认参数",
      "同场景所有片段提示词中，身份 / 服装 / 光线方向字符串必须逐字一致",
    ],
  },
  {
    key: "export",
    name: "导出（Export）",
    purpose: "成片 / 导演包导出。M1 阶段 MCP 无专用导出工具（export_director_pack 规划在 M2），用 open_project 转到前端完成。",
    requiredInputs: [
      "projectId",
      "导出范围与目标格式（哪些片段 / 剧集、什么格式）——必须用户确认",
    ],
    optionalInputs: [],
    order: 8,
    stage: 5,
    mcpTools: ["open_project"],
    caveats: [
      "前置阶段5 出片前检查：检查结果经用户确认才导出（gate：用户未确认不导出）",
      "M1 无导出工具：open_project 打开前端编辑器（#/editor/<id>）完成导出",
      "导出前确认全部片段状态就绪；不替用户拍板导出范围",
    ],
  },
];

/** 全部模块 key（= 资源 URI 后缀） */
export const MODULE_KEYS: string[] = MODULE_SPECS.map((m) => m.key);

export function getModuleSpec(key: string): ModuleSpec | undefined {
  return MODULE_SPECS.find((m) => m.key === key);
}

/** 流水线阶段文案（instructions / prompts 共用，单一数据源） */
export function pipelineStagesText(): string {
  return PIPELINE_STAGES.map((s) => `阶段${s.stage} ${s.name}：${s.action}。gate：${s.gate}。`).join("\n");
}

/** index 资源内容：模块清单（含各自资源 URI 与必备资料速览） */
export interface GuideIndexEntry {
  key: string;
  name: string;
  purpose: string;
  order: number;
  stage: number;
  uri: string;
  requiredInputs: string[];
}

export function guidesIndex(): { uri: string; moduleCount: number; stages: PipelineStage[]; modules: GuideIndexEntry[] } {
  return {
    uri: GUIDE_INDEX_URI,
    moduleCount: MODULE_SPECS.length,
    stages: PIPELINE_STAGES,
    modules: MODULE_SPECS.map((m) => ({
      key: m.key,
      name: m.name,
      purpose: m.purpose,
      order: m.order,
      stage: m.stage,
      uri: `${GUIDE_URI_PREFIX}${m.key}`,
      requiredInputs: m.requiredInputs,
    })),
  };
}

/** 单模块资源内容（JSON 文本） */
export function moduleSpecText(spec: ModuleSpec): string {
  return JSON.stringify(spec, null, 2);
}

/** index 资源内容（JSON 文本） */
export function guidesIndexText(): string {
  return JSON.stringify(guidesIndex(), null, 2);
}
