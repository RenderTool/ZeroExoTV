# Spec：开源资产库独立页返工 + 「我的资产库」改名（任务C）

工程：`D:\AICode\zeroexo\zeroexo-comfyui`。三项用户指令：
1. 首页（#/assets）不内嵌开源库分区，只放一个入口按钮 → 切换到独立整页画廊（#/openlib）。
2. 「公共资产库/公共资产/公共库」全部用户可见文案改名「我的资产库/我的资产」（三语；存储 scope 标识不动）。
3. 开源库独立页与抽屉同一套分类展示与卡片样式（单一定义源组件），18+ 门控/只读标记/原站链接保留为一致次级信息。

## 一、新增文件

### 1. `src/features/open-library/open-lib-browser.tsx`（单一定义源浏览器）
从 `canvas-assets/groups/OpenLibGroup.tsx` 原样迁移（不重写逻辑）：
- `OpenLibEntryCard`：`OpenLibThumb` + 只读角标（openLib.readonlyBadge）+ `SendActionButtons`（hover）+ `Dropdown contextMenu buildSendMenuItems`（右键），卡片结构/尺寸与现抽屉完全一致
- 库 chips 行（7 库、indexed 过滤、切库重置分类与页码）+ 库内分类 chips + `SearchBox`（250ms 防抖）+ 18+ 门控行（`confirmAge`/`revokeAgeConfirmation`，testid `openlib-age-gate-button` 保留）+ 条目网格（`minmax(min(100%,120px),1fr)`）+ `PaginationBar`（60/页）
- **importing 状态 + `importAndSend` 收归组件内部**（单源执行器）：`importOpenLibEntry(entry)` → `sendToCanvas(asset)` 或 `sendAssetToWorkbench(asset, message, t)`；失败 `message.error`
- 次级信息行（与宿主无关、两处一致）：当前库授权徽标（迁移 `LicenseBadges`）+ 原站链接
- Props：`{ theme: ThemeConfig; sendToCanvas?: (asset: Asset) => void }`
  - `sendToCanvas` 提供与否 → 画布动作可用/统一置灰（见三.1），动作集合本身不减

### 2. `src/features/open-library/open-lib-page.tsx`（独立整页）
- 标题行：返回按钮（回 #/assets）+ `openLib.sectionTitle` + `openLib.sectionSubtitle`
- 主体：`<OpenLibBrowser theme={theme} />`（不传 `sendToCanvas` → 画布动作置灰，导演台动作照常）
- 布局：flex column + `height:'100%'`，网格区 `flex:1 overflowY:auto`（沿用浏览器内部滚动）

## 二、修改文件

### 1. `src/features/asset-library/cards/card-send-actions.tsx`
- `SendActionHandlers` 增加可选 `canvasDisabled?: boolean`：
  - hover：画布按钮 `disabled` + opacity 0.45 + Tooltip `t('openLib.noCanvasTarget')`（与导演台 unsupportedKind 置灰同规则、同表现形式）
  - `buildSendMenuItems`：画布项 `disabled` + label 追加说明（与导演台不支持时的写法同款）
- 其余作用域不传该参数，行为零变化

### 2. `src/features/canvas-assets/groups/OpenLibGroup.tsx`（抽屉宿主，重写为薄壳）
```tsx
export function OpenLibGroup({ store, theme }) {
  const sendToCanvas = useCallback(
    (asset: Asset) => store.sendToCanvas({ type: 'asset', id: asset.id, data: asset }),
    [store]);
  return <OpenLibBrowser theme={theme} sendToCanvas={sendToCanvas} />;
}
```
`MaterialGroup.tsx` 对 `<OpenLibGroup store theme>` 的调用契约不变，不动。

### 3. `src/app.tsx`
- `Route` union 增 `| { name: 'openlib' }`
- `parseHash`：`case 'openlib': return { name: 'openlib' }`
- `serializeRoute`：`case 'openlib': return '#/openlib'`
- `activeRoute`：openlib 归入 `'assets'` 高亮
- 渲染分支：openlib → `<OpenLibraryPage onBack={() => setRoute({ name: 'assets' })} />`（套 AppLayout 头+侧栏；watchTarget 逻辑天然 pid=null，无需改）

### 4. `src/features/asset-library/asset-library-page.tsx`
- 删除 `OpenLibrarySection` import 与 `{!props.embeddedInCanvas && <OpenLibrarySection/>}` 渲染块
- Props 增 `onOpenOpenLib?: () => void`，透传给 `AssetLibraryToolbar`（memo deps 同步）

### 5. `src/features/asset-library/components/asset-library-toolbar.tsx`
- Props 增 `onOpenOpenLib?: () => void`
- 主页模式标题行：硬编码「资产库」→ `t('assetLibrary.pageTitle', '我的资产库')`；标题后新增入口按钮 `<Button icon={<Globe/>}>t('openLib.entryButton')</Button>`，仅 `!embeddedInCanvas && onOpenOpenLib` 时渲染（抽屉/弹窗零影响）
- `uploadTargetLabel` 默认值 `上传到公共资产库` → `上传到我的资产库`

### 6. `src/features/open-library/open-library-ui.tsx`
- 删除 `OpenLibrarySection` / `OpenLibGalleryView` / `GalleryCard`（首页内嵌方案废弃）；保留 `OPEN_LIB_PAGE_SIZE` / `resolveOpenLibImageUrl` / `OpenLibThumb` / `useOpenLibMeta` / `useOpenLibGallery`
- `LicenseBadges` 迁入 open-lib-browser.tsx

