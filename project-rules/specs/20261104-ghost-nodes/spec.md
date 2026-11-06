# 幽灵节点取证与修复 Spec（2026-11-04）

## 0. 汇报开头要求的实数（先行给出）

**幽灵节点实数：3 个，其中墓碑 3 / 孤儿 0 / 空数据 0。**
另有 1 个"空内容图片节点"（data 完整但 content:""、无 storageKey），属合法空态，不算幽灵。

数据源真相：画布数据**不在** `D:\Test\projects\<id>\project.json`（该文件不存在），
实际落盘在 localforage 转储 `D:\Test\.lf\zeroexo\graph_data\zeroexo%3Agraph%3A<projectId>.json`。

| 项目 graph | nodes 总数 | `_deleted=true` | type 分布 | data 为空 |
|---|---|---|---|---|
| NH7_rQlsR8oD3NnYAdOLI | 1 | 0 | text×1 | 0 |
| VPvNRH-OOSIeXTp1NR5ho | 3 | 1 | text×1 image×1 novel×1 | 0 |
| vxMsNaEJpMrPprgNLSRCP | 3 | 2 | storyboard×1 workbench×1 image×1 | 0 |

幽灵节点明细表：

| 项目 | nodeId | type | _deleted | data 是否为空 | 是否在注册表 |
|---|---|---|---|---|---|
| VPvNRH… | node-1793721368955-zmrecl | text | ✅ true | 否（有 content） | 是 |
| vxMsNa… | node-1793734281330-td1x71 | storyboard | ✅ true | 否（title/status/尺寸） | 是 |
| vxMsNa… | node-1793734285902-l7g8w5 | workbench | ✅ true | 否（有 shots/tracks） | 是 |
| vxMsNa… | node-1793734313628-na9ax7 | image | false | 否（但 content:"" 空内容） | 是 |

计划外事实（只报告，不处理）：
1. NH7 graph 仅剩 1 节点，但残留 **24 条悬空边**指向约 29 个已不存在的 nodeId（渲染层已被 activeNodeIds 过滤，不可见）。
2. `graph_data` 有 `scwepq3FuTtjwLMmlXEsP` 的 5 个节点数据溢出文件，但**无对应主 graph 文件**（孤儿存储）；NH7 亦有 2 个溢出文件对应图中不存在的节点。
3. `app_meta/projects.json` 仅登记 vxMs 一个项目，且 `nodeCount: 5` ≠ 实际 3（计数含墓碑/已过期——根因见 sync-projects.ts:94,129 未过滤）。

## 1. 三类成因逐一证伪/证实

### 成因 1：墓碑残留——**证实（交互层），渲染层已证伪**

渲染层已过滤（✓）：
- `packages/plugins/render-react/src/components/node-layer.tsx:632-641` visibleNodes 过滤 `_deleted`
- `packages/plugins/render-react/src/components/canvas-view.tsx:177-182` activeEdges 经 activeNodeIds 过滤（同时挡掉悬空边）
- `canvas-view.tsx:309` 空态判定过滤；`store.ts:67-74` getActiveNodeIdSet 过滤
- `group/src/hierarchy-panel.tsx:433`、`group/src/group-layer.tsx:187`、`minimap/src/minimap-view.tsx:74`（前三轮已修）

**未过滤（✗，即幽灵交互路径）**：
| 位置 | 用途 | 后果 |
|---|---|---|
| `render-react/src/store.ts:366` | 空间索引 `rebuild(this.graph.nodes)` 含墓碑 | 下游全部中招 |
| `selection/src/controller.ts:79-85` | 框选 hitTest 直接返回 queryRect 结果 | **框选选中不可见墓碑**（选中计数/工具栏在空白处出现） |
| `interaction/src/controller.ts:723-725` | 吸附/对齐辅助线只排除 draggedIds | **拖动时对齐线吸附到不可见墓碑** |
| `render-react/src/components/block-canvas-layer.tsx:223,280,358` | LOD 色块层渲染+hitTest，无任何过滤 | **缩小时墓碑渲染成色块、可被点中** |
| `group/src/index.ts:153` | 预览空态 `graph.nodes.length === 0` | 墓碑干扰空态判定 |
| `src/pages/editor/editor-canvas/editor-page.tsx:428,434` | fit-all  bounds 含墓碑 | 缩放适配跳到包含不可见节点 |
| `editor-page.tsx:916` | canvasHasNodes | 同上 |
| `editor-page.tsx:1149`、`use-editor-state.ts:968` | sameTypeCount 命名计数 | 序号虚高（"图片3"实 only 1 可见） |
| `src/services/sync/sync-projects.ts:94,129` | nodeCount 元数据 | projects.json nodeCount=5≠3 的根因 |

按 id 查找类（`find(n => n.id === …)`）不受影响，不列入修复。

### 成因 2：孤儿节点（类型未注册）——**机制证实，当前数据证伪（0 个）**

- 注册表现状：`packages/plugins/nodes/src/index.tsx` 内置 text/generator/image/video/audio/aiPlaceholder/stackedMedia；`src/features/canvas-nodes/extensions.tsx:205-212` 注册 script/storyboard/workbench/novel；另有 color-card。**当前数据中 5 种 type 全部在册，孤儿 0 个。**
- 机制：`node-layer.tsx:779` `ext = extensions.get(node.type)` → 未注册时 `ext=undefined` → L299 `renderer=ext?.renderNode=undefined` → 落到 L812-845 `DefaultNodeContent`，渲染一个只显示原始 type 字符串的空壳方框 = 视觉幽灵。**不崩溃、不跳过、无"未知"标识。**
- 风险：storyboard/workbench 正被另一路从注册表移除，届时存量节点即成孤儿。

