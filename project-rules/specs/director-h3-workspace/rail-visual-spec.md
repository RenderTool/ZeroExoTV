# 导演台导轨视觉规格（rail-visual-spec）

> 2026-11-05 参考图修订。覆盖早期「选中卡 2px 黑框 + 深灰实底徽标 + 箭头压交界」口径。
> 适用范围：导演台（WorkbenchTabContent）导轨卡片、段间衔接箭头、六态角标。
> 出片页（WorkbenchSheet）不传入新 props，渲染保持原样。

## 1. 参考实现对照

| 参考图特征 | 实现落点 |
|---|---|
| 每段 = 圆角缩略框，无产物居中播放三角 | `TimelineClip` 导演台分支：`[data-director-thumb]` + `[data-director-empty]` |
| 缩略框下方一行 `片段 01 · 10s` | `[data-director-label-row]`，i18n `storyboard.clipLabel` |
| 未选中整卡压暗、选中更亮 | 卡片 `opacity`：静息 0.62 / hover 0.85 / 选中 1 |
| 选中 = 细亮描边 + 边框略亮 | `outline: 1px rgba(226,232,240,0.88)`（深色；内缩 1px）+ `border: 1px rgba(226,232,240,0.60)` + 中性柔和外发光。2026-11-05 用户指令：选中态去绿色（旧 `#00c758` 描边已废弃），绿色只保留给段间衔接箭头 |
| 段与段之间用方向性接续标记连接 | `[data-continuity-arrow]` 34×22、置于两卡间隙中心；glyph = 起点实心圆点（前段一侧）+ 连接线 + 右向单箭头（指向本段），stroke/fill `#00c758`、宽 1.7、round；**2026-11-06 起承载于项目同款深色胶囊**（半透明底 + 1px 细描边 + 圆角 5 + 柔和阴影 + hover 绿描边/外发光）；旧的「无底色/无描边/无胶囊」与 ⇄ 双向箭头均已废弃 |
| 导轨高度固定、无高度分割线 | 导演台 `railHeightFixed`：删除 `[data-wb="rail-resize"]` 手柄，轨道区高度 = `DIRECTOR_RAIL_HEIGHT` 常量 |
| 有产物 = 首帧 + 圆形播放键 + 右下角时长角标 | 首帧取值：会话内 URL（`blob:`）直通 → 持久化 `firstFrameKey` 经 `resolveMediaUrl` 解析 → 无 `firstFrameKey` 时视频 seek 0.5s 单帧兜底（模块级缓存）；`[data-director-play]` 34×34；`[data-director-duration]` 紧凑秒数 |
| 六态徽标叠在缩略框角上 | `[data-clip-badge]` 位于缩略框右上角（top 4 / right 8），不占标签行 |
| 时长只读、不可拖拽 | 无 trim handle / `ew-resize` / `onTrim` 写回；`片段 NN · XXs` 仅派生自参数 `shot.duration` |
| 无白色条/缝、上方无横向边线 | 段间只留 6px 背景间隙；工具行 `borderBottom` 与内层时间轴 `borderTop` 在导演台不渲染 |

## 2. 卡片结构图

```
┌─ 缩略框（宽 × 0.62，圆角 4，overflow hidden）─────────────┐
│  [{六态角标}]                                    [播放键 34] │
│  首帧 / 视频兜底帧 / 无产物：居中 ▶ + 「暂无首帧」            │
│                                        [时长角标 05]（右下） │
└──────────────────────────────────────────────────────────┘
  标签行（20px，左对齐）：片段 01 · 5s
```

- 卡片内边距 6px；卡片高度 = `round(宽度×0.62) + 标签行 20 + 上下 padding 12`。
- 220 → 168px；180 → 144px；160 → 131px。宽度档位仍是 220/180/160，间距 6px。
- 高度只由宽度档位推导，不提供用户拖拽入口。

## 3. 选中 / 悬停 / 静息取值

> 2026-11-05 用户指令：选中态不用绿色（也不用品牌红）——选中描边/阴影统一中性亮色，
> 深色=冷白 `226,232,240`、浅色=暖灰 `68,64,60`（与空画布引导层同一中性口径）。
> 批量模式勾选块（=选中语义）同改用该中性亮色；`#00c758` 仅保留在第 5 节衔接箭头。

