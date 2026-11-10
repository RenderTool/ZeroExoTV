# 交接：MCP 契约/技能层收尾（下一会话直接执行）

> 上一会话上下文耗尽。本文件自包含：现状、待办、命令、验收口径。不要重新讨论方向，直接做。

## 一、服务与数据

| 服务 | 地址 | 起法 |
|---|---|---|
| 网页 dev | http://localhost:5180 | `cd D:\AICode\zeroexo\zeroexo-comfyui; pnpm run dev`（顺带拉起 8790 fs-server） |
| fs-server | http://127.0.0.1:8790 | 由 Vite 自动拉起 |
| ComfyUI | http://127.0.0.1:8188 | `cd D:\ComfyUI\ComfyUI_windows_portable; .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --fast fp16_accumulation`（**改插件代码才重启，其他情况不要重启**） |
| MCP | http://localhost:8787/mcp | `cd mcp-server; $env:ZEROEXO_MCP_TOKEN='zxp_e2e_smoke_token'; node dist/index.js --http` |

数据根 `D:\Test`。项目：
- `z6GrKXXM6HxK`（ZX_TEST_E2E）：剧本 1 集/11 场（HTML 块，标题已剥离）、主体 16（全有图，图只在 CAS+主体库，不进素材库）、导演台 35 段（官方四段式提示词、references 带 `@PictureN`、32 键参数：16:9 / scaleFactor 0.5（当时显示 432×240；现按官方 MP 表为 608×352）/ 49 帧 / steps 1 / seed 1）。
- `B52u16jvXDD1C04ZDn1GD`（test）：旧数据，勿动。

构建：`cd mcp-server; node node_modules/typescript/bin/tsc -p tsconfig.json`（**不要用 pnpm build**，会触发 install 失败）。
**编辑 .ts 文件必须用 write/edit 工具，禁用 PowerShell 的 Set-Content/Get-Content 回写**（会把中文写成乱码）。

## 二、本会话已完成

1. 插件（`D:\ComfyUI\...\custom_nodes\ComfyUI_ZeroExoNodes`）：
   - 补 `lib/`、`nodes/conditioning.py`；`__init__.py` 重写为正常 UTF-8；
   - jobs 改走 `POST /prompt`，`GET /jobs/{id}` 按 `/history` 回填 video+guide（frames/sha256）；
   - `ref_video.py`：executor 10 元组解包、guide 路径服务端预分配、`editMode=global` + 有参考图时 `commonEnabled=true`（否则 r2v 退化成 t2v）。
2. MCP 数据契约（对齐前端）：剧本导入转 `<p class="script-*">` 并剥离 `# 剧名` / `## 第N集` 到 title 字段；`upload_asset` 默认只落 CAS（`toLibrary:true` 才进素材库，`refId` 传 `subject-state:<id>/<state>`）；片段 `references` 用 WorkbenchShotReference 形状；`tracks/track-main/clips` 随片段重建；`set_shared_params` 先铺 32 键默认；前端 CAS 自愈跳过 `subject-state:`。
3. 技能层（`zeroexo://skills/{index,pipeline,script-import,subjects,shots-prompts,params}` + prompt `produce_episode`）。
4. 生产工具：`scaffold_episode`（剧本+偏好→占位主体+占位片段+四段式提示词+缺资产清单）、`apply_shot_prompts`（按 references 槽位重写 `@PictureN`）、`validate_project`（剧本块/标题泄漏/缺图/@PictureN 悬空/参数键/帧预算）。
5. 连接即概览：`initialize` 的 instructions 末尾自动带全部项目现状与「下一步」（`src/guides/state-overview.ts`，5s 缓存 3s 超时）。
6. 提示词模板按官方四段式（subject_definitions / detailed_description / overall_soundscape / non_diegetic_music），正文不含参数、不含接缝调度词、不写 HEX；延续机制已按 `segment_continuity.py` 写进 skills（guide/continue 写法相同，差异只在参数）。

## 三、待办（按序，做完一次性汇报，不要中途问）

1. **资产面板统一**：把 `director-prompt-panel.tsx` 的 @ 面板（画布/资产/主体/开源）抽成 `src/shared/components/asset-pick-panel.tsx`，`subject-media-source-panel.tsx` 改用它（手动上传作为面板内按钮），删掉注释里「无法 import 所以另做一套」。
2. **提示词高亮/版式**：`director-prompt-panel` 的 `imagePrompt` 从 textarea 换为带 token 着色的编辑层：`@PictureN`、`<Subject N>`、`<d>…</d>` 三类 token；四段式标签（`subject_definitions:` 等）做小标题样式。
3. **剧本抽屉本集信息卡**：`Episode` 增 `meta{logline,tags,publishNote}`；MCP 加 `set_episode_meta`；剧本页右侧抽屉点某集显示信息卡（一句话介绍/推荐标签/发布建议 + 场次/时长统计），空态一行提示。
4. **guide/continue 实跑对照**：`continuityMode=guide` 与 `continue` 各生成 1 段（小参数），确认提示词正文一致、参数不同、导出首尾可拼；把结论补进 skills。
5. **缺资产闭环**：缺图主体如何回到画布生成再落回主体（画布图像节点 → upload_asset(refId) → set_subject_image），能力不足就明确写进 skill 的「手工导入」分支。
6. 收尾：`validate_project` 对 `z6GrKXXM6HxK` 全绿；根 `pnpm typecheck` + mcp `tsc --noEmit` 均 0。

## 四、验收口径

- 新会话连 MCP：initialize 即带项目现状与下一步，不需要用户讲流程；
- 只有剧本时：`scaffold_episode` 能产出占位主体+占位片段+四段式提示词+缺资产清单；
- 挂图后 `apply_shot_prompts`：提示词里 `@PictureN` 与 references 槽位一一对应，无悬空；
- `validate_project`：errors 为空才算可交付；
- 页面：素材页不再出现主体图；剧本页无「INT. 剧名/集名」假场景；导演台提示词有格式与高亮。

## 五、已知坑

- 写数据文件用工具/Node 脚本，别用 PowerShell 回写（编码会坏）。
- ComfyUI 改插件才重启；MCP 改代码需 `tsc` + 重启 MCP（不重启 ComfyUI）。
- `D:\Test\.mcp\tokens.json` 非空时不会 bootstrap token，`zxp_e2e_smoke_token` 已手工登记。
- 预览 WS `zeroexo.v1.preview` 与前端接 v1（视频卡「含引导」/导出引导）仍未做。
