# 下一会话交接：线上地址、云 ComfyUI 与待办

## 0. 当前状态

- 远端仓库：`git@github.com:RenderTool/ZeroExoTV.git`
- 远端 `main` 最后提交：`851fbfb fix: default 8 steps and only mark selected segments generating`
- 本地还有未提交改动，接手前先看 `git status`，不要回滚用户改动。
- 本地网页服务、MCP、ComfyUI 可能已被关闭；先确认端口，不要假设在线。

## 1. 线上地址

### 前端

- GitHub Pages：`https://rendertool.github.io/ZeroExoTV/`
- 仓库：`https://github.com/RenderTool/ZeroExoTV`
- 未来计划子域名（尚未配置）：`https://zeroexo.renderdoc.space/`
  - 配自定义域名时，`.github/workflows/deploy-pages.yml` 的 `VITE_BASE_PATH` 要改成 `/`
  - `public/CNAME` 写入子域名
  - DNS CNAME 指向 `rendertool.github.io`

### 云 ComfyUI（AI Gate）

- 公网 HTTP：`https://7779e24a624143fa843ca42b9179505f.region1.waas.aigate.cc`
- 已验证：
  - `/system_stats` 200
  - `/zeroexo/h3/health` 200
  - `/zeroexo/v1/health` 200
  - 云端 CORS / `Access-Control-Allow-Private-Network` 正常
  - 导演台已有 2 段任务成功
- SSH 网关：`3591c27f57fe4b98a0b773bf93783106.region1.waas.aigate.cc:45754`，用户 `root`
  - 密码在 AI Gate 控制台获取，**不要写入仓库**
- 规格：A10G 24GB，ComfyUI 0.42.0
- 云端 ComfyUI 路径：`/root/comfyui/ComfyUI`
- 插件路径：`/root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes`
- 重启：`bash /etc/waas-script/restart_comfyui.sh`
- 日志：`/var/log/waas/comfyui.log`
- 云端模型以官方版为主，例如：
  - `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`
  - `qwen3vl_32b_minimax_h3_int8_convrot.safetensors`
  - `minimax_h3_video_vae_int8_convrot.safetensors`
  - `minimax_h3_audio_vae_fp32.safetensors`
- 已修复：模板默认模型在云端缺失时，插件从实际模型列表回退；不要再写死本地 `ultra_uncensored_heretic`。

### 本地

- 前端开发：`http://localhost:5180`
- 本地 ComfyUI：`http://127.0.0.1:8188`
- MCP：`http://127.0.0.1:8787/mcp`
- 文件服务：`http://127.0.0.1:8790`

## 2. A–G 需求（全部完成，2026-11-10；实现要点见下与 §3）

### A. 孤立资源即时清理（已完成；2026-11-11 改口径：回收站下线）

- 用户明确删除 = 立即删（`releaseCas` 引用到 0 就删文件），不再缓存。
- 数据层 `src/entities/orphan-media.ts`：`purgeOrphanMedia()` 直接删「0 引用 CAS 条目 + `media/cas` 索引外文件 +
  旧 `media/recycle` 目录」，有引用的一律不动；删除失败时不摘索引，避免断链。
- 定时：`app.tsx` 每天最多跑一次（`zeroexo:orphan-media:lastRun`），失败静默（未授权/离线下次再试）。
- 列表过滤：`filterLiveAssets()` 隐藏文件已失效的资产，死记录不再出现在「资产 → 项目/全局」。

### B. 画布节点胶囊常驻下载（已完成，见 §3）

图片 / 视频 / 音频节点胶囊都常驻「下载」按钮（`createDownloadTool`，紧跟「详情」之后），
点击经 `eventBus.emit('node:download')` 交 app 层 `downloadNodeAsFile`（`getMediaBlob` + 引导打包）。

### C. 主体历史图片永久删除（已完成，见 §3）

历史缩略图右上角有删除按钮（`data-media-history-delete`），`Modal.confirm` 二次确认并写明「文件不可恢复」；
删除走 `deleteSubjectHistoryMedia`：移除条目 + `releaseCas` 释放引用（不是只从数组抹掉）+ 封面回退到当前槽位图片或下一条可用图片。

