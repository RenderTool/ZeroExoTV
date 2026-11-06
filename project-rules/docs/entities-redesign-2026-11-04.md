# 三页签取证 + 实体层 schema 设计（2026-11-04）

> 范围：前端 `zeroexo-comfyui`（React+Vite 画布）、后端 `zeroexo-platform/zeroexo_backend`（NestJS）。
> 本轮只做取证与设计，未改动 `src/` 任何组件；新增物仅 `scripts/tools/migrate/scan-legacy-nodes.mjs`（只读扫描脚本）、`scripts/tools/migrate/migration-report.json`（扫描产物）与本文档。

---

## 一、结论速览

1. **「剧本 / 分镜 / 出片」三个页签是 2026-11-04 刚上线的「固定槽位」**，不是路由页面，全部挂在编辑器页内，靠 zustand `canvas-tab-store` 的 `slotBindings` 决定点击后干什么。
2. **剧本页「点开无反应」不是编译/路由崩溃，而是整条链路被设计成「失败全静默」**：绑定解析失败→静默；供应失败→静默；内容加载不到资产→渲染 `null`（白屏）。三个断点都有代码实锤（见 §2.2）。性质上属**结构缺失**（新链路 11-02/11-04 才建，失败路径无兜底、无用户反馈），不是旧功能回归。
3. **用户怀疑「业务数据塞 node.data」——对分镜/出片成立，对剧本已不成立**：
   - 分镜/出片 = 画布节点 `type:'storyboard'/'workbench'`，全部业务数据在 `node.data`（shots、shotsByEpisode、entities、subjectTree、tracks、mediaAssets……）；
   - 剧本已于 2026-11-02 挪出节点，改存**本地磁盘 `.lf` 信封区**的资产记录（`kind:'script'`），仅靠 `data.canvasId` 字符串与项目关联——**项目目录里没有剧本文件**，换数据根目录即"丢剧本"。
4. **数据现状是三套并行**：前端磁盘驱动（`projects/<id>/project.json` + `.lf/` 信封 + `assets/` 媒体）；后端 Postgres `Project` 行的 `script/storyboard/generations/config/assets` JSON 字段 + Yjs 命名空间；后端 `storage/resources/front/canvases/.../scene-vN.json` 快照。**没有任何一层存在独立的「剧本/分镜/出片实体」资源端点或文件**。
5. **存量统计（后端快照，10 个项目取各自最新版）**：`script` 节点 11 个、`storyboard` 8 个、`workbench` 6 个——**有项目存在多个剧本节点**，与「一个项目一个剧本」的设计契约已经冲突，迁移时必须去重。

---

## 二、任务 A：取证

### 2.1 三个页签的入口与数据通路

三个页签**不走路由**，全部是 `EditorPage` 内的槽位视图：

| 页签 | 入口 | 点击后链路 | 数据源 |
|---|---|---|---|
| 剧本 | `canvas-tab-bar.tsx:96-104` `handleActivate('script')` | 有绑定→`activateTab('script:<assetId>')`；无绑定→`requestSlotProvision('script')` → `editor-page.tsx:172-186` 供应 effect → `ensureCanvasScript()` → 绑定+激活 → `editor-page.tsx:1087-1101` 渲染 `<ScriptTabContent/>` | **本地资产记录**：`script-tab-content.tsx:49-56` 调 `listAssets()` 找 `kind==='script' && data.canvasId===canvasId` 的资产，内容在 `asset.data.content`（JSON 字符串，内含 `episodes[]`） |
| 分镜 | 同上，`kind='storyboard'` | 无绑定时 `editor-page.tsx:187-205` **直接在画布上创建 `type:'storyboard'` 节点**（`AddNodeCommand`，`data:{title,status:'idle'}`），节点组件经 `createPortal` 把编辑器渲染到页签内容层 | **`node.data`**：`creation-node-view.tsx:109-128` 从 `node.data` 白名单读出 `shots / shotsByEpisode / entities / subjectTree / subjectAiIndex / colorCard / aiSubjects / productionItems / aiMemory` 等 17 个字段 |
| 出片 | 同上，`kind='workbench'` | 同分镜，创建 `type:'workbench'` 节点 | **`node.data`**：`creation-node-view.tsx:132-147` 白名单读出 `shots / tracks / mediaAssets / entities / scriptSummary / report / sourceStoryboardId / deletedSourceShotIds` 等 14 个字段 |

