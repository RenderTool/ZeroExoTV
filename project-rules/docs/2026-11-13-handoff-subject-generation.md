# 交接：主体状态页直接生图（新会话从这里继续）

> 仓库：`D:\AICode\zeroexo\zeroexo-comfyui`
> 当前版本：0.2.63（commit `fd6d380`，已 push）
> 数据根：网页 File System Access 授权目录；MCP `ZEROEXO_DATA_ROOT`（默认 `D:\Test`），两者是独立链路。
> 本文只记录**尚未完成**的工作；已完成项见 `project-rules/00-SUMMARY.md` 与 `DESIGN.md`。

## 1. 用户这次要求的最终形态

主体库的「状态」不再只是编辑提示词 + 发送到画布，而是**在状态页直接发起生图任务**：

1. 状态页底部参数行必须复用**画布图片节点同一套**生成参数与模型：
   - 模型：`QwenImage2.1` / `Krea2` / `MossImage`（key 来自 `zeroexo-jobs-client.ts`：`LOCAL_IMAGE_MODEL_KEY` / `KREA2_MODEL_KEY` / `MOSS_MODEL_KEY`）。
   - 参数：比例（16:9 等）、尺寸（1K/2K/自定义，Qwen 最长边 ≤2048、32 对齐）、步数、cfg、种子；模板（角色三视图 / 场景全景 / 道具细节）。
   - 不能只放一个模型下拉；要能像画布节点一样配置完整参数。
2. 点「生成」直接在状态页发起任务，**不再发送到画布**。
3. 任务按状态持久化：关闭页面/切走/重开，仍能看到进度；状态卡上要有「生成中」预览/进度，完成后自动挂到该状态图。
4. 基础状态：模型任选；派生状态默认 `Qwen 图生图`，自动把基础状态图作为参考，按变体描述生成；用户可取消「引用基础状态」（铠甲变身等完全换资产的情况）。
5. 批量：多选工具条除「全选/改类型」外，增加「改生图模型」「批量生成」；批量页逐状态显示模型/模板/是否引用基础/进度/失败原因，可整批改模型后跑。
6. 风格：主体页当前只是在提示词末尾拼了一行「风格：…」；用户指出**没有真正用上画布/导演台那套风格参数**。生成时必须走同一份全剧风格/风格参数，并允许按风格重写提示词与镜头时长（见 `style-shot-guides.ts`）。
7. 「最后一步」：画布历史并入「画布」类目、删独立历史入口；导演台类目只显示视频。上一轮只做了类目骨架（全局/画布/导演台/主体），**历史合并尚未完成**。

## 2. 现状（已完成，勿重做）

- 全剧风格画廊 39 套（23 电影美学 + 16 题材，含都市/基础写实/邵氏/经典港片）；`style-presets.ts`（前端/MCP 各一份，同源）。
- 风格参数：导演台 `sharedParams.params.stylePrompt/styleName/styleGuide`，生成时 `withDirectorStyle` 拼进片段提示词；「重写要求」复制 brief。
- 主体状态页已改**强制上下布局**：状态名 → 大预览 300px + 历史图 → 提示词 → 底部参数行（出现集数 / 生图模型 / 提示词模板）。
  - `StateEditPanel` 在 `src/features/canvas-nodes/storyboard/subject-library-pages.tsx`。
  - `SubjectTreeNode.imageModel?: string` 已加（`subject-tree-types.ts`）。
- 导演台按集：`episodeId`、默认第一集、旧片段自动归第一集、空集自动挂空片段、单片段禁用横向滚动。
- 开源库已彻底移除（入口/页面/抽屉段/@ 面板/数据）。
- 工具栏规范：见 `DESIGN.md`「模块工具栏统一规范」；剧本页集数最左、撤销/重做/版本带文本、右侧显示标签/问AI/统计。
- MCP：`ensure_project_ready`、`audit_upgrade`、`consolidate_scenes`、`set_global_style`、`set_subject_image` 同一张脸门槛、Qwen 32 对齐。
- 测试基线：主体 46、导演台 42、MCP guides 9、style 4 等；`pnpm typecheck` 通过。

## 3. 关键文件

| 作用 | 文件 |
|---|---|
| 状态编辑页/主体库 | `src/features/canvas-nodes/storyboard/subject-library-pages.tsx` |
| 状态树类型 | `src/features/canvas-nodes/storyboard/subject-tree-types.ts` |
| 画布图片生成（Qwen） | `src/pages/editor/editor-canvas/interactions/local-qwen-image.ts` |
| 画布作业/模型 key | `src/features/canvas-tabs/zeroexo-jobs-client.ts`、`qwen-limits.ts` |
| 画布图片节点参数面板 | `src/features/tools-dock/local-qwen-param-form.tsx`、`node-generate-dock.tsx` |
| 全剧风格 | `src/shared/style-presets.ts`、`style-shot-guides.ts`、`global-style.ts` |
| 导演台 | `src/features/canvas-tabs/workbench-tab-content.tsx`、`director-pack-builder.ts` |
| 素材抽屉 | `src/features/canvas-assets/{store.ts,groups/MaterialGroup.tsx,groups/HistoryGroup.tsx,CanvasAssetsPanel.tsx}` |
| MCP | `mcp-server/src/tools/{subjects,style,upgrade}.ts`、`store/storyboard.ts` |

