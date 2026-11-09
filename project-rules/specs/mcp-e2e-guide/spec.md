# SPEC：MCP 全流程能力补齐 + 引导数据 E2E 验收

日期：2026-11-09
状态：**已落地（2026-11-09 审核通过并全量执行完毕）**。实测结论见 §12。
判定来源：本文件为本次任务的唯一计划基线；`project-rules/docs/handoff-zeroexo-e2e.md` 仅作服务/命令参考，其「35 段已导入」描述与实测不符（见 §2.2）。

---

## 0. 用户要求逐条映射

| # | 用户原话要点 | 本 SPEC 对应章节 |
|---|---|---|
| 1 | 启动服务，用实际项目跑一遍 | §2.1 服务清单、§5 E2E 场景、§10 T1/T5 |
| 2 | `steps=3`、分辨率系数 0.1–0.2、图片选 `match`、秒数用 MCP 统一改 4s | §2.3 参数映射、§3 新增 `set_segment_duration`、§5 S0 |
| 3 | 通过 MCP 发送批量选择的正常任务 | §3 `run_generation`、§5 S1 |
| 4 | 跑完后单独测某几段，看能否正常沿用上一段引导 | §3 `run_generation(selectedIds)`、§5 S2 |
| 5 | 跑一个单独从历史中以引导数据插入的视频 | §3 `list_history` + `set_shot_guide`、§5 S3 |
| 6 | 看所有是否正常 | §5 S4、§7 验收标准 |
| 7 | 有遗漏的补进测试用例 | §6 |
| 8 | 8G 内存，测试以跑通正确为主 | §2.3 低资源参数、§8 风险 |
| 9 | 所有操作必须能经 MCP 完成；做不到就补 MCP | §2.6 能力盘点、§3 新增工具（本 SPEC 实现主体） |
| 10 | 写具体 SPEC（含调研与任务），审核后开始 | 本文件；§9 待确认、§10 任务分解 |

---

## 1. 硬约束

1. **部署形态**：用户最终只拿到「部署好的网页 + 打包好的 MCP」。因此 E2E 的每一步（建项目、配参数、改时长、触发生成、查状态、取历史 guide、插引导槽、验收产物）都必须是 **MCP 工具调用**；禁止用「直接 `POST http://127.0.0.1:8188/zeroexo/v1/jobs`」或「去网页点按钮」冒充完成。
2. **资源**：本机 8G 内存。以「跑通 + 数据正确」为唯一验收目标，不测画质、不测性能、不跑满 35 段。
3. **不改 ComfyUI 插件代码**：插件侧引导能力已完整（§2.4），本轮无需配套调整；因此也不需要重启 ComfyUI。
4. **不破坏真实项目**：`D:\Test\projects` 下已有数据一律只读；E2E 用 MCP 新建独立测试项目。
5. **服务数硬指标**：正常只有 **3 个服务 = MCP / 网页 / ComfyUI**。`fs-server` 必须并入 MCP 进程（§2.1 T0），不得作为第 4 个服务存在；网页保持独立托管，不并入 MCP。验收按「服务/进程数 = 3」判定，端口数不作为判据。
6. **本轮边界**：不启动服务、不改代码。审核通过后按 §10 顺序执行。

---

## 2. 本次调研结论（只读）

### 2.1 服务拓扑：**目标 3 个服务 = MCP / 网页 / ComfyUI**

用户定稿口径：**正常只有 3 个服务**。`fs-server` 不是第 4 个服务，它是 MCP 包的一部分，必须并入 MCP 进程。初稿照抄 `handoff-zeroexo-e2e.md:5-18` 的端口表，把「4 个端口」误写成「4 个服务」，并把实现缺陷当成了架构。

**现状（缺陷，不是设计）**：同一个包 `mcp-server/dist/index.js` 有三种互斥模式（`src/index.ts:147-231`，`main()` 内 `if … return`）：

| 模式 | 端口 | 作用 |
|---|---|---|
| `--fs-server` | 8790 | 把 `dataRoot` 以 REST 暴露给前端 `@/platform/fs`（`src/file-server.ts:1-13`），免 File System Access 授权 |
| `--http` | 8787 | MCP StreamableHTTP `/mcp` |
| （无参） | — | MCP stdio |

`--fs-server` 与 `--http` 互斥 → 要同时提供「前端数据 REST」和「Agent 工具」就得**起两个 MCP 进程**；`vite.config.ts:17-55` 又会自动 spawn 一个 `--fs-server` 子进程。于是开发期出现 4 个进程（Vite 5180 / fs 8790 / MCP 8787 / ComfyUI 8188），部署后也不是「一个打包 MCP」。

**本轮必须改造（§3 T0，硬要求，不是待确认项）**：让**一个 MCP 进程同时承担两种协议**：

1. `src/file-server.ts:210-236` 的 `startFileServer()` 把内部 `handle(req,res)` 抽成导出的 `handleFsRequest(req,res)`；幂等探测 + `process.exit(0)` + `listen` 只保留在独立 `--fs-server` 模式。
2. `src/index.ts` 的 `--http` 分支：起 8787 的 `/mcp` 之外，**同进程再 `listen(8790)` 挂 fs handler**（两个 `http.Server` 实例、一个进程）。
3. 前端 `@/platform/fs` 与 `vite.config.ts` 的探测端口**都不改**（仍 8790）；Vite 插件探测到 8790 已在线 → 自动跳过 spawn，子进程消失。
4. 结果：开发期 = Vite 网页 + MCP(含 fs) + ComfyUI = **3 个进程**；部署期 = 静态网页托管 + 打包 MCP(含 fs) + ComfyUI = **3 个服务**，符合「部署好的网页 + 打包好的 MCP」。
5. 端口仍是 4 个数字（5180 / 8790 / 8787 / 8188），但 **8790 与 8787 属于同一个 MCP 进程，服务数是 3**。网页保持独立托管，不由 MCP 代管静态文件（否则变 2 个，超出用户口径）。

**人工启动命令（改造后仍是 2 条，ComfyUI 复用不重启）**：

1. `cd D:\AICode\zeroexo\zeroexo-comfyui; pnpm run dev` → Vite 网页 5180（探测 8790 已在线，不再 spawn）
2. `cd D:\AICode\zeroexo\zeroexo-comfyui\mcp-server; $env:ZEROEXO_MCP_TOKEN='zxp_e2e_smoke_token'; node dist/index.js --http` → MCP 单进程 8787 + 8790
3. ComfyUI 8188：外部生成后端，已在跑则只读复用。**纯 API + 跨域可用**的启动命令：
   ```
   cd D:\ComfyUI\ComfyUI_windows_portable
   .\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --fast fp16_accumulation --disable-auto-launch --enable-cors-header '*'
   ```
   `--disable-auto-launch` = 不拉起浏览器网页；`--enable-cors-header '*'` = 让前端 5180 能跨域访问 8188（见 §12.7，缺了会被 403 拦）。

