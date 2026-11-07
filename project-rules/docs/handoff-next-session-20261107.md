# 交接：下一会话待办（2026-11-07 收尾）

本次会话已收尾，工作区干净。前端 `tsc` 干净、全量 1238 项测试通过（10 项为已禁用的 CAS 自愈旧用例跳过）；MCP 65 项通过；ComfyUI 插件 `ComfyUI_ZeroExoNodes` 运行中，健康接口署名 `H3ZeroExo`。

## 待办 1：子画布生成任务刷新后串到主画布同节点

现象：在子画布发起的视频生成任务，刷新页面后错误地出现在主画布的同 id 节点上。

排查方向：
- 生成任务的前端跟踪状态是否只按 `nodeId` 做键、没有带 `canvasId`：
  - `src/pages/editor/editor-canvas/interactions/local-minimax-video.ts` 的 `activeLocalJobs`（目前 key = nodeId）
  - `packages/plugins/nodes/src/generating-preview-store.ts` 的 `byNode`（目前 key = nodeId）
  - `src/features/canvas-tabs/use-director-run.ts` 的秒级预览/段状态回写
- 画布副本与主画布可能复用相同节点 id（复制画布时 id 不变）→ 任何全局按 nodeId 的映射都会串台。需要把键改为 `canvasId + nodeId`，或把 job 归属画布 id 一起持久化，回写前校验当前画布。
- 刷新后自愈路径：`workbench-stale-generating.ts` / 节点 `data.status='loading'` 的恢复逻辑也可能按 nodeId 误命中。
- 验收：主画布与子画布各有一个同 id 视频节点，在子画布发起任务，刷新后主画布对应节点不得出现 loading/预览/错误。

## 待办 2：点击下载视频没有任何反应

排查方向：
- 资产卡/历史卡的下载动作（`download` 菜单项）最终如何取 URL：
  - `src/features/asset-library/cards/asset-card.tsx`
  - `src/features/canvas-assets/groups/HistoryGroup.tsx`
  - 资产 `data.url` 对生成产物为空，只有 `storageKey`（`cas:` / `video:`），需要异步 `resolveMediaUrl` 后再触发 `<a download>`。
- blob URL 是否在点击前被 revoke；`<a>` 是否挂到 DOM、`download` 属性是否被浏览器忽略（跨域 URL 只能打开不能下载）。
- 验收：历史/素材/画布节点三处下载视频都有真实文件落盘（本地文件选择器或浏览器下载）。

## 待办 3：引导数据（guide）导出与导演台插槽语义（含 ComfyUI API 适配）

需求：
1. 通过我们方法生成的视频必须**带引导数据**，并在本地下载时提供选项：只导出视频 / 导出视频+引导数据（引导数据单独文件，`.safetensors` 或约定格式）。
2. 发送到导演台时让用户选择：发送视频本身，还是发送引导数据。
3. 引导数据**不占 9 张参考图槽位数量，但要插入插槽**（独立槽位类型）。
4. 引导数据必须有**特殊标识**（角标/类型），与普通图片/视频区分。
5. 每个片段**至多一个引导槽**；再次发送引导数据只替换该槽内容。
6. 如果当前片段已有引导槽数据，**不得再用上一段生成的引导数据**作为本段引导（覆盖 `use_prev_guide`）。
7. 以上需要 ComfyUI 插件 API 层面适配（不是只改前端）。

现有相关位置：
- 插件：`D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI_ZeroExoNodes`
  - `ref_video.py`：`reference_image` / `reference_images`、`guide_frames`、`use_prev_guide`、`guide_path`
  - `__init__.py`：`/zeroexo/v1/jobs` 参数、guide 落盘 `output/zeroexo/guides/gd_*.safetensors`
  - `templates/reference_video.json`
- 桥接（同插件内 `bridge/`）：`/zeroexo/h3/run` 的 timeline、`guide` 机制、`use_prev_guide`
- 前端：
  - `src/features/canvas-tabs/use-director-run.ts`（逐段落库、guide 元数据）
  - `src/features/canvas-tabs/director-pack-builder.ts` / `director-protocol-map.ts`（参考槽位、use_prev_guide）
  - `src/features/canvas-nodes/storyboard/`（槽位 UI、素材发送、导轨卡片）
  - `src/features/canvas-tabs/zeroexo-jobs-client.ts`（job 参数）

验收：
- 生成完成后可在节点/资产处选择「导出视频」或「导出视频+引导」；
- 发送到导演台时可选「发送视频」/「发送引导数据」；
- 引导槽有专属类型与标识，每片段最多一个，重复发送是替换；
- 片段存在引导槽时，运行参数不再使用上一段 guide（API 侧 `use_prev_guide=false`，且优先显式 guide 路径）；
- 对应前端单测 + 插件 smoke（提交作业验证参数）通过。

## 备注

- ComfyUI 插件目录不在本 git 仓库内，改动不随前端提交；改完需重启 ComfyUI。
- MCP 服务地址 `http://127.0.0.1:8787/mcp`，token `zxp_e2e_smoke_token`。
