---
状态: merged
创建: 2026-11-02
来源: 用户需求
关联项目: zeroexo_front, 新目录 zeroexo-comfyui
归属建议: ✅ 已独立立项 Plan#83（以第七节为准；第三/六节历史保留备查）
---

# 本地 ComfyUI 能否作为 zeroexo-platform 的部署底座？画布是否该剥离成独立前端？

## 一、需求 / 问题描述（用户原话）

> 你好，这是我的 comfyui（D:\ComfyUI），我的 zeroexo-platform 项目能不能直接依托他来部署启动？还是说建议直接剥离一个独立前端？把里面的画布剥离？因为我发现我们还留有本地的 D:\AICode\zerovideoAgent 这种非常难以维护，而且毫无组织关联性

## 二、背景与现状

- **D:\ComfyUI**：ComfyUI_windows_portable（v0.43.0）+ MiniMax H3（int8 底模 + 4B 编码器 + ClipProj，8GB 卡方案）+ 5 个自定义节点，核心为 `ComfyUI_MiniMaxH3_Director`（导演台，内含 `easy multiTrackEditor` 节点，段/轨数据以 JSON 存于 `widgets_values[4]`）。启动脚本 `run_nvidia_gpu.bat` 无 `--listen` → 只绑 127.0.0.1。
- **D:\AICode\zerovideoAgent**：离线"提示词工厂"。`skills/`（H3 延续法、打斗体系、qwen-image 等 6 个 SKILL.md）+ `templates/`（铁律与格式）+ `tools/*.mjs`（MD ↔ 导演台 workflow JSON 双向读写、mmxpack 生成、挂图清单生成）。**脚本硬编码绝对路径**（`d:/001-单采生视频 (1).json`、`D:\ComfyUI\...\ComfyUI_MiniMaxH3_Director`），无版本化、无 DB，与平台零连接。
- **zeroexo-platform 已有的接缝**（实测确认）：
  - `zeroexo_backend/src/modules/ai-generate/adapters/adapter.interface.ts` = 渠道适配器唯一契约（`generate(req, ctx) → GenerateResult`），`adapter.factory.ts` 用 `switch(provider)` 分发（openai/gemini/stability/volcengine/custom…），**全仓零 ComfyUI 相关代码**。
  - `templates/definitions/*.json` + `templates/brand-packs/data/*.json` = 模型模板 DSL v2（含 `task` 异步提交/轮询协议）与品牌预设。
  - `ai-generate.worker.ts` = 基于 `AiGeneration` 表的 DB 队列（`FOR UPDATE SKIP LOCKED`，**只做"同用户串行"，无渠道级并发上限**）。
  - `zeroexo_front/packages/{core,plugins,presets,shared}` 已是插件化画布引擎（含 `persistence-localforage`），但 `src/features/*` 与 `src/pages/editor` 绑定后端 sync/assets/agent 链路。
  - `zeroexo_canvas_agent` = MCP Server（外部 AI 客户端操作网页画布）。
- **部署**：`docker-compose.yml` 提供 postgres/redis/minio/backend/frontend/admin/nginx，**不含也不适合含 ComfyUI**（GPU + 27GB 模型属宿主侧）。

## 三、归属分析

- **类型**：决策型（架构选型）+ 功能强化（本地渠道接入）
- **疑似关联 Plan**：征集 #138 / Plan#67「自定义 Skill 动态加载」（zerovideoAgent 的 skills 落点，2026-09-07 已归档未实施）；Plan#74/#76「分镜→出片导入制多轨」（数据模型与导演台 tracks/segments 同构）
- **倾向性结论**：
  1. **ComfyUI 不当底座，只当渠道**：它是单用户工作流执行引擎（无鉴权/多租户/业务节点语义/项目模型），承担不了产品宿主；正确位置是 `provider: 'comfyui'` 的新适配器 + `minimax-h3-*.json` 模板，让画布 image/video 节点把出片打到本机 8GB 卡。
  2. **不剥离画布、不分叉独立前端**：引擎层已经可复用，缺的是"灌进去"而不是"拆出来"；再开一份前端会把"难以维护"翻倍。
  3. **权威源必须是平台数据模型，workflow JSON 只作单向渲染产物**：禁止继续 `sync_md_from_workflow.mjs` 式双向回写——那等于把平台数据绑死在第三方插件的内部序列化格式（`widgets_values` 下标）上，插件一升级即断。
  4. **zerovideoAgent 内容按三分类落位**：skills → 平台 Skill 机制（重启 #138/Plan#67）；templates/铁律 → `prompts`/`public-prompts` + model-templates 数据；tools → 后端 comfyui 适配器与分镜/多轨服务代码；projects 产出 → 画布项目 + 全局资产库（快捷方式节点）。
  5. **若要"桌面单机版"**：路径是 `zeroexo_launcher`（WPF，已在仓）同时拉起 ComfyUI + 本地后端，而非剥前段。

