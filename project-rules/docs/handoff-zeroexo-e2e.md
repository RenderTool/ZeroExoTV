# ZeroExo 端到端测试交接（ComfyUI 插件 + MCP + 网页）

> 背景：本会话上下文用尽，无法一次跑完 E2E。新会话直接按本文件执行，不要再拆步问人。

## 一、当前服务与端口（均已在本机跑着）

| 服务 | 地址 | 说明 |
|---|---|---|
| 网页 dev server | http://localhost:5180/ | Vite，数据根 `D:\Test` |
| 本地数据服务 | http://127.0.0.1:8790 | fs-server，dataRoot=`D:\Test` |
| ComfyUI | http://127.0.0.1:8188 | 已加载 `ComfyUI_ZeroExoNodes` |
| MCP server（StreamableHTTP） | http://localhost:8787/mcp | token `zxp_e2e_smoke_token`（`Authorization: Bearer …`） |

本会话的后台作业（2026-11-07，进程丢失后按下面命令重起）：

- 网页：`cd D:\AICode\zeroexo\zeroexo-comfyui; pnpm run dev`（Vite 会顺带拉起 8790 的 fs-server）
- MCP：`cd D:\AICode\zeroexo\zeroexo-comfyui\mcp-server; $env:ZEROEXO_MCP_TOKEN='zxp_e2e_smoke_token'; node dist/index.js --http`
- ComfyUI：`cd D:\ComfyUI\ComfyUI_windows_portable; .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --fast fp16_accumulation`（改插件代码后必须重启）

## 二、已完成的代码

- 新插件：`D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI_ZeroExoNodes\`
  - `__init__.py`：`ZeroExoGuideSave/Load` + `/zeroexo/v1/health|capabilities|jobs`；`send_json(event,data)`、`queue_prompt` 同步调用已修；
  - `ref_video.py`：`ZeroExoRefVideo`（MODEL/CLIP/视频VAE/音频VAE + 纯参数，默认 1 step / 100×100 / 49 帧 / guide 22）；
  - `engine/`：从源插件移植的 32 个模块（`plan.build_director_plan`、`executor_core.execute_director_plan_core`）；
  - `templates/reference_video.json`：由 `D:\API.json` 改写（去 `MiniMaxH3Director`，换 `ZeroExoRefVideo`，参数占位符 `__zx:*__`）；
  - `LICENSE`：CC0。
- MCP server：`D:\AICode\zeroexo\zeroexo-comfyui\mcp-server`（`dist/index.js` 已构建，`--selfcheck` 通过；`--http` 可用）。

## 三、MCP 调用方式（JSON-RPC over HTTP，SSE 响应）

1. `POST /mcp`，头：`Authorization: Bearer zxp_e2e_smoke_token`、`Accept: application/json, text/event-stream`、`Content-Type: application/json`；
2. 先 `initialize`（protocolVersion 2024-11-05），从响应头取 `mcp-session-id`，后续请求带 `mcp-session-id` 头；
3. `tools/list` 可查全部工具；`tools/call` 调用。

可用工具（含）：`create_project / create_episode / upsert_subject / get_workbench / set_shared_params / set_shot_prompt / add_segment / ingest_storyboard_images / list_canvases / get_canvas / patch_canvas_nodes`。
写通道：`D:\Test\projects\<id>\entities\*.json`（与网页同一批文件，baseVersion 乐观锁）。

## 四、E2E 目标步骤（一次跑完）

1. `create_project`（如 `ZX_TEST_E2E`）；
2. 读 `D:\AICode\zerovideoAgent\projects\ZV-005_xszpm` 的剧本与图片，`create_episode` / `ingest_storyboard_images` 导入（不要改动原项目）；
3. `set_shared_params` + `add_segment`：`steps=1`、`width=100`、`height=100`、`frames=49`、`guide_frames=22`、`use_prev_guide=false`、`seed=1`；
4. 触发生成：优先 `POST http://127.0.0.1:8188/zeroexo/v1/jobs`（body：`{kind:"reference_video", params:{...}}`），若 MCP 未提供 run 工具则直接走该 HTTP；
5. 轮询 `GET /zeroexo/v1/jobs/<jobId>`，直到 state=success/error；
6. 验收：`D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\output\zeroexo\...` 下出现视频 + `guides/gd_*.safetensors`（22 帧）；网页 `5180` 打开项目应能看到片段与产物。

## 五、已知待修

2026-11-07 E2E 已修（细节见第七节）：