### D. 视频尺寸

用户已自行解决，不要重复改算法。  
保留现有尺寸参数逻辑，避免覆盖用户改动。

### E. 主体发送到画布（已完成，见 §3）

- 主体详情页头「发送到画布」→ `buildSubjectStackNodeData` 把该主体**各状态当前媒体**（图片/视频/音频）映射成堆叠卡片，
  在视口中心建 `stacked-media` 节点，`data.subject = { rootId, name }` 标记语义（标题 = 主体名）。
  预览/切换/保存全部复用堆叠框架，没有第二套实现。
- 点节点里的卡片（底部缩略导航）→ `canvas:subject:open` → 切回主体库并定位到该主体/状态（走既有
  `NAVIGATE_FOCUS_SUBJECT_EVENT` 通道）。
- 音频已补：小卡片用音符图标，主视图给原生 `<audio controls>`（`StackAudioContent`，按 storageKey 解析）。
- 历史图（`mediaHistory`）不参与发送，只发当前槽位资产。

### F. Krea2 文生图（已完成，见 §3；云端与本机插件均已部署）

- 实现口径：不新造节点类型，按项目既有「本机/线上伪模型」惯例做成图片节点的模型选项 `Krea2`（`zeroexo:krea2`），
  只在**非本机地址**（`isLocalComfyuiAddress` 为 false）时出现在模型下拉里；本机模式完全不可见。
- 参数：比例 + 百万像素（默认 3MP）+ 32 对齐（`resolveKrea2Size`），默认 10 步、cfg 1、eta 0.55；不支持参考图。
- 插件侧新增 `templates/krea2_t2i.json`（UNET krea2 → CLIP krea2 → VAE qwen_image_vae → ClownsharKSampler_Beta → VAEDecode → SaveImage），
  作业 kind `krea2_t2i`，产物按 image 回传；不接 SeedVR2 / z_image 放大链。
- **云端已部署（2026-11-10）**：插件整目录同步到 `/root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes` 并重启；
  `/zeroexo/v1/health` 的 templates 已包含 `krea2_t2i`。⚠️ 备份目录**不能留在 `custom_nodes/` 里**（ComfyUI 会把
  `ComfyUI_ZeroExoNodes.bak-*` 也当插件加载，旧路由抢先注册，表现为「文件换了但 health 还是旧模板」）——备份放
  `/root/comfyui/plugin-backups/`。
- **云端实测通过（2026-11-10）**：`/zeroexo/v1/jobs`（kind=krea2_t2i，1024² / 10 步）→ `state=success`，
  产物 `zeroexo/e2e/krea2/krea2_00001_.png`（日光灯塔写实图）；last-prompt 复核 `use_low_vram=false` 时
  只有高显存链（`45:66` 开关与 45:58–45:61 已被剪掉，LoRA 直连 `45:1`）。
- **本机 ComfyUI 已同步（2026-11-10）**：`D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI_ZeroExoNodes`
  已覆盖 `__init__.py`、`engine/graph_ops.py`、`templates/krea2_t2i.json`、`templates/reference_video.json`（旧版还写死
  `ultra_uncensored_heretic` CLIP，已换成官方 `qwen3vl_32b_minimax_h3_int8_convrot`）。本机没有 krea2 底模，
  所以 Krea2 仍不会在本机模式的下拉里出现（按设计），模板同步只是保证协议/模板一致。
- 云端已核对：`krea2_turbo_bf16.safetensors` / `qwen3vl_4b_fp8_scaled.safetensors` / `qwen_image_vae.safetensors` 都在，
  `ClownsharKSampler_Beta`（RES4LYF）与 `ResolutionSelector` 节点可用。
- **云端实测通过（2026-11-10）**：把主链 workflow 直接 POST 到线上 `/prompt`（1024×1024 / 10 步 / seed 4242），
  `status=success`，产出 `zeroexo/test/krea2_cloudtest2_00001_.png`（1.04MB，1024×1024 写实人像），
  说明模板里的模型与采样器在线上都能跑；剩余只差把插件目录同步到云端（否则 `kind=krea2_t2i` 找不到模板）。