关键结构事实：
- 页签条本身：`canvas-tab-bar.tsx:44-153`，渲染位置在顶栏 `top-bar.tsx:205`（桌面居中）与 `:229`（移动端）。
- 槽位绑定规则：`canvas-tab-store.ts:71-83`（`SlotBindings`：剧本绑资产 id，分镜/出片绑节点 id）；无绑定时 `slotTabKey()` 返回 `null`，页签以 0.55 透明度显示为「未供应」。
- 内容层挂载：`editor-page.tsx:1087-1102`，`activeTabKey !== 'canvas'` 时才渲染内容层（zIndex 310）。

### 2.2 「剧本页点开没反应」的代码级原因

点击链本身在当前源码中是通的（绑定→激活→渲染）。问题在于**每一环失败都被静默吞掉**，用户看到的就是"点了没反应"或"白屏"。三个实锤断点：

**断点 ①：绑定解析失败静默** — `editor-page.tsx:152-168`
```ts
const asset = findCanvasScript(await listAssets(), canvasId);
if (asset) { ...setSlotBindings({ script: asset.id }); return; }
attempts += 1;
if (attempts < 6) window.setTimeout(...);  // 3 秒重试窗口耗尽后彻底放弃，无任何提示
```
`listAssets()` 若 reject（磁盘根目录未授权/不可读），`void resolveScriptBinding()` 产生 unhandled rejection，绑定永远为 `null`。

**断点 ②：供应请求被消费后失败静默** — `editor-page.tsx:176-184`
```ts
tabStore.clearSlotProvision();          // 先一次性消费掉请求
void ensureCanvasScript(canvasId, ...).then((asset) => {
  if (!asset) return;                    // ← 创建失败：静默 return，页签毫无变化
  ...
});                                      // ← 整段无 .catch，reject 同样静默
```

**断点 ③：内容组件查不到资产直接渲染 null（白屏）** — `script-tab-content.tsx:51-72`
```ts
const found = list.find((a) => a.id === tabId && (a.kind as string) === 'script') ?? null;
setAsset(found);
...
if (!isActive || !asset) return null;    // ← 页签已激活但资产丢失 → 整页空白，无空态提示
```
绑定 id 是陈旧的（资产被删/数据根目录切换后记录不存在）时必现此分支。

**深层结构原因（为什么容易踩中）**：剧本数据的「事实源」是 `asset-store.ts:47-55` 的 localforage `zeroexo:assets` 记录，经自定义磁盘驱动落到 **`.lf/zeroexo/app_state/<编码key>.json` 信封文件**（`disk-driver.ts:43-47` 非裸 JSON 目标一律进 `.lf/`；`fs.ts:313-325` 的裸 JSON 白名单只有 `project.json / meta.json / index.json`）。剧本与项目的唯一关联是资产记录里的 `data.canvasId` 字符串（`canvas-script.ts:18-29`）。**项目目录 `projects/<id>/` 下没有剧本文件**——这与「一个项目 = 一部剧，剧本是项目固定成员」的目标架构根本不兼容。

**回归还是结构缺失？** 判定为**结构缺失**：剧本页签链路是 2026-11-02（剧本挪出节点）+ 2026-11-04（单例槽位）新建的，三个断点从写下第一天就是静默语义；不存在"以前好、后来坏"的旧通路。叠加因素：dev-server 日志显示 `script-tab-content.tsx / editor-page.tsx` 等正处于并行任务高频 HMR 改动中（`dev-server.log` 尾部），且当前工作树 `tsc8.txt` 有 50+ 类型错误（均在 sync/agent-bridge 等边缘模块，不阻塞 vite 运行，但说明树处于中间态）。

> 环境项附带确认：`dev-server.log` 末尾进程以 Ctrl+C 退出（exit 3221225786）——若用户是在 dev server 未运行时打开页面，"页面打不开"就是字面意义的服务未启动，与代码无关。

