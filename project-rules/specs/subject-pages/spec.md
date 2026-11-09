# 主体库页面化（面包屑三层）规格

日期：2026-11-05
范围：仅「主体库」页签（`StoryboardTabContent` → `StoryboardSubjectTab` 的 pages 模式）。
不触碰：资产卡片悬浮按钮/大图查看、insert-asset-to-canvas、media-url-provider / use-media-object-url / resolve-media-blob。

## 1. 三层结构

| 层级 | 路由状态 | 面包屑 | 页面内容 |
|------|---------|--------|---------|
| 列表页 | `{ view: 'list' }` | 主体库（仅一级） | 搜索框 + 类型筛选 + 主体卡片网格 + 新建卡 |
| 主体状态页 | `{ view: 'subject', rootId }` | 主体库 / 主体名 | 状态卡片网格（基础状态 + states[]）：缩略图 / 状态名 / 出现集数摘要 / 媒体就绪 |
| 状态编辑页 | `{ view: 'state', rootId, stateId }` | 主体库 / 主体名 / 状态名 | 状态名、提示词（备注标签）、出现集数（多选）、媒体（图片/语音）接收位 |

- 面包屑每一级都是原生 `<button>`：可点击、Tab 聚焦、Enter/Space 触发。
- 状态归属：`rootId = SubjectTree.rootId`；`stateId = SubjectTreeNode.id`。2026-11-08 数据层统一后，基础状态是 `states[0]` **真节点**，id 恒为 `__base__`；所有状态（含基础）都走同一套 `stateId` 路由与 `states[].media` 取数。
- 进入主体页时若该主体尚无 `SubjectTree`，按既有逻辑幂等建树（`createSubjectTree` + `buildBaseStatePrompt` + 条目图片带入），树写回容器。

## 2. 导航记忆 / 前进后退

- 每次层级变化写入 `view-prefs.subjectPages.lastByProject[projectId] = { rootId, stateId|null }`（与 `canvasTabs.lastSlotByProject` 同思路、同单键 localStorage）。
- 刷新/重进项目：按项目恢复上次层级；rootId/stateId 已不存在 → 回退到有效上级（状态不存在回主体页，主体不存在回列表页）。
- 深层进入调用 `history.pushState({ __subjectPages: { projectId, rootId, stateId, seq } })`，监听 `popstate` 按 marker 还原层级（浏览器前进/后退对应层级）。
- 面包屑点击为确定性页内返回（同时 `replaceState` 当前 marker），不依赖异步 history.back；编辑写回落盘，因此返回不丢草稿。

## 3. 资产发送绑定规则

- 唯一写入函数：`linkSubjectStateMedia`（`subject-state-media.ts`），不另造写入路径。
- 统一发送执行器：`sendAssetToSubject(payload)`。
  - 当前停在某个「状态编辑页」→ 直接读取容器 → `linkSubjectStateMedia` → `updateStoryboardContainer` → 广播 `useSubjectMediaLinkEventStore.emit` → `navigateToView('subject', { rootId, stateId, projectId })` + 成功提示。
  - 无当前状态（列表页/主体页/基础状态页/其它页签）→ 复用 `openSubjectLinkDialog` 弹出主体→状态选择。
    （基础状态是 `baseState` 而非 `states[]` 槽位，`linkSubjectStateMedia` 不支持，故走弹层。）
  - 目标状态已不存在（并发删除）→ 降级到选择弹层，不静默失败。
- 执行器导出为 `sendAssetToSubject(payload, { notify? })`；资产卡片/抽屉的「发送到主体」直接调用它，
  本线不改资产卡片悬浮按钮/大图查看（另一条线在改）。
- 扩展统一导航入口 `navigateToView` 新增 `'subject'`：切主体库页签，`rootId/stateId` 走「事件 + pending」双通道（`NAVIGATE_FOCUS_SUBJECT_EVENT` / `takePendingNavigateFocus`）。
- 状态编辑页订阅 `useSubjectMediaLinkEventStore`，发送后重读容器刷新缩略图；主体页计数来自同一份本地树，即时更新。

## 4. 旧数据策略

- 不改写、不迁移 `subjectTree` 结构；旧数据直接进入新页面展示。旧「单树弹层」仍保留给分镜全屏编辑器（`storyboard-fullscreen-editor` 不传 pages 模式）。
- `baseState` / `states[]` / `media[]` / `appearEpisodes` 字段语义完全沿用；无状态的主体展示空态 + 「添加状态」。
- 图片只走既有 storageKey 解析链（`getResourceUrl` + `usePreviewImage`）；CAS 键用 `hasCasEntry` 探测，失效显示可读占位（「引用已失效」），不留空白。
