# ZeroExo 生产流水线（技能合订本）

按顺序执行；每一步的「停」是硬停止点，未过不得进下一步。

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
