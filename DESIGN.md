---
name: ZeroExo Frontend
description: ZeroExo 前端（C 端）的设计系统规范 — 标准化版
version: 1.0.0
colors:
  primary: "#e94560"
  primary-hover: "#ff6b7a"
  success: "#10b981"
  warning: "#f59e0b"
  error: "#ef4444"
  info: "#3b82f6"
  text-primary: "#1c1917"
  text-secondary: "#57534e"
  text-tertiary: "#a8a29e"
  border: "#e7e5e4"
  border-secondary: "#d6d3d1"
  bg-page: "#ffffff"
  bg-container: "#f5f5f4"
  bg-elevated: "#fafaf9"
  bg-dark: "#161412"
typography:
  display:
    fontFamily: "'Sora', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontWeight: "700"
  body:
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontWeight: "400"
  mono:
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace"
    fontWeight: "500"
  h1:
    fontSize: 24px
    fontWeight: 700
    letterSpacing: -0.025em
  h2:
    fontSize: 20px
    fontWeight: 600
    letterSpacing: -0.025em
  h3:
    fontSize: 18px
    fontWeight: 500
  body:
    fontSize: 14px
    lineHeight: 1.625
  caption:
    fontSize: 12px
    color: "{colors.text-secondary}"
  small:
    fontSize: 11px
    color: "{colors.text-secondary}"
rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 14px
  full: 9999px
spacing:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  xxl: 24px
layout:
  nav-height: 54px
  stage-toolbar-height: 42px
  sidebar-expanded: 220px
  sidebar-collapsed: 60px
  icon-btn: 32px
  avatar-size: 24px
components:
  card:
    backgroundColor: "{colors.bg-container}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-page}"
    rounded: "{rounded.sm}"
    height: 32px
  button-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg-page}"
    rounded: "{rounded.md}"
    height: 44px
  modal:
    backgroundColor: "{colors.bg-page}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    centered: true
  toolbar:
    height: 32px
    gap: 8px
  input:
    rounded: "{rounded.sm}"
    height: 36px
  select:
    rounded: "{rounded.sm}"
    height: 36px
  tag:
    rounded: "{rounded.full}"
    fontSize: 11px
---

## Overview

**ZeroExo Frontend** — 面向 C 端用户的 AI 视频创作平台，融合创意构思与制作交付。设计语言追求 **"Warm Technical"**（温暖技术感），在专业工具与新手引导之间取得平衡。

暗色主题使用深暖灰（`#161412`）而非纯黑，避免冰冷感。亮色主题使用纯白（`#ffffff`）背景。主色（`#e94560`）为克制的红色，用于选中状态、激活指示器和主要操作。

系统避免玻璃态、重渐变和装饰性元素。表面采用平面设计配合微妙边框分割。深度通过阴影和透明度层级而非模糊效果实现。

## 实施方式

### 1. 主题系统 — `@zeroexo/plugin-theme` + `AntdThemeProvider`

所有设计令牌通过 `@zeroexo/plugin-theme` 的 `useTheme()` 钩子获取，并通过 `AntdThemeProvider` 映射到 antd 的 ConfigProvider 主题配置。

```tsx
// antd-theme-provider.tsx（已实现）
<ConfigProvider theme={{
  cssVar: { key: 'zx' },
  algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: {
    zIndexPopupBase: 20000,
    colorPrimary: theme.toolbar.accent,       // #e94560
    colorBgLayout: theme.canvas.background,
    colorBgContainer: theme.toolbar.background,
    colorText: theme.toolbar.text,
    colorTextSecondary: theme.toolbar.textMuted,
    colorBorder: theme.toolbar.border,
    colorError: theme.toolbar.danger,
    borderRadius: 8,
    fontSize: 13,
  },
  components: { /* 详见 antd-theme-provider.tsx */ },
}}>
  {children}
</ConfigProvider>
```

### 2. CSS 变量 — Tailwind CSS `@theme`

Tailwind CSS 的 `@theme` 指令中定义全局设计令牌，`.css` 文件中使用 Tailwind 工具类。

### 3. JS 设计令牌 — `LAYOUT_CONSTANTS.ts`

布局常量通过 `@/shared/components/LAYOUT_CONSTANTS.js` 中的 `LAYOUT` 对象引用，禁止硬编码。

## Colors

### 主题令牌结构

`@zeroexo/plugin-theme` 的 `ThemeConfig` 包含 5 个类别，每个类别有明暗两套值：

| 类别 | 说明 | 明色值 | 暗色值 |
|------|------|--------|--------|
| `canvas.background` | 画布/页面背景 | `#ffffff` | `#161412` |
| `toolbar.background` | 导航栏/工具栏/面板背景 | `#ffffff` | `#161412` |
| `toolbar.accent` | 主色 — 选中/激活/主要操作 | `#e94560` | `#e94560` |
| `toolbar.text` | 主要文本色 | `#1c1917` | `#f5f5f4` |
| `toolbar.textMuted` | 次要文本色 | `#57534e` | `#a8a29e` |
| `toolbar.border` | 所有边框/分割线 | `#e7e5e4` | `#44403c` |
| `toolbar.danger` | 危险操作色 | `#ef4444` | `#ef4444` |
| `node.fill` | 卡片/表面填充 | `#f5f5f4` | `#1c1917` |

### 状态色（Stage Colors）

用于多步骤工作流中的状态指示：

