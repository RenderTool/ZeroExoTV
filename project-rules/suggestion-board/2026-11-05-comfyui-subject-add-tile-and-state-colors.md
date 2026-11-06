---
状态: merged
创建: 2026-11-05
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83）
归属建议: 独立处理（三项均为视觉状态色/入口形态纠正，直接热修不建 Plan）
---

# 主体库标题与新建入口形态 + 状态色去红去绿

## 一、需求 / 问题描述（用户原话）

> 1 主体库标题去掉，添加主体的按钮要和资产中上传素材同款同位置！！别用红色
> 2 同样的提示词输入框点击状态别用红色，以及下面片段选中状态别用绿色！

配图取证：
- 图1（19-02）：抽屉「主体」分段顶部 = 「主体库 ③」标题 + 右侧**红色实底**「+ 添加主体」按钮（antd `type="primary"`，主题 accent = 品牌红）。
- 图2（19-12）：导演台提示词框整圈**粉红描边**（聚焦态）；导轨片段 01 整圈**绿色描边**（选中态）。

## 二、背景与现状（三条都定位到实锤）

| # | 现象 | 根因（实锤） |
|---|---|---|
| 1a | 抽屉里重复标题 | `subject-library-pages.tsx` 列表页 `SubjectPageHeader`（面包屑「主体库」+ 计数 Badge + 右侧主操作）在 embedded 也渲染；而分段胶囊已经写着「主体」，计数又与 `CategoryChips` 的「全部」同源 → 纯重复 |
| 1b | 红色主按钮 + 位置不一致 | 同一 header 的 `actions` 用 `<Button type="primary">`；而素材分段的新建入口是 `canvas-assets/components/common.tsx` 的 **AddTile**（整宽 1.5px 虚线框 + 中性 muted 字，位于列表底部 `padding:'0 20px 12px'`）→ 两个分段一个在右上红按钮、一个在底部虚线格 |
| 2 | 提示词框聚焦红 | **全局** `src/app.css` `@layer base` 的 `:focus-visible { outline: 2px solid rgba(233,69,96,0.5) }`（品牌红）命中所有输入框；导演台面板内那条 focus 规则只是重复覆盖，所以只改面板没用——真凶在全局 |
| 3 | 片段选中绿 | `timeline-constants.ts directorRailTone()` 的 `selectedBorder/selectedOutline/selectedShadow` 三枚 token 全取 `#00c758` 系；批量模式勾选块（`workbench-tab-content.tsx` batchCheckOverlay）也用 `#00c758` |

既有约定佐证（不是新发明）：仓内已多轮"去品牌红"——`EpisodeList.tsx` 注释「激活集名不再用 accent(#e94560 品牌红)——红字像报错」、`empty-canvas-guide.tsx` 中性口径（深=冷白 226,232,240 / 浅=暖灰 68,64,60）、`canvas-color-tokens.test.ts` 断言边色不得为 `#e94560`、`ghost-nodes` 测试断言选中环不含品牌红。

## 三、归属分析

- **类型**：交互决策（入口形态统一）+ bug 遗漏（全局 focus 红与"状态色不用品牌红"约定冲突）
- **疑似关联 Plan**：[Plan#83](../shared/plans/2026-11-02-zeroexo-comfyui-standalone.md) 验收修复轮（同 #173/#174 先例）
- **倾向性结论**：直接热修。
  - 主体库：embedded 列表页**整块页头下线**；新建入口改**共享 AddTile**（同组件、同底端位置、同中性虚线形态），AddTile 补可选 `icon`（新建语义传 `Plus`，上传语义保持默认 `Upload`）；整页模式（非 embedded）不动，避免波及分镜全屏编辑器路径。
  - 状态色：聚焦环与选中态统一中性亮色（深=冷白 / 浅=暖灰），绿色**只保留给「段间衔接」语义标记**（箭头），不再用于任何选中/勾选态；页签键盘环同步去 accent 红。

## 四、影响面预估

`src/app.css`、`src/features/canvas-tabs/canvas-tab-bar.css|tsx`、`src/features/canvas-tabs/director-prompt-panel.tsx`、`src/features/canvas-tabs/workbench-tab-content.tsx`、`src/features/canvas-nodes/storyboard/timeline-constants.ts`、`src/features/canvas-nodes/storyboard/subject-library-pages.tsx`、`src/features/canvas-assets/components/common.tsx`、`project-rules/specs/director-h3-workspace/rail-visual-spec.md`、测试 `workbench-director-track.test.tsx` / `subject-library-pages.test.tsx`

## 五、处理结果（2026-11-05 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - `app.css` 全局 `:focus-visible` → `rgba(148,163,184,0.9)`（中性 slate，浅深两主题可读）；`director-prompt-panel.tsx` 面板内 focus 规则与浮层勾选框去品牌红改中性；`canvas-tab-bar.css` 键盘环去 `--zx-tab-accent`（并删 tsx 中已无消费点的变量注入）。
  - `directorRailTone()` 选中三枚 token 改中性（深 `rgba(226,232,240,*)` / 浅 `rgba(68,64,60,*)`）；`batchCheckOverlay` 勾选块同改中性（按 `theme.mode` 取值，deps 补 `theme.mode`）；衔接箭头绿色保留。
  - 主体库 embedded 列表页：页头整块下线（`!embedded` 才渲染）；底端新增共享 `AddTile`（`dataAttr={{'data-subject-add':''}}` 保住标记）；空态红色主按钮仅非 embedded 保留。
  - 测试：`workbench-director-track.test.tsx` 选中态断言改中性 + 新增绿色零残留断言；`subject-library-pages.test.tsx` 新增 2 例（embedded 无页头 + AddTile 形态可点；非 embedded 照旧）；`rail-visual-spec.md` 第 1/3 节取值表同步。
  - 验证：`pnpm typecheck` = **47**（基线不变）；`vitest run src/features/canvas-tabs + subject-library-pages` = **15 文件全绿**；`npm run build` exit=0，产物 CSS 实锤两条 `:focus-visible` 均为中性、红色仅剩 `::selection`（文字选区，未动，如需中性化再说）。
