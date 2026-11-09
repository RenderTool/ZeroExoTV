# 2026-11-07 完工记录：子画布任务串台 / 下载 / 引导数据 / 衔接 UI

> 对应上一份交接 `docs/handoff-next-session-20261107.md` 的三项待办，以及用户同日追加的 UI 指令。
> 前端：`pnpm typecheck` 通过；全量 `vitest run` = 137 passed / 2 skipped（1311 passed / 10 skipped）。
> 插件：`python -m py_compile` 通过；ComfyUI 已重启加载新代码，`guide_id` API smoke 通过（见第六节）。

## 一、子画布生成任务刷新后串到主画布同 id 节点（已修）

根因：画布 Yjs 文档是**项目级** `canvas:<projectId>`，主画布与副本共用；副本内容会被推进
Y.Doc，刷新后 `seedFromYDoc` 又把它当主画布播种。任何按 `nodeId` 的全局映射（本机任务、
生成中预览）也没有画布文档维度。

修复：
- 新增 `src/shared/current-canvas-doc.ts`（当前画布文档 id 单一来源，`main` / `sc…`）；
  `use-canvas-document-switch` 在换图前写入目标文档 id，离开页面复位 main。
- 本地版（无 token）**不再从 Y.Doc 播种**（`use-editor-state`），只认 PersistencePlugin 快照；
  本地快照路径会把正确的图重新推进 Y.Doc，顺带修复历史污染。
- 副本文档期间：禁止 Yjs 推送、忽略远端播种（副本走 `canvas-store` 文件落盘）。
- `local-minimax-video` 的 `activeLocalJobs`、`generating-preview-store` 全部改为
  `canvasDocId:nodeId` 键；生成发起时固化文档 id，回写前校验当前文档。
- 导演台刷新续接记录增加 `canvasId`：子画布任务在主画布不续接，回到发起文档才续接。

## 二、点击下载视频没有任何反应（已修）

根因：生成产物的 `data.url` / `data.dataUrl` 为空，真实文件只在 `storageKey`
（`image:` / `video:` / `audio:` / `cas:`）；旧实现用 `getResourceUrl(storageKey)`（只认后端
`resources/`）→ undefined → 静默 return。

修复：
- `download-asset.ts` 重写为唯一实现：按 `storageKey` 直接读磁盘/CAS → 生成 Blob → `<a download>`；
  读不到回退 dataUrl/url（忽略死的 `blob:`）→ 返回 `false` 让调用方明确报错。
- 素材卡 / 历史卡 / 画布节点三处统一调用（历史卡失败给可读提示，不再静默）。
- 生成完成后把 CAS `storageKey` 写回节点 `data.storageKey`，刷新后仍可重新解析/下载视频。

## 三、引导数据（guide）导出与导演台引导槽（已实现）

### 数据契约
- 生成产物资产：`data.guide = { id, path?, frames?, sha256? }`（仅视频）。
- 片段引导槽：`WorkbenchShot.guide = { id, title?, frames?, sha256?, fromAssetId?, createdAt? }`；
  **独立字段**，不进 `assignAssetSlots` 的 9 图 / 3 音 / 3 视编号空间；每段至多一个，重复发送即替换。
- 片段产物自带引导：`WorkbenchShot.media.guide`（供再次导出/发送）。

### 前端
- 视频节点 / 导演台都会把插件返回的 guide 元数据落库。
- 下载：素材卡菜单、历史卡下载菜单、画布节点右键均提供「下载视频」/「下载视频+引导」；
  引导文件按 `gd_xxx` → ComfyUI `output/zeroexo/guides/gd_xxx.safetensors` 经 `/view` 取回，
  以 `.safetensors` 单独落盘（`src/shared/utils/guide-file.ts`，id 白名单防路径穿越）。
- 发送到导演台：带 guide 的素材菜单新增「发送引导数据到导演台当前片段」；卡片导演台快捷按钮
  也会点开「发送视频 / 发送引导数据」二选一。宿主写入当前片段引导槽（`WORKBENCH_SET_GUIDE_EVENT`），
  重复发送覆盖，不占参考图槽位。
