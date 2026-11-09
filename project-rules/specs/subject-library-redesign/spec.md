# 主体库整体重新设计 · 规格

日期：2026-11-05
范围：仅「主体库」页签（`StoryboardTabContent` → `StoryboardSubjectTab` 的 pages 模式）。
性质：设计规格，不含代码改动；所有结论基于对现有源码的逐文件核实。

---

## 0. 现状核实（先看事实，再谈设计）

| 模块 | 文件 | 现行行为 | 设计问题 |
|------|------|----------|----------|
| 三级页面 | `subject-library-pages.tsx` | 列表页 → 主体状态页 → 状态编辑页，整页跳转，靠面包屑回退 | 编辑一个状态时看不到其它状态，也看不到主体列表；跨状态比对只能来回跳 |
| 层级/记忆 | `subject-page-nav.ts` | `list / subject / state` 三态；`view-prefs.subjectPages.lastByProject` 记忆；`history.pushState` + `popstate` | 状态机本身可复用，问题是「三态被渲染成三个整页」 |
| 状态数据 | `subject-tree-types.ts` | `baseState` + `states[]`；`appearEpisodes`、`media[]`、`origin`、`deriveFrom` | 数据完全够用，不做迁移 |
| 媒体写入 | `subject-state-media.ts` | `linkSubjectStateMedia` 唯一写入；CAS 记账；删除时 `releaseSubjectStateMediaRefs` | 语义稳定，本轮不动 |
| 媒体来源 | `subject-media-source-panel.tsx` | 四分区 @ 面板（画布/公共/本项目/手动上传），28px 行、300px 浮层 | 形态可用，直接复用 |
| 发送资产 | `subject-send.ts` | 有「当前状态页」上下文 → 直达；否则弹 `subject-link-dialog` | 上下文是隐式的，界面上看不见「资产会发到哪」 |
| 旧树 UI | `StoryboardSubjectTree.tsx` | 大纲式逐行卡：状态名可编辑、出现集数下拉、来源徽标、失效占位、替换/删除 | 仅分镜全屏编辑器在用；能力比 pages 模式更全 |
| 列表卡 | `PromptCard`（`shared/components/prompt-card.tsx`） | 280px 卡、16:9 缩略、标题/分类/提示词标签、hover 删除 | 不承载状态数、媒体就绪率、当前接收位，作为「主体入口」信息密度不足 |

结论：**数据层不用动，要重做的是「页面形态 + 信息组织 + 接收位可见性」**。当前 pages 模式还缺三件事（旧树有、pages 没有）：删除状态、改主体类型、删除主体；这三项在重设计中补齐（属于能力对齐，不是新功能）。

---

## 1. 信息架构

### 主方案：单页三栏工作台（Workbench）

```
┌ 页面顶栏（父级 storyboard-tab-content 承担）：主体库 · N 主体 · [+ 添加主体] ┐
├──────────────┬──────────────────────────────────┬──────────────────────────┤
│ 左：主体导航  │ 中：状态工作区                     │ 右：状态检查器             │
│ 264px 常驻   │ 自适应，最小 420px                 │ 360px，可折叠              │
│ 搜索/筛选/行  │ 主体头 + 状态卡网格                │ 单选状态的编辑面           │
└──────────────┴──────────────────────────────────┴──────────────────────────┘
```

- 左栏永远在：换主体只需一次点击，不再回列表页。
- 中栏是「一个主体的全部状态」：基础状态固定第一格，其余状态卡铺成网格，可横向扫视就绪情况。
- 右栏是「当前状态」的唯一编辑面：状态名、备注、出现集数、素材接收位、删除。
- 三栏各自独立滚动（外层容器 `overflow: hidden`），符合现有素材区独立滚动的约定。

**为什么这样设计**：主体库的真实任务不是「浏览层级」，而是「在一个主体的一堆状态之间分配/核对其参考素材」。三栏把「主体列表 / 状态全景 / 单状态编辑」同时摆在眼前，删掉两次整页跳转，也让「资产会发到哪个状态」从隐式变显式。
**代价**：布局代码量上升；窄屏需要降级形态；现有面包屑与「列表页」概念消失，相关单测要改写。

### 备选方案：两级页面 + 右侧抽屉编辑

保留「列表页 → 主体状态页」两级整页，点状态卡在主体页上层弹出 420px 抽屉编辑。面包屑保留。

**为什么作为备选**：改动小、现有导航与测试基本不动，风险最低。
**代价**：左栏主体列表在主体页不可见，换主体仍要退回列表；三栏的「同时可见」优势只剩两栏。

**取舍结论**：选三栏工作台。主体库的使用重心在状态层，不在层级浏览；备选方案保留为「工期/回归预算不足时」的降级路径，两者共用同一套状态卡与检查器组件，降级只需把检查器改成抽屉。