| 项 | 浅色 | 深色 |
|---|---|---|
| 卡片底 | `linear-gradient(135deg, #ffffff, #f4f4f5)` | `linear-gradient(135deg, #1b1c1f, #141518)` |
| 静息边框 | `1px rgba(15,23,42,0.10)` | `1px rgba(255,255,255,0.10)` |
| hover 边框 | `1px rgba(15,23,42,0.18)` | `1px rgba(255,255,255,0.18)` |
| 选中边框 | `1px rgba(68,64,60,0.50)` | `1px rgba(226,232,240,0.60)` |
| 选中 outline | `1px rgba(68,64,60,0.80)`，offset −1px | `1px rgba(226,232,240,0.88)`，offset −1px |
| 选中阴影 | `0 0 0 1px rgba(68,64,60,0.16), 2px 4px 10px rgba(15,23,42,0.10), 0 6px 16px rgba(15,23,42,0.12)` | `0 0 0 1px rgba(226,232,240,0.20), 0 2px 8px rgba(0,0,0,0.45), 0 8px 20px rgba(0,0,0,0.30)` |
| hover 阴影 | `0 1px 2px rgba(15,23,42,0.06), 0 4px 10px rgba(15,23,42,0.08)` | `0 2px 8px rgba(0,0,0,0.35)` |
| 卡片 opacity | 0.62 / hover 0.85 / 选中 1 | 同左 |
| 选中抬高 | `top = TRACK_CLIP_TOP − 2px`（保持 transform 为 none，不干扰拖拽），zIndex 2 | 同左 |
| 标签文字 | `#1c1917` | `#e6e7e9` |
| 缩略框底 | `linear-gradient(135deg,#f4f4f5,#e7e5e4)` | `linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.10))` |
| 无产物图标/文案 | `#78716c` | `#a8a29e` |

Outline 内缩 1px + 缩略框 `overflow:hidden`，播放键/角标均在缩略框内部，层级低于卡片描边，不会压住选中描边。

## 4. 六态角标

统一：半透明底 + 1px 细描边 + 6px 色点；字号 8 / 字重 500；圆角 4（与卡片一致）。
未生成=中性灰、排队=蓝、生成中=绿脉冲、完成=绿、失败=红、已取消=灰虚线。

| 状态 | 浅色 文字 / 色点 / 底 / 描边 | 深色 文字 / 色点 / 底 / 描边 |
|---|---|---|
| idle 未生成 | `#44403c` / `#78716c` / `rgba(120,113,108,0.10)` / `rgba(120,113,108,0.30)` | `#d6d3d1` / `#a8a29e` / `rgba(255,255,255,0.06)` / `rgba(255,255,255,0.14)` |
| queued 排队 | `#1d4ed8` / `#3b82f6` / `rgba(59,130,246,0.10)` / `rgba(59,130,246,0.35)` | `#93c5fd` / `#60a5fa` / `rgba(96,165,250,0.12)` / `rgba(96,165,250,0.35)` |
| generating 生成中 | `#047857` / `#22c55e` / `rgba(34,197,94,0.12)` / `rgba(34,197,94,0.40)` | `#86efac` / `#22c55e` / `rgba(34,197,94,0.14)` / `rgba(34,197,94,0.40)` |
| done 完成 | `#15803d` / `#22c55e` / `rgba(34,197,94,0.12)` / `rgba(34,197,94,0.35)` | `#86efac` / `#22c55e` / `rgba(34,197,94,0.14)` / `rgba(34,197,94,0.35)` |
| failed 失败 | `#b91c1c` / `#ef4444` / `rgba(239,68,68,0.12)` / `rgba(239,68,68,0.35)` | `#fca5a5` / `#ef4444` / `rgba(239,68,68,0.14)` / `rgba(239,68,68,0.35)` |
| cancelled 已取消 | `#57534e` / `#a8a29e` / `rgba(120,113,108,0.08)` / `dashed rgba(120,113,108,0.40)` | `#cbd5e1` / `#94a3b8` / `rgba(148,163,184,0.10)` / `dashed rgba(148,163,184,0.40)` |

生成中的色点使用 `zx-director-badge-pulse`（1.2s 缩放/透明度脉冲）。
六态文字对卡片底对比度均 ≥ 4.5:1（单测覆盖浅/深两套）。

## 5. 段间箭头

