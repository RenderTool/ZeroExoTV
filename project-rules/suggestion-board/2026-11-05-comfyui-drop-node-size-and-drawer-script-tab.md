---
状态: merged
创建: 2026-11-05
来源: 验收反馈
关联项目: zeroexo-comfyui（本地版，Plan#83）
归属建议: 独立处理（两项均为行为不一致/入口冗余，直接热修不建 Plan）
---

# 拖入画布节点尺寸与「发送到画布」不一致 + 抽屉「剧本」分组应移除

## 一、需求 / 问题描述（用户原话）

1. 「现在资产或者提示词拖入画布和直接发送到画布行为不一致！表现为节点尺寸没有和内容对齐！」
2. 「抽屉中的剧本按钮和内容移除」

配图取证：画布上两个图片节点 620×348 / 676×379（16:9 宽幅容器），竖幅/方幅原图在容器内左右留黑边 → 容器比例 ≠ 内容比例。

## 二、背景与现状

**问题 1 根因（已定位到行）**：尺寸契约只写在「发送到画布」一条链路上，拖拽链路全部裸调工厂函数。

| 链路 | 入口 | 建节点方式 | 结果 |
|---|---|---|---|
| 发送到画布 | `pages/editor/editor-canvas/use-editor-dialogs.ts handleAssetInsert` → `insert-asset-to-canvas.ts insertAssetToCanvas` | `withNaturalImageSize()`（用 storageKey 解析链读原图 naturalWidth/Height）+ `createAssetNode(payload, pos, { maxLongSide: 320, fallbackSize: 1:1 })` | 节点比例=图片比例，长边 320，无 letterbox |
| 拖入画布 | `features/canvas-interaction/drop-handler.ts onDrop`（4 个调用点：素材库卡片 / 开源卡片 / AssetPicker / 外部文件） | `createAssetNode(payload, pos)`（不传 options） | 落到 `IMAGE_DEFAULT_SIZE` 620×348 宽幅容器 → 黑边 |

同一条 2026-11-05 已拍板的契约（`packages/plugins/nodes/src/utils/node-contracts.ts IMAGE_LONG_SIDE = 320`，注释写明「发送到画布」与「图片 onload 纠偏」同源）在拖拽侧被漏掉，属实现遗漏而非新设计。

**问题 2 现状**：抽屉左侧 `SidebarNav` 页签由 `features/canvas-assets/tab-defs.ts DRAWER_TAB_DEFS` 派生，含 `script / hierarchy / history / material` 四项；`script` 渲染 `groups/ScriptGroup.tsx`（剧本信息卡 + 空态新建），点击卡片走 `store.mountCanvasScript()` 打开顶部「剧本」页签。顶部固定槽位页签已有「剧本」（2026-11-05 口径：一个项目 = 1 剧本 + 1 导演台 + 1 画布），抽屉里的剧本入口与之重复，且抽屉内不能编辑正文，只能跳顶部 → 冗余入口。

## 三、归属分析

