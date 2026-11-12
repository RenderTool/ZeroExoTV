---
编号: S-23
状态: merged
创建: 2026-11-12
来源: 用户需求
归属: 独立热修（口径已同步 specs/subject-pages、specs/subject-library-redesign）
---

# 取消状态详情页：所有编辑都在主体状态页的状态卡上完成

## 一、需求 / 问题描述（用户原话）

> 我认为没有必要再进入这个页面了！直接在外面编辑状态名、设封面、修改图片、然后加一个画布生成按钮，会默认发送到画布（不发起API，但把提示词挂载进去！）而不是顶部一个全局的发送到画布按钮！！ 你认为呢？现在太多层级了

后续同日追加（按时间顺序）：

> 我仍然觉得这个编辑页面还是变成原来的页面吧，现在二合一抽屉中抽屉很奇怪！然后我强调过很多次，这种属于开发者提示，客户根本不该看到这种话。但是要优化排版。

> 我坚持觉得直接在这个页面改状态名和相关封面内容就行了！然后提示词可以在卡片内编辑模式下变成编辑文本块！

> 出现集数变成按钮，点击后展开一个下拉列表编辑！！

> 也就是说我希望直接在这个页面的选项卡通过按钮完成之前要全新页面的编辑！！

另有一条「开源库移除」被用户撤回（「开源库先别」），**不在本条范围内，未执行**。

当日 18:11 追加（看抽屉截图后）：

> 你自己看看这个抽屉页面！不要出现这么多选择的集数标签！！另外我觉得还不如之前的面包屑导航版本

处置：留在本页编辑（不进第三层），**编辑卡拉通整行**（左媒体 / 右字段）——视觉回到面包屑版本的舒展度；
面包屑砍掉第三级；出现集数只留摘要按钮，标签全部删除。

最终拆成 6 条：① 永不再进入第三个整页；② 状态名 / 封面 / 换图在卡片上完成；③ 每状态一枚「画布生成」，只挂提示词、不发起 API、不要主体级全局按钮；④ 提示词在卡片内编辑模式变成文本块；⑤ 出现集数变成一个按钮，点击展开下拉列表编辑；⑥ 界面禁止开发者口吻文案（「不自动跑 API」「未选 = 全部剧集」「AI 会结合基础形态自动完善」等）。

## 二、背景与现状（改造前，2026-11-12 早间实锤）

`src/features/canvas-nodes/storyboard/subject-library-pages.tsx`

| 诉求 | 改造前 |
|---|---|
| ① 不进详情页 | **未完成**：整卡点击 / `data-state-action="edit"` → `applyLevel({view:'state'})`；状态编辑页分支是第三个整页 |
| ② 状态名 / 封面 / 换图在卡片 | 已落地（当日更早的热修）：双击改名、Star 设封面、ImagePlus 换图 |
| ③ 每状态画布生成、不跑 API | 已落地：`canvas-generate` → emit `subject:sendStateToCanvas` → `editor-page.tsx` 建 320×320 节点，`data.prompt` + `status:'idle'`，全链路无 fetch；主体级全局按钮已移除，只剩死接收端 |
| ④⑤⑥ | 未完成：提示词 / 出现集数只在第三层整页里，且 UI 有多处开发者口吻文案 |

**关键约束**：不能直接删页。画布生成取 `node.fullPrompt || node.deltaPrompt || ''`，删页后提示词若无新落点就会挂空字符串；`setCurrentSubjectStateContext` 由「停在状态页」登记，删页后资产发送直达会退化成选择弹层。

## 三、归属分析与方案演进

- **类型**：交互决策（层级收敛）+ 文案治理 + 遗留清理
- **关联 Plan**：无，独立热修；数据层（`SubjectTreeNode` 字段、entities 落盘）完全不动
- **形态演进**（同日三次改版，前两版均已作废）：

| 版本 | 形态 | 结论 |
|---|---|---|
| v1 | 两级整页 + 同页右栏 `StateInspector` 检查器 | **作废**：在窄抽屉里挤成一列，用户判定「很奇怪」 |
| v2 | 恢复独立状态编辑整页 + 排版优化 | **作废**：用户坚持不要新页面 |
| **v3（最终）** | **两级整页 + 卡片内编辑面板 `StateEditPanel`** | 采纳：所有编辑都在状态卡的按钮 / 卡内展开区完成 |

