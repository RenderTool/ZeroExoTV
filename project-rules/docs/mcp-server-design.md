# MCP Server 设计文档（zeroexo-comfyui）

> 版本：M1（2026-11-04）。前提契约：`project-rules/docs/mcp-auth-scope-contract.md`（本次任务按需求方口述条款补建，原文件缺失）。

## 1. 一句话结论

MCP M1 工具数 = 20（读 9 / 写 11），传输 = stdio 为主 + 可选 `--http`（StreamableHTTP），写通道 = MCP Node 进程直写 `<dataRoot>/projects/<id>/entities/*.json`（与前端 File System Access 写的同一批文件），single-writer 保证 = 过渡期「进程内 per-path 互斥锁 + version 乐观锁（baseVersion）+ mtime/size 双因子校验 + 临时文件 rename 原子写」，M2 收口为本地 HTTP 写接口。

## 2. 架构（文字图）

```
外部 LLM/Agent（Claude Code / Trae / 任意 MCP Client）
        │  stdio（默认）或 StreamableHTTP（--http）
        ▼
┌────────────────── mcp-server（Node + TS，@modelcontextprotocol/sdk）─┐
│  index.ts 入口 → 鉴权(auth.ts, zxp_/zxs_ token) → 工具路由(tools/)   │
│  每请求：能力位校验 → project 作用域校验 → zod 入参校验 → 执行       │
│  写路径：store/*.ts → fs-node.ts（withFileLock + baseVersion 比对     │
│          + temp+rename 原子写）→ 审计 audit.ts（jsonl）              │
└──────────────────────────────────────────────────────────────────────┘
        │  读写同一批文件
        ▼
<dataRoot>（默认 D:\Test，可用 ZEROEXO_DATA_ROOT 覆盖）
  ├─ .lf/zeroexo/app_meta/projects.json        项目列表（信封格式）
  ├─ projects/<id>/entities/script.json        剧本（唯一事实源）
  ├─ projects/<id>/entities/storyboard.json    主体库（唯一事实源）
  ├─ projects/<id>/entities/workbench.json     导演台（唯一事实源）
  ├─ projects/<id>/entities/cas_index.json     CAS 索引
  ├─ media/cas/<sha256>.<ext>                  CAS 物理文件
  ├─ .mcp/tokens.json                          token 哈希表
  └─ .audit/mcp-<date>.jsonl                   审计
        ▲
        │  File System Access API（writeFile 原子写 / writeJsonIfUnchanged 乐观锁）
浏览器前端（React 编辑器）── watchScript 2s 轮询兜底发现外部写入
```

## 3. 写通道取证与选型

**现状：唯一写者是浏览器前端，走 File System Access API。**

- `src/platform/fs.ts:182-190`：`writeFile` 通过 `createWritable` 全量写、close 提交，天然原子（浏览器对 file handle 写是整体提交）。
- `src/platform/fs.ts:214-220`：`writeJsonIfUnchanged` 乐观锁，比对 `size + lastModified`。
- `src/platform/fs.ts:254-258`：`fingerprint` 探针，注释明写「MCP 写盘后轮询兜底用」。
- `docs/entities-redesign-2026-11-04.md` §5.2：**官方既定方向 = entities/ 的唯一写入路径是 MCP / coding 工具**（前端编辑器对 entities 逐步转为读为主）；`src/pages/editor-page.tsx:1120` 注释同。
- 前端已有 `watchScript` 2 秒轮询（`src/entities/script-store.ts:201-249`），能自动发现 MCP 的外部写入并刷新 UI，**M1 无需改前端**。

**选型结论**：M1 让 MCP Node 进程直接读写同一数据根——这是前端自己预留的方向（fingerprint 注释）。**不新写第二套业务 JSON 写逻辑**：实体 schema、version+1 语义、nextEpisodeNumber/autoEpisodeTitle 规则、assignAssetSlots 槽位语义全部从 `src/entities/` 现有实现逐条移植/对齐（见 §7），写纪律（baseVersion、备份目录、信封格式）与前端保持一致。

**并发冲突方案（过渡期双写者：前端 + MCP）**：
1. 进程内 per-path 互斥锁（`Map<path, Promise>` 串行化同文件写）；
2. 所有写工具强制 `baseVersion`：读时记录 `version`，写前比对实体内 `version` 字段 + 文件 `mtime/size` 双因子，任一不一致返回 `VERSION_CONFLICT { expected, actual }`；
3. 写盘用「临时文件 + rename」原子提交（对齐浏览器 createWritable 的整体提交语义）；
4. 冲突错误为可读文案，引导调用方重新读后写。