### H. 刷新后恢复预览与进度（已完成，见 §3）
用户要求：刷新页面后任务还在跑，预览帧和步进不能丢。

- 提交成功即把 `{ jobId, clientId, base, kind, model }` 写进节点 `data.localJob`（图片 Qwen/Krea2、视频 H3 都写）。
- 画布重开时扫描 `status=loading` + `localJob` 的节点，用**原 clientId** 重连 `/ws`（ComfyUI 按提交时的 sid 定向推送），
  预览/步进立刻续上；同时继续轮询作业，完成后把产物写回节点并落历史。作业已结束/被取消则清掉 `localJob`。
- 生成结束（成功/失败/中止）都会清 `localJob`，不会重复续接。

### G. 图片生成采样预览与步骤进度（已完成，见 §3）

画布图片节点（本机 `QwenImage2.1`）生成时已有采样预览帧与「采样 x / y」步进：提交带 `clientId` → `/ws` 收 ComfyUI 原生 `progress` + 二进制 `PREVIEW_IMAGE` → 写 `generating-preview-store` → 图片节点 `AIStateView` 渲染。

剩余可选项（不是阻塞）：图片编辑工作台的遮罩局部修改仍只有 `message.loading`，要进度就复用 `ComfyuiPreviewSocket`（`image-edit-workspace.tsx`）。

### I. 项目备份、画布滚轮、导演台片段操作（已完成，见 §3）

- **项目导出**：画布 LOGO 菜单「导出项目」（只读也可见）；主页项目卡菜单「导出项目」；走同一 `exportProjects([id], title)`。
- **项目导入**：主页工具栏「导入项目」（`.zip`）→ `importProjectsFromZip` → 刷新列表；与导出同一份 `projects.json` 格式。
- **画布滚轮 = 缩放**（以光标为中心）；Shift+滚轮水平平移；图片/视频节点内的内容缩放整体下线（滚轮不再被节点抢走）。
- **导演台片段操作**：镜头号旁箭头之外新增下拉直达任意片段；新增「与镜头 N 交换」；插入片段可选
  最前 / 选中之前 / 选中之后 / 最后（主按钮默认插到选中之后），不再一律追加到末尾。

## 3. 已知修复（不要回退）

- 导演台默认 8 步（视频 8 步；**图片 QwenImage2.1 是 25 步**，两套默认不要混用，常量在 `qwen-limits.ts:QWEN_DEFAULT_STEPS`）
- 未选中片段不再显示排队/生成中
- 历史批量删除（本地未提交）
- 主体媒体历史/封面跟随/画布来源过滤
- 提示词 contentEditable 空格不再透传画布
- 云端插件 CORS/PNA、1GB 上传上限、官方模型回退
- 图片节点「点两次才生成 / 首点 Failed to fetch」：空闲后 keep-alive 被网关静默关闭，浏览器只对 GET 透明重试、POST 不重试。
  现在提交前 `warmZeroexoConnection()` 预热连接，`/upload/image` 与作业状态 GET 各重试一次（`zeroexo-jobs-client.ts`）
- Qwen 有输入图时 `edit_prompt` 统一加「参考图1：」前缀（`buildQwenEditPrompt`），否则会退化成文生图
- 角色定妆提示词改为写死「固定 3 个画面（正面特写 + 正面全身 + 背面全身）」并禁止侧面/额外机位；
  已删除「三视图 / Lineup Sheet」这类诱导名字（`presets.ts`、`subject-prompt-templates.ts`、MCP `skills.ts` / `plan.ts`）
- MCP 当前项目识别：网页切项目时广播 `.lf/zeroexo/app_meta/current-project.json`；MCP 新增 `get_current_project`
  （source=open/recent），initialize 概览里也置顶提示；Agent 必须先报项目名问「是否操作这个项目」再动手
- 图片节点采样预览 + 步进：`local-qwen-image.ts` 带 `clientId` 建 `ComfyuiPreviewSocket`（同一 WS 客户端文件），
  解析 ComfyUI 原生 `progress` 文本与二进制 `PREVIEW_IMAGE`；图片节点 `AIStateView` 接 `previewImage` / `progress`
