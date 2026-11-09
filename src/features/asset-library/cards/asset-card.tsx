/**
 * asset-card - 素材卡片组件
 *
 * 从 asset-library-page.tsx 内联 AssetCard 抽出。
 * 处理图片/视频/音频/文本四种素材类型。
 * 末尾调用 registerCard 注册到卡片注册表。
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Music as MusicIcon,
  FileText,
  BookOpen,
  Play,
  Download,
  Pencil,
  Trash2,
  MoreHorizontal,
  Waypoints,
} from 'lucide-react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import type { TFunction } from 'i18next';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';
import { SendActionButtons, cardActionBtnStyle } from './card-send-actions.js';
import { AssetScopeBadge } from '@/features/asset-picker/components/scope-badge.js';
import { assetMayHaveGuide } from '@/features/asset-picker/services/guide-resolve.js';
import { cardCoverMetrics, CARD_COVER_TRANSITION, useMasonryColumnWidth } from '@/shared/components/masonry-grid.js';
import {
  UI_CARD_GAP,
  UI_CARD_HOVER_OVERLAY,
  UI_CARD_INFO_PADDING_X,
  uiCardMetaStyle,
  uiCardNameStyle,
  CardShell,
  ThumbBadge,
} from '@/shared/ui/index.js';

// ===== 辅助 =====

function getKindIcon(kind: string, theme: ThemeConfig): React.ReactElement {
  const color = theme.toolbar.textMuted;
  // 2026-08-31 用户拍板：资产卡片图标统一 18px（与 sidebar/播放按钮一致）
  switch (kind) {
    case 'image': return <ImageIcon size={18} color={color} />;
    case 'video': return <VideoIcon size={18} color={color} />;
    case 'audio': return <MusicIcon size={18} color={color} />;
    case 'text': return <FileText size={18} color={color} />;
    case 'script': return <BookOpen size={18} color={color} />;
    default: return <FileText size={18} color={color} />;
  }
}

function getKindLabel(kind: string, t: TFunction): string {
  const key = `asset.kind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return t(key);
}

// ===== 网格渲染 =====

function AssetCardGrid({
  item: asset,
  multiSelectEnabled,
  onToggleSelect,
  onOpen,
  onRename,
  onDelete,
  onDownload,
  onContextMenu,
  onSendToCanvas,
  onSendToDirector,
  onEditImage,
  showQuickActions,
  scopeView,
  theme,
  t,
}: GridCardRendererProps<any>): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const data = asset.data;
  const isImage = data.kind === 'image';
  const isVideo = data.kind === 'video';
  // 显示源只认 storageKey（2026-11-05 图片全空白根治）：历史 dataUrl / url 常是
  // 刷新即失效的 blob: 死地址，绝不作为封面兜底；解析不到就显示可读的「未落盘」提示。
  const cover = '';
  // 封面走三档图片契约(征集 #77):展示层自适应预览档,永不直连原图;
  // 视频无尺寸变体概念,usePreviewImage 内部自动回退 hydrate 行为(悬停播放不受影响)
  const hydrated = usePreviewImage(
    isImage || isVideo ? data.storageKey : undefined,
    cover,
  );
  const [coverError, setCoverError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoCreated] = useState(isVideo);

  // 瀑布流封面高度：高度 = 列宽 / 宽高比（宽高比 = 图宽/图高），夹在 [0.75, 1.9]×列宽。
  // 真实比例优先取资产元数据（data.width/height）；缺失时先按 1:1 占位，图片 onLoad /
  // 视频 loadedmetadata 解析到尺寸后再平滑过渡一次（不会跳变两次）。
  const columnWidth = useMasonryColumnWidth();
  const metaAspect = useMemo(() => {
    const w = Number((data as { width?: number }).width);
    const h = Number((data as { height?: number }).height);
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null;
  }, [data]);
  const [aspect, setAspect] = useState<number | null>(metaAspect);
  useEffect(() => {
    // 换资产（storageKey 变）或元数据到达：重置为已知比例，未知则回 1:1 占位
    setAspect(metaAspect);
  }, [metaAspect, data?.storageKey]);
  const coverMetrics = cardCoverMetrics(columnWidth, aspect);
  /** 解析到真实尺寸（仅未知比例时生效，保证只过渡一次） */
  const learnAspect = (w: number, h: number) => {
    if (!w || !h) return;
    setAspect((prev) => (prev == null ? w / h : prev));
  };

  // 视频悬停播放/暂停
  useEffect(() => {
    if (!isVideo || !videoRef.current) return;
    if (hovered) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [hovered, isVideo]);

  const kindIcon = getKindIcon(asset.kind, theme);
  const showCover = (isImage || isVideo) && hydrated && !coverError;
  /** 生成产物自带的引导数据（2026-11-07）：提供「视频+引导」导出与发送引导入口 */
  const hasGuide = isVideo && assetMayHaveGuide(asset);
  // 2026-11-05 用户拍板：主体卡与资产卡共用同一套视觉 token（shared/ui）

  // 资产项目化：归属标识（公共/本项目）。2026-11-05 用户拍板：公共资产在本项目内
  // 就地可编辑、可删除（与公共库操作等价），该标识仅作中性提示，不带任何操作限制。
  const assetScope: 'project' | 'library' = asset.scope === 'project' ? 'project' : 'library';
  const fromLibrary = scopeView === 'project' && assetScope === 'library';

  // 更多下拉菜单：下载 / 重命名 / 删除（画布项目卡片同款）
  // 2026-11-05 用户拍板：公共库资产不再隐藏重命名/删除——就地编辑、就地删除，不踢回公共库
  const moreMenuItems = useMemo<MenuProps['items']>(() => {
    const items: MenuProps['items'] = [];
    if (onDownload) {
      if (hasGuide) {
        // 生成了引导的数据：下载时必须能选「只视频 / 视频+引导」（2026-11-07 需求 1）
        items.push({
          key: 'download',
          icon: <Download size={14} />,
          label: t('assetLibrary.downloadVideoOnly', '下载视频'),
          onClick: (e) => { e.domEvent.stopPropagation(); onDownload(); },
        });
        items.push({
          key: 'download-guide',
          icon: <Waypoints size={14} />,
          label: t('assetLibrary.downloadVideoWithGuide', '下载视频+引导'),
          onClick: (e) => { e.domEvent.stopPropagation(); onDownload({ withGuide: true }); },
        });
      } else {
        items.push({
          key: 'download',
          icon: <Download size={14} />,
          label: t('common.download'),
          onClick: (e) => { e.domEvent.stopPropagation(); onDownload(); },
        });
      }
    }
    items.push({
      key: 'rename',
      icon: <Pencil size={14} />,
      label: t('assetLibrary.rename'),
      onClick: (e) => { e.domEvent.stopPropagation(); onRename(); },
    });
    items.push({
      key: 'delete',
      icon: <Trash2 size={14} />,
      label: t('assetLibrary.delete'),
      danger: true,
      onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); },
    });
    return items;
  }, [hasGuide, onDownload, onSendToDirector, onRename, onDelete, t]);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: UI_CARD_GAP,
        width: '100%',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={multiSelectEnabled ? () => onToggleSelect(asset.id) : onOpen}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => {
        // 验收轮二十一:payload 携带完整数据 → 画布 drop 直接建节点;封面 img/video 已禁拖(防浏览器附带文件)
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'asset',
          id: asset.id,
          name: asset.title,
          data: asset,
        }));
      }}
    >
      {/* 封面区域（瀑布流：#高度按真实比例 + 夹取，不再固定 239.2/135.4） */}
      <CardShell
        theme={theme}
        data-card-cover
        data-card-cover-fit={coverMetrics.fit}
        style={{
          width: '100%',
          height: coverMetrics.height,
          transition: CARD_COVER_TRANSITION,
        }}
      >
        {/* 资产项目化：归属角标（本项目灰 / 公共蓝）；多选时右移避开左上角复选框 */}
        <AssetScopeBadge
          scope={assetScope}
          style={{ position: 'absolute', top: 6, left: multiSelectEnabled ? 34 : 6, zIndex: 4 }}
        />
        {hasGuide && (
          <button
            type="button"
            data-guide-download={asset.id}
            title={t('assetLibrary.downloadVideoWithGuide', '下载视频+引导')}
            aria-label={t('assetLibrary.downloadVideoWithGuide', '下载视频+引导')}
            onClick={(e) => { e.stopPropagation(); onDownload?.({ withGuide: true }); }}
            style={{ position: 'absolute', bottom: 6, left: 6, zIndex: 4, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <ThumbBadge>
              <Waypoints size={10} />
              {t('assetLibrary.hasGuide', '含引导')}
              <Download size={10} />
            </ThumbBadge>
          </button>
        )}
        {isVideo && videoCreated ? (
          <video
            ref={videoRef}
            src={hydrated}
            style={{ width: '100%', height: '100%', objectFit: coverMetrics.fit }}
            draggable={false}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              learnAspect(v.videoWidth, v.videoHeight);
            }}
          />
        ) : showCover && isImage ? (
          <img
            src={hydrated}
            alt={asset.title}
            loading="lazy"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: coverMetrics.fit, display: 'block' }}
            onError={() => setCoverError(true)}
            onLoad={(e) => {
              const el = e.currentTarget;
              learnAspect(el.naturalWidth, el.naturalHeight);
            }}
          />
        ) : (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {kindIcon}
            {/* 2026-11-05：显示源只认 storageKey。有键但文件缺失、或根本没有键，
                一律给可读原因，绝不留下空白卡 / 浏览器裂图让人猜 */}
            {(isImage || isVideo) && !showCover && (
              <span style={{
                position: 'absolute', bottom: 6, left: 6, right: 6,
                fontSize: 10, lineHeight: '13px', textAlign: 'center',
                color: theme.toolbar.textMuted,
              }}>
                {isImage
                  ? t('assetLibrary.cardMissingImage', '该图片未落盘或文件缺失，请重新导入')
                  : t('assetLibrary.cardMissingVideo', '该视频未落盘或文件缺失，请重新导入')}
              </span>
            )}
          </div>
        )}
        {/* 视频播放图标 */}
        {isVideo && !hovered && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.15)',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Play size={18} color="#fff" fill="#fff" />
            </div>
          </div>
        )}
        {/* Hover 遮罩 */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: UI_CARD_HOVER_OVERLAY,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
        }} />
        {/* 操作按钮统一落位：封面右下角（与历史卡同位置，黑色 28×28 图标） */}
        <div
          data-asset-card-actions
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', right: 6, bottom: 6, zIndex: 5,
            display: 'flex', alignItems: 'center', gap: 4,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        >
          {showQuickActions && onEditImage && asset.kind === 'image' && (
            <button
              type="button"
              data-card-action="editImage"
              aria-label={t('assetLibrary.editImage', '编辑')}
              title={t('assetLibrary.editImage', '编辑')}
              onClick={(e) => { e.stopPropagation(); onEditImage(); }}
              style={cardActionBtnStyle}
            >
              <Pencil size={14} />
            </button>
          )}
          {showQuickActions && (
            <SendActionButtons
              onSendToCanvas={onSendToCanvas}
              onSendToDirector={onSendToDirector ? () => onSendToDirector('video') : undefined}
              hasGuide={hasGuide}
              onSendGuideToDirector={hasGuide && onSendToDirector ? () => onSendToDirector('guide') : undefined}
              kind={asset.kind}
              visible={hovered}
              alwaysVisible
              t={t}
            />
          )}
          <Dropdown menu={{ items: moreMenuItems }} trigger={['click']} placement="bottomRight">
            <button
              type="button"
              data-card-more
              aria-label={t('assetLibrary.moreActions', '更多')}
              title={t('assetLibrary.moreActions', '更多')}
              onClick={(e) => e.stopPropagation()}
              style={cardActionBtnStyle}
            >
              <MoreHorizontal size={14} />
            </button>
          </Dropdown>
        </div>

      </CardShell>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        paddingLeft: UI_CARD_INFO_PADDING_X,
        paddingRight: UI_CARD_INFO_PADDING_X,
      }}>
        {/* 标题行只保留标题；操作按钮统一在封面右下角（历史卡同位） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: showQuickActions ? 32 : 24 }}>
          <span style={{ ...uiCardNameStyle(theme), flex: 1, minWidth: 0 }}>
            {asset.title}
          </span>
        </div>
        {/* 资产项目化：全局资产库资产中性小标签「全局」——仅标识来源，不带操作限制（scopeView 缺省时不显示） */}
        {fromLibrary && (
          <div style={{ fontSize: 10, color: theme.toolbar.textMuted, lineHeight: '16px' }}>
            {t('assetLibrary.scopeTagLibrary', '全局')}
          </div>
        )}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}>
          <span style={uiCardMetaStyle(theme)}>
            {getKindLabel(asset.kind, t)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ===== 列表渲染 =====

function AssetCardList({
  item: asset,
  onClick,
  theme,
}: ListCardRendererProps<any>): React.ReactElement {
  const kind = asset.kind as string;
  const iconMap: Record<string, React.ReactElement> = {
    // 2026-08-31 用户拍板：资产卡片图标统一 18px
    image: <ImageIcon size={18} color={theme.toolbar.textMuted} />,
    video: <VideoIcon size={18} color={theme.toolbar.textMuted} />,
    audio: <MusicIcon size={18} color={theme.toolbar.textMuted} />,
    text: <FileText size={18} color={theme.toolbar.textMuted} />,
    script: <BookOpen size={18} color={theme.toolbar.textMuted} />,
  };
  const kindIcon = iconMap[kind] || <FileText size={18} color={theme.toolbar.textMuted} />;

  return (
    <>
      <span
        style={{ width: '40%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onClick}
      >
        {kindIcon}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset.title}
        </span>
      </span>
      <span style={{ width: '20%' }}>
        <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.toolbar.border}`, color: theme.toolbar.textMuted }}>
          {asset.kind}
        </span>
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {asset.bytes ? `${(asset.bytes / 1024).toFixed(1)} KB` : '-'}
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '-'}
      </span>
    </>
  );
}

// ===== 注册 =====

registerCard('asset', {
  renderGrid: AssetCardGrid,
  renderList: AssetCardList,
});

// 2026-08-30:导出网格渲染器,供画布资产抽屉(canvas-assets/MaterialGroup)复用同款卡片样式
export { AssetCardGrid };