/**
 * canvas-assets/groups/HistoryGroup - 画布资产抽屉「历史」分组（2026-11-04 本地版重建）
 *
 * 背景：旧「产出历史」分组是云端版功能（zeroexo-platform CanvasAssetsGroup，数据源
 * GET /api/ai/generations），本地版 CLOUD_ENABLED=false 整体不跑云端，不能恢复旧组件——
 * 本组件是本地重建版（2026-11-04 约定口径修正）：历史 = **API/生成链路产物**，
 * 唯一判据 data.origin='generation'（isGenerationAsset，由 history-autoland 在生成完成点写入，
 * 附 jobId/provider/model/prompt/durationSec/frames/createdAt 自证元数据）；
 * 用户手动上传/拖入/素材库添加的资产一律不进历史。按 createdAt 倒序。
 *
 * 结构：图片产出 / 视频生成 两个子分类（CategoryChips）+ 网格卡片 + 分页（>50）。
 * 卡片：缩略图懒加载（IntersectionObserver，进入视口才解析 blob URL）+
 *       相对时间（hover title 显示绝对时间）+ 尺寸/时长 + hover 操作（定位/加入资产库/下载）。
 * 视频卡片 hover 播放预览（沿用 asset-card 的悬停播放模式，不新造播放器）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from 'antd';
import { Download, Film, Image as ImageIcon, LibraryBig, LocateFixed } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import type { Asset } from '@/features/asset-picker/index.js';
import { MediaLightbox } from '@/shared/components/media-lightbox.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { CategoryChips, EmptyState, PaginationBar, SCROLL_AREA_STYLE, ToolbarRow } from '../components/common.js';
import {
  HISTORY_PAGE_SIZE,
  filterHistoryAssets,
  findAssetNodeId,
  fmtDuration,
  fmtRelativeTime,
  paginate,
  type HistoryKind,
} from '../history-utils.js';

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))',
  gap: 16,
  alignContent: 'start',
  padding: '0 20px 16px',
};

/** 进入视口才渲染子内容（缩略图解析延迟到可见时）；无 IO 环境（jsdom/老浏览器）直接可见 */
export function LazyVisible({ children }: { children: (visible: boolean) => ReactNode }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '100px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return <div ref={ref}>{children(visible)}</div>;
}

function ActionButton({ title, onClick, theme, children }: {
  title: string;
  onClick: () => void;
  theme: ThemeConfig;
  children: ReactNode;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)',
        color: isDark ? '#fff' : '#1f2937',
        transition: 'transform 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {children}
    </button>
  );
}

