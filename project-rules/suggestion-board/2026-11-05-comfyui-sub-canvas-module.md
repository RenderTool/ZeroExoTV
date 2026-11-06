---
状态: merged
创建: 2026-11-05
来源: 用户需求
关联项目: zeroexo-comfyui（本地版，Plan#83）
归属建议: 独立新 Plan（建议 Plan#84；Spec 已先行落地，待拍板后开工）
---

# 子画布（Sub-Canvas）：框选节点抽出为可关闭子页签画布

## 一、需求 / 问题描述（用户原话）

> 新追加一个模块叫**子画布**，子画布的用途是在主画布中框选一些节点，弹出胶囊菜单中可以点击「生成子画布」并保持；右键也可以（如图两个箭头处）插入该按钮和功能。然后打开子画布要和线上版本 `zeroexo-platform` 的标签一样**挂载在主画布下**，然后用户可以自己点击关闭标签关闭子画布。这个可以先建一个 SPEC 再做。

配图取证（2026-11-05 19:07）：
- 箭头 1 = 组（"成组"）胶囊磁贴最右侧图标位（现有 5 枚：聚焦/网格/对齐/重命名/外观）→ 追加「生成子画布」；
- 箭头 2 = 节点右键菜单「发送到主体」与「下载节点」之间 → 追加同名项。

## 二、背景与现状

| 面 | 现状（实锤文件） | 缺口 |
|---|---|---|
| 页签模型 | 本地版 `src/features/canvas-tabs/canvas-tab-store.ts` = **固定四槽位**（剧本/主体库/导演台/画布），`tabs` 恒空、`closeTab` 退化为"切回画布"、无 × 入口 | 需要"可开可关的子页签"，本地版当前模型刻意删掉了这条链路 |
| 线上参照 | `zeroexo-platform/zeroexo_front/src/features/canvas-tabs/canvas-tab-store.ts`（`buildTabKey=kind:id` 幂等 + `closeTab` 回退相邻/画布）与 `canvas-tab-bar.tsx`（`<X size={11}/>` 关闭按钮，`tabs.length===0` 时整条不渲染） | 只借**交互契约**，不搬视觉（本地版已改胶囊分段） |
| 组与多选 | 组 = `type:'group'` + `childrenIds`；胶囊磁贴 `src/features/tools-dock/node-capsule-toolbar.tsx`（单选组走 `getGroupTools`，多选走聚合按钮组）；`getGroupTools` 定义在 `src/pages/editor/editor-canvas/use-editor-interactions.ts:307`；右键菜单 `use-editor-interactions/use-node-actions.ts:254` **复用同一份 getGroupTools** | 只要往 `getGroupTools` 加工具，磁贴 + 右键两处同时生效（单一定义源，符合"禁止各写一套"铁律） |
| 节点类型扩展 | app 层可注册：`use-editor-state.ts:235` `ed.plugins.nodes.registerAll([...createCreationExtensions(), createColorCardExtension()])` | 新代理节点类型 `subcanvas` 可在 app 层注册，不动 packages |
| 持久化 | 主 graph = `graph:<projectId>` → 磁盘 `projects/<pid>/project.json`（`platform/fs.ts pathForStorageKey`）；大字段由 PersistencePlugin `_dataRef` 分片 | 子画布数据落点需决策（内嵌 vs 独立文件），见 Spec D2 |

## 三、归属分析

- **类型**：功能强化（新模块）+ 交互决策（页签形态）
- **疑似关联 Plan**：Plan#83（同项目同链路，但 83 的 Phase 表内无此项）→ 建议**独立 Plan#84**，避免 83 验收面继续膨胀
- **倾向性结论**：先出 Spec（已交付 `zeroexo-comfyui/project-rules/specs/sub-canvas/spec.md`），Phase 0 三个 spike 不通则改退路；拍板后按 Spec 的 Phase 1-4 施工

## 四、影响面预估

- 新建：`src/features/sub-canvas/`（代理节点扩展 + 视图 + 执行器 + 子工作区）
- 改动：`canvas-tab-store.ts`（子页签状态 + key 校验）、`canvas-tab-bar.tsx` 或新 `sub-canvas-tab-bar.tsx`、`use-editor-interactions.ts`（getGroupTools 追加）、`use-node-actions.ts`（右键插入位）、`use-editor-state.ts`（registerAll 追加类型）、`view-prefs.ts`（打开集合按项目持久化）、`shared/components/node-create-menu.tsx`（是否暴露手工创建 → Spec Q3 待拍板）、`connection-rules.ts`（代理节点 pin 规则）
- 风险：第二个引擎实例的快捷键/window 级绑定重复、PersistencePlugin `_dataRef` 分片导致子画布数据在磁盘上不可读、跨界边重连影响「一键同款」溯源链