- 导演台槽位行渲染独立引导格（`Waypoints` 图标 + 「引导」角标 + 帧数，右上角 × 移除）。
- 运行参数（zeroexo 模式）：片段有引导槽 → `guide_id=<id>` 且 `use_prev_guide=false`；
  无引导槽才沿用段间引导开关。预检不再把「有引导槽」的段报衔接阻塞。
- 资产晋升公共库 / 节点保存到素材均保留 `guide` 字段。

### ComfyUI 插件（`ComfyUI_ZeroExoNodes`）
- `/zeroexo/v1/jobs` 参数新增 `guide_id`：只接受 `gd_xxx`，解析到 `output/zeroexo/guides/<id>.safetensors`；
  传了显式引导即强制 `params.use_prev_guide=false`。
- `use_prev_guide=true` 且无显式 guide → 取同 `project|episode` 上一段成功作业的 guide
  （服务端 `LAST_GUIDE` 登记表）。
- 作业状态回传 `guide`（id / path / frames / sha256）与 `guideSource`（explicit / prev / none）。
- `templates/reference_video.json` 与 `ref_video.py` 新增 `prev_guide_path` 输入；
  单段 r2v 也能把外部 guide 作为 motion context（`plan.external_guide_frames`，
  `is_continuity_active` / `resolve_prev_segment_output` 支持首段）。
- **guide 帧改为取生成结果的尾部帧**（原取头部）：下一段接续的是尾帧运动；取头部会接错运动。

## 四、衔接 UI（用户 2026-11-07 追加指令，已改）

- 导演台时间轴每个交界常显一枚开关（34×22 深色胶囊）：
  - 开启 = 绿色链接图标（`Link2`）、title「断开衔接」；
  - 断开 = 红色断链图标（`Link2Off`）、title「开启衔接」。
- **点击图标本身**即切换衔接：链接模式内写草稿（完成落盘），模式外立即写持久值。
- 段 1 无前序，恒不渲染；`data-continuity-arrow` 保留，新增 `data-continuity-on` 供测试/样式。

## 五、预览组胶囊「另存画布」+ 文案简化（用户 2026-11-07 追加指令，已改）

- `node-capsule-toolbar` 的入口条件补上 `isPreview` → 预览组胶囊也显示「另存画布」入口。
- 按钮**纯图标**（与胶囊其他工具一致，禁止在按钮里加可见文字；语义只放 title/aria-label）；文案统一简化：
  - 菜单/工具 title：`另存画布` / `把选中内容另存为画布副本`；
  - 成功提示：`已另存为画布副本「{{title}}」`（去掉节点数等冗余信息）。

## 六、人工验证 / 后续

1. ~~重启 ComfyUI~~ 已重启（健康接口正常；capabilities 已含 `guide_id`）。
   - 服务器侧 smoke：非法 `guide_id`（`../evil`）→ 400；不存在 `gd_doesnotexist` → 404；
   - 合法 guide + `use_prev_guide=true` + 故意非法 width → 作业被 ComfyUI 校验拒绝，
     但状态回传 `guideSource=explicit`、`guideInPath` 指向 guides 文件、`params.use_prev_guide=false`
     （证明显式引导覆盖上一段引导；未真实出片）。
2. 本机生成一段视频 → 检查作业状态返回 `guide` 且节点/历史资产带「含引导」标识。
3. 资产/历史/节点三处下载：只视频、视频+引导都要有真实文件落盘。
4. 导演台：发送引导 → 该段出现引导格；再次发送覆盖；运行参数确认 `guide_id` + `use_prev_guide=false`。
5. 子画布验收：主/副本各放同 id 视频节点，副本发起生成并刷新 → 主画布同 id 节点不得出现
   loading / 预览 / 错误。
6. 用一段真实生成验证 guide 为**尾部帧**、下一段接续运动方向正确（本次只改了取帧位置，未跑真实生成）。

