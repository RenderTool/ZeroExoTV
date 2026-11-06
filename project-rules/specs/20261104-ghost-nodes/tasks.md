# 幽灵节点修复 Tasks（2026-11-04）

依据 spec.md（同目录）。每次编辑前重读目标文件最新内容；不认识的改动保留并单列。

- [ ] T1 core：新建 `packages/core/src/model/node-visibility.ts`（classifyNode / isVisibleNode / filterVisibleNodes），从 core index 导出
- [ ] T2 render-react store.ts:71,366：getActiveNodeIdSet + spatialIndex.rebuild 改 filterVisibleNodes（修框选/命中的根）
- [ ] T3 node-layer.tsx:632 过滤改 isVisibleNode；NodeItem 增加 UnknownNodeContent 占位分支（ext===undefined 时）
- [ ] T4 block-canvas-layer.tsx：组件入口统一 filterVisibleNodes，渲染/预载/hitTest 三处共用
- [ ] T5 canvas-view.tsx:309 空态判定；group/index.ts:153 空态判定
- [ ] T6 hierarchy-panel.tsx:433 改 isVisibleNode + 未注册类型 `⚠` 徽标；group-layer.tsx:187、minimap-view.tsx:74 同步
- [ ] T7 interaction/controller.ts:723 辅助线过滤；selection/controller.ts:84 防御性交集 activeNodeIds
- [ ] T8 editor-page.tsx:428/434/916/1149、use-editor-state.ts:968、sync-projects.ts:94/129 计数与 fit-all 改活跃口径（共享文件最小行改；编辑前重读）
- [ ] T9 重读并视语义处理 hierarchy-list-view.tsx:697/703、content-beacon.tsx:38、read-only-canvas-overlay.tsx:45
- [ ] T10 新建 ghost-nodes-20261104.test.tsx 六组断言（见 spec 2.4）
- [ ] T11 跑新测试 + 回归 bugfix-20261104.test.tsx + tsc --noEmit 对基线
- [ ] T12 汇报：实数表 + 读取方清单 + 修复落盘 + 验证结果 + 孤儿/空数据待处理清单
