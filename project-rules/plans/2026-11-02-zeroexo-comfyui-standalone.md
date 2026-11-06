---
状态: in-progress
负责人: ai
创建: 2026-11-02
最后更新: 2026-11-02
关联经验: .project-rules/shared/rules/metadata-asset-storagekey-governance.md, .project-rules/zeroexo_front/rules/param-panel-template-driven.md, .project-rules/shared/rules/powershell-utf8-pitfall.md
---

# Plan#83 · zeroexo-comfyui 纯前端剥离版（零后端 / 本地目录存储 / MCP 唯一智能入口）

## 执行进度（2026-11-02）

> 形态调整（用户要求“完全剥离”覆盖 D4）：** packages 物理拷贝入新工程自包含**，不再用 workspace link。

- ✅ 副本落地：`robocopy zeroexo_front → zeroexo-comfyui`（7.54 MB，排除 node_modules/dist/.turbo/日志）；`pnpm install` + 补 `diff` 依赖
- ✅ 删除 13 个目录：`features/{collaboration,dev-performance,creative-wizard,plan,source-material,agent-chat,agent-panel,canvas-agent,prompt-library,auth}` + `pages/{home,legal,canvas-v2}`（剩 16 个 features：画布+资产+生成配置）
- ✅ 新建本地层：`src/platform/fs.ts`（FSA 封装 + 原子写 + size/lastModified 乐观锁 + ConflictError）、`src/platform/settings.ts`（渠道存 settings.json，**apiKey 另存浏览器 storage 不落授权目录**）、`src/features/prompt-library/prompt-store.ts`（本地库 `library/prompts/<cat>/<id>.json`，内容 hash 去重）
- ✅ `src/services/api-client.ts` 重写为本地分发器（导出面不变）：channels/templates/folders 走本地，**其余路径抛 LocalUnsupportedError 并带 path**（不做假数据，错误清单即 Phase 3 待迁表）
- ✅ `src/app.tsx` 重写为三路由本地壳（项目/画布/资产 + 顶栏目录授权状态条），自身 0 错误
- ⏳ **真实剩 103 个 tsc 错误**，分两块：① 编辑器 Agent/协作 UI 摘除 67 处（editor-page 20 / use-editor-interactions 10 / use-storyboard 10 / top-bar 6 / ai-generation 6 / use-editor-state 4 / 其他 11）；② 同步与上传链 31 处（sync-prompts 12 / sync-resources 12 / backend-upload 4 / chapter-detect-pipeline 2 / sync-utils 1）
- ✅ 壳/首页按用户指令整理：UI 壳零改动（app.tsx 从原件还原只删路由）；主页+公提页删除；**项目列表=首页**；画布→项目全量改名（52 处文案 + 侧栏硬编码 label + 页签 fallback）；协作从 canvas-page 物理删除（无 stub 残留）；顶栏移除账户头像与登录/退出，数据目录图标上收到更新日志旁
- ✅ **存储坑补齐**：① 主数据落盘——新增 `platform/disk-driver.ts`（localforage 自定义驱动，未授权时 `_initStorage` reject ⇒ 自动回落 IndexedDB）+ `platform/boot.ts`（包 createInstance 注入磁盘优先序 + 目录标记 `zeroexo-root.json`），**引擎包与 30+ 调用点零改动**；key→路径约定 `pathForStorageKey`（媒体/graph/project 可读，其余进 `.lf/` 并在 `.lf/_map.json` 记账）；② 首启门 `platform/RootGate.tsx` + `root-flow.ts`（选目录→可选迁移→**整页刷新**，杜绝静默双轨）；③ 迁移器 `platform/migrate.ts`（枚举 IDB 桶→逐条写盘，不删源）；④ **自动孤儿回收已停用**（`main.tsx` 去掉 `startPeriodicCleanup`，改为只报告+级联删）
- ⚠ 待用户实测（我无法代跑原生目录弹窗）：首启门 → 选 `D:\ZeroExoData` → 迁移 → 刷新后应在磁盘看到 `zeroexo-root.json` / `projects/<id>/…` / `.lf/_map.json`；**待校对项：真实 storageKey 形状**（graph/项目元数据落在 `.lf/` 还是 `projects/` 取决于实际 key，看 `_map.json` 后补映射规则）
- ⏳ 下一步：级联删项目目录 + 存储/未引用/缺失面板 + 生成渠道（ComfyUI 直连）+ 清 59 处类型残留与 build
- 📄 诊断输出（Phase 3 验收后清理）：`cut-refs.txt`（85 处耦合清单）、`tsc1.txt`、`tsc3.txt`、`tsc16.txt`