### 成因 3：空数据节点——**证伪（0 个严格空 data）**

`NodeRecord.data` 为可选（`packages/core/src/model/types.ts:17 data?: unknown`）。当前 7 个节点 data 均为非空对象。vxMs 的 image 节点属"空内容"（content:""），是图片节点合法空态，不算数据被清。

## 2. 修复设计

### 2.1 唯一判定入口（core 层新增）

新建 `packages/core/src/model/node-visibility.ts`，从 `packages/core/src/index.ts` 导出：

```ts
export type NodeVisibility = 'visible' | 'unknown-type' | 'empty-data' | 'tombstone' | 'invalid';
export function classifyNode(node, opts?: { isTypeRegistered?: (t: string) => boolean }): NodeVisibility;
export function isVisibleNode(node, opts?): boolean;      // classify ∈ visible | unknown-type | empty-data
export function filterVisibleNodes<T>(nodes: T[], opts?): T[]; // = nodes.filter(isVisibleNode)
```

判定规则：
- `invalid`：id 非字符串或空 → 不可见
- `tombstone`：`_deleted === true` → 不可见
- `unknown-type`：提供注册表且 type 不在册 → **仍可见**（占位渲染，可选中可删除；满足"不要删、等拍板"）
- `empty-data`：data 存在但为 null/非对象 → 可见（同占位策略，不静默消失）
- 其余 → visible

**决策点（需用户确认）**：用户原文 "isVisibleNode = 墓碑+类型已注册+数据完整" 与 "孤儿给占位可选中可删除" 存在张力。
本 spec 采用：isVisibleNode 只挡墓碑/无效；孤儿与空数据**保持可见但渲染占位卡**（否则它们会从画布/层级/框选同时消失且无法再选中删除，变成更深的幽灵）。

### 2.2 占位渲染（孤儿/空数据）

`node-layer.tsx` NodeItem 内：`ext === undefined` 时渲染 `UnknownNodeContent`（虚线边框卡片，文案 `未知节点 · {type}`，带短 id），复用现有 NodeItem 外壳 → 天然可选中、可右键删除。层级面板行内对未注册 type 显示 `⚠ type` 徽标。

### 2.3 全量替换分散过滤（每处一行级改动）

| 文件 | 行 | 改动 |
|---|---|---|
| core/src/model/node-visibility.ts | 新 | 上述三函数 + 导出 |
| render-react/src/store.ts | 71, 366 | getActiveNodeIdSet / spatialIndex.rebuild 改用 filterVisibleNodes |
| render-react/src/components/node-layer.tsx | 632 | 过滤改 isVisibleNode（保留 group/hidden/祖先逻辑）；NodeItem 加 UnknownNodeContent 分支 |
| render-react/src/components/block-canvas-layer.tsx | 组件入口 | `nodes.filter(isVisibleNode)` 后供渲染/预载/hitTest 三处共用 |
| render-react/src/components/canvas-view.tsx | 309 | 空态判定改 filterVisibleNodes |
| group/src/hierarchy-panel.tsx | 433 | 改 isVisibleNode + 未知类型徽标 |
| group/src/group-layer.tsx | 187 | 改 isVisibleNode |
| group/src/index.ts | 153 | 空态判定改 filterVisibleNodes |
| minimap/src/minimap-view.tsx | 74 | 改 isVisibleNode |
| interaction/src/controller.ts | 723 | 辅助线加 isVisibleNode 过滤 |
| selection/src/controller.ts | 84 | 防御：hitTest 结果交集 getActiveNodeIdSet（索引已修，此为双保险） |
| editor-page.tsx | 428, 434, 916, 1149 | fit-all/canvasHasNodes/sameTypeCount 改活跃口径（共享文件，最小行改） |
| use-editor-state.ts | 968 | sameTypeCount 改活跃口径 |
| sync-projects.ts | 94, 129 | nodeCount 改活跃口径 |
| hierarchy-list-view.tsx / content-beacon.tsx / read-only-canvas-overlay.tsx | 编辑前重读确认 | 语义为"活跃集合"处改 isVisibleNode；纯 id 查找不动 |

不动：storyboard/workbench 页面文件、页签组件、i18n 表、提示词模块；不删任何节点数据（storyboard/workbench 空节点归另一路）。

### 2.4 验收单测

新建 `src/pages/editor/editor-canvas/ghost-nodes-20261104.test.tsx`（深路径直连源文件，规避 fluent-emoji 链；vi.mock 同 bugfix-20261104.test.tsx 模式）：
1. classifyNode 五态判定（墓碑/无效/孤儿/空数据/正常）
2. isVisibleNode：墓碑×、无效×、孤儿✓、空数据✓、正常✓
3. store.getActiveNodeIdSet：不含墓碑、含孤儿
4. 空间索引 queryRect：墓碑不可命中、孤儿可命中（命中区与可见集一致）
5. 框选 endMarquee：选中集不含墓碑、含孤儿
6. 未知类型节点在 NodeLayer 渲染为"未知节点"占位（渲染断言）

## 3. 验证

- `pnpm vitest run src/pages/editor/editor-canvas/ghost-nodes-20261104.test.tsx` 全绿
- 回归 `bugfix-20261104.test.tsx` 15/15 保持绿
- `tsc --noEmit`：与基线 45 个存量错误完全一致，无新增