function HistoryCard({ asset, visible, libraryHashes, onLocate, onPromote, onDownload, theme, t }: {
  asset: Asset;
  visible: boolean;
  libraryHashes: Set<string>;
  onLocate: () => void;
  onPromote: () => void;
  onDownload: () => void;
  theme: ThemeConfig;
  t: (key: string, opts?: { defaultValue?: string }) => string;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  // 2026-11-05 用户定稿：历史产出也走统一 MediaLightbox 壳（图片/视频同一 UI）
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const data = asset.data as { kind: string; dataUrl?: string; url?: string; storageKey?: string; width?: number; height?: number; durationMs?: number };
  const isVideo = data.kind === 'video';
  const isDark = theme.mode === 'dark';
  // 缩略图三档契约（与 asset-card 同款）：未进入视口时不解析（懒加载）
  const hydrated = usePreviewImage(visible ? data.storageKey : undefined, visible ? (data.dataUrl || data.url || '') : '');
  const duration = fmtDuration(data.durationMs);
  const alreadyInLibrary = !!asset.cas?.hash && libraryHashes.has(asset.cas.hash);

  // 视频悬停播放/暂停（asset-card 同款模式）
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;
    if (hovered) {
      videoRef.current.play().catch(() => undefined);
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered]);

  const sizeText = data.width && data.height ? `${data.width}×${data.height}` : '';
  const absTime = new Date(asset.createdAt).toLocaleString();
  const metaText = [fmtRelativeTime(asset.createdAt), sizeText, duration].filter(Boolean).join(' · ');

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 封面区域（与素材卡片同宽高比/圆角） */}
      <div
        onClick={() => { if (data.storageKey) setLightboxOpen(true); }}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '239.2 / 135.4',
          borderRadius: 12,
          overflow: 'hidden',
          background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff',
          border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb',
          cursor: data.storageKey ? 'zoom-in' : 'default',
        }}
      >
        {visible && hydrated ? (
          isVideo ? (
            <video
              ref={videoRef}
              src={hydrated}
              muted
              loop
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <img
              src={hydrated}
              alt={asset.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.textMuted }}>
            {isVideo ? <Film size={22} /> : <ImageIcon size={22} />}
          </div>
        )}
        {/* 类型标签（左上角） */}
        <span
          style={{
            position: 'absolute', top: 6, left: 6, zIndex: 2,
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 6px', borderRadius: 6,
            fontSize: 10, lineHeight: '14px',
            background: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)',
            color: isDark ? '#fff' : '#374151',
          }}
        >
          {isVideo ? <Film size={10} /> : <ImageIcon size={10} />}
          {isVideo ? t('assetLibrary.filterVideo', { defaultValue: '视频' }) : t('assetLibrary.filterImage', { defaultValue: '图片' })}
        </span>
        {/* hover 操作（右下角）：定位 / 加入资产库 / 下载 */}
        <div
          style={{
            position: 'absolute', right: 6, bottom: 6, zIndex: 2,
            display: 'flex', gap: 6,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
        >
          <ActionButton title={t('assetLibrary.historyLocate', { defaultValue: '定位到画布节点' })} onClick={onLocate} theme={theme}>
            <LocateFixed size={14} />
          </ActionButton>
          {!alreadyInLibrary && (
            <ActionButton title={t('assetLibrary.historyAddToLibrary', { defaultValue: '加入资产库' })} onClick={onPromote} theme={theme}>
              <LibraryBig size={14} />
            </ActionButton>
          )}
          <ActionButton title={t('common.download', { defaultValue: '下载' })} onClick={onDownload} theme={theme}>
            <Download size={14} />
          </ActionButton>
        </div>
      </div>
      {/* 信息区：标题 + 相对时间（hover 绝对时间）· 尺寸 · 时长 */}
      <div style={{ minWidth: 0 }}>
        <div
          title={asset.title}
          style={{
            fontSize: 12, fontWeight: 500, color: theme.toolbar.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {asset.title}
        </div>
        <div title={absTime} style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 2 }}>
          {metaText}
        </div>
      </div>
      {lightboxOpen && (
        <MediaLightbox
          items={[{
            id: asset.id, title: asset.title, kind: isVideo ? 'video' : 'image',
            storageKey: data.storageKey, source: '历史产出',
          }]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

export function HistoryGroup({ store, theme, graphStore, onFocusNode }: {
  store: CanvasAssetsPanelStore;
  theme: ThemeConfig;
  /** 画布 graph store（定位节点用；缺省时定位按钮点击给出提示） */
  graphStore?: ReactGraphStore;
  onFocusNode?: (nodeId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { message: antdMessage } = App.useApp();
  const [historyKind, setHistoryKind] = useState<HistoryKind>('image');
  const [page, setPage] = useState(1);

  const projectId = store.historyProjectId;
  const items = useMemo(
    () => filterHistoryAssets(store.allAssets, projectId, historyKind),
    [store.allAssets, projectId, historyKind],
  );
  const { page: curPage, slice } = useMemo(() => paginate(items, page), [items, page]);

  const kindChips = [
    { key: 'image', label: t('assetLibrary.historyTabImage', { defaultValue: '图片产出' }), count: store.historyCounts.image },
    { key: 'video', label: t('assetLibrary.historyTabVideo', { defaultValue: '视频生成' }), count: store.historyCounts.video },
  ];

  const handleLocate = (asset: Asset): void => {
    const nodeId = findAssetNodeId(graphStore?.getGraph?.() as { nodes: Array<{ id: string; data?: unknown }> } | undefined, asset);
    if (nodeId && onFocusNode) {
      onFocusNode(nodeId);
    } else {
      antdMessage.info(t('assetLibrary.historyNodeGone', { defaultValue: '未找到对应画布节点（可能已删除）' }));
    }
  };

  const handlePromote = (asset: Asset): void => {
    void store.promoteToLibrary(asset);
  };

  const emptyText = historyKind === 'image'
    ? t('assetLibrary.historyEmptyImage', { defaultValue: '还没有图片生成记录，在画布上调用 API 生成图片后自动收录' })
    : t('assetLibrary.historyEmptyVideo', { defaultValue: '还没有视频生成记录，在画布上调用 API 生成视频后自动收录' });

  return (
    <>
      <ToolbarRow>
        <CategoryChips
          items={kindChips}
          active={historyKind}
          onChange={(k) => { setHistoryKind((k ?? 'image') as HistoryKind); setPage(1); }}
          theme={theme}
        />
      </ToolbarRow>

      <div style={SCROLL_AREA_STYLE}>
        {items.length === 0 ? (
          <EmptyState text={emptyText} theme={theme} />
        ) : (
          <div style={GRID_STYLE}>
            {slice.map((asset) => (
              <LazyVisible key={asset.id}>
                {(visible) => (
                  <HistoryCard
                    asset={asset}
                    visible={visible}
                    libraryHashes={store.libraryHashes}
                    onLocate={() => handleLocate(asset)}
                    onPromote={() => handlePromote(asset)}
                    onDownload={() => void store.handleDownloadItem({ type: 'asset', data: asset })}
                    theme={theme}
                    t={t}
                  />
                )}
              </LazyVisible>
            ))}
          </div>
        )}
      </div>

      <PaginationBar page={curPage} total={items.length} pageSize={HISTORY_PAGE_SIZE} onChange={setPage} />
    </>
  );
}