### 2.3 现状盘点：剧本/分镜/出片各存在哪

| 层 | 位置 | 剧本 | 分镜 | 出片 |
|---|---|---|---|---|
| 前端磁盘 | `projects/<id>/project.json`（裸 JSON） | ✗ 不含 | graph 内 storyboard 节点的 `data.*` | graph 内 workbench 节点的 `data.*` |
| 前端磁盘 | `.lf/zeroexo/app_state/zeroexo%3Aassets.json`（信封） | ✅ `kind:'script'` 资产，`data.content` = `{episodes[]}` JSON 字符串，`data.canvasId` 绑项目 | ✗ | ✗ |
| 前端磁盘 | `.lf/zeroexo/<graph桶>/zeroexo%3Agraph%3A<id>.json`（信封，见下注） | graph 节点 data 冗余 | 同上 | 同左 |
| 后端 DB | `Project` 行（`schema.prisma:114-152`） | `script Json?`（:129） | `storyboard Json?`（:131） | 无独立字段（仅 `generations Json?` 生成历史） |
| 后端 Yjs | Hocuspocus 命名空间（`sync.service.ts:10-22`） | `script:<projectId>` → `Project.script` | `storyboard:<projectId>` → `Project.storyboard` | ✗ 无命名空间 |
| 后端磁盘 | `storage/resources/front/canvases/{owner}/{project}/scene-v{N}.json`（`versions.service.ts:30-40`） | 快照内含 script 节点 data | 同左 | 同左 |

注：`use-editor-state.ts:218` 传 `storageKey:'zeroexo:graph'`、`setProjectId(canvasId)`，持久化键为 `zeroexo:graph:<canvasId>`（`persistence-localforage/src/index.ts:178`）；该键在 `fs.ts:313-325` 的映射中首段为 `zeroexo`、**不命中 `graph:` 前缀规则**，实际落 `.lf/` 信封而非裸 `project.json`——这与磁盘驱动头注释「projects/<id>/project.json 是可读目标」的设计意图存在出入，建议并行任务核实（NEW_CONFIG 前缀为 `'graph'`，`index.ts:76`）。

后端 REST 端点（`canvas.controller.ts:23-94`）：只有项目整体 CRUD 与 `projects/:id/graph`，**没有** `/script`、`/shots`、`/outputs`、`/entities` 独立资源端点。`.lf` 在后端无任何引用（`Grep \.lf` 零命中）——`.lf` 纯是前端本地格式。

### 2.4 存量统计

只读扫描脚本：`scripts/tools/migrate/scan-legacy-nodes.mjs`（已实跑，产物 `scripts/tools/migrate/migration-report.json`）。
统计口径：后端 `storage/resources/front/canvases/**/scene-v*.json`，每项目取最高版本快照（旧版本为历史快照，不重复计数）。

| 指标 | 数值 |
|---|---|
| 项目数（有快照） | 10 |
| `script` 节点 | **11**（超过项目数 ⇒ 存在单项目多剧本节点，迁移需去重） |
| `storyboard` 节点 | 8 |
| `workbench` 节点 | 6 |
| 全部节点类型分布 | image 17 / script 11 / text 8 / storyboard 8 / workbench 6 / video 3 / stacked-media 1 / group 1 / novel 1 |

抽样实证（`NH7_rQlsR8oD3NnYAdOLI` 项目最新快照）：`script` 节点 `data` 键 = `title, status, content, episodes, isSample, activeEpisodeId, sampleInitialized`——**剧本文本确实曾以节点 data 形式存在**（旧形态），11-02 后新建项目改走资产记录，两代数据并存。

**统计限制**：前端本地数据（数据根目录 `.lf/` 与 `projects/`）在用户机器上、需 File System Access 授权，本脚本不可达；后端 DB 的 `Project.script/storyboard` JSON 字段需另走 prisma 查询，未连库。故上表仅为**后端快照口径的下界**。

---

## 三、任务 B：实体层 schema 设计

### 3.1 目录形态

