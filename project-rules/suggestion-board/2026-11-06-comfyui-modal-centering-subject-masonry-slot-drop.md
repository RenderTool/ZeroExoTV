---
状态: merged
创建: 2026-11-05
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 / Plan#84）
归属建议: 独立处理（四项均为热修，不建 Plan；④ 归 Plan#84 前置能力）
---

# 弹层居中 + 主体选中/弹性排列对齐资产 + 状态页冗余提示与添加按钮 + 插槽拖入正文

## 一、需求 / 问题描述（用户原话）

> 2 附加一个额外任务 剧本的版本快照上传提示要屏幕内居中！我们项目所有提示弹出都是屏幕内居中的别搞错了
> 3 主体在抽屉中要和资产一样的选中样式以及弹性排列规则，包括水平个数绘制规则
> 4 悬停状态卡可编辑或删除这种提示词标签删除，添加状态按钮也要做成和资产上传素材同款，另外现在主体没法改类型？？改类型会错误的跳转具体主体状态页
> 5 导演台的插槽拖拽到提示词输入区要自动填入 @内容

## 二、背景与现状（逐条实锤）

| # | 根因 |
|---|---|
| 2 | antd `Modal` 与 `modal.confirm` 默认贴在视口上方（top≈100px），必须显式 `centered`。全仓审计：缺 centered 的确认框 = `script-snapshot-panel.tsx`(2) / `script-editor-sheet.tsx`(2) / `local-service-panel.tsx`(1)；缺 centered 的 antd `<Modal>` = `workflow-config-dialog.tsx` / `workbench-tab-content.tsx`(2，运行预检 + 工作流查看)。自研 `shared/components/modal.tsx` 本身 `placeItems:'center'`，不参与检查 |
| 3 | 主体列表自写 CSS 网格 `repeat(auto-fill, minmax(240px,1fr))`，而资产走共享 `MasonryGrid`（`masonryColumnsForWidth` 实测宽度取断点 360/560/768/960/1280/1440/1920）→ 水平个数规则不同源；主体卡还给 `CardShell` 传 `hovered={active}`（hover 亮 accent 环），资产卡不传 → 选中/hover 样式也不同源。抽屉内页边距亦不一致（主体 16 vs 素材 20） |
| 4a | 状态页页头 `hint={t('subject.stateGridHint','悬停状态卡可编辑或删除')}` 属冗余教学文案（违反既有约定「UI 尊重用户心智，不加冗余提示」）；同一页还有**两个**添加状态入口（页头红色 `type="primary"` 主按钮 + 格内 `AddStateCard`，后者 hover 还亮强调色虚线框） |
| 4b | 「改类型」点了没效果还跳进状态页：antd `Dropdown` 菜单虽渲染在 portal，**React 事件沿组件树冒泡**到卡片 `onClick` → 先执行 `onOpen()` 导航；卡片守卫只判 `closest('button')`，菜单项 `<li>` 不在 button 子树内 → 守卫失效。资产卡 `moreMenuItems` 早已用 `e.domEvent.stopPropagation()` 约定，主体卡漏了 |
| 5 | `MentionEditor` 只处理 paste/beforeinput，没有任何 drag/drop 分支；插槽格 `renderSlotCells` 也没有 `draggable` → 拖插槽进正文无任何反应（只能点插槽打开资产面板） |

## 三、归属分析

- **类型**：bug 遗漏（2 全局 focus 之外的居中漏项、4b 事件冒泡）+ 交互决策（3 排列同源、4a 入口收敛）+ 功能强化（5 拖入正文）
- **关联 Plan**：2/3/4 → Plan#83 验收修复轮（同 #173/#174/#176 先例）；5 → 与 Plan#84 同属导演台正文链路，作为前置能力直接热修
- **倾向性结论**：全部直接热修，不新建 Plan；② 额外把「居中」固化成**全仓扫描守卫测试**（`modal-centering.test.ts`），避免以后新增弹层再漏

## 四、影响面预估

`src/app.css`（上一轮已改 focus）、`script-snapshot-panel.tsx`、`script-editor-sheet.tsx`、`local-service-panel.tsx`、`workflow-config-dialog.tsx`、`workbench-tab-content.tsx`、`subject-library-pages.tsx`、`subject-media-preview.tsx`、`canvas-assets/components/common.tsx`、`mention-editor.tsx`、`director-prompt-panel.tsx` + 测试 `modal-centering.test.ts`（新）/ `mention-editor.test.tsx` / `subject-library-pages.test.tsx`

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **② 居中**：6 处 `modal.confirm` 补 `centered: true`、3 处 antd `<Modal>` 补 `centered`；新增 `src/shared/components/modal-centering.test.ts` —— 用**深度感知的扫描器**（跟踪 `{}()[]` 与字符串，避开 `=>` 里的 `>` 截断）全仓检查「antd `<Modal>` 必须 centered / `modal.confirm` 必须 `centered: true`」，并带一条"扫描器确实命中 20+ 个 Modal"的防空跑断言。
  - **③ 主体列表同源**：列表容器改共享 `MasonryGrid`（列数 = `masonryColumnsForWidth` 实测断点，与素材抽屉同一函数）；卡片封面高度改 `cardCoverMetrics(columnWidth, aspect)`（未知比例 1:1 占位 → `SubjectMediaThumb` 新增 `onLoaded` 回传 naturalWidth/Height，只过渡一次，与 asset-card 的 learnAspect 同构）；去掉 `CardShell hovered={active}` → hover 不再亮 accent 环，与资产卡一致（只上遮罩 + 浮出动作）；`PAGE_PAD_EMBEDDED` 16 → 20，与素材分段同一 inset。
  - **④a**：删 `stateGridHint` 冗余提示；页头红色主按钮 + 格内 `AddStateCard` **两个入口一起下线**，统一到底端共享 `AddTile`（沿用 `data-add-state` 标记，单一入口、中性虚线）。
  - **④b**：菜单项 `onClick` 补 `e.domEvent.stopPropagation()`（与资产卡同一约定），卡片守卫再加 `closest('.ant-dropdown')` 兜底。**⚠ 2026-11-06 返工：本轮只治了「误跳状态页」，症状的另一半（改了不生效、徽标闪一下又变回去）真因在存储层并发丢写，见征集 #178。**
  - **⑤**：`MentionEditor` 新增通用 `dropMimeTypes` + `onDropPayload(mime, raw, caretOffset)`（名单外拖拽完全不接管），落点用 `caretRangeFromPoint/caretPositionFromPoint` → `caretToTextOffset`，插入走既有文本模型 `insertAt`（不碰 contentEditable DOM）；插槽格加 `draggable` + `onDragStart` 携带 `application/x-director-slot {label,assetId}`，面板 `onDropPayload` 按当前槽位映射重查 label 后插入 `@PictureN `（尾空格是模型铁律；槽位已不在本片段 → 返回 null 不插过期引用）。
  - **测试**：新增 `modal-centering.test.ts`（2 例）、`mention-editor.test.tsx` 拖入 3 例（命中插入 / 宿主返回 null / 名单外不接管）、`subject-library-pages.test.tsx` 改类型不误跳 1 例 + 添加状态 AddTile 断言改写；`pnpm typecheck` = **47**（基线不变）；全量 `vitest run` = 112 文件 / **105 passed / 1 skipped / 6 failed（6 个与本轮无关的存量失败，与 #174 记录同一批）**；`npm run build` exit=0，产物实锤两条 `:focus-visible` 均中性、`x-director-slot` 与 `subcanvas:` 在包内、`selectedOutline:"#00c758"` 零命中。
