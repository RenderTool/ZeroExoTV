---
编号: S-28
状态: merged
创建: 2026-11-13
来源: 用户反馈
归属: 独立热修（导演台按集切换）
---

# 导演台分集下拉 + 片段 episodeId

## 一、用户原话

> 另外导演台的分集下拉按钮呢？？？

## 二、改造

- `WorkbenchShot.episodeId?: string`：片段归属集的唯一依据；缺省 = 未分集（上线前存量数据）。
- `workbench-episodes.ts`：`UNASSIGNED_EPISODE_KEY` / `groupShotsByEpisode` / `orderEpisodeKeys` /
  `flattenEpisodeGroups` / `pickInitialEpisodeKey`（未分集单独一桶，不冒充某一集）。
- 导演台导轨工具栏最左侧新增 `data-director-episode` 分集下拉：
  - 选项按剧本集顺序，显示「第 N 集 / 自定义标题（M 段）」；未分集显示「未分集（M 段）」；
  - 切换只改可见片段（timeline / 预览 / 提示词面板 / 镜头跳转 / 上下镜），不改数据；
  - 记忆到 `view-prefs.workbench.activeEpisodeByProject`，刷新/切页签保留；
  - 新建片段（添加 / 插入）自动归入当前集，同集内从 1 编号。
- MCP：`split_script_to_shots` 落盘时给每段盖 `episodeId`（同集内编号）；`add_segment` 新增可选
  `episodeId`；`WorkbenchShot` 类型同步。

## 三、边界

- 未分集数据不会被自动塞进第一集；用户切换/重新拆分镜后再归集。
- 空集不强行造片段：切到没有片段的集会显示 0 段，需手动添加。
- 运行/批量仍按导演台完整 shots 队列校验延续法，不受“当前可见集”影响。
