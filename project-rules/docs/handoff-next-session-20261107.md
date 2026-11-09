# 交接：2026-11-07 收尾（三项待办已完工）

> 本文件原列三项待办，已在同日完成并记账。详细根因/契约/人工验证清单见
> [2026-11-07-guide-and-ui-notes.md](2026-11-07-guide-and-ui-notes.md)。

## 状态

| 待办 | 状态 | 摘要 |
|---|---|---|
| 1. 子画布生成任务刷新后串到主画布同 id 节点 | 已修 | 画布文档作用域（`current-canvas-doc`）+ 本地版不从共享 Y.Doc 播种 + 预览/任务按 `canvasDocId:nodeId` + 续接记录带 `canvasId` |
| 2. 点击下载视频没有任何反应 | 已修 | 统一 `downloadAsset`：按 storageKey 读磁盘/CAS 后触发下载，失败明确提示；生成后 storageKey 写回节点 |
| 3. 引导数据导出 + 导演台引导槽 + ComfyUI API | 已实现 | 资产 `data.guide` / 片段 `guide` 槽（不占 9 图）/ 下载视频+引导 / 发送引导 / `guide_id` + `use_prev_guide` 语义 / 插件 `prev_guide_path` |
| 用户追加：衔接 UI 改链接/断链图标、点击切换 | 已改 | 时间轴交界常显开关：绿链接 / 红断链，点击直接切换 |
| 用户追加：预览组胶囊「另存画布」+ 文案简化 | 已改 | 预览组也渲染入口；文案统一「另存画布」/「已另存为画布副本「title」」 |
| 用户追加：历史「加入资产库」目标可选 + 只导出选中 | 已改 | 单卡/批量均下拉选择「本项目 / 公共资产」；导出共用同一文件，历史保留 |
| 用户追加：点击导演台片段右侧预览不播放 | 已改 | 点片段/缩略播放键 = 切段并自增起播令牌；源异步解析完成后再起播 |
| 用户追加：导演台版本历史批量操作 | 已改 | 版本记录支持多选、全选/取消、批量删除（二次确认） |
| 用户追加：资产删除误删历史视频 | 已修 | 删除前为仍引用同一 CAS 的存活记录补挂 ref；无 ref 的存量记录不会再被删文件 |
| 用户追加：引导下载按钮看不到 | 已改 | 「含引导」角标本身可点（下载视频+引导）；菜单保留两项；存量按 jobId 回查 guide |
| 用户追加：Qwen Image 2.1 图像编辑工作流接入（画布 + 图片编辑 + 剧本遮罩） | 已实现 | 新增 `qwen_image_edit` kind + 图生图/遮罩/文生图三模板；画布图片节点可选 QwenImage2.1；局部遮罩真实提交；详见 `2026-11-07-qwen-image-edit-integration.md` |

## 仍需人工做

1. 按 `2026-11-07-guide-and-ui-notes.md` 第六节做生成/下载/导演台/子画布实操验收（ComfyUI 已重启，API smoke 已过）。

## 工具链快照

- 前端：`pnpm typecheck` 通过；`vitest run` = 137 passed / 2 skipped（1311 passed / 10 skipped）。
- 插件：`python -m py_compile` 通过（`__init__.py` / `ref_video.py` / `engine/plan.py` / `engine/segment_continuity.py`）。
- ComfyUI：已重启并加载新插件；`/zeroexo/v1/health` 正常，capabilities 含 `guide_id`；显式 guide 校验链路 smoke 通过
  （非法 id 400 / 不存在 404 / 合法 id 回传 `guideSource=explicit` 且 `use_prev_guide=false`）。
- MCP：`http://127.0.0.1:8787/mcp`。
