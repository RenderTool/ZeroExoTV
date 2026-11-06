---
状态: merged
创建: 2026-11-06
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83 验收轮）
归属建议: 独立处理（热修，收编 #181 遗留「素材段批量未开」+ #182 之后的分段命名/顺序）
---

# 素材分段批量操作 + 「我的资产」改名「全局」+ 开源库排到 Tab 最后

## 一、需求 / 问题描述（用户原话）

> 除了我的主体，我的资产、本项目都应该支持批量操作！另外我决定把我的资产改名叫全局和本项目和开源这样更符合语义

> 开源库应该放Tab的最后

## 二、背景与现状（逐条实锤）

| # | 现状 | 结论 |
|---|---|---|
| 1 | 抽屉素材段写死 `multiSelectEnabled={false}` / `selected={false}` / `onToggleSelect={() => undefined}` —— 多选能力在资产库页面（`AssetLibraryGridView` + `MultiSelectCheckbox` + 多选栏「已选 N / 全选 / 删除选中 / 退出多选」）早已存在，抽屉只是没接 | 不是缺功能，是缺接线；必须复用同一形态，不再造一套选择 UI |
| 2 | 「我的资产」这个名字与「本项目 / 开源库」不成同一分类维度（前者讲归属、后两者讲范围），内部键仍是 `scope:'library'` | 只改显示层：`scopeCapsuleLibrary` / `srcTabLibrary` / `groupLibrary` / `scopeTagLibrary` / 各处「我的资产库」文案 → 全局；**内部枚举键 `library` 不动**（持久化键 + MCP 契约，改名代价远大于收益） |
| 3 | 分段顺序硬编码在 `ScopeCapsuleTabs` 里：library → project → openlib → subject，开源库夹在用户数据段中间 | 改为 library → project → subject → openlib（只读外部资源垫后） |

## 三、归属分析

- **类型**：功能强化（批量操作）+ 交互决策（改名、分段顺序）
- **关联 Plan**：Plan#83 验收轮（与 #181/#182 同一批抽屉反馈）
- **倾向性结论**：热修。批量 = 把资产库页面的多选形态接进抽屉；批量动作复用单条执行器（发送走 `sendToCanvas`/`sendAssetToWorkbench`，删除走 `deleteAssetsWithUndo` 一笔），不复制第二份逻辑。

## 四、影响面预估

- `canvas-assets/store.ts`：新增 `assetMultiSelect` / `assetSelectedIds` / `assetSelectedAssets` / `toggleAssetSelect` / `toggleAssetSelectAll` / `handleBatchDeleteAssets` / `handleBatchSendToCanvas` / `handleBatchSendToDirector`；分段·类型·搜索变化即清空选中（选中集是数据上下文，不进 view-prefs）
- `canvas-assets/groups/MaterialGroup.tsx`：搜索行右侧多选开关（Square/CheckSquare，与资产库同约定）、批量条、卡片左上同款 `MultiSelectCheckbox`、多选态隐藏卡内快捷发送按钮
- `asset-library/components/scope-capsule-tabs.tsx`：段序 subject 前置于 openlib
- 改名：`i18n/{zh,en,ja}.json`（scopeCapsuleLibrary/Project、scopeTagLibrary、srcTabLibrary、sourceLibrary、pageTitle、saveToAssets、assetsSaved、director.groupLibrary 等）+ 代码内 fallback 与硬编码来源串（MaterialGroup / asset-library-page / asset-library-modals / asset-store 报错文案）
- `shared/view-prefs.ts`：分段记忆注释同步新语义
- 风险：批量发送到画布 = N 个节点（与逐个拖入同一条建节点链，不新增语义）；批量删除沿用 3 秒撤销浮层

## 五、处理结果（2026-11-06 已热修）

- 归属：独立处理（热修）
- 结果摘要：
  - **批量操作**：素材段搜索行右侧出现多选开关 → 卡片左上同款复选框（徽标右移让位，与资产卡一致）→ 批量条「已选 N 项 / 全选(取消全选) / 发送到画布 / 发送到导演台 / 删除选中 / 退出多选」；未选中时动作置灰；多选态点卡片=选中不打开大图，卡内快捷按钮隐藏（一个时刻一套操作）。删除走 `deleteAssetsWithUndo`（一笔 + 3 秒撤销 + 引用失效提示）；发送导演台先查一次片段上下文，缺片段只提示一条，不 N 遍弹窗。
  - **改名**：抽屉分段与所有用户可见处「我的资产」→「全局」（en Global / ja グローバル），「我的资产库」→「全局资产库」；内部 `scope:'library'` 枚举键与存储键不变。
  - **顺序**：分段变为 全局 / 本项目 / 主体 / 开源库。
  - **测试**：新增 `MaterialGroup.batch.test.tsx` 6 例（非多选态无复选框无批量条 / 复选框数与点卡回调 id / 批量条计数与全选文案切换与三动作回调 / 零选中置灰 / 已全选文案 / 多选态隐藏卡内快捷按钮）；`scope-capsule-tabs.test.tsx` 段序断言改 `[library, project, subject, openlib]`；`asset-scope.test.ts` 报错文案断言同步；`MaterialGroup.lightbox.test.tsx` 假 store 补齐批量字段（否则组件解构到 undefined）。
  - **验证**：`vitest run` MaterialGroup.batch + scope-capsule-tabs + store-guard = 全绿（9 passed）；`tsc --noEmit` 本轮文件 0 错误（并顺手把两个主体测试夹具里的 `openSubCanvasesByProject` 改为并行会话已重命名的 `openCanvasesByProject`）。
  - **注意**：并行会话同期在改 `director-prompt-panel` / `sub-canvas` / 图像变体链路，`director-prompt-panel.test.tsx` 本轮出现 37 例非我改动的失败（槽位/缩略图/poster 相关），我的 7 例滑动条用例单独跑全绿。