合计 **3 个服务 / 3 个进程**。

- 数据根：`mcp-server/src/config.ts:10-12` 固定 `D:\Test`（可用 `ZEROEXO_DATA_ROOT` 覆盖）。
- MCP HTTP 调用：`POST /mcp`，头 `Authorization: Bearer …` / `Accept: application/json, text/event-stream` / `Content-Type: application/json`；先 `initialize` 拿 `mcp-session-id`，后续带该头（handoff §三）。
- `mcp-server/dist/` 已存在，但**不能假定与 src 同步**；T1 必须先 `pnpm build`。

### 2.2 真实项目现状（本轮实测 `D:\Test\projects`）

| 项目 id | shots | version | sharedParams 键数 | 说明 |
|---|---|---|---|---|
| `z6GrKXXM6HxK` | **35** | 426 | 32 | 唯一完整项目（ZV-005 导入结果） |
| `B52u16jvXDD1C04ZDn1GD` | 5 | 125 | 32 | 小型项目 |
| `JgMO37xkdWhRCDZ3PM2AY` | 1 | 15 | 32 | 单段 |
| `n-gIcSXxNePr` | 1 | 1 | 0 | **与交接文档「35 段」不符**：只剩 1 个占位段、无参数 |
| `EmFT1QkJmKax` | 1 | 1 | 0 | 空壳 |

结论：不要以 `n-gIcSXxNePr` 为「现成 35 段项目」；E2E 用 MCP 新建 `ZX_E2E_GUIDE_<yyyymmdd>` 并只建 4 段（§5）。

### 2.3 参数映射（用户口径 → 代码真名 → 实际值）

| 用户说法 | 真实字段 | 位置 | 本次取值 | 派生/约束 |
|---|---|---|---|---|
| step 调 3 步 | `steps` (int, default 25, min 1) | `src/entities/director-params.ts:450` | `3` | 写 `sharedParams.params.steps` |
| 分辨率 0.1–0.2 | `scaleFactor` (float, 夹到 `[0.1, 2]`) | `:356-368, 395` | **`0.1`** | `resolveVideoSize('16:9', 0.1)` → 86×48，但插件 `width/height min=64`（`ref_video.py:88-89`）会拒绝 48；**实测已把 MCP 派生结果钳到 64 → 86×64**，0.2 → 173×96（173 奇数，不选） |
| 图片选 match | `refImageSize` (enum, default `match`) | `:431-437, 471` | `'match'` | 选项 match / 1024 / 1280 / 1536 / max；**没有** `imageMatch` 键 |
| 秒数统一 4s | `WorkbenchShot.duration` (秒) | MCP `store/workbench.ts:307` | `4` | `durationToFrames(4) = alignFrames(96) = 107` 帧（17k+5 吸附，`:284-293`）；需 `> guide_frames` ✓ |
| 引导帧数 | `continuityOverlapFrames` → `guide_frames` | `use-director-run.ts:627` | `22` | 插件档位 5/22/39/56（`snap_guide_frames`），默认 22 |
| 宽高 | 无 `resolution` 键 | `resolveVideoSize` | **86×64** | `aspect` + `scaleFactor` 派生后钳到插件 min=64；前端 `StartRunArgs.width/height`（`use-director-run.ts:81-92`） |

**MCP 侧注意**：`set_shared_params` 的 `params: z.record(z.unknown())`（`mcp-server/src/tools/workbench.ts:31`）**无白名单**，可直接写 `steps/scaleFactor/refImageSize`；但 MCP **不自动派生 width/height**，新增 `run_generation` 必须自己调用等价 `resolveVideoSize` 逻辑。
`validate_project` 要求 `Object.keys(params).length >= 20`（`plan.ts:158`），`set_shared_params` 会先铺 32 键默认值，天然满足。

### 2.4 ComfyUI 插件侧：引导已完整实现，**无需配套调整**