- 云端 AI Gate 是否代理 `wss://.../ws` 仍未验证（本地直连可用）；`--preview-method none` 时没有预览帧，但步数照常
- 胶囊常驻下载：`node-tools.tsx` 的 `createDownloadTool()` 装进图片/视频/音频工具集（位置统一在「详情」之后），
  app 侧 `use-editor-interactions.ts` 监听 `node:download` → `downloadNodeAsFile`（媒体二进制 / 引导 zip）
- 主体历史图永久删除：`deleteSubjectHistoryMedia()`（删除条目 + `releaseCas` + 封面回退），
  UI 在历史缩略图右上角（`data-media-history-delete`），`Modal.confirm` 说明文件不可恢复
- Krea2 文生图：图片节点模型选项 `zeroexo:krea2`（仅线上地址露出），`resolveKrea2Size` 比例+MP+32 对齐，
  默认 10 步；插件新增 `krea2_t2i` 模板与 kind，产物按 image 回传
- 刷新续接：节点 `data.localJob` 保存作业身份，重开画布用原 clientId 重连 `/ws` 续上预览/进度并继续轮询写回产物
- 项目导出/导入：画布 LOGO 菜单与主页项目卡都能导出当前/单个项目，主页工具栏可导入 zip（同一份格式）
- 画布滚轮缩放（光标为中心），Shift+滚轮横移；图片节点内容滚轮缩放已删除（滚轮归画布）
- 导演台：镜头号下拉直达、与镜头 N 交换、插入位置可选（最前/选中之前/选中之后/最后）
- 引导数据生效：含片段引导槽的运行强制走 `/zeroexo/v1/jobs`（桥接 timeline 无引导字段，会静默丢弃）
- 低显存链：插件提交前 `prune_model_chain` 删掉未选中的模型链；**线上仍待重新部署**
  （2026-11-10 云端探测：`use_low_vram=false` 时 last-prompt 里仍有 45:58–45:61 低显存链 → 两条链都执行）
- 孤立媒体即时清理（2026-11-11 改口径）：回收站整体下线；`purgeOrphanMedia()` 每日直接删除无引用文件，
  `filterLiveAssets()` 让失效资产不再出现在资产列表
- 主体发送到画布：`subject-stack-cards.ts` 映射主体各状态媒体 → 堆叠节点（`data.subject` 语义标记），
  卡片点击回跳主体库对应状态；堆叠框架补音频（音符缩略图 + `<audio controls>`）
- 云端插件已更新（2026-11-10，SSH）：`krea2_t2i` 上线并通过 `/zeroexo/v1/jobs` 跑通（1024² 出图），
  last-prompt 复核低显存链已被剪掉（`45:66` 与 45:58–45:61 不再出现在高显存作业里）
- 首次使用指引（2026-11-10 用户要求）：`features/onboarding/onboarding-guide.tsx`，三项先决条件
  （存储路径 / MCP 一键复制配置 / ComfyUI 插件+地址测试连接）；数据目录就绪后首启自动弹一次
  （`zeroexo:onboarding.seen`），主页底部常驻「使用指引」条（代替政策公告位）可再次打开
- 弱模型导入纪律（2026-11-10 事故后加）：MCP 新增只读 `preflight_import`（语言判定/分集标记/主体库与导演台现状 +
  必须逐条问用户的问题）；`import_script`、`split_script_to_shots` 真实写入必须 `userConfirmed:true`，
  英文/外部平台源还要 `sourceFormatConfirmed:true`，缺了直接 `CONFIRM_REQUIRED`
- 节点「发送」统一入口 + 右下角任务队列（2026-11-10）：胶囊与右键共用一个「发送」二级菜单
  （本项目资产 / 全局资产 / 另存为资产 / 发送到主体 / 另存为画布）；画布、导演台、图片编辑器任务统一进
  `task-queue-store`，右下角可收起面板展示排队与步数进度
- 导演台「问AI」（2026-11-10）：镜头头部复制按钮，复制 projectId + shotId + 段号 + 提示词 + 参考/引导/公共参数 +
  「我的修改建议」占位，Agent 用 get_current_project + get_workbench 即可定位