## 七、历史「加入资产库」改为目标可选 + 只导出选中（用户 2026-11-07 追加）

- 问题：历史「加入资产库」写死 `scope='library'`（只进公共库），且没有目标选择/多选边界。
- 修复：
  - `promoteAssetToScope(asset, 'project' | 'library')`：本项目素材写 `scope='project'` + 当前画布
    `projectId`；公共库写 `scope='library'`；同作用域同 CAS hash 已存在则跳过。
  - **历史导出目标由用户选「本项目 / 公共资产」**（2026-11-09 用户翻案）：单卡与批量都走下拉，
    不再写死公共库，也不自动落到本项目；导出为复制引用（共用同一文件），历史记录保留。
  - 历史卡片「加入资产库」下拉两项；批量条默认 0 项、可全选/取消全选，不会把同批视频全部导出。
  - 文案：`加入资产库` / `加入本项目` / `加入公共资产`；已存在给明确提示。
  - 存量迁移修正：无 `scope` 但有 `projectId` 的生成产物按 **本项目** 迁移（原一律归公共库，
    会把项目视频全部显示到公共位置）；无 `scope` 且无 `projectId` 才归公共库。

## 八、点击导演台片段 → 右侧预览自动播放（用户 2026-11-07 追加）

- 根因（第二层）：`/zeroexo/v1/jobs` 提交时没有把预览 `/ws` 的 `clientId` 透传给 ComfyUI，
  插件把 `minimax_director_preview` 发到主连接 → 右侧预览永远收不到帧；片段卡片左上还叠了
  引导缩略小图，看起来像「生成预览」。
- 修复：`submitZeroexoJob` 增加 `clientId: previewClientId`；去掉时间轴卡片上的引导缩略层；
  生成中不再用上一版成片占住预览区（`videoStorageKey` 置空），右侧优先收到实时帧/骨架，完成后显示新产物。
- 点击片段/缩略播放键 = 切段 + 自增起播令牌；源异步解析完成后再起播。

## 九、导演台版本历史批量操作（用户 2026-11-07 追加）

- 版本记录弹层新增多选：全选/取消全选 + 已选计数 + `批量删除`（二次确认，只删勾选快照，
  当前内容不动）；删除后列表与计数即时刷新，部分失败给合并提示。

## 十、资产删除误删历史视频 / 引导下载入口（用户 2026-11-07 追加）

- 严重 bug：在资产库删除一条资产会把仍在历史中使用的视频产物一起删掉。
  根因是 CAS 引用登记不完整（存量记录可能只有 `storageKey=cas:...` 而没有 `cas` 字段/ref），
  删除时 `releaseCas` 把 refCount 降到 0 → 物理文件被删。
  修复：`removeAssets` 在释放被删记录前，先为仍引用同一 CAS 内容的存活记录**补挂 ref**（幂等），
  再 release；任何一条存活记录引用该内容时文件都不会被删。
- 引导下载入口：
  - 资产卡/历史卡的「含引导」角标本身改为可点击的下载按钮（title = 下载视频+引导）；
  - 卡片「更多」/下载菜单仍保留「下载视频」/「下载视频+引导」两项；
  - `getGuideMeta` 统一兼容 `data.guide` 与旧的 `data.generation.guide`。
  - 存量产物（本次改动前生成）若记录里没有 guide：点下载会按 `generation.jobId` 向本机 ComfyUI
    再查一次作业，取到后回写资产记录；作业已被清理则提示「该视频没有引导数据」。
- 存量资产如果没有 guide 元数据（本次改动前生成的），不会凭空出现引导下载；需重新生成一次。

## 十一、画布视频节点实时预览 / 卡片操作按钮归位（用户 2026-11-07 追加）

- 画布视频节点生成中看不到预览帧：`video-node-view` 只有 `contentOnly` 分支把 `generatingPreview`
  传给 `AIStateView`，普通节点分支漏传。已补 `previewImage={status==='loading' ? generatingPreview : undefined}`，
  并加 `AIStateView` 回归测试（loading 渲染 `data-generating-preview`，idle 不渲染）。