- 尺寸：34×22 占位（`box-sizing: border-box`，加边不撑大命中区），统一尺寸、不随 220/180/160 档位变化；单向 glyph 22×10 viewBox（`-11 -5 22 10`）、stroke 1.7、round。
- 位置：`left = 下标×pitch − 17 − 3`（间隙中心 = 交界 − 3，占位半宽 17）；`top = 7 + 卡片高/2 − 11`（= 卡片顶 + 卡片高/2 − 占位半高，与卡片垂直居中）。
- 造型（2026-11-06 用户指令「要像这个项目该有的 UI」）：项目同款深色胶囊——半透明底 + 1px 细描边 + 圆角 5 + 柔和阴影。胶囊 token 集中在 `directorArrowTone()`（`surface / border / hoverBorder / shadow / hoverShadow`，深浅两套），组件不写死只对暗色成立的色值。绿色 glyph 保留：浅色 `#0a8a43` / 静息 opacity 0.62，深色 `#00c758` / 静息 opacity 0.86（征集 #176 状态色契约：绿色只用于段间衔接语义）。
- 交互：静息按 token 不透明度，hover 回 1 + 描边转绿 + 外发光（0.12s 过渡）；胶囊只承载造型，不改变命中区、几何与位置公式。
- 修正记录：2026-11-05 去掉白色胶囊底与描边、放大占位与线宽；**2026-11-06 用户判定该荧光细线造型「根本不像这个项目该有的 UI」，改回胶囊形态**——改用深色半透明底而非白底，不触发 §9 白条回归；几何/配色/不透明度沿用原值。

| 档位 | 卡片宽 | 卡片高 | pitch | 箭头 left（段 2 交界） | 箭头 top | 占位 |
|---|---|---|---|---|---|---|
| 220 | 220 | 168 | 226 | 206 | 80 | 34×22 |
| 180 | 180 | 144 | 186 | 166 | 68 | 34×22 |
| 160 | 160 | 131 | 166 | 146 | 61.5 | 34×22 |

- 纵向范围 = 卡片中心 ±11px，全部落在缩略框高度内，不触及底部 20px 标签行；横向以间隙中心对称，glyph 半宽 11px 中 3px 落在 6px 间隙、8px 压入卡片（其中 6px 为卡片内边距，仅缩略框边缘 2px 被覆盖），不影响标签行与卡片宽度/段间距。

## 6. 固定高度与「无高度拖拽」

- `DIRECTOR_RAIL_HEIGHT = 34(工具栏) + 4(滚动区 padding) + (directorCardHeight(220)+16)(轨道行) + 8(轨道区底部 padding) = 230px`。
- 导演台传入 `railHeightFixed`：不渲染 `[data-wb="rail-resize"]` 分割手柄，不存在 `row-resize` 光标与高度拖拽 state/cursor 逻辑。
- 窗口变化只影响横向档位（220/180/160），纵向高度恒为 230px。
- 出片页未传 `railHeightFixed`，保留原有高度拖拽（不属于导演台导轨范围）。

## 7. 播放键行为

点击缩略框中央播放键 = 选择该段并把右侧预览区切到该段（有产物则可播，无产物显示状态占位）；
不触发就地播放、不启动拖拽（`onPointerDown` 已阻止冒泡）。

卡片缩略框显示规则（只影响首帧/预览取值，不改尺寸与布局）：

| 状态 | 缩略框内容 | 播放键 | 时长角标 |
|---|---|---|---|
| 有首帧（`blob:` 会话 URL 或 `firstFrameKey` 解析成功） | 首帧图（`objectFit: cover`） | 有 | 有 |
| 无 `firstFrameKey`、有视频（`videoKey`） | 视频 seek 0.5s 单帧截图 | 有 | 有 |
| 首帧/取帧失败 | 居中 ▶ + 「首帧加载失败」 | 有 | 有 |
| 无首帧且无视频 | 居中 ▶ + 「暂无首帧」 | 无 | 无 |

- `firstFrameKey` / `videoKey` 均为 storageKey（`image:` / `video:` / `cas:`），必须先经平台媒体层 `resolveMediaUrl` 解析成可渲染 URL，禁止把 storageKey 直接交给 `AuthorizedImage`（它只接受 http/blob/data URL）。
- 解析失败不留空白：有视频仍可播放，文案明确为「首帧加载失败」。

## 8. 片段时长：不可拖拽、只读展示、来源 = 参数

