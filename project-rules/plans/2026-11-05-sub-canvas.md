---
状态: in-progress
负责人: ai
创建: 2026-11-05
最后更新: 2026-11-06
关联经验: 无（新模块；完成后候选沉淀「第二引擎实例隔离」与「子文档乐观锁」）
---

# Plan#84 子画布（Sub-Canvas）：选区抽出为可关闭子页签画布

> 需求来源：征集 [#175](../../suggestion-board/2026-11-05-comfyui-sub-canvas-module.md)
> 规格权威：`zeroexo-comfyui/project-rules/specs/sub-canvas/spec.md`（本 Plan 不重复设计细节，只拆执行）
> 2026-11-05 用户拍板：**开工**（“然后开始改造计划吧”）→ 状态转 in-progress。
> 2026-11-05 用户纠正：**子画布页签视觉直接复用线上 `zeroexo_front` 的 `canvas-tab-bar.tsx`**（用户自有项目），
> 原“只借契约不抄视觉”作废；另挂起 Q4（线上激活下划线用 `theme.toolbar.accent`，与“状态色不用红”新口径冲突）。
> 基线提交：**跳过**——`zeroexo-comfyui` 目录无 git 仓库，无法做基线/回滚对比（已向用户报备）。

## 目标

把主画布上的一组节点一键抽出为**独立可编辑的子画布**，主画布只留一张入口代理卡；子画布以「挂在主画布下的可关闭页签」形态存在（交互契约对齐线上 `zeroexo-front` 资源页签，视觉沿用本地版胶囊分段），数据落磁盘文件保持 MCP 可读（Plan#83 D1）。

## 影响文件清单（并行门必填）

与在途 Plan#83 的交集检查：83 当前验收面 = 资产抽屉/拖拽落图/导演台；本 Plan 触碰 `canvas-tab-store.ts`、`editor-page.tsx`、`use-editor-interactions.ts`、`use-node-actions.ts`、`node-capsule-toolbar.tsx`、`export-projects.ts` → **与 83 有交集**，须等 #83 验收轮（含征集 #174 热修）收口后再开工，或与 83 同事确认串行。

- 新建：`src/features/sub-canvas/{subcanvas-extension.tsx, subcanvas-node-view.tsx, create-sub-canvas.ts, subcanvas-store.ts, subcanvas-autosave.ts, SubCanvasWorkspace.tsx, sub-canvas-tab-bar.tsx}` + 同名单测
- 改动：`src/features/canvas-tabs/canvas-tab-store.ts`、`src/features/canvas-tabs/canvas-tab-bar.tsx`、`src/pages/editor/editor-canvas/{use-editor-interactions.ts, use-editor-interactions/use-node-actions.ts, use-editor-state.ts, editor-page.tsx}`、`src/features/tools-dock/node-capsule-toolbar.tsx`、`src/shared/{connection-rules.ts, view-prefs.ts}`、`src/pages/home/services/export-projects.ts`、`src/i18n/{zh,en,ja}.json`

## 子任务

- [x] **T0 Spike S1/S2/S3**（2026-11-06 S1 静态结论已得，运行时验证归入 T4b）
  1. 目标文件：`packages/presets/default/src/index.ts:94`（只读核查，未改）
  2. 修改点：无（可行性核查）
  3. 复用形态：`createDefaultEditor` 自带 `enablePersistence / enableKeyboard / enableMinimap` 三个开关，子实例传 `false` 即可避开 localforage 互写与 window 级快捷键双绑定；每实例独立 `Editor/CommandQueue/EventBus/ReactGraphStore` → undo 栈天然隔离
  4. 验收断言：S1 静态通过已记入 Spec §7；**残留风险**：`nodeActionBus` 是模块级单例（事件跳实例），运行时串扰验证归 T4b 子工作区落地时补；S2 已由 T1 单测覆盖（乐观锁/冲突/孤儿只报告）；S3 待 T2

- [x] **T1 数据层**（2026-11-06 完成）
  1. 目标文件：`src/features/sub-canvas/subcanvas-store.ts`（新建）+ `subcanvas-store.test.ts`
  2. 修改点：`readSubCanvas / writeSubCanvas / createSubCanvas / updateSubCanvas / listSubCanvases / deleteSubCanvas / collectLiveSubCanvasIds / findOrphanSubCanvases`，全部经 `platform/fs.ts`；文件形状 = Spec §2
  3. 复用形态：复用 `platform/fs.ts` 的 `readJson/stat/writeJsonIfUnchanged/listDir/remove`（**纯函数层，无 UI**）；乐观锁沿用 `writeJsonIfUnchanged` 的 size/lastModified 语义，冲突抛 `ConflictError`
  4. 验收断言：单测 8 例全绿——落点 `projects/<pid>/subcanvases/<scid>.json` 且无 `_dataRef`；外部改盘后写回抛冲突且磁盘保持外部内容；新建撞名不覆盖；列表新→旧 + 脏文件跳过并 warn；**孤儿只报告不删除**

- [x] **T4a 子页签层**（2026-11-06 完成；页签条已可用，挂点与内容渲染待 T4b）
  1. 目标文件：`canvas-tab-store.ts`、新 `sub-canvas-tab-bar.tsx`、`icons.ts`、`shared/view-prefs.ts`、新 `sub-canvas-tab.test.tsx`
  2. 修改点：store 新增 `subCanvasTabs` + `openSubCanvas/activateSubCanvas/closeSubCanvas/reorderSubCanvasTabs/restoreSubCanvasTabs`，`activateTab` 只接受已打开的 `subcanvas:<nodeId>`，`closeAllTabs` 一并清空；view-prefs 新增 `canvasTabs.openSubCanvasesByProject` + setter（顺带修 `setCanvasTabLastSlot` 不合并 slice 会清掉同片其它字段的坑）
  3. 复用形态：**逐行复用线上 `zeroexo_front/src/features/canvas-tabs/canvas-tab-bar.tsx` 资源页签部分**（bar 30 高 / gap 2 / padding '0 6px' / 横向可滚；tabStyle accent 底 `${accent}14` + 2px 下划线；关闭钮 16×16 `<X size={11}/>` aria-label=关闭页签；拖拽排序；`tabs.length===0` 整条不渲染），只换数据源；图标走 `icons.ts` Map（`PictureInPicture2`），不内联
  4. 验收断言：`sub-canvas-tab.test.tsx` 8 例全绿（幂等/回退相邻/关完回画布/不自动重开/写 view-prefs/脏条目过滤/视觉取值与线上同款）

- [x] **T2 生成链与代理节点**（2026-11-06 完成）
  1. 目标文件：新建 `create-sub-canvas.ts`（**唯一迁移执行器**）+ `subcanvas-types.ts`（尺寸/引脚/事件名单一来源）+ `subcanvas-extension.tsx` + `subcanvas-node-view.tsx`；注册点 `use-editor-state.ts` `ed.plugins.nodes.registerAll([...])`；连线规则 `connection-rules.ts` 加口径注释
  2. 修改点：`createSubCanvasFromSelection()` = 一条 `BatchCommand`（`ReplaceSceneCommand` 物理移除 + 加代理 + 跨界边重连）+ 紧随其后 `writeSubCanvas`；代理卡 = BaseNodeView 外壳 + 统计 + 「进入子画布」+ **文档缺失态显式禁用**（不静默显示 0 节点）
  3. 复用形态：扩展形态参照 `color-card-extension.tsx`（app 层注册，**不改 packages**）；`category:'_hidden'` 使子画布不出现在创建菜单（Q3 默认）；引脚双向 `sub-in`/`sub-out`
  4. 验收断言：`create-sub-canvas.test.ts` 9 例全绿——主 graph 只剩代理+外部节点且**零墓碑**、跨界边两端重连、**Ctrl+Z 一次完整还原**（节点/边/代理全回位、文档不删）、组选区自动展开后代、空选区/嵌套/无项目 id 拒绝、写盘失败可判别带 message、标题自增与显式命名优先
  > **偏离→已补做（2026-11-06 第二轮）**：外部桩卡已落地，但形态改为**渲染层覆盖物**而非注入图中的节点（见 §R-2）；子图**保持原坐标** + 进入时 fit 的修正已回写 Spec §4.1

- [x] **T3 入口（磁贴 + 多选聚合 + 右键）**（2026-11-06 完成）
  1. 目标文件：`use-editor-interactions.ts`（新增 `handleCreateSubCanvas`，`getGroupTools` 追加 `toSubCanvas`）、`node-capsule-toolbar.tsx`（多选聚合区新按钮 `data-capsule-action="subcanvas"`，与成组同排同尺寸）、`editor-page.tsx`（传入回调）、`icons.ts`（`EDITOR_ICONS.subCanvas`）
  2. 修改点：三处入口全调同一执行器；失败给逐条可读原因（空选区/嵌套/写入失败/无项目），成功=**生成即打开子页签** + 轻提示
  3. 复用形态：`ToolDefinition` 注册表机制→组磁贴与组右键自动共用同一份 `getGroupTools`（**未在右键里另写 handler**）；多选未成组场景靠聚合区按钮覆盖（多选单节点本身无专属右键，与现有交互一致）
  4. 验收断言：`sub-canvas-wiring.test.ts` 静态守卫全绿（执行器单一来源 / 宿主不自己拼 `ReplaceSceneCommand` / 三处入口均接到同一回调 / 图标走 icons Map）

- [x] **T4 子页签与工作区**（2026-11-06 T4a + T4b 均完成）
  1. 目标文件：新建 `SubCanvasWorkspace.tsx`（第二引擎实例）+ `SubCanvasLayer.tsx`（挂点层）；改 `editor-page.tsx`（渲染 `<SubCanvasLayer zIndex={TAB_CONTENT_Z}>`；子页签激活时**不再渲染剧本/导演台内容层**，避免两层重叠）
  2. 修改点：实例传 `enablePersistence/enableKeyboard/enableMinimap=false`；注册同一扩展集（含 subcanvas）；载入走 `replaceState`（不进撤销栈）+ `fitToContent`；保存=`subscribeGraph`→500ms debounce→乐观锁写；冲突=暂停自存 + **居中**确认框（重载外部版 / 保留本地并覆盖，后者走新增 `writeSubCanvasForce`）；打开集合按 `view-prefs` 恢复（卡已删静默丢弃）；统计**只在页签关闭/卸载时**回写一条 `UpdateNodeDataCommand`（避免每次自存污染主画布 undo 栈）
  3. 复用形态：页签条=逐行复用线上视觉（T4a）；interaction 直接复用宿主 `useCanvasHandlers(refs, containerRef)` 与 `useDropHandler`（只换 refs），三层 Defaults Provider 与主画布同源注入
  4. 验收断言：只渲染激活子画布（PT9 口径）；文档缺失/加载失败给显式覆盖层，不黑屏。**待用户实操**：PT1-PT9 全部运行时项（尤其 PT5 快捷键只生效一次、双实例 `nodeActionBus` 串扰）

- [x] **T5 周边闭环**（2026-11-06 完成；MCP 工具面未做，见备注）
  1. 目标文件：`export-types.ts`、`export-projects.ts`、`import-projects.ts`、`SubCanvasLayer.tsx`、`i18n/{zh,en,ja}.json`
  2. 修改点：导出新增 `subCanvases?` 字段（文档内嵌进 projects.json）+ `collectSubCanvasAssets`（子图素材走**同一个** `blobForStorageKey` 取用链，同路径不重复写入 zip）；导入第 6 步把文档写到**新项目 id** 下且**重映射内部 storageKey**（否则入口卡指向死 key），单个失败只跳过不回滚整个导入；i18n 三语各 40 键 + `nodes.subCanvasTitle`
  3. 复用形态：导出仍走现有 `collectProjectFiles`，只把取用链抽成共享函数（**不另造一套 blob 获取**）
  4. 验收断言（**实现口径与 Spec 不同，已回写 Spec §4.1**）：删代理卡不弹阻断确认，而是卡从 graph 消失（Delete 键/右键/Ctrl+Z 三路统一）时发一条带「删除文件 / 保留」动作的轻提示；选“保留”→ 走孤儿报告，撤销回卡时文档仍可用
  > **未做→已补做（2026-11-06 第二轮，见 §R-3）**：MCP 子画布工具面已落在 `mcp-server/`（list_subcanvases / get_subcanvas / patch_subcanvas_nodes）

## §R 第二轮补做（2026-11-06，用户“继续”指令后把上轮显式未做项收干）

- [x] **R-1 子画布内新建节点**
  1. 目标文件：新建 `src/features/canvas-nodes/new-node.ts`；改 `use-node-actions.ts`（`handleNodeCreateMenuSelect` 改为调用工厂）、`SubCanvasWorkspace.tsx`（工具条新增 Dropdown）
  2. 修改点：把“自增标题 + 默认 data”从主画布菜单的三元链里抽成单一来源；子画布只开生成素材四件（文本/图片/视频/语音），落点取视口中心 + 拖动式抖避免叠卡
  3. 复用形式：**不新建第二套创建菜单组件**（菜单项/默认数据全走同一函数）；顺手删掉 `use-node-actions.ts` 里因此变成未使用的 `COLOR_CARD_DEFAULT_COLORS` 导入（tsc noUnusedLocals 会接）
  4. 验收断言：接线守卫 `sub-canvas-wiring.test.ts` 断言两边都 import `new-node.js`、菜单里不再内联默认数据、子画布选项不含 script/storyboard/workbench
- [x] **R-2 外部桩卡（Spec §4.3）**
  1. 目标文件：`subcanvas-store.ts`（新增 `crossLinks?` + `SubCanvasCrossLink`）、`create-sub-canvas.ts`（一次推导两用）、新建 `subcanvas-stubs.ts`（纯派生）+ `SubCanvasExternalStubs.tsx`（覆盖层）+ `icons.ts`（模块图标 Map）；改 `SubCanvasWorkspace.tsx` / `SubCanvasLayer.tsx` / `editor-page.tsx`（定位回调）
  2. 修改点：子文档只存 **id 指针登记表**（edgeId / external / inner / direction）；`in` 列贴子图左外侧、`out` 贴右，同一外部节点同方向合并为一张卡多个锚；标题/类型每次从主 graph 现读；任一端已删则不画；双击/点按钮 → 回画布页签 + `focusOnNode`
  3. 复用形式：渲染在 `CanvasView` 的 children（覆盖层），**复制引擎同一套 `translate(vp.x,vp.y) scale(k)` 变换**，所以桩用世界坐标摆放；为什么不注入图：派生节点进了 graph 就可能被自存写回子文档（双权威），待在渲染层从根上不具备污染能力，也不进撤销栈
  4. 验收断言：`subcanvas-stubs.test.ts` 6 例（列位/下排间隔/锚点侧边/同节点多锚合并/失效不画/内容现读/空集不崩）+ 执行器补测 crossLinks 写入与方向 + 接线守卫禁止派生层写盘（`not.toMatch(/writeJson|writeSubCanvas|platform\/fs/)`）
- [x] **R-3 MCP 子画布工具面**
  1. 目标文件：新建 `mcp-server/src/store/subcanvases.ts` + `src/tools/subcanvases.ts` + `test/subcanvases.test.ts`；改 `src/config.ts`（paths.subcanvasesDir / subCanvas）、`src/index.ts`（注册）、`src/guides/module-specs.ts`（并入 project 模块的 mcpTools + caveats，不单占流水线索引）
  2. 修改点：三个工具 `list_subcanvases` / `get_subcanvas` / `patch_subcanvas_nodes`；权限位用现有 `project.read|project.write`（不发明新 bit，否则已签发 token 全部拿不到权限）；补丁只改既有节点的 data（浅合并）/title/position，**不开放结构性增删**；任一 nodeId 不存在 → 整体不写并回 missingNodeIds
  3. 复用形式：走 `store/fs-node.ts` 的 `updateUnversionedJson`（size+mtime 双因子，与前端 `writeJsonIfUnchanged` 同语义）⇒ UI 与 MCP 并发不会静默互盖；id 正则与前端 `idFromFileName` 一致（兼作路径穿越防线）
  4. 验收断言：`mcp-server` 全量 vitest = 9 文件 / 54 passed / **1 failed（`test/script-normalize.test.ts` 既有失败，本轮未碰 script-normalize 与 store/script）**；`npm run build` exit=0；`npm run selfcheck` 工具清单已列出三个新工具
- 本轮新增测试：前端 sub-canvas 目录 **39 例全绿**（+12）；mcp-server 新增 11 例；全量 `vitest run` = 118 文件 / 111 passed / 1 skipped / **6 failed（同一批存量）**；`npm run build` exit=0，产物含 `crossLinks`×7 / `subcanvases`×5 / `data-subcanvas-stub`×2

## §R2 模型改判与彻底整改（2026-11-06 第二轮，征集#184）

> 用户两次纠正后的定稿模型：**一个项目 = N 份平级画布（1 号主画布 locked 不可删）+ 1 剧本 + 1 主体库 + 1 出片**，
> 全部是同类“挂载物”（用户原话：相当于 C++ 多态，是项目 Node 的变体），并要求**先把数据结构摸清再动手**。
> 因本 Plan 是首个提案者，模型改判仍记在本 Plan 下（不另开 Plan）；T0-T5 的实现已全部删除。

- [x] **结构勘察（先调研后动手）**
  1. 目标：实测 `D:\Test` 磁盘与各路写者，不靠推测
  2. 结论：主画布在 `.lf/zeroexo/graph_data/zeroexo:graph:<pid>.json`（`{__lf:1,value:{version,savedAt,graph}}`，大 data 另分片）；
     剧本/主体库/出片在 `projects/<pid>/entities/*.json`（统一契约 + `ensureProjectMounts()` 幂等自愈）；
     首页清单在 `.lf/zeroexo/app_meta/projects.json`。**“N 份平级画布”无法同契约遍历 = 结构性问题根因**
  3. 拍板：Q1=**方案 B 虚拟 1 号**（`.lf` 不动，canvas-store 对 `id='main'` 走适配器）；Q2=目录 `projects/<pid>/canvases/`；
     Q3=“存为独立项目”**不物理复制素材**（用户：测试数据可弃）；Q4=1 号可改名换封面、不可删不可关；Q5=副本可再生副本
  4. 验收断言：全部写进 `project-rules/specs/sub-canvas/spec.md` 顶部设计段（含实测表格）
- [x] **契约层 `src/entities/canvas-store.ts`**
  1. 目标文件：新建 `src/entities/canvas-store.ts` + `canvas-store.test.ts`
  2. 修改点：与 slot-containers 同构的画布契约 + `ensureCanvasMounts` 幂等自愈 + 1 号适配器（loadProjectGraph/saveProjectGraph）
     + 副本裸 JSON（graphRef=inline）+ `version` 乐观并发 + `deleteCanvas` 对 1 号直接拒绝 + id 正则当路径穿越防线用
  3. 复用形式：全部 IO 走 `platform/fs.ts`（**不新建第二套写盘**）；目录约定与 `entities/slot-containers.ts:112` 同一风格（唯一拼路径处不导出）
  4. 验收断言：`canvas-store.test.ts` 8 例（1 号虚拟挂载不覆盖用户标题 / 图写 `.lf` 口且文件只留元数据 / 1 号不可删 / 裸 JSON 不分片 /
     外部改盘抛 ConflictError 且磁盘保持外部内容 / **新建撞名不静默覆盖** / 1 号恒在列表首位且脏文件跳过 / id 拒绝穿越）
  > **本轮唯一真缺陷就在这一条被单测拓出**：`writeJsonIfUnchanged(path, _, null)` 的 `null` 只代表“不做版本比对”，
  > **不代表“文件必须不存在”**（`src/platform/fs.ts:246-252`）→ `createCanvas` 原先会静默盖掉同名已有画布。
  > 现先 `stat` 再写，命中即抛 `ConflictError`；教训：**同一存储层的“幂等/新建”语义必须读实现确认，不能凭函数名推断**
- [x] **旧模型整体下线**（用户：“彻底整改”）
  1. 目标：删除 `subcanvas-store.ts` / `subcanvas-types.ts` / `subcanvas-extension.tsx` / `subcanvas-node-view.tsx` /
     `subcanvas-stubs.ts`(+test) / `SubCanvasExternalStubs.tsx` / `subcanvas-removal.ts` / `SubCanvasLayer.tsx` /
     `SubCanvasWorkspace.tsx` / `canvas-tabs/sub-canvas-tab-bar.tsx`(+test) / 上一轮写的 `SubCanvasGroup.tsx`（猜的 UI，不重写两遍）
  2. 修改点：`use-editor-state.ts` 不再注册 `subcanvas` 节点类型；connection-rules 旧口径注释作废；
     i18n 命名空间 `subCanvas.*` → `canvasCopy.*`（三语）；view-prefs `openSubCanvasesByProject` → `openCanvasesByProject`（**读时兼容旧键名**）
  3. 复用形式：第二引擎实例三开关、`new-node.ts` 默认形状单一来源、封面 `platform/cover.ts` 机制——**能用的机制留下，只换概语义层**
  4. 验收断言：`sub-canvas-wiring.test.ts` 16 例（含“旧文件必须不存在”、“生成链出现 ReplaceSceneCommand/RemoveNodeCommand 即红”、“旧命名不得残留”）
- [x] **生成链 / 顶层标签 / 工作区 / 抽屉**
  1. 目标文件：新建 `canvas-copy.ts`、`CanvasWorkspace.tsx`、`CanvasLayer.tsx`、`canvas-cover.ts`、`canvas-promote.ts`、
     `canvas-assets/groups/CanvasCopiesGroup.tsx`；改 `use-editor-interactions.ts`、`node-capsule-toolbar.tsx`、
     `canvas-tab-store.ts`、`canvas-tab-bar.tsx`(+css)、`tab-defs.ts`、`canvas-assets/store.ts`、`CanvasAssetsPanel.tsx`、`editor-page.tsx`
  2. 修改点：选区→**纯复制另存**（主画布不动、不进命令队列）；副本标签与 1 号**并排在顶层**（可拖拽、可 ×，关完回 1 号）；
     工作区按 cid 读写 + 冲突居中确认框；抽屉新分组「画布」直接用主页 `ProjectCard` + `CoverUploadModal`（打开/重命名/设封面/存为独立项目/删除，1 号不给后两项）
  3. 复用形式：入口仍只一个 `handleCreateCanvasCopy`（磁贴/多选聚合/组右键共用）；卡片与封面**不另造**（主页同一套组件）
  4. 验收断言：typecheck 47（= 基线）；全量 118 文件 / 112 passed / 1 skipped / **5 failed（全存量）**；前端 build exit=0；dev 新增模块逐个 200
- [x] **MCP 并入 canvas 域**
  1. 目标文件：新建 `mcp-server/src/store/canvases.ts` + `src/tools/canvases.ts` + `test/canvases.test.ts`；
     改 `src/config.ts`（canvasesDir/canvas/**mainGraphFile**）、`src/index.ts`、`src/guides/module-specs.ts`；删除 subcanvases 三件旧文件
  2. 修改点：`list_canvases` / `get_canvas`（**1 号也可读**，直读 `.lf` 主 graph 信封）/ `patch_canvas_nodes`（**1 号一律拒绝**，只允节点级补丁）
  3. 复用形式：写回走 `updateUnversionedJson` 双因子（与前端乐观锁同语义）；权限位继续用 `project.read|write`（不发明新 bit）
  4. 验收断言：`mcp-server` 9 文件 / 54 passed / 1 failed（`test/script-normalize.test.ts` 既有失败，本轮未碰）；`tsc` exit=0；新增 11 例全绿
- [x] **抽屉分组收敛 + MCP 配置页去重**（2026-11-06 用户指令）
  1. 目标文件：`canvas-assets/tab-defs.ts`、`canvas-assets/CanvasAssetsPanel.tsx`、`canvas-assets/store.ts`、
     新建 `canvas-assets/groups/HierarchyGroup.tsx`、`hierarchy/components/hierarchy-panel.tsx`、
     `mcp-settings/{mcp-settings-dialog.tsx, local-service-panel.tsx}`
  2. 修改点：抽屉 sidebar 顺序改为 **资产 → 历史 → 层级 → 画布**；层级/画布只在画布模块（顶部页签=画布/副本）挂载，
     每个模块各自记忆激活分组，切走即卸掉画布专属分组（避免在剧本/导演台误选画布层级与子画布）；
     层级树数据 hook 从抽屉壳层下放到分组组件（只有该分组激活才订阅整张图）。
     MCP 配置页把「首屏配置块 + 本地数据面板里的第二份配置块」合并为**一份**，数据目录与绝对路径合并为一个区块。
  3. 复用形式：分组清单与模块挂载规则单一来源 = `tab-defs.ts`（`DRAWER_TAB_DEFS` / `DRAWER_MODULE_GROUPS` /
     `resolveDrawerModule`，只做 key 前缀判定、不 import 页签 store）；MCP 配置仍只有 `buildStdioConfig` 一个生成口。
  4. 验收断言：新增 `canvas-assets/drawer-tabs.test.ts`（顺序 / 模块映射 / 挂载接线静态守卫）；
     `history-group`、`sub-canvas-wiring`、`mcp-settings-dialog`、`top-bar.mcp`、`hooks-order`、`store-guard`、
     `material-scope` 全绿；`pnpm typecheck` 0 错。

- [x] **多选右键入口补齐**（2026-11-06 用户验收发现「选中节点右键没有『保存为画布副本』」）
  1. 问题定位：右键菜单只有**组节点**分支会调 `getGroupTools`（组工具里含 `toCanvasCopy`）；
     非组分支（单选/多选）从未接过这个入口 —— 用户框选节点后右键只看到通用节点操作，
     属于「规格写了、代码漏接线」。
  2. 修改点：`useNodeActionHooks` 新增 `onCreateCanvasCopy` 形参（宿主传唯一执行器，
     少传直接编译报错）；非组节点右键追加「保存为画布副本」，取真实选区（点击节点不在选区内时只取它自己）；
     组右键的 `getSelectedNodeIds` 改为真实选区 → 多选含组时复制整段，而不是只复制组壳。
  3. 验收断言：`sub-canvas-wiring.test.ts` 新增「右键入口」用例（17 例全绿）；
     胶囊磁贴 / 多选聚合 / 右键三处仍共用同一个 `handleCreateCanvasCopy`。

- [x] **画布下方工具栏「+」菜单多出一条横线**（2026-11-06 用户反馈）
  1. 根因：创作类节点（剧本/分镜/出片）新建入口下线时只删了菜单项，两个 `divider` 留在一起，
     渲染成上下两条线中间空段。
  2. 修改点：`left-side-toolbar.tsx` 的 `addNodeItems` 合并为一个分隔线；同步更正注释。

- [x] **画布页签位置 + 单实例纠偏**（2026-11-06 用户纠偏：页签要挂在画布区顶部那一行、打开副本要和主画布完全一样、不要另写一套画布）
  1. 问题定位：副本页签被塞进顶层固定槽位页签条；打开副本时另起 `CanvasWorkspace` **第二个引擎实例**
     （自带迷你工具栏/新建菜单/自有空态），同一份「画布」出现两套界面 —— 方向错误。
  2. 修改点：副本页签移到**画布区顶部第二层页签条**（`canvas-document-tabs.tsx`：主画布固定第一个不可关、
     副本可 ×、可拖拽排序，仅存在副本时渲染）；副本改为**同一编辑器切换文档**
     （`use-canvas-document-switch.ts`）：先落盘当前文档 → `commandQueue.replaceState(目标图)` → 恢复该文档视口；
     副本期间 `PersistencePlugin.pause()` 暂停主画布自动保存，回主画布 `resume()`；
     副本仍走 `canvas-store` 500ms 防抖 + size/mtime 乐观锁 + 冲突居中确认框。
  3. 删除：`CanvasLayer.tsx` / `CanvasWorkspace.tsx`（第二个引擎实例与自有画布 UI）；
     `canvas-tab-bar.tsx` 不再渲染副本；`PersistencePlugin` 新增 `pause()/resume()`
     （暂停不写盘、恢复不触发写盘，避免把副本书写进主画布键）。
  4. 验收断言：`sub-canvas-wiring.test.ts` 改写为「第二层页签 + 主画布固定 + 单实例切换」守卫；
     画布页签/画布副本相关 15 个测试文件 217 例全绿；typecheck / build 通过。

## 替代方案

无（首个方案）。已否决：子图内嵌 `node.data.graph`（`largeDataThreshold=2048` 会分片进 `.lf/`，MCP 不可读，违反 Plan#83 D1）——依据见 Spec §2。

## 测试四件套（自动化优先）

- **测试方案**：`pnpm typecheck` 零新增错误 + `npx vitest run src/features/sub-canvas src/features/canvas-tabs` + 结构断言（入口唯一执行器、无第二份迁移逻辑）+ 磁盘断言脚本（用 `platform/fs.ts` 读回 JSON 校验形状）
- **测试计划**：PT1-PT9（Spec §8），环境=已授权本地数据目录的浏览器实例；数据准备=一个含 ≥6 节点与 ≥2 条跨界边的测试项目
- **测试报告**：用例 × 结果 × 缺陷表随本文件追加；vitest 输出留存 `sub-canvas-references/`
- **测试风险**：S1 双实例的 window 级快捷键/事件总线串扰（缓解=子实例不装 keyboard 插件，快捷键由宿主按激活页签分发）；S2 外部并发写冲突（缓解=乐观锁 + 显式重载选择，禁止静默覆盖）；PT9 性能若超标（缓解=非激活实例卸载而非 `display:none`）

## 检查单

### 前置
- [x] 二次复审：设计（单一权威=磁盘子文档 / 入口单源 / 命令化迁移）+ 影响面 + 风险已写入 Spec；基线提交因无 git 仓库跳过（已报备）
- [x] 并行门：用户 2026-11-05 拍板开工（与 #83 影响文件有交集，已按用户指令串行推进；T1/T4a 均为新增文件 + 页签 store 扩展，未动 #83 本轮热修面）

### 执行
- [x] T0-T5 全部完成（仅 MCP 工具面与外部桩卡列入 Phase 2，已在对应子任务里显式记录）

### 验证（测试四件套必填）
- [x] 测试方案已定义 / 测试计划已列出（PT1-PT9）/ 测试报告已产出（单测 27 例 + typecheck 47=基线）/ 测试风险已评估
- [ ] 功能验证通过（PT1-PT9）——需用户在已授权目录的浏览器里实操
- [ ] 回归检查：无性能损失 / 新 BUG / 时序副作用（同上，待实操）
- [x] 消费端契约检查：子文档字段（schemaVersion/id/title/parentProjectId/proxyNodeId/createdAt/updatedAt/graph）↔ UI 消费字段逐一对齐，写入侧钉版本，读取侧只接受 ≤当前版本
- [x] 既有 UI 设计缺陷审计：代理节点 `category:'_hidden'` 不进创建菜单；层级面板/搜索仍按节点列出（代理卡算一个节点，属预期：它就是主画布上的一个实体）

### 交付
- [ ] diff + 前后对比 / 代码质量审核 + 漏洞分析 + 复盘 / 经验已提炼 / 验收通过后按影响文件清单提交（commit message 英文）