---

## 2. 页面草图

### 2.1 主视图（已选主体 + 已选状态）

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ 主体库  12 主体                                              [+ 添加主体]                  │
├──────────────────────┬──────────────────────────────────────────────┬────────────────────┤
│ [全部 3] [角色 8] ... │  ┌40┐ 东海龙王  [角色 ▾]  别名：龙王       │ 状态详情 · 第2步   │
│ [搜索主体…]           │  │  │ 3 状态 · 2/3 已就绪 · 当前第 2 集    │ ─────────────────  │
│ ───────────────────  │  └──┘                        [+ 添加状态] [⋯]│ 状态名 [东海龙王·状态2]│
│ ▸ 东海龙王    3 状态  │  ┌────────────┐ ┌────────────┐ ┌─────────┐ │ 备注   [textarea 6行] │
│   角色 · 2/3 就绪    │  │ 基础状态    │ │ 状态2   ◎  │ │ ＋ 新建  │ │ 出现集数 [第1集][第2集]│
│ ▸ 老张        2 状态  │  │ ┌────────┐ │ │ ┌────────┐ │ │   状态   │ │ 素材接收位            │
│   角色 · 1/2 就绪    │  │ │ 封面16:9│ │ │ │ 图16:9 │ │ │         │ │ ┌──────┐ 替换 / 删除 │
│ ▸ 山神庙      1 状态  │  │ └────────┘ │ │ └────────┘ │ │         │ │ │缩略96│ 来源：画布·节点A│
│   场景 · 1/1 就绪    │  │ 基础 · 全部 │ │ 第1/2集·已就绪│ │         │ │ └──────┘               │
│ ▸ 客栈        4 状态  │  └────────────┘ └────────────┘ └─────────┘ │ ─────────────────  │
│   场景 · 3/4 就绪    │                                              │ ⚑ 资产将发送到此状态 │
│                      │                                              │ 自动保存 · 删除状态  │
│ 12 主体 · 28 状态     │                                              │                    │
└──────────────────────┴──────────────────────────────────────────────┴────────────────────┘
     左栏独立滚动                  中栏独立滚动                        右栏独立滚动