### 7. `src/features/open-library/open-library.ts`
- 仅第 8 行注释「不进用户公共资产库」→「不进用户资产库」（使精确字样全库为 0；不改任何逻辑）

## 三、改名（仅用户可见文案；存储 scope 标识/注释语义不动）

### 代码内 t() 默认值（5 处）
| 文件 | 旧 → 新 |
|---|---|
| scope-capsule-tabs.tsx:55 | `公共资产` → `我的资产` |
| asset-card.tsx:279 | `公共` → `我的` |
| asset-library-page.tsx:349/351 | `还没有公共资产`→`还没有资产`；`可以从公共库引用或直接上传`→`可以从我的资产库引用或直接上传` |
| StoryboardSubjectTree.tsx:364 | `公共库` → `我的资产库` |
| subject-media-source-panel.tsx:247 | `公共资产` → `我的资产` |
| asset-library-toolbar.tsx | `上传到公共资产库` → `上传到我的资产库` |

### i18n（zh/en/ja 三份同步）
| key | zh | en | ja |
|---|---|---|---|
| assetLibrary.pageTitle（zh 现值「资产」，未被引用，直接改） | 我的资产库 | My Asset Library | マイアセットライブラリ |
| assetLibrary.scopeTagLibrary | 我的 | My | マイ |
| subject.srcTabLibrary | 我的资产 | My assets | マイ素材 |
| subject.sourceLibrary | 我的资产库 | My library | マイライブラリ |
| subject.uploadScopedHint | 不进入我的/项目资产库 | never your/project asset lists | マイ・プロジェクト素材には入りません |
| openLib.entryButton（新增） | 开源资产库 | Open Asset Library | オープン素材ライブラリ |
| openLib.noCanvasTarget（新增） | 当前没有打开的画布，可在画布内素材抽屉使用 | No canvas is open — use it from the canvas asset drawer | 開いているキャンバスがありません。キャンバス内の素材ドロワーからご利用ください |
| openLib.adultHiddenHint | {{count}} 条 18+ 内容已隐藏（确认后本库所有页面生效） | {{count}} adult entries hidden (unlock applies to all pages of this library) | 成人向け {{count}} 件を非表示（確認後このライブラリの全ページで有効） |

不动的：`promptSource.public`（提示词来源，与资产库无关）、changelog 历史文案、`nav.assets`。

## 四、验收断言（命令与预期）

| # | 断言 | 命令（项目根） | 预期 |
|---|---|---|---|
| A1 | 卡片单源复用 | Grep `open-lib-browser` 于 OpenLibGroup.tsx 与 open-lib-page.tsx | 两文件均 import 同一组件；全库 `OpenLibEntryCard` 定义仅 1 处（open-lib-browser.tsx） |
| A2 | 精确字样清零（src） | Grep `公共资产库` 于 src | 0 hit |
| A3 | 精确字样清零（dist） | 构建后 Grep `公共资产库` 于 dist | 0 hit |
| A4 | 首页无内嵌开源库 | Grep `OpenLibrarySection` 于 src | 0 hit（组件已删除） |
| A5 | 用户可见「公共资产/公共库」清零 | Grep `公共资产|公共库` 于 src，逐一人工核对命中行 | 仅剩代码注释/测试文件内部描述（非用户可见） |
| A6 | 路由可达 | 浏览器实测 #/assets 入口按钮 → #/openlib 整页画廊；后退回 #/assets | hash 正确切换、内容不混排 |
| A7 | 抽屉回归 | openlib 段翻页/分类/搜索/18+ 解锁与撤销/发送画布/发导演台 | 与改造前一致 |
| A8 | 测试 | vitest 跑 canvas-assets / asset-library / open-library 相关套件 | 全绿（预存 mp4box vendor 失败除外）；store-guard、material-scope 断言不回归 |
| A9 | typecheck | 按本任务文件过滤 | 相对全库基线 0 新增 |
| A10 | 性能 | 浏览器实测 #/openlib 首次渲染（3474 条目、60/页） | 记录 DOMContentLoaded/可交互数字（对照 ≈235ms 口径） |
| A11 | 构建 | `pnpm build` | 回报新 dist 包名（上次 index-BsJpjd3r.js） |

（表内 A1–A5 为静态断言，A6–A7 为浏览器实测，A8–A11 为工程验证。）

## 五、决策论证：独立页「发送到画布」置灰而非消失/砍除

- 任务B验收口径：「三类作用域条目动作集合完全相同（漏一个即失败）」——本 spec 中**抽屉三作用域（我的/本项目/开源库）全部动作可用**，完全满足。
- 独立页（#/openlib）上没有打开中的画布（EditorPage 已卸载、`store.sendToCanvas` 不存在），「发送到画布」在此宿主**物理不可达**。处理遵循任务B第4条既有规则：「不支持的场景按同一规则统一置灰并给一致说明，不许只在一个作用域悄悄消失」——按钮/菜单项**仍然渲染**（动作集合不缺项），统一 `canvasDisabled` 置灰 + Tooltip `openLib.noCanvasTarget`，与「纯文本不能发导演台」完全同款处理。
- 「发送到导演台」在独立页保持可用（`sendAssetToWorkbench` 是全局执行器；无活动片段时给出统一提示，不静默）。

## 六、明确不做

- 不改开源库存储/索引代码（open-library.ts 数据 API 只读）
- 不改公共/本项目作用域的删除撤销、就地编辑逻辑（store-guard.test 既有断言必须继续通过）
- 不改抽屉胶囊第三段行为与 store.openLibCount 口径
- 非 Chromium 不引入新依赖（bundled 相对路径缩略图 + antd 组件，保持兼容）