- 进度与复刻修正：Qwen 的 `progress.max=4096` 是 token 数，客户端按请求步数折算；本机 `zeroexo:*` 节点复刻改用节点参数快照
- MCP 更新感知：`server-info.json` 增加 `toolNames/builtAt/pid`，网页比对必需工具清单并在主页/使用指引/MCP 设置页提示重启
- Krea2 等纯文生图模型：生成面板不再渲染参考素材上传/槽位区，改为「不支持参考图」说明（`supportsReferenceInput`）
- 图片编辑器新增「涂抹」工具（2026-11-10）：画笔/橡皮/吸色器 + 原生取色器 + 色板 + 笔刷大小 + 撤销/清空，
  确认后合成 PNG 经 `applyPaint` 落成新图片节点（原节点不动）
- 剧本页滚轮修复（2026-11-10）：行 textarea 的 `onWheel` 不再只 stopPropagation，改为把 deltaY 转给
  `[data-script-scroll]`（光标停在文字上也能滚动页面）
- 导演台工具行右侧显示「总时长 mm:ss · N 段」（2026-11-10），数据 = 全部片段 duration 之和
- 延续法硬闸门（2026-11-11 事故后加）：`plan_continuity_edit` 计划（17k+5 段长 / 22 帧尾帧 / ≤736 帧）+
  `run_generation` 串行准入（`CONTINUITY_NOT_PLANNED` / `CONTINUITY_ORDER`）；说明与技能写明「照搬原稿段长/跳段/只做一半 = 不合格」
- MCP 自我更新感知（2026-11-11）：网页写 `.lf/zeroexo/app_meta/mcp-required.json`；旧版 MCP 工具返回自动带 `_mcpOutdated`；
  Agent 用 `mcp_update_status` 体检、`update_mcp_server`（需用户确认）git 快进 + 重编译，重启 MCP 后生效
- 下载/发送修正（2026-11-11）：胶囊下载对带引导的视频自动打 zip（取不到引导才退回单文件并提示）；
  引导地址回退链为「当前地址 → guide.baseUrl → localJob.base」；历史卡「发送到导演台」对图片/音频/视频全开放
- 「含引导」角标改为纯标签（`data-guide-badge`，不再带下载图标/点击）：下载只走 hover 菜单、右键菜单与胶囊
- 引导本地缓存（2026-11-11）：生成即下载到 `<数据根>/media/guides/gd_*.safetensors` 并写 `localKey`；
  `fetchGuideBlob` 优先读本地；MCP `sync_job_results` 回写前也缓存（云端清盘后仍可下载/发送）
- 视频尺寸档位（2026-11-11 按官方表纠正）：**系数 = 目标 MP**；官方 16:9 表 2.0 → 1920×1088（32 对齐，1080 非法），
  1.0 → 1376×768；前端与 MCP 共用同一公式
- 图片结果节点比例（2026-11-11）：生成完成用 `fitImageNodeSize` 同时重算宽高（长边 ≤320），
  修复 Krea2/Qwen 返回后节点停在旧比例、图片 contain 出黑边
- 图片尺寸口径（2026-11-11）：Krea2 的 1MP = 1024×1024（1024²，不是 1e6）；1MP 1:1 → 1024×1024
- @ 提及弹层：portal 到 body + fixed + z-index 4000，避免被 dock/节点盖住；参考槽缩略图补内联内容回退
- 历史卡片：MasonryGrid 瀑布流 + 真实宽高比 + `object-fit: contain`，不再固定 16:9 裁图
- 提交作业：网络层 Failed to fetch 自动重试 2 次（同一 clientJobId），首点不再必失败
- 历史去重（2026-11-11）：`autoLandGenerationBlob` 用内容哈希在途锁防止并发重复落库；
  `filterHistoryAssets` / 计数按 storageKey 去重（存量重复卡不再展示）

## 4. 接手检查

```bash
git status
pnpm typecheck
pnpm test:unit
```

不要自动推送；用户要求统一修复完成后再推送。