## 4. 实施顺序（建议）

### P0：状态页直接生成 + 进度持久化（已完成 2026-11-13）

1. **参数契约**：`SubjectTreeNode.genParams`（`aspect/quality/width/height/steps/cfg/seed/useBaseRef/referenceKeys`），缺省 16:9 · 2K · Qwen 25 步，随树持久化。
2. **状态页底部参数行**：比例 / 1K·2K·自定义 / 步数 / 种子 / 引用基础状态 + 「生成」，全部写回 `genParams`，刷新保留。
3. **任务模型**：`SubjectTreeNode.genJob`（jobId/clientId/model/state/progress/error），进度每 ≥10% 落盘；页面重新挂载按 jobId 续接，不重复提交。
4. **生成执行**：`subject-generation.ts` 复用 `local-qwen-image` / `local-moss-image` / `local-krea2-image`；基础状态走文生图，派生状态默认引用基础图，显式参考素材优先。
5. **状态卡预览**：生成中显示进度/预览帧，完成后把 CAS 结果挂到该状态并刷新卡片；失败保留原因可重试。
6. **参考素材**：编辑面板顶部新增参考素材输入区，打开统一资产选择页（画布/资产/主体）；「发送到画布」保留，供长链修改。

### P1：风格真正接入主体生成

- 生成参数里带 `stylePrompt`（来自 `script.meta.visualStyle`，与导演台同源）；`useBaseRef` 为 true 时拼「保持基础状态外观，仅改…」。
- 不要只在提示词末尾追加一行；派生状态提示词结构：
  `基础身份锚点 + 本状态变化 + 模板（三视图/单图/白底）+ 全剧风格 + 硬约束`。
- 风格切换后，已有状态提示词/时长需要重写：MCP `set_global_style` 返回 `restyleHint`，前端提示「重写要求」；不要静默覆盖。

### P2：批量

- 多选工具条：全选 / 改类型 / **改生图模型** / **批量生成**。
- 批量页：逐状态模型/模板/引用基础/进度/错误；支持整批改模型后一次跑；失败的单独重试。

### P3：素材类目收尾

- 画布类目 = 画布素材 + 画布生成产物（生成即落「画布」）；独立「历史」入口已删除。
- 导演台类目 = 导演台生成产物，直接展示（仅视频）；不再出现「从画布生成 / 从导演台」子页签。
- 主体类目保持主体自己的分类。

## 5. 约束与坑

- **版本**：每次 push 前 `pnpm version:bump`；一次 push 一个版本；当前 0.2.66。
- **构建**：Windows 下 `pnpm build` 的 esbuild 临时文件删除会 `Access is denied`；先设
  `$env:TEMP='D:\AICode\zeroexo\zeroexo-comfyui\.tmpbuild'; $env:TMP=$env:TEMP`，构建后删目录。
  `.tmpbuild` 已加 `.gitignore`。
- **Qwen 尺寸**：32 对齐（`clampQwenEdge` 已改 32），否则 `tensor 64 vs 32`；输入/遮罩/输出必须同尺寸。
- **不要**把 `sceneId/camera/REF-槽位/错误码` 暴露给用户；界面只讲人话。
- 主体图：角色单人同一张脸；已有多图时再挂图必须 `samePersonConfirmed:true`。
- 场景：一个地点一个主体，子区域是状态；提取后 `consolidate_scenes` dryRun→确认。
- 生成参数（比例/尺寸/步数/种子/张数）不许猜，必须用户选或明确用推荐值。

## 6. 验收（新会话做完 P0 后逐条打勾）

- [x] 状态页可选 Qwen/Krea2/Moss + 比例/尺寸/步数/种子/模板，刷新后保留。
- [x] 点「生成」不跳画布，状态卡立即显示「生成中」与进度。
- [x] 关闭页面/切页签再回来，进度仍在；完成后图自动挂到该状态（按树内 genJob 续接）。
- [x] 派生状态默认带基础状态图作参考；关掉「引用基础状态」后走纯文生图。
- [ ] 生成时使用全剧风格；风格切换提示重写，不静默覆盖（P1，未做）。
- [ ] 批量：改模型 + 批量生成 + 失败重试可用（P2，未做）。
- [x] `pnpm typecheck`、相关 vitest 通过；版本号已 bump。

## 7. 上一轮未完成、需要新会话确认

- 画布历史并入「画布」类目、删独立历史分组（P3，未做）。
- 主体页当前「风格」只是提示词末尾一行，生成参数尚未接全剧风格（P1，未做）。
- 素材类目只做了「全局/画布/导演台/主体」骨架；导演台段的类型 chips 仍是历史组件的全部/图片/视频（应只视频）。