### 验收修复轮（2026-11-05/06，征集 [#173](../suggestion-board/2026-11-05-comfyui-asset-display-and-service-recovery.md) / [#174](../suggestion-board/2026-11-05-comfyui-drop-node-size-and-drawer-script-tab.md) / [#176](../suggestion-board/2026-11-05-comfyui-subject-add-tile-and-state-colors.md) / [#177](../suggestion-board/2026-11-06-comfyui-modal-centering-subject-masonry-slot-drop.md)）

- ✅ **拖入与发送尺寸收口**（#174）：新增 `src/features/asset-picker/services/asset-node-size.ts` 单一入口（真实宽高补全 + `IMAGE_LONG_SIDE` 长边 + 视口 40% 收敛 + 1:1 中性兜底）；`insert-asset-to-canvas.ts` 与 `drop-handler.ts` 四个建节点入口全走 `createSizedAssetNode`（以前拖拽链裸调工厂→落 620×348 宽幅容器→黑边）；新单测 10 例含结构断言
- ✅ **抽屉「剧本」分组下线**（#174）：`tab-defs` 去页签 + 删 `groups/ScriptGroup.tsx` + store 清 4 个成员与 5 个失效 import + `DrawerGroup` 类型收窄；剧本正文唯一入口=顶部「剧本」页签；`history-group.test` 断言改新口径
- ✅ 上一轮遗留：导演台提示词面板圆角（`WORKSPACE_SURFACE_RADIUS` 同源）已随 `npm run build` 进包（`index-D83D1Bca.js`）
- ✅ **抽屉主体分段三项视觉纠正**（#176）：① embedded 列表页页头（面包屑「主体库」+ 计数徽标 + 右上主按钮）整块下线；② 「添加主体」改用共享 `AddTile`（与素材分段「上传素材」同组件同底端位置，AddTile 补可选 `icon/dataAttr`，新建传 Plus）；③ 状态色中性化——`src/app.css` 全局 `:focus-visible` 品牌红 rgba(233,69,96,0.5) 改 slate `rgba(148,163,184,0.9)`（真凶：只改导演台面板无效），`directorRailTone()` 选中三枚 token 与批量勾选块绿色改中性（深 226,232,240 / 浅 68,64,60），绿色只保留给衔接箭头；页签键盘环去 `--zx-tab-accent`。测试：`workbench-director-track` 断言改中性 + 绿色零残留，`subject-library-pages` 新增 2 例（embedded 无页头/非 embedded 照旧）；`rail-visual-spec.md` 同步
- ✅ **四项验收纠正**（#177，2026-11-06）：② 弹层屏幕居中——补齐 6 处 `modal.confirm`（script-snapshot-panel×2 / script-editor-sheet×2 / local-service-panel×1）+ 3 处 antd `<Modal>`（workflow-config-dialog / workbench-tab-content 预检与工作流查看），并新增**全仓扫描守卫测试** `src/shared/components/modal-centering.test.ts`（深度感知解析开标签，避开 `=>` 截断；含防空跑断言）；③ 主体列表同源——容器改共享 `MasonryGrid`（列数 = `masonryColumnsForWidth` 实测断点，不再 auto-fill minmax(240px)），封面高度改 `cardCoverMetrics`（`SubjectMediaThumb` 新增 `onLoaded` 学真实比例，只过渡一次），去掉 `CardShell hovered` 亮环（与资产卡 hover 一致），`PAGE_PAD_EMBEDDED` 16→20；④ 删「悬停状态卡可编辑或删除」冗余提示 + 两个添加状态入口（页头红主按钮、格内 AddStateCard）收敛为底端单一 `AddTile`；**修「改类型无效且误跳状态页」**——antd Dropdown 菜单虽在 portal 但 React 事件沿组件树冒泡到卡片 onClick，补 `e.domEvent.stopPropagation()` + 卡片守卫加 `closest('.ant-dropdown')` 兜底；⑤ 插槽拖入正文——`MentionEditor` 新增通用 `dropMimeTypes`/`onDropPayload`（caretRange/PositionFromPoint 定落点，走 `insertAt` 文本模型不碰 DOM），插槽格 `draggable` 携带 `application/x-director-slot {label,assetId}`，面板按当前槽位映射重查后插入 `@PictureN `（尾空格铁律；槽位不在本片段 → 不插过期引用）。测试：新增 modal-centering 2 例 + mention-editor 拖入 3 例 + 改类型不误跳 1 例；typecheck 47（基线），全量 vitest 112 文件 = 105 passed / 1 skipped / 6 failed（同一批存量），build exit=0
- ⚠ 基线：`zeroexo-comfyui` 目录**无 git 仓库**，无法做基线提交/回滚对比；`dist/assets` 因 `emptyOutDir` 未开持续累积历史 bundle（待用户决定是否清理）；构建环境坑：esbuild 在 `%TEMP%` 删临时文件 Access denied，需将 TMP/TEMP 指向仓内 `.tmp-esbuild/` 才 exit=0
- ⚠ 全量单测基线：109 文件 = 102 passed / 1 skipped / **6 failed（均为存量）**：`workbench-video-export`（缺 `src/vendor/mp4box.all.min.js`）、`asset-card`/`MaterialGroup.lightbox`/`asset-sanitize`（`AssetScopeBadge` 缺 ThemeProvider + 5s 超时）、`thumb-eviction`/`bugfix-20261104`（预览 URL 解析）
- 🔗 新需求已拆出独立 Plan：**[#84 子画布](2026-11-05-sub-canvas.md)**（🔵 in-progress，2026-11-05 用户拍板开工；T0/T1/T4a 已完，T2/T3/T4b/T5 待做）——与本轮影响文件有交集，已按用户指令串行推进

> 需求来源：征集 [#172](../suggestion-board/2026-11-02-comfyui-as-channel-vs-strip-canvas.md) 第七节（用户第三次澄清为准）
> 参考物：`references/projects/infinite-canvas`（MIT，仅借架构，不抄 web 代码）+ 魔搭包 `ComfyUI-Local-Infinite-Canvas` v0.24.5

## 借鉴记录：`ZhuYichuan/infinite-canvas`（2026-11-02 只读提取研究）

> 仓库已 shallow clone 到 `references/projects/infinite-canvas-zyc`，但含 Windows 非法文件名（`assets/cloud-mirror/lightcc:autodl -3 ….png`）导致 checkout/sparse-checkout 均失败 → **改用 `git show HEAD:<path>` 只读提取**，源码副本在 `d:\AICode\zeroexo\.tmp\zyc\`，685 文件清单在 `.tmp\zyc-tree.txt`。要完整工作区需在 Linux/WSL 检出或先改名。

**D3 修正（CORS）**：该项目是**纯浏览器直连原生 ComfyUI API**（默认 `127.0.0.1:8188`，可填本机或云 GPU IP），**不解决 CORS、只诊断**（`TypeError: Failed to fetch` → 抛“请检查渠道地址、跳域（CORS）与浏览器本地网络权限”，并有单测断言文案含 CORS）→ 本地 ComfyUI **用 `--enable-cors-header` 启动参数即可**，`zeroexo_bridge` 只给**云端渠道**做转发（云 API 仍不给浏览器跳域）。

**新增 D8：workflow 资产双格式 + 自动插槽适配层**（直接回答“ComfyUI 生图生视频太麻烦”）
- 每个能力成对存 `xxx_workflow.json`（UI 图，给人导出/导入）+ `xxx_api.json`（`/prompt` 载荷），前端 `web/src/assets/workflows/*_api.json` 随构建分发；按能力分目录（t2i/i2i/inpaint/text/omni video/frame video/depth/audio/face refine），每能力多档（PDMD 4步 / FP8 20步 / BF16 8step Turbo / BF16 20步）——**H3 的 `minimax_h3_ref2va_*_api.json` / `fl2va_*_api.json` 现成可用**，省掉自造模板。
- `services/api/comfyui-adapter.ts` = UI图→API图转换器 + **插槽自动识别**：`_meta.title` 标准槽名（confidence 1.0）/ KSampler slot 索引→model·positive·negative·latent_image / SaveImage·PreviewImage·VHS_VideoCombine→images / CLIPTextEncode·TextEncode·PrimitiveString→提示词注入点 / `MODEL_LOADER_PATTERNS` 正则→模型选择器；认不准则出 `AmbiguityInfo` 候选列表 + 反馈“已自动识别并绑定 N 个插槽”。→ 用户只递一张 ComfyUI 导出的图，就变成一个“模型/渠道”。
- 调用协议：`POST /prompt {prompt, client_id}` → `prompt_id`；轮询 `GET /history/{id}` 空 → `GET /queue` → **防竞态二次拉 /history**（避开“刚完成、从 running 移入 history 的瞬间”误判）；状态机 7 态含 `lost`（本地在等但 /queue+/history 均无痕 = ComfyUI 重启任务蒸发）与 `cancelled`（`execution_interrupted`）；产物统一 `/api/view?filename&type&subfolder`（**带 `/api/` 前缀**）解析 images/videos/gifs/audio；支持 Bearer（云 GPU 反代）。
- 参数约束分层：`models/video-minimax-h3-frame.ts` / `-omni.ts` + `constraint-engine.ts`（相当于我们后端 template bounds，本地版归到渠道模型层）。

**新增 D9：媒体存储三件套**（可照抄的最小实现）：`storageKey = "prefix:nanoid()"` + 节点只存 key；localforage **分实例分 store**（media_files / image / graph）；`resolveMediaUrl()` 走 objectURL Map 缓存防泄漏；`collectMediaStorageKeys()` 递归扫全图 → `cleanupUnusedMedia()` 存盘时做**孤儿回收**（对应我们旧坑「删除节点后资产残留」）；`local-storage-usage.ts` 配额监测（视频尤其会爆）。

**新增 D10：配置单文件导出 + 可选 WebDAV 远端**：`config-file.ts` 把「渠道配置 + 同步配置 + 提示词源」导出为**单个 JSON**（`{app,version,exportedAt,config,webdav,promptSources}`）；`webdav-sync.ts`+`app-sync.ts` 用 **WebDAV 当远端仓库**（NAS/坚果云）浏览器直传做备份/多机→ 给“文件放哪”补一个答案：`<dataRoot>` 本地目录为默认，WebDAV 为可选镜像。

**新增 D11：公共提示词的更优形态**：他们用 `prompt-source-presets` + `prompt-source-runtime`（可配置“提示词源”，含定时）→ 本地版采纳为：**本地库为主 + 可关的外部导入源**（默认关，符合用户“不用公共提示词，后续想用自己批量导入”）。

> 许可（已核实）：本 fork 保用上游 **MIT License，Copyright (c) 2026 basketikun**（HEAD `cdf71f5` v0.21.3，2026-10-30）；README 另附加一句礼节性要求：“二次开发与 PR 请保留原作者信息和前端页面标识”。→ 若后续引用其代码片段，**必须保留 LICENSE 与版权声明 + 不移除前端标识**；现阶段只借架构与协议细节。

## 目标

1. **零后端**：不启动 NestJS / Postgres / Redis / MinIO / Next.js。产物 = 一个静态 `dist/`，由 ComfyUI（已有 aiohttp）同源托管。
2. **功能面只留两样**：画布（节点图）+ 资产（本地目录）。删认证/协作/公共提示词/后台/计费。
3. **存储 = 用户可设置的本地目录**（File System Access API 授权），**禁止把权威数据留在浏览器**（IndexedDB 只做授权句柄缓存与派生缩略图）。
4. **无 Agent / 无 LLM 内置**：智能侧 100% 由外部 coding 工具经 MCP 完成（导入剧本、关联资产、改图结构、提交生成）。
5. **生成渠道仍可配置**：设置面板维护「图片/视频 API list」（含本地 ComfyUI 渠道），数据形状沿用现 Admin 契约，未来与 SaaS 版合流免费。

## 核心决策（已定，实施者不再选择）

| 编号 | 决策 | 依据 |
|---|---|---|
| D1 | **权威源 = 磁盘文件树**，UI 与 MCP 都是它的客户端 | MCP 进程看不见 IndexedDB；上游 `canvas_apply_ops` 走「远程改页面 store」，页面必须开着 + 30MB 请求体上限，喂不了几百万字小说 |
| D2 | 存储用 **File System Access API**（`showDirectoryPicker` + 句柄持久化），**不引入任何自建常驻服务** | 满足「设置本地路径 + 不缓存在浏览器」；ComfyUI 已是唯一必须进程 |
| D3 | **云 API 的 CORS 由 ComfyUI custom node 转发**（新增 `custom_nodes/zeroexo_bridge/http_routes.py`，抄导演台已验证的 `PromptServer.instance.routes` 写法） | 浏览器直连 OpenAI 兼容端点普遍被 CORS 拒；页面同源托管在 8188，转发路由边际成本≈0，且**不新增端口/进程** |
| D4 | 画布引擎**不 fork**：`zeroexo-comfyui` 建 pnpm workspace 以 `workspace:*`/`link:` 引用 `zeroexo-platform/zeroexo_front/packages/{core,plugins,presets,shared}` | 「剥离新版本」= 剥产品与发行物，不复制引擎（否则回到双份维护） |
| D5 | **同步链路整块删除**：`yjs` / `y-indexeddb` / `@hocuspocus/provider` / `sync-*` / `session-lock` / `broadcast-channel` / `graph-paginated-loader` | 用户明确要求「去掉同步释放性能」；本地单写者不需要 CRDT |
| D6 | 长文本权威 = `*.md` 文件；结构权威 = `project.json`；**workflow JSON 只由分镜段表单向编译** | 上轮 zerovideoAgent `sync_md_from_workflow.mjs` 双向回写教训（同一字段两处存 = 必然漂移） |
| D7 | **apiKey 不落授权目录**（只存浏览器 storage，可选内存模式） | 授权目录常被用户放网盘/git；对齐参考包「服务端不保存 Key」纪律 |

## 目录契约（Phase 0 冻结，前后端/MCP 三方共用）

```
<dataRoot>/                       # 用户在「设置」里授权选择的目录
├─ zeroexo.index.json             # { version, projects: [{slug,name,updatedAt}] }
├─ settings.json                  # 渠道 list / 默认模型 / 参数模板 / UI 偏好（无 apiKey）
├─ library/prompts/<组>/<id>.md   # 本地提示词库（替代公共提示词；支持批量导入）
├─ projects/<slug>/
│  ├─ project.json                # GraphModel + 节点 file 引用 + 视口
│  ├─ scripts/EP<nn>.md           # 剧本正文（MCP 直接编辑）
│  ├─ storyboard/EP<nn>.json      # 分镜段表（权威）
│  ├─ prompts/EP<nn>.md           # 出片提示词段
│  ├─ notes/<id>.md               # text 节点正文
│  ├─ assets/{images,videos,audios}/  # 本项目资产（或 symlink/引用 ComfyUI input|output）
│  └─ history/<timestamp>.json    # 追加快照（撤销/回退，替代 CRDT）
└─ cache/                         # 缩略图/workflow 产物/挂图清单——可整删重建
```

**并发纪律**（人 + MCP 两写者）：写前 `file.getFile()` 比 `size+lastModified` → 不一致则拒写并提示「外部已改，是否重载」；落盘一律 `createWritable()` 全量原子替换；节点生成中持 `contentHash` 锁。

## 影响文件清单（并行门必填）

**新建（zeroexo-comfyui/，独立于在途 Plan 文件）**
- `pnpm-workspace.yaml`、`package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`
- `src/main.tsx`、`src/app.tsx`、`src/routes.tsx`（无 auth guard）
- `src/platform/fs.ts`（FSA 封装：授权/读写/原子写/列目录/mtime 比对）
- `src/platform/handles.ts`（句柄持久化进 IndexedDB + `queryPermission` 恢复）
- `src/platform/settings.ts`（渠道 list 读写，schema 复用 `api-providers` config 形状）
- `src/platform/generate.ts`（`/zeroexo/generate` 提交 + 进度 + 取消 + 产物落盘）
- `src/platform/watch.ts`（外部改动通知：MCP ws + mtime 轮询兜底）
- `src/features/canvas/*`（自 zeroexo_front 迁移，去服务化改写）
- `src/features/asset-drawer/*`（本地目录版资产抽屉）
- `src/features/settings-panel/*`（渠道配置面板）
- `src/features/library/*`（本地提示词库 + 批量导入）
- `src/nodes/{novel,script,storyboard,workbench,image,video,audio,text}.tsx`
- `scripts/build-comfyui-pack.mjs`（产出 `dist/` + `custom_nodes/zeroexo_bridge/` 发布包）
**新建（zeroexo-platform/zeroexo_canvas_agent 复用改造）**
- `src/tools.ts`（新增文件面工具，见 T7）
**只读引用（不改）**
- `zeroexo_front/packages/{core,plugins,presets,shared}/**`（D4：link 引用；本 Plan 不修改引擎包，若必须改则另立 Plan）

## 子任务

### Phase 0 · 技术前提验证（必须先跑，不通则全案改 D3 退路）

- [ ] T0.1 **FSA 可用性 spike**
  1. 目标文件：`zeroexo-comfyui/spikes/fsa-spike.html`（新建，一次性）
  2. 修改点：`showDirectoryPicker()` → 建 `projects/demo/project.json` → 重开页面 `queryPermission` → 失败则 `requestPermission` 一次点击恢复
  3. 复用形态：无（纯 spike）
  4. 验收断言：Chromium 下二次打开页面点一次授权后能读到上次文件；DevTools 无 `SecurityError`
- [ ] T0.2 **云 API CORS 实测**
  1. 目标文件：`zeroexo-comfyui/spikes/cors-spike.html`
  2. 修改点：页面 `fetch` 打 Ark(volcengine) 与 OpenAI 兼容 image 端点各一次
  3. 复用形态：无
  4. 验收断言：结论落 Plan「测试结果」表 → **被拒即启用 D3 的 zeroexo_bridge 转发**；全通则 D3 降级为可选
- [ ] T0.3 **ComfyUI 同源托管 spike**
  1. 目标文件：`zeroexo-comfyui/bridge/zeroexo_bridge/__init__.py`、`http_routes.py`（抄导演台 `register_routes()` 结构）
  2. 修改点：`app.router.add_static('/zeroexo', dist)` + `GET /zeroexo/health`
  3. 复用形态：无
  4. 验收断言：`http://127.0.0.1:8188/zeroexo/` 打开即画布，无 CORS、无新端口

### Phase 1 · 壳工程与引擎复用

- [ ] T1.1 workspace 建壳：`pnpm-workspace.yaml` 指 `packages: ['src-platform', '../../zeroexo-platform/zeroexo_front/packages/*']`，`vite.config.ts` 设 `base: '/zeroexo/'`、alias `@platform`
  验收：`pnpm dev` 起空画布，`@zeroexo/core` 类型零错误
- [ ] T1.2 依赖裁剪：壳的 `package.json` 不装 `yjs`/`y-indexeddb`/`@hocuspocus/provider`/`antd`（若 UI 已依赖 antd 则保留并记录）
  验收：`pnpm why yjs` 零命中；`tsc --noEmit` 零错误
- [ ] T1.3 `preset-default` 去掉 `persistence-localforage`，注册 `PersistenceFsPlugin`
  3. 复用形态确认：`PersistencePlugin` 是 **Plugin 接口实现（非 UI）**，公开面仅 `save()` / `load(): Promise<GraphModel|null>` / `clear()` + `PersistedState{version,savedAt}` + `_dataRef` 大字段分片；`PersistenceFsPlugin` **必须实现同一 `Plugin` 接口与同一 `PersistedState.version=1` 迁移注册表**，防 `use-editor-state` 的降级读逻辑失效
  4. 验收：拖 3 节点存盘 → 磁盘 `project.json` 出现对应 nodes；删 `cache/` 不影响数据

### Phase 2 · 平台层（存储 / 设置 / 生成）

- [ ] T2.1 `src/platform/fs.ts`：`pickRoot() / readJson / writeJsonAtomic / readFile / writeFile / listDir / stat`
  4. 验收：控制台无 `NotAllowedError`；写中断（关页）不留半文件
- [ ] T2.2 `src/platform/handles.ts`：句柄入 IndexedDB（**仅句柄，非数据**）；顶栏常驻「目录：xxx / 未授权」状态胶囊，点击即重新授权
- [ ] T2.3 `src/platform/settings.ts` + 设置面板（**顶栏齿轮按钮 → 右侧抽屉，非 Modal**；沿用现 `tools-dock` 悬浮胶囊形态：折叠=顶栏 220px 细条，点击展开完整面板）
  3. 复用形态确认：`NodeGenerateDock` = **悬浮胶囊**（非内嵌条）；渠道面板字段结构照搬 Admin `api-providers`：`{ name, provider, baseUrl, capabilities[], models[], enabledModels[], paramMapping, valueMapping }`，**apiKey 单独存 browser storage 且不进 settings.json**
  4. 验收：新增一条渠道 → `settings.json` 出现该项且**不含 key**；刷新后模型列表仍在；`grep -i apikey settings.json` 零命中
- [ ] T2.4 `src/platform/generate.ts`：`submit(kind,prompt,refs,params) → taskId`；进度走 ComfyUI `/ws` 或轮询 `/history/{id}`；产物 `/view` → 写 `projects/<slug>/assets/…`
  4. 验收：点 video 节点生成 → 磁盘出 mp4 且节点显示，无需浏览器缓存

### Phase 3 · 功能面迁移（画布 + 资产）

- [ ] T3.1 迁移画布页与节点（`text/image/video/audio/novel/script/storyboard/workbench`），**全部去 `api-client`**：正文改读 `*.md`、结构改读写 `project.json`
  4. 验收：`grep -rn "@/services/api-client" zeroexo-comfyui/src` 零命中
- [ ] T3.2 资产抽屉本地化：列目录 + 缩略图（进 `cache/`）+ 拖拽入节点
  3. 复用形态确认：沿用现 `AssetCard` 与 `FocusCardWrapper` 鬼影定位（`ghost-animation-asset-positioning` 经验），**不改视觉**
- [ ] T3.3 本地提示词库 + 批量导入（拖目录 / zip）：**按内容 hash + 相对路径去重**（旧坑：公共提示词批量导入重复数据）
  4. 验收：同一目录导入两次 → `library/prompts` 条目数不变
- [ ] T3.4 撤销/历史：`history/<ts>.json` 追加（Ctrl+Z 读快照），50 份滚动
- [ ] T3.5 **删除清单落地**（不迁）：`features/auth`、`collaboration`、`creative-wizard`、`canvas-agent`、`agent-chat`、`agent-panel`、`prompt-library(后端版)`、`source-material`、`dev-performance`、`top-nav` 门户项、`plan`
  4. 验收：`src/features` 目录仅剩上表保留项

### Phase 4 · MCP（唯一智能入口）

- [ ] T4.1 `zeroexo_canvas_agent/src/tools.ts` 增**文件面**工具：`fs_read/fs_write/fs_list`（限定 `<dataRoot>`）、`project_open/create`、`node_add/patch/delete`、`import_script(md)`、`import_storyboard(json)`、`link_asset`、`generate_submit/status`、`history_list/restore`
  4. 验收：Qoder/Codex 内说「把这个剧本导入项目 EP05」→ 磁盘新增 `scripts/EP05.md` + `project.json` 出现 script 节点 + 打开着的前端 3s 内自动刷新该节点
- [ ] T4.2 `watch.ts`：MCP 写成功后 ws 通知前端 `external:changed`（带路径），前端只重载受影响节点；ws 不可用退化为 5s mtime 轮询
- [ ] T4.3 保留**视口面** RPC：`get_selection / get_viewport / focus_node`（这类必须问页面，D1 例外）
- [ ] T4.4 冲突协议：`fs_write` 带 `expectedModified`，不匹配返回 `CONFLICT` + 现内容 diff 摘要

### Phase 5 · 发行包

- [ ] T5.1 `scripts/build-comfyui-pack.mjs` → `dist/` + `custom_nodes/zeroexo_bridge/` + `start-zeroexo.bat`（复用 `run_nvidia_gpu.bat` 逻辑，加 `--web-root`）
- [ ] T5.2 用户数据与程序目录分离（`<dataRoot>` 由用户选，**严禁放程序目录**，否则小补丁覆盖洗数据）；`.gitignore` 排除 `dataRoot`、`cache/`、`launcher/config.json` 同类本机路径文件
- [ ] T5.3 许可合规：未抄上游代码 → 不引 NOTICE；若后续引用其片段，必须保留 MIT 版权与 NOTICE

## 测试四件套

- **测试方案**：`tsc --noEmit`（壳 + link 的引擎包）+ `vitest`（platform 层 fs/settings/generate 单测，mock FSA 句柄）+ MCP e2e 脚本（`scripts/mcp-e2e.mjs`，起前端 + 用 MCP 写盘 + 断言磁盘文件）+ 肉眼回归。命令可重复执行，PowerShell 输出统一重定向 UTF-8 文件（旧坑：管道乱码）。
- **测试计划**：PT1 FSA 二次授权恢复 / PT2 原子写抗中断 / PT3 apiKey 不落盘 grep 断言 / PT4 公共提示词改本地库去重 / PT5 MCP 导入剧本→前端自动刷新（≤3s）/ PT6 冲突拒写 / PT7 video 节点出片落盘 / PT8 删除项零命中 grep / PT9 500 节点无 Yjs 后首屏与拖拽帧率对比基线
- **测试报告**：执行期填 `用例 × 结果 × 缺陷`，脚本输出存 `zeroexo-comfyui-plan83-references/`
- **测试风险**：① 非 Chromium（Firefox/Safari）无 FSA → 明确不支持并在启动页提示；② 授权目录在网络盘/OneDrive 同步盘上的原子写语义未验证（先禁，文档写清）；③ 大媒体进 IndexedDB 缩略图缓存的配额上限；④ ComfyUI 版本与导演台接口漂移（bridge 只做转发不做解析，风险可控）

## 检查单

### 前置
- [ ] 二次复审通过（设计原则 / 影响面 / 风险 / 基线提交）← **待用户确认是否执行**
- [ ] 并行门：与在途 Plan#69/#74/#79 影响文件**零交集**（新建目录 + 只读引用引擎包），可并行；若 Phase 1 需改引擎包源码则立即转 blocked

### 执行
- [ ] 全部子任务完成

### 验证
- [ ] 测试四件套全绿（PT1-PT9）
- [ ] 消费端契约检查：`settings.json` 渠道字段 vs `param-panel-template-driven` 契约逐字段对照
- [ ] 回归：同步链路删除后无残留调用、无死代码（`dead-code-removal-verification`）

### 交付
- [ ] diff + 前后对比 + 代码质量审核 + 漏洞分析 + 复盘
- [ ] 经验提炼（候选：`file-tree-as-source-of-truth-mcp-share` / `fsa-handle-persistence-and-permission` / `apiprovider-config-shape-local-port`）
- [ ] 新目录注册进 `projects.json`（开工时点确认）
