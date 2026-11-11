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
 * 结构（2026-11-07 用户指令：来源 Tab）：
 *   第一层「从画布生成 / 从导演台」来源胶囊（与抽屉素材「全局/本项目」同款 CapsuleTabs）；
 *   第二层「图片 / 视频」两个子分类（CategoryChips）+ 网格卡片 + 分页（>50）。
 *   来源由 data.originSource 决定（存量记录按 provider/标题兜底，见 getHistorySource）。
 * 卡片：缩略图懒加载（IntersectionObserver，进入视口才解析 blob URL）+
 *       相对时间（hover title 显示绝对时间）+ 尺寸/时长 + hover 操作（定位/加入资产库/下载）。
 * 视频卡片 hover 播放预览（沿用 asset-card 的悬停播放模式，不新造播放器）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Dropdown, Tooltip } from 'antd';
import { CheckSquare, Clapperboard, Download, Film, Image as ImageIcon, ImagePlus, FolderInput, LibraryBig, LocateFixed, MoreHorizontal, Pencil, Share2, Square, Trash2, Waypoints } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { usePreviewImage, nodeActionBus } from '@zeroexo/plugin-nodes';
import type { Asset } from '@/features/asset-picker/index.js';
import { downloadAssetsAsZip } from '@/features/asset-picker/services/download-asset.js';
import { deleteAssetsWithUndo } from '@/features/asset-library/delete-with-undo.jsx';
import { assetMayHaveGuide } from '@/features/asset-picker/services/guide-resolve.js';
import { MediaLightbox } from '@/shared/components/media-lightbox.js';
import { MultiSelectCheckbox } from '@/features/asset-library/components/multi-select-checkbox.js';
import { CapsuleTabs } from '@/features/asset-library/components/capsule-tabs.js';
import type { CanvasAssetsPanelStore } from '../store.js';
import { sendAssetToWorkbench, sendGuideToWorkbench } from '../send-to-workbench.js';
import { MasonryGrid } from '@/shared/components/masonry-grid.js';
import { CategoryChips, EmptyState, PaginationBar, SCROLL_AREA_STYLE, ToolbarRow } from '../components/common.js';
import { ThumbBadge } from '@/shared/ui/index.js';
import {
  HISTORY_PAGE_SIZE,
  countHistoryBySourceAndKind,
  filterHistoryAssets,
  findAssetNodeId,
  fmtDuration,
  fmtRelativeTime,
  paginate,
  type HistoryKind,
  type HistorySource,
} from '../history-utils.js';

/** 来源 Tab 选择按项目记住（与素材分组 materialScopeTab 同款体验） */
const HISTORY_SOURCE_PREF_KEY = 'zeroexo.history.sourceTab';

function readInitialHistorySource(): HistorySource {
  try {
    return localStorage.getItem(HISTORY_SOURCE_PREF_KEY) === 'director' ? 'director' : 'canvas';
  } catch {
    return 'canvas';
  }
}

/** 历史卡与素材/主体/资产页共用同一套瀑布流列宽断点（不再单独 150px 网格） */

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

function ActionButton({ title, onClick, theme, disabled = false, children }: {
  title: string;
  onClick: () => void;
  theme: ThemeConfig;
  disabled?: boolean;
  children: ReactNode;
}): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
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