- 卡片操作按钮统一到封面右下角（黑色 28×28，与历史卡同位）：
  - 资产卡（公共/本项目）：编辑、发送画布、发送导演台、更多（下载/重命名/删除）全部移入封面右下角；
  - 开源库卡：发送画布 / 发送导演台移入封面右下角；
  - 标题行只留标题与标签，不再挂操作按钮。

## 十二、导演台正式视频解析（用户 2026-11-07 追加）

- 报错 `.lf/zeroexo/media_files/video%3A...`：导演台成片/首帧用 `platform/media` 写**磁盘**
  （`video:assets/...`），但 `useHydratedContent` 走 persistence 的 localforage `media_files` 桶，
  两边存储不是同一个地方 → 正式视频永远「文件不存在」。
- 修复：persistence 新增 `setExternalMediaBlobResolver`，应用启动时注册 `platform/media.getMediaBlob`；
  `resolveMediaUrl` / `getMediaBlob` 先读磁盘，未命中再回退 localforage（兼容旧数据）。
  这样生成完成后右侧预览能解析出正式视频，刷新后也能按 `video:assets/...` 重新读到。
- 时间轴实时帧仍走 `/ws`；完成后 `videoStageProps` 用 `selectedShot.media.storageKey` 显示正式视频。

## 十三、本项目资产与生成历史彻底分离（用户 2026-11-07 追加）

- 口径：**本项目资产 = 用户导入 / 手动存入**；API 生成的图片/视频只属于「历史」。
- 修复：`filterAssetsByScope` / `filterAssetsStrictScope` 的项目段排除 `data.origin='generation'`；
  `countAssetsByScope.project` 同步排除。历史仍按 `origin='generation'` + projectId 查。
- 结果：生成的视频/图片不再出现在「本项目资产」，也就不会在删除本项目资产时被一起删掉；
  删除本项目里的手动视频只释放它自己的引用，历史记录/文件由 CAS 引用保护。
- 注意：历史记录仍带 projectId（用于按项目归档历史），但不再参与本项目资产列表/计数/删除。

## 十四、Qwen 参数面板重排（用户 2026-11-07 追加：界面毫无美感）

- 旧问题：比例 chip 换行、标签与数字输入不对齐、分段无线索、面板像零碎表单。
- 新排版（三段式，面板宽 360）：
  1. **画面尺寸**：有参考图时先用开关「跟随原图」；关闭后用 5 个等宽比例 pill（1:1 / 4:3 / 3:4 / 16:9 / 9:16，单行不换行）
     + 「自定义」宽高两个等宽方角输入；
  2. **提示词**：`SwitchRow` 开关「优化提示词」；
  3. **高级**：步数 / 贴合度 / 修改幅度 / 随机种子四行统一 72px 标签 + 100px 输入 + 右侧辅助说明，垂直间距一致。
- 分隔线使用 `theme.toolbar.border`；不再出现技术术语和重复说明。

## 十五、引导数据 = 视频附带资产（用户 2026-11-09 追加）

- 口径：引导不是独立素材，而是某个片段视频的附带数据；名称必须与来源视频一致，预览用来源视频首帧，
  只额外加「引导」符号/角标。禁止用「引导数据」当名称，禁止通用图标代替视频预览。
- 修复：
  - `WorkbenchShotGuide` 增加 `storageKey/url`；发送/选择引导时一并写入来源视频媒体键。
  - **不再有「引导候选列表 / 引导页签」**：引导变成视频槽的下拉变体。视频槽左下角 chevron →
    「使用源视频 / 使用引导」；选引导时同一槽转为 `shot.guide`（源视频不再占第二个参考槽），
    选源视频时恢复为视频引用。
  - 所有槽位左上角补素材类型标签：视频 / 图片 / 音频；引导槽标签为「引导」。引导槽预览仍是
    来源视频首帧 + 引导角标 + 帧数，hover 显示视频预览与来源视频标题。
  - 历史视频卡 hover 右下角「发送到导演台」按钮（Clapperboard）：下拉选择「发送源视频 / 发送引导」；
    无引导时引导项置灰，按钮本身不再消失。
  - 导演台「项目资产」候选排除 `origin='generation'` 的产物，MCP 生成视频不再混进项目资产。
  - MCP `sync_job_results` 的新历史资产标题从 `MCP 生成 · <shotId>` 改为与片段同名：`片段 N · Ns`。

