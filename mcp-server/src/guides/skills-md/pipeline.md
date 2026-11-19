# ZeroExo 生产流水线（技能合订本）

按顺序执行；每一步的「停」是硬停止点，未过不得进下一步。

## 0.1 项目进度台账（每次进项目先读，不许全局扫盘）
- 进入/继续任何项目，第一步调用 `get_project_progress({ projectId })`：它一次返回剧本/主体/主体图/分镜/提示词/生成任务各阶段状态、缺什么、下一步该做什么。
- 按返回的 `nextActions` 推进；不要为了「看看有什么」去翻 projects/、assets/、workbench.json。
- 返回 `userAddedAssets` 非空时，**先把 `askUser` 的问题原样问用户**（想当主体图/场景图/参考图、挂到哪个主体或片段），不得自行归类、也不得忽略。
- 每次阶段完成后（补图、拆段、提示词、提交生成）重新调用一次，用返回的 `blockers` 向用户汇报「本轮还缺什么」，不要凭记忆复述进度。
- `get_project_progress` 已内联 `projectLog`（未完成需求 + 最近进度）；需要完整历史时再调 `get_project_log({ projectId })`。新会话不得再向用户重复索要已写在项目档案里的需求。
- 用户每提出一条新要求，先 `append_project_log({ kind:'requirement', text })`；确认一个口径写 `decision`；完成一个阶段写 `progress`，并把对应 requirement 用 `update_project_log_entry` 标 done。这是跨会话唯一的上下文，不要只在聊天里说完成。

## 0 收料与偏好（必须问，缺哪问哪）
- 资料：项目名、剧本原文、已有素材（图片/视频目录）。
- 偏好：风格口径（写实/古装/现代/色调）、画幅（16:9 / 9:16 / 1:1 …）、单段时长偏好（5–15s）、尺寸系数（scaleFactor）。
- 风格有争议（写实 vs 动画、3D vs 水墨）时必须给候选让用户选；组合技见 list_style_presets 的 combo 分类。
- 禁止替用户定这些；用户说「按默认」时才用默认。

## 1 剧本
- 读 zeroexo://skills/script-import。
- `create_project` → `preflight_import` → 把问题逐条问用户（集数/来源格式/主体资产/已有片段）→ `normalize_script` 或整理成标准剧本 → 用户确认 → `import_script(userConfirmed:true)`（英文/外部平台源还要 `sourceFormatConfirmed:true`）。
- ▼ 停：剧本未入库，不得提主体、不得拆分镜。

## 2 主体
- 读 zeroexo://skills/subjects。
- 逐主体给用户：名称/类型/别名/状态/出现集数/身份锚点句/图片来源 + 缺图清单 → 用户确认或补图 →
  `upsert_subject` → `read_asset` 看图 → 反推 prompt → `upload_asset` → `set_subject_image(prompt=…)`。
- ▼ 停：清单未确认，不得建主体/挂图；没 read_asset 看过、没反推 prompt，工具会直接拒。

## 3 分镜与提示词
- 读 zeroexo://skills/shots-prompts。
- **延续法（硬性）**：段长必须吸附 17k+5 帧、每段可见帧 + 22 引导帧 ≤ 736。
  先 plan_continuity_edit 出整张「段/帧/秒/是否接上一段」表给用户确认（confirm:true + userConfirmed:true），
  再 **request_director_run 提交到 ComfyUI 插件任务表**（MCP 不跑 GPU；MCP 按连续段 run 提交：每个 run 只发起始 guide，run 内由插件
  prevJobId 内循环续接，不逐段发送 guide；进度/最后一帧/结果都落盘，网页与 MCP 都查询）。
  分批选择时每个 run 的起始段各自取上一段当前缓存（3 吃 2、6 吃 5）；起始段没有可用 guide 按 none 生成，不拒绝。
  用 get_generation_task 查进度，不要用 run_generation 直接提交。
  照搬原稿段长、跳段、或只写「承上/接上一段」字样都算没做延续法，request_director_run 会直接拒绝。