```
projects/<projectId>/
├── project.json            # 元信息 + graph.layout（画布只留布局）
├── meta.json               # 列表页用轻量元信息（现有契约保留）
├── entities/
│   ├── script.json         # 剧本（1）
│   ├── shots/              # 分镜段（N），每段一文件
│   │   ├── ep01s01.json
│   │   └── ...
│   ├── outputs.json        # 出片（N）
│   └── assets.json         # 项目内资产关联
└── assets/                 # 媒体二进制（现有契约不动）
```

### 3.2 `project.json`（元信息；graph 降级为纯布局）

```json
{
  "projectId": "c7177652-ecaf-441d-94e0-38a191cba707",
  "title": "示例剧",
  "type": "studio",
  "schemaVersion": 2,
  "createdAt": "2026-11-04T00:00:00.000Z",
  "updatedAt": "2026-11-04T00:00:00.000Z",
  "entities": {
    "script": "entities/script.json",
    "shotsDir": "entities/shots",
    "outputs": "entities/outputs.json",
    "assets": "entities/assets.json"
  },
  "graph": {
    "viewport": { "x": 0, "y": 0, "k": 1 },
    "layout": [
      { "nodeId": "asset-node-1", "kind": "assetRef", "assetId": "as_zhujue",
        "position": { "x": 120, "y": 80 }, "size": { "w": 240, "h": 180 } }
    ],
    "edges": [
      { "id": "e1", "from": "asset-node-1", "to": "asset-node-2", "kind": "assetRelation" }
    ]
  }
}
```

铁律：`graph` 内只放 `viewport / layout(位置、尺寸、连线的视觉关系) / assetRef`，**任何业务内容（剧本文字、分镜提示词、出片参数）一律不写回 graph**。

### 3.3 `entities/script.json`（剧本：版本、段落、行、状态）

```json
{
  "schemaVersion": 1,
  "title": "示例剧",
  "activeEpisodeId": "ep-1",
  "episodes": [
    {
      "id": "ep-1",
      "number": 1,
      "title": "第1集",
      "status": "draft",
      "segments": [
        {
          "segId": "ep01s01",
          "seq": 1,
          "lines": [
            { "lineId": "L1", "kind": "narration", "text": "……", "speaker": null },
            { "lineId": "L2", "kind": "dialogue", "text": "……", "speaker": "角色甲" }
          ],
          "sourceRange": "L1-L12"
        }
      ],
      "versions": [
        { "version": 1, "createdAt": "...", "note": "初稿", "fingerprint": "sha1:…" }
      ]
    }
  ],
  "updatedAt": "..."
}
```

`status` 口径沿用后端 `StudioEpisode`：`draft | split_pending_review | split_reviewed | storyboard_ready | done`（`schema.prisma:217-218`）。

### 3.4 `entities/shots/<segId>.json`（分镜段——与导演包契约逐字段对齐）

字段名与 `zerovideoAgent/references/director-pack-schema.md` §4（group.json）保持同一口径，导出导演包时零改名直映：

```json
{
  "schemaVersion": 1,
  "id": "ep01s01",
  "episodeId": "ep-1",
  "seq": 1,
  "prompt": "<Picture 1> ……段提示词全文…… <d>[Chinese] 台词</d>",
  "negativePrompt": "",
  "frameCount": 124,
  "length": 124,
  "durationSec": 5.17,
  "start": 0,
  "taskType": "",
  "continuityFromPrev": false,
  "refImageSize": "max",
  "frameRate": 24,
  "refs": [
    { "slot": 1, "assetId": "as_changjing1", "role": "scene", "note": "只锁机位/构图/光影" },
    { "slot": 5, "assetId": "as_zhujue", "role": "subject" }
  ],
  "refAudios": [],
  "refVideos": [],
  "camera": { "shotSize": "近景", "movement": "随生长同步下沉转仰", "angle": "仰角" },
  "dialogue": [{ "speaker": "S1", "text": "……", "timeRange": [0.0, 2.4] }],
  "status": "draft",
  "promptFingerprint": "sha1:…",
  "updatedAt": "..."
}
```

