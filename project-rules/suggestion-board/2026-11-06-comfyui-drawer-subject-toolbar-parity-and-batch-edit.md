---
状态: merged
创建: 2026-11-06
来源: 验收反馈（附图1 抽屉主体分段 / 图2 抽屉素材分段 对比）
关联项目: zeroexo-comfyui（本地版，Plan#83 验收修复轮）
归属建议: 独立处理（热修，收编 #176「抽屉内主体与素材同源」未完成部分 + 新增批量编辑能力）
---

# 抽屉主体分段：全集下拉错位 + 搜索条高度不统一 + 没有批量编辑

## 一、需求 / 问题描述（用户原话）

> 你没发现抽屉里的主体搜索名称附近全集下拉列表很奇怪嘛？以及搜索条高度也和其他Tab没统一，另外没法批量编辑？？？图1 图2明显存在布局差异！！

拆成 3 条：① 「全集」下拉在搜索附近显示奇怪；② 搜索条高度与其它 Tab 不统一；③ 主体列表没有批量编辑。图1（主体分段）与图2（素材分段）布局明显有差异。

## 二、背景与现状（逐条实锤）

| # | 根因 | 证据 |
|---|---|---|
| ①② | #176 只做到「chips 与搜索都用共享组件」，但**没沿用素材的 `ToolbarRow` 行结构**：主体把 chips+搜索塞进一个 `flex:1 1 220px` 的列，再把集筛选 `marginLeft:auto` 挂在同一行的右侧 → 窄抽屉里那一列被挤短，「全集」按钮贴到抽屉右边缘被裁成半截（图1）；行内距也变成 `12 + gap 8 + 12`，与素材的 `ToolbarRow(8/20/10)` 不同源 → 搜索条上下留白与高度看着就不一样 | `subject-library-pages.tsx` 旧工具栏块 vs `MaterialGroup.tsx` 的 `<ToolbarRow>` 两行结构 |
| ③ | 主体卡只有单条动作（改类型/进入/删除），没有多选入口。而本仓库**多选形态早已存在**：`MultiSelectCheckbox`（资产库网格用）+ 工具栏 `Square/CheckSquare` 开关（2026-08-29 约定「多选按钮紧跟搜索」）。抽屉素材段自己传的是 `multiSelectEnabled={false}`，所以主体段照抄素材段 = 也没有批量 | `asset-library-grid-view.tsx` / `asset-library-toolbar.tsx` / `MaterialGroup.tsx` |

## 三、归属分析

- **类型**：bug 遗漏（①② 同源未做彻底，视觉与交互都偏）+ 功能强化（③ 批量编辑）
- **关联 Plan**：Plan#83 验收修复轮（与 #176/#177/#179/#180 同一批主体库反馈）
- **倾向性结论**：热修，不新建 Plan。① = 主体段工具栏改为**与素材段逐行同构**（共享 `ToolbarRow` + `SearchBox`，chips 一行、搜索行右侧依次放「多选开关 → 集筛选」，不再有 `marginLeft:auto` 外挂列）；③ = **复用既有多选形态**（`MultiSelectCheckbox` + `Square/CheckSquare` 开关），不自造一套选择 UI。

## 四、影响面预估

- `subject-library-pages.tsx`：工具栏两分支重构（embedded 走 ToolbarRow；整页保留原行 + 右侧开关）、多选态与批量条、`SubjectGridCard` 新增 `multiSelect/selected/onToggleSelect`（多选时卡内动作区隐藏，避免两套操作抢入口）
- `use-storyboard-subject-data.ts`：新增 `updateItems` / `deleteItems`（**一笔容器写**完成批量，不是 N 笔排队 → 少跳版本、少写快照）
- `storyboard-tab-content.tsx` / `SubjectGroup.tsx` / `StoryboardSubjectTab.tsx`：透传批量写回调（可选 props，缺省退回循环单条写，老宿主不破）
- `canvas-assets/components/common.tsx`：`ToolbarRow` 增加 `dataAttr`（沿用 `AddTile.dataAttr` 既有约定，供结构断言）
- `asset-library/components/multi-select-checkbox.tsx`：加 `data-multi-select-checkbox` 标记（无样式变化）
- `i18n/{zh,en,ja}.json`：多选/批量 9 个 key
- 风险：批量删除会一次释放多棵树的 CAS 引用（沿用 `releaseSubjectStateMediaRefs` 单笔批量入参，与单条删除同顺序：先释放后改树）

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **①② 工具栏同源**：抽屉内改为与素材分段**同一套行结构** —— `ToolbarRow`（8/20/10）放 chips，第二行 `ToolbarRow paddingTop:0` 放 `SearchBox`（高 26，与素材同一组件）+ 多选开关 + 「全集」下拉；`marginLeft:auto` 外挂列彻底删除，窄抽屉不再出现被右边缘裁半的下拉。整页模式保留原布局，只把开关与集筛选并到同一右侧组。
  - **③ 批量编辑**：搜索行右侧 `Square/CheckSquare` 开关（与资产库同形态同位置）→ 卡片左上出现同款 `MultiSelectCheckbox`（类型徽标右移让位，同资产卡口径），点卡片=选中/取消且不跳转、卡内动作区隐藏；出现批量条：`已选 N 项` + `改类型`（角色/场景/道具）+ `删除`（确认弹窗）+ `清空选择`，未选中时动作置灰。
  - **批量写入语义**：改类型 = 树 kind（事实源）一笔 + 条目 kind 一笔，并顺手给老树补 `itemId`（与 #180 自愈口径一致）；删除 = 先批量释放绑定树 CAS 引用，再单笔剔除条目与树；**未选中的主体树不动**。
  - **测试**：`subject-library-pages.test.tsx` 新增 4 例（工具栏同源结构 / 多选态行为 / 批量改类型两处一笔写回 + itemId 自愈 / 批量删除只动选中项）；`renderPages` 助手扩 `items/trees/onUpdateItems/onDeleteItems`。
  - **验证**：`vitest run` canvas-nodes+canvas-assets+canvas-tabs+asset-library+entities+shared = **697 passed / 9 failed**，9 个全部为存量（`asset-card.test.tsx` 7 + `MaterialGroup.lightbox.test.tsx` 2 = 测试未包 ThemeProvider；`workbench-video-export.test.ts` = 缺 `src/vendor/mp4box.all.min.js`）；`tsc --noEmit` = 52，**本轮文件 0 错误**（新增 5 条全在 Plan#84 在途的 `sub-canvas/*` 与 `use-editor-interactions.ts`）。
  - **未做（等你定夺）**：批量重命名（同名必须逐条不同，批量无意义）、批量设置出现集数（集数是**状态级**字段，不是主体级）；抽屉素材段本身仍是 `multiSelectEnabled={false}`（线上版能力，本地版没开），若你要素材段也支持批量，说一声我按同一形态接上。
