/**
 * AssetLibraryPage - 资产库主页（编排层）
 *
 * 职责：组合子组件，传递数据，不包含业务逻辑。
 * 业务逻辑已抽离到 use-asset-library hook。
 * 卡片渲染已抽离到 cards/ 目录（Card Registry 策略模式）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Pagination, Tooltip, App as AntdApp } from 'antd';
import { X } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { pageStyle, layoutBodyStyle, contentAreaStyle } from './asset-library-styles.js';
import { useAssetLibrary } from './use-asset-library.js';
import type { AssetKindFilter } from './types.js';

// 导入卡片注册表（side-effect import 触发所有卡片注册）
import './cards/index.js';

// 导入子组件
import { AssetLibraryToolbar } from './components/asset-library-toolbar.js';
import { AssetLibraryGridView } from './components/asset-library-grid-view.js';
import { AssetLibraryModals } from './components/asset-library-modals.js';
import type { PageItem } from './types.js';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { autoEpisodeTitle } from '@/entities/script-store.js';
import { HierarchyListView, useFilterOptions } from '@/features/hierarchy/components/hierarchy-list-view.js';
import { downloadAssetsAsZip } from '@/features/asset-picker/services/download-asset.js';
import { sendAssetToWorkbench } from '@/features/canvas-assets/send-to-workbench.js';
import { MediaLightbox, type MediaLightboxItem, type MediaLightboxKind } from '@/shared/components/media-lightbox.js';
import { UploadDropZone } from '@/shared/components/upload-drop-zone.js';
import { cardActionBtnStyle, SEND_ACTION_LABEL_KEYS } from './cards/card-send-actions.js';
import type { HierarchyListDataProps } from '@/features/hierarchy/components/hierarchy-list-view.js';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';

export interface AssetLibraryPageProps {
  onNavigateHome?: () => void;
  onOpenAppearance?: () => void;
  onSendToCanvas?: (item: { type: 'asset' | 'script'; id: string; data: any }) => void;
  sidebarRadius?: number;
  defaultAssetKind?: AssetKindFilter;
  /** 进入资产库时默认激活的分组（如 prompt） */
  defaultGroup?: string;
  /** 进入资产库时默认激活的子分类（如 favorite） */
  defaultChild?: string;
  /** 需要聚焦高亮的卡片 id（复制提示词后跳转定位） */
  focusId?: string;
  /** 强制移动端布局(征集 #87 验收轮七:画布内抽屉嵌入时使用主页移动端同款卡片布局) */
  forceMobile?: boolean;
  /** 卡片网格固定列数(画布内抽屉固定 2 格);缺省按 forceMobile/视口自适应 */
  gridColumns?: number;
  /** 层级分组数据(征集 #87 验收轮九:画布节点注册进资产面板) */
  hierarchyItems?: { id: string; title: string; nodeType: string }[];
  /** 层级分组专属视图(征集 #87 验收轮十:层级按原树形列表渲染,列表视图层级专属) */
  hierarchyListView?: {
    store: ReactGraphStore;
    data: HierarchyListDataProps;
    onFocusNode?: (nodeId: string) => void;
  };
  /** 画布抽屉内嵌(征集 #94/Plan#49 T27):启用抽屉专属排版(无标题/无分割线/筛选下拉/虚线加号格子),主页资产库不传 */
  embeddedInCanvas?: boolean;
  /**
   * 项目上下文覆盖（资产项目化）：画布内 Modal 等无法靠 embeddedInCanvas 判定的
   * 项目内场景显式传入当前画布 ID；缺省按 embeddedInCanvas 自动判定
   * （画布内嵌=项目内取 getCurrentCanvasId()，独立 #/assets 页=项目外 null）。
   */
  projectId?: string | null;
}