## 四、影响面预估

- 后端：`adapters/adapter.factory.ts`、新增 `adapters/comfyui.adapter.ts`、`templates/definitions/`、`templates/brand-packs/data/`、`ai-generate.worker.ts`（**需新增渠道级并发闸门 =1**）、`standards/pricing/*`（本地渠道按秒/帧计价或标记自托管豁免计费，参考 `isMockProvider` 位点 `ai-generate.service.ts:172-173`）、`api-providers/health`（本机服务健康检查）。
- 前端：video/image 节点 dock 的渠道选择与长任务进度（走既有 `ai-events` SSE，8GB 单片数分钟，禁止阻塞式 HTTP）；`api-providers` 双字段 `config.models`/`fetchedModels` 写入契约。
- 部署：容器内 backend 访问宿主 127.0.0.1:8188 不可达 → 开发用 `npm run dev`；生产需 `--listen` + 反代鉴权/内网限制，或把 comfy runner 独立成宿主服务（对齐 Mock 服务独立化先例）。
- 风险：H3 底模为社区合并模型、导演台为第三方插件 → 升级即变结构；导演台多镜头调度能力与平台分镜/多轨模型存在功能重叠，需明确"谁做调度"。

## 五、处理结果（归属确定后填写）

- 归属：✅ 独立立项 [Plan#83](../shared/plans/2026-11-02-zeroexo-comfyui-standalone.md)（draft，**待用户确认开工**）
- 结果摘要：第三节（ComfyUI 当后端渠道）与第六节（ComfyUI 托管 SPA）均已被第七节替代；最终形态 = 零后端纯前端 + 本地目录为唯一权威源 + MCP 唯一智能入口 + 本地渠道配置面板。本文件第三/六节保留取证，**不得据其施工**。

## 六、需求修正（2026-11-02 二次澄清，**以本节为准**）

用户原话：「原来这个版本太重了，用户要用就得部署两个东西，然后 ComfyUI 用来生图生视频又太麻烦了！」

→ **真实约束不是「ComfyUI 接进后端当渠道」，而是「降低用户侧部署数量 + 降低出片使用门槛」**。第三节结论 1（走 NestJS adapter）**不再适用**，请勿据此施工。

### 新事实核实

- 导演台插件**已在 ComfyUI 的 aiohttp PromptServer 上注册自定义路由**：`director/http_routes.py` 暴露 `POST /minimax/director/{extract_reference_audio, prepare_reference_audio_chunk, first_pass_cache_status, clear_segment_cache}`，并自带 `web/js` 前端资源 → 证明「ComfyUI 直接托管业务前端 + 业务 API」是成熟做法，**无需 NestJS/Postgres/Redis/MinIO**。
- 导演台内部已实现 **`segment_continuity.py`(63KB) / `segment_cache.py`(69KB) / `h3_motion_context.py`(30KB) / `plan.py`(48KB) / `pack.py`(47KB) / `vram_cleanup.py`** → zerovideoAgent 的 H3 延续法（分段、接缝、latent 延续、缓存、显存补丁）**插件侧已有实现**，画布只需喂段列表，不应自研第二套调度。
- 前端已具备本地化的半成品链路：`packages/plugins/persistence-localforage`（IndexedDB 全量图 + `image:`/`video:`/`audio:` 分桶文件存储）；`src/pages/editor/editor-canvas/use-editor-state.ts` 中 localforage 是 Y.Doc 播种失败时的**降级读源**（链路已跑通，需升格为第一等本地模式）；`public/runtime-config.js` 的 `API_BASE_URL` 运行时可改，无需重新打包。

### 新的倾向性结论（待拍板）

1. **做「一套画布代码 · 两个发行形态」**：SaaS 版（现有 NestJS 栈）与**单机版（画布 SPA 由 ComfyUI custom node 托管，用户只装 ComfyUI 便携版，双击一次，开 `127.0.0.1:8188`）**。是否值得付抽象成本，取决于产品定位（自持卡出片用户 vs 网站注册用户）—— **此前提未明，需用户确认**。
2. 单机版最小改动四件：① `src/services/api-client.ts` 调用面抽 `StudioBackend` 接口 + `RemoteBackend`/`LocalBackend` 两实现，`sync-*`/Y.Doc/`broadcast-channel`/`session-lock` 在 Local 模式整块短路（不删代码）；② 新增薄壳插件 `custom_nodes/zeroexo_studio/`（`__init__.py` 注册 SPA 静态路由 + graph 落盘 + generate 调导演台/标准 `/prompt`+WS 进度 + `/zeroexo/llm` OpenAI 兼容转发绕 CORS，约 300-500 行 Python）；③ vite `base` + runtime-config 适配路由前缀；④ workflow JSON 当**编译产物**（版本锁定的 base workflow + 参数填槽），产物落磁盘项目文件夹，**不解析导演台 `widgets_values` 下标**。
3. 出片门槛的答案是「画布隐藏工作流」：用户只在业务节点写提示词/挂参考图，由画布生成并提交 workflow； zerovideoAgent 的 `tools/*.mjs` 正是该功能的手写硬编码雏形，应转为画布「导出/提交工作流」能力。
4. 原第三节第 2、3、4、5 条（不剥离引擎 / workflow 单向 / zerovideoAgent 三分类落位 / launcher 桌面路径）**继续有效**；其中「三分类」的 skills/templates 落点在单机版需重估（无后端即无 `prompts` 表与 Skill 服务 → 只能落 IndexedDB/本地 JSON）。

## 七、终态拍板方向（2026-11-02 第三次澄清，**以本节为准**）

用户原话（要点）：彻底剥离一个额外版本（新目录 `d:/AICode/zeroexo/zeroexo-comfyui`，暂空），形态对齐 **infinite-canvas**：可外接 API、**去掉同步换性能**、纯前端、**前端不含任何 Agent/LLM 接口**，任意 coding 工具通过 **MCP 操作**（导入剧本、关联剧本资产等，不走后台）；相当于给 zerovideoAgent 这种文件驱动工作方式**配套一个前端维护页**。待定问题：**怎么存储**（参照魔搭包 `shensanshu/ComfyUI-Local-Infinite-Canvas`）。

### 参考物实测结论（已核实）

- 魔搭包结构：`infinite-canvas/` + `comfyui-gateway/`（Node+Express，`workflows/registry.json`：**工作流=模型、bindings 映射节点输入**）+ `launcher/` + `start-local.bat` + `patches/` + `update.json`；三进程 8188/8190/3000（3000 占用自动跳 3001-3010）；默认全绑 127.0.0.1，`allowLan` 需显式开；用户数据在 `data/`，**更新/补丁不覆盖 `data/`**；`LOCAL_ONLY` 模式隐藏云端/Agent/WebDAV 入口。
- 上游 `infinite-canvas/canvas-agent`：独立本地 MCP 服务（:17371 + connect token + origin 钉定），工具为 `canvas_get_state / get_selection / export_snapshot / apply_ops / create_text_node / create_image_prompt_flow`——**写操作走浏览器 RPC**（页面自己改自己的 store），持久化用 localforage(IndexedDB)。仓库已有 `zeroexo_canvas_agent` 与之同构。
- 本地画布资产：`zeroexo_front/packages/{core,plugins,presets,shared}`（含 `persistence-localforage`）。

### 存储设计（倾向性结论，待拍板）

**磁盘文件树 = 唯一权威源；UI 与 MCP 都是它的客户端；浏览器不再当数据库。**
- 写入通道：复用 `comfyui-gateway` 加 `/zeroexo/storage/*` 路由（而不是 ComfyUI 路由或 File System Access API），前端与 MCP 共用同一套 schema 校验。
- 布局：`projects/<slug>/{project.json, scripts/EPxx.md, storyboard/EPxx.json, prompts/*.md, refs/, history/<ts>.json}` + `index/asset-index.json` + `cache/`（派生数据可整删重建）。
- **双权威禁令**：长文本只存 `.md`（project.json 仅存文件引用 + 锚点），结构/连线/位置只存 `project.json`；workflow JSON 永远由分镜段表**单向编译**得出。
- 媒体：以 ComfyUI `input/`、`output/` 为权威位置，画布只存**相对路径 + hash + 元数据**（=参考包的 resource index）。
- 两写者（人+MCP）并发：mtime/hash 乐观锁 + tmp+rename 原子写 + `history/` 追加快照代替 CRDT 撤销；生成中节点加内容 hash 锁。
- 用户数据与程序目录分离（为 dataset 分发/小补丁更新预留）。