- **类型**：问题 1 = bug 遗漏（同一尺寸契约漏接线）；问题 2 = 交互决策（入口去重）
- **疑似关联 Plan**：[Plan#83](../shared/plans/2026-11-02-zeroexo-comfyui-standalone.md)（影响文件全在本地版验收面内）
- **倾向性结论**：两项都直接热修，不建 Plan。
  - 问题 1 修法必须**收敛为单一来源**（把尺寸解析 + 长边上限从 `insert-asset-to-canvas.ts` 提到公共模块，两条链路共用），不接受在 drop-handler 里再抄一份 320 逻辑——否则第三次加入口还会漏。
  - 问题 2 修法：删页签定义 + 删渲染分支 + 删 `ScriptGroup.tsx` + 清 store 里只服务它的四个成员（`canvasScript / mountCanvasScript / updateCanvasScript / uploadScriptCover`）与随之失效的 import；剧本正文入口只保留顶部「剧本」页签。

## 四、影响面预估

- `src/shared|features/asset-picker/services/asset-node-size.ts`（新建，尺寸契约单一来源）
- `src/pages/editor/editor-canvas/insert-asset-to-canvas.ts`（改为引用公共模块，行为不变）
- `src/features/canvas-interaction/drop-handler.ts`（4 个建节点调用点接入统一尺寸链路）
- `src/features/canvas-assets/tab-defs.ts` / `CanvasAssetsPanel.tsx` / `store.ts` / `groups/ScriptGroup.tsx`（删除）
- 测试：`insert-asset-to-canvas.test.ts`（应继续全绿）、`history-group.test.tsx`（断言 `DRAWER_TAB_DEFS` 含 `script` 需按新口径改）、`store-guard.test.ts` / `material-scope.test.ts`（mock 的 canvas-script 若不再被引用则同步）
- 风险：`mountCanvasScript` 曾兜底「画布无绑定时补建剧本」，删除后该兜底是否仍需 → 检查项目创建/挂载链路是否已覆盖

## 五、处理结果（2026-11-05 已热修）

- 归属：独立处理（热修，不建 Plan）
- 结果摘要：
  - **问题 1**：新建 `src/features/asset-picker/services/asset-node-size.ts`（尺寸契约单一来源：`withNaturalImageSize` + `pickImageLongSide` + `createSizedAssetNode`，长边上限直接引用包内 `IMAGE_LONG_SIDE`，不再本地写死 320）；`insert-asset-to-canvas.ts` 改为引用同一入口（行为不变）；`drop-handler.ts` 四个建节点入口（素材库卡片 / 开源卡片 / AssetPicker / 外部文件）全部改走 `createSizedAssetNode`，新增 `containerSize` 入参取容器实测尺寸。
    新增单测 `asset-node-size.test.ts`（10 例，含结构断言：drop-handler 源码零裸 `createAssetNode(`、发送链不再本地重写尺寸）；原 `insert-asset-to-canvas.test.ts` 全绿（mock 补 `IMAGE_LONG_SIDE/MEDIA_MIN_SIZE`）。
  - **问题 2**：`tab-defs.ts` 删 `script` 页签；`CanvasAssetsPanel.tsx` 删渲染分支 + `BookOpen` 图标项；**删除 `groups/ScriptGroup.tsx`**；`store.ts` 清掉只服务它的 `canvasScript / mountCanvasScript / updateCanvasScript / uploadScriptCover` 与随之失效的 import（`findCanvasScript/ensureCanvasScript/openCanvasTab/uploadImage/ScriptMeta`），`DrawerGroup` 类型去 `'script'`，`changeGroup` 去挂载副作用，pending-focus 对 `script` 不再切分组；`script-card.tsx` 下线冗余 `export { ScriptCardGrid }`；`history-utils.ts` 注释同步。
  - **测试同步**：`history-group.test.tsx` 旧断言 `keys).toContain('script')` → 改新口径（`not.toContain('script')` + 新增源码断言 ScriptGroup 彻底下线）。
  - **验证**：`pnpm typecheck` = **47**（与动手前基线一致，零新增）；`vitest run` 全量 109 文件 = 102 passed / 1 skipped / **6 failed**，6 个失败均为存量问题（`workbench-video-export` 缺 `src/vendor/mp4box.all.min.js`；`asset-card / MaterialGroup.lightbox / asset-sanitize` 的 `useTheme must be used within ThemeProvider`（AssetScopeBadge 缺 Provider）+ 5s 超时；`thumb-eviction / bugfix-20261104` 预览 URL 解析），与本次改动文件零交集。
  - **额外发现（环内遗留）**：用户看的页面跑的是旧 `dist`（17:15 构建，不含上一轮导演台提示词面板圆角）；本次已 `npm run build` 刷新到 `index-D83D1Bca.js`（19:37），包内已实锤 `borderRadius:12` + 尺寸单一入口 + 剧本页签下线。构建首次失败为环境问题（esbuild 在 `%TEMP%` 删临时文件 Access denied），将 TMP/TEMP 指向仓内目录后 exit=0；`dist/assets` 仍累积 13 个历史 `index-*.js`（`emptyOutDir` 未开），待用户决定是否清理。