export function AssetLibraryPage(props: AssetLibraryPageProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  // forceMobile(征集 #87 验收轮七):画布抽屉嵌入时强制移动端布局;未指定时按视口宽度自适应
  const isMobileAuto = useIsMobile();
  const isMobile = props.forceMobile ?? isMobileAuto;

  // 资产项目化：项目上下文按页面形态显式判定（getCurrentCanvasId 是模块级残留值，
  // 离开编辑器回主页后可能仍非 null，不能直接当作"在项目内"）
  const projectId = props.projectId !== undefined
    ? props.projectId
    : (props.embeddedInCanvas ? getCurrentCanvasId() : null);

  const ctx = useAssetLibrary({
    ...props,
    defaultGroup: props.defaultGroup,
    defaultChild: props.defaultChild,
    hierarchyItems: props.hierarchyItems,
    projectId,
  });

  // ── 右键菜单（本地状态，不与 ctx 耦合，避免右键触发整个页面重渲染） ──
  const [ctxMenuPosition, setCtxMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenuItems, setCtxMenuItems] = useState<ContextMenuItem[]>([]);
  const closeCtxMenu = useCallback(() => setCtxMenuPosition(null), []);

  // 上传文件选择器 ref（Toolbar 上传按钮与右键菜单「上传素材」共用同一入口）
  const materialFileInputRef = useRef<HTMLInputElement>(null);

  // 征集 #96(Plan#49 T29):层级类型筛选状态上提——筛选下拉与统计徽标并入工具栏「筛选+搜索+多选」行,
  // 由本页受控后透传给 HierarchyListView(仅抽屉内嵌模式启用)
  // 2026-11-04 偏好持久化：筛选值写入全局偏好 store，切页签/刷新不丢
  const hierarchyTypeFilter = useViewPrefsStore((s) => s.assetLibrary.hierarchyTypeFilter);
  const setAssetLibraryPrefs = useViewPrefsStore((s) => s.setAssetLibraryPrefs);
  const setHierarchyTypeFilter = useCallback((v: string) => {
    setAssetLibraryPrefs({ hierarchyTypeFilter: v });
  }, [setAssetLibraryPrefs]);
  const hierarchyFilterOptions = useFilterOptions();

  // ── 副本定位聚焦：目标 id + 分页跳转（仅瞬时滚动定位，无动画） ──
  const [highlightId, setHighlightId] = useState<string | null>(props.focusId ?? null);
  const focusJumpedRef = useRef(false);

  useEffect(() => {
    focusJumpedRef.current = false;
    setHighlightId(props.focusId ?? null);
    if (!props.focusId) return;
    // 定位完成后清除高亮 id；同时清除 URL 中的 focus 参数，避免用户重新进入时重复触发定位
    const timer = window.setTimeout(() => {
      setHighlightId(null);
      try {
        if (window.location.hash.startsWith('#/assets')) {
          const base = window.location.hash.split('?')[0];
          const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
          params.delete('focus');
          const newHash = params.toString() ? `${base}?${params.toString()}` : base;
          window.history.replaceState(null, '', newHash || window.location.pathname);
        }
      } catch {
        // 静默处理 URL 操作异常
      }
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [props.focusId]);

  useEffect(() => {
    if (!props.focusId || focusJumpedRef.current) return;
    const idx = ctx.allItems.findIndex((it) => it.data.id === props.focusId);
    if (idx < 0) return; // 数据未加载完成,等下次 allItems 变化再试
    focusJumpedRef.current = true;
    const targetPage = Math.floor(idx / ctx.PAGE_SIZE) + 1;
    if (targetPage !== ctx.page) ctx.setPage(targetPage);
  }, [props.focusId, ctx.allItems, ctx.page, ctx.PAGE_SIZE, ctx.setPage]);

  // ── 上下文菜单 ──
  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: PageItem) => {
    e.preventDefault();
    e.stopPropagation();
    const ItemType = item.type;
    setCtxMenuPosition({ x: e.clientX, y: e.clientY });
    // 征集 #87 验收轮九:层级条目仅支持打开(节点生命周期归画布,无重命名/下载/删除)
    if (ItemType === 'hierarchy') {
      setCtxMenuItems([
        { key: 'open', label: t('common.open'), icon: null, onClick: () => ctx.handleOpenItem(item) },
      ]);
      return;
    }
    const items: ContextMenuItem[] = [
      { key: 'open', label: t('common.open'), icon: null, onClick: () => ctx.handleOpenItem(item) },
      { key: 'rename', label: t('assetLibrary.rename'), icon: null, onClick: () => {
        ctx.setRenameItemTarget({ type: 'asset', id: item.data.id });
        ctx.setRenameItemName(item.data.title);
        ctx.setRenameItemOpen(true);
      }},
      { key: 'download', label: t('common.download'), icon: null, onClick: () => ctx.handleDownloadItem({ type: ItemType as any, data: item.data }) },
    ];
    // 2026-11-07：带引导的生成产物 → 下载可选「视频+引导」，发送可选「引导数据」
    const guideId = (item.data as { guide?: { id?: string } })?.guide?.id;
    if (guideId) {
      items.push(
        { key: 'download-with-guide', label: t('assetLibrary.downloadVideoWithGuide', '下载视频+引导'), icon: null, onClick: () => void ctx.handleDownloadItem({ type: ItemType as any, data: item.data }, { withGuide: true }) },
        { key: 'send-guide', label: t('assetLibrary.sendGuideToDirector', '发送引导数据到导演台当前片段'), icon: null, onClick: () => void sendAssetToWorkbench(item.data, antdMessage, t, { mode: 'guide' }) },
      );
    }
    items.push({
      key: 'delete', label: t('assetLibrary.delete'), icon: null, danger: true, onClick: () => {
        ctx.setConfirmDelete({ type: ItemType as any, id: item.data.id, name: item.data.title });
      },
    });
    // 征集 #87 验收轮七:资产库页重新嵌入画布抽屉,恢复「发送到画布」右键入口。
    // 剧本在 PageItem 中以 type='asset' 存储(类型体系限制),发送时按 data.kind 还原真实类型 'script',
    // 否则画布侧 handleAssetInsert 误入媒体资产分支导致创建失败(2026-08-25 实测教训)。
    if (props.onSendToCanvas) {
      items.push({ key: 'send-to-canvas', label: t('assetLibrary.sendToCanvas'), icon: null, onClick: () => props.onSendToCanvas!({ type: ((item.data as any)?.kind === 'script' ? 'script' : ItemType) as any, id: item.data.id, data: item.data }) });
    }
    // 2026-11-05 约定：发送目标扩展为「画布 / 导演台当前片段」——原入口语义不动，
    // 追加导演台入口（复用唯一槽位分配；满员拒绝提示、无选中片段提示、同资产复用槽号）。
    if (props.embeddedInCanvas && ((item.data as any)?.kind !== 'script')) {
      items.push({ key: 'send-to-director', label: t('assetLibrary.sendToDirector', '发送到导演台当前片段'), icon: null, onClick: () => void sendAssetToWorkbench(item.data, antdMessage, t) });
    }
    setCtxMenuItems(items);
  }, [setCtxMenuPosition, setCtxMenuItems, ctx.handleOpenItem, ctx.setRenameItemTarget, ctx.setRenameItemName, ctx.setRenameItemOpen, ctx.handleDownloadItem, ctx.setConfirmDelete, t, props.onSendToCanvas, props.embeddedInCanvas, antdMessage]);

  // 文件上传回调
  const handleUploadMaterial = useCallback((files: FileList) => {
    const dt = new DataTransfer();
    Array.from(files).forEach((f) => dt.items.add(f));
    void ctx.handleUpload(dt.files);
  }, [ctx.handleUpload]);

  const handleUploadRetry = useCallback((failedFiles: File[]) => {
    const dt = new DataTransfer();
    for (const f of failedFiles) dt.items.add(f);
    void ctx.handleUpload(dt.files);
  }, [ctx.handleUpload]);

  // 稳定化 Toolbar 回调，避免重新渲染导致选项卡闪烁；切换分组时重置多选(防状态残留到下一分组)
  const handleGroupClick = useCallback((group: string) => {
    ctx.setActiveGroup(group);
    ctx.setMultiSelectEnabled(false);
  }, [ctx.setActiveGroup, ctx.setMultiSelectEnabled]);
  const handleChildClick = useCallback((key: string | null) => { ctx.setActiveChild(key); ctx.setPage(1); }, [ctx.setActiveChild, ctx.setPage]);
  const handleMultiSelectToggle = useCallback(() => ctx.setMultiSelectEnabled(!ctx.multiSelectEnabled), [ctx.multiSelectEnabled, ctx.setMultiSelectEnabled]);

  // 稳定化 GridView 回调，避免内联函数每次重渲染创建新引用导致 GridView 重渲染
  const handleRenameItem = useCallback((item: PageItem) => {
    ctx.setRenameItemTarget({ type: item.type as any, id: item.data.id });
    ctx.setRenameItemName(item.data.title);
    ctx.setRenameItemOpen(true);
  }, [ctx.setRenameItemTarget, ctx.setRenameItemName, ctx.setRenameItemOpen]);

  const handleDeleteItem = useCallback((item: PageItem) => {
    ctx.setConfirmDelete({ type: item.type as any, id: item.data.id, name: item.data.title });
  }, [ctx.setConfirmDelete]);

  const handleDownloadItem = useCallback((item: PageItem, opts?: { withGuide?: boolean }) => {
    void ctx.handleDownloadItem({ type: item.type as any, data: item.data }, opts);
  }, [ctx.handleDownloadItem]);

  // 文本类资产：资产浏览器内编辑正文后保存（与提示词同一套「编辑 → 保存」语义）
  const handleAssetDetailSave = useCallback(async (content: string) => {
    const cur = ctx.assetDetail;
    if (!cur?.id) return;
    // 2026-11-05 约定：公共库资产就地编辑保存写回公共作用域，不再拦截
    const nextData = { ...cur.data, content };
    await ctx.updateAsset(cur.id, { data: nextData });
    // 乐观更新详情视图，避免等待刷新期间的视差。
    // 注意：云端 PATCH 只同步 text，不同步 size，故此处不改 bytes
    // —— 否则下次 pull 会用云端旧 size 覆盖回来，造成字节数跳变。
    ctx.setAssetDetail({ ...cur, data: nextData });
  }, [ctx.assetDetail, ctx.updateAsset, ctx.setAssetDetail]);

  // 2026-11-04 约定（口径翻案）：胶囊分段控件只属于画布左侧抽屉「素材」分组
  // （canvas-assets/groups/MaterialGroup），资产库页面（主页/项目弹窗）一律不渲染，
  // 工具栏/标题行不再出现该控件；数据源严格口径保持不变（filterAssetsStrictScope）。

  // 征集 #87 验收轮十三:卡片发送到画布(画布内嵌入时提供;剧本类型按 data.kind 还原)
  const handleSendItemToCanvas = useCallback((item: PageItem) => {
    if (!props.onSendToCanvas) return;
    const type = (item.data as any)?.kind === 'script' ? 'script' : item.type;
    props.onSendToCanvas({ type: type as 'asset' | 'script', id: item.data.id, data: item.data });
  }, [props.onSendToCanvas]);

  // 2026-11-05 约定：卡片飞机按钮改下拉分组——「发送到画布」（原行为不变）/
  // 「发送到导演台当前片段」（复用唯一槽位分配；满员拒绝、无选中提示，不用确认框）。
  const handleSendItemToDirector = useCallback((item: PageItem, mode?: 'video' | 'guide') => {
    void sendAssetToWorkbench(item.data, antdMessage, t, { mode });
  }, [antdMessage, t]);

  // 2026-11-05 用户定稿：卡片点击统一走 MediaLightbox 壳（图片/视频/文本）；
  // 音频/剧本等新壳未覆盖类型仍进旧详情。
  const [lightbox, setLightbox] = useState<{ items: MediaLightboxItem[]; index: number } | null>(null);
  const handleOpenCard = useCallback((item: PageItem) => {
    const d = item.data as { kind?: string; storageKey?: string; content?: string };
    if (d.kind !== 'image' && d.kind !== 'video' && d.kind !== 'text') { ctx.handleOpenItem(item); return; }
    if (d.kind !== 'text' && !d.storageKey) { ctx.handleOpenItem(item); return; }
    const items: MediaLightboxItem[] = ctx.pageItems
      .filter((p) => (p.data as { kind?: string }).kind === d.kind)
      .map((p) => {
        const pd = p.data as { id: string; title: string; kind?: string; storageKey?: string; content?: string };
        return {
          id: pd.id,
          title: pd.title,
          kind: d.kind as MediaLightboxKind,
          storageKey: pd.storageKey,
          content: d.kind === 'text' ? (pd.content ?? '') : undefined,
          source: '全局资产库',
        };
      })
      .filter((i) => i.kind === 'text' || !!i.storageKey);
    const idx = items.findIndex((i) => i.id === (item.data as { id?: string }).id);
    setLightbox({ items, index: idx >= 0 ? idx : 0 });
  }, [ctx.pageItems, ctx.handleOpenItem]);

  // 大图壳顶部动作区（发送到画布 / 导演台）：与卡片/右键菜单同一执行器
  const lightboxPageItem = lightbox
    ? ctx.pageItems.find((p) => (p.data as { id?: string }).id === lightbox.items[lightbox.index]?.id)
    : undefined;
  const lightboxActions = lightboxPageItem ? (
    <>
      {props.onSendToCanvas && (
        <button
          type="button"
          data-lightbox-action="sendToCanvas"
          onClick={() => handleSendItemToCanvas(lightboxPageItem)}
          style={{ ...cardActionBtnStyle, width: 'auto', padding: '0 8px', fontSize: 11 }}
        >
          {t(SEND_ACTION_LABEL_KEYS.sendToCanvas)}
        </button>
      )}
      <button
        type="button"
        data-lightbox-action="sendToDirector"
        onClick={() => handleSendItemToDirector(lightboxPageItem)}
        style={{ ...cardActionBtnStyle, width: 'auto', padding: '0 8px', fontSize: 11 }}
      >
        {t(SEND_ACTION_LABEL_KEYS.sendToDirector)}
      </button>
    </>
  ) : undefined;

  const handleGridCtxMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-item-type]')) return;
    e.preventDefault();
    setCtxMenuPosition({ x: e.clientX, y: e.clientY });
    setCtxMenuItems([
      { key: 'upload-material', label: '上传素材', icon: null, onClick: () => materialFileInputRef.current?.click() },
      { key: 'new-script', label: '新建剧本', icon: null, onClick: () => ctx.handleNewScript() },
    ]);
  }, [setCtxMenuPosition, setCtxMenuItems, ctx.handleNewScript]);

  // 使用 useMemo 完全隔离 Toolbar 的 JSX 创建，避免父组件重渲染时重建
  const toolbar = useMemo(() => (
    <AssetLibraryToolbar
      categories={ctx.categories}
      activeGroup={ctx.activeGroup}
      activeChild={ctx.activeChild}
      search={ctx.search}
      multiSelectEnabled={ctx.multiSelectEnabled}
      scanningProgress={ctx.scanningProgress}
      scanningMessage={ctx.scanningMessage}
      isMobile={isMobile}
      theme={theme}
      embeddedInCanvas={props.embeddedInCanvas}
      hierarchyFilter={props.embeddedInCanvas ? {
        value: hierarchyTypeFilter,
        options: hierarchyFilterOptions,
        onChange: setHierarchyTypeFilter,
      } : null}
      hierarchyNodeCount={props.hierarchyItems?.length ?? 0}
      onGroupClick={handleGroupClick}
      onChildClick={handleChildClick}
      onSearchChange={ctx.setSearch}
      onMultiSelectToggle={handleMultiSelectToggle}
      onUploadMaterial={handleUploadMaterial}
      materialFileInputRef={materialFileInputRef}
      onNewScript={ctx.handleNewScript}
      allowNewScript={ctx.scopeTab === 'project'}
    />
  ), [
    ctx.categories, ctx.activeGroup, ctx.activeChild,
    ctx.search, ctx.multiSelectEnabled,
    ctx.scanningProgress, ctx.scanningMessage,
    isMobile, theme, props.embeddedInCanvas,
    hierarchyTypeFilter, hierarchyFilterOptions, props.hierarchyItems,
    handleGroupClick, handleChildClick,
    ctx.setSearch,
    handleMultiSelectToggle, handleUploadMaterial,
    ctx.handleNewScript, ctx.scopeTab,
  ]);

  // 使用 useMemo 完全隔离主内容区（工具栏 + 网格视图 + 多选栏 + 分页器），
  // 避免右键菜单状态变化时重渲染导致闪烁
  const mainContent = useMemo(() => (
    <div style={layoutBodyStyle(isMobile)}>
      <div style={contentAreaStyle()}>
        {/* 资产项目化：「我的资产 / 本项目」胶囊分段控件已并入工具栏标题行（含无项目上下文的主页，
            主页「本项目」段置灰提示「进入项目后可用」，不出现展示公共内容的假页面）。
            2026-11-05 任务C 约定：开源资产库不内嵌本页——标题行只放一个「开源资产库」
            入口按钮，点击切换到独立 #/openlib 整页画廊（与抽屉同一 OpenLibBrowser） */}
        {toolbar}

        {/* 征集 #87 验收轮十:视图由分组决定——层级 = 原树形列表(层级专属);其余 = 网格卡片(视图切换已全局移除) */}
        {ctx.activeGroup === 'hierarchy' && props.hierarchyListView ? (
          <HierarchyListView
            theme={theme}
            store={props.hierarchyListView.store}
            data={props.hierarchyListView.data}
            onFocusNode={props.hierarchyListView.onFocusNode}
            search={ctx.search}
            multiSelectEnabled={ctx.multiSelectEnabled}
            onMultiSelectToggle={() => ctx.setMultiSelectEnabled(!ctx.multiSelectEnabled)}
            typeFilter={hierarchyTypeFilter}
            onTypeFilterChange={setHierarchyTypeFilter}
          />
        ) : (
          /* 2026-11-04 约定（偏好记忆）：去掉 key={scopeTab} 整块重挂载——
             同一 GridView 实例内切换数据源，视图偏好（筛选/搜索/布局）由全局偏好 store 持久化，
             切段不再丢设置；滚动位置随 scopeView 变化在 GridView 内显式回顶（不串数据），
             选中/多选仍由 setScopeTab 清空（数据上下文状态，非用户偏好）。 */
          <AssetLibraryGridView
            pageItems={ctx.pageItems}
            loading={ctx.loadingAssets}
            multiSelectEnabled={ctx.multiSelectEnabled}
            selectedIds={ctx.selectedIds}
            highlightId={highlightId}
            isMobile={isMobile}
            gridColumns={props.gridColumns}
            theme={theme}
            dragOver={ctx.dragOver}
            dragCounterRef={ctx.dragCounterRef}
            scopeView={ctx.scopeTab}
            emptyTitle={ctx.scopeTab === 'project'
              ? t('assetLibrary.emptyProjectTitle', '本项目还没有资产')
              : t('assetLibrary.emptyLibraryTitle', '还没有资产')}
            emptyHint={ctx.scopeTab === 'project'
              ? t('assetLibrary.emptyProjectHint', '可以从全局资产库引用或直接上传')
              : t('assetLibrary.emptyLibraryHint', '点击上方按钮添加你的第一个资产')}
            onToggleSelect={ctx.handleToggleSelect}
            onOpenItem={handleOpenCard}
            onRenameItem={handleRenameItem}
            onDeleteItem={handleDeleteItem}
            onDownloadItem={handleDownloadItem}
            onContextMenu={handleItemContextMenu}
            onSendToCanvas={props.onSendToCanvas ? handleSendItemToCanvas : undefined}
            onSendToDirector={props.embeddedInCanvas ? handleSendItemToDirector : undefined}
            onUploadClick={() => materialFileInputRef.current?.click()}
            // 2026-11-05 拖拽上传统一交给外层 UploadDropZone（避免双份 drop 处理器重复上传）
            onDragEnter={() => undefined}
            onDragLeave={() => undefined}
            onDragOver={() => undefined}
            onDrop={() => undefined}
            onCtxMenu={handleGridCtxMenu}
          />
        )}

        {/* 多选操作栏(层级分组除外:树形列表自带批量选择) */}
        {ctx.multiSelectEnabled && ctx.activeGroup !== 'hierarchy' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            flexShrink: 0,
            background: 'transparent',
          }}>
            <span style={{ fontSize: 13, color: theme.toolbar.text }}>
              {t('common.batchSelected', { n: ctx.selectedIds.size, defaultValue: `已选 ${ctx.selectedIds.size} 项` })}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button size="small" onClick={ctx.handleToggleSelectAll}>
                {ctx.selectedIds.size === ctx.allItems.length ? t('common.batchSelectNone', '取消全选') : t('common.batchSelectAll', '全选')}
              </Button>
              <Button
                size="small"
                data-asset-batch-download
                disabled={ctx.selectedIds.size === 0}
                onClick={() => {
                  const assets = ctx.allItems
                    .filter((item) => ctx.selectedIds.has(item.data.id))
                    .map((item) => item.data as import('@/features/asset-picker/index.js').Asset);
                  void downloadAssetsAsZip(assets, `assets-${Date.now()}`).then((n) => {
                    if (n > 0) antdMessage.success(t('assetLibrary.batchDownloaded', { n, defaultValue: `已打包下载 ${n} 项` }));
                    else antdMessage.warning(t('assetLibrary.batchDownloadEmpty', '没有可下载的文件'));
                  });
                }}
              >
                {t('assetLibrary.batchDownload', '打包下载')}
              </Button>
              <Button size="small" type="primary" onClick={ctx.handleBatchDelete}>
                {t('common.batchDeleteSelected', '删除选中')}
              </Button>
              <Tooltip title={t('common.multiSelectExit', '退出多选')}>
                <Button
                  size="small"
                  icon={<X size={14} />}
                  onClick={() => ctx.setMultiSelectEnabled(false)}
                />
              </Tooltip>
            </div>
          </div>
        )}

        {/* 分页器(层级分组除外:树形列表不分页) */}
        {ctx.activeGroup !== 'hierarchy' && ctx.allItems.length > ctx.PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', flexShrink: 0 }}>
            <Pagination
              current={ctx.page}
              total={ctx.allItems.length}
              pageSize={ctx.PAGE_SIZE}
              onChange={ctx.setPage}
              showSizeChanger={false}
              size="small"
            />
          </div>
        )}
      </div>
    </div>
  ), [
    isMobile, props.gridColumns, props.embeddedInCanvas, toolbar, ctx.activeGroup, props.hierarchyListView, props.onSendToCanvas, handleSendItemToCanvas, ctx.pageItems,
    ctx.loadingAssets, ctx.scopeTab, ctx.projectId,
    ctx.multiSelectEnabled, ctx.selectedIds, highlightId, theme, t,
    ctx.dragOver, ctx.dragCounterRef, ctx.handleToggleSelect,
    ctx.handleOpenItem, handleOpenCard, handleRenameItem, handleDeleteItem,
    handleDownloadItem,
    handleItemContextMenu, ctx.handleDragEnter, ctx.handleDragLeave,
    ctx.handleDragOver, ctx.handleDrop, handleGridCtxMenu,
    ctx.allItems, ctx.PAGE_SIZE, ctx.page, ctx.setPage,
    ctx.handleToggleSelectAll, ctx.handleBatchDelete, ctx.setMultiSelectEnabled,
    ctx.search,
  ]);

  return (
    <div style={pageStyle()}>
      {/* 2026-11-05 三处共用 UploadDropZone：首页/我的资产库列表（与抽屉、@ 面板同一组件） */}
      <UploadDropZone
        onFiles={(files) => void ctx.handleUpload(files)}
        accept={['image/*', 'video/*', 'audio/*', '.txt', '.md']}
        theme={theme}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        {mainContent}
      </UploadDropZone>

      {/* 大图/全部资产查看（点卡片开；同列表前后切换） */}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.index}
          onIndexChange={(i) => setLightbox((cur) => (cur ? { ...cur, index: i } : cur))}
          onClose={() => setLightbox(null)}
          actions={lightboxActions}
        />
      )}

      {/* 弹窗 */}
      <AssetLibraryModals
        confirmDelete={ctx.confirmDelete}
        onConfirmDelete={ctx.handleConfirmDelete}
        onCancelDelete={() => ctx.setConfirmDelete(null)}
        renameItemOpen={ctx.renameItemOpen}
        renameItemName={ctx.renameItemName}
        renameItemTarget={ctx.renameItemTarget}
        onRenameNameChange={ctx.setRenameItemName}
        onRenameConfirm={ctx.handleRenameItem}
        onRenameCancel={() => { ctx.setRenameItemOpen(false); ctx.setRenameItemName(''); ctx.setRenameItemTarget(null); }}
        scriptNamePromptOpen={ctx.scriptNamePromptOpen}
        scriptNameInput={ctx.scriptNameInput}
        scriptNamePlaceholder={ctx.scriptNameSuggestion}
        onScriptNameChange={ctx.setScriptNameInput}
        onScriptNameConfirm={ctx.handleConfirmNewScript}
        onScriptNameCancel={() => ctx.setScriptNamePromptOpen(false)}
        assetDetail={ctx.assetDetail}
        onAssetDetailClose={() => ctx.setAssetDetail(null)}
        onAssetDetailSave={handleAssetDetailSave}
        scriptEditorOpen={ctx.scriptEditorOpen}
        scriptEditorTitle={ctx.scriptEditorTitle}
        scriptEditorEpisodes={ctx.scriptEditorEpisodes}
        scriptEditorActiveId={ctx.scriptEditorActiveId}
        scriptAssetId={ctx.scriptEditorAssetId}
        embeddedInCanvas={props.embeddedInCanvas}
        onScriptEditorClose={ctx.handleCloseScriptEditor}
        onScriptEditorEpisodesChange={ctx.setScriptEditorEpisodes}
        onScriptEditorActiveChange={ctx.setScriptEditorActiveId}
        onScriptEditorEpisodesAndActiveChange={(eps, activeId) => {
          ctx.setScriptEditorEpisodes(eps);
          if (activeId !== undefined) ctx.setScriptEditorActiveId(activeId);
        }}
        onScriptEditorAddEpisode={() => {
          const nextNum = ctx.scriptEditorEpisodes.length + 1;
          // 2026-11-04：新增集标题统一 autoEpisodeTitle（禁止自拼字符串）
          const newEp = { id: `ep-${Date.now()}`, number: nextNum, title: autoEpisodeTitle(nextNum), content: '' };
          ctx.setScriptEditorEpisodes([...ctx.scriptEditorEpisodes, newEp]);
          ctx.setScriptEditorActiveId(newEp.id);
        }}
        onScriptEditorImportClick={() => ctx.setScriptImportOpen(true)}
        scriptImportOpen={ctx.scriptImportOpen}
        onScriptImportClose={() => ctx.setScriptImportOpen(false)}
        onScriptImportComplete={ctx.handleScriptImportComplete}
        ctxMenuPosition={ctxMenuPosition}
        ctxMenuItems={ctxMenuItems}
        onCtxMenuClose={closeCtxMenu}
        onUploadRetry={handleUploadRetry}
        theme={theme}
      />
    </div>
  );
}