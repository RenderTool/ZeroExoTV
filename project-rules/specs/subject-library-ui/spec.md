# 主体库 UI 重新设计 · 规格

> **2026-11-12 口径（现行）**：状态不再有第三层整页，编辑面板就在状态卡里展开并拉通整行；
> 出现集数只留一枚摘要按钮（弹层里勾选），状态卡与编辑面板都不铺集数标签；
> 面包屑只到「主体库 / 主体名」。详见 `subject-pages/spec.md` 顶部说明与 S-23。
> 下文 §3.5 的「状态编辑页 / 右列两列表单」保留为 2026-11-05 的历史形态记录。

> 目标只有一个：**把主体库三级页面拉回全站既有设计语言**，不是另起一套。
> 硬约束（用户 2026-11-05 明确）：**禁止绿色**。强调色只允许 `theme.toolbar.accent`（`#e94560`）。

---

## 1. 现状问题（有证据）

| # | 问题 | 证据位置 | 后果 |
|---|------|----------|------|
| 1 | 主体库自带一套绿色强调色 `#00c758` | `library-card-tokens.ts:93-97` | 与 `DESIGN.md` 主色 `#e94560` 冲突；**同屏双主色**：外层页头「添加主体」是红（`storyboard-tab-content.tsx:95`），内层按钮是绿 |
| 2 | 卡片 token 被复制成第二份 | `library-card-tokens.ts` 全文 vs `shared/ui/tokens.ts` | 角标数值已经漂移（底 `0.06` vs `0.08`、无 18px 高）→ 主体卡角标与资产卡角标不是同一个东西 |
| 3 | 20+ 处手写原生控件 | 搜索框 `:1024`、类型胶囊 `:1043`、集筛选 `:1091`、状态编辑表单 `:1351`/`:1369` | 高度 24/28/32/36 混用、字号 10/11/12/13 混用，与 antd 36px 控件 / 13px 基准脱节 |
| 4 | 搜索框自制 | `:1024-1037`（240 宽、无 prefix 图标、无清除） | 不符合 `DESIGN.md`「Input + prefix 图标 + 240 + allowClear」 |
| 5 | 提示用原生 `title` | `:244`（`CardActionButton`）、`:485` | `DESIGN.md` 要求统一 antd `Tooltip`、禁用自研 tooltip |
| 6 | 卡片 hover 只有描边变色 | `:332`、`:452` | 缺 `DESIGN.md` 规定的位移/阴影层级反馈 |
| 7 | 表单标签 12/600、控件手写 | `:1255`、`:1250-1254` | 与全站 antd 表单（label 在上、`itemMarginBottom:12`、控件 36）不同 |
| 8 | 「出现集数」原生 checkbox | `:1411` | 原生控件在暗色主题下颜色不受控 |
| 9 | 抽屉内嵌仍用 24px 大边距 + 1200 定宽 | `:582`、`:585`、`:594` | 抽屉窄宽下内容被压扁、横向浪费 |
| 10 | 素材位缩略图无视 `size`（有图时 `width:100%`） | `subject-media-preview.tsx:57-67` | 96px 预览被撑成整屏，右侧按钮/提示被挤成竖排 |
| 11 | 状态无法在状态页维护 | 状态卡只有整卡点击 | 想改/删状态必须先点进去，且编辑页里也没有删除状态入口 |

> 注：`subject-media-source-panel.tsx` 的深色浮层是**刻意**与 @ 面板/导演台保持一致的「深浮层」口径，非缺陷，本次不动。

---

## 2. 设计原则

三个「同一」：

1. **同一主色**：唯一强调色 = `theme.toolbar.accent`；危险操作 = `theme.toolbar.danger`；业务类型（角色/场景/道具）不承载颜色。
2. **同一控件体系**：卡片用 `@/shared/ui`（`CardShell` / `Badge` / `IconButton` / 文本 token），工具栏与表单用 antd。
3. **同一页头结构**：三级页面共用一个页头（面包屑 + 计数 + 右侧主操作），不再各写一套。

---

## 3. 规格

### 3.1 颜色

- 唯一强调色 = `theme.toolbar.accent`，只用于：主按钮底、选中卡描边、筛选选中态、输入框聚焦边框。
- 危险操作 = `theme.toolbar.danger`。
- 卡片角标 = `Badge tone="neutral"`（业务类型不上色）。
- **绿色禁用清单**：`#00c758` / `#0a8a43` / `#22c55e` / `#16a34a` / `#10b981` / `#4ade80` / `#86efac`，以及 `rgba(0,199,88,*)`、`rgba(34,197,94,*)`。

### 3.2 页头（三级共用，新增内部组件 `SubjectPageHeader`）

```
[面包屑]  [计数徽标]                          [右侧主操作]
 内容宽 max 1200 居中（抽屉内 100%）
 padding: 24px clamp(16px,3vw,24px) 0（抽屉内 16px）
```

- 面包屑：祖先级 = 11/500 muted（可点）；当前级 = 16/600 text；分隔 `ChevronRight` 10px muted/70%。
- 计数徽标：紧随当前级标题，`Badge` neutral。
- 右侧主操作：antd `Button size="small" type="primary"` + lucide 14px 图标。

### 3.3 列表页

- 工具栏一行：搜索（antd `Input`，240px，`prefix` 搜索图标，`allowClear`）+ 空隙 + 集筛选。
  - **2026-11-06 修订**：行尾依次为「多选开关 → 集筛选」（共用同一 `episodeFilter` / `multiSelectToggle` 片段，整页与抽屉同一实现）。
  - 抽屉（embedded）**不再共用这一行**：旧版把 chips+搜索塞进一列、再把集筛选 `marginLeft:auto` 外挂同一行右侧，
    窄抽屉里被右边缘裁成半截（征集 #181）；现走与素材分段逐行同构的两行（见 §3.6）。
- 类型筛选 → **下划线 Tab**（与资产库分类 Tab 同构）：高 36、13px、选中 `text/500` + 2px accent 下划线 + 计数态 11/50%。
- 集筛选 → antd `Dropdown` + antd `Button size="small"`（24px，`ChevronDown` 13）。
- 主体卡：
  - 外壳 `CardShell`（圆角 12 / 1px 细边 / 中性底），`data-subject-card-cover` 挂在 `CardShell` 上；
  - hover / 聚焦 → `CardShell hovered` → accent 描边；
  - 角标 `Badge tone="neutral"`，左上 6/6；
  - 名称 `uiCardNameStyle`（12/22/500）、元信息 `uiCardMetaStyle`（11/500）；
  - 动作区 hover 露出 3 个 `IconButton size="sm"`（改类型 / 进入 / 删除），每个配 antd `Tooltip`。
  - **多选态（2026-11-06 批量编辑）**：卡片左上出现共享 `MultiSelectCheckbox`（类型徽标右移到 34 让位，与资产卡同口径），
    点卡片 = 选中/取消（不跳转），卡内动作区隐藏（一个时刻只留一套操作）；批量条 = `已选 N` + `改类型` + `删除` + `清空选择`，未选中时动作置灰。
- 空态：中性图标 + 标题 13/600 + 副文案 12 muted + 主按钮「添加主体」（不再只写「点击右上角」）。

### 3.4 主体状态页

- 页头右侧 = 「添加状态」`Button primary small`；原「点击状态卡进入编辑」灰字提示改为「悬停状态卡可编辑或删除」（11/muted）。
  - **2026-11-06 修订**：该提示语已删（冗余教学文案，征集 #177 ④a）；「添加状态」收敛到底端共享 `AddTile`。
- 状态卡：`CardShell` + 16:9 封面（圆角 12）+ 名称 12/500 + 元信息 11/500；失效媒体走 `danger` 色。
  - 元信息只保留「出现集数」，失效时才追加「· 引用已失效」——不再每张卡重复「媒体已就绪」。
  - **卡内动作（用户明确要求：外部就要能编辑/移除状态）**：封面右上角悬停露出 `IconButton sm variant="overlay"`，顺序固定：
    「设为封面」（Star，2026-11-06 新增）+「编辑状态」（Pencil → 进入状态编辑页）+「删除状态」（Trash2 → `Modal.confirm` 确认）。
  - **基础状态不提供删除入口**（它是主体树根，不是 `states[]` 节点），但**可以当封面**。
  - 卡片根节点由 `button` 改为 `div[role=button]`（卡内需要嵌按钮，禁止 button 嵌套 button）。
  - 封面卡左上留一枚常驻 `Badge tone="neutral"` 「封面」（不靠 hover 也能看出选的是哪个状态）。
- 删除状态：先 `releaseSubjectStateMediaRefs({ rootId, stateId })` 释放媒体引用，再从树中剔除；正在编辑它时退回主体状态页。
- 「添加新状态」卡：虚线边框 + `Plus 16` + 13/500（**去掉 monospace**）。

### 3.5 状态编辑页

两列响应式（`repeat(auto-fit, minmax(min(100%,320px),1fr))`，页宽上限 960，抽屉内落成单列）：

- **2026-11-06 修订（用户指令：「很多废话和不合理的按钮布局」）**：
  - 分区标题「基本信息」与说明「名称与提示词会写入生成上下文」全部删除；
  - 左列标签「素材接收位」与底部「媒体已就绪 · 删除后不可恢复 / 待补媒体」提示行删除；
  - 页头「返回主体」按钮删除（面包屑已有同一入口，不留重复）；
  - 页头「删除状态」按钮删除（删除是外层状态卡的动作，详情里不再放第二份）；
  - 页头最终只剩面包屑 + 「修改即时保存」11/muted。
