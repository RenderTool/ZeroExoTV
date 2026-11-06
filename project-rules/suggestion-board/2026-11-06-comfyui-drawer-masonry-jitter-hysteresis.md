---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 验收修复轮）
归属建议: 独立处理（热修；瀑布流是 #177/#179 引入的共享实现，属其地基缺陷）
---

# 抽屉瀑布流在某个宽度区间「打开后疯狂抖动」

## 一、需求 / 问题描述（用户原话）

> 另外我发现这个抽屉的瀑布计算有很大的问题，抽屉尺寸被缩放到一定尺寸时打开后会疯狂抖动

## 二、背景与现状（反馈环三环闭合）

| 环 | 事实 |
|---|---|
| ① 列数 = f(容器宽度) | `masonryColumnsForWidth` 按 360/560/768/960/1280/1440/1920 断点取档；主体状态卡网格 `subjectStateGridMetricsForWidth` 按「最小卡宽 260」推列 |
| ② 卡片高度 = g(列宽) | 封面高度 = `cardCoverMetrics(columnWidth, aspect)`，列宽来自 `MasonryGrid` 实测后由 context 下发（JS 参与布局，不是纯 CSS） |
| ③ 容器宽度 = 抽屉内宽 − 竖向滚动条 | 滚动区是 `overflowY:'auto'`；Windows Chrome 经典滚动条占 ~15px，**且只在内容超高时出现** |

三环闭合：宽度压在断点上 + 内容高度压在容器高度上 →
`N 列 → 内容变矮 → 滚动条消失 → 宽度 +15px → 越过断点 → N+1 列 → 内容变高 → 滚动条出现 → 宽度 −15px → 回到 N 列 → …`
`ResizeObserver` 每轮都触发 setState，于是「打开后一直抖」。抽屉宽度来自 `hierarchy-panel` 可拖拽 + 按视口夹取，所以只在**某些尺寸**复发。

放大器：`MasonryGrid` 的宽度死区只有 **0.5px**，抽屉 inline 展开动画逐帧变宽时每一帧都重算列数与卡高（先 1 列再跳列的闪动也来自这里）。

## 三、归属分析

- **类型**：bug 遗漏（#177/#179 把瀑布流接进抽屉时没处理「JS 量宽 + 滚动条」反馈环）
- **关联 Plan**：Plan#83 验收修复轮
- **倾向性结论**：热修，两层断开反馈环（缺一层都还会抖）：
  1. **宽度恒定**：滚动容器常驻滚动条槽 `scrollbar-gutter: stable` → ③ 不再随内容高度变化；
  2. **列数滞回**：断点两侧各留 24px 死区（> 滚动条宽度），只有真正进入新区间才翻列 → ①② 之间断开。
  替代方案否决：只加 gutter 不加滞回 → 用户拖拽跨过断点时仍会因亚像素/动画抖动；只加滞回不加 gutter → 15px 往返虽被死区吃掉，但内容高度仍会在临界值反复；改 JS 最短列分列 → 破坏 Tab 顺序（masonry-grid 头注已否决）。

## 四、影响面预估

- `src/shared/utils/stable-columns.ts`（**新**）：`stableColumnCount(width, previous, columnsFor)` 纯函数，边界从映射函数二分反查（1px 精度），不依赖具体断点表；宽度 ≤0（隐藏容器/动画首帧）维持原值
- `src/shared/components/masonry-grid.tsx`：列数走滞回；宽度死区 0.5px → 2px；显式 `columns` 入参时保持原行为（主页资产库 grid-view 传显式列数，零影响）
- `src/features/canvas-assets/components/common.tsx`：新增共享 `SCROLL_AREA_STYLE`（含 `scrollbarGutter:'stable'`），素材/历史/开源库三处滚动区改用它（原来三处各写一份 `{flex:1, overflowY:'auto', minHeight:0}`）
- `subject-library-pages.tsx`：`scrollStyle` 复用 `SCROLL_AREA_STYLE`；`SubjectStateGrid` 列数同样滞回
- `subject-card-metrics.ts`：`subjectStateGridMetricsForWidth` 支持显式 `columns`（保证单卡宽度与实际渲染列数同源）
- 代价：滚动条槽常驻 → 内容不超高时也留 ~15px 右侧空槽（Chromium/Edge/WebView2 支持；不支持的浏览器退化为只有滞回保护）
- 测试：`stable-columns.test.ts`（新 5 例）

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **宽度恒定**：抽屉四个滚动区（素材 / 主体 / 历史 / 开源库）统一 `SCROLL_AREA_STYLE` + `scrollbar-gutter: stable`，滚动条出现与否不再改变可用宽度。
  - **列数滞回**：`stableColumnCount` 死区 24px；`MasonryGrid` 与主体状态卡网格都接入；宽度测到 0 维持原列数（消除展开动画首帧先 1 列再跳列）。
  - **展开动画期反复重算**：宽度死区 0.5px → 2px，逐帧变宽不再每帧重算卡片高度。
  - **测试**：新增 5 例断言「560↔545 往返 20 次不翻列」「增列需 ≥入口+24、减列需 ≤回档入口−24」「状态卡 812 入口同样有死区」「宽度≤0 维持原值」「≥1920 动态增列区与跨多档跳变可收敛且幂等」。
  - **验证**：`vitest run` shared+canvas-assets+asset-library+storyboard+open-library = **425 passed / 9 failed**，9 个全为存量（`asset-card.test.tsx` 7 + `MaterialGroup.lightbox.test.tsx` 2 = 未包 ThemeProvider；`workbench-video-export.test.ts` = 缺 mp4box）；`tsc --noEmit` = 60，**本轮文件 0 错误**（新增全部来自并行会话在途的 `sub-canvas/*`，未代改）。
  - **仍需你实测确认**：把抽屉拖到原来会抖的那个宽度，打开主体/素材分段看是否还抖；若你希望连「拖拽过程中」也完全静止，可以把死区从 24px 调大（`COLUMN_HYSTERESIS_PX` 单点）。