| 令牌 | 值 | 用途 |
|------|-----|------|
| `STAGE_COLORS.completed` | `#10b981` | 已完成步骤、确认徽标 |
| `STAGE_COLORS.active` | `#3b82f6` | 当前步骤、进行中指标 |
| `STAGE_COLORS.action` | `#8b5cf6` | 主要操作按钮（"下一步"） |
| `STAGE_COLORS.assist` | `#a78bfa` | 次要/建议性操作（"询问 AI"） |

### 颜色使用规则

- `accent`（#e94560）仅用于**选中状态**、**激活指示器**和**主要操作**，不得大面积作为背景填充
- 暗色模式下，accent 不得作为大段文本的主色（影响可读性）
- 所有图标使用 `currentColor` 继承父级颜色，不硬编码图标色值
- 白色主题图标默认 `#1c1917`，暗色主题默认 `#f5f5f4`

### 禁止绿色（2026-11-05 用户明确）

- **不得**使用 `#00c758` / `#0a8a43` / `#22c55e` / `#16a34a` / `#10b981` / `#4ade80` / `rgba(0,199,88,*)` / `rgba(34,197,94,*)` 作为页面的品牌色、强调色或选中态颜色。
- 强调色只有一处来源：`theme.toolbar.accent`；危险操作只有一处来源：`theme.toolbar.danger`。
- 绿色只允许作为**状态语义点**（`STAGE_COLORS.completed` 等完成/进行中的小圆点、进度条），**禁止**用于主按钮、选中描边、筛选选中态、页面强调。
- CSS/token 文件中出现新的绿色字面量即视为违规；新页面一律从 `theme.toolbar.*` 取色。

## Typography

### 字体栈

| 角色 | 字体 | 字重 | 用途 |
|------|------|------|------|
| Display | Sora | 600–700 | 标题、品牌文字 |
| Body | DM Sans | 400–500 | 正文、标签、按钮 |
| Mono | JetBrains Mono | 500 | 代码、元数据 |

### 字号阶梯

| 层级 | 尺寸 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| h1 | 24px | 700 | — | 品牌标题 |
| h2 | 20px | 600 | — | 页面标题 |
| h3 | 18px | 500 | — | 卡片标题 |
| body | 14px | 400 | 1.625 | 正文默认 |
| caption | 12px | 400 | — | 辅助文字 |
| small | 11px | 400 | — | 极小标注 |
| button | 13px | 500 | — | 按钮文字 |
| label | 11–12px | 500 | — | 表单标签 |
| mono | 12px | 500 | — | 等宽文字 |

### 字体加载策略

字体文件采用**项目资源优先 + CDN 备选**策略：
1. 字体文件通过 `@fontsource-*` 包管理或放在 `public/fonts/`
2. HTML 中通过 `<link rel="preconnect">` 预连接到 Google Fonts CDN
3. `font-family` 末尾始终包含系统字体栈备选

## Layout & Spacing

### 双层布局系统

**Tier 1 — 全局层**（列表/管理页面：首页、创作、资产、提示词）

```
应用布局壳 (AppLayout)
├─ 顶部栏 (54px) — AppTopBar
│  Logo | 菜单项 | 搜索 | 用户操作
├─ 侧边栏 (可选) — AppSidebar
└─ 内容区 (flex:1)
   └─ 页面内容 (overflow: auto)
```

**Tier 2 — 编辑器层**（详情/编辑页：画布编辑器、创作详情）

```
antd Layout (自有 Header+Content)
├─ 顶部栏 (54px) — 编辑器 TopBar
│  左侧操作区 | 右侧操作区
└─ 内容区 (flex:1)
   ├─ 侧边栏 (可选)
   └─ 主区域 (画布/舞台内容)
```

### 高度常量

| 组件 | 高度 | 常量 |
|------|------|------|
| TopNav / TopBar | 54px | `LAYOUT.NAV_HEIGHT` |
| StageToolbar | 42px | `LAYOUT.STAGE_TOOLBAR_HEIGHT` |
| Sidebar (展开) | — | `LAYOUT.SIDEBAR_EXPANDED` (220px) |
| Sidebar (收起) | — | `LAYOUT.SIDEBAR_COLLAPSED` (60px) |

### 页面布局模式

所有列表/管理页面遵循以下模式：

```
page container (height: 100%, flex column, overflow: hidden)
├─ toolbar: flex row, padding 12–20px
│  ├─ 标题 (左)
│  └─ 搜索 + 图标按钮 + 新建 (右，全部有 Tooltip)
└─ content: flex: 1, overflow: auto, padding 20px
   └─ grid: auto-fill, minmax(280px, 1fr), gap: 20px
      └─ Cards (aspect-ratio: 16:9)
```

### 间距体系

基础间距单位 **8px**，所有 gap/padding/margin 应为此倍数：

| 值 | 常见用途 |
|----|----------|
| 4px (0.5x) | 分割线高度、圆点间距 |
| 8px (1x) | 按钮内边距 Y、元素 gap |
| 12px (1.5x) | 元素 gap、卡片内边距 X |
| 16px (2x) | 页面 padding (桌面)、gutter、卡片内边距 |
| 20px (2.5x) | 页面 padding (桌面)、卡片网格 gap |
| 24px (3x) | 卡片网格 padding、区块间距 |

## Components

### 页面容器
- 所有列表/管理页面使用 `AppLayout`（antd Layout 的封装，增加移动端适配和主题注入）
- 编辑器页面直接使用 antd Layout，不包裹 `AppLayout`