- 没有现成提示词时：`scaffold_episode({ style, durationSec, sharedParams })` 直接从剧本产出占位主体 + 占位片段 + 提示词，并返回 missingAssets；**不要自己手写提示词，也不要抄别的项目**。
- 有素材后：`apply_shot_prompts({ style })` 按 references 真实槽位把 <Subject N> 重写成 @PictureN。
- 质量门 <7 分重写，不许交付。
- ▼ 停：用户没说「可以拆」，不拆。

## 4 参数
- 读 zeroexo://skills/params。
- 逐项向用户确认 aspect/scaleFactor/steps/cfg/seed/引导帧/每段时长；联调可用小参数，但必须先说清并在用户同意后使用。
- H3 默认口径：shift_video 12 / shift_audio 3、scheduler simple、sampler euler（Turbo 6–8 步 / 非 Turbo 20–25 步）；改动默认必须问用户。
- `set_shared_params` 写入，键位必须来自 DIRECTOR_PARAM_SCHEMA。
- ▼ 停：参数未确认，不得出片。

## 5 出片
- 出片前检查：槽位、缺图、超时长、total_frames 一致性，报给用户。
- 真实生成一律经 MCP 任务：request_director_run（导演台）/ generate_canvas_images（画布图片）；MCP 提交到 ComfyUI 插件任务表，插件执行，网页与 MCP 都查询/落库。导入后把 open_project 的 URL 给用户核对。


## 6 产物审核（Agent 在对话里做，网页没有审核页签）

开工前先调 **get_project_brief**：它把「项目记忆」（进度/决策/待办/待审核批次）与「任务队列」（生成任务状态）压成一屏，看完就知道做到哪、卡在哪、下一步是什么。不要靠聊天记忆复述项目，也不要拿旧结论当现状。

产出后按阶段开审核（open_artifact_review，stage 对应下列阶段），然后在聊天里列清单、请用户逐项评分；拿到答复再 decide_artifact_review 落盘。

| 阶段 stage | 产物 | 清单里给用户看什么 |
|---|---|---|
| concept 概念设计 | 场景概念图（每个地点的定调图） | 地点名 · 尺寸 · 预览图；问「风格/光线/构图对不对，采纳还是打回」 |
| subjects 主体生成 | 角色定妆、场景图、道具图 | 名称 · 类型 · 状态（定妆/概念图）· 预览；问「像不像、一致性够不够，1-5 分」 |
| script 剧本 | 分集剧本（场次/动作/台词） | 集号 · 场数 · 一句话摘要；问「节奏和台词要不要改」 |
| shots 剧本→分镜 | 每段分镜的提示词与槽位引用 | 段号 · 时长 · 槽位清单 · 提示词摘要；问「镜头与参考是否对得上」 |
| video 视频出片 | 每段成片 | 段号 · 时长 · 预览；问「这条能不能用」 |

规则：
- 采纳 = 正式入库；打回 = 真删（主体图同时从主体库与资产库移除，并自动登记「待重做」）。
- 回执写明：采纳几项、打回几项、删了几张、哪些进了待重做队列。
- 硬约束：未评分不得进下一阶段；「已生成」≠「已采纳」；打回不得只口头说说；打回的产物不得留在库里或继续被下游引用。
- ▼ 停：这一批没拿到用户评分，就停在这里等。

### 审核怎么在对话里做（没有内置 LLM API）
- 图片产物：对每张图调 **read_asset**，直接把图片内容块发在对话里（用户看得见），下面一行写「编号 · 名称 · 状态 · 尺寸」。
- 文本产物（剧本/分镜提示词）：贴摘要，长内容折叠成「前 2 句 + 段数/场数」。
- 一次最多列 6-8 项，多了就分批；每批结尾问「采纳还是打回（可给 1-5 分）」。
- 用户答复后调 decide_artifact_review：approved 落库；rejected 真删（主体图从主体库+资产库移除并自动登记待重做）。
- 网页只是容器：不要叫用户去网页看图或点按钮；网页「任务队列 > 项目记忆」只是给你和用户回看历史记录的。