## 十六、出片显存策略自动判定 + 连接机器信息（用户 2026-11-09 追加）

- 口径：低显存/高显存是**服务层决策**，不是客户参数；连接面板只做透明展示 + 手动兜底。
- 自动：
  - 连接测试时读 `/system_stats`，保存 GPU 名称 / 总显存 / 空闲显存 / 内存 / ComfyUI 版本；
  - 导演台出片、画布视频节点、MCP `run_generation` 在提交前确保机器信息，按总显存 < 16GiB
    自动传 `use_low_vram=true`，否则 `false`；读不到显存时**保守走低显存**。
- 手动兜底（ComfyUI 连接面板）：
  - 显示连接机器：GPU、显存（总/空闲）、内存、ComfyUI 版本；
  - 「显存策略」下拉：自动 / 低显存 / 高显存；持久化到 endpoint prefs；
  - 选高显存且检测到 <16GB 时给红色风险提示「可能 OOM，后果自负」。
- 参数链路：`ZeroexoJobParams.use_low_vram` 已补齐；导演/画布/MCP 三处都会传。

## 十七、Qwen 2K / 比例 / 局部编辑 / 透明 PNG（用户 2026-11-09 追加）

- 官方依据（ComfyUI Qwen-Image-2.1 教程）：
  - 原生 2K：最长边 2048，最大 2048×2048（约 4MP）；超过 2K 会降低提示词遵循度。
  - 图像编辑的画布由 `image_1` 尺寸/`resolution` 预算决定；自定义尺寸用分辨率选择器。
  - 局部编辑不是 latent mask：在 `image_1` 上用 Paint Pen 标红区域，提示词点名红区；不是 `SetLatentNoiseMask`。
  - VAE 原生 4 通道，可直接输出透明 PNG（Alpha）。
- 修复：
  - 新增 `qwen-limits`：UI/本地作业统一夹最长边 2048、总像素 4MP；超过 2K 的参考图按比例缩小。
  - 图生图比例按钮**始终显示**（之前跟随原图时被隐藏）；自定义宽高也夹 2K。
  - 遮罩模板重写：LoadImageMask → 红色标记烘焙进 image_1 → 生成 → ImageCompositeMasked 合成回原图；
    前端遮罩任务提示词限定红区并要求去掉标记。
  - 参数面板新增「透明背景（PNG Alpha）」；提示词追加 alpha 要求，保存仍为 PNG。
  - 图片编辑工具/标题「局部遮罩」改为「局部」。

## 十八、提示词库（只读预设）接入（用户 2026-11-09 追加）

- 数据来源：`zerovideoAgent` 的「角色三视图」资产提示词（16:9 / 21:9 两套），不采用线上公共提示词内容。
- 预设定为**只读**，不区分公共/私有；数据在 `src/features/prompt-library/presets.ts`，全前端共用。
- 新建/编辑：`prompt-store` 本机持久化（localStorage `zeroexo.promptLibrary`），用户可新建/编辑/删除
  自己的提示词；预设只读。图片节点下拉与抽屉同步出现用户提示词。
- 入口**只保留**：
  - 画布抽屉素材下方「提示词」分组（只读列表 + 复制）；
  - 图片节点参数旁「提示词库」下拉，选中后追加到当前提示词（空输入则直接填入）。
- 2026-11-09 用户指令：**移除主页「提示词」按钮与独立提示词页面**；不再有 `#/prompts` 路由/侧栏入口。
- 画布抽屉的「开源库」恢复为素材分组内的 Tab（公共 / 本项目 / 主体 / 开源库），不是独立侧栏按钮、不跳页。
