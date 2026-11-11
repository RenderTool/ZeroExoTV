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

const SCRIPT_IMPORT = `# 技能：剧本落地（script-import）

> 适用：用户给了剧本原文 / 音频转写稿 / 分镜 Markdown，要进「剧本」页签。

## 0. 先预检，再问人（强制，2026-11-10）

调 preflight_import({ projectId, sourceText })（只读），把它返回的 questions 逐条问用户：

- 来源格式：英文/外部平台原文要不要按 ZeroExo 的「场次 + 动作 + 台词」重排？
- 集数：这次导入成几集（原文检测到哪些分集标记）？
- 主体资产：要不要先把角色/场景/道具和定妆图导进主体库？
- 导演台已有片段：保留、追加还是重建？

用户答复后才继续。真实写入 import_script 必须 userConfirmed:true；英文/外部平台源还要 sourceFormatConfirmed:true（缺了会 CONFIRM_REQUIRED）。

## 1. 先定形态

| 输入 | 处理 |
|---|---|
| 标准剧本（\`# 剧名 / ## 第N集：标题 / ### 第M场：场景 · 内|外 · 日|夜 / 动作行 / 角色：台词\`） | \`normalize_script\` 校验 → 用户确认 → \`import_script(mode:"standard")\` |
| 原始小说/转写稿 | \`normalize_script\` 出标准稿 + 报告，把 discardedSegments 原样给用户看 |
| 已有分镜 Markdown（\`## A-01 段：…（约12秒）\`，含 subject_definitions / detailed_description） | 剧本正文按「场」结构整理成标准剧本导入；分镜段不要塞进剧本，走 \`shots-prompts\` 技能进导演台 |

## 2. 硬规则

1. **不替用户改剧情**：事件链、人物关系、结局、台词一字不改；只做格式整理与 ASR 错字清洗，清洗对照表给用户看。
2. **一问一停**：mode（standard/raw）、strategy（new_episode/append/overwrite）必须由用户选，禁止默认。
3. **HTML 由 MCP 转**：\`import_script\` 会把纯文本转成编辑器认识的 \`<p class="script-scene-heading|script-action|script-character|script-dialogue">\`；直接塞 Markdown 会在页面里塌成一段——这是历史事故，别再犯。
4. **导入前给数字**：集数、场数、角色数、动作行数、被丢弃段落，先给用户确认再 confirm。
5. **覆盖前必留备份**：overwrite 会自动备份到 \`entities/backups/\`，但必须先 dryRun 给用户看 diff。
6. **改一集里的一两句：用块级编辑，不要整篇回传**：\`get_script\` 返回 \`blocks\`（index/kind/text），
   用 \`patch_episode({ ops:[{op:"replace",index,blocks:[…]}] })\` 只传改动块；append/insert/delete 同理。
   \`import_script(overwrite)\` 是整篇重写，只给「整集重排/重写」用，日常改稿别用（既费 token 又容易覆盖并发改动）。
   多块一起改放同一批 ops（一次写盘、一个版本号）。

## 3. 标准剧本写法（一次写对）

编辑器只有六种块：场次 / 动作 / 角色 / 台词 / 括注 / 转场，**没有「标题」块**。
所以正文里不要写剧名、集名——它们属于元信息：

- 剧名 → \`ScriptEntity.title\`（导入时从首行 \`# 剧名\` 提取，写了也不会进正文）
- 集名 → \`Episode.title\`（\`## 第N集：标题\` 同样被提取）

\`\`\`
### 第1场：莱州官道 · 外 · 夜
深夜的官道，冻硬的黄土路面延伸到夜色深处。
张秀才：天黑路杂，又没有旅店，让我如何走得出去？
### 第2场：破庙大殿 · 内 · 夜
供案上一盏油灯昏昏暗暗。
老僧：你快去别处借宿吧，此地不宜久留。
[主体 @张秀才]
\`\`\`

- 场次标题必须带 \`内/外\` 与 \`日/夜\`，引擎按它定光位与时段。
- \`角色：台词\` 用全角冒号；同一角色名全片逐字一致（别名在主体库归并，不在剧本里换写法）。
- \`[主体 @名称]\` 是给主体库的绑定线索，每场至少标一次出场主体。
- 旁白不写进「角色：台词」，旁白单独整理成动作行或独立条目（视频不许有人声旁白）。`;

