# 子画布 / 项目内画布副本（Sub-Canvas）规格

日期：2026-11-06（数据结构定稿）
范围：仅 `zeroexo-comfyui`（本地版，Plan#83 派生模块，归属 Plan#84）
状态：**结构已定稿并落地**（见「落地状态」）
不触碰：资产卡片发送动作、导演台导轨。

---

# 项目数据结构定稿（2026-11-06，用户纠正后）

> 用户原话：“**一个项目包括 N 个画布（默认一个主画布不可删除状态）+ 一个剧本 + 一个出片，
> 数据结构上属于挂载关系，相当于 C++ 中的多态，是项目 Node 的变体**。”
> 关键差异：画布不是“主画布 + 它肚子里的子项”，而是**与剧本/出片平级的项目挂载物**，
> 并且画布这一类**本身就是多实例的**（N 份），其中 1 号不可删。

## 实测现状（不是推测，全部仍磁盘与代码可对账）

| 东西 | 磁盘位置 | 唯一写者 | 形状 |
|---|---|---|---|
| 首页项目清单 | `.lf/zeroexo/app_meta/projects.json` | `plugin-persistence` project-store | `{__lf:1, value:[{id,title,createdAt,updatedAt,thumbnailUrl,tags,nodeCount,version,cloudId,lastSyncedAt}]}` |
| **主画布 graph** | `.lf/zeroexo/graph_data/zeroexo%3Agraph%3A<pid>.json` | PersistencePlugin（防抖自动落盘） | localforage 信封 + `.lf/_map.json` 索引；大 data 另分片 `graph:<pid>:data:<nodeId>` |
| 剧本实体 | `projects/<pid>/entities/script.json` | `entities/script-store.ts` | `{version, episodes[], …}`，baseVersion 乐观并发 |
| 主体库容器 | `projects/<pid>/entities/storyboard.json` | `entities/slot-containers.ts` | `{schemaVersion, version, title, shots, entities, subjectTree, updatedAt}` |
| 出片容器 | `projects/<pid>/entities/workbench.json` | 同上 | `{schemaVersion, version, title, tracks, shots, totalDuration, sharedParams, updatedAt}` |
| 快照库 | `projects/<pid>/entities/snapshots/<kind>/*.json` | `entities/snapshot-store.ts` | 写入前后自动快照 |
| 项目内画布副本 | `projects/<pid>/canvases/<cid>.json` | 本模块 | 裸 JSON（1 号不走这里） |

