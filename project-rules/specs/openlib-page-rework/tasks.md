# Tasks：开源资产库独立页返工 + 「我的资产库」改名

依据 project-rules/specs/openlib-page-rework/spec.md。顺序即执行序，T6 前的编码任务全部完成后统一验证。

## T1 扩展单源动作：card-send-actions 支持 canvasDisabled
- [ ] `SendActionHandlers` 增 `canvasDisabled?: boolean`
- [ ] hover 画布按钮统一置灰 + Tooltip `openLib.noCanvasTarget`；`buildSendMenuItems` 同规则 disabled
- 验证：不传参数时三作用域行为零变化（对照 SendActionButtons 现有分支）

## T2 新建 OpenLibBrowser（单一定义源）
- [ ] `src/features/open-library/open-lib-browser.tsx`：迁移 OpenLibGroup 的卡片/工具行/门控/网格/分页 + importing/importAndSend 内聚 + LicenseBadges/原站链接次级信息行
- [ ] Props `{ theme, sendToCanvas? }`；sendToCanvas 缺省 → 卡片画布动作 `canvasDisabled`
- 验证：与旧 OpenLibGroup 逐行对照，逻辑零改动

## T3 OpenLibGroup 改薄壳（抽屉回归不变）
- [ ] 重写为 `OpenLibBrowser + store.sendToCanvas` 包装
- 验证：MaterialGroup 调用契约不变；Grep 确认卡片定义仅存在于 open-lib-browser

## T4 独立页 + 路由
- [ ] `src/features/open-library/open-lib-page.tsx`（标题行 + OpenLibBrowser）
- [ ] `src/app.tsx`：Route/parseHash/serializeRoute/activeRoute('assets')/渲染分支 `#/openlib`
- 验证：#/assets 点入口按钮 → hash #/openlib；浏览器后退可回

## T5 首页改造
- [ ] `asset-library-page.tsx`：删 OpenLibrarySection 引用与渲染；Props 增 onOpenOpenLib 透传
- [ ] `asset-library-toolbar.tsx`：标题 i18n 化（assetLibrary.pageTitle）+ 入口按钮（!embeddedInCanvas && onOpenOpenLib）
- 验证：Grep `OpenLibrarySection` 全库 0 引用；embeddedInCanvas 路径无按钮

## T6 删除废弃代码
- [ ] `open-library-ui.tsx` 删 OpenLibrarySection/OpenLibGalleryView/GalleryCard
- [ ] `open-library.ts` 注释措辞（公共资产库→用户资产库）

## T7 改名（三语 i18n + 6 处代码默认值）
- [ ] zh/en/ja：assetLibrary.pageTitle、scopeTagLibrary；subject.srcTabLibrary/sourceLibrary/uploadScopedHint；openLib.entryButton/noCanvasTarget/adultHiddenHint
- [ ] 代码默认值：scope-capsule-tabs / asset-card / asset-library-page×2 / StoryboardSubjectTree / subject-media-source-panel / toolbar uploadTargetLabel
- 验证：Grep 精确「公共资产库」src 0 hit；t() 默认值与 i18n 值中 公共资产/公共库 清零（注释/测试内部描述豁免）

## T8 验证 + 构建
- [ ] vitest：canvas-assets、asset-library、open-library 相关套件（含 store-guard / material-scope 预存断言）
- [ ] typecheck：本任务文件过滤比对基线（全库预存错误不新增）
- [ ] 浏览器实测：#/assets 仅一个入口；#/openlib 翻页/筛选/搜索/18+ 门控；抽屉三作用域动作一致回归
- [ ] 性能实测：独立页首次渲染（3000+ 条目、60/页）记录数字
- [ ] `pnpm build` → dist 精确字样复查（公共资产库 0 hit）→ 回报新包名

## 追加任务（用户后续拍板，2026-11-05）

### T9 任务D：入口移到 sidebar 图标按钮（首页按钮撤销）
- [x] app-sidebar：NAV_ITEMS 第三项 openlib（Globe 线稿路径）+ data-testid="sidebar-nav-openlib" + i18n nav.openLib
- [x] mobile-nav-drawer：NavRouteItem + 图标分支（移动端同级出现）
- [x] app.tsx：navItems/handleNavigate/activeRoute openlib 选中态；撤销 AssetLibraryPage.onOpenOpenLib
- [x] toolbar：撤入口按钮；asset-library-page：撤 prop（资产库页恢复原样）

### T10 任务E：独立页右侧大片空白修复
- [x] 根因：AppLayout Content 为 row flex，页面根节点缺 width/flex → 宽度塌缩 ≈800px
- [x] open-lib-page 根节点补 width:100%/flex:1/minWidth:0；网格 auto-fill 吃全宽

### T11 任务F/G：开源横幅零容忍 + 头部极简（旧截图系未重建的 dist 残留）
- [x] 资产库页无任何开源横幅/库卡片墙（OpenLibrarySection 已删，静态断言 0 引用）
- [x] openlib 页 = 抽屉同款 OpenLibBrowser（同 chips/分类/搜索/分页/卡片）
- [x] 头部删除返回箭头 + 地球图标；标题纯文字「开源资产库」+ 一句极简副标题

### T12 构建
- [x] typecheck 任务文件 0 新增；vitest 61/61 通过；card-send-actions 返回类型改 antd MenuProps['items']（修复 antd v5 ItemType 联合收窄误判）
- [x] dist 重建：index-DfasqDkG.js（终版）；dist 中「公共资产库」等旧字样 0 命中
- [x] 浏览器实测（强制重载，终版 bundle）：sidebar-nav-openlib 存在 + tooltip「开源资产库」+ 点击跳 #/openlib 且 active 态正确、返回 #/canvas 取消；#/assets 无横幅、页内无开源字样；#/openlib 头部纯文字（无箭头/无图标）；条目网格 60/页、CSS grid 1fr 填满（960px 视口 6 列、末列距容器右缘 slack=0、无横向滚动；按同公式 1024→7 列 / 1280→9 / 1440→10 / 1920→13）
- [x] 插曲记录：验收期间另一会话并发重建 dist（曾短暂覆盖/清空），按「等对方建完再建」约定轮替重建后终验通过；tooltip 误报「项目」系并发构建期间旧驻留 SPA 所致，终验排除