const SUBJECTS = `# 技能：主体库（subjects）

> 适用：剧本已入库，要把角色/场景/道具做成可复用的主体与状态图。

## 1. 收录标准（宁缺勿滥）

- **角色**：全部主要角色都要；同一角色多形态（美艳/恶鬼）做成**同一主体的多张状态图**，不要建两个主体。
- **场景**：≥2 场复用或承载关键剧情的才收；一次性过场不收。
- **道具**：只收有剧情推动或象征意义的（一部短片通常 0–5 个）。

## 2. 身份锚点句（外观锁）

一句话封装：性别年龄 + 面部特征 + 发型 + 体型 + 服装 + 标志物。

- 例：\`张秀才，明代书生，二十余岁，身形清瘦，面白无须，束发戴儒巾，青布直裰，腰间系素色布带。\`
- **锁定后同场景所有提示词逐字复用**；改写 = 视觉漂移，不许「换个说法更通顺」。
- 朝代/服制必须写死（明代束发戴巾、僧人不冠），否则会漂到隔壁朝代。

## 3. 图片规格

| 类型 | 规格 | 说明 |
|---|---|---|
| 角色定妆 | 16:9，画面固定 3 个：正面大头特写 + 正面全身 + 背面全身 | 一张图锁脸+服；多形态各一张（stateTag=美艳/恶鬼/定妆）；不要写「三视图」，模型会自己加侧视图 |
| 场景 | 4:3，2×2 宫格，空场景 | 每段只投一格；宫格裁切顺序：左上=视角1 右上=视角2 左下=视角3 右下=视角4 |
| 道具 | 单品居中 | 干净背景，无手无人物 |

## 4. 落地步骤

1. \`upsert_subject({ name, kind, aliases, note:身份锚点句 })\` —— 先 dryRun，清单给用户确认后才写。
2. \`upload_asset({ filename, dataBase64, mime, refId:"subject-state:<subjectId>/<state>" })\` → 拿 \`storageKey\`。
   **默认只落 CAS，不建素材记录**：主体图属于主体库，进素材页就会变成「一张图两处显示」。只有要给片段当素材用的图才加 \`toLibrary:true\`。
3. \`set_subject_image({ subjectId, storageKey, stateTag, cover:true })\` —— 第一张设为封面。
4. 关联片段：\`link_subject_to_shot({ shotId, subjectId, state })\` —— 写进片段 references，页面上才看得到缩略图；同一片段最多 9 张参考图。

> 只建主体不挂图 = 页面上是个空壳；只挂图不 link = 生成本段时用不上；把主体图也塞进素材库 = 同一张图两处出现。三步都要走，素材库那一步不要走。`;

const SHOTS_PROMPTS = `# 技能：分镜与视频提示词（shots-prompts）

> 适用：剧本已入库、主体已建，要把剧本变成导演台片段与可直接投喂的提示词。

## 1. 片段怎么切

- 一个连续动作 = 一个镜头；场景切换、视角大变、情绪转折 = 新镜头。
- 单段时长 5–15 秒（质量建议）；节点硬上限 736 帧 ≈ 30.7s@24fps。
- 时长判定：环境空镜 4–6s；单角色简单动作 5–8s；复杂动作链 8–12s；对白 = 朗读秒数 + 2s 缓冲；大幅运镜 +3–5s。
- 相邻镜头景别至少差两档（刻意匹配除外）。

## 2. 提示词体例（无旁白版，H3 Ref2VA 单块中文版）

每段两轨：

- \`imagePrompt\`：\`<Subject N> 是本段场景/角色，取自 @图片N（哪个格）：只作空间结构/材质/光位基准，不锁首帧、不锁构图。\`
- \`videoPrompt\`：五段式正文——
  \`\`\`
  画面为干净画面：无字幕、无字卡、无屏显文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
  [Shot 1] <景别·角度·运镜·焦段·景深>。<空间锁定一句>。<主体动作，带终点态>。声音：<同期声>。
  旁白/台词只进 <d>[Chinese] …</d>，描述里不重复。
  \`\`\`
- \`negativePrompt\`：只写本镜真实风险的实例（no plastic, no wristwatch, no printed logos），不写「no modern objects」这种范畴词。

## 3. 十二条铁律（输出前自查）

1. 叙事功能优先：没有叙事功能的镜头删掉。
2. 先调度后构图：先定身体在空间里做什么，再放机位。
3. 每镜头一个主运镜；「不运镜」是合法选择。
4. 每个动作有终点态（「转身直到侧脸贴上窗边，停住」）。
5. 写行为不写情绪；恐惧写成眼神/呼吸/手。
6. 连续性靠工程：身份、服装、光位方向、年代、地点，同场景逐字重复。
7. 关键帧是控制点：先修静帧，再花视频额度。
8. 匹配模型控制面，不要向模型要它没有的能力。
9. 负面词指名实例。
10. 一次只套一个风格。
11. 要一条就给一条 + 至多三行理由。
12. 旁白不进视频、音频不带人声（H3 会把人声对到角色嘴上）。

## 4. 质量门（低于 7 分重写）

叙事功能 / 空间可读 / 动作终点 / 镜头语言一致 / 连续性 / 负面词有效 / 时长合规 / 台词规范 / 声音设计 / 无形容词汤——逐项 0–1 分，总分 <7 不许交付。

## 5. 落地

0. **没有现成提示词时（从零）**：\`scaffold_episode({ style:{look,aspect}, durationSec, sharedParams })\`
   —— 工具按剧本场次建占位主体 + 占位片段 + 按槽位约定生成提示词，并返回 \`missingAssets\`；
   把缺图清单原样交给用户（哪些角色要定妆图、哪些场景要宫格图），由用户出图或用画布生成后导入。
1. **素材到位后**：\`apply_shot_prompts({ style })\` 按片段 references 的真实槽位重写提示词，
   \`<Subject N>\` → \`@PictureN\`；N 必须等于 references 里同类素材序号（引擎把第 N 张落成 PictureN）。
2. 手工微调才用 \`set_shot_prompt\`；不要整段重写工具已生成的骨架，改动作/声音即可。
3. 收尾用 \`get_workbench\` 核对：每段有 imagePrompt、有 references、时长与分镜一致。`;

