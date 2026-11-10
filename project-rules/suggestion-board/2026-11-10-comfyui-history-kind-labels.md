---
编号: S-20
状态: merged
创建: 2026-11-10
来源: 用户需求
归属: 独立热修
---

# 历史分组类型标签改简约名词

## 一、需求 / 问题描述

用户原话（附图，红框圈出历史分组第二层分类胶囊）：「图片产出、视频生成这种文案也该改成简约的图片、视频就行了！本质是标签」

## 二、背景与现状

历史分组第二层是**类型标签**（含数量徽标），不是动作描述，用「产出 / 生成」这类动宾短语既冗长又与卡片上已有的「图片」小标签重复。三语文案：`historyTabImage` / `historyTabVideo`（zh `图片产出`/`视频生成`、ja `画像产出`/`動画生成`、en `Image Outputs`/`Video Generations`），`HistoryGroup.tsx:470-471` 另有 defaultValue 兜底。

## 三、归属分析

- **类型**：功能强化（文案规范化）。
- **关联 Plan**：无；纯文案 + 兜底值 + 断言同步，独立热修，不立项。
- **倾向性结论**：标签一律用名词，不用「产出 / 生成 / Outputs / Generations」。

## 四、影响面预估

`src/i18n/{zh,ja,en}.json`、`HistoryGroup.tsx`（defaultValue 与注释）、`history-group.test.tsx`（标签定位断言）；`pnpm typecheck` + 相关单测。

## 五、处理结果

- 归属：独立热修。
- 结果摘要：三语标签改为 `图片`/`视频`、`画像`/`動画`、`Image`/`Video`（顺带修掉日文里混用的中文「产出」）；`HistoryGroup` 的 defaultValue 与注释同步；测试改用 `getByRole('button', { name: /^图片|视频/ })` 定位，避免「图片」在卡片标签上重名。
- 验证：`pnpm typecheck`；历史分组单测；前端全量 vitest。
- 横向巡检候选（未改，仅记录）：`nodes.imageTitle`/`videoTitle`/`audioTitle` 仍是「图片生成 / 视频生成 / 音频生成」（节点默认标题，不是标签）；第一层来源胶囊 `historySourceCanvas` 仍是「从画布生成」；`history-autoland.ts:85` 默认资产标题仍是「画布图片产出 / 画布视频产出」；空态说明句含「图片产出记录」等叙述性文字。这些不是分类标签，是否一并简约化待用户拍板。
