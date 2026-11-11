---
编号: S-22
状态: merged
创建: 2026-11-11
来源: 验收反馈
归属: 独立热修
---

# 首页三项：回收站弹窗尺寸 / 复制项目 / 资产选择模式对齐

## 一、需求 / 问题描述

用户原话（附图 2 张）：
1. 「回收站的弹窗应该固定尺寸内置滚动条，目前会出现数据多时超过网页的情况！」
2. 「当前复制项目并没有正确创建副本！」
3. 「首页全局资产进入选择模式后和项目进入选择模式后的 UI 位置没有一致！！！要以项目的那种 UI 交互模式为准……而资产的交互模式被放在了右下角可能用户没仔细看就被忽略了」

## 二、背景与现状

| # | 根因 |
|---|---|
| 1 | `media-recycle-bin-dialog.tsx:163-190`：Modal 只有 `width={680}`，body 无 `maxHeight/overflowY`，Table 无 `scroll.y`，`pagination` 单页 20 行 → 行数多时整体撑出视口，footer 被推到屏外 |
| 2 | `persistence-localforage/src/project-store.ts:166-196` 的 `copyProject` 只写新 meta + 主 graph。按 `projectId` 隔离的 `entities/{script,storyboard,workbench}.json`、`canvases/*.json`、本项目资产记录、画布剧本资产全部未复制；`use-projects.ts:115-134` 与编辑器侧 `use-editor-dialogs.ts` 两条复制路径还不一致 → 打开副本是空剧本/空主体/空导演台，表现像「没创建副本」 |
| 3 | 项目选择态按钮在页头同一排（`canvas-page.tsx:331-427`）；资产选择态的「已选 N / 全选 / 打包下载 / 删除 / 退出」是 `asset-library-page.tsx:432-477` 内联在内容区底部右对齐，容易被忽略 |

## 三、归属分析

- **类型**：bug 遗漏（1、2）+ 交互对齐（3）。
- **关联 Plan**：无；三条各自落点集中、无阶段性决策，独立热修。
- **倾向性结论**：复制项目复用「实体三件套 + 副本画布 + 资产记录 + 剧本资产」同一份克隆函数，消除首页/编辑器双路径差异。

## 四、影响面预估

`media-recycle-bin-dialog.tsx`、新增 `clone-project-data.ts`、`asset-store.ts`、`use-projects.ts`、`use-editor-dialogs.ts`、`asset-library-page.tsx`、`asset-library-toolbar.tsx`、单测与本文档索引。`pnpm typecheck` + 全量 vitest。

## 五、处理结果

- 归属：独立热修。
- 结果摘要：待实现。
- 验证：待补。
