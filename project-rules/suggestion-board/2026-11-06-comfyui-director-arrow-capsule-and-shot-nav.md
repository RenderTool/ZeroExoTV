---
状态: merged
创建: 2026-11-06
来源: 用户需求
关联项目: zeroexo-comfyui（按 Plan#83/84 归属，注册表单列）
归属建议: 独立热修，不建 Plan；归入 Plan#83 验收修复轮
---

# 导演台衔接箭头胶囊化 + 提示词面板标题区镜头跳转胶囊

## 一、需求 / 问题描述

用户原话：「然后导演台的衔接箭头能不能美化一下？现在这样根本不像这个项目该有的UI！ @image:PixPin_2026-11-06_15-07-48.png 然后提示词卡片顶部标题区能不能加上这种跳转小胶囊？方便用户快速切换」

附图形态：深色小胶囊 `< 文件 50 / 50 >`（左箭头 + 「当前 / 总数」+ 右箭头），即项目同款 25 高、圆角 5 的元信息胶囊。

## 二、背景与现状

- **衔接箭头**：`workbench-tab-content.tsx` L841–900 内联覆盖层，34×22 透明占位 + 荧光绿细线 glyph（`#00c758`），只有 hover 透明度变化。`project-rules/specs/director-h3-workspace/rail-visual-spec.md` §5 与 `workbench-director-track.test.tsx` L226–229/L1351 明确写死「无底色、无描边、无圆角（11-05 去掉白色胶囊底）」。用户本次判定该造型「不像这个项目该有的 UI」。
- **提示词卡片顶部标题区**：按导演台提示词面板 `DirectorPromptPanel` Row2（L1429–1487）处理（同一语境、有 `镜头 N · Ns` 标题、有 `shotIndex`；通用 `PromptCard` 的标题在封面底部且无切换语义）。Row2 右侧只有时长/引导两个胶囊，缺少镜头间快速切换入口。
- **可复用既有契约**：`DirectorPromptPanel.capsuleStyle`（25 高 / radius 5 / 12px / `palette.capsuleBg` `#2b2b2b`）+ `useCardPalette` 色板；i18n 已有 `director.prevShot` / `nextShot` / `shotCount`（zh/en/ja 三语齐全）；`controlled-dock-reuse.md` 受控铁律（数据由宿主持有、props 单向传入，组件内不自建业务状态）；`MediaLightbox` 的 `N / M` + 左右箭头 + 边界禁用范式。
- **状态色口径**：征集 #176 拍板「绿色只保留给段间衔接箭头」，故 glyph 绿色保留不动，只美化容器，避免推翻既有语义。

## 三、归属分析

- **类型**：交互决策（视觉统一）+ 功能强化（快捷切换）
- **疑似关联 Plan**：[Plan#83](../shared/plans/2026-11-02-zeroexo-comfyui-standalone.md) 验收修复轮（同 #173/#174/#176/#183 先例）
- **倾向性结论**：独立热修，不建 Plan。用户新指令覆盖 11-05 spec §5 的「无底色/无胶囊」口径，须同步改 spec 与测试断言，不可只改实现留下契约噪音；绿色语义与 34×22 几何/位置公式保持不变。

## 四、影响面预估

`timeline-constants.ts`（箭头 token）、`workbench-tab-content.tsx`（箭头样式 + 宿主传参）、`director-prompt-panel.tsx`（props + Row2 胶囊）、`rail-visual-spec.md`、`workbench-director-track.test.tsx`（3 处旧断言）。风险：箭头覆盖层在卡片交界处，胶囊底会略微遮挡卡片边缘（沿用 34×22 占位与 left/top 公式，不扩大命中区）；跳转胶囊必须与 `activeShotId` 同一受控源，避免切镜头后面板不刷新。

## 五、处理结果（归属确定后填写）

- 归属：独立热修，归入 Plan#83 验收轮
- 结果摘要：箭头升级为项目同款深色胶囊（胶囊底 + 1px 细描边 + 圆角 5 + 柔和阴影，hover 边框转绿/外发光），glyph 绿色与 hover/静息 opacity、34×22 几何全部保留；提示词面板 Row2 标题区新增受控 `< 镜头 N / M >` 跳转胶囊（复用 `capsuleStyle`、边界禁用、zh/en/ja 现成 i18n 键）；spec §1/§5、测试头部注释与 3 处「无底色」旧断言同步，并新增 1 条胶囊回归用例。
- 验证：改动文件 typecheck / lint 零错误；`director-prompt-panel.test.tsx` + `workbench-director-track.test.tsx` 95/95 全绿；`pnpm build` 产出 `index-DHB1TCXW.js`；浏览器实测标题区 `镜头 1 / 2` → 点下一个 → `镜头 2 / 2` 且 `镜头 1 · 5s` → `镜头 2 · 5s`、首段禁上/末段禁下正确，箭头 `background=rgba(28,29,32,0.92)` / `borderRadius=5px` / `borderWidth=1px`；4173/5180/8790 在线；视觉截图 `director-ui.png`。