1. ~~`ref_video.py` 调 `build_director_plan` / `execute_director_plan_core` 的返回结构不对~~：core 返回 10 元组，原按 dict 取值必然 RuntimeError；
2. ~~`/zeroexo/v1/jobs` 只提交、不回填产物~~：已按 `/history` 回收 video + guide（含 frames/sha256）；
3. 分段预览 WS（`zeroexo.v1.preview`）未实现；
4. 前端接 v1（删工作流配置面板、按 capabilities 渲染参数、视频卡「含引导」标签 + 导出引导）未开始。

导入链路的边界（2026-11-07 实测）：

- MCP 有 `import_script` / `split_script_to_shots` / `add_segment` / `set_shot_prompt` / `upsert_subject` / `upload_asset` / `set_subject_image` / `link_subject_to_shot`，真实导入就是逐个调用完成的（265 次）；
- 但**没有**「按分镜 Markdown 批量导入」和「删除片段」两个工具：35 段的标题/时长/提示词/图片引用只能由客户端解析 `EP01_旁白存档_含旁白分镜.md` 后逐条写；新建 workbench 自带的首个占位片段删不掉，只能用 `set_shot_prompt` 改写复用。要做一键导入，得补 `import_storyboard` + `delete_segment`。

## 六、前端相关已确认规则

- 视频产物带 `origin=zeroexo` + `guide{id,path,frames:22,sha256}`；卡片标签用「含引导」，下载项加「导出引导数据」；
- 引导数据不占 9 个素材槽；批次里每段显式 `guide: prev|cache:<id>|none`，跳段时降级为 `none`，手动选择优先；
- 抽屉/选择面板导入类按钮一律置顶；素材缩略统一 `ThumbImage`。

## 七、E2E 执行记录（2026-11-07）

服务：网页 5180 / fs-server 8790 / ComfyUI 8188 / MCP 8787，全部在线。

### 7.1 真实项目导入（`ZV-005` → 项目 `n-gIcSXxNePr`）

第一轮只做了合成冒烟（1 段假数据、剧本截断 4000 字、没建主体），不算数；按真实数据重做：

| 实体 | 结果 |
|---|---|
| 剧本 | `import_script` 导入 `EP01_剧本.md` 全文（6536 字、1 集《秀才住破庙》），`split_script_to_shots` 按场拆出 11 场草案 |
| 主体库 | 16 个主体：角色 5（张秀才/老僧/女鬼/男鬼甲/男鬼乙）、道具 6、场景 5；18 张真实资产图（3.2–6.6MB）全部经 `upload_asset` 进 CAS，`set_subject_image` 挂状态图（定妆/宫格/美艳/恶鬼/备选）并设封面 |
| 导演台 | 35 段（A-01…C-12，来自 `EP01_旁白存档_含旁白分镜.md`）：描述=段号+标题、时长取「约 N 秒」、`imagePrompt`=subject_definitions、`videoPrompt`=detailed_description；35 段全部有提示词、全部有关联主体（共 136 条 subject→shot 关联） |
| 规模 | 单次导入 265 次 MCP 调用；workbench version=205；总时长 475.5s |

生成验真（A-02「天色将黑 · 望见孤庙」，带 `张秀才_定妆.png` 作参考图）：job `zx_c010bfc67ef0` → success，`output\zeroexo\ZX_TEST_E2E\EP01\seg_00003_.mp4`（h264 96×96、49 帧、24fps、AAC），guide `gd_d72f02c9607b.safetensors`（22 帧、sha256 `88d45d…caf`）。日志不再是「no reference media」，参考图确实进了 r2v。

### 7.2 本次修掉的报错

插件侧：

1. `__init__.py` 落盘时被双重编码污染（BOM + 乱码，且吃掉了引号导致 SyntaxError）→ 按原语义重写为正常 UTF-8；
2. 插件缺 `lib/`（引擎 32 个模块全部 `from ..lib.*`）与 `nodes/conditioning.py` → 从 `ComfyUI_MiniMaxH3_Director` 补齐，`lib/prompt_enhancer.py` 的 `..director.*` 改 `..engine.*`；
3. `PromptServer.instance.queue_prompt` 不存在 → 改为 `POST http://127.0.0.1:<port>/prompt`，失败信息回填 job.error；
4. 模板占位符缺省值缺失（`frame_rate`/`reference_image`/`guide_path`/`project`/`episode`）→ 加 `TEMPLATE_DEFAULTS`；`filename_prefix` 里的串内占位符此前不替换 → `substitute` 支持串内替换；
5. 模板 `CreateVideo.fps` 误连到节点 12 的第 2 路输出（GUIDE 字典）→ 改为 `__zx:frame_rate__`；
6. `ZeroExoRefVideo.run` 按 dict 取 executor 结果 → 改 10 元组解包；guide id 取落盘文件名，服务端可预分配路径；
7. **参考图根本没进 r2v**：`_build_timeline` 写 `editMode=segment` 且 `commonEnabled=false`，而 r2v 属 prompt-batch，引擎强制 segment 模式、只认分组 refs → 单段永远退化成 t2v。改为 `editMode=global` + 有参考图时 `commonEnabled=true`（走 `merge_indexed_refs` 全局 refs）。

