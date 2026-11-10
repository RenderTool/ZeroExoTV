---
编号: S-18
状态: merged
创建: 2026-11-10
来源: 验收反馈
归属: 独立热修（5 项分模块）
---

# 画布视频生成验收反馈 5 项

## 一、需求 / 问题描述

用户原话（2026-11-10）：

1. 「另外节点中生成时也该有采样预览进度！！」
2. 「下载视频和引导时也该打包下载！多文件有时候会触发浏览器限制」
3. 「另外画布中现在点击生成好的视频后一键同款没有任何反应！」
4. 「测试中我无法点击 [参考图尺寸下拉列表] 这个下拉列表！点击后会自动收纳！！」
5. 「实际测试画布中生成的视频一直是 1:1 即便我选择了其他比例！」

## 二、背景与现状

| # | 现象 | 定位到的根因 |
|---|---|---|
| 1 | 画布节点生成时只有静态预览帧、无步数进度 | 插件 `engine/progress.py` 已上报 `minimax_director_progress` / `minimax_director_preview`（带 step/total_steps）；前端 `comfyui-ws-client.ts` 已解析，但 `local-minimax-video.ts:153` 用 `if (!frame.image) return` 丢弃纯进度帧，且建 socket 时只传 `onFrame`；轮询 `/jobs/{id}` 也不含 progress 字段。导演台已有 `livePreview` badge 可参考 |
| 2 | 「下载视频 + 引导」连续触发两次 a.click | `use-editor-interactions/helpers.ts:106-112`、`use-asset-library.tsx:807-818`、`canvas-assets/store.ts:473-484` 均为双 anchor；`download-stack-cards.ts` 用 350ms 错峰规避浏览器多文件拦截。项目已有 `downloadAssetsAsZip`（`download-asset.ts:102-122`，JSZip），但 `resolveAssetFile` 不含 guide |
| 3 | 一键同款点了只弹「成功」、什么都没复制 | `use-ai-generation.ts:handleReplayGeneration` 依赖云端 `GET /ai/generations/:id`，本地版 `api-client.ts:184-190` 恒返回空；且本机 H3 的 `generationId` 是 ComfyUI jobId，永不命中；函数也从不读本机参数落点 `node.data.paramValues` |
| 4 | 参数浮层内「参考图尺寸」下拉点击即整个浮层收起 | `settings-popover-shell.tsx:50-54,79` 自建浮层用 window 捕获阶段 `pointerdown` 关面板；antd 全局 `getPopupContainer={() => document.body}`（antd-theme-provider.tsx:91）使下拉成为 body 下兄弟 portal，不在 `panelRef` 内。导演台用 antd Popover 故正常 |
| 5 | 画布生成视频恒 1:1（真实像素，非 CSS） | `use-agent-bridge.ts` 视频分支传 `sizeStr='1024x1024'`，`buildTemplateParams()` 用 `nodeData.width/height ?? 1024` 且不带 `aspect/scaleFactor`；H3 面板只写 `node.data.paramValues`，无人读取 → `local-minimax-video.ts` 走 `parseSize('1024x1024')` → 请求 width=height=1024 → 节点 Resize 成正方形。导演台链路正常 |

## 三、归属分析

- **类型**：3 项 bug 遗漏（#3/#4/#5）+ 2 项功能强化（#1/#2）。
- **关联 Plan**：无。五条都落在「画布本机 H3 视频生成」同一条链路上，虽跨前端 / 插件协议 / 下载工具多个模块，但无阶段性决策点，按「独立热修、分项提交」处理，不新建 C-NN Plan。
- **倾向性结论**：#5 优先（数据错误，直接产出废品）；其次 #4（阻塞参数配置）、#3（功能失效）；再补 #1（进度反馈）、#2（打包下载）。#1 不动插件 HTTP 协议，仅透传既有 WS 进度；#2 复用已有 JSZip 能力，不新增依赖。

## 四、影响面预估

- 前端：`use-agent-bridge.ts`、`interactions/ai-generation.ts`、`use-ai-generation.ts`、`local-minimax-video.ts`、`settings-popover-shell.tsx`、`generating-preview-store.ts`、`base-node-view.tsx` / `video-node-view.tsx`、`download-asset.ts`、`helpers.ts`、资产库与画布资产 store。
- 插件：不改 Python（progress 上报已完备）。
- 文档：本征集、`specs/mcp-e2e-guide/spec.md` 的 job/下载口径、`docs/2026-11-07-guide-and-ui-notes.md` 下载记录、`suggestion-board/README.md` 索引。
- 测试：新增/更新「视频分支参数透传」「浮层内下拉不收起」「一键同款」「zip 含 guide」「进度透传」相关单测；`pnpm typecheck` + 前端全量 vitest + MCP 全量 vitest。

## 五、处理结果

- 归属：独立热修（5 项，同一条画布本机 H3 视频链路），不新建 C-NN Plan。
- 结果摘要：
  1. **采样预览进度**：插件已有 `minimax_director_preview/progress` 上报，前端不再丢弃无图进度帧；`generating-preview-store` 增 `progressByNode`（帧步数与阶段进度合并写入），`AIStateView` 的 loading 分支渲染进度条与步数文案。未改插件 HTTP 协议。
  2. **打包下载**：`download-asset.ts` 新增 `downloadFilesAsZip` / `downloadAssetWithGuide`，「视频+引导」由连续两次 a.click 改为一次 zip；批量 `downloadAssetsAsZip` 也把每项 `data.guide` 入包；画布节点右键、素材库、画布资产三处调用方统一。引导取不到时退回单文件下载，不丢视频。
  3. **一键同款**：本机视频改读 `node.data.paramValues` 参数快照（不再查恒为空的云端 `/ai/generations/:id`），新节点写回 `paramValues` / `model` / `prompt` 并复刻上游连线；云端记录为空时也给出明确提示而非空节点 + 成功。
  4. **参数浮层下拉**：`SettingsPopoverShell` 的 outside / scroll / wheel / touchmove 判定统一豁免 antd 挂到 body 的下拉浮层（`.ant-select-dropdown` 等），点击选项不再收起面板。
  5. **输出比例恒 1:1**：`useAgentBridgeHooks` 视频分支新增 `resolveLocalVideoRequest()`，合并 `paramValues` 的 `aspect` / `scaleFactor` / `size` / `steps` / `seconds`，消除 `buildTemplateParams` 的 1024×1024 兜底造成的真实正方形产物。
- 验证：`pnpm typecheck` 0 错误；前端全量 vitest 1325 passed / 0 failed / 10 pending；新增/更新 5 个回归测试文件共 21 例全通过（参数透传、同款、浮层豁免、zip 打包、进度状态与进度条渲染）。浏览器实测（进度条、下拉、同款、比例、zip 落盘）待用户确认。
- 横向巡检候选（本次未改码）：`download-stack-cards.ts` 仍用 350ms 错峰逐个下载；`interactions/ai-generation.ts` 是无调用方的旧链路，仍把对象当 `size` 传。
