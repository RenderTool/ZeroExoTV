/**
 * asset-library-grid-view - 资产库网格视图（瀑布流版，2026-11-05）
 *
 * 2026-11-05 用户定稿：等高方格 + object-fit:cover 会裁掉竖图 → 改 CSS 多列瀑布流
 * （shared/components/masonry-grid.tsx）。列数按容器实测宽度取断点，卡片高度按真实
 * 宽高比推导（夹取 0.75~1.9 倍列宽）。
 *
 * 虚拟化取舍：react-virtuoso 的 VirtuosoGrid 只能排等宽等高网格，变高卡片无法与之
 * 兼容，因此本视图移除虚拟化（全部条目一次性渲染，图片仍 lazy）。渲染耗时实测见
 * asset-card.test.tsx「瀑布流性能」用例（240 卡）；如需恢复虚拟化，必须自建按列高度
 * 前缀和的窗口计算器，代价显著高于当前收益。
 *
 * 保留机制：GridContext + CardItem（卡片通过 context 读数据），多选切换只推动 context，
 * 不整体重挂载网格。
 */

import { memo, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Skeleton, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import { getCardRenderer } from '../cards/card-registry.js';
import { gridContainerStyle } from '../asset-library-styles.js';
import type { PageItem, ContentType } from '../types.js';
import { MultiSelectCheckbox } from './multi-select-checkbox.js';
import { FocusScrollIntoView } from '@/features/canvas-assets/components/focus-scroll-into-view.js';
import { MasonryGrid } from '@/shared/components/masonry-grid.js';

// ===== Grid Context =====

interface GridContextValue {
  pageItems: PageItem[];
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  highlightId: string | null;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  /** 当前归属视图(资产项目化)：透传给卡片渲染器 */
  scopeView?: 'project' | 'library';
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  /** 发送到画布(征集 #87 验收轮十三:仅画布内嵌入时提供) */
  onSendToCanvas?: (item: PageItem) => void;
  /** 发送到导演台当前片段（2026-11-05 约定：仅画布内嵌时提供） */
  onSendToDirector?: (item: PageItem) => void;
}

const GridContext = createContext<GridContextValue>(null as any);
const useGridContext = (): GridContextValue => useContext(GridContext);

// ===== Card Item（通过 context 读取数据，独立于网格重渲染） =====

const CardItem = memo(function CardItem({ index }: { index: number }) {
  const ctx = useGridContext();
  const {
    pageItems: ctxPageItems,
    multiSelectEnabled: ctxMultiSelect,
    selectedIds: ctxSelectedIds,
    highlightId: ctxHighlightId,
    theme: ctxTheme,
    t: ctxT,
    scopeView: ctxScopeView,
    onToggleSelect: ctxOnToggleSelect,
    onOpenItem: ctxOnOpenItem,
    onRenameItem: ctxOnRenameItem,
    onDeleteItem: ctxOnDeleteItem,
    onDownloadItem: ctxOnDownloadItem,
    onContextMenu: ctxOnContextMenu,
    onSendToCanvas: ctxOnSendToCanvas,
    onSendToDirector: ctxOnSendToDirector,
  } = ctx;

  const item = ctxPageItems[index];
  if (!item) return null;
  const renderer = getCardRenderer(item.type as ContentType);
  if (!renderer) return null;

  const itemId = item.data.id ?? '';
  const isSelected = ctxSelectedIds.has(itemId);
  const GridComponent = renderer.renderGrid;

  return (
    <FocusScrollIntoView key={`${item.type}-${itemId}`} active={itemId === ctxHighlightId}>
      {ctxMultiSelect && (
        <MultiSelectCheckbox
          selected={isSelected}
          onToggle={() => ctxOnToggleSelect(itemId)}
          accentColor={ctxTheme.toolbar.accent}
        />
      )}
      <GridComponent
        item={item.data}
        selected={isSelected}
        multiSelectEnabled={ctxMultiSelect}
        onToggleSelect={(id) => ctxOnToggleSelect(id)}
        onOpen={() => ctxOnOpenItem(item)}
        onRename={() => ctxOnRenameItem(item)}
        onDelete={() => ctxOnDeleteItem(item)}
        onDownload={ctxOnDownloadItem ? () => ctxOnDownloadItem(item) : undefined}
        onContextMenu={(e) => ctxOnContextMenu(e, item)}
        onSendToCanvas={ctxOnSendToCanvas ? () => ctxOnSendToCanvas(item) : undefined}
        onSendToDirector={ctxOnSendToDirector ? () => ctxOnSendToDirector(item) : undefined}
        scopeView={ctxScopeView}
        theme={ctxTheme}
        t={ctxT}
      />
    </FocusScrollIntoView>
  );
});

// ===== 瀑布流内层（管理 GridContext） =====

interface MasonryListInnerProps {
  pageItems: PageItem[];
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  highlightId: string | null;
  isMobile: boolean;
  /** 固定列数(画布内嵌抽屉固定 2 格);缺省按 isMobile/自适应列 */
  gridColumns?: number;
  theme: ThemeConfig;
  t: ReturnType<typeof useTranslation>['t'];
  /** 当前归属视图(资产项目化)：透传给卡片渲染器 */
  scopeView?: 'project' | 'library';
  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  onSendToCanvas?: (item: PageItem) => void;
  onSendToDirector?: (item: PageItem) => void;
}

const MasonryListInner = memo(function MasonryListInner({
  pageItems,
  multiSelectEnabled,
  selectedIds,
  highlightId,
  isMobile,
  gridColumns,
  theme,
  t,
  scopeView,
  onToggleSelect,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onDownloadItem,
  onContextMenu,
  onSendToCanvas,
  onSendToDirector,
}: MasonryListInnerProps): React.ReactElement {
  // 构建 context value（每次渲染新对象，Provider 自动推动更新）
  const contextValue: GridContextValue = useMemo(() => ({
    pageItems,
    multiSelectEnabled,
    selectedIds,
    highlightId,
    theme,
    t,
    scopeView,
    onToggleSelect,
    onOpenItem,
    onRenameItem,
    onDeleteItem,
    onDownloadItem,
    onContextMenu,
    onSendToCanvas,
    onSendToDirector,
  }), [
    pageItems, multiSelectEnabled, selectedIds, highlightId, theme, t, scopeView,
    onToggleSelect, onOpenItem, onRenameItem, onDeleteItem, onDownloadItem,
    onContextMenu, onSendToCanvas, onSendToDirector,
  ]);

  return (
    <GridContext.Provider value={contextValue}>
      <MasonryGrid
        columns={gridColumns}
        paddingX={isMobile ? 12 : 20}
        paddingBottom={isMobile ? 12 : 20}
      >
        {pageItems.map((item, index) => (
          <CardItem key={`${item.type}-${item.data.id ?? index}`} index={index} />
        ))}
      </MasonryGrid>
    </GridContext.Provider>
  );
});

// ===== AssetLibraryGridView（对外接口不变） =====

interface AssetLibraryGridViewProps {
  pageItems: PageItem[];
  loading: boolean;
  multiSelectEnabled: boolean;
  selectedIds: Set<string>;
  /** 需要聚焦高亮的卡片 id（复制副本后跳转定位,配收纳动画 + 脉冲） */
  highlightId?: string | null;
  isMobile: boolean;
  /** 固定列数(画布内嵌抽屉固定 2 格);缺省按 isMobile/自适应列 */
  gridColumns?: number;
  theme: ThemeConfig;
  dragOver: boolean;
  dragCounterRef: React.MutableRefObject<number>;
  /** 当前归属视图(资产项目化)：透传卡片渲染器 + 决定空态文案；缺省空态回退原通用文案 */
  scopeView?: 'project' | 'library';
  /** 空态标题/说明（资产项目化：按胶囊段分别给「公共资产 / 本项目」文案；缺省回退原通用文案） */
  emptyTitle?: string;
  emptyHint?: string;

  onToggleSelect: (id: string) => void;
  onOpenItem: (item: PageItem) => void;
  onRenameItem: (item: PageItem) => void;
  onDeleteItem: (item: PageItem) => void;
  onDownloadItem?: (item: PageItem) => void;
  onContextMenu: (e: React.MouseEvent, item: PageItem) => void;
  onSendToCanvas?: (item: PageItem) => void;
  onSendToDirector?: (item: PageItem) => void;
  /** 空态「＋」点击触发上传（2026-11-04：与工具行上传按钮共用同一文件选择入口） */
  onUploadClick?: () => void;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onCtxMenu: (e: React.MouseEvent) => void;
}

export const AssetLibraryGridView = memo(function AssetLibraryGridView({
  pageItems,
  loading,
  multiSelectEnabled,
  selectedIds,
  highlightId,
  isMobile,
  gridColumns,
  theme,
  dragOver,
  scopeView,
  emptyTitle,
  emptyHint,
  onToggleSelect,
  onOpenItem,
  onRenameItem,
  onDeleteItem,
  onDownloadItem,
  onContextMenu,
  onSendToCanvas,
  onSendToDirector,
  onUploadClick,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onCtxMenu,
}: AssetLibraryGridViewProps): React.ReactElement {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 2026-11-04 偏好记忆改造：切换归属段时显式回顶，避免残留偏移落进空白区（不串数据）
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [scopeView]);

  return (
    <div
      ref={scrollRef}
      style={{ ...gridContainerStyle(isMobile), padding: 0 }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onCtxMenu}
    >
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24 }}>
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '40%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '30%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '50%' }} />
          <Skeleton active paragraph={{ rows: 2 }} title={{ width: '35%' }} />
        </div>
      ) : pageItems.length === 0 ? (
        /* 2026-11-04 约定：空态改版与主页空项目态同款（虚线圆角框＋加号＋标题＋说明），
           结构与样式复用 canvas-page.tsx 的 emptyStyle/emptyIconStyle，不再用 antd Empty 一句话文案 */
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          gap: 12,
          padding: '60px 20px',
        }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              border: '2px dashed rgba(128,128,128,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: onUploadClick ? 'pointer' : 'default',
              transition: 'all .2s',
            }}
            onClick={onUploadClick}
            title={t('assetLibrary.upload')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onUploadClick?.(); }}
          >
            <Plus size={32} style={{ opacity: 0.3 }} />
          </div>
          <Typography.Text strong style={{ fontSize: 15, marginBottom: 4 }}>
            {emptyTitle ?? t('assetLibrary.emptyAssetsTitle')}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
            {emptyHint ?? t('assetLibrary.emptyAssetsHint')}
          </Typography.Text>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <MasonryListInner
            pageItems={pageItems}
            multiSelectEnabled={multiSelectEnabled}
            selectedIds={selectedIds}
            highlightId={highlightId ?? null}
            isMobile={isMobile}
            gridColumns={gridColumns}
            theme={theme}
            t={t}
            scopeView={scopeView}
            onToggleSelect={onToggleSelect}
            onOpenItem={onOpenItem}
            onRenameItem={onRenameItem}
            onDeleteItem={onDeleteItem}
            onDownloadItem={onDownloadItem}
            onContextMenu={onContextMenu}
            onSendToCanvas={onSendToCanvas}
            onSendToDirector={onSendToDirector}
          />

          {/* 拖拽上传覆盖层 */}
          {dragOver && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: theme.mode === 'dark' ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)',
                border: `2px dashed ${theme.toolbar.accent}`,
                borderRadius: 12,
                margin: 8,
                pointerEvents: 'none',
              }}
            >
              <div style={{ textAlign: 'center', color: theme.toolbar.accent }}>
                {/* 验收轮二十一:图标精致化(22px 圆形底) + 文字小巧(13px/500),整体垂直居中 */}
                <div style={{
                  width: 44, height: 44, margin: '0 auto',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: theme.mode === 'dark' ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
                }}>
                  <Upload size={22} strokeWidth={2} />
                </div>
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500 }}>
                  {t('assetLibrary.dropToUpload') ?? '拖拽文件到此处上传'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