项目已有“挂载”机制的实锤：`ensureProjectMounts(projectId)`（slot-containers.ts:386）在首次进入项目时
**幂等自愈**地挂上 script + storyboard + workbench 三件，契约齐备：`{schemaVersion, version, title, …payload, updatedAt}`
+ 乐观并发 + “只写 entities/*.json、绝不写 graph”。

**结构问题就一个**：画布与实体不同层不同格式——主画布在 `.lf/graph_data`（键值区），副本在
`projects/<pid>/canvases/`（裸 JSON），而剧本/出片在 `projects/<pid>/entities/`（带 version）。
所以“N 份平级画布”**无法用同一个契约遍历**，这正是结构问题的根源。

## 目标模型

```
项目 Project（app_meta/projects.json 一条 meta + projects/<pid>/ 目录）
└─ 挂载物集合（同一契约：schemaVersion / kind / id / title / version / updatedAt）
   ├─ canvas   × N   ← 1 号主画布 locked（不可删不可关），其余副本可关可删
   ├─ script   × 1
   ├─ storyboard × 1（主体库/分镜）
   └─ workbench × 1（出片）
```

目标目录（与实体同层同构）：

```jsonc
// projects/<pid>/canvases/<cid>.json     // cid = 'main' 或 sc…
{
  "schemaVersion": 1,
  "kind": "canvas",
  "id": "main",                 // 1 号固定叫 main（与 app_meta 里的 pid 一一对应）
  "projectId": "<pid>",
  "title": "1号画布",
  "order": 0,                    // 标签从左到右顺序
  "locked": true,                // 仅 1 号=true：不可删；可否改名见 Q4
  "coverKey": null,
  "version": 3,                  // 乐观并发（与 script/workbench 同语义，UI 与 MCP 共写可冲突）
  "createdAt": "…", "updatedAt": "…",
  "graph": { "nodes": [], "edges": [], "viewport": {"x":0,"y":0,"k":1}, "metadata": {} }
}
```

上层只看到一个统一入口（副本与 1 号同 API，调用方不分叉）：
`canvas-store.ts` → `listCanvases(pid) / getCanvas(pid, cid) / saveCanvas(…) / createCanvasFromSelection(…) / promoteCanvasToProject(…) / renameCanvas / setCanvasCover / deleteCanvas(1 号直接拒绝)`。

## 主画布放哪（必拍项）

| 方案 | 做法 | 代价 / 风险 |
|---|---|---|
| **A 彻底同构** | 主画布也变成 `canvases/main.json`；`.lf/graph_data` 降为缓存，由 canvas-store 作为唯一读写口（PersistencePlugin 改接或关掉自带落盘） | 要动**引擎持久化插件的读写链**（自动保存/防抖/分片/`_map.json`），风险等级完全不同；老项目需首次进入幂等迁移（读旧 graph → 写 main.json → 旧文件改 `.bak` 不删） |
| **B 虚拟 1 号（推荐先落）** | 1 号继续留在 `.lf/graph_data`（现有自动保存一行不改）；canvas-store 对 `id==='main'` 走**适配器**读写 graph-store，目录里只存副本文件 | 磁盘上画布仍不完全同层，但**上层契约与 UI 完全同构**；将来要切 A 只换适配器，上层零改动 |

推荐：**B 先落，接口按 A 写**。A 单独开一个 Plan（牵动引擎包与全量老项目，不能与本模块同批）。

## 行为口径

- **生成**：框选（组自动展开后代）→「保存为画布副本」= **复制**节点与内部连线到新文档，**主画布原样不动**；
  节点保留原 id 与 `storageKey`（副本是另一份文档，不跨文档抢 id）；不插代理卡、不重连跨界边。
- **打开**：副本与 1 号在**同一层标签**并排（顶层 CanvasTabBar）；
  1 号不可关，副本可 ×（关完回 1 号）；页签 key = `canvas:<cid>`（1 号 `canvas` 即主画布槽位）。
- **抽屉**：独立分组「画布」，卡片**直接复用主页 `ProjectCard` + `CoverUploadModal`**（同一封面机制），
  菜单：打开 / 重命名 / 设封面 / 存为独立项目 / 删除（1 号不显示删除）。
- **存为独立新项目**：`createProject` + 写入新项目的 **1 号画布**（封面同步到 `graph.metadata.coverUrl`
  与 `meta.thumbnailUrl`）；素材 key **不重写**（新项目里能正常解析，但物理上仍属原项目目录）→ 要物理切分走已测的导出/导入链路（Q3）。
- **删除**：只删文档（+ 关掉对应标签），二次确认弹窗居中；不存在“孤儿扫描”这种概念。
- **MCP**：三个 subcanvas 工具改名并入 canvas 域（`list_canvases` / `get_canvas` / `save_canvas`），
  **1 号也可读**（否则“画布是项目一等挂载物”对 MCP 不成立）；写仍只允许节点级补丁，不开放结构增删。

## 拍板结果（2026-11-06 用户定稿）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 主画布放哪 | ✅ **B 虚拟 1 号**：`.lf/graph_data` 不动（引擎自动保存一行不改），`canvas-store` 对 `id='main'` 走适配器；目录里只存副本。将来升级 A 只换适配器 |
| Q2 | 目录名 | ✅ `projects/<pid>/canvases/`（与 `entities/` 同层平级），旧 `subcanvases/` 废弃 |
| Q3 | “存为独立项目”时素材是否物理复制 | ✅ **不物理复制**（用户原话：现在都是测试数据，直接全部清理）；弹窗里明写“素材仍位于原项目目录”，要真搬走走导出/导入 |
| Q4 | 1 号画布能不能改名 | ✅ 能改名、能换封面；**不可删、不可关标签**（`locked` 只锁删） |
| Q5 | 副本能否再生副本 | ✅ 能（普通“保存为副本”，无嵌套概念） |

地基已落：`src/entities/canvas-store.ts`（统一契约 + B 适配器 + 乐观锁 + 1 号不可删），`pnpm typecheck` = 47（= 基线）。

## 实现顺序（拍板后按此推进，不再中途问）

1. 地基：`canvas-store.ts`（✅ 已完成）
2. 生成链：选区 → `createCanvas(graphRef:inline)`（复制语义，主画布不动）
3. 标签层：顶层 `CanvasTabBar` 的「画布」右侧并排副本标签（可 ×），页签 key = `canvas:<cid>`
4. 工作区：`SubCanvasWorkspace` 改接 `canvas-store`（按 cid 读写，1 号不走这条路径）
5. 抽屉：新分组「画布」= 复用 `ProjectCard` + `CoverUploadModal`，菜单 打开/重命名/设封面/存为独立项目/删除（1 号不显示删除）
6. MCP：`subcanvas` 三工具改名 `canvas` 域且 1 号可读
7. 验收：typecheck / 全量单测 / build / Spec 与 Plan 回写

## 落地状态（2026-11-06 整改完成，上述 1-7 已全部做完）

| 块 | 落地 | 备注 |
|---|---|---|
| 契约层 | `src/entities/canvas-store.ts` + `canvas-store.test.ts`（8 例） | 与 `slot-containers` 同构：`{schemaVersion, kind:'canvas', id, projectId, title, order, locked, coverKey, version, createdAt, updatedAt, graphRef, graph?}`；1 号 `graphRef='project'`（图仍在 `.lf/graph_data`），副本 `graphRef='inline'` |
| 生成链 | `features/sub-canvas/canvas-copy.ts` | **纯复制**（组自动展开后代，保留原 id 与 storageKey）；不进命令队列，主画布零改动 |
| 顶层标签 | `canvas-tab-store.ts`（`openCanvasTabs` / key=`canvas:<cid>`）+ `canvas-tab-bar.tsx` 并排渲染 | 1 号仍是不可关的固定槽位；副本可拖拽、可 ×；第二层页签条已删除 |
| 工作区 | `CanvasWorkspace.tsx` | 第二引擎实例（三开关不变）+ 500ms debounce 乐观锁自存 + 冲突居中确认框；按 cid 读写 |
| 抽屉 | `canvas-assets/groups/CanvasCopiesGroup.tsx` | 直接用主页 `ProjectCard` + `CoverUploadModal`；菜单：打开/重命名/设封面/存为独立项目/删除（1 号无后两项） |
| MCP | `mcp-server/src/store/canvases.ts` + `tools/canvases.ts` + `test/canvases.test.ts`（11 例） | 工具改名 `list_canvases`/`get_canvas`/`patch_canvas_nodes`；**1 号可读不可写**（写它会和前端防抖自动保存相打），副本走 size+mtime 双因子 |

**过程中修掉的一个真缺陷**：`createCanvas` 原先直接 `writeJsonIfUnchanged(path, doc, null)` 就认为“不会覆盖”——
但 `platform/fs.ts` 的实现里 `expected=null` 只代表“不做版本比对”，**不代表“文件必须不存在”**，
撞名时会静默盖掉用户已有画布。现改为先 `stat` 再写，命中即抛 `ConflictError`（单测 + 接线守卫各一条钉住）。

**已删除的旧模型产物**（不得复活，接线守卫逐条断言）：`subcanvas-store.ts`、`subcanvas-types.ts`、
`subcanvas-extension.tsx`、`subcanvas-node-view.tsx`、`subcanvas-stubs.ts`、`SubCanvasExternalStubs.tsx`、
`subcanvas-removal.ts`、`SubCanvasLayer.tsx`、`SubCanvasWorkspace.tsx`、`canvas-tabs/sub-canvas-tab-bar.tsx`；
代理节点类型不再注册，i18n 命名空间 `subCanvas.*` → `canvasCopy.*`。

**Phase 2 残留**：① 副本内新增连线无需再登记 crossLinks（模型已无此概念）——但副本与 1 号**不共享节点 id 命名空间**
以外的联动（副本改了不会回写 1 号，这是设计而非缺陷）；② “存为独立项目”不搬素材（要搬走走导出/导入）；
③ 抽屉卡片的“复制副本”动作（主页有 copy，本处暂用“再次保存副本”代替）。