对应关系（→ 导演包）：`prompt/negativePrompt/frameCount/length/durationSec/start/taskType/continuityFromPrev/refImageSize/refs/refAudios/refVideos` 原样进 `asset_groups/NN/group.json`；`refs[].slot` = 全局槽位号（公共图 1..K、组内 K+1 续排，单段图 ≤9 / 音 ≤3 / 视 ≤3）；`start` 缺省由 `scripts/export_director_pack.py` 按前序段 frameCount 累计装配。`camera/dialogue/status` 为实体层扩展字段，导出时剥离。

### 3.5 `entities/outputs.json`（出片：段 × 版本）

```json
{
  "schemaVersion": 1,
  "outputs": [
    {
      "outputId": "out_ep01s01_v3",
      "segId": "ep01s01",
      "version": 3,
      "status": "approved",
      "video": { "path": "assets/<projectId>/video/ep01s01_v3.mp4", "durationSec": 5.2, "width": 1728, "height": 736 },
      "promptFingerprint": "sha1:…",
      "packRef": "packs/ep01/03.mmxpack.zip",
      "genParams": {
        "taskType": "r2v",
        "widgets": { "steps": 8, "sampler": "res_multistep", "scheduler": "simple", "cfg": 1,
                     "shift_video": 12, "shift_audio": 3, "seed": 666, "task_type": "r2v — 参考主体生视频(Reference to Video)" },
        "output": { "width": 1728, "height": 736, "refImageSize": "max",
                    "continuityEnabled": true, "continuityOverlapFrames": 22 }
      },
      "createdAt": "..."
    }
  ]
}
```

`genParams.widgets` 严格只放导演包承认的 8 键（schema 文档 §2）。`promptFingerprint` = 出片时所喂段提示词的指纹，用于「提示词改了但出片还是旧版」的对账。

### 3.6 `entities/assets.json`（项目内资产关联）

```json
{
  "schemaVersion": 1,
  "assets": [
    { "assetId": "as_zhujue", "kind": "character", "name": "主角",
      "source": { "type": "generated", "path": "assets/<projectId>/image/zhujue.png" },
      "binds": [{ "to": "subject", "id": "as_zhujue" }, { "to": "shot", "id": "ep01s01", "slot": 5 }],
      "status": "locked" }
  ]
}
```

`kind`: `character | scene | prop | colorCard | audio | other`（对齐后端 `StudioAsset.kind` 三分法并扩展）；`binds[]` 表达「该资产绑定到哪个主体/哪一段的哪个槽位」。

---

## 四、旧节点 data → 新实体字段映射表

（与 `scan-legacy-nodes.mjs` 内置 `FIELD_MAP` 一致，✓=迁移 / ✗=丢弃 / ?=待拍板）

| 旧位置（node.type） | 旧字段路径 | 去向 | 处理 |
|---|---|---|---|
| script | `data.episodes` / `data.content` | `script.json → episodes[]`（旧单集 content 迁为首集） | ✓ |
| script | `data.activeEpisodeId` / `data.title` | `script.json → activeEpisodeId / title` | ✓ |
| script | `data.status` / `data.isSample` / `data.sampleInitialized` | — | ✗ 运行态/示例标记 |
| storyboard | `data.shots` / `data.shotsByEpisode` | `shots/<segId>.json`（按 episode 拆段，重排 seq） | ✓ |
| storyboard | `data.entities` / `data.subjectTree` / `data.subjectAiIndex` / `data.aiSubjects` | `assets.json`（主体圣经关联） | ✓ |
| storyboard | `data.colorCard` | `project.json → colorCardRef` | ✓ |
| storyboard | `data.sourceScriptId` | 段 `episodeId`/`sourceRange` 回指 | ✓ |
| storyboard | `data.status` / `data.progress*` / `data.steps` / `data.conflicts` | — | ✗ 生成运行态 |
| storyboard | `data.productionManagerId` / `data.productionItems` / `data.aiMemory` | 制作管理/Agent 记忆归属 | ? 拍板点 ③ |
| workbench | `data.shots` | `outputs.json → outputs[]` | ✓ |
| workbench | `data.mediaAssets` / `data.entities` | `assets.json` | ✓ |
| workbench | `data.tracks` | `outputs.json` 多轨扩展（若保留多轨） | ✓ |
| workbench | `data.sourceStoryboardId` / `data.deletedSourceShotIds` | `outputs.json → sourceRef` / 同步墓碑 | ✓ |
| workbench | `data.scriptSummary` / `data.report` / `data.status` / `data.totalDuration` / `data.completedCount` | 派生物，由 outputs 聚合再算 | ✗ 不落库 |
| 任意节点 | `position` / `size` / `title`（视觉） | `project.json → graph.layout` | ✓ 仅布局 |

