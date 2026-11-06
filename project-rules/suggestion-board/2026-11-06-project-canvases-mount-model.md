# 征集 #184 · 项目 = N 个画布（1 号不可删）+ 剧本 + 出片 的挂载模型；抽屉要能看到画布列表

> 编号说明：立项时与并行的 #178-#183 撞号，已改 #184（正文内引用同步）。

- 日期：2026-11-06
- 提出人：用户（验收 Plan#84 时两次纠正，本条为最终口径）
- 归属：**改判 Plan#84**（早期「主画布 + 子画布肚子里的子项」模型作废，按画布挂载模型重写）
  详见 `zeroexo-comfyui/project-rules/specs/sub-canvas/spec.md` 顶部设计段
- 类型：功能强化（数据结构重新定义）+ 交互决策（标签层级、抽屉列表）+ 遗漏（我方理解偏差）

---

## 1. 用户原话（三条，按时间顺序）

1. “不是我发现你在瞎搞！我让你做子画布的意思是让你**存成一个新画布挂载在这个项目中**就行了！而不是让你开发一个新页面！！！！类似**多开**！！然后**抽屉里要有一个地方能看到这些保持的子项目**！！”
2. “一个项目包括 **N 个画布（默认一个主画布不可删除状态）+ 一个剧本 + 一个出片**，数据结构上属于**挂载关系**，相当于 C++ 中的**多态**，是项目的 Node 的**变体**（具体要参考项目来定）”；并要求“**先把项目数据结构搞清楚再动手开始改**”。
3. “打开和主项目的画布是**并排的标签**——相当于主画布和子画布本质都是所属这个项目目录下的子画布！也可以随时**独立成新项目变成 1 号画布**！”

## 2. 早期实现错在哪（自查）

| 我做的 | 用户要的 |
|---|---|
| 把选区从主画布**搬走**，主画布留一张代理卡 | **复制**成项目里的另一份画布，主画布原样不动 |
| 子画布标签挂在主画布**下方第二层**小页签条 | 与主画布**同一层并排**标签 |
| 为"搬走"补了一整套跨界边重连 + 外部桩卡 + 孤儿扫描 | 这些概念根本不该存在 |
| 抽屉里没有任何列表入口 | 抽屉要有**独立入口**看画布列表，卡片形式同主页项目（封面、重命名…），并能"存为独立项目" |

## 3. 现状勘察结论（实测 D:\Test，不是推测）

- 首页项目清单：`.lf/zeroexo/app_meta/projects.json`（`{__lf:1, value:[meta]}`）
- **主画布 graph：`.lf/zeroexo/graph_data/zeroexo:graph:<pid>.json`**（引擎 PersistencePlugin 自动落盘，大 data 分片）
- 剧本 / 主体库 / 出片：`projects/<pid>/entities/{script,storyboard,workbench}.json`，统一契约
  `{schemaVersion, version, title, …payload, updatedAt}` + `ensureProjectMounts()` 幂等自愈挂载
- 结论：**画布与实体不同层不同格式**，"N 份平级画布"无法用同一契约遍历 —— 这正是结构性问题根源

## 4. 拍板结果（2026-11-06）

- **Q1 主画布放哪** → 方案 B「虚拟 1 号」：`.lf/graph_data` 一行不动，`canvas-store` 对 `id='main'` 走适配器；目录里只存副本文件。将来升级"彻底同构"只换适配器。
- **Q2 目录名** → `projects/<pid>/canvases/`（与 `entities/` 同层平级），旧 `subcanvases/` 废弃。
- **Q3 独立成新项目时素材** → 不物理复制（用户：现在都是测试数据，直接全部清理）；弹窗明写"素材仍位于原项目目录"。
- **Q4 1 号画布** → 可改名、可换封面；**不可删、不可关标签**。
- **Q5 副本再生副本** → 可以（普通"保存为副本"，无嵌套概念）。

## 5. 处理结果