路径 `D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI_ZeroExoNodes\`。

| 能力 | 证据 |
|---|---|
| 每段预建 guide 输出路径 | `__init__.py:519-524`（`kind == "reference_video"` 即分配 `output/zeroexo/guides/gd_xxx.safetensors`） |
| 无条件产出（尾部帧） | `ref_video.py:185-200`：`images[-n:]` → `save_file({"guide": data})`；失败也返回 `frames:0` 的记录 |
| 成功后回传 guide 元数据 | `__init__.py:235-239`：`job["guide"] = guide_meta(...)` → `{id,path,frames,sha256}` |
| 上一段登记表 | `__init__.py:36-37, 238-239`：`LAST_GUIDE[project|episode]` |
| 显式 `guide_id` 解析与覆盖 | `__init__.py:319-338`：`^gd_[A-Za-z0-9_-]{4,64}$`；命中即强制 `use_prev_guide=false` |
| 引导注入工作流 | `ref_video.py:140-156`：`prev_guide_path` → `plan.external_guide_frames` |
| 来源回传 | `__init__.py:528-529`：`guideSource` = explicit / prev / none；前端类型本轮已补声明 |

**结论**：用户「视频默认生成引导数据，用不用由用户决定，可作为参数传入」的设计，插件侧已成立。上一轮我曾误判「必须改插件」，原因是子代理只搜了本仓库、没读外部插件；已在对话中纠正。

### 2.5 前端引导链路（上一轮已修，本轮不改）

| 修复 | 位置 |
|---|---|
| 提交按时间线全序解析引导（显式槽 > 上一段 `media.guide.id`），段级开关优先、全局开关回落；「断开衔接」投影不被绕过 | `use-director-run.ts:564-582, 619-630` |
| `RunShotLike.media` / `toRunShot` 回读产物 guide，重跑单段可接续 | `entities/director-params.ts:568-572`、`workbench-tab-content.tsx:112-113` |
| 画布节点落库不再丢 guide；画布链路留 `guideId` 可选入参 | `ai-generation.ts:470-498`、`local-minimax-video.ts:38-42,172-176` |
| 插件 `guideSource` 前端类型声明 | `zeroexo-jobs-client.ts:75-77` |

### 2.6 MCP 能力盘点：**36 个工具，但本次 E2E 在「触发生成」硬断**

注册：`mcp-server/src/index.ts:55-73` → 10 个 `register*Tools` → `TOOL_REGISTRY`（`src/tools/_register.ts:26-30`）。按落盘统计 读 14 / 写 22。

| 任务项 | 能力 | 具备 | 证据 / 缺失 |
|---|---|---|---|
| 建项目 / 导剧本 / 拆片段 | 数据准备 | ✅ | `create_project` / `import_script` / `split_script_to_shots` / `add_segment` |
| `steps=3` / `scaleFactor=0.1` / `refImageSize='match'` | 配共享参数 | ✅ | `set_shared_params`（`tools/workbench.ts:23-43`） |
| **所有片段统一改 4s** | 批量改时长 | ⚠️ **无批量** | 唯一入口 `set_shot_prompt` 的 `duration`（`tools/workbench.ts:50-59` → `store/workbench.ts:307`），需逐段调用、每次重取 `baseVersion`，每次 `rebuildMainTrack` + `version+1`；`add_segment` 不能改已有段；`split` 硬编码 5s（`store/script.ts:462,482`）；无 `update_segment` |
| **批量选择并触发生成** | 运行 | ❌ **完全没有** | 36 个工具中无 `run` / `start_run` / `queue_job`；`mcp-server/src/` 唯一 `fetch` 是 `file-server.ts:213` 启动探测；技能层自认「真实生成由用户在前端点运行」（`src/guides/skills.ts:294`）；handoff `:44` 明写「若 MCP 未提供 run 工具则直接走 HTTP」 |
| **单独重跑某几段 selectedIds** | 运行 | ❌ | `selectedIds` 只存在于前端 `StartRunArgs`（`use-director-run.ts:82,557`） |
| **列出历史产出 / 引导数据** | 读历史 | ❌ | `list_assets` 读 `cas_index.json`，不含 guide/title/origin（`store/cas.ts:143-160`）；历史实际落在 `.lf/zeroexo/app_state/zeroexo:assets.json`，`store/asset-library.ts` **只有写没有读** |
| **从历史把引导插入片段 guide 槽** | 写引导槽 | ❌ | 无 `set_shot_guide`；MCP 的 `WorkbenchShot` 接口（`store/workbench.ts:24-37`）**连 `guide` / `media` 字段都没有**；`link_subject_to_shot` 写 `references[]` 主体图，`attach_asset_to_slot` 写素材槽，均非 guide |
| 读作业状态 / 校验产物 | 验收 | ❌ | 无 `get_job` / `list_jobs` / `verify_output`；`get_workbench` 只看静态 JSON；`validate_project` 只做数据自检不查 mp4 / safetensors |
| 分镜图片批量导入 | 前置 | ⚠️ 不落盘 | `ingest_storyboard_images` 返回 `pending_confirm`（`storyboard-ingest.ts:16,51-57`）；handoff `:60` 记「需补 `import_storyboard` + `delete_segment`」 |

**一句话**：MCP 现在只能做「建项目 → 导剧本 → 拆片段 → 配参数 → 挂素材」；从点运行开始到验收，全部得靠网页或直接 HTTP 调 ComfyUI。**不补齐 §3，用户的部署约束不成立。**

### 2.7 契约漂移（必须一并修，否则新增工具仍未真正可用）

| 位置 | 数字 |
|---|---|
| 服务端 `stampServerInfo` 硬编码 | `tools: 20`（`mcp-server/src/index.ts:87`） |
| 服务端 `--selfcheck` | `read = 9` 硬编码；`write = 36 - 9 = 27`（`:125-126`） |
| 前端 `MCP_TOOLS` | **21**（9 read / 12 write），`src/features/mcp-settings/mcp-client.ts:83-105` |
| 前端单测断言 | `21 / 9 / 12`（`mcp-client.test.ts:192-198`） |
| 设置页「核心工具速查」 | 手写 15 个（`mcp-settings-dialog.tsx:156-162`） |
| 契约文档 | 「M1 20 个工具，读 9 / 写 11」（`project-rules/docs/mcp-auth-scope-contract.md:38-67`） |

标 `◆` 的 **15 个工具**（`update_episode` / `patch_episode` / `set_subject_image` / `read_asset` / `list_canvases` / `scaffold_episode` / `apply_shot_prompts` 等）**从未同步到前端清单**。

**能力位红线**：新增工具若引入新 capability bit（如 `run.write`），所有**已签发 token 立即 `AUTH_FORBIDDEN`**（`mcp-server/src/auth.ts:93-96`）。本 SPEC 决定**复用现有 `workbench.write` / `asset.read` / `workbench.read` 位，不新增 bit**。

**另一个坑**：`readWorkbench` 有写副作用——老数据含 `sharedParams.prompt` 时会触发迁移并 `version+1`（`store/workbench.ts:193-214`），所以「读一次拿 baseVersion 再写」的流程必须每次写前重取。

### 2.8 现有测试设施

- `mcp-server/test/` 共 10 个 `.test.ts`，`vitest.config.ts:4-9` 只纳管 `test/**/*.test.ts`。
- **工具级回归只有** `script-normalize.test.ts` / `script-import-mode.test.ts`（`InMemoryTransport` + `client.callTool`）和 `guides.test.ts`（技能文案）；`set_shared_params` / `set_shot_prompt` / `add_segment` / `get_workbench` / `list_assets` / `link_subject_to_shot` 等**全部 0 处工具级回归**。
- 唯一真实 HTTP 测试 `file-server.test.ts` 测的是 **8790 实体服务**，不是 `--http /mcp`；**StreamableHTTP 集成测试 0 处**。
- 三个临时 `.mjs` 不受 vitest 纳管：`e2e-smoke.mjs` / `import-zv005.mjs` / `verify-zv005.mjs`。
- 前端：本轮之前引导解析 4 条单测已加（`use-director-run.guide.test.tsx`）；全量 `1306 / 1296 passed / 0 failed / 10 skipped`、`tsc --noEmit` 0 错误。

---

## 3. 实现主体

### 3.0 T0：MCP 单进程化（**先于所有新工具，硬要求**）

把 `--fs-server` 并入 `--http` 进程，使服务数从 4 降到 3（详见 §2.1）。改动文件：

| 文件 | 改动 |
|---|---|
| `mcp-server/src/file-server.ts` | 导出 `handleFsRequest(req,res)`；`startFileServer()` 保留幂等探测/listen 供独立模式使用 |
| `mcp-server/src/index.ts` | `--http` 分支同进程再 listen 8790；`main()` 不再把两种模式视为互斥；`stampServerInfo` 补 fs 端口信息 |
| `mcp-server/src/config.ts` | 无改动（端口各自读 `--port` / `ZEROEXO_FS_PORT`） |
| `vite.config.ts` / `src/platform/fs*` | **不改**；靠 8790 `/health` 幂等探测自动跳过 spawn |
| `mcp-server/test/file-server.test.ts` | 补「同进程 `/mcp` 与 `/health`、`/file` 共存」用例 |

保留 `--fs-server` 独立模式与 stdio 模式，不破坏既有部署脚本；只是 `--http` 现在额外提供 fs REST。

### 3.1 必须新增 / 扩展的 MCP 工具

**统一约定**：所有写工具沿用 `dryRun` / `confirm` 双阶段 + `baseVersion` 乐观锁；所有工具复用现有 capability bit，不新增位。返回统一 `okResult` JSON（`mcp-server/src/errors.ts:42-46`）。

| 工具名（建议） | 输入 schema | 行为 | 对应任务 | bit |
|---|---|---|---|---|
| `set_segment_duration` | `{projectId, baseVersion, duration: 4, shotIds?: string[], all?: boolean, dryRun?, confirm?}` | 一次 `updateWorkbench` 内改所有目标 `shot.duration` → 自动 `rebuildMainTrack` + `version+1`。`all=true` 覆盖全部；优先 `shotIds`。**拒绝 `duration<=0`** | ② 统一 4s | `workbench.write` |
| `run_generation` | `{projectId, baseVersion, episode, selectedIds?: string[], baseUrl?, dryRun?, confirm?}` | 读 workbench → 按 `selectedIds`（缺省=全部）过滤 → 对每段：派生 `width/height`（等价 `resolveVideoSize(aspect, scaleFactor)`）、`frames=durationToFrames(duration)`、`steps/cfg/seed/frame_rate/guide_frames`、`reference_image`（参考图先 `POST /upload/image`）、**引导解析**（显式 `shot.guide.id` > 时间线前一段 `media.guide.id` > `use_prev_guide=true`）→ `POST {base}/zeroexo/v1/jobs`。返回 `jobIds[]`、`params[]`（供断言） | ③④ | `workbench.write` |
| `get_job` / `list_jobs` | `{baseUrl?, jobId}` / `{baseUrl?, jobIds?}` | 代理 `GET /zeroexo/v1/jobs/{id}`，透出 `state/outputs/guide/guideSource/guideInPath/error`；`list_jobs` 批量查 | ⑥ | `workbench.read` |
| `cancel_job` | `{baseUrl?, jobId}` | 代理 `POST /zeroexo/v1/jobs/{id}/cancel` | 异常回收 | `workbench.write` |
| `list_history` | `{projectId, source?: 'canvas'|'director'|'all', withGuideOnly?: boolean}` | 读 `.lf/zeroexo/app_state/zeroexo:assets.json`，过滤 `origin='generation'`，返回 `{id,title,kind,createdAt,storageKey,originSource,guide{id,frames,sha256,path}}` | ⑤⑥ | `asset.read` |
| `get_guide` | `{projectId, assetId? , guideId?}` | 返回单条 guide 元数据 + 磁盘 `output/zeroexo/guides/gd_xxx.safetensors` 是否存在 | ⑤ | `asset.read` |
| `set_shot_guide` | `{projectId, baseVersion, shotId, guide: {id,title?,frames?,sha256?,fromAssetId?} | null, dryRun?}` | 写 `shots[].guide`（`guide=null` 为移除）；**同时扩展 `mcp-server/src/store/workbench.ts:24-37` 的 `WorkbenchShot` 类型补 `guide` / `media` 字段**，对齐前端 `workbench-types.ts:18-33,93-100` | ⑤ | `workbench.write` |
| `verify_output` | `{projectId, jobIds?, guideIds?}` | 校验 mp4 与 `gd_*.safetensors` 落盘、帧数、`shots[].media.guide` 回写、历史资产 guide 标记；返回逐项 pass/fail 明细 | ⑥⑦ | `workbench.read` |
| `get_param_schema`（可选但推荐） | `{}` | 回 `DIRECTOR_PARAM_SCHEMA` 键/类型/枚举（含 `steps` / `scaleFactor` / `refImageSize`），避免 Agent 靠技能文案猜键 | ② | `workbench.read` |

**可选（若审核要求前置完整）**：`import_storyboard`、`delete_segment`、`set_active_episode`。本 SPEC 的 4 段测试项目可用现有 `add_segment` + `set_shot_prompt` 搭出来，**不阻塞主流程**。

**同步修改**：`store/workbench.ts` 的 `WorkbenchShot` 类型；`store/asset-library.ts` 补读函数；`mcp-server/src/index.ts` 注册新工具 + 修正 `tools:20` / `read=9` 硬编码。

### 3.2 前端契约同步清单（5 处，缺一不可）

1. `src/features/mcp-settings/mcp-client.ts:83-105` `MCP_TOOLS` 补齐 15 个既有 ◆ 工具 + 本次新增工具，并正确标注 read/write。
2. `src/features/mcp-settings/mcp-client.test.ts:192-198` 硬断言改为从 `MCP_TOOLS` 派生，不再写死 `21/9/12`。
3. `src/features/mcp-settings/mcp-settings-dialog.tsx:156-162` 工具速查改为由 `MCP_TOOLS` 生成，不再手写 15 个。
4. `project-rules/docs/mcp-auth-scope-contract.md:38-67` 工具矩阵与能力位说明同步。
5. `mcp-server/src/index.ts:87,125` 改用 `TOOL_REGISTRY.length` 与真实读写分类。
6. 审核通过后，在 `project-rules/specs/README.md` 登记本 SPEC 子目录。

---

## 4. 低资源参数基线（8G 内存）

```
steps            = 3
scaleFactor      = 0.1        → width 86 / height 64（钳到插件 min=64，实测通过队列校验）
refImageSize     = 'match'
duration         = 4 (s)      → frames = durationToFrames(4) = 107（17k+5 吸附）
guide_frames     = 22 (默认)
frame_rate       = 24
presetId         = 'h3'
段数             = 4（S1 全跑 4 段；S2 单跑第 3 段；S3 单跑 1 段）
```

- 预估单段：86×64×107 帧 × 3 steps；**实测单段 61.46s**（RTX 5060 Ti / 8G）。
- **OOM 回退链**（按序）：`scaleFactor 0.1`（86×64）→ 若仍被拒/崩，回退 `100×100 / frames=49 / steps=1` → 仍失败则降为 **1 段**。
- 实测记录：首次提交 `height=48` 被 ComfyUI 以 `Value 48 smaller than min of 64: height` 拒绝（`prompt_outputs_failed_validation`），已在 MCP `resolveVideoSize` 加 `Math.max(64, …)` 修复；`width/height` 的 `step=32` 只是 UI 建议，队列只校验 min/max。
- 每次只跑一个批次，不并发提交多批次；`run_generation` 内部按段序**串行提交**，避免 `LAST_GUIDE` 单键被乱序完成覆盖。

---

## 5. E2E 场景（全部经 MCP 工具调用，禁止直连 HTTP / 网页点击）

### S0 环境准备
1. `pnpm --filter @zeroexo/mcp-server build`（确保 dist 与 src 一致）；执行 §2.1 的 **2 条启动命令**（`pnpm run dev` 自动带起 8790；`node dist/index.js --http` 起 8787）；ComfyUI 若已在跑则只读复用、不重启。
2. `MCP tools/list` 断言包含 §3 全部新工具；`--selfcheck` 与实际注册数一致。
3. `create_project` 新建 `ZX_E2E_GUIDE_20261109` → 记录 `projectId`。
4. `create_episode` → `import_script`（用 ZV-005 的短剧本片段，或 4 行占位文本）→ `split_script_to_shots` 或 4 次 `add_segment` 造 4 段。
5. `set_shared_params`：`{presetId:'h3', params:{steps:3, scaleFactor:0.1, refImageSize:'match', continuityOverlapFrames:22}}`。
6. **`set_segment_duration({all:true, duration:4})`** 一次调用把 4 段全改 4s；`get_workbench` 断言 `shots.every(s => s.duration===4)` 且 `version` 只 +1。
7. `attach_asset_to_slot` / `set_shot_prompt` 给每段挂一张参考图与提示词（低资源下可共用同一张小图）。

### S1 批量正常运行
- `run_generation({projectId, episode, selectedIds: [seg1..seg4], confirm:true})` → 记录 4 个 `jobIds` 与提交参数。
- 断言提交参数：`steps=3`、`width=86`、`height=48`、`frames=107`、`guide_frames=22`、`refImageSize` 生效；第 1 段 `guide_id` 空且 `use_prev_guide=false`；第 2–4 段按 §2.5 的优先级解析。
- `list_jobs` 轮询至全部 `state=success`（超时 15 分钟，失败即停并输出 `error`）。
- `verify_output`：4 个 mp4 + 4 个 `gd_*.safetensors` 落盘；每个 `job.guide.id/path/frames` 非空；`shots[].media.guide` 已回写；历史资产带 `originSource='director'` 与 `guide`。

### S2 单独重跑，验证沿用上一段引导
- `get_workbench` 取 `seg2.media.guide.id`（S1 产出）。
- `run_generation({selectedIds:[seg3], confirm:true})` —— **只选第 3 段**。
- 断言：提交参数 `guide_id === seg2.media.guide.id`、`use_prev_guide === false`（旧实现这里是 `i=0 → false` 且无 `guide_id`，必然挂）；作业 `guideSource === 'explicit'`、`guideInPath` 指向 seg2 的 guide 文件。
- `list_jobs` 等成功 → `verify_output` 确认新 mp4 + 新 guide。

### S3 从历史以引导数据插入后单独跑
- `list_history({source:'director', withGuideOnly:true})` 取 S1 中任意一条带 guide 的视频（建议取 seg1 的，与 seg2 不同，便于区分）。
- `set_shot_guide({shotId: seg4, guide: {id, title, frames, sha256, fromAssetId}})` → `get_workbench` 断言 `seg4.guide.id` 已写入且 `references[].length` **未变**（不占 9 槽）。
- `run_generation({selectedIds:[seg4], confirm:true})`。
- 断言：`guide_id === 历史选中的 id`（显式槽优先于上一段 `media.guide`）、`use_prev_guide=false`、`guideSource='explicit'`、`guideInPath` 指向该历史 guide 文件。
- 等成功 → `verify_output`。

### S4 全局验收
- 再次 `get_workbench`：4 段 `duration=4`、`sharedParams.params` 三键正确、`seg3/seg4` 的 `media.guide` 已更新、`seg4.guide` 保留。
- `list_history`：`originSource='director'` 的条数 = 生成次数，且都带 guide；`canvas` 条数为 0（本次没有画布产物）。
- `validate_project` 通过；输出一份机器可读 JSON 报告（jobIds / guideIds / pass-fail）。

---

## 6. 需要补充的测试用例（本轮调研发现的遗漏）

| 层 | 新增测试 | 断言要点 |
|---|---|---|
| MCP 工具级（InMemoryTransport） | `set_segment_duration.test.ts` | 一次调用改全部 / 指定 shotIds、`version+1`、`rebuildMainTrack`、非正数被拒、`dryRun` 不落盘 |
| MCP 工具级 | `director-ops.test.ts`（mock `fetch`，已落地 6 条） | selectedIds 过滤、参数派生（86×64 / 107 帧 / steps=3）、引导优先级三段式、`confirm` 双阶段、fs handler 同进程复用 |
| MCP 工具级 | `set_shot_guide.test.ts` | 写 / 移除 guide、不影响 `references[]`、baseVersion 冲突、`guide=null` |
| MCP 工具级 | `list_history.test.ts` / `get_guide.test.ts` | 从 `zeroexo:assets.json` 读、按 source 过滤、无 guide 时不返回 |
| MCP 工具级 | `get_job.test.ts` / `verify_output.test.ts` | 状态透出 guide/guideSource、缺 mp4 / 缺 safetensors 时判 fail |
| MCP 契约 | `tool-registry.test.ts` | `tools/list` 实际数 = `TOOL_REGISTRY.length` = 前端 `MCP_TOOLS.length`；read/write 分类一致；`--selfcheck` 不再硬编码 |
| **HTTP 集成（当前 0 处）** | `mcp-http.test.ts` | 真实 `POST /mcp` initialize → `mcp-session-id` → `tools/list` → 一次 `tools/call`；token 错误返回 `AUTH_FORBIDDEN` |
| **T0 单进程（新增）** | `file-server.test.ts` 补例 + `mcp-http.test.ts` | 同一个 `--http` 进程同时响应 `8787/mcp` 与 `8790/health`、`8790/file`；Vite 插件探测 8790 在线后不再 spawn 子进程；进程数 = 3 |
| 前端单测 | `use-director-run.guide.test.tsx` 已有 4 条，补 2 条 | ① 一次跑 4 段且前段已产出 guide → 第 2–4 段各自传对应 `guide_id`；② 无 `continuation` 且全局关 → 不传任何 guide 参数 |
| 前端单测 | `toRunShot` 回读 | `media.guide.id` 能进 `RunShotLike`；`media` 缺省不报错 |
| 回归脚本 | `mcp-server/e2e-guide.mjs` 纳入 `package.json` script | 把 §5 的 S0–S4 固化成可重跑脚本；输出 JSON 报告；带 `--lowmem` 参数走 §4 回退链 |
| 前端契约单测 | `mcp-client.test.ts` | 去掉 `21/9/12` 硬编码，改断言「前端清单 ⊆ 服务端实际注册」 |

---

## 7. 验收标准（可机器判定）

| # | 标准 |
|---|---|
| A1 | S0–S4 每一步都是 MCP `tools/call`；命令日志中不存在 `curl/fetch` 直连 8188 或网页点击 |
| A2 | `set_segment_duration` 一次调用后 4 段 duration 全为 4，`version` 只 +1 |
| A3 | S1 四个作业全部 `success`，各回传 `guide.id`，磁盘有 4 个 mp4 + 4 个 `gd_*.safetensors` |
| A4 | S2 单独重跑第 3 段的提交参数含 `guide_id = seg2.media.guide.id`、`use_prev_guide=false`；`guideSource=explicit` |
| A5 | S3 显式引导槽优先于上一段产物：`guide_id` 等于历史选中的 id；`seg4.references.length` 不变 |
| A6 | S4 `get_workbench` / `list_history` / `verify_output` 三处数据一致，无孤儿 guide、无丢失 guide 元数据 |
| A7 | 新增工具全部有工具级单测；`tools/list` 数 = 前端清单数 = `--selfcheck` 数；已签发 token 仍可用 |
| A8 | 全量 `pnpm exec vitest run` 与 `pnpm exec tsc --noEmit` 0 失败；`mcp-server` `pnpm test` 0 失败 |
| A9 | 全程未修改 `D:\Test\projects` 下任何既有项目；未重启 ComfyUI；未改插件代码 |
| A10 | **服务数 = 3**：单个 MCP 进程同时提供 `/mcp`(8787) 与 fs REST(8790)；Vite 不再 spawn fs 子进程；网页 / MCP / ComfyUI 各 1 个进程 |

---

## 8. 风险与回退

| 风险 | 触发 | 回退 |
|---|---|---|
| 8G 内存 OOM / ComfyUI 崩 | S1 首次出片 | §4 回退链；必要时降到 1 段 |
| 插件拒绝过小尺寸（height 48 < min 64） | `run_generation` 提交被拒 | **已实测触发并修复**：MCP `resolveVideoSize` 钳到 `Math.max(64, …)` → 86×64 通过；再失败才回退 100×100 / steps=1 |
| `LAST_GUIDE` 单键被并发完成覆盖 | 一次提交多段且 `use_prev_guide=true` | `run_generation` 串行提交；优先用显式 `guide_id`（S2/S3 本来就是显式） |
| `readWorkbench` 迁移写副作用导致 `VERSION_CONFLICT` | 每次写前 `baseVersion` 过期 | 所有写工具内部重读当前 version；E2E 脚本每次写前 `get_workbench` |
| 新增 capability bit 让旧 token 失效 | 误加 `run.write` | 按 §3 复用现有位；`bootstrapToken` 不改 |
| `dist` 与 `src` 不同步 | 未 build 就启动 MCP | T1 强制 `pnpm build`；`--selfcheck` 校验工具数 |
| 真实项目被误写 | E2E 脚本 projectId 填错 | 脚本启动断言 projectId 以 `ZX_E2E_` 开头；既有 5 个项目路径列入只读黑名单 |
| 存量历史资产无 guide 元数据 | `list_history` 取到旧记录 | `withGuideOnly:true` 过滤；只取本次 S1 新产物 |
| 网页 5180 / MCP 8787 / fs 8790 端口被占用 | 上轮用户「在搞别的软件」 | T1 先探测端口，占用则报给用户，不强杀进程；T0 合并后 8790 由 MCP 进程占用，Vite 插件会探测到并跳过 spawn |
| T0 合并后旧部署脚本仍按两进程拉起 MCP | 双 `--fs-server` + `--http` 同时启动 | `startFileServer()` 的 `/health` 幂等探测会让重复实例 `exit 0`；不阻断，但需在部署文档写明只起 `--http` |

---

## 9. 审核项（2026-11-09 已通过，保留原问题作决策记录）

1. **是否允许执行 §2.1 那 2 条启动命令**（`pnpm run dev` → 网页 5180；MCP `--http` → 单进程 8787 + 8790），合计 3 个服务？上一条曾说「别跑 ComfyUI 服务，我在搞别的软件」。ComfyUI 8188 是外部依赖，已在跑则只读复用、不重启；不在跑则需要你确认能否启动。
2. 测试项目：**MCP 新建 `ZX_E2E_GUIDE_20261109`（推荐，不碰真实数据）**，还是复制 `z6GrKXXM6HxK` 的 35 段？8G 内存下建议前者只建 4 段。
3. 段数 **4 段**是否足够覆盖「批量 → 单独重跑 → 历史插引导」？
4. `scaleFactor=0.1` → **86×48**（极糊，仅验通路）是否接受？若要稍清楚可改 `0.1` 不变但接受画质；`0.2` 会得到 173×96（奇数宽）不推荐。
5. 新增工具是否需要 `dryRun/confirm` 双阶段（与现有写工具一致，推荐是）？
6. §3 工具命名是否按建议定稿（`run_generation` / `set_segment_duration` / `set_shot_guide` / `list_history` / `get_job` / `verify_output`）？
7. §3「可选」的 `import_storyboard` / `delete_segment` / `set_active_episode` 是否本轮一起做，还是留到后续？
8. 审核通过后是否按 §10 顺序一次性执行到底（含补 MCP、补测试、跑 E2E、出报告）？
9. **已定，不再是待确认项**：按你给的口径，正常就是 **3 个服务 = MCP / 网页 / ComfyUI**。`fs-server` 并入 MCP 单进程已列为 §3.0 T0 硬要求、§7 A10 验收项，执行顺序 T0 → T1；网页保持独立托管，不并入 MCP。

---

## 10. 任务分解（审核通过后的执行顺序）

| 阶段 | 内容 | 主要文件 | 验证 |
|---|---|---|---|
| **T0** | **MCP 单进程化**：`--http` 同进程 listen 8790，服务数 4 → 3（§3.0） | `mcp-server/src/index.ts`、`file-server.ts` | `/mcp` 与 `/health` 同进程可达；Vite 不再 spawn 子进程；A10 |
| T1 | 环境：构建 MCP、探测端口、执行 §2.1 的 2 条启动命令（网页 5180 / MCP 单进程 8787+8790）、复用 ComfyUI、`tools/list` 基线 | `mcp-server/` | `--selfcheck` + HTTP initialize |
| T2 | MCP 数据面补齐：`set_segment_duration`、`get_param_schema`，扩 `WorkbenchShot` 类型 | `mcp-server/src/tools/workbench.ts`、`store/workbench.ts` | 工具级单测 |
| T3 | MCP 运行面：`run_generation`（参数派生 + 引导解析 + 串行提交）、`get_job` / `list_jobs` / `cancel_job` | 新增 `mcp-server/src/tools/generation.ts`、`store/jobs.ts` | mock fetch 单测 |
| T4 | MCP 历史/引导面：`list_history` / `get_guide` / `set_shot_guide` / `verify_output` | 新增 `tools/history.ts`、`store/asset-library.ts` 补读 | 工具级单测 |
| T5 | 契约同步 6 处 + 能力位策略复核 | §3.2 清单 | `tool-registry.test.ts` + 前端 `mcp-client.test.ts` |
| T6 | 补 §6 全部测试（含首个 `/mcp` HTTP 集成测试 + T0 单进程用例） | `mcp-server/test/`、前端测试 | `pnpm test` / `vitest run` / `tsc` |
| T7 | 跑 S0→S4 E2E，产出 JSON 报告 | `mcp-server/e2e-guide.mjs` | §7 A1–A10 |
| T8 | 归档：SPEC 状态改「已完成」、登记 `specs/README.md`、写实测结论与遗留 | `project-rules/specs/`、`project-rules/docs/` | 人工审阅 |

---

## 11. 本 SPEC 明确不做

- 不修改 `D:\ComfyUI\...\ComfyUI_ZeroExoNodes` 插件代码、不重启 ComfyUI（§2.4 已确认无需改）。
- 不改动前端引导解析逻辑（上一轮已完成，§2.5）。
- 不修改 `D:\Test\projects` 下任何既有项目数据。
- 不以画质、速度、并发吞吐为目标；不跑满 35 段。
- **不把网页静态托管并入 MCP**（那会变成 2 个服务）；网页保持独立，服务数按 3 判定。
- 不删除 `--fs-server` 独立模式与 stdio 模式（兼容既有部署脚本），只是 `--http` 不再与它们互斥。
- ~~本轮（审核前）不启动任何服务、不改任何功能代码~~ → 审核已通过，本条失效。

---

## 12. 实测结论（2026-11-09）

### 12.1 服务拓扑（A10 通过）

| 服务 | PID | 端口 | 说明 |
|---|---|---|---|
| 网页 Vite | 18836 | 5180 | `pnpm run dev`；探测 8790 已在线，未 spawn fs 子进程 |
| MCP | 17540 | **8787 + 8790** | 同一个 `node dist/index.js --http` 进程，两个 `http.Server` |
| ComfyUI | 17360 | 8188 | **纯 API + 跨域可用**：`--disable-auto-launch --enable-cors-header '*'`（原 16920 缺 CORS 参数，见 §12.7） |

**3 个服务 / 3 个进程**，`Get-NetTCPConnection` 实测 8787 与 8790 的 `OwningProcess` 相同。

### 12.2 MCP 工具与契约

- `TOOL_REGISTRY` = **46**；`--selfcheck` 输出 `tools=46 read=20 write=26`（由 `TOOL_ACCESS` 从 `def.bits` 派生，不再硬编码 9/12）。
- 新增 10 个工具：`set_segment_duration` / `set_shot_guide` / `list_history` / `get_guide` / `run_generation` / `get_job` / `list_jobs` / `sync_job_results` / `verify_output` / `get_param_schema`。
- 前端 `MCP_TOOLS` 同步到 46（20 read / 26 write）；`mcp-client.test.ts` 断言改为从清单派生；设置页速查补运行/引导行与总数。
- **未新增 capability bit**，全部复用 `workbench.write` / `workbench.read` / `asset.read`，已签发 token 仍可用。

### 12.3 E2E 全链路（全部经 MCP `tools/call`）

脚本 `mcp-server/e2e-guide.mjs`（`pnpm e2e:guide` / `pnpm e2e:guide:smoke`），报告 `mcp-server/e2e-guide-report.json`，`ok=true`、15 步。

| 场景 | 实测结果 |
|---|---|
| S0 | 新建项目 `HlmLZeGZvs18`，4 段；`set_shared_params` → steps=3 / scaleFactor=0.1 / refImageSize=match / continuityEnabled=true；**一次** `set_segment_duration(all:true, duration:4)` 改全部段、version +1 |
| S1 批量 | 4 个作业串行提交，派生 **86×64 / 107 帧 / steps=3 / guide_frames=22**；全部 `success`，各回传独立 guide（`gd_0da9…`、`gd_046e…`、`gd_ea92…`、`gd_5f05…`）；`sync_job_results` 回写 `media.guide` + 落历史；`verify_output allPass=true` |
| S2 单段续接 | 只重跑第 3 段 → 提交参数 `guide_id=gd_046e355148df`（**第 2 段产物**）、`use_prev_guide=false`；插件 `guideSource=explicit`、`guideInPath=…/guides/gd_046e355148df.safetensors`。**用户要求「沿用上一段数据」成立** |
| S3 历史插引导 | `list_history(source=director, withGuideOnly=true)` 取 `gd_6a86a8efad25` → `set_shot_guide` 写入第 4 段（references 数不变）→ 单段运行 `guide_id` 等于该历史 id、`guideSource=explicit`、`guideInPath` 指向历史 safetensors |
| S4 全局 | 6 个作业全部通过；4 段都有 `media.guide`；7 条历史资产带 guide；`allPass=true` |

**真实出片**：单段 86×64×107 帧 × 3 steps 实测 61.46s（RTX 5060 Ti / 8G），ComfyUI 日志 `MiniMax H3 Director segment 1/1 done (107 frames, task=r2v)`。视频与 `gd_*.safetensors` 均落盘。

### 12.4 实测中发现并修复的问题

1. **ComfyUI 队列拒绝 `height=48`**：插件 `width/height min=64`（`ref_video.py:88-89`），报 `prompt_outputs_failed_validation`。已在 MCP `resolveVideoSize` 加 `Math.max(64, …)` → 86×64 通过；`step=32` 只是 UI 建议，队列只校验 min/max。
2. **新建项目自带占位片段**：首次 `add_segment` 会用 `emptyWorkbench()` 建容器并带 1 个占位段，MCP 无 `delete_segment`。E2E 脚本改为「每次 add 后重读实际段数，复用占位段」。
3. **MCP 侧 `WorkbenchShot` 缺 `guide`/`media` 字段**：已补齐并与前端 `workbench-types.ts` 对齐；`sync_job_results` 复现网页 `onSegmentDone + autoLandGenerationBlob` 闭环。
4. **ComfyUI 自动拉起浏览器网页**：按用户要求改为 `--disable-auto-launch` 纯 API 模式（HTTP API、`/view`、插件路由保持不变）。

### 12.5 全量测试

| 项目 | 结果 |
|---|---|
| 主项目 `vitest run` | **1306 / 1296 passed / 0 failed / 10 skipped** |
| 主项目 `tsc --noEmit` | 0 错误 |
| `mcp-server` `vitest run` | **71 / 71 passed / 0 failed**（含新增 `director-ops.test.ts` 6 条 + T0 fs handler 同进程用例） |
| `mcp-server` `tsc --noEmit` | 0 错误 |
| E2E `e2e-guide.mjs` | `ok=true`，A1–A10 全部通过 |

### 12.6 遗留 / 后续

- `import_storyboard` / `delete_segment` / `set_active_episode` 仍为可选增强（E2E 用现有 `add_segment` + `set_shot_prompt` 已跑通，不阻塞）。
- `run_generation` 未上传参考图（`reference_image` 留空走文生视频）；需要「带参考图」的生成时，补 `/upload/image` 上传链路。
- 存量 12 条历史资产无 guide 元数据（改动前生成），不会凭空出现「含引导」；需重新生成。
- 网页静态托管仍独立（3 服务口径），未并入 MCP。
- 契约文档 `project-rules/docs/mcp-auth-scope-contract.md` 的旧「20 工具」矩阵为历史记录，工具数以 `--selfcheck` / `MCP_TOOLS` 为准。

### 12.7 追加修复：ComfyUI 跨域诊断文案（2026-11-09）

用户贴出前端提示「服务在线但被浏览器拦截（跨域）… 重启 ComfyUI 即可——桥接插件已自带 CORS，无需 --enable-cors-header 参数？」求证。实测结论：**该文案三处都不成立**。

| 断言 | 实测 / 代码证据 |
|---|---|
| 「请求未返回任何响应」 | 服务端**有响应且是 403**。`server.py:230-233` 的 `origin_only_middleware` 在 Host≠Origin 时直接 `web.Response(status=403)`；浏览器 fetch 因 CORS 失败表现为 reject，前端才误判成「无响应」 |
| 「重启 ComfyUI 即可」 | 重启不加参数无用。`server.py:283-286`：未给 `--enable-cors-header` 时挂 `origin_only_middleware`，换了 CORS middleware 才不会 403；启动参数不变则行为不变 |
| 「桥接插件已自带 CORS，无需该参数」 | **只对 `/zeroexo/h3/*` 成立**：`bridge/cors.py` 的 `with_cors` 仅由 `bridge/routes.py:450` 使用。`/system_stats`、`/zeroexo/v1/*`（health/jobs/capabilities）是 ComfyUI 核心/插件 `__init__.py` 直挂路由，无 CORS；且全局 middleware 403 发生在任何 handler 之前，插件 CORS 头根本到不了浏览器。`comfy/cli_args.py:67` 的 `--enable-cors-header` default=None，恰恰需要显式给 |

实测对照（重启前）：不带 `Origin` → 200；`Origin: http://localhost:5180` / `http://127.0.0.1:5180` → **403**；`Origin: null` → 200；OPTIONS 预检 → 403。

**修复**：
1. 两处文案改为准确诊断（403 根因 + 明确要求 `--enable-cors-header '*'` + 说明插件 CORS 覆盖范围）：`src/features/canvas-tabs/comfyui-endpoint.ts:214`、`comfyui-bridge-client.ts:220`。
2. 修掉「假通过」测试：`comfyui-endpoint.test.ts` / `comfyui-connect-button.test.tsx` 原来只断言 `toContain('--enable-cors-header')`，而错误文案里的「**无需** --enable-cors-header」同样包含该字符串 → 测试永远绿。现加 `not.toContain('无需 --enable-cors-header')` 与 `toContain('403')`。
3. ComfyUI 重启为 `--disable-auto-launch --enable-cors-header '*'`（PID 17360）。复测：`/zeroexo/v1/health` 与 `/system_stats` 带 `Origin: http://localhost:5180` 均 **200 + `Access-Control-Allow-Origin: *`**。

**注意**：`*` 会允许任意站点读本机 8188；本机仅监听 127.0.0.1 时风险可控，若要更严格可把值换成具体 origin（但那样只支持单一来源）。

**验证**：CORS 相关单测 21/21 通过；`tsc --noEmit` 0 错误；全量单测见 §12.5 复跑结果。

### 12.8 追加修复：历史卡片按钮 + 引导槽选择 + CAS storageKey（2026-11-09）

用户两张截图反馈：① 从导演台生成的历史卡片上出现「定位到画布」按钮（无意义）；② 要的「发送引导数据到导演台选定片段」按钮看不见；③ 导演台插槽里选不了已生成视频的引导数据；④ 已插入插槽的视频显示「视频素材文件缺失或未获授权」。

| 问题 | 根因 | 修复 |
|---|---|---|
| ① 定位按钮 | `HistoryGroup.tsx:263` 无条件渲染 `onLocate`，导演台产物根本没有画布节点 | `onLocate` 改为可选；仅 `historySource === 'canvas'` 传入，卡片条件渲染 |
| ② 发送引导按钮 | 显示条件是 `getGuideMeta(asset.data)`（只认已落库的 `data.guide`），而卡片「含引导」角标用的是 `assetMayHaveGuide`（含 jobId 兜底）——**两套判据不一致**，存量产物因此没按钮 | 统一为 `assetMayHaveGuide`；新增 `sendGuideToWorkbench()`（async），无 `data.guide` 时按 `generation.jobId` 回查 `resolveGuideForAsset` 并回写资产记录 |
| ③ 插槽选引导 | `AssetPickPanel` 只有 canvas/asset/subject/openlib/upload，无 guide 候选；引导槽只能被动接收「发送」事件 | `AssetPickTab` 加 `guide`；新增 `GuideCandidate` / `guideCandidates` / `onPickGuide`，渲染 `[data-guide-candidate-list]`；导演台引导槽无数据时显示 `[data-guide-add]`、有数据时点击可替换，面板进入 `tabs={['guide']}` 单页签模式，选中写 `shot.guide`，**不进 `references[]`、不占 9 格** |
| ④ 文件缺失/未授权 | MCP `sync_job_results` 把 `storageKey` 写成 ComfyUI 磁盘**绝对路径**；前端 `resolveMediaUrl` 只认 `cas:<hash>.<ext>` | 新产物流：先 `uploadToCas` 把视频字节写进 `D:\Test\media\cas\`，历史记录与 `shots[].media` 都用 `cas:` key。存量流：新增 `repair_asset_storage_keys`（幂等），把历史资产记录、各项目 `workbench.json` 的 `references[]` / `media.storageKey` 里的绝对路径一并转成 CAS key |

**实测存量修复**：`repair_asset_storage_keys` 第一次修 7 条历史资产，第二次修 6 个 workbench 引用（涉及 `HlmLZeGZvs18`、`JxunGfg9EN9r`、`z6GrKXXM6HxK`）。复核：19 条资产中 17 条 `cas:`、绝对路径 0；CAS 文件缺失 0；10 个项目的 workbench 绝对路径引用 0。前端需刷新一次以重读磁盘数据。

**工具数**：47（read 20 / write 27），新增 `repair_asset_storage_keys` 已同步 `MCP_TOOLS`。

**验证**：`tsc --noEmit` 前端/MCP 均 0 错误；前端全量 **1310 / 1300 passed / 0 failed / 10 skipped**；MCP 全量 **73 / 73 passed / 0 failed**。新增用例：历史卡片按钮分派 3 条、引导槽主动选择 1 条、MCP CAS 落库与幂等修复 2 条。