**M2 收口**：前端暴露本地 HTTP 写接口（或独立后端服务），entities 写操作单一收口，前端与 MCP 都走它，互斥锁与乐观锁下沉到该服务。

## 4. 传输选型

| 传输 | 场景 | 结论 |
|------|------|------|
| **stdio**（默认） | 本地 Agent（Claude Code / Trae / Cursor）直接 spawn 子进程 | ✅ 主选：零端口、零暴露面、鉴权天然由「谁能启动进程」控制 |
| **StreamableHTTP**（`--http --port`） | 远程 Agent / 局域网内其他软件 | ✅ 可选：MCP 现行 HTTP 标准，此时强制要求 Authorization token |
| SSE（旧版） | — | ❌ 不选：协议已废弃 |

## 5. 鉴权与作用域

按 `project-rules/docs/mcp-auth-scope-contract.md` 落地：`zxp_` / `zxs_` 前缀、SHA-256 哈希存储、projectIds × 能力位校验、越权拒绝并审计。实现位置：`mcp-server/src/auth.ts`。

## 6. 工具清单（M1 = 20）

约定：写类工具一律带 `baseVersion`；批量写支持 `dryRun:true`（返回 before/after diff 预览）与 `confirm:true`（真实落盘），二者互斥。

### 项目域（tools/projects.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| list_projects | 读 | project.read | — | `[{ id,title,updatedAt,nodeCount,entitiesReady }]`（按 token 作用域过滤） |
| get_project | 读 | project.read | projectId | 项目 meta + 资产路径概览（entities 各文件是否存在、media/cas 计数） |
| open_project | 读 | project.read | projectId | `{ url: "http://localhost:<port>/#/editor/<id>" }`（前端路由 hash 格式见 `src/app/app.tsx`） |
| create_project | 写 | project.write | title, tags? | `{ projectId, url }`；只写 projects.json 信封 + 建目录骨架，**不写 graph**（留前端首开自建） |

### 剧本域（tools/script.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| list_episodes | 读 | script.read | projectId | `[{ id,number,title,status,segmentCount }]` |
| get_script | 读 | script.read | projectId, episodeId? | episode 全文（HTML content）+ version |
| create_episode | 写 | script.write | projectId, baseVersion, title?, content? | 新 episode（number=max+1，title 缺省「第N集」，对齐 `script-store.ts` 规则） |
| import_script | 写 | script.write | projectId, baseVersion, content, strategy=new_episode\|append\|overwrite, dryRun?, confirm? | strategy=overwrite 前先备份 `entities/backups/script-<ts>.json`；dryRun 返回 diff |

### 拆解域（tools/split.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| split_script_to_shots | 写 | split.write | projectId, episodeId, baseVersion, dryRun?, confirm? | 按场景/段落切分剧本 → 片段草案（number/description/duration 默认 5s）；dryRun 返回草案清单供确认，confirm 落 workbench.shots |

### 主体域（tools/subjects.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| list_subjects | 读 | subject.read | projectId, kind? | storyboard.entities[]（ProductionItem：id/name/kind/aliases/consistency/images…） |
| upsert_subject | 写 | subject.write | projectId, baseVersion, subject{id?,name,kind,aliases?,note?,episodeIds?} | 有 id 则更新、无则新建 `item-…`；dryRun/confirm 支持 |
| link_subject_to_shot | 写 | subject.write+workbench.write | projectId, baseVersion, shotId, subjectId?, matchByName? | 把主体挂到片段 references[]（DirectorAssetRef）；matchByName 时返回候选清单而非直写 |

### 资产域（tools/assets.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| list_assets | 读 | asset.read | projectId, scope=project\|library | project=entities/cas_index.json 中 refs 含本项目条目；library=全局去重视图 |
| upload_asset | 写 | asset.write | projectId, filename, dataBase64, mime | SHA-256 → `media/cas/<hash>.<ext>`（去重：已存在仅 refCount+1），返回 storageKey=`cas:<hash>.<ext>`；维护 cas_index 不变量（条目存在⇔文件存在，refCount=refs.length） |
| attach_asset_to_slot | 写 | asset.write+workbench.write | projectId, baseVersion, shotId?\|shared, storageKey, slotHint? | 走 assignAssetSlots 语义：公共资产占槽 1..K、片段资产 K+1 续排；超限返回 SLOT_OVERFLOW |