```

### 2.2 左栏（主体导航）

| 区块 | 承载信息 | 点击行为 |
|------|---------|---------|
| 类型筛选 | 全部/角色/场景/道具 + 数量（现存 `subjectLibrary.activeKind` 持久化） | 过滤左栏；不改中心选中 |
| 搜索框 | 名称 + 别名（沿用现有「搜索主体…」） | 即时过滤；当前选中被过滤掉时不取消选中（见 4.3） |
| 主体行 | 32px 封面、名称（12.5/600）、次行「类型 · N 状态 · M/N 就绪」、失效媒体数 | 单击选中；右键/悬停「⋯」出菜单：重命名、改类型、删除主体 |
| 当前集提示 | 「当前第 N 集」+ 排序说明（取 `script.activeEpisodeId`） | 无剧集上下文时不显示 |
| 栏底 | 「N 主体 · M 状态」 | 纯展示 |

- 主体行选中态：左侧 3px accent 竖条 + 选中底色 + 名称转主文字色。
- 删除主体沿用现有确认弹窗与 `releaseSubjectStateMediaRefs`，不新增文案口径。

### 2.3 中栏（状态工作区）

| 区块 | 承载信息 | 点击行为 | 空态 |
|------|---------|---------|------|
| 主体头 | 40px 封面、主体名（就地编辑输入框）、类型下拉徽章、别名（只读，超长省略）、N 状态 / 就绪数 / 当前集 | 改名即时写回树 + `ProductionItem`；改类型写树 `kind` + 对应默认 `templateType` | 未选主体时整栏为引导空态 |
| 操作 | 「＋ 添加状态」、「⋯」（删除主体、折叠右栏） | 添加后自动选中新状态，不跳页 | 无 |
| 状态网格 | 基础状态卡（首格，`基础` 徽章 + 左侧 3px accent 细条）+ `states[]` 卡，按「本集命中/未标注在前、标注为其它集在后」稳定显示排序（`sortStatesByEpisodeRelevance`） | 单击卡片 → 右栏编辑该状态；卡片本身不再跳页 | 无状态：网格内保留「＋ 新建状态」虚线卡 + 一行提示 |
| 网格尾卡 | 「＋ 新建状态」虚线卡 | 同「添加状态」 | — |

### 2.4 右栏（状态检查器）

**未选中任何状态时**：居中提示「从中间选择一个状态开始编辑」+ 「编辑基础状态」按钮。
**选中基础状态时**：

| 字段 | 控件 | 写入 |
|------|------|------|
| 主体名称 | 输入框 | `tree.name` + `ProductionItem.name` |
| 完整提示词 | textarea（6 行，可拖高） | `baseState.prompt` |
| 基础图 | 96px 缩略 + 上传 / 删除 | `states[0].media[0]`（基础状态真节点，2026-11-08 统一） |
| 说明 | 「基础状态不接收资产；资产发送请选择具体状态」 | — |

**选中具体状态时**：

| 字段 | 控件 | 写入 |
|------|------|------|
| 状态名 | 输入框 | `node.state` |
| 备注 | textarea（6 行，标签「备注」，tooltip「给 AI 的补充说明」） | `fullPrompt` + `deltaPrompt`（同现值双写，沿用现状） |
| 出现集数 | 剧集 chip 多选（未选 = 全部；悬空编号只过滤不删数据） | `node.appearEpisodes` |
| 素材接收位 | 96px 缩略（图/音频/失效占位）+「替换 / 上传」+「删除媒体」 | 统一走 `linkSubjectStateMedia`（含 null 移除） |
| 来源行 | `origin.type` + `origin.label`（画布/本项目/我的资产/上传），无 origin 不显示 | 只读 |
| 发送指示 | 「⚑ 资产将发送到此状态」/「未指定接收位（发送时弹出选择）」 | 只读，来自 `getCurrentSubjectStateContext()` 的真实登记 |
| 危险区 | 「删除状态」文字按钮 | 确认 → `releaseSubjectStateMediaRefs` → 移除节点 → 选中回落到基础状态 |

**为什么检查器只放单选状态**：状态编辑是「点一个改一个」的低频操作，右栏常驻比弹层少一次开关；同时让发送目标始终可见。
**代价**：右栏占 360px，中栏在 1280px 下只剩约 460px，状态网格约 2 列；窄屏必须降级（见 3.1）。

### 2.5 空态一览

| 场景 | 表现 |
|------|------|
| 项目零主体 | 仍由父级 `storyboard-tab-content.tsx` 的虚线大卡承担（不进工作台） |
| 有主体、未选 | 左栏正常、中栏「选择左侧主体查看状态」、右栏隐藏或显示同一提示 |
| 选中主体无状态 | 网格只有基础卡 + 「＋ 新建状态」虚线卡；右栏若未选状态则显示引导 |
| 状态无媒体 | 卡片缩略位为「待补媒体」占位；右栏接收位显示虚线占位 + 「上传图片/语音」 |
| 媒体失效 | 卡片右上「引用已失效」徽章；右栏缩略位显示失效占位 + 「重新关联」「移除」 |
| 记忆的主体/状态已删 | 回落到有效上级（状态→该主体基础状态；主体→未选） |

### 2.6 备选方案草图（两级 + 抽屉）

```
┌ 主体库 / 东海龙王            [角色]  3 状态            [+ 添加状态] ┐
│ ┌ 基础 ┐ ┌ 状态2 ┐ ┌ 状态3 ┐ ┌ ＋ ┐              ┌────────────────┐ │
│ └──────┘ └──────┘ └──────┘ └───┘              │ 状态2         ×│ │
│                                                  │ 状态名 …       │ │
│  （整页状态网格，双列/三列）                      │ 备注 …         │ │
│                                                  │ 素材接收位 …   │ │
│                                                  └────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                             420px 抽屉浮在网格上方
```

---

## 3. 视觉规格

原则：**平、轻、密**。去掉大渐变重描边；信息靠字号层级与灰度分层，不靠彩色徽章堆叠。所有颜色一律从 `ThemeConfig` 派生，组件内不写 hex。

### 3.1 布局尺寸

| 项 | 值 | 说明 |
|----|----|------|
| 左栏宽 | 264px（1024–1279px 时 232px） | 不拖拽调宽，避免新增持久化字段 |
| 右栏宽 | 360px（1024–1279px 时抽屉 380px） | < 1200px 时右栏改为浮层抽屉，覆盖中栏右侧 |
| 中栏最小宽 | 420px | 低于此宽触发抽屉降级 |
| 栏间距 | 0，以 1px `borderSubtle` 分隔 | 不用卡片包裹整栏，减少嵌套 |
| 页面内边距 | 顶栏 12/20；中栏 16；右栏 16 | — |
| 状态网格 | `repeat(auto-fill, minmax(200px, 1fr))`，gap 12 | 中栏 640px 时 3 列 |
| 左栏行高 | 56px（含 8px 上下内距） | — |
| 状态卡 | 缩略 16:9 满宽；正文 padding 10；圆角 10；最小高约 168px | — |

### 3.2 语义 token（新增 `subject-library-tokens.ts` 统一派生）

| 语义变量 | 深色 | 浅色 |
|---------|------|------|
| `pageBg` | `theme.canvas.background` `#11110f` | `#ffffff` |
| `surface`（卡片/中栏底） | `theme.node.fill` `#161616` | `theme.node.fill` `#fafafa` |
| `railBg`（左栏底） | `theme.toolbar.panel` `#1a1a1a` | `theme.toolbar.panel` `#f0f0f0` |
| `textPrimary` | `theme.toolbar.text` `#f5f5f4` | `#292524` |
| `textMuted` | `theme.toolbar.textMuted` `#a8a29e` | `#78716c` |
| `textFaint` | `color-mix(textMuted 70%, transparent)` | 同 |
| `borderSubtle` | `color-mix(toolbar.border 45%, transparent)` | 同 |
| `borderStrong` | `theme.toolbar.border` `#404040` | `#d4d4d4` |
| `accent`（唯一强调色） | 系统 accent 绿 `#00c758`（描边/实底）；文字用 `#00c758` | 同 `#00c758`（描边/实底）；文字用 `#0a8a43` |
| `danger` | `theme.toolbar.danger` `#ff6b6b` | `#dc2626` |
| `hoverBg` | `color-mix(textPrimary 6%, transparent)` | 同 |
| `selectedBg` | `color-mix(accent 8%, transparent)` | 同 |
| `ready`（就绪圆点） | `#4ade80` | `#16a34a` |
| `warn`（待补/失效） | `theme.toolbar.textMuted` + `danger` 徽章 | 同 |