- **最终关键决策**：`view:'state'` **保留**，语义重定义为「哪张卡展开了编辑面板」，不再对应任何新页面。理由：层级记忆、pushState/popstate、刷新恢复、`navigateToView('subject', {stateId})` 定位、`setCurrentSubjectStateContext` 资产发送直达全依赖它；保留状态机可零风险收敛 UI，避免 20+ 处既有断言与发送链路重写。`data-subject-page="state"` 保留在编辑面板根节点作为口径标记，面包屑第三级仅表示「当前正在编辑的状态」。

## 四、影响面

`subject-library-pages.tsx`（删第三层整页分支 / 新增 `StateEditPanel` / `StateGridCard` 加 `editMode` + `editPanel` + `onToggleEdit`）、`subject-page-nav.ts` 与 `subject-send.ts`（注释口径）、`editor-page.tsx`（清死接收端 + toast 文案）、`StoryboardSubjectTree.tsx`（旧树 tooltip / placeholder 文案）、三语 i18n、`subject-library-pages.test.tsx`、两份 spec 顶部说明。
`embedded` 抽屉主体分段复用同一组件、层级纯内存，改动会同时影响抽屉与整页。

## 五、处理结果（2026-11-12 最终热修）

- **两级整页**：`list` / `subject`。第三层整页分支整体删除；点状态卡或「编辑」按钮只切换该卡的编辑态，网格、页头、主体名输入全部留在原地；点另一张卡一次点击即换编辑对象，再点一次收起。
- **卡片快捷操作**（保留既有热修）：双击改状态名、Star 设封面、ImagePlus 换图、Trash2 删除、Wand2 画布生成（只 emit `subject:sendStateToCanvas` 挂 prompt + referenceStorageKey，不发起 API）。编辑态卡片有 accent 描边。
- **卡内编辑面板**：`StateEditPanel` 挂在被编辑卡片内部（不是独立页、不是右栏抽屉），**卡片拉通整行**（`grid-column: 1 / -1`），编辑态隐藏 16:9 封面大图。包含状态名输入（基础状态只读）、**提示词文本块**（`DraftPromptField`，失焦写回 `fullPrompt`/`deltaPrompt`，行数收敛到 5–14）、**出现集数一枚摘要按钮 + 弹层**（「全部剧集」/「第 1–12 集」/「已选 N 集」，单集增删在弹层里；**已选集不再铺标签**）、媒体小预览 + 换图 / 删媒体 + 历史图恢复 / 永久删除。原有详情页能力一项不丢。
- **面包屑两级**：只到「主体库 / 主体名」；编辑态不再追加第三级状态名（基础状态名 = 主体名，会连出三个同名）；返回按钮在编辑态先收面板。
- **文案治理**：删除 `画布生成（只挂提示词，不自动跑 API）`、`基础状态即主体本身`、`勾选该状态出现的集数；未选 = 全部剧集`、`AI 会结合基础形态自动完善…`；成功 toast 改「已添加到画布」；三语 i18n 同步，删 `canvasGenerateHint` / `closeInspector`，加 `closeEdit`。实现说明只留代码注释，不进 UI。
- **排版**：编辑面板紧凑多层（12px 内距 / 16px 间距 / 132px 媒体预览 / 46px 历史缩略），提示词框由 8–18 行、200px 收敛到 5–14 行、140px；面板根节点拦截 click / keydown 冒泡，避免打字时误触发卡片切换。
- **清死代码**：`editor-page.tsx` 移除 `subject:sendToCanvas` 接收端与 `STACKED_MEDIA_DEFAULT_SIZE` import；`subject-library-pages.tsx` 移除未用的 `buildSubjectStackNodeData` / `Layers` import 与旧两列表单样式常量。
- **测试**：新增 3 例（卡内编辑面板不跳页且挂在卡片内 / 出现集数按钮展开下拉并勾选 / 画布生成只挂提示词不跑 API）；保留既有 20+ 处状态页断言（靠 data 属性兼容）。
- **验证**：`vitest run src/features/canvas-nodes/storyboard` = **274 passed / 1 skipped**；`tsc --noEmit` = **0 错误**。