## 五、处理结果（2026-11-05）

- 归属：独立立项 → [Plan#84](../shared/plans/2026-11-05-sub-canvas.md)（⚪ draft，未开工）
- 结果摘要：按用户拍板**先交 SPEC 再做**：`zeroexo-comfyui/project-rules/specs/sub-canvas/spec.md` 已落地，含：
  - **D2 数据落点实锤**：否决“子图内嵌 `node.data.graph`”——`persistence-localforage/src/index.ts:117` 的 `largeDataThreshold` 默认 **2048 字节**，超限即拆成 `{_dataRef}` 分片进 `.lf/`，MCP 不可读（违反 Plan#83 D1）→ 定为 `projects/<pid>/subcanvases/<scid>.json` 裸 JSON，代理节点只存指针+摘要；
  - **入口两处单一定义源**：`getGroupTools`（`use-editor-interactions.ts:307`）追加一项即可同时生效于胶囊磁贴与组右键（`use-node-actions.ts:254` 已复用）；多选磁贴聚合区另加同执行器按钮；
  - **子页签交互契约**对齐线上 `canvas-tab-store/canvas-tab-bar`（幂等 `kind:id`、关闭回退相邻→无剩余回画布、无打开项时整条不渲染），视觉没有照抄（沿用本地胶囊分段）；
  - Phase 0 = 3 个 spike（双引擎实例 / fs 乐观锁 / 跨界边重连），不通各有退路；PT1-PT9 验收断言；Q1-Q3 待拍板。
- 并行门：用户 2026-11-05 拍板开工 → Plan#84 转 🔵 in-progress（与 #83 影响文件有交集，已按用户指令串行推进）。
- 2026-11-06 追加（用户纠正 + 开工进度）：
  - **视觉决策修正**：“只借契约不抄视觉”被用户否决——线上 `zeroexo-platform` 是用户自有项目，页签视觉**直接复用** `zeroexo_front/src/features/canvas-tabs/canvas-tab-bar.tsx`（bar 30 高 / tabStyle accent 底 `${accent}14` + 2px 下划线 / 关闭钮 16×16 `<X size={11}/> / 拖拽排序 / 空集不渲染），Spec §5 已重写为取值表。新挂 Q4：线上激活色 = `theme.toolbar.accent`（本地为品牌红），与本轮“状态色不用红”口径冲突，待拍板。
  - **已落地（2026-11-06 补全）**：T0（S1 静态结论：`createDefaultEditor` 的 `enablePersistence/enableKeyboard/enableMinimap` 三开关足够隔离子实例；`nodeActionBus` 单例为残留风险）、T1（`subcanvas-store.ts` + 8 例单测：乐观锁抛 `ConflictError`、孤儿只报告不删）、T4a（`subCanvasTabs` store + `sub-canvas-tab-bar.tsx` + `view-prefs.canvasTabs.openSubCanvasesByProject`，8 例单测全绿；顺带修 `setCanvasTabLastSlot` 不合并 slice 会清同片其它字段的坑）、**T2**（`create-sub-canvas.ts` 唯一迁移执行器 + `subcanvas-types.ts` 单一来源 + app 层注册 `subcanvas` 代理节点（`category:'_hidden'`）+ 9 例单测：物理移除零墓碑、跨界边重连、**Ctrl+Z 一次完整还原**、组选区自动展开后代、拒绝矩阵、写盘失败可判别、标题自增）、**T3**（组磁贴 + 组右键共用 `getGroupTools.toSubCanvas`，多选聚合区新增 `data-capsule-action="subcanvas"` 按钮，三处入口全调同一执行器；`sub-canvas-wiring.test.ts` 静态守卫接住分叉）、**T4b**（`SubCanvasWorkspace.tsx` 第二引擎实例 + 500ms debounce 乐观锁自存 + 冲突居中确认框（重载/覆盖）+ `SubCanvasLayer.tsx` 挂点（事件打开 / prefs 恢复 / 统计回写只一条命令 / 卡消失后带动作轻提示），editor-page 内子页签激活时不再叠渲染剧本/导演台内容层）、**T5**（导出 projects.json 新增 `subCanvases?` + 子图素材走同一 `blobForStorageKey`；导入写到新项目 id 且重映射内部 storageKey；i18n 三语各 40 键）。
  - **本轮未做 → 已全部补做（2026-11-06 第二轮，用户“继续”指令）**：
    - **R-1 子画布内新建节点**：工具条新增“新建”（文本/图片/视频/语音）；`src/features/canvas-nodes/new-node.ts` 把“自增标题 + 默认 data”从主画布菜单三元链里抽成**单一来源**，两边同一节点形状；仍不开剧创单例槽位与第二套胶囊工具栏。
    - **R-2 外部桩卡**：子文档只新增 `crossLinks[]`（**只存 id 指针**）；`subcanvas-stubs.ts` 纯函数派生（in 列左外侧 / out 列右外侧、同节点合并多锚、任一端已删则不画、标题从主 graph 现读），`SubCanvasExternalStubs.tsx` 作为 `CanvasView` children 渲染并**复制引擎同一套视口变换**；双击/点按钮→回画布页签并 focus。形态修正缘由：派生节点一旦进了 graph 就可能被自存写回子文档（双权威），待在渲染层从根上不具备污染能力。
    - **R-3 MCP 工具面**：`mcp-server` 新增 `list_subcanvases` / `get_subcanvas` / `patch_subcanvas_nodes`（+ `store/subcanvases.ts`、`config.ts` 路径、`index.ts` 注册、guides 并入 project 模块）；权限位复用现有 `project.read|project.write`（不发明新 bit，否则已签发 token 全拿不到权限）；写回走 `updateUnversionedJson` 的 size+mtime 双因子（与前端乐观锁同语义）；id 正则兼作路径穿越防线；**不开放结构性增删**。
  - **第二轮验证**：前端 `src/features/sub-canvas` **39 例全绿**（新增桩派生 6 例 + 接线守卫 5 例 + 执行器补测）；`mcp-server` 全量 9 文件 / 54 passed / 1 failed（`test/script-normalize.test.ts` 既有失败，本轮未碰该链路）；前端全量 118 文件 / 111 passed / 6 个存量红；两边 build 均 exit=0（产物含 `crossLinks`×7 / `data-subcanvas-stub`×2；`npm run selfcheck` 已列出三个新工具）。
  - **遗留（Phase 2）**：子画布内新增/删除连线不会回写 `crossLinks`（只在生成时登记）；主画布删代理边后登记项残留（不显示不报错，需“保存时按主 graph 清理失效登记”）。
  - **验收状态**：`pnpm typecheck` = 47（= 基线，零新增）；全量 `vitest run` = 116 文件 / 109 passed / 1 skipped / **6 failed（同一批存量，与本改无关）**；新增 27 例子画布单测全绿；`npm run build` exit=0，产物已含 `subcanvases`/`subcanvas:`/`toSubCanvas` 标记。**PT1-PT9 需用户在已授权目录的浏览器里实操**（尤其双实例快捷键串扰）。
  - **Q4 已定**：子页签激活色**保留线上同款 accent**（身份色≠状态反馈色；用户明确要求直接复用线上视觉）。“状态色不用红”针对的输入框聚焦与片段选中已改中性。
  - **环境隐患（证据已升级，需用户处置）**：`subject-library-pages.tsx` / `subject-tree-types.ts` 在验证期间被**外部进程反复回写不同版本**，不是 IDE 缓存那么简单：
    1. 两次 typecheck 间错误整族变化：先是 2 个 TS6133（`findItemForTree`/`treeOfCard` 未使用），几分钟后变成 4 个 TS2345（`ProductionItem[]` 不能当 `readonly SubjectCardData[]`）——而磁盘上当前的 `findTreeForItem` 签名是结构化 `{id,name}[]`，根本不会报这个错 ⇒ tsc 读到的是**另一个版本**；
    2. 一次导致 10 例单测 `ReferenceError: ChevronLeft is not defined`（该标识符磁盘上不存在），几分钟后自行恢复 30/30 绿；
    3. 文件 mtime 与本次会话时钟对不上（我这边 `Get-Date` = 05:3x，两文件 mtime = 13:27:47 / 13:32:12，且两者相隔 5 分钟→不同代次）。
    结论：**主体库那对文件当前处于“版本不一致”状态**，本轮没碰它们也不敢改（改下去可能覆盖并行会话/同步工具的在飞工作）；需用户确认是否有并行 Agent 会话或目录同步在写这个仓，否则 typecheck 基线数字与主体库验收都不可靠。