- `ready`/`warn` 是语义常量，集中定义在本文件；业务组件只引用变量。
- 阴影只用于抽屉：`0 8px 24px rgba(0,0,0,0.45)`；常驻三栏不加阴影。
- 圆角：行 8、卡 10、缩略 8（卡内上圆角随卡）、按钮 6。

### 3.3 状态卡内部结构

```
┌────────────────────────────┐
│ 16:9 缩略（满宽，object-fit:cover）         │  ← 失效时叠 62% 暗罩 + 「引用已失效」
│                              │
├────────────────────────────┤
│ 状态2            [基础][AI]  │  ← 标题 13/600；徽章 9.5
│ 第1集 · 第2集                │  ← 集数 10.5 muted；>3 个折叠「+N」
│ ● 媒体已就绪  · 来自画布     │  ← 10.5；圆点 ready/warn；来源可省略
└────────────────────────────┘
```

- 基础状态卡：`基础` 徽章 + 卡片左侧 3px accent 竖条；其余结构一致（避免两套卡）。
- 选中态：`1px accent` 描边 + `selectedBg`；不做放大/位移。
- 悬停态：描边过渡到 `borderStrong`、底 `hoverBg`；**卡上不放删除**（删除在右栏危险区）。
- 当前接收位：右上角 16px `⚑` accent 图标 + `title`「资产将发送到此处」，与选中态独立（选中 ≠ 接收位，二者可不同步）。
- 缩略图缺省：居中 `ImageIcon 20` + 「待补媒体」9.5 muted；音频用 `AudioLines` + 「语音」。

### 3.4 字号层级

| 层级 | 字号/字重 | 用途 |
|------|----------|------|
| 页面标题 | 15 / 600 | 顶栏「主体库」 |
| 区块标题 | 13 / 600 | 主体名、右栏「状态详情」 |
| 卡片标题 | 13 / 600 | 状态名 |
| 正文 | 12 / 400 | 输入框、右栏正文 |
| 次要 | 10.5 / 400 | 集数、就绪、来源 |
| 标签 | 10.5 / 600 | 字段标签（muted） |
| 徽章 | 9.5 / 600 | 基础/AI/失效/集数 chip |

行高：标题 1.3、正文 1.55、徽章 1.4。数字统一 `font-variant-numeric: tabular-nums`（计数、集数、时长）。

---

## 4. 交互规格

### 4.1 进入 / 返回 / 刷新恢复

| 动作 | 行为 |
|------|------|
| 首次进入项目 | 读 `view-prefs.subjectPages.lastByProject[projectId]`：`rootId` 有效 → 左栏选中该主体；`stateId` 有效 → 右栏选中该状态；否则左栏选中第一个主体、右栏空 |
| 点击左栏主体 | 保留该主体上次的状态选择（当前项目记忆里的 `stateId` 属于该主体才用），否则选基础状态 |
| 点击状态卡 | 右栏切换；不改左栏；不整页跳转 |
| 浏览器后退/前进 | 沿用 `history.pushState({ __subjectPages: { projectId, rootId, stateId, seq } })` + `popstate`；层深最多 2 级（主体 → 状态） |
| 刷新 | 同「首次进入项目」；目标已删 → 逐级回落，不弹错误 |
| 关闭/切页签 | 无「未保存草稿」概念；编辑即时写回，重挂载不丢 |