function HistoryCard({ asset, visible, selected, selectMode, onToggleSelect, onLocate, onPromote, onDownload, onSendVideo, onSendGuide, onSendCanvas, onRename, onDelete, onEdit, theme, t }: {
  asset: Asset;
  visible: boolean;
  /** 多选模式：是否选中 */
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelect?: () => void;
  /** 仅「从画布生成」的产物有对应画布节点；导演台产物不传（不显示定位按钮） */
  onLocate?: () => void;
  onPromote: (target: 'project' | 'library') => void;
  onDownload: (opts?: { withGuide?: boolean }) => void;
  /** 发送源视频到导演台当前片段 */
  onSendVideo?: () => void;
  /** 发送引导到导演台当前片段（仅视频自带 guide 时可用） */
  onSendGuide?: () => void;
  /** 发送到当前画布 */
  onSendCanvas?: () => void;
  /** 重命名（更多菜单） */
  onRename?: () => void;
  /** 删除（更多菜单） */
  onDelete?: () => void;
  /** 图片历史产出「编辑」：开画布图片编辑页签（视频不支持） */
  onEdit?: () => void;
  theme: ThemeConfig;
  t: (key: string, opts?: { defaultValue?: string }) => string;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  // 2026-11-05 用户定稿：历史产出也走统一 MediaLightbox 壳（图片/视频同一 UI）
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const data = asset.data as { kind: string; dataUrl?: string; url?: string; storageKey?: string; width?: number; height?: number; durationMs?: number; guide?: { id?: string } };
  const isVideo = data.kind === 'video';
  // 2026-11-11 用户反馈：历史卡片固定 16:9 + cover 会把竖图裁掉（看不到完整资源）。
  // 按素材真实宽高比铺卡片（瀑布流由 MasonryGrid 负责），极端长图限幅避免单卡过高。
  const mediaRatio = typeof data.width === 'number' && typeof data.height === 'number' && data.width > 0 && data.height > 0
    ? data.width / data.height
    : 239.2 / 135.4;
  const coverRatio = Math.min(2.4, Math.max(0.5, mediaRatio));
  const hasGuide = isVideo && assetMayHaveGuide(asset);
  const isDark = theme.mode === 'dark';
  // 缩略图三档契约（与 asset-card 同款）：未进入视口时不解析（懒加载）
  const hydrated = usePreviewImage(visible ? data.storageKey : undefined, visible ? (data.dataUrl || data.url || '') : '');
  const duration = fmtDuration(data.durationMs);

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
      data-history-card={asset.id}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, width: '100%',
        outline: selected ? `2px solid ${theme.toolbar.accent}` : 'none',
        outlineOffset: 2,
        borderRadius: 12,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (selectMode) onToggleSelect?.(); }}
    >
      {/* 封面区域（与素材卡片同宽高比/圆角） */}
      <div
        onClick={(e) => {
          if (selectMode) { e.stopPropagation(); onToggleSelect?.(); return; }
          if (data.storageKey) setLightboxOpen(true);
        }}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: coverRatio,
          borderRadius: 12,
          overflow: 'hidden',
          background: isDark ? 'rgba(255,255,255,0.02)' : '#ffffff',
          border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid #e5e7eb',
          cursor: selectMode ? 'pointer' : data.storageKey ? 'zoom-in' : 'default',
        }}
      >
        {selectMode && (
          <MultiSelectCheckbox
            selected={!!selected}
            onToggle={() => onToggleSelect?.()}
            accentColor={theme.toolbar.accent}
          />
        )}
        {visible && hydrated ? (
          isVideo ? (
            <video
              ref={videoRef}
              src={hydrated}
              muted
              loop
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <img
              src={hydrated}
              alt={asset.title}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.toolbar.textMuted }}>
            {isVideo ? <Film size={22} /> : <ImageIcon size={22} />}
          </div>
        )}
        {/* 类型标签（左上角）：与开源库/主体卡统一用 ThumbBadge（深色底白字） */}
        <ThumbBadge style={{ position: 'absolute', top: 6, left: selectMode ? 34 : 6, zIndex: 2 }}>
          {isVideo ? <Film size={10} /> : <ImageIcon size={10} />}
          {isVideo ? t('assetLibrary.filterVideo', { defaultValue: '视频' }) : t('assetLibrary.filterImage', { defaultValue: '图片' })}
        </ThumbBadge>
        {hasGuide && (
          /* 2026-11-11 用户要求：这里只是「含引导」标签，不要做成下载入口（下载在 hover 菜单里） */
          <span
            data-guide-badge={asset.id}
            style={{ position: 'absolute', top: 6, right: 6, zIndex: 3 }}
          >
            <ThumbBadge>
              <Waypoints size={10} />
              {t('assetLibrary.hasGuide', { defaultValue: '含引导' })}
            </ThumbBadge>
          </span>
        )}
        {/* hover 操作（右下角）：定位 / 加入资产库 / 下载。
            2026-11-10：整条操作区吞掉 click —— 否则点空白处会冒泡到封面「打开大图」，
            表现为「发送到导演台后顺手打开一次视频」。 */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 6, bottom: 6, zIndex: 2,
            display: 'flex', gap: 6,
            opacity: hovered && !selectMode ? 1 : 0,
            pointerEvents: selectMode ? 'none' : 'auto',
            transition: 'opacity 0.2s',
          }}
        >
          {onLocate && (
            <ActionButton title={t('assetLibrary.historyLocate', { defaultValue: '定位到画布节点' })} onClick={onLocate} theme={theme}>
              <LocateFixed size={14} />
            </ActionButton>
          )}
          {/* 发送统一收纳：发送到画布 / 导演台（源视频、引导）/ 本项目 / 公共资产 */}
          <Dropdown
            open={sendMenuOpen}
            onOpenChange={setSendMenuOpen}
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'canvas',
                  icon: <ImagePlus size={13} />,
                  label: t('assetLibrary.sendToCanvas', { defaultValue: '发送到画布' }),
                  disabled: !onSendCanvas,
                  onClick: () => onSendCanvas?.(),
                },
                {
                  key: 'director',
                  icon: <Clapperboard size={13} />,
                  label: t('assetLibrary.sendToDirector', { defaultValue: '发送到导演台' }),
                  disabled: !onSendVideo,
                  onClick: () => onSendVideo?.(),
                },
                ...(onSendGuide ? [{
                  key: 'guide',
                  icon: <Waypoints size={13} />,
                  label: t('assetLibrary.sendGuideToDirector', { defaultValue: '发送引导' }),
                  disabled: !hasGuide,
                  onClick: () => onSendGuide?.(),
                }] : []),
                { type: 'divider' as const },
                {
                  key: 'project',
                  icon: <FolderInput size={13} />,
                  label: t('assetLibrary.addToProject', { defaultValue: '发送到本项目' }),
                  onClick: () => onPromote('project'),
                },
                {
                  key: 'library',
                  icon: <LibraryBig size={13} />,
                  label: t('assetLibrary.addToPublicLibrary', { defaultValue: '发送到公共资产' }),
                  onClick: () => onPromote('library'),
                },
              ],
            }}
          >
            <span>
              <ActionButton
                title={t('assetLibrary.sendTo', { defaultValue: '发送' })}
                onClick={() => setSendMenuOpen(true)}
                theme={theme}
              >
                <Share2 size={14} />
              </ActionButton>
            </span>
          </Dropdown>
          {/* 更多最右：下载 / 编辑 / 重命名 / 删除，与资产卡同一套 */}
          <Dropdown
            open={moreMenuOpen}
            onOpenChange={setMoreMenuOpen}
            trigger={['click']}
            menu={{
              items: [
                ...(hasGuide
                  ? [
                      { key: 'download', icon: <Download size={13} />, label: t('assetLibrary.downloadVideoOnly', { defaultValue: '下载视频' }), onClick: () => onDownload() },
                      { key: 'download-guide', icon: <Download size={13} />, label: t('assetLibrary.downloadVideoWithGuide', { defaultValue: '下载视频+引导' }), onClick: () => onDownload({ withGuide: true }) },
                    ]
                  : [
                      { key: 'download', icon: <Download size={13} />, label: t('common.download', { defaultValue: '下载' }), onClick: () => onDownload() },
                    ]),
                ...(onEdit ? [{ key: 'edit', icon: <Pencil size={13} />, label: t('assetLibrary.editImage', { defaultValue: '编辑' }), onClick: onEdit }] : []),
                { type: 'divider' as const },
                ...(onRename ? [{ key: 'rename', icon: <Pencil size={13} />, label: t('assetLibrary.rename', { defaultValue: '重命名' }), onClick: onRename }] : []),
                ...(onDelete ? [{ key: 'delete', danger: true, icon: <Trash2 size={13} />, label: t('common.delete', { defaultValue: '删除' }), onClick: onDelete }] : []),
              ],
            }}
          >
            <span>
              <ActionButton
                title={t('common.more', { defaultValue: '更多' })}
                onClick={() => setMoreMenuOpen(true)}
                theme={theme}
              >
                <MoreHorizontal size={14} />
              </ActionButton>
            </span>
          </Dropdown>
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
  const { message: antdMessage, modal: antdModal } = App.useApp();
  /** 第一层：来源 Tab（从画布生成 / 从导演台） */
  const [historySource, setHistorySourceState] = useState<HistorySource>(readInitialHistorySource);
  /** 第二层：类型 chips（图片 / 视频） */
  const [historyKind, setHistoryKind] = useState<HistoryKind>('image');
  const [page, setPage] = useState(1);
  /** 历史多选（2026-11-07 用户指令：导出只能作用于选中的项目，且目标由用户选择） */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setHistorySource = (source: HistorySource): void => {
    setHistorySourceState(source);
    try { localStorage.setItem(HISTORY_SOURCE_PREF_KEY, source); } catch { /* 隐私模式等：仅本次会话生效 */ }
    setPage(1);
    setSelectedIds(new Set());
  };

  const projectId = store.historyProjectId;
  /** 徽标计数：每个来源的总数 + 该来源下两类型条数（一次遍历，不依赖 store 派生） */
  const sourceCounts = useMemo(
    () => countHistoryBySourceAndKind(store.allAssets, projectId),
    [store.allAssets, projectId],
  );
  // 2026-11-08：导演台只产出视频，不需要类型分类 → 直接给「全部」；画布保留「全部/图片/视频」
  const effectiveKind: HistoryKind = historySource === 'director' ? 'all' : historyKind;
  const items = useMemo(
    () => filterHistoryAssets(store.allAssets, projectId, effectiveKind, historySource),
    [store.allAssets, projectId, effectiveKind, historySource],
  );
  const { page: curPage, slice } = useMemo(() => paginate(items, page), [items, page]);
  const selectedAssets = useMemo(() => items.filter((a) => selectedIds.has(a.id)), [items, selectedIds]);
  const allSelected = items.length > 0 && selectedAssets.length === items.length;

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelect = (): void => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelectAll = (): void => {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((a) => a.id)));
  };

  const batchDelete = (): void => {
    if (selectedAssets.length === 0) return;
    antdModal.confirm({
      title: t('assetLibrary.batchDeleteTitle', '删除选中的历史产出？'),
      content: t('assetLibrary.batchDeleteBody', '删除后可在提示条中撤销；素材文件不会立即从磁盘移除。'),
      okText: t('common.delete', '删除'),
      okType: 'danger',
      cancelText: t('common.cancel', '取消'),
      centered: true,
      onOk: async () => {
        await deleteAssetsWithUndo({
          assets: selectedAssets,
          projectId,
          message: antdMessage,
          t,
          onRestored: () => { void store.refreshAssets(); },
        });
        await store.refreshAssets();
        exitSelect();
      },
    });
  };

  const kindChips = [
    { key: 'all', label: t('assetLibrary.historyTabAll', { defaultValue: '全部' }), count: sourceCounts[historySource].total },
    { key: 'image', label: t('assetLibrary.historyTabImage', { defaultValue: '图片' }), count: sourceCounts[historySource].image },
    { key: 'video', label: t('assetLibrary.historyTabVideo', { defaultValue: '视频' }), count: sourceCounts[historySource].video },
  ];

  const handleLocate = (asset: Asset): void => {
    const nodeId = findAssetNodeId(graphStore?.getGraph?.() as { nodes: Array<{ id: string; data?: unknown }> } | undefined, asset);
    if (nodeId && onFocusNode) {
      onFocusNode(nodeId);
    } else {
      antdMessage.info(t('assetLibrary.historyNodeGone', { defaultValue: '未找到对应画布节点（可能已删除）' }));
    }
  };

  const handlePromote = (asset: Asset, target: 'project' | 'library'): void => {
    void store.promoteToScope(asset, target);
  };

  // 空态按「来源 × 类型」给准确指引；导演台只有视频，走「全部」口径
  const emptyText = effectiveKind === 'all'
    ? historySource === 'director'
      ? t('assetLibrary.historyEmptyDirectorVideo', { defaultValue: '还没有导演台生成的视频，在导演台运行片段后自动收录' })
      : t('assetLibrary.historyEmptyAll', { defaultValue: '还没有生成记录，在画布上调用 API 生成图片或视频后自动收录' })
    : effectiveKind === 'image'
      ? t('assetLibrary.historyEmptyImage', { defaultValue: '还没有图片生成记录，在画布上调用 API 生成图片后自动收录' })
      : t('assetLibrary.historyEmptyVideo', { defaultValue: '还没有视频生成记录，在画布上调用 API 生成视频后自动收录' });

  return (
    <>
      {/* 第一层：来源 Tab —— 与抽屉素材「全局 / 本项目」同款胶囊（含数量徽标） */}
      <div style={{ padding: '8px 20px 0', flexShrink: 0 }} data-history-source-bar>
        <CapsuleTabs
          value={historySource}
          onChange={(key) => setHistorySource(key as HistorySource)}
          segments={[
            { key: 'canvas', label: t('assetLibrary.historySourceCanvas', { defaultValue: '从画布生成' }), count: sourceCounts.canvas.total },
            { key: 'director', label: t('assetLibrary.historySourceDirector', { defaultValue: '从导演台' }), count: sourceCounts.director.total },
          ]}
          theme={theme}
          testId="history-source-tabs"
        />
      </div>

      <ToolbarRow style={{ paddingTop: 6 }}>
        {/* 导演台只产出视频，不给图片/视频分类（2026-11-08 用户指令） */}
        {historySource === 'canvas' && (
          <CategoryChips
            items={kindChips}
            active={historyKind}
            onChange={(k) => {
              setHistoryKind((k ?? 'all') as HistoryKind);
              setPage(1);
              setSelectedIds(new Set());
            }}
            theme={theme}
          />
        )}
        <span style={{ flex: 1 }} />
        <Tooltip title={selectMode ? t('common.multiSelectExit', '退出多选') : t('common.multiSelect', '多选')}>
          <Button
            size="small"
            data-history-multiselect
            aria-pressed={selectMode}
            icon={selectMode ? <CheckSquare size={14} /> : <Square size={14} />}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
      </ToolbarRow>

      {/* 多选批量条：只导出选中的项；目标由用户选择（本项目 / 公共库） */}
      {selectMode && (
        <ToolbarRow style={{ paddingTop: 0 }} dataAttr={{ 'data-history-batch-bar': '' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0 }}>
            {t('common.batchSelected', { n: selectedAssets.length, defaultValue: `已选 ${selectedAssets.length} 项` })}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Button size="small" data-history-select-all disabled={items.length === 0} onClick={toggleSelectAll}>
              {allSelected ? t('common.batchSelectNone', '取消全选') : t('common.batchSelectAll', '全选')}
            </Button>
            <Button
              size="small"
              data-history-batch-download
              disabled={selectedAssets.length === 0}
              onClick={() => {
                void downloadAssetsAsZip(selectedAssets, `history-${Date.now()}`).then((n) => {
                  if (n > 0) antdMessage.success(t('assetLibrary.batchDownloaded', { n, defaultValue: `已打包下载 ${n} 项` }));
                  else antdMessage.warning(t('assetLibrary.batchDownloadEmpty', '没有可下载的文件'));
                });
              }}
            >
              {t('assetLibrary.batchDownload', '打包下载')}
            </Button>
            <Dropdown
              trigger={['click']}
              disabled={selectedAssets.length === 0}
              menu={{
                items: [
                  { key: 'project', label: t('assetLibrary.addToProject', { defaultValue: '加入本项目' }) },
                  { key: 'library', label: t('assetLibrary.addToPublicLibrary', { defaultValue: '加入公共资产' }) },
                ],
                onClick: ({ key }) => {
                  void store.promoteAssetsTo(selectedAssets, key === 'project' ? 'project' : 'library');
                  exitSelect();
                },
              }}
            >
              <Button size="small" data-history-batch-export disabled={selectedAssets.length === 0}>
                {t('assetLibrary.addToScope', { defaultValue: '加入资产库' })}
              </Button>
            </Dropdown>
            <Button
              size="small"
              danger
              data-history-batch-delete
              disabled={selectedAssets.length === 0}
              onClick={batchDelete}
            >
              {t('common.delete', '删除')}
            </Button>
            <Button size="small" onClick={exitSelect}>{t('common.batchCancel', '取消')}</Button>
          </span>
        </ToolbarRow>
      )}

      <div style={SCROLL_AREA_STYLE}>
        {items.length === 0 ? (
          <EmptyState text={emptyText} theme={theme} />
        ) : (
          <MasonryGrid paddingX={20} paddingBottom={16}>
            {slice.map((asset) => (
              <LazyVisible key={asset.id}>
                {(visible) => (
                  <HistoryCard
                    asset={asset}
                    visible={visible}
                    selected={selectedIds.has(asset.id)}
                    selectMode={selectMode}
                    onToggleSelect={() => toggleSelect(asset.id)}
                    onLocate={historySource === 'canvas' ? () => handleLocate(asset) : undefined}
                    onPromote={(target) => handlePromote(asset, target)}
                    onDownload={(opts) => void store.handleDownloadItem({ type: 'asset', data: asset }, opts)}
                    onSendVideo={(() => {
                      // 2026-11-11 用户反馈：画布生成的图片也应该能发到导演台（图片槽），
                      // 之前只给 video 开放，菜单项对图片是灰的。图片/音频/视频都走同一执行器。
                      const kind = (asset.data as { kind?: string }).kind;
                      const sendable = kind === 'image' || kind === 'video' || kind === 'audio';
                      return sendable ? () => sendAssetToWorkbench(asset, antdMessage, t) : undefined;
                    })()}
                    onSendGuide={(asset.data as { kind?: string }).kind === 'video'
                      ? () => { void sendGuideToWorkbench(asset, antdMessage, t); }
                      : undefined}
                    onSendCanvas={() => store.sendToCanvas({ type: 'asset', id: asset.id, data: asset })}
                    onRename={() => {
                      store.setRenameItemTarget({ type: 'asset', id: asset.id, name: asset.title });
                      store.setRenameItemName(asset.title);
                      store.setRenameItemOpen(true);
                    }}
                    onDelete={() => void store.handleDeleteAsset(asset)}
                    onEdit={(asset.data as { kind?: string }).kind === 'image'
                      ? () => {
                        // 历史图片「编辑」：与素材抽屉同一入口（宿主建节点 + 开图片编辑页签）
                        const d = asset.data as { storageKey?: string; dataUrl?: string; url?: string; width?: number; height?: number };
                        nodeActionBus.emit('imageEditAsset', {
                          nodeId: '',
                          assetId: asset.id,
                          title: asset.title,
                          storageKey: d.storageKey,
                          content: d.dataUrl || d.url,
                          naturalWidth: d.width,
                          naturalHeight: d.height,
                        });
                      }
                      : undefined}
                    theme={theme}
                    t={t}
                  />
                )}
              </LazyVisible>
            ))}
          </MasonryGrid>
        )}
      </div>

      <PaginationBar page={curPage} total={items.length} pageSize={HISTORY_PAGE_SIZE} onChange={setPage} />
    </>
  );
}