const PARAMS = `# 技能：参数与 H3 延续法（params）

> 适用：片段与提示词都齐了，要装配公共参数、准备出片。

## 1. 参数键位（写错键 = 页面参数面板读不到）

\`set_shared_params({ presetId:"h3", params:{…} })\` 的键必须来自 DIRECTOR_PARAM_SCHEMA：

- 画面：\`aspect\`（16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9）、\`scaleFactor\`（0.1–2，像素量倍数：×1 = 0.4MP = 864×480），
  同步落 \`width\`/\`height\`（官方 MP 公式：面积 = 0.4MP×系数×1024²，按比例开方后 32 对齐；×0.5 = 608×352、×1.5 = 1056×608）。
- 采样：\`steps\`、\`cfg\`、\`seed\`、\`sampler\`、\`scheduler\`、\`shift_video\`、\`shift_audio\`、\`frame_rate\`（恒 24）。
- 时长：\`total_frames\`（24fps，17k+5 吸附：8s=192 / 10s=243 / 12s=294 / 15s=362）。
- 引导：\`continuityEnabled\`（主开关）、\`continuityOverlapFrames\`（5/22/39/56，默认 22）、\`continuityMode\`（guide|continue）、\`continuityRedraw\`（0.10）、\`refImageSize\`（match|1024|1280|1536|max）。
- 其它：\`task_type\`、\`exportMode\`、\`audioMode\`、\`commonEnabled\`、\`cache_frames_codec\`。

**禁止自造键**（width/frames/guide_frames 这种在旧 handoff 里出现过的写法），页面参数面板只认上面这套。

## 2. 参数必须问用户（硬规则）

- 生产值不许模型自定：\`aspect\`、\`scaleFactor\`、\`steps\`、\`cfg\`、\`seed\`、\`continuityOverlapFrames\`、每段时长，逐项确认后才写。
- 用户说「按默认」时才用：16:9 / 864×480 / steps 8 / cfg 1.0 / seed 0 / 引导 22 帧。

### 图片（QwenImage2.1）与视频不是一套默认

- **图片默认 25 步**（视频才是 8 步），cfg 1.0；用户说「按默认」才用这组。
- 尺寸：最长边 ≤2048、16 对齐；有参考图可「跟随原图」，否则按比例选 1K/2K 档。**用户必须明确说尺寸或明确同意推荐值**，不要替他拍板。
- 提示词：有输入图时必须点名「参考图1」（前端已自动加前缀），否则 Qwen 会当文生图重画；角色定妆写死「画面共几个」（正面特写 + 正面全身 + 背面全身，共 3 个画面），不要写「三视图」这类会诱导模型加侧视图的名字。

## 3. 自检/联调用小参数（用户明确同意后才用）

联调只验链路，不验画质，**越小越快**：

\`\`\`json
{ "aspect": "16:9", "scaleFactor": 0.5, "width": 608, "height": 352,
  "total_frames": 49, "steps": 1, "cfg": 1.0, "seed": 1,
  "continuityEnabled": false, "continuityOverlapFrames": 22, "frame_rate": 24 }
\`\`\`

## 4. H3 延续法机制（决定段怎么切）

代码依据 engine/segment_continuity.py：

| 项 | 值 / 行为 |
|---|---|
| 上下文帧 | continuityOverlapFrames，5/22/39/56，默认 22；锁定帧 = 17k+5 吸附(overlap) |
| 锁帧 | 前「锁定帧」帧是硬锁（mask=1.0，无羽化），只作条件延续 |
| 燃烧帧 | 锁帧后 12 帧（CONTINUITY_SETTLING_FRAMES），防 hold→pop |
| 前瞻 | 段末 8 帧（CONTINUITY_SOURCE_LOOKAHEAD），仅为对齐覆盖 |
| 采样/导出 | 采样 = 17k+5(锁帧 + 12 + 可见 + 8)；导出只留可见帧，段间首尾直拼 |
| 模式 | guide（默认，前段作条件引导）/ continue（latent 续接，is_continue_mode() 仅在 continuityMode=continue 时为真） |
| 重绘比 | continuityRedraw，默认 0.10，从 timeline.output.continuityRedraw 读 |

写法结论（两种模式一样）：提示词正文不写接缝/承上/上一段落幅这类调度词——接缝由引擎锁定帧实现，写进正文反而干扰。
差异只在参数：continuityEnabled / continuityMode / continuityOverlapFrames / continuityRedraw。



## 5. 出片前检查（报给用户，不擅自跑）

槽位是否超限（图 ≤9 / 音 ≤3 / 视 ≤3）、缺图主体、超时长片段、total_frames 与段时长是否一致、seed 是否重复；确认后由用户在前端点运行。`;

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
  return `# ZeroExo 生产流水线（技能合订本）

按顺序执行；每一步的「停」是硬停止点，未过不得进下一步。

## 0 收料与偏好（必须问，缺哪问哪）
- 资料：项目名、剧本原文、已有素材（图片/视频目录）。
- 偏好：风格口径（写实/古装/现代/色调）、画幅（16:9 / 9:16 / 1:1 …）、单段时长偏好（5–15s）、尺寸系数（scaleFactor）。
- 禁止替用户定这些；用户说「按默认」时才用默认。

## 1 剧本
- 读 zeroexo://skills/script-import。
- \`create_project\` → \`preflight_import\` → 把问题逐条问用户（集数/来源格式/主体资产/已有片段）→ \`normalize_script\` 或整理成标准剧本 → 用户确认 → \`import_script(userConfirmed:true)\`（英文/外部平台源还要 \`sourceFormatConfirmed:true\`）。
- ▼ 停：剧本未入库，不得提主体、不得拆分镜。

## 2 主体
- 读 zeroexo://skills/subjects。
- 列主体清单（名称/形态/出现场次）→ 用户确认或补图 → \`upsert_subject\` → \`upload_asset\` → \`set_subject_image\`。
- ▼ 停：清单未确认，不得建主体/挂图。

## 3 分镜与提示词
- 读 zeroexo://skills/shots-prompts。
- **延续法（硬性）**：段长必须吸附 17k+5 帧、每段可见帧 + 22 引导帧 ≤ 736；第 2 段起吃上一段尾帧。
  先 plan_continuity_edit 出整张「段/帧/秒/是否接上一段」表给用户确认（confirm:true + userConfirmed:true），
  再逐段串行 run_generation（从第 1 段开始，禁止跳段/并行），每段成功立刻 sync_job_results。
  照搬原稿段长、跳段、或只写「承上/接上一段」字样都算没做延续法，run_generation 会直接拒绝。
- 没有现成提示词时：\`scaffold_episode({ style, durationSec, sharedParams })\` 直接从剧本产出占位主体 + 占位片段 + 提示词，并返回 missingAssets；**不要自己手写提示词，也不要抄别的项目**。
- 有素材后：\`apply_shot_prompts({ style })\` 按 references 真实槽位把 <Subject N> 重写成 @PictureN。
- 质量门 <7 分重写，不许交付。
- ▼ 停：用户没说「可以拆」，不拆。

## 4 参数
- 读 zeroexo://skills/params。
- 逐项向用户确认 aspect/scaleFactor/steps/cfg/seed/引导帧/每段时长；联调可用小参数，但必须先说清并在用户同意后使用。
- \`set_shared_params\` 写入，键位必须来自 DIRECTOR_PARAM_SCHEMA。
- ▼ 停：参数未确认，不得出片。

## 5 出片
- 出片前检查：槽位、缺图、超时长、total_frames 一致性，报给用户。
- 真实生成由用户在前端点运行（或明确授权后走 ComfyUI 的 /zeroexo/v1/jobs）；导入后把 open_project 的 URL 给用户核对。
`;
}