**关键决定：保留 `SubjectPageLevel` 三态状态机，只把「三态 = 三个整页」改成「三态 = 三栏的选中组合」**。`list` = 未选主体（左栏仍在）、`subject` = 选中主体未选状态、`state` = 选中状态。这样 `subject-page-nav.ts`、history marker、`view-prefs`、`sendAssetToSubject` 的上下文登记都不用重写。
**为什么**：改渲染层风险最低；旧 history marker / 旧记忆天然兼容。
**代价**：`list` 这个命名不再准确（实际是「未选主体」），保留命名以免牵动测试与调用点。

### 4.2 发送资产到具体状态

- 右栏选中状态时：沿用现有 effect 登记 `setCurrentSubjectStateContext({ projectId, rootId, stateId, subjectName, stateName })`；卸载/切换时 `clearCurrentSubjectStateContext`（必须只清自己那份，沿用现有实现）。
- 选中基础状态或未选状态：不登记上下文（基础状态不是 `states[]` 槽位，`linkSubjectStateMedia` 不支持），发送时走 `openSubjectLinkDialog`。
- 可见性：
  - 右栏底部常驻「⚑ 资产将发送到此状态」；无上下文时显示「未指定接收位（发送时弹出选择）」。
  - 对应状态卡右上显示 `⚑` 标记。
- 反馈：`sendAssetToSubject` 成功 → toast「已发送到「主体 · 状态」」→ 广播 `useSubjectMediaLinkEventStore.emit` → 右栏缩略与状态卡缩略即时刷新。
- 并发：目标状态被删 → 降级到选择弹层（沿用 `subject-send.ts` 现有 catch）。

**为什么不做一键「锁定接收位」**：已有的「选中即接收位」足够，连续发送天然可用；锁定态会引入第二个真值来源，容易与实际选中不一致。**代价**：用户必须先选中状态再发送；没有「先锁目标、后去别的页选资产」的路径（该路径已由选择弹层覆盖）。

### 4.3 搜索 / 筛选

- 搜索与类型筛选只作用于左栏，不取消当前中心选中（避免正在编辑的状态被藏起来后丢失上下文）。
- 若当前主体被过滤掉：中栏保持不动，左栏底部给一行「当前主体不在筛选结果内」提示 + 一键清除筛选。
- 出现集数只影响**显示排序与标签**，不过滤、不禁用（沿用 `sortStatesByEpisodeRelevance` 的口径）。

### 4.4 状态新增 / 删除

| 动作 | 行为 | 数据 |
|------|------|------|
| 添加状态（头按钮 / 尾虚线卡） | `nextStateStep` + `createSubjectNode`（默认名带主体名前缀）→ 自动选中 → 滚入视野 → 焦点落到右栏状态名输入框 | `states[]` 追加 |
| 删除状态 | 右栏危险区 → 确认弹窗 → 先 `releaseSubjectStateMediaRefs({ rootId, stateId })` → 再移除节点 | `states[]` 移除；选中回落基础状态 |
| 删除主体 | 中栏「⋯」/ 左栏行菜单 → 确认 → 释放该树全部 CAS 引用 → 移除树 + `ProductionItem` | 左栏自动选下一个主体或未选态 |

**为什么删除只放右栏**：状态卡是高频单击目标，卡上加删除必然误触；右栏是「已明确选中后」的决策面。**代价**：删除多一步（先选中）；批量清理慢（本轮不做批量）。

### 4.5 失效媒体

| 位置 | 表现 | 动作 |
|------|------|------|
| 状态卡 | 缩略暗罩 + 「引用已失效」徽章（CAS 探测 `hasCasEntry` 为 false） | 单击卡仅选中，不自动重连 |
| 右栏接收位 | 失效占位 + 「重新关联」/「移除」 | 重新关联打开 `SubjectMediaSourcePanel`（锚定接收位）；选中即走 `linkSubjectStateMedia` |
| 非 CAS 历史键 | 不显示「引用已失效」；`usePreviewImage` 失败时显示「媒体无法显示」 | 同上可替换 |

### 4.6 键盘与焦点

- 左栏行：`Tab` 可达，`Enter/Space` 选中，`↑/↓` 在行间移动（自定义 roving tabindex 可选，不强制）。
- 右栏输入：`Tab` 顺序 = 状态名 → 备注 → 集数 chips → 接收位操作 → 删除。
- `Esc`：仅关闭浮层（来源面板/抽屉）；不取消选中。
- 所有可点区域使用原生 `button` 或带 `role+tabIndex` 的容器，保留 `data-*` 钩子。

### 4.7 测试/自动化钩子（稳定标识）