MCP / 协议侧：

8. HTTP 每个请求新建 server+transport（sessionIdGenerator 随机）→ client 第二步就 `Server not initialized`；改为按 `mcp-session-id` 复用会话的 stateful 实现；
9. **上传被 4MiB 卡死**：SDK 的 StreamableHTTP 默认 `maxRequestBodySize=4MiB`，真实定妆图 base64 后 5–9MB，`upload_asset` 直接 413 → 加 `maxRequestBodySize`（默认 64MiB，可用 `ZEROEXO_MCP_MAX_BODY` 调）；
10. **剧本拆场识别不了真实格式**：`splitToSegmentDrafts` 只认行首「场景/第X场」，而剧本是 `#### 场 A-1 …`（Markdown 标题）→ 全部退化成「每 3 行一段」。改为允许 `#` 前缀、识别「场 X」，并且有场次标记时从第一场开始切（大纲/人物表不再混进片段），结果 = 11 场；
11. `D:\Test\.mcp\tokens.json` 非空时不会 bootstrap 环境变量 token → 手工登记 `zxp_e2e_smoke_token`（全能力位）。

再次执行前注意：插件改动要重启 ComfyUI 才生效；`/zeroexo/v1/jobs` 的 JOBS 表在进程内存里，重启后旧 jobId 会 404；宽度 100 会被引擎按 32 步长吸附成 96（canvas 约束，非 bug）。

## 八、技能层与前端契约校准（2026-11-07 第二轮）

背景：MCP 只有工具与阶段 gate，没有「剧本怎么拆、主体怎么建、提示词怎么写、参数怎么配」的工艺层；
参数一直是执行者自己拍的（100×100/49 帧/steps=1），且写入的数据形状与前端契约不符，页面表现为
剧本塌成一段、素材显示「恢复的图片·hash」、片段无主体缩略图、参数面板回落默认。

已做：

1. **技能层进 MCP**（交付给客户时自带）：
   - `zeroexo://skills/index`、`zeroexo://skills/pipeline`（合订本）、
     `zeroexo://skills/{script-import,subjects,shots-prompts,params}`，另有 prompt `produce_episode`；
   - 内容按本项目重构后的数据模型与工具名重写（不是旧项目的 md 目录树）；
   - `SERVER_INSTRUCTIONS` 增加「技能层」与「参数纪律」两段：参数必须逐项问用户，联调小参数也要先说明。
2. **前端契约校准**（mcp-server）：
   - `import_script` 把纯文本/Markdown 转成 `<p class="script-*">` 段落（新增 `lib/script-html.ts`）；
   - `upload_asset` 同时写素材记录（`.lf/zeroexo/app_state/zeroexo:assets.json`），同 storageKey 已存在则改标题/归属，不再显示「恢复的图片」；
   - 片段 `references` 改为 `{id,kind,title,storageKey:'cas:…',originScope,slotNo,origin}`（新增 `store/asset-library.ts`）；
   - 片段补齐 `shotType/imagePrompt/videoPrompt/paramValues`，`tracks/track-main/clips` 随片段重建；
   - `set_shared_params` 先铺 `DIRECTOR_SHARED_DEFAULTS`（32 键，对齐 DIRECTOR_PARAMS）再合并，避免半套键；
   - `split_script_to_shots` 支持 HTML 剧本按 `script-scene-heading` 切场。
3. **按新契约重做 ZV-005 导入**：项目 `z6GrKXXM6HxK` —— 剧本 11 场（HTML）、主体 16 + 18 张 CAS 图、
   导演台 35 段（每段双轨提示词 + 主体引用，共 136 条）、主轨 35 clips；联调参数按「越小越快」：
   16:9 / scaleFactor 0.5（432×240）/ 49 帧 / steps 1 / cfg 1 / seed 1 / 引导关（22 帧）。

未做：本轮不重启 ComfyUI、不跑真实生成；页面验证由用户打开 `http://localhost:5180/#/editor/z6GrKXXM6HxK` 核对。