### 主体库页（三级页面，2026-11-05）
规格见 `project-rules/specs/subject-library-ui/spec.md`，实现见 `features/canvas-nodes/storyboard/subject-library-pages.tsx`。

- 三级结构：列表页（主体卡网格）→ 主体状态页（状态卡网格）→ 状态编辑页；三级共用**一个页头**：面包屑 + 计数徽标 + 右侧主操作。
- 面包屑：当前层级 = 页面标题（16/600），祖先层级 = 次级导航（11/500 muted）；不使用 18px 自造标题。
- 卡片一律走 `@/shared/ui`（`CardShell` / `Badge` / `IconButton` / `uiCardNameStyle` / `uiCardMetaStyle`），**禁止**再新建一套卡片 token；类型角标统一 `Badge tone="neutral"`，业务类型不承载颜色。
- 工具栏：搜索用 antd `Input`（240 + prefix 图标 + `allowClear`）；分类筛选用**下划线 Tab**（36 高 / 13px / 选中主文本色 + 2px accent 下划线 + 11px 计数）；次级筛选用 antd `Button size="small"`。
- 卡内动作：悬停/聚焦露出 `IconButton size="sm"` + antd `Tooltip`，危险动作走 `danger` + `Modal.confirm`。卡内有按钮时根节点用 `div[role="button"]`，禁止 `button` 嵌套 `button`。
- 状态编辑页：两列响应式（左素材接收位 16:9 预览 + 动作行 / 右字段），窄窗落成单列；控件一律 antd `Input` / `Input.TextArea`。
- 抽屉内嵌（`embedded`）：页边距 16、取消定宽、面包屑可折叠中间层。

### 顶部栏（TopBar）
- 三个变体：导航栏、编辑器顶部栏、创作详情顶部栏
- 高度统一 54px，使用 `theme.toolbar.background` 作为背景
- `borderBottom: 1px solid ${theme.toolbar.border}`

### 版本信息（开发阶段不显示）
- 产品处于开发阶段：**任何界面都不显示版本号、构建时间、更新日志 / 发版记录**——
  顶栏、画布菜单、移动端抽屉、设置弹窗一律没有版本徽标与「更新日志」入口。
- 不引入 `version` 构建注入（`__APP_VERSION__` / `__BUILD_TIME__`），也不保留按版本号组织的更新日志数据。

### 图标按钮（Icon-Only Buttons）
- 所有工具栏操作按钮使用图标 + antd Tooltip 设计
- 尺寸 32x32，`fontSize: 16`，`borderRadius: 6`
- 使用 `lucide-react` 图标，hover 时通过 `zeroexo-icon-btn` 类实现缩放动画
- **提示文字（Tooltip）：统一使用 antd `Tooltip`**，禁止使用自研 `tooltip.tsx`（已废弃）

### 画布级页签（画布副本）
- 位置固定在**画布区顶部第二层**（固定槽位页签条下方那一行，见线上版本活动页签）：30px 高、透明底、
  激活态底部 accent 下划线、可横向滚动；只存在副本时渲染整条。
- 第一个是**主画布页签，始终存在、不可关闭**；其余画布副本页签可 ×、可拖拽排序。
- 点页面签 = **同一个画布编辑器切换文档**（视图/工具栏/胶囊/快捷键/分组全部同一套），
  **禁止**为副本再写第二套画布界面或第二个引擎实例；切换前先落盘当前文档，副本期间主画布自动保存暂停。