| 钩子 | 位置 |
|------|------|
| `data-subject-workspace` + `data-subject-page=<list|subject|state>` | 工作台根容器（值 = 当前层级，兼容旧断言） |
| `data-subject-rail` / `data-subject-row="<id>"` | 左栏容器 / 主体行 |
| `data-subject-panel` / `data-subject-header` | 中栏 / 主体头 |
| `data-state-card="<stateId>"`（基础 = `__base__`） | 状态卡 |
| `data-state-inspector` | 右栏 |
| `data-field="name|prompt"`、`data-episodes-field`、`data-media-slot`、`data-send-target` | 右栏字段（沿用现有钩子名） |
| `data-subject-list-empty` / `data-subject-states-empty` | 空态 |

---

## 5. 与现有数据的关系

### 5.1 零迁移直接复用

| 数据 | 来源 | 用途 |
|------|------|------|
| `ProductionItem`（name/kind/aliases/consistency/images/coverKey/episodeIds/voice） | `productionItems` prop | 左栏行、主体头、封面回落（`resolveSubjectCover`） |
| `SubjectTree`（rootId/name/kind/baseState/states/coverKey） | `subjectTree` prop + `onChangeTree` | 中栏全部内容与写入 |
| `SubjectTreeNode`（state/step/media/origin/appearEpisodes/source/fullPrompt/deltaPrompt） | 同上 | 状态卡与右栏字段 |
| `states[0].media[0]` | 树 | 基础卡缩略与基础图编辑 |
| `appearEpisodes` | 节点 | chip 多选 + 排序/标签（悬空编号过滤显示） |
| `origin` | `media[0].origin` | 来源徽章（可缺省） |
| `view-prefs.subjectLibrary.activeKind` | store | 左栏类型筛选持久化 |
| `view-prefs.subjectPages.lastByProject` | store | 刷新恢复（形状 `{ rootId, stateId|null }` 原样可用） |

### 5.2 需要「兼容读取」而非迁移

| 情况 | 处理 |
|------|------|
| 主体无树（只建过条目） | 选中时按现有逻辑幂等建树：`createSubjectTree` + `buildBaseStatePrompt` + 条目图片带入，写回容器 |
| 状态无 `step` | 显示层走 `normalizeSubjectTree` 补号（不改存储） |
| 媒体引用无 `origin` | 不显示来源行，不报错 |
| 非 CAS storageKey | 视为存活，靠 `usePreviewImage` 回落占位 |
| 历史 video 引用 | 只读展示（`视频不再支持，仅保留引用`），不提供新关联 |
| 旧浏览器 history marker | 三态字段未变，直接可映射到三栏选中组合 |
| `states[0].media` 与 `ProductionItem.images` | 两者并存：主体头部封面/基础卡缩略走 `states[0]`；左栏封面走 `resolveSubjectCover(ProductionItem)`；不改任何一侧 |

### 5.3 明确不读的数据

- `sharedParams`：属于工作台（导演台）容器的公共参数，与主体无关，不读。
- `StoryboardEntity.referenceImages`（`workbench-types.ts`）：分镜/工作台侧实体参考图，另一条链路，不读。
- `subjectTree` 之外的 `shots/script/entities`：不读、不写。

### 5.4 旧树视图保留边界

- `StoryboardSubjectTree` + `LegacyStoryboardSubjectTab` **原样保留**，唯一入口是分镜全屏编辑器（`storyboard-fullscreen-editor.tsx`，不传 `pagesMode`）。
- 主体库页签的 `pagesMode` 分支完全切到新工作台；旧树不再从主体库可达。
- 两套 UI 共享数据层（`linkSubjectStateMedia` / `subject-tree-types`），因此任何一方写入都会被另一方读到（刷新后）。

---

## 6. 迁移与风险

### 6.1 改动文件清单

| 文件 | 改动 | 备注 |
|------|------|------|
| `src/features/canvas-nodes/storyboard/subject-library-pages.tsx` | 内部重写为工作台容器（导出名与 props 保持不变） | `StoryboardSubjectTab` 的 pages 分支无需改签名 |
| `subject-library-rail.tsx`（新） | 左栏：筛选/搜索/主体行/行菜单 | 纯展示 + 回调 |
| `subject-state-panel.tsx`（新） | 中栏：主体头 + 状态卡网格 + 空态 | — |
| `subject-state-inspector.tsx`（新） | 右栏：基础/状态两套字段 + 危险区 + 发送指示 | 复用现有面板组件 |
| `subject-library-tokens.ts`（新） | 语义 token 派生（深/浅） | 唯一允许出现具体色值的地方 |
| `subject-media-preview.tsx` | 追加 `SubjectStateCover`（16:9 只读缩略，走同一解析链） | 不改变现有 `SubjectMediaThumb` 行为 |
| `subject-page-nav.ts` | 注释口径对齐（三态 = 三栏选中组合）；接口保持不变 | 不改 marker/记忆格式 |
| `src/features/canvas-tabs/storyboard-tab-content.tsx` | 非空时也显示「主体库 + 主体数」标题（当前只在零主体时显示） | 提供页面级顶栏，避免工作台重复造 |
| `src/i18n/{zh,en,ja}.json` | 新增工作台文案 key | 不删除旧 key（旧树仍在用） |
| `subject-library-pages.test.tsx` | 按三栏形态改写定位与 2 条面包屑断言；发送往返/记忆恢复断言保留 | 见 6.2 |