- 导演台**不提供**任何时长拖拽入口：卡片左右边缘 trim handle、拉伸热区、`cursor: ew-resize`、`onTrim` → `duration` 写回，以及「trim handle 收进 6px 内边距」的实现全部删除。
- `WorkbenchMultiTrack` 向 `StoryboardTimeline` 传 `trimEnabled={!zeroBaseRail}`；导演台 `onTrimStart = undefined`，`TimelineClip` 导演台分支永不渲染 `[data-clip-trim]` / `.zx-clip-trim`。
- 时长唯一来源 = **参数**（参数区/预检里的 shot 时长）。卡片标签行 `片段 NN · XXs` 只读派生，参数变化时数值同步变化，不依赖任何指针拖拽。
- `WorkbenchTabContent` 不再向导轨注入 `onTrim`；`WorkbenchMultiTrack` 删除「右缘 TRIM_HANDLE_WIDTH 内不启动拖拽」的命中区排除——整卡任意位置都可启动**重排拖拽**（排序逻辑不变）。
- 出片页仍走共享 `trimEnabled=true` 的 trim 路径，不属于本规格范围；导演台不动排序、不动数据、不动 220/180/160 档位。
- 单测：`[data-clip-trim]` / `.zx-clip-trim` / `ew-resize` 三处计数 = 0；duration 5→9 时标签行同步变为 `片段 01 · 9s`；既有重排拖拽用例全部仍通过。

## 9. 白条清理与「上方无分割线」

**段间与卡片（禁止纯白）**

- 段间只允许 **6px 背景间隙**，不绘制白色竖缝、白色分隔条、白色线；分隔靠背景对比，不靠白线。
- 禁止纯白/近白：`#fff`、`white`、`rgba(255,255,255,0.8~1)`；若确需边界，仅允许浅色 `rgba(15,23,42,0.08)` / 深色 `rgba(255,255,255,0.12)`，且不得用于段间。
- 卡片外圈无白色描边、选中态外无白色 outline；选中只用 accent `#00c758`。
- 刻度尺/播放头在导演台整项不渲染，不存在白色竖线。
- 导轨滚动条不再用白色细条：`.zx-director-rail` 覆盖为中性灰 `rgba(120,113,108,0.32)`（hover 0.5）；出片页 `.zx-timeline-scroll` 保持原样。

**上方两条横向边线（已删）**

| 位置 | 文件:行 | 原取值 | 处理 |
|---|---|---|---|
| 工具行下沿 | `workbench-multitrack.tsx:801` | `borderBottom: 1px solid C.border`（浅 `rgba(0,0,0,0.10)` / 深 `rgba(255,255,255,0.08)`） | 导演台 `zeroBaseRail` 下不渲染 |
| 内层时间轴容器上沿 | `storyboard-timeline.tsx:1041` | `borderTop: 1px solid C.border` | 导演台 `noTopBorder` 下不渲染 |

- 只删这两条；卡片内部边界（缩略框圆角、标签行、角标细描边）与其它任何边框的颜色/粗细均未改动。
- 单测：深/浅各一条，断言工具行 `borderBottomWidth` 与时间轴容器 `borderTopWidth` 均为 0；扫描导轨内纯白边框/细条 = 0。

## 10. 代码落点

- tokens：`src/features/canvas-nodes/storyboard/timeline-constants.ts`
  （`directorRailTone` / `directorBadgeTone` / `directorArrowTone` / `directorCardHeight` / `DIRECTOR_RAIL_HEIGHT`）
- 卡片：`src/features/canvas-nodes/storyboard/timeline-clip.tsx`
- 行高透传：`storyboard-timeline.tsx`（`cardHeight`） / `workbench-multitrack.tsx`（`railCardHeight`）
- 固定高度：`storyboard-merged-tab.tsx`（`railHeightFixed`）
- 时长只读：`workbench-tab-content.tsx`（不注入 `onTrim`） / `workbench-multitrack.tsx`（`trimEnabled={!zeroBaseRail}`、删除 trim 命中区）/ `storyboard-timeline.tsx`（`trimEnabled`）/ `timeline-clip.tsx`（导演台不渲染 trim handle）
- 上方无边线：`workbench-multitrack.tsx:801`（工具行下沿）/ `storyboard-timeline.tsx:1041`（容器上沿，`noTopBorder`）
- 白条清理：`app.css`（`.zx-director-rail` 滚动条中性灰）
- 箭头：`src/features/canvas-tabs/workbench-tab-content.tsx`
