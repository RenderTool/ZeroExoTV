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

## 2. 待做需求（下一会话）

### A. 孤立资源 → 回收站 + 定时清理

当前问题：画布、资产、历史、主体都不引用的图片仍会留在 `media/cas` 或 `assets/<project>`。

要求：
- 不直接静默删除
- 扫描未引用媒体，移入回收站
- 回收站保留 N 天，定时清理
- 清理前可查看来源、大小、时间
- 删除主体历史图片/画布节点时同步处理引用

### B. 画布节点胶囊常驻下载（已完成，见 §3）

图片 / 视频 / 音频节点胶囊都常驻「下载」按钮（`createDownloadTool`，紧跟「详情」之后），
点击经 `eventBus.emit('node:download')` 交 app 层 `downloadNodeAsFile`（`getMediaBlob` + 引导打包）。

### C. 主体历史图片永久删除（已完成，见 §3）

历史缩略图右上角有删除按钮（`data-media-history-delete`），`Modal.confirm` 二次确认并写明「文件不可恢复」；
删除走 `deleteSubjectHistoryMedia`：移除条目 + `releaseCas` 释放引用（不是只从数组抹掉）+ 封面回退到当前槽位图片或下一条可用图片。

### D. 视频尺寸

用户已自行解决，不要重复改算法。  
保留现有尺寸参数逻辑，避免覆盖用户改动。

### E. 主体发送到画布（复用堆叠框架，但类型必须是主体节点）

要求：
- 主体可发送到画布
- 一个主体 = N 个资产（图片/视频/音频都支持）
- 复用之前隐藏的堆叠节点框架，但节点类型/语义是「主体节点」，不是堆叠节点
- 点击节点里的某个资产，定位回抽屉中对应主体/状态的具体资产
- 需要扩展堆叠框架支持音频
- 不要重新造一套预览/切换/保存框架

相关代码：
- `packages/plugins/nodes/src/nodes/stacked-media-presentation.tsx`
- `packages/plugins/nodes/src/nodes/stacked-media.ts`（若存在）
- `packages/plugins/nodes/src/index.tsx`
- 主体：`src/features/canvas-nodes/storyboard/StoryboardSubjectTree.tsx`
- 主体页面：`subject-library-pages.tsx`

### F. Krea2 文生图（已完成，见 §3；线上插件需重新部署）

- 实现口径：不新造节点类型，按项目既有「本机/线上伪模型」惯例做成图片节点的模型选项 `Krea2`（`zeroexo:krea2`），
  只在**非本机地址**（`isLocalComfyuiAddress` 为 false）时出现在模型下拉里；本机模式完全不可见。
- 参数：比例 + 百万像素（默认 3MP）+ 32 对齐（`resolveKrea2Size`），默认 10 步、cfg 1、eta 0.55；不支持参考图。
- 插件侧新增 `templates/krea2_t2i.json`（UNET krea2 → CLIP krea2 → VAE qwen_image_vae → ClownsharKSampler_Beta → VAEDecode → SaveImage），
  作业 kind `krea2_t2i`，产物按 image 回传；不接 SeedVR2 / z_image 放大链。
- **线上 ComfyUI 尚未部署这份模板**（云端 `/zeroexo/v1/health` 的 templates 里还没有 `krea2_t2i`）：把 `comfyui-plugin/ComfyUI_ZeroExoNodes`
  同步到 `/root/comfyui/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes` 后重启（`bash /etc/waas-script/restart_comfyui.sh`）。
- 云端已核对：`krea2_turbo_bf16.safetensors` / `qwen3vl_4b_fp8_scaled.safetensors` / `qwen_image_vae.safetensors` 都在，
  `ClownsharKSampler_Beta`（RES4LYF）与 `ResolutionSelector` 节点可用，直提 `/prompt` 无 node_errors。

### H. 刷新后恢复预览与进度（已完成，见 §3）

用户要求：刷新页面后任务还在跑，预览帧和步进不能丢。

- 提交成功即把 `{ jobId, clientId, base, kind, model }` 写进节点 `data.localJob`（图片 Qwen/Krea2、视频 H3 都写）。
- 画布重开时扫描 `status=loading` + `localJob` 的节点，用**原 clientId** 重连 `/ws`（ComfyUI 按提交时的 sid 定向推送），
  预览/步进立刻续上；同时继续轮询作业，完成后把产物写回节点并落历史。作业已结束/被取消则清掉 `localJob`。
- 生成结束（成功/失败/中止）都会清 `localJob`，不会重复续接。

### G. 图片生成采样预览与步骤进度（已完成，见 §3）

画布图片节点（本机 `QwenImage2.1`）生成时已有采样预览帧与「采样 x / y」步进：提交带 `clientId` → `/ws` 收 ComfyUI 原生 `progress` + 二进制 `PREVIEW_IMAGE` → 写 `generating-preview-store` → 图片节点 `AIStateView` 渲染。

剩余可选项（不是阻塞）：图片编辑工作台的遮罩局部修改仍只有 `message.loading`，要进度就复用 `ComfyuiPreviewSocket`（`image-edit-workspace.tsx`）。

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

## 4. 接手检查

```bash
git status
pnpm typecheck
pnpm test:unit
```

不要自动推送；用户要求统一修复完成后再推送。