- **左列 · 媒体卡**（`maxWidth 380`）：16:9 `CardShell` 预览框，动作**在封面右上角**（与状态卡 / 主体卡同一落位、同一 `IconButton sm variant="overlay"`）：
  「替换/上传」（`ImagePlus`，`data-media-action="replace"`）+「删除媒体」（`Trash2`，`data-media-action="remove"`，仅已有媒体时出现）。
  - 基础状态与状态**共用同一取数与同一写入入口**（2026-11-08 数据层统一）：基础状态是 `states[0]` 真节点，所有状态槽位一律 = `states[].media[0]`，写入统一走 `linkSubjectStateMedia`（`stateId` 允许 `SUBJECT_BASE_STATE_ID`，含 CAS 记账与 null 移除）。
  - **不只支持图片**：面板四个来源（画布/我的/本项目/手动上传）图片与语音均可关联；旧的「基础状态只能上传图片 + 隐藏 file input」路径已下线。
  - 修复 `subject-media-preview.tsx`：有图时也遵守 `size` / `fill`（原来无脑 `width:100%`，导致素材位被撑成整屏、旁边文字被挤成竖排）。
- **右列 · 字段**：状态名（antd `Input`）、备注/完整提示词（`Input.TextArea`，8–18 行）、出现集数（chip + antd `Checkbox`），字段标签 12/500、说明 11/muted。
- 表单分区：`data-form-section="basic"` 内嵌 `data-form-section="media"`（保持既有嵌套口径，不新增独立卡片分区）。

### 3.6 抽屉内嵌模式（`embedded`）

- 页边距固定 20px（#177 已从 16 对齐素材分段）、取消 1200 定宽、面包屑 `compact` 折叠中间层。
- **工具栏与素材分段逐行同构（2026-11-06，征集 #181）**：
  - 第一行 `ToolbarRow`（共享，内距 8/20/10）放 `CategoryChips`（全部/角色/场景/道具 + 计数）；
  - 第二行 `ToolbarRow paddingTop:0` 放 `SearchBox`（高 26，与素材同一组件）+ 多选开关 + 集筛选；
  - 批量条只在多选态出现，同样走 `ToolbarRow`；
  - 禁止在主体段自写行容器/内距/gap（#176 只做到「用共享组件」未做「行结构同源」，本次补齐）。
- 分段胶囊「主体 N」显示总个数（与列表同源，未加载时不显示徽标，见征集 #180）。

### 3.7 主题

- 三级页面所有颜色取 `ThemeConfig`，亮暗各一套；不得出现只对暗色成立的硬编码色值。
- 媒体来源面板保持既有「深色浮层」口径（与 @ 面板/导演台一致），本次不改。

---

## 4. 改动清单

| 文件 | 改动 |
|------|------|
| `src/shared/components/library-card-tokens.ts` | **删除**（重复 token + 绿色源头） |
| `src/features/canvas-nodes/storyboard/subject-library-pages.tsx` | 重写视觉层；新增状态卡动作、删除状态、编辑页两列布局；保留全部数据逻辑与 `data-*` 钩子 |
| `src/features/canvas-nodes/storyboard/subject-media-preview.tsx` | 缩略图遵守 `size` / `fill`（素材位撑屏修复） |
| `src/features/canvas-tabs/storyboard-tab-content.tsx` | 零主体页头对齐 16/600 + antd 主按钮 |
| `src/features/canvas-nodes/storyboard/subject-library-pages.test.tsx` | 断言从绿改 accent；token 改 `@/shared/ui`；新增状态卡动作/删除用例 |
| `DESIGN.md` | 新增「主体库页」章节：三级页头 + 禁用绿色 |

---

## 5. 验收

- [ ] `pnpm typecheck` 通过
- [ ] `subject-library-pages.test.tsx`、`canvas-tab-slots.test.tsx`、`subject-pages` 相关用例全绿
- [ ] 全仓 `grep '#00c758|0,199,88|0a8a43' src/features/canvas-nodes/storyboard/` = 0 命中
- [ ] 明暗主题各走一遍：列表 → 主体 → 状态 → 媒体来源面板；抽屉内再走一遍
- [ ] 三级页面页头高度/字号/按钮尺寸一致

## 6. 不在本次范围

- 画布编辑器顶栏、导演台导轨的绿色（`#00c758` 作为导轨选中态另有语义与单测锁定，需单独决策）
- 出现集数参与生成过滤——见 `docs/handoff-2026-11-05.md`
- ~~封面设置入口~~ → **2026-11-06 已闭环**：状态卡「设为封面」写 `ProductionItem.coverKey`（走 `resolveSubjectCover` 唯一解析入口），候选集扩展到主体树媒体键，所以树里的状态图/基础图都能当封面（征集 #179）。