- 关闭当前副本页签回退到左侧相邻副本，没有剩余则回主画布。
- 「另存画布」入口在节点胶囊上：单选/多选/**预览组**都要显示，但**只能是纯图标**（与其他胶囊工具一致，
  禁止在按钮里加「另存画布」等可见文字；语义放 `title`/`aria-label`）；
  成功提示统一为「已另存为画布副本「title」」，不堆节点数等冗余信息。

### 模型输入能力（2026-11-10 用户拍板）
- 纯文生图模型（如 Krea2，`supportedInputTypes = ['text']`）**不得渲染参考素材上传/槽位区**，改为一行中性说明
  「该模型只支持文生图，不支持参考图（连入的素材不会作为输入）」，禁止让用户以为可以垫图。
- 有参考图能力的模型（Qwen Image 2.1 / H3ZeroExo）保持现有参考区与兼容性红叉提示。

### 导演台延续法（2026-11-11 用户事故后定为硬性）
- 段长：可见帧必须吸附 **17k+5**（fps 24，向上吸附）；每段可见帧 + **22 帧引导** ≤ **736**；第 2 段起必须吃上一段尾帧。
- 必须走 `plan_continuity_edit`（MCP，dryRun 出「段/帧/秒/是否吃上一段」表 → 用户确认 → confirm+userConfirmed）再生成；
  计划会写入 `shot.paramValues.continuityPlan` 并打开 `sharedParams.continuityEnabled`。
- `run_generation` 在延续法开启时：没有计划 → `CONTINUITY_NOT_PLANNED`；跳段/从中间开始 → `CONTINUITY_ORDER`；
  必须严格串行（上一段 success 拿到 guide 才提交下一段）。禁止照搬原稿段长、只写「承上」字样冒充延续法。

### 导演台工具行（2026-11-10 用户要求）
- 工具行最右侧固定显示「全部片段统计时长」：`总时长 mm:ss · N 段`（按时长四舍五入到秒；空项目显示 `00:00 · 0 段`），
  使用等宽数字，不允许被中部弹性空隙挤掉或换行。

### 剧本页滚动（2026-11-10 用户反馈）
- 剧本正文行是**自动高度 textarea**、自身不会滚动：滚轮事件不得只 `stopPropagation` 吞掉，
  必须转给 `[data-script-scroll]` 滚动容器（`scrollTop += deltaY`），保证「光标在文字上滚轮也能翻页」。
- 剧本页只允许一个纵向滚动容器（`[data-script-scroll]`），滚动条贴容器右缘；不得再出现外层滚动条。

### 图片编辑器：手动涂抹（2026-11-10 用户拍板）
- 局部编辑器除 AI 蒙版外必须有**手动涂抹**：画笔颜色（原生取色器 + 十六进制 + 常用色板）、吸色器（从合成图取色）、
  笔刷大小、橡皮擦、撤销、清空；确认后把「原图 + 涂抹层」合成 PNG，作为**新图片节点**落回画布（原节点不动，右连一条边）。
- 涂抹层是可见颜色，不是 AI 蒙版（蒙版的白色语义只在「局部」工具里）；两者不能混用同一 canvas。

### 节点「发送」与任务队列（2026-11-10 用户拍板）
- 节点右键与胶囊工具栏统一一个「发送」入口（二级菜单），目的地：本项目资产 / 全局资产 / 另存为资产 / 发送到主体；
  「另存为画布」放同一菜单末项。文案固定为：本项目资产、全局资产、另存为资产、发送到主体、另存为画布，
  不再出现「存入全局 / 另存画布」这类旧说法。
- 右下角任务队列窗口：画布、导演台、图片编辑器发起的生成任务统一登记，可收起；显示排队/进行中/完成/失败与步数进度，
  最多保留 50 条，挂在 app 根节点跨页签常驻。

### 生成进度与复刻（2026-11-10）
- ComfyUI 的 `progress.max` 不保证是步数（Qwen 缓存节点按 token 块上报，实测 4096）：客户端必须按请求步数折算，
  UI 只显示真实步数，禁止把 token 数当「4096 步」展示。
- 本机/插件模型节点（`zeroexo:*`）的「复刻」用节点自身 `model + paramValues` 快照，不去查云端 AiGeneration；
  云端渠道节点才按 `generationId` 查记录。

### MCP 更新感知（2026-11-10 用户要求）
- MCP 启动写 `.mcp/server-info.json`：`toolNames` / `builtAt` / `pid`；网页端比对自身必需工具清单，
  缺工具就在主页提示条、使用指引、MCP 设置页同时提示「重启 MCP 服务后新工具才生效」，不允许让用户自己猜。
- 只比数量会被新增/删除抵消，必须比工具名。

### 媒体回收站（2026-11-10 用户拍板）- 画布、资产、历史、主体都不引用的媒体**不得静默硬删**：先移入 `media/recycle/` 并记账（来源 / 大小 / 移入时间 / 到期时间），
  界面（LOGO 菜单 →「媒体回收站」）可见、可恢复、可立即彻底删除。
- 保留 30 天，到期由定时任务清理；只有清理过期条目时才真正删除物理文件。
- 「孤立」判定只看 CAS 索引：`refs` 为空的条目 + 索引里没有的 `media/cas/*` 残留；有存活引用的一律不动。

### 主体节点（画布，2026-11-10 用户拍板）
- 主体「发送到画布」复用**堆叠节点框架**承载（预览/切换/保存只有一套实现），节点 `data.subject = { rootId, name }`
  标记语义、标题用主体名；一个主体 = 若干当前资产（图片/视频/音频），`mediaHistory` 里的旧图不发送。
- 点节点里的卡片（底部缩略导航）必须能**回到主体库对应主体/状态**（走 `NAVIGATE_FOCUS_SUBJECT_EVENT`），
  不允许只在画布上翻页。
- 堆叠框架必须支持音频卡片：缩略图用音符图标，主视图给原生 `<audio controls>`（按 storageKey 解析，不预加载全量）。

### 首次使用指引（2026-11-10 用户拍板）
- 首次启动（数据目录就绪后）自动弹出一次，列出三项先决条件：① 存储路径指定；② MCP 服务「一键复制配置」去 Agent IDE 粘贴；③ ComfyUI 插件安装说明 + 地址输入与「测试连接」。
- 关掉后写 `zeroexo:onboarding.seen`，不再自动弹；主页底部常驻一条「使用指引」入口（放在原政策公告的位置，本项目没有政策公告）可随时重新打开。
- 指引只做入口与状态展示：存储走浏览器目录授权，MCP 配置复用设置页的 `buildStdioConfig`/`ensureIdeToken`，ComfyUI 连接复用 `testEndpointConnection` + 同一个 endpoint store，禁止另起一套配置。

### 画布视图操作（2026-11-10 用户拍板）
- **滚轮 = 以光标为中心缩放画布**；Shift + 滚轮 = 水平平移；平移主力是空白处拖拽。
  禁止再让滚轮默认上下平移画布。
- 节点内**禁止**用滚轮缩放图片/视频内容（会抢走画布缩放）：媒体一律 contain 铺满节点，
  内容缩放能力已整体下线，节点尺寸只由角柄 resize 控制。

### 导演台交互（时间轴与插槽）
- 时长滑块：数值统一到 0.1s 精度并定宽（等宽数字 + 单行省略），拖动时弹层尺寸不得变化（防抖动）。
- 插槽：素材面板条目拖到已占用插槽 = **纯替换**（槽号固定）；插槽之间互拖 = **互换内容**（槽号固定，@ 引用跟着槽号指向新内容）。
- 拖拽期间不得弹详情/大图预览浮层（浮层会挡住落点、改面板尺寸导致拖放失败）；拖拽源用 `copyMove`，落点按意图设 `copy` / `move`。
- 轨道卡片：右键菜单含 向前插入 / 向后插入 / 复制插入 / 删除选中；上方工具栏操作按功能分组（播放 | 编辑 | 导出/批量），编辑组含「复制」。
- 段间衔接（时间轴交界）**常显一枚状态开关**：开启 = 绿色链接图标（`Link2`），断开 = 红色断链图标
  （`Link2Off`）；**点击图标本身**即切换衔接（链接模式内写草稿，模式外立即落盘），段 1 恒不渲染。
  禁止再使用方向箭头作为衔接状态标记。
- 点击片段（或片段缩略播放键）→ 右侧预览区**立即从 0 播放该段视频**；源异步解析完成也必须补起播。
- 生成中的实时帧 / 生成结果**只出现在右侧预览区**；禁止在时间轴片段卡片上叠加小图或「引导缩略」。
  提交本机作业必须把预览 `/ws` 的 clientId 透传给插件（否则帧发到主连接、右侧收不到）。
- 引导是**某个片段视频的附带资产**，不是独立素材：名称必须与来源视频一致，预览用来源视频首帧，
  只额外加「引导」符号/角标；禁止用「引导数据」当作条目名称，禁止画通用图标代替视频预览。
- 导演台**禁止再提供独立的「引导候选列表 / 引导页签」**；引导是视频槽的下拉变体：
  视频槽左下角 chevron →「使用源视频 / 使用引导」，选择后同一槽切换，源视频不占第二个参考槽。
- 所有素材槽左上角必须有类型标签（视频 / 图片 / 音频；引导槽为「引导」）。
- 历史视频卡 hover 右下角固定「发送到导演台」按钮（Clapperboard），下拉选择「发送源视频 / 发送引导」；
  无引导时引导项置灰，按钮本身不得消失。
- 出片显存策略属于**服务层**：默认按 `/system_stats` 总显存自动选择（<16GiB 走低显存，读不到时保守走低显存），
  客户不需要手动选；ComfyUI 连接面板必须展示连接机器（GPU / 显存 / 内存 / ComfyUI 版本），并提供
  「自动 / 低显存 / 高显存」手动兜底。强制高显存且检测到低显存时必须给 OOM 风险提示。
- **显存链只能执行一条**：模板里「低显存 / 原模型」用 switch 二选一时，提交前必须把未选中的那条链从图里删掉
  （ComfyUI 只跑输出节点的祖先，switch 两分支都是祖先 → 两条链都会真执行，高显存机器也会跑低显存链路）。
- **引导数据必须真正进引擎**：运行含片段引导槽时走插件作业通道（`/zeroexo/v1/jobs` 的 `reference_video` 模板
  带 `prev_guide_path`）；桥接（官方 director 节点）的 timeline 没有显式引导字段，禁止用它跑带引导的片段。
- 片段导航：镜头号两侧箭头之外必须有**下拉直达任意片段**；并提供「与镜头 N 交换位置」；
  插入片段必须可选位置（最前 / 选中之前 / 选中之后 / 最后），主按钮默认插到**选中片段之后**，不再一律追加到末尾。
- 导演台的「项目资产」候选只放用户导入/手动存入资产；API 生成产物走历史，不进项目资产候选。
- 版本记录弹层支持多选 + 批量删除（只作用于勾选快照，二次确认）。

### 弹窗（Modal）
- **优先使用 antd Modal**，已通过 `AntdThemeProvider` 配置完整主题
- 必须设置 `centered` 属性
- 使用 `styles.body: { padding: 0 }` 取消默认 padding，由内部完全控制间距
- 必须在 `styles.content` 中设置 `background` 和 `border`，确保明暗主题适配
- 宽度规范：编辑类 680px，详情类 960px，确认类 520px，上传类 440px
- 自研 `modal.tsx`（portal-based）仅用于极简场景（不需要 antd 依赖时，如 asset-picker 和 image-dialog-renderer）

### 图片编辑（独立页签）
- 裁剪 / 分割 / 局部在**独立的图片编辑页签**内完成（key = `image:<nodeId>`，挂在画布区文档页签条上）：
  页面自带工具栏（裁剪 / 分割 / 局部 + 返回画布），不弹居中窗口、也不在节点卡片里塞编辑器；
  **节点尺寸与状态永远不会因为编辑而改变**。
- 节点胶囊只保留一个「编辑」入口；抽屉里的图片资产（素材分组卡片与历史分组产出）也有「编辑」，
  按钮与「发送到画布/导演台」同款尺寸与底色。
- 资产来源**不预先把资产加成画布节点**：直接打开编辑页签，确认输出时才把结果节点落到视口中心附近（「编辑结果落在画布」）。
- 页面布局对齐 Photoshop：顶部工具栏（返回画布 / 工具）+ 中间画布舞台 + 右侧属性面板（参数与确认/取消）。
- 只读 / 参数型操作（查看大图、详情、放大、多角度）仍走浮层；节点「详情」与主页资产一致，统一用 `MediaLightbox`。
- 编辑器内容体**只有一份**：插件包对话框同时支持 `inline`，编辑页签直接复用。
- 产物落图（子节点 + 连线）只有一份实现：`features/image-editor/image-edit-actions.ts`。
- 局部：Qwen-Image-2.1 **不支持 latent mask**。按官方 Paint Pen 原理把涂抹区标红烘焙进 image_1，
  提示词点名红区；生成后用同一遮罩把结果合成回原图，保证区域外不变。禁止再用 `SetLatentNoiseMask`。
- Qwen-Image-2.1 尺寸：原生 2K，最长边 2048、最大 2048×2048；UI 与本地作业都必须夹取，超过 2K 的参考图先缩小。
  VAE 原生 4 通道，必须保留 Alpha 透明 PNG，不得强制转 JPG 或铺底色。
  确认后必须真实提交**本机 Qwen Image 2.1 图像编辑**（`qwen_image_edit` + 遮罩模板），不得只弹「需要接入生成后端」；
  结果生成在原图右侧的新图片节点，原图不动。
- 画布图片节点的本机模型 `QwenImage2.1`：有连线参考图 = 图生图编辑，无参考图 = 文生图；参数面板必须给
  **画面尺寸**（有参考图可选「跟随原图」，也可选 1:1 / 4:3 / 3:4 / 16:9 / 9:16 或填宽高；显式尺寸会先把输入图
  填满裁切缩放到目标尺寸）；「优化提示词」开关不得写成「大模型改写指令」；步数 / 贴合度 / 修改幅度 / 随机种子
  收进「高级」。上传输入图/遮罩失败必须报错，禁止静默降级成无遮罩生成或忽略所选尺寸。
- 默认参数两套，不要混用：**图片（QwenImage2.1）25 步**、cfg 1.0；**视频（H3ZeroExo）8 步**。
  Qwen 尺寸最长边 ≤2048 且 16 对齐（`QWEN_MAX_EDGE` / `QWEN_DEFAULT_STEPS` 单点维护）。
- **Krea2 文生图**（`zeroexo:krea2`）：只在连接线上 ComfyUI 时出现在图片节点的模型下拉里（本机没有底模，禁止露出）；
  参数是比例 + 百万像素（默认 3MP，32 对齐）+ 10 步、cfg 1、eta 0.55；不支持参考图。
- 生成中刷新页面不得丢预览/进度：提交成功把 `{jobId, clientId, base}` 写进节点 `data.localJob`，
  重开画布用同一 clientId 重连 `/ws` 继续收预览与步进，并继续轮询把产物写回；结束（成功/失败/中止）必须清 `localJob`。
- 有输入图时提交给插件的 `edit_prompt` 必须以「参考图1：」开头（`buildQwenEditPrompt` 统一加），
  否则 Qwen Image 不认输入图、会当文生图重画；遮罩红区约束与透明底要求追加在同一句里，不要另起前缀。
- **编辑源 = 原图**：页面通过 storageKey 解析原图 blob；画布上的缩略/预览档只影响显示，不参与裁剪/分割计算。
- **分割切片必须能严丝合缝拼回原图**：所有切片用同一缩放比例 + 累计边界取整 + 零间距排布；
  禁止"每片固定宽度"（非均匀切片会因各自缩放比例不同而错位）。
- **分割块数必须设上限**（单次 ≤ 64 块）：每块都要 canvas 编码 + 上传 + 建节点 + 连线，块数过多会直接卡死浏览器；
  行/列输入互相约束，落图前再做一次硬拦截，不启动任何编码/上传工作。

### 弹窗（Modal）
- **优先使用 antd Modal**，已通过 `AntdThemeProvider` 配置完整主题
- 必须设置 `centered` 属性
- 使用 `styles.body: { padding: 0 }` 取消默认 padding，由内部完全控制间距
- 必须在 `styles.content` 中设置 `background` 和 `border`，确保明暗主题适配
- 宽度规范：编辑类 680px，详情类 960px，确认类 520px，上传类 440px
- 自研 `modal.tsx`（portal-based）仅用于极简场景（不需要 antd 依赖时，如 asset-picker 和 image-dialog-renderer）

### 图片节点编辑（节点卡片内）
- 裁剪 / 分割 / 局部遮罩**在图片节点卡片内部完成**：进入编辑时节点临时放大到工作尺寸，
  图片区直接变成裁剪框 / 切分网格 / 蒙版画布，确认或取消后还原节点尺寸；**不弹居中窗口、也不额外浮一层面板**。
- 编辑态：Esc 退出，拦 Delete/Backspace 防误删；尺寸变化走 `ResizeNodeCommand`（可撤销）。
- 只读 / 参数型操作（查看大图、详情、放大、多角度）仍走浮层；节点的「详情」与主页资产一致，
  统一用 `MediaLightbox` 查看（图片/视频/文本），不再弹旧版详情面板。
- 编辑器内容体**只有一份**：插件包对话框同时支持 `inline`，节点内直接复用，禁止第二套 UI。
- 产物落图（子节点 + 连线）只有一份实现：`features/image-editor/image-edit-actions.ts`，
  由节点通过 `nodeActionBus`（`imageEditApply`）冒泡给宿主执行。

### 按钮（Button）
- 尺寸规范：工具栏 `size="small"`（24px），主操作 `default`（32px），大按钮 `large`（44px）
- 类型规范：主要操作 `type="primary"`，次要操作 `type="default"`
- 危险操作：统一添加 `danger` 属性
- 图标按钮：使用 `lucide-react` 图标，配合 antd Tooltip

### 卡片（Card）
- 使用 `antd Card`，`bordered={false}`，`borderRadius: 14px`
- 使用 `styles.body` 自定义 body 样式（禁止使用已弃用的 `bodyStyle` 属性）
- hover 效果：`translateY(-4px)` + `boxShadow`
- 过渡动画：`all 0.3s cubic-bezier(0.22, 1, 0.36, 1)`
- 缩略图宽高比：16:9

### 输入框（Input）
- 使用 antd `Input`，`controlHeight: 36`
- 搜索框：使用 `Input` + 自定义 prefix 图标，宽度 240px，`allowClear`
- 禁止使用 `Input.Search` 组件

### 选择框（Select）
- **通用场景：使用 antd `Select`**，`controlHeight: 36`
  - 工具栏中统一设置 `width: 140px` + `allowClear`
  - 搜索/筛选页面的分类下拉使用 antd Select
- **Canvas 编辑器场景：使用 `SimpleSelect`**（`@/shared/components/simple-select.js`）
  - 专为 canvas 节点工具栏设计，支持 `fixed` 定位避免 overflow 裁剪
  - 支持 `stopPropagation` 防止拖拽干扰
  - 自定义字体、颜色、边框
  - 仅用于 script-structured-editor 等画布内编辑器

### 表单（Form）
- 使用 antd `Form`，`layout="vertical"`，标签在上控件在下
- 表单标签与控件间距：`marginBottom: 12px`

### 表格（Table）
- `size="small"`，`headerBorderRadius: 8`
- `pagination: { showSizeChanger: true, showTotal: (t) => \`共 ${t} 条\` }`

### 标签（Tag）
- 状态标识：使用预设颜色名（如 `color="blue"`、`color="green"`）
- 风格：`fontSize: 11`，`borderRadius: 9999px`
- 在 div/td 中最多显示前 4 个标签，超出显示 +N

### 头像（Avatar）
- 用户头像：antd `Avatar`，size 24px，显示首字符
- AI 头像：自定义组件，8px border-radius，Bot 图标

### 下拉菜单（Dropdown）
- **通用场景：使用 antd `Dropdown`**（6 文件：top-bar、left-side-toolbar、project-card、EpisodeList、EntityStateCard、canvas-menu）
- **Canvas 编辑器场景：`SimpleSelect` 内部使用自研 Dropdown**
  - 自研 `dropdown.tsx` 支持 `fixed` 定位（避免 overflow 裁剪）、auto-positioning、bouncy easing 动画
  - 不直接暴露给业务组件，仅通过 `SimpleSelect` 间接使用

### 抽屉（Drawer）
- 使用 antd `Drawer`
- 统一 `placement="right"`（仅移动端菜单使用 `left`）
- 宽度：详情面板 480px，全屏面板 960px
- 画布内资产抽屉（`HierarchyPanelSidebar` / `CanvasAssetsPanel`）的 sidebar 按钮顺序固定为
  **资产 → 历史 → 层级 → 画布**（资产置顶）。
- 「层级」「画布（子画布）」是**画布模块专属**：只在顶部页签为画布（含画布副本）时挂载；
  剧本 / 主体库 / 导演台模块只挂「资产」「历史」两个按钮，且不挂载画布层级树与子画布列表——
  每个模块独立记住自己的激活分组，避免用户在其他模块里误选画布层级与子画布。
- 层级树的数据 hook 必须挂在该分组组件内部（激活才订阅整张图），禁止提到抽屉壳层常驻订阅。
- 抽屉内的主操作按钮（上传素材 / 添加主体 / 添加状态）**统一放在内容顶部**（页头或胶囊下方），禁止埋到列表底部。
- 素材/主体选择面板：缩略图统一走 `ThumbImage`（禁止旧资源 URL 字符串链）；视频列表必须出封面、详情/悬停可播放；导入类按钮（导入资产 / 上传）统一在顶部。
- 资产卡 / 历史卡 / 开源库卡的所有操作按钮统一落在**封面右下角**（黑色半透明 28×28 图标，与历史卡同位），
  禁止再挂到标题行右侧或底部分散摆放；标题行只保留标题与必要标签。
- **本项目资产只放用户导入 / 手动存入的资产**；API 生成的图片/视频只属于「历史」，不得混进本项目资产列表，
  也不参与本项目的数量徽标。删除本项目资产不得删除历史记录（两者不是同一份数据视图）。
- 历史产出（含导演台生成的视频）的「加入资产库」必须由用户选目标：**本项目 / 公共资产**；
  不得写死公共库，也不得自动落到本项目。导出是复制引用（共用同一文件），历史记录保留。
- 提示词库不单独做页面/主页入口；只保留画布抽屉「提示词」分组与图片节点参数旁下拉，预设只读、本机新建可编辑。
- 预设提示词必须写明**画面共几个**（例：「画面中固定 3 个画面，数量不得增减」）并显式禁止额外机位；
  禁止用「三视图 / Lineup Sheet」这类名字诱导模型自己加一个侧视图。
- 画布抽屉的「开源库」是**素材分组内的 Tab**（公共 / 本项目 / 主体 / 开源库），不是独立侧栏按钮。
  支持多选导出，批量操作只遍历勾选项（默认 0 项，不得把同批全部产出一起导出）。
- 「层级」分组空态文案必须说明**这是画布的节点层级**（例：「画布上还没有节点：用下方「+」添加图片、视频或文本节点」），
  禁止写「项目为空」这类让用户不知道在看什么层级的文案。

### MCP 配置页（`McpSettingsDialog`）
- 全页只有**一份** `mcpServers` 配置块和**一个**「一键复制」按钮；「本地数据面板」只负责
  数据目录 / 目录绝对路径 / 缓存清理，**禁止**再渲染第二份配置块或第二个复制按钮。
- 数据目录与目录绝对路径属于同一件事，合并为一个区块，不重复解释「MCP 与网页指向同一目录」。

### 确认弹窗
- 所有删除/危险操作使用 `Modal.confirm`（antd），禁止使用 `Popconfirm`
- 必须包含：`centered: true`、`okType: 'danger'`、`okText: '确定删除'`、`cancelText: '取消'`
- 内容文案必须明确说明操作后果
- 也可使用 `ConfirmDialog`（`@/shared/components/confirm-dialog.js`，antd Modal 的封装），提供统一的"取消 + 确认"底部按钮

## 图标使用规则

### 图标库
- 首选 **`lucide-react`** 作为主要图标库（线性简约风格）
- 当 `lucide-react` 缺少所需图标时，允许使用 `@ant-design/icons` 或 `bootstrap-icons` 作为补充
- 图标风格：线性简约，默认与主题文字配色一致（`color: inherit`）
- 禁止使用 emoji 作为图标（🛠️、✅ 等）

### hover 动画
- 所有图标按钮使用 `zeroexo-icon-btn` CSS 类
- 动画：`transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)`
- hover：`transform: scale(1.1)`
- active：`transform: scale(0.95)`

### 尺寸规范
- 工具栏图标：16px
- 列表内操作图标：12px
- 大标题图标：16px

## Animation

### 缓动曲线
- 默认：`cubic-bezier(0.22, 1, 0.36, 1)` — 平滑减速
- 弹入：`cubic-bezier(0.34, 1.56, 0.64, 1)` — 下拉/弹窗入口

### 时长规范
- 150–200ms：hover 状态、按钮反馈
- 200–300ms：面板过渡、元素重排
- 300–500ms：卡片入场（fade-up）、页面过渡

UI 动画不超过 500ms。长时间操作使用进度指示器。

### 关键帧
所有关键帧定义在 `app.css` 中：
- `zeroexo-fade-in` — 淡入
- `zeroexo-fade-up` — 上移淡入
- `zeroexo-fade-scale` — 缩放淡入
- `zeroexo-slide-in-right` — 右侧滑入
- `zeroexo-shimmer` — 骨架屏扫光

## CSS & Styling 规则

1. **Tailwind CSS 优先**：组件样式优先使用 Tailwind 工具类。仅在动态值（主题相关、状态相关）无法通过 Tailwind 表达时，回退到 inline `style` 对象
2. 静态/可复用的样式值提取到工厂函数（`function fooStyle(theme): CSSProperties`）
3. 主题 token 通过 `useTheme()` 在组件层级获取，并作为 props 传递给共享组件
4. 共享组件接收 `theme: ThemeConfig` 作为 prop，不在内部调用 `useTheme()`
5. 所有颜色值通过 ConfigProvider token 或 CSS 变量控制，禁止硬编码

## 导入约定

- 使用 `@/` 别名引用 `src/` 下的文件
- 使用 `.js` 扩展名引用 `.ts/.tsx` 文件（Vite 约定）
- 主题钩子从 `@zeroexo/plugin-theme` 导入
- 共享类型从 `@zeroexo/shared` 导入
- Lucide 图标按名称导入：`import { Sparkles, History } from 'lucide-react'`

## Do's and Don'ts

- DO: 使用 `AntdThemeProvider` 统一 antd 主题配置
- DO: 使用 `@zeroexo/plugin-theme` 的 `useTheme()` 获取主题 token
- DO: 使用 `lucide-react` 作为主要图标库
- DO: 优先使用 antd Modal（已通过 ConfigProvider 配置主题）
- DO: 所有 Modal 设置 `centered`
- DO: 所有删除操作使用 `Modal.confirm`
- DO: 使用 `styles.body` 替代已弃用的 `bodyStyle`
- DO: 使用 Tailwind CSS 工具类作为主要样式方案
- DO: 使用 `@/` 别名避免深层相对路径
- DO: 尊重 `prefers-reduced-motion`：将所有动画时长设为 0ms
- DON'T: 使用 emoji 作为图标（🛠️、✅ 等）
- DON'T: 使用 `Input.Search` 组件
- DON'T: 使用 `Popconfirm` 执行删除操作
- DON'T: 使用 `bodyStyle` 作为本地变量名（避免与 antd 废弃 API 混淆）
- DON'T: 硬编码颜色值（使用主题 token 或 CSS 变量）
- DON'T: 硬编码布局尺寸（导入 `LAYOUT` 常量）
- DON'T: 混用缓动曲线（保持统一节奏）
- DON'T: 在共享组件内部调用 `useTheme()`（通过 prop 传入）
- DON'T: 使用纯黑 `#000` 作为暗色背景（使用 `#161412`）