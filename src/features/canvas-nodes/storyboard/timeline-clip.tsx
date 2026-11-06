/**
 * TimelineClip - 单个时间轴 clip 渲染组件
 *
 * 从 storyboard-timeline.tsx 提取，职责单一：
 * 渲染单个 clip（缩略图/视频胶片、状态配色、选中态、拖拽态、质量徽章、trim handle）。
 *
 * 2026-11-05 导演台参考图修订：导演台卡片改为「上缩略框 + 下标签行」——
 * 缩略框高度 = 卡片宽 × 0.62；无产物居中播放三角，有产物显示首帧 + 圆形播放键 +
 * 右下角时长角标；六态徽标缩为缩略框右上角极小角标；未选中压暗、选中细亮描边。
 * 出片页（directorLabel 缺省）分支保持原有渲染零变化。
 */
import React, { memo, useEffect, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { resolveMediaUrl } from '@/platform/media.js';
import { CANVAS_NODE_ICONS } from '../icons.js';
import { VideoFilmstrip } from './storyboard-clip-filmstrip';
import {
  TRACK_HEIGHT,
  TRACK_CLIP_TOP,
  CLIP_BORDER_RADIUS,
  TRIM_HANDLE_WIDTH,
  DIRECTOR_CARD_ASPECT,
  DIRECTOR_CARD_PADDING,
  DIRECTOR_CARD_LABEL_HEIGHT,
  directorRailTone,
  directorBadgeTone,
  statusColor,
  statusBgColor,
  type TimelineClipData,
} from './timeline-constants.js';

// 2026-11-05 导演台卡片：generating 亮度脉冲 + 六态徽标绿点脉冲 + 播放键 hover 提亮
// （模块级注入一次；不碰 transform/boxShadow，避免与选中/拖拽样式冲突）
if (typeof document !== 'undefined' && !document.getElementById('zx-clip-generating-style')) {
  const el = document.createElement('style');
  el.id = 'zx-clip-generating-style';
  el.textContent = [
    '@keyframes zx-clip-generating{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}',
    '@keyframes zx-director-badge-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.42;transform:scale(.78)}}',
    '.zx-director-play{opacity:.82;transition:opacity .12s}',
    '.zx-director-play:hover{opacity:1}',
  ].join('');
  document.head.appendChild(el);
}

interface TimelineClipRenderProps {
  clip: { id: string; left: number; width: number; data: TimelineClipData };
  isSelected: boolean;
  isDragging: boolean;
  /** 2026-09-02 鬼影方案：被拖 clip 的跟手水平偏移（px），拖动时 translateX 跟手滑行 */
  dragTranslateX?: number;
  /** 2026-09-02 占位推开：占位框右侧片段被临时右移的量（px）；与拖拽偏移互斥 */
  pushX?: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: ReactMouseEvent, shotId: string) => void;
  onDoubleClick: (shotId: string) => void;
  onTrimStart?: (e: ReactMouseEvent<HTMLDivElement>, id: string, side: 'left' | 'right') => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  isDark: boolean;
  clipSelectedColor: string;
  trimHandleColor: string;
  clipTextColor: string;
  /** Plan#82 T4: HTML5 跨轨拖拽 */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, clipId: string) => void;
  /**
   * 导演台卡片版式（2026-11-05 参考图）：仅导演台路径传 true；
   * 出片页等缺省渲染完全不变。
   */
  directorLabel?: boolean;
  /** 导演台卡片高度（上缩略框 + 下标签行）；缺省按 220 基准计算 */
  directorCardHeight?: number;
  /** 导演台缩略框中央播放键：点击 = 打开右侧预览并切到该段 */
  onDirectorPlay?: (shotId: string) => void;
  /* 2026-11-04 第八条B：片段内勾选框整块移除（勾选改到轨道上方表格），checkState 已删除 */
}

/** 两位数紧凑序号（片段 01 / 角标 02） */
const pad2 = (n: number): string => String(Math.max(0, Math.round(n))).padStart(2, '0');

/** 可直接渲染的地址；其余字符串按 storageKey 处理（image:/video:/cas: 走平台媒体层） */
const DIRECT_URL_RE = /^(blob:|data:|https?:\/\/)/i;

interface ResolvedMediaUrl {
  url?: string;
  failed: boolean;
}

/** storageKey → 可渲染 URL；解析失败置 failed，调用方据此给可读原因 */
function useClipMediaUrl(raw: string | undefined): ResolvedMediaUrl {
  const [state, setState] = useState<ResolvedMediaUrl>({ failed: false });
  useEffect(() => {
    if (!raw) {
      setState({ failed: false });
      return;
    }
    if (DIRECT_URL_RE.test(raw)) {
      setState({ url: raw, failed: false });
      return;
    }
    let alive = true;
    setState({ failed: false });
    void resolveMediaUrl(raw)
      .then((url) => { if (alive) setState(url ? { url, failed: false } : { failed: true }); })
      .catch(() => { if (alive) setState({ failed: true }); });
    return () => { alive = false; };
  }, [raw]);
  return state;
}

/** 卡片 poster 缓存：同一视频 key 只解一次 */
const VIDEO_POSTER_CACHE = new Map<string, string>();

/** 视频 seek 到 0.5s 抓单帧（部分视频首帧全黑，故不取 0s） */
function captureVideoPoster(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let settled = false;
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore */ }
      resolve(value);
    };
    const timer = window.setTimeout(() => done(null), 8000);
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      try { video.currentTime = duration ? Math.min(0.5, duration / 2) : 0; } catch { done(null); }
    };
    video.onseeked = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) { done(null); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { done(null); return; }
        ctx.drawImage(video, 0, 0, w, h);
        done(canvas.toDataURL('image/jpeg', 0.72));
      } catch {
        done(null);
      }
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}

/** 无持久化首帧时的兜底：视频单帧截图（模块级缓存） */
function useVideoPoster(videoKey: string | undefined): ResolvedMediaUrl {
  const [state, setState] = useState<ResolvedMediaUrl>({ failed: false });
  useEffect(() => {
    if (!videoKey) {
      setState({ failed: false });
      return;
    }
    const cached = VIDEO_POSTER_CACHE.get(videoKey);
    if (cached) {
      setState({ url: cached, failed: false });
      return;
    }
    let alive = true;
    setState({ failed: false });
    void (async () => {
      let url = '';
      try { url = await resolveMediaUrl(videoKey); } catch { url = ''; }
      if (!alive) return;
      if (!url) { setState({ failed: true }); return; }
      const frame = await captureVideoPoster(url);
      if (!alive) return;
      if (frame) {
        VIDEO_POSTER_CACHE.set(videoKey, frame);
        setState({ url: frame, failed: false });
      } else {
        setState({ failed: true });
      }
    })();
    return () => { alive = false; };
  }, [videoKey]);
  return state;
}

export const TimelineClip = memo(function TimelineClip({
  clip,
  isSelected,
  isDragging,
  dragTranslateX = 0,
  pushX = 0,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onDoubleClick,
  onTrimStart,
  t,
  isDark,
  clipSelectedColor,
  trimHandleColor,
  clipTextColor,
  draggable,
  onDragStart,
  directorLabel,
  directorCardHeight,
  onDirectorPlay,
}: TimelineClipRenderProps): React.ReactElement {
  const color = statusColor(clip.data.status, isDark);
  const bg = statusBgColor(clip.data.status, isDark);
  const isNarrow = clip.width < 50;
  const thumbnailUrl = clip.data.thumbnailUrl;
  const videoKey = clip.data.videoKey;
  /** 导演台卡片（仅非窄条；出片页零变化） */
  const director = !!directorLabel && !isNarrow;
  const tone = directorRailTone(isDark);
  const cardHeight = director
    ? (directorCardHeight ?? Math.round(clip.width * DIRECTOR_CARD_ASPECT) + DIRECTOR_CARD_LABEL_HEIGHT + DIRECTOR_CARD_PADDING * 2)
    : TRACK_HEIGHT;
  const thumbHeight = Math.round(clip.width * DIRECTOR_CARD_ASPECT);
  const [hovered, setHovered] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  /**
   * 导演台首帧取值：持久化首帧 storageKey 经平台媒体层解析成可渲染 URL；
   * 无持久化首帧时回落到视频单帧截图（同一 key 只解一次）。
   * thumbnailUrl 已是会话内 URL（blob:/data:）时直通。
   */
  const firstFrame = useClipMediaUrl(director ? thumbnailUrl : undefined);
  const videoPoster = useVideoPoster(director && !thumbnailUrl ? videoKey : undefined);
  const thumbSrc = firstFrame.url ?? videoPoster.url;
  /** 出片页沿用原判定（thumbnailUrl 直接渲染）；导演台按解析后的 URL 判定 */
  const hasThumbImage = director ? (!!thumbSrc && !thumbFailed) : (!!thumbnailUrl && !thumbFailed);
  const frameFailed = !!director && !hasThumbImage
    && (thumbFailed || (thumbnailUrl ? firstFrame.failed : !!videoKey && videoPoster.failed));
  const hasMedia = hasThumbImage || !!videoKey;
  const badgeTone = directorBadgeTone(clip.data.status, isDark);
  const badgeStatus = clip.data.status ?? 'idle';
  const durationChip = pad2(clip.data.duration);
  const labelText = t('storyboard.clipLabel', {
    n: pad2(clip.data.number),
    s: clip.data.duration,
    defaultValue: '片段 {{n}} · {{s}}s',
  });
  const emptyText = t('storyboard.clipNoFrame', { defaultValue: '暂无首帧' });
  const thumbFailedText = t('storyboard.clipThumbFailed', { defaultValue: '首帧加载失败' });
  const playTitle = t('storyboard.clipPlay', { defaultValue: '播放该段' });
  const badgeText = clip.data.status === 'done'
    ? t('storyboard.clipBadgeDone', { defaultValue: '完成' })
    : clip.data.status === 'failed'
      ? t('storyboard.clipBadgeFailed', { defaultValue: '失败' })
      : clip.data.status === 'generating'
        ? t('storyboard.clipBadgeGenerating', { defaultValue: '生成中' })
        : clip.data.status === 'queued'
          ? t('storyboard.clipBadgeQueued', { defaultValue: '排队' })
          : clip.data.status === 'cancelled'
            ? t('storyboard.clipBadgeCancelled', { defaultValue: '已取消' })
            : clip.data.status === 'interrupted'
              ? t('storyboard.clipBadgeInterrupted', { defaultValue: '已中断' })
              : t('storyboard.clipBadgeIdle', { defaultValue: '未生成' });
  const PlayIcon = CANVAS_NODE_ICONS.clipPlay;

  return (
    <div
      key={clip.id}
      data-clip-id={clip.id}
      data-clip-director-card={director ? 'true' : undefined}
      data-clip-selected={director ? (isSelected ? 'true' : 'false') : undefined}
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, clip.id) : undefined}
      onPointerDown={(e) => onPointerDown(e, clip.id)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={director ? () => setHovered(true) : undefined}
      onMouseLeave={director ? () => setHovered(false) : undefined}
      onContextMenu={(e) => onContextMenu(e, clip.id)}
      onDoubleClick={() => onDoubleClick(clip.id)}
      title={director
        ? labelText
        : `#${clip.data.number} ${clip.data.label ?? ''} (${clip.data.duration}s)${!hasMedia ? ' - 待生成' : ''}`}
      style={director ? {
        position: 'absolute',
        left: clip.left,
        top: TRACK_CLIP_TOP - (isSelected ? 2 : 0),
        width: clip.width,
        height: cardHeight,
        borderRadius: CLIP_BORDER_RADIUS,
        border: `1px solid ${isSelected ? tone.selectedBorder : hovered ? tone.cardHoverBorder : tone.cardBorder}`,
        // 选中 = 细亮描边（outline 内缩 1px，避免贴边被滚动容器裁切）+ 柔和外发光 + 2px 抬高
        outline: isSelected ? `1px solid ${tone.selectedOutline}` : 'none',
        outlineOffset: isSelected ? -1 : 0,
        boxShadow: isSelected ? tone.selectedShadow : hovered ? tone.hoverShadow : 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: DIRECTOR_CARD_PADDING,
        boxSizing: 'border-box',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s, border-color 0.12s, transform 0.12s, opacity 0.12s',
        userSelect: 'none',
        touchAction: 'none',
        transform: isDragging
          ? `translateX(${dragTranslateX}px) scale(1.04)`
          : (pushX !== 0 ? `translateX(${pushX}px)` : 'none'),
        // 未选中整卡压暗 0.62；hover 回 0.85；选中 1（参考图口径）
        opacity: isDragging ? 0.7 : isSelected ? 1 : hovered ? tone.opacityHover : tone.opacityRest,
        zIndex: isDragging ? 10 : isSelected ? 2 : 1,
        color: tone.text,
        textShadow: 'none',
        background: tone.cardSurface,
        animation: clip.data.status === 'generating' ? 'zx-clip-generating 1.2s ease-in-out infinite' : undefined,
      } : {
        position: 'absolute',
        left: clip.left,
        top: 7,
        width: clip.width,
        height: TRACK_HEIGHT,
        borderRadius: CLIP_BORDER_RADIUS,
        border: `2px solid ${isSelected ? clipSelectedColor : clip.data.rework?.status === 'flagged' ? '#f59e0b' : clip.data.rework?.status === 'reworking' ? '#3b82f6' : 'transparent'}`,
        boxShadow: isSelected
          ? '0 0 0 1px rgba(0,0,0,0.6)'
          : isDragging
            ? '0 8px 24px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)'
            : 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        display: 'flex',
        alignItems: 'center',
        padding: isNarrow ? '0 2px' : '0 8px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        transition: isDragging ? 'box-shadow 0.15s' : 'box-shadow 0.15s, border-color 0.1s, transform 0.12s, opacity 0.1s',
        userSelect: 'none',
        touchAction: 'none',
        transform: isDragging
          ? `translateX(${dragTranslateX}px) scale(1.04)`
          : (pushX !== 0 ? `translateX(${pushX}px)` : 'none'),
        opacity: isDragging ? 0.7 : 1,
        zIndex: isDragging ? 10 : 1,
        color: hasMedia ? '#ffffff' : clipTextColor,
        textShadow: hasMedia ? '0 1px 2px rgba(0,0,0,0.6)' : 'none',
        background: hasMedia ? 'transparent' : `linear-gradient(135deg, ${bg} 0%, ${color}28 100%)`,
        animation: clip.data.status === 'generating' ? 'zx-clip-generating 1.2s ease-in-out infinite' : undefined,
      }}
    >
      {director ? (
        <>
          {/* 缩略框：固定宽高比；无产物居中播放三角；有产物首帧 + 圆形播放键 + 时长角标 */}
          <div
            data-director-thumb
            style={{
              position: 'relative',
              width: '100%',
              height: thumbHeight,
              flexShrink: 0,
              boxSizing: 'border-box',
              borderRadius: 4,
              overflow: 'hidden',
              background: tone.thumbSurface,
              border: `1px solid ${tone.cardBorder}`,
              zIndex: 1,
            }}
          >
            {hasThumbImage && (
              <AuthorizedImage
                src={thumbSrc}
                onError={() => setThumbFailed(true)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
              />
            )}
            {!hasThumbImage && (frameFailed || !hasMedia) && (
              <div
                data-director-empty
                title={frameFailed ? thumbFailedText : badgeText}
                style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4, color: tone.thumbIcon,
                  pointerEvents: 'none', zIndex: 2,
                }}
              >
                <PlayIcon size={18} strokeWidth={1.6} />
                {/* 取不到首帧时给可读原因，不留空白 */}
                <span style={{ fontSize: 8, fontWeight: 500, lineHeight: 1 }}>
                  {frameFailed ? thumbFailedText : emptyText}
                </span>
              </div>
            )}
            {hasMedia && (
              <>
                <button
                  type="button"
                  data-director-play={clip.id}
                  aria-label={playTitle}
                  title={playTitle}
                  className="zx-director-play"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDirectorPlay?.(clip.id);
                  }}
                  style={{
                    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                    width: 34, height: 34, padding: 0, borderRadius: '50%', border: 0,
                    background: tone.playBg, color: tone.playIcon, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 2,
                  }}
                >
                  <PlayIcon size={13} strokeWidth={2} />
                </button>
                <span
                  data-director-duration
                  title={`${clip.data.duration}s`}
                  style={{
                    position: 'absolute', right: 6, bottom: 6, zIndex: 3,
                    height: 14, padding: '0 4px', borderRadius: 3,
                    background: tone.durationBg, color: tone.durationText,
                    fontSize: 9, fontWeight: 600, lineHeight: '14px',
                  }}
                >
                  {durationChip}
                </span>
              </>
            )}
            {/* 六态徽标缩为缩略框右上角极简角标（不占标签行） */}
            <span
              data-clip-badge={badgeStatus}
              title={badgeText}
              style={{
                position: 'absolute', top: 4, right: 8, zIndex: 3,
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '1px 4px', borderRadius: 4, fontSize: 8, fontWeight: 500, lineHeight: '11px',
                pointerEvents: 'none', whiteSpace: 'nowrap',
                color: badgeTone.text,
                background: badgeTone.bg,
                border: `1px ${badgeTone.dashed ? 'dashed' : 'solid'} ${badgeTone.border}`,
                backdropFilter: 'blur(2px)',
              }}
            >
              <span
                aria-hidden="true"
                data-clip-badge-dot
                style={{
                  width: 5, height: 5, borderRadius: '50%', background: badgeTone.dot,
                  flexShrink: 0,
                  animation: badgeTone.pulse ? 'zx-director-badge-pulse 1.2s ease-in-out infinite' : undefined,
                }}
              />
              {badgeText}
            </span>
          </div>
          {/* 标签行：片段 NN · XXs（i18n key，不硬编码中文） */}
          <div
            data-director-label-row
            style={{ height: DIRECTOR_CARD_LABEL_HEIGHT, display: 'flex', alignItems: 'center', minWidth: 0, zIndex: 1 }}
          >
            <span
              data-director-clip-label
              style={{
                fontSize: 10.5,
                fontWeight: isSelected ? 600 : 500,
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
                color: tone.text,
              }}
            >
              {labelText}
            </span>
          </div>
        </>
      ) : isNarrow ? (
        <div style={{ position: 'relative', width: 4, height: '60%', borderRadius: 2, background: color, flexShrink: 0 }} />
      ) : (
        <>
          {hasMedia && (
            <>
              {videoKey ? (
                <>
                  {thumbnailUrl && (
                    <AuthorizedImage
                      src={thumbnailUrl}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  <VideoFilmstrip
                    storageKey={videoKey}
                    trimStart={clip.data.trimStart ?? 0}
                    trimEnd={clip.data.trimEnd}
                    clipDuration={clip.data.duration}
                    frameCount={Math.min(12, Math.max(1, Math.floor(clip.width / 40)))}
                  />
                </>
              ) : thumbnailUrl ? (
                <AuthorizedImage
                  src={thumbnailUrl}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', pointerEvents: 'none' }} />
            </>
          )}
          <span style={{ position: 'relative', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, marginRight: 6 }}>
            #{clip.data.number}
          </span>
          <span style={{ position: 'relative', fontSize: 9, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: 6 }}>
            {clip.data.status === 'failed'
              ? (t('storyboard.timelineFailed') || '生成失败')
              : clip.data.status === 'cancelled'
                ? (t('storyboard.timelineCancelled') || '已取消')
              : clip.data.status === 'interrupted'
                ? (t('storyboard.timelineInterrupted') || '已中断')
                : clip.data.status === 'generating'
                ? (t('storyboard.timelineGenerating') || '生成中')
                : !hasMedia
                  ? (t('storyboard.timelineNotGenerated') || '未生成')
                  : (clip.data.hasAudio ? '\u266A' : '')}
          </span>
          {clip.data.quality && (
            <span style={{
              position: 'relative',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 14, borderRadius: 3, marginRight: 4,
              fontSize: 9, fontWeight: 700, lineHeight: 1,
              background: clip.data.quality.score >= 7 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)',
              color: '#fff',
              flexShrink: 0,
            }}
              title={`质量门: ${clip.data.quality.score}/10${clip.data.quality.deductions && clip.data.quality.deductions.length > 0 ? `\n失分: ${clip.data.quality.deductions.map((d) => d.reason).join('; ')}` : ''}`}
            >
              {clip.data.quality.score}
            </span>
          )}
          <b style={{ position: 'relative', fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', opacity: 0.9 }}>{clip.data.duration}s</b>
        </>
      )}
      {/* §8.5 rework 角标（橙=待修改 / 蓝=修改中；done 不显角标，靠绿状态色） */}
      {clip.data.rework?.status && clip.data.rework.status !== 'done' && (
        <span
          title={`${clip.data.rework.status === 'flagged' ? (t('storyboardRow.reworkFlagged') || '待修改') : (t('storyboardRow.reworking') || '修改中')}${clip.data.rework.reason ? `：${clip.data.rework.reason}` : ''}`}
          style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, borderTop: `9px solid ${clip.data.rework.status === 'flagged' ? '#f59e0b' : '#3b82f6'}`, borderRight: '9px solid transparent', zIndex: 3, pointerEvents: 'none' }}
        />
      )}
      {/* 时长 trim handle：导演台卡片不提供（时长只来自参数）；出片页原样保留 */}
      {!director && onTrimStart && (
        <div
          data-clip-trim={clip.id}
          className="zx-clip-trim"
          onMouseDown={(e) => onTrimStart(e, clip.id, 'right')}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: TRIM_HANDLE_WIDTH,
            height: '100%',
            cursor: 'ew-resize', zIndex: 4,
            background: isSelected ? trimHandleColor : color,
            opacity: isSelected ? 0.95 : 0.28,
            transition: 'opacity 0.12s',
          }}
          title={t('storyboard.timelineTrim') || '拖动调整时长'}
        />
      )}
    </div>
  );
});