**不修改**：`subject-state-media.ts`、`subject-send.ts`、`subject-link-dialog.tsx`、`subject-media-source-panel.tsx`、`StoryboardSubjectTree.tsx`、`storyboard-fullscreen-editor.tsx`、`StoryboardSubjectTab.tsx`（除 pages 分支保持现状）、`entities/slot-containers.ts`、`entities/cas-store.ts`、`entities/script-store.ts`。

### 6.2 测试影响

| 现有用例 | 影响 | 处理 |
|---------|------|------|
| 「列表 → 主体 → 状态，面包屑逐级可点返回」 | 面包屑消失，`data-subject-page` 值仍随层级变化 | 改为断言：左栏行选中态、中栏主体头、右栏字段；删除 2 条 crumb 断言 |
| 「添加状态后主体页计数即时更新」 | 添加状态不再跳页 | 改为断言中栏计数 + 右栏自动选中新状态 |
| 「返回不丢草稿」 | 无返回动作 | 改为：切换主体再切回，右栏值仍在 |
| 刷新恢复 / 记忆已删回落 | 不变 | 保留（`data-subject-page` 仍可用） |
| 发送直达 / 无当前状态弹层 | 行为不变 | 保留；补充「基础状态选中时发送走弹层」用例 |
| `navigateToView('subject', …)` | 不变 | 保留 |

新增建议用例：删除状态后选中回落、失效媒体显示与重连入口、当前接收位徽标只出现在一个卡上。

### 6.3 回归风险点

| 风险 | 触发 | 缓解 |
|------|------|------|
| 发送上下文残留 | 切换主体时旧 effect 的清理时序 | 清理函数按 `projectId/rootId/stateId` 三元组只清自己那份（现有实现已如此），并在测试中覆盖主体切换 |
| CAS 引用泄漏 | 删除状态/主体时先删树后释放 | 固定顺序：先 `releaseSubjectStateMediaRefs` → 再改树 |
| 每卡一次 CAS 探测 | 状态多时并发 `hasCasEntry` | 将探测结果按 storageKey 做进程内 memo（同一 key 只探一次）；或仅对可视卡探测 |
| 旧 history marker | 用户从旧版本升级，浏览器里残留三级 marker | `markerToLevel` 字段不变，可直接映射；无 `__subjectPages` 则保持当前选中 |
| 文案缺失 | 新 key 未同步三语 | zh/en/ja 同批提交，CI 若有三语校验需通过 |
| 父级标题重复 | 工作台自造标题 | 明确顶栏归父级，工作台不再渲染「主体库」标题 |
| 窄屏挤压 | 1280px 下 264+360 挤压中栏 | < 1200px 右栏降级为抽屉；中栏最小 420px |
| 依赖另一条线的文件 | 资产卡「发送到主体」入口 | 不触碰，仅复用 `sendAssetToSubject` 公共出口 |

---

## 7. 不做的事（本轮明确不碰）

1. 不改 `linkSubjectStateMedia` 的语义与 CAS 记账规则（不复制文件、refCount 增减、同 key 幂等）。
2. 不改 `sendAssetToSubject` / `subject-link-dialog` 的直达、降级、3 秒撤销逻辑。
3. 不改 `script` / `storyboard` 容器结构（`shots`、`entities`、`script`、`workbench` 数据一律不动）。
4. 不重写分镜全屏编辑器的 `LegacyStoryboardSubjectTab` / `StoryboardSubjectTree`；旧树保持现状。
5. 不碰资产卡片/资产抽屉侧的「发送到主体」按钮与入口（另一条线在改）；只复用其公共执行器。
6. 不在主体库增加任何 AI 生成按钮（沿用既有约定：AI 走画布 Agent）。
7. 不新增持久化字段：暂不做左栏拖拽调宽、状态拖拽排序、批量选择、虚拟列表。
8. 本轮不做封面手动指定 / 恢复默认（仍由 `resolveSubjectCover` 自动回落；后续可放到主体头「⋯」菜单）。
9. 不做基础状态接收资产（`baseState` 不是 `states[]` 槽位）；除非拍板扩展写入层（见第 8 节）。
10. 不做独立的「列表页」；零主体空态继续由父级承担。

---

## 8. 需要拍板的点