### 导演台域（tools/workbench.ts）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| get_workbench | 读 | workbench.read | projectId | WorkbenchContainer 全量（tracks/shots/sharedParams/version） |
| set_shared_params | 写 | workbench.write | projectId, baseVersion, patch{presetId?,params?} | 更新 sharedParams（presetId ∈ h3\|sd2.5，对齐 DIRECTOR_PRESETS）；不存在公共提示词字段，携带未知字段（如 prompt）报 VALIDATION 错，重复内容写每段提示词 |
| set_shot_prompt | 写 | workbench.write | projectId, baseVersion, shotId, imagePrompt?, videoPrompt? | 更新片段双轨提示词 |
| add_segment | 写 | workbench.write | projectId, baseVersion, description, shotType?, duration? | 新增片段（id=`seg-<ts>-<rand>`，status=pending，clipState=placeholder） |

### 分镜图智能比对（tools/storyboard-ingest.ts，M1 接口预留）

| 工具 | 读写 | 能力位 | 关键入参 | 返回 |
|------|------|--------|----------|------|
| ingest_storyboard_images | 读 | asset.read+workbench.read | projectId, episodeId?, shotIds?, images[]（{filename,dataBase64}）, matchStrategy=hash\|perceptual\|manual | **M1 不落盘**：hash 策略比对 CAS 索引返回 `{ shotId, candidates:[{storageKey,confidence}], status:"pending_confirm" }[]`；perceptual 返回 NOT_IMPLEMENTED 提示 M2 |

## 7. 实体写纪律（与前端对齐）

| 实体 | schema 来源 | MCP 侧对齐要点 |
|------|-------------|----------------|
| script.json | `src/entities/script-store.ts:43-56` | version:number 乐观锁（创建=1，每次+1）；baseVersion 必填、0=仅创建；nextEpisodeNumber=max+1；autoEpisodeTitle='第N集'；sourceInfo.createdBy='mcp'；ensureScript 幂等 |
| storyboard.json | `src/entities/slot-containers.ts:22-33` | ProductionItem id=`item-…`；kind ∈ character\|scene\|prop；updateStoryboardContainer version+1 |
| workbench.json | `src/entities/slot-containers.ts:53-64` | 片段 id=`seg-<ts>-<rand>`；duration 默认 5s；sharedParams.presetId ∈ h3\|sd2.5；ensureWorkbenchContainer 幂等自带片段 1 |
| 槽位/参数 | `src/entities/director-params.ts` | assignAssetSlots（公共 1..K、片段 K+1 续排、超限抛错）、durationToFrames(17k+5 吸附) **最小移植**到 `mcp-server/src/store/director-params.ts`（纯函数，浏览器包不可 import） |
| cas_index.json | `src/entities/cas-store.ts` | 不变量：条目存在⇔文件存在；refCount=refs.length；storageKey=`cas:<hash>.<ext>` |
| projects.json | `packages/plugins/persistence-localforage/src/project-store.ts:63-77` + `src/platform/disk-driver.ts:73-84` | 信封 `{__lf:1, value:[…]}`；create 只追加 meta，不写 graph 信封 |

## 8. 错误码

`AUTH_INVALID / AUTH_FORBIDDEN / AUTH_PROJECT_DENIED / NOT_FOUND / VERSION_CONFLICT / VALIDATION / CONFIRM_REQUIRED / SLOT_OVERFLOW / IO_ERROR / NOT_IMPLEMENTED`

## 9. 审计

`<dataRoot>/.audit/mcp-<YYYY-MM-DD>.jsonl`；字段与脱敏规则见契约 §5。同步追加写（appendFileSync），失败不阻塞主流程但 stderr 告警。

## 10. 落地阶段

- **M1（本次）**：stdio + 可选 HTTP；20 工具；token 文件鉴权；乐观锁 + 互斥锁 + 原子写；审计；dryRun/confirm；≥3 单测。
- **M2**：前端 entities 写操作收口到本地 HTTP 写接口（single-writer 真正落地）；perceptual 图片比对；export_director_pack / get_asset_binary / remove_asset_ref / update_project_meta；token 管理 UI。
- **M3**：多用户协作锁、云端同步冲突合并、ingest_storyboard_images 自动落盘 + 人工确认工作台。