---

## 五、迁移报告样例与单一写者

### 5.1 迁移草案（只读，已交付）

- 脚本：[scripts/tools/migrate/scan-legacy-nodes.mjs](../../scripts/tools/migrate/scan-legacy-nodes.mjs)
- 产物：[scripts/tools/migrate/migration-report.json](../../scripts/tools/migrate/migration-report.json)
- 能力：扫描全部 scene-vN 快照 → 每项目取最新版 → 节点类型分布 + 三类业务节点的 data 字段清单/并集 + episodes/shots 数量抽样 + 逐字段映射建议。**不写任何实体文件**；真正迁移（写入 entities/）需用户拍板后另写 `--apply` 模式。
- 报告样例片段见 §2.4 表格；完整 JSON 含每项目 `bizNodes[].dataFields` 明细。

### 5.2 单一写者与并发

- **entities/ 唯一写入路径：MCP / coding 工具**（与 `editor-page.tsx:1119-1120` 注释「画布读写由外部 coding 工具经 MCP 直接操作数据目录」的既定方向一致）。写入纪律：整文件原子写（临时文件 + rename）、写前重算 `updatedAt` 与指纹、跨文件引用（segId/assetId）写后校验。
- **前端只读 + 变更走 API**：页签渲染 entities 内容；编辑动作提交到后端接口（或本地桥），由写者落盘并广播。
- **前端直写 entities 的风险点**（必须堵）：
  1. 与 MCP 写入**并发撞车**——JSON 整文件 last-write-wins，一方改动被整体覆盖；
  2. **非原子写**产生半截 JSON，下游（导演包导出）解析即崩；
  3. 双写路径导致**格式漂移**（信封 `.lf` vs 裸 JSON 的教训已在 `fs.ts:313-325` 出现）；
  4. 前端内存态与磁盘态**失同步**（listAssets 读缓存，MCP 改了文件前端无感知）；
  5. 引用完整性无校验（段删了、outputs 还指着 segId）。

---

## 六、落地顺序与拍板点

**落地顺序**（每步独立可验收）：
1. 冻结 entities schema（本文 §3），写者侧（MCP/脚本）先实现 `entities/` 读写 + 校验；
2. 迁移脚本加 `--apply`：快照 + `.lf` 剧本资产 → entities/，先 dry-run 出报告再真写；
3. 前端三页签改为从 entities 读（API/桥），node.data 业务字段停止写入；
4. graph 降级为 layout-only（旧 data 字段读取下线）；
5. 全量回归后删除节点类型 `script/storyboard/workbench` 的业务 data 白名单（`creation-node-view.tsx:92-147`）。

**需要用户拍板（5 条）**：
1. **事实源位置**：entities/ 文件为唯一事实源，后端 DB 的 `Project.script/storyboard/generations` 字段与 Yjs 命名空间是「废弃」还是「云端镜像」？（影响要不要做双写过渡）
2. **分镜存储粒度**：每段一文件 `shots/<segId>.json`（本方案，利于单段重写与导演包直映） vs 单文件 `shots.json`？
3. **运行态字段归属**：`productionManagerId/productionItems/aiMemory` 丢弃、还是迁入独立 `entities/production.json`？
4. **多剧本节点去重**：存量 11 个 script 节点 > 10 个项目，同项目多节点合并策略——按 `updatedAt` 取最新丢弃其余，还是逐集合并？
5. **出片多轨**：`workbench.data.tracks` 是否保留进 outputs.json（保留多轨语义），还是出片只认「每段选定版本」的线性结构？