1. **主方案 / 备选**：采用三栏工作台（左栏常驻），还是两级页面 + 抽屉（风险更低）？本规格默认三栏。
2. **基础状态是否可作为资产接收目标**：现状不可（只能走选择弹层）。若要求「选中基础状态也能直接接收资产」，需要扩展 `linkSubjectStateMedia` 支持 `__base__` 槽位——本轮按「不做」处理。
3. **左栏数据源是否合并孤儿主体树**（有 `SubjectTree` 但 `productionItems` 无同名条目）：现状只列 `productionItems`。合并可避免孤儿不可达，但需要定义删除与改名口径；本轮默认不合并。

---

## 9. 收色规范（2026-11-05 追加，已落地）

规则：**整个主体库只保留一个强调色 + 其余中性灰**。强调色沿用应用系统 accent 绿（导轨选中态同源），不再使用 `theme.toolbar.accent`（运行时为 `#e94560` 粉红）作为信息载体色。类型、封面占位等信息元素不参与着色。

### 9.1 唯一取值源

`src/shared/components/library-card-tokens.ts`：

| token | 深色 | 浅色 |
|-------|------|------|
| `LIBRARY_ACCENT`（实底 / 描边） | `#00c758` | `#00c758` |
| `libraryAccentText()`（强调色文字） | `#00c758` | `#0a8a43` |
| `libraryAccentTint()`（强调色浅底，默认 alpha） | `rgba(0,199,88,0.16)` | `rgba(0,199,88,0.10)` |
| `libraryCardBadgeStyle()`（类型角标，中性） | 底 `rgba(255,255,255,0.06)` / 边 `rgba(255,255,255,0.20)` / 字 `#a8a29e` | 底 `rgba(255,255,255,0.9)` / 边 `rgba(15,23,42,0.16)` / 字 `#78716c` |

### 9.2 改前 → 改后

| 元素 | 改前（深/浅同 `theme.toolbar.accent` 系） | 改后 深色 | 改后 浅色 |
|------|------------------------------------------|-----------|-----------|
| 主按钮「添加主体」实底 | `#e94560` + 白字 | `#00c758` + `#ffffff` | `#00c758` + `#ffffff` |
| 胶囊筛选·选中 | 底 `#e94560` / 边 `#e94560` / 字 `#ffffff` | 底 `rgba(0,199,88,0.16)` / 边 `#00c758` / 字 `#00c758` | 底 `rgba(0,199,88,0.10)` / 边 `#00c758` / 字 `#0a8a43` |
| 胶囊筛选·未选中 | 边 `theme.toolbar.border` | 边 `#404040` / 透明底 | 边 `#d4d4d4` / 透明底 |
| 类型标签（角色/场景/道具/未分类） | 角色绿 `rgba(34,197,94,0.16)`、场景蓝、道具紫 `rgba(168,85,247,0.16)` | 中性底 `rgba(255,255,255,0.06)` / 边 `rgba(255,255,255,0.20)` / 字 `#a8a29e` | 中性底 `rgba(255,255,255,0.9)` / 边 `rgba(15,23,42,0.16)` / 字 `#78716c` |
| 空封面占位 | 彩色 emoji（角色 `👤` 紫色剪影 / 场景 `📍` / 道具 `📦`） | lucide 中性剪影 `#a8a29e` + 文字 `#a8a29e` | lucide 中性剪影 `#78716c` + 文字 `#78716c` |
| 空封面底色 | 深 `rgba(255,255,255,0.02)` / 浅 `#ffffff` | 不变 | 不变 |
| 选中卡描边 | `1px solid #e94560` | `1px solid #00c758` | `1px solid #00c758` |
| 状态卡 focus ring | `rgba(233,69,96,0.32)` | `rgba(0,199,88,0.32)` | `rgba(0,199,88,0.32)` |
| 「添加新状态」虚线 hover | 边 `#e94560` / 底 `rgba(233,69,96,0.06)` | 边 `#00c758` / 底 `rgba(0,199,88,0.06)` | 同深色 |
| 搜索框 / 集数筛选 / 字段 focus 描边 | `#e94560` | `#00c758` | `#00c758` |
| 出现集数勾选 chip | 边 `#e94560` / 底 `rgba(233,69,96,0.10)` / 勾选框 `#e94560` | 边 `#00c758` / 底 `rgba(0,199,88,0.10)` / 勾选框 `#00c758` | 同深色 |

### 9.3 覆盖范围

整页（`StoryboardSubjectTab` 的 pages 模式）与资产抽屉「主体」分段（`SubjectGroup`）渲染的是同一个 `SubjectLibraryPages`，色值只在 `library-card-tokens.ts` 与组件内同一组 token 取值，不存在第二套主题色。`danger`（删除类操作）保持 `theme.toolbar.danger` 语义红，不参与强调色收敛。
</content>