- 地基已落：`src/entities/canvas-store.ts` —— 画布成为项目第 4 类挂载物（`kind:'canvas'`，1:N，1 号 `locked`），
  统一 API：`listCanvases / getCanvas / saveCanvas / createCanvas / rename / setCover / deleteCanvas(1号拒绝) / ensureCanvasMounts`，
  副本文件带 `version` 乐观锁 + `graphRef:'inline'`，1 号 `graphRef:'project'`（图仍在 `.lf`）。`typecheck = 47`（= 基线）。
- 半成品**止血**（不继续叠）：「保存为子画布」入口改为显式提示"结构重设计中"；猜着写的抽屉列表组件连四段接线一并撤回；
  旧代理卡 / 外接桩 / crossLinks / 孤儿扫描代码已整体删除。
- 待做（Spec「实现顺序」）：生成链改复制 → 标签层并排（删第二层页签条）→ 工作区改接 canvas-store → 抽屉「画布」分组（复用 `ProjectCard` + `CoverUploadModal`）→ MCP 改名 `canvas` 域且 1 号可读 → 全量验收与治理回写。

## 6. 整改完成（2026-11-06 同日，“彻底整改”指令后）

上述待做六项**已全部做完**（详记 Plan#84）：

- 契约层 `src/entities/canvas-store.ts`：与 `entities/slot-containers` 同构的画布契约（`kind:'canvas'` + `order`/`locked`/`coverKey`/`version`/`graphRef`），
  `ensureCanvasMounts` 幂等自愈；**1 号 = 虚拟挂载**（图仍在 `.lf/graph_data`，引擎自动保存一行不改），副本 = `projects/<pid>/canvases/<cid>.json`。
- 生成链 `canvas-copy.ts`：选区→**纯复制**（组自动展开后代，保留原 id 与 storageKey）；主画布零改动，不插代理卡、不重连跨界边。
- 顶层标签：`canvas-tab-store` 改为 `openCanvasTabs`（key=`canvas:<cid>`），副本标签与 1 号**并排同一行**（可拖拽、可 ×，关完回 1 号）；第二层页签条已删除。
- 工作区 `CanvasWorkspace.tsx`：按 cid 读写 + 500ms debounce 乐观锁自存 + 冲突**居中**确认框（重载/覆盖）；保留三开关与 `new-node.ts` 单一来源。
- 抽屉新分组「画布」：直接用主页 `ProjectCard` + `CoverUploadModal`；菜单 打开/重命名/设封面/存为独立项目/删除（1 号不给后两项）。
- MCP：`list_canvases` / `get_canvas`（**1 号也可读**）/ `patch_canvas_nodes`（**1 号一律拒绝**，只允节点级补丁）；双因子写回与 id 路径穿越守卫。
- 旧模型产物已全部删除（代理卡、外接桩、crossLinks、孤儿扫描、第二层页签条、第二 store），并由 `sub-canvas-wiring.test.ts` 逐条钉住不得复活；
  i18n `subCanvas.*` → `canvasCopy.*`；view-prefs `openSubCanvasesByProject` → `openCanvasesByProject`（读时兼容旧键）。
- **修掉一个真缺陷**：`writeJsonIfUnchanged(path, _, null)` 的 `null` 只代表“不做版本比对”，**不代表“文件必须不存在”**
  （`src/platform/fs.ts:246-252`）→ `createCanvas` 撞名会静默盖掉用户已有画布。现先 `stat` 再写，命中即抛 `ConflictError`。
  教训：同一存储层的“幂等/新建”语义必须读实现确认，不能凭函数名推断。
- 验收：`pnpm typecheck` = 47（= 基线，本轮文件 0 新增）；全量 `vitest run` = 118 文件 / 112 passed / 1 skipped / **5 failed（全存量）**；
  新增 `canvas-store.test.ts` 8 例 + `sub-canvas-wiring.test.ts` 16 例 + `mcp-server/test/canvases.test.ts` 11 例全绿；
  两端构建 exit=0；dev server 新增模块逐个 200。**待用户实操验收**（框选→保存副本→顶层标签→抽屉列表→存为独立项目）。
