# 技能：参数与 H3 延续法（params）

> 适用：片段与提示词都齐了，要装配公共参数、准备出片。

## 1. 参数键位（写错键 = 页面参数面板读不到）

`set_shared_params({ presetId:"h3", params:{…} })` 的键必须来自 DIRECTOR_PARAM_SCHEMA：

- 画面：`aspect`（16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9）、`scaleFactor`（0.1–2，**目标百万像素**：1MP = 1024²），
  同步落 `width`/`height`（面积 = 系数×1024²，按比例开方后 32 对齐；1.0 = 1376×768、1.5 = 1664×928、2.0 = 1920×1088）。
- 采样：`steps`、`cfg`、`seed`、`sampler`、`scheduler`、`shift_video`、`shift_audio`、`frame_rate`（恒 24）。
- 时长：`total_frames`（24fps，17k+5 吸附：8s=192 / 10s=243 / 12s=294 / 15s=362）。
- 引导：`continuityEnabled`（主开关）、`continuityOverlapFrames`（5/22/39/56，默认 22）、`continuityMode`（guide|continue）、`continuityRedraw`（0.10）、`refImageSize`（match|1024|1280|1536|max）。
- 其它：`task_type`、`exportMode`、`audioMode`、`commonEnabled`、`cache_frames_codec`。

**禁止自造键**（width/frames/guide_frames 这种在旧 handoff 里出现过的写法），页面参数面板只认上面这套。

## 2. 参数必须问用户（硬规则）

- 生产值不许模型自定：`aspect`、`scaleFactor`、`steps`、`cfg`、`seed`、`continuityOverlapFrames`、每段时长，逐项确认后才写。
- 用户说「按默认」时才用：16:9 / 864×480 / steps 8 / cfg 1.0 / seed 0 / 引导 22 帧。

### 机器与推荐参数（2026-11-13 用户拍板）

- **成片视频推荐 48GB 显存**；24GB 机器只适合预览 / 短片段，不要当正式出片配置。
- **预览**：`refImageSize="match"`、`steps=8`、`scaleFactor=0.4`。
- **成片**：`scaleFactor=1.7–1.8`。
- **图片**：以原图为参考，按官方 2K 口径（最长边 2048、16 对齐）写参数；**2K 只是参数层面**，不承诺最终像素；尺寸系数取 1.7–1.8。
- 以上仍是推荐值，必须让用户确认后再写，不要替用户拍板。

### 图片（QwenImage2.1）与视频不是一套默认

- **图片默认 25 步**（视频才是 8 步），cfg 1.0；用户说「按默认」才用这组。
- 尺寸：最长边 ≤2048、16 对齐；有参考图可「跟随原图」，否则按比例选 1K/2K 档。**用户必须明确说尺寸或明确同意推荐值**，不要替他拍板。
- 提示词：有输入图时必须点名「参考图1」（前端已自动加前缀），否则 Qwen 会当文生图重画；角色定妆写死「画面共几个」（正面特写 + 正面全身 + 背面全身，共 3 个画面），不要写「三视图」这类会诱导模型加侧视图的名字。

## 3. 自检/联调用小参数（用户明确同意后才用）

联调只验链路，不验画质，**越小越快**：

```json
{ "aspect": "16:9", "scaleFactor": 0.5, "width": 608, "height": 352,
  "total_frames": 49, "steps": 1, "cfg": 1.0, "seed": 1,
  "continuityEnabled": false, "continuityOverlapFrames": 22, "frame_rate": 24 }
```

## 4. H3 延续法机制（决定段怎么切）

代码依据 engine/segment_continuity.py：

| 项 | 值 / 行为 |
|---|---|
| 上下文帧 | continuityOverlapFrames，5/22/39/56，默认 22；锁定帧 = 17k+5 吸附(overlap) |
| 锁帧 | 前「锁定帧」帧是硬锁（mask=1.0，无羽化），只作条件延续 |
| 燃烧帧 | 锁帧后 12 帧（CONTINUITY_SETTLING_FRAMES），防 hold→pop |
| 前瞻 | 段末 8 帧（CONTINUITY_SOURCE_LOOKAHEAD），仅为对齐覆盖 |
| 采样/导出 | 采样 = 17k+5(锁帧 + 12 + 可见 + 8)；导出只留可见帧，段间首尾直拼 |
| 模式 | guide（默认，前段作条件引导）/ continue（latent 续接，is_continue_mode() 仅在 continuityMode=continue 时为真） |
| 重绘比 | continuityRedraw，默认 0.10，从 timeline.output.continuityRedraw 读 |

写法结论（两种模式一样）：提示词正文不写接缝/承上/上一段落幅这类调度词——接缝由引擎锁定帧实现，写进正文反而干扰。
差异只在参数：continuityEnabled / continuityMode / continuityOverlapFrames / continuityRedraw。



## 5. 出片前检查（报给用户，不擅自跑）

槽位是否超限（图 ≤9 / 音 ≤3 / 视 ≤3）、缺图主体、超时长片段、total_frames 与段时长是否一致、seed 是否重复；确认后由用户在前端点运行。