/**
 * media-lightbox - 全资产统一查看器外壳（2026-11-05 用户定稿）
 *
 * 唯一壳：图片 / 视频 / 文本都在这一个壳里看，不再弹旧的资产详情面板。
 * - 图片：复用 image-viewer.tsx 的 ImageViewerStage + useImagePanZoom（滚轮/拖拽/双指缩放 + 1:1）
 * - 视频：同壳内 <video controls autoPlay muted playsInline>，保留遮罩/前后切换
 * - 文本：同壳内只读 <pre>（等宽、可滚动、可复制、保留换行）
 * 顶部统一信息条：资产名 / 类型 / 尺寸或时长 / 来源 / 动作区（下载、发送等由调用方传入）。
 *
 * 取图铁律（不越界改媒体 URL 层）：一律走既有 storageKey 解析链
 * （useMediaObjectUrl / useAuthResourceUrl），本组件不新建、不 revoke 任何 blob URL；
 * 解析失败时展示可读原因，不留空白/坏图。开源库等直连条目允许传 url + fallbackUrl。
 *
 * 渲染到 document.body（portal）：抽屉/面板祖先的 transform、overflow:hidden 不会裁剪遮罩。
 *
 * 交互：ESC 关闭 / 左右方向键切换 / 点击遮罩关闭 / 双击复位 / 工具条缩放 + 「1:1 原尺寸」。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Copy, Download, Maximize2, X } from 'lucide-react';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from './image-viewer.js';
import { useMediaObjectUrl } from '@/shared/hooks/use-media-object-url.js';
import { useAuthResourceUrl } from '@/shared/hooks/use-auth-image.js';
import { isBackendKey } from '@/services/backend-upload.js';

export type MediaLightboxKind = 'image' | 'video' | 'text';

/** 点击遮罩关闭的位移阈值（px）：超过视为拖拽/平移，不关闭 */
export const LIGHTBOX_BACKDROP_CLOSE_MAX_MOVE = 6;

/** 一个可查看条目：本地/云素材传 storageKey；开源库等直连条目传 url（可选 fallbackUrl） */
export interface MediaLightboxItem {
  id: string;
  title: string;
  /** 资产类型；缺省 image（兼容既有调用） */
  kind?: MediaLightboxKind;
  /** 本地/CAS/云 storageKey（优先，走统一解析链） */
  storageKey?: string;
  /** 直连 URL（无 storageKey 时使用；如开源库条目） */
  url?: string;
  /** 直连 URL 失败时的同源回退源（如开源库打包缩略图） */
  fallbackUrl?: string;
  /** text：正文（资产 data.content；缺省时按 storageKey 解析后读取文本） */
  content?: string;
  /** 来源标签：我的资产库 / 开源库 / 画布节点 / 历史产出 */
  source?: string;
}

export interface MediaLightboxProps {
  items: MediaLightboxItem[];
  /** 当前条目下标（越界自动钳制） */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 顶部动作区（下载 / 发送到画布 / 导演台 / 主体）；由调用方按场景传入 */
  actions?: React.ReactNode;
}

const KIND_LABEL: Record<MediaLightboxKind, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
};

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1100,
  background: 'rgba(0, 0, 0, 0.88)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '56px 72px',
};

const NAV_BTN_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 40,
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 20,
  border: 'none',
  background: 'rgba(0,0,0,0.5)',
  color: 'rgba(255,255,255,0.9)',
  cursor: 'pointer',
};

const INFO_BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 26,
  padding: '0 8px',
  borderRadius: 8,
  border: 'none',
  background: 'rgba(0,0,0,0.5)',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MediaLightbox({ items, index, onIndexChange, onClose, actions }: MediaLightboxProps): React.ReactElement {
  const { t } = useTranslation();
  const clampedIndex = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
  const item = items[clampedIndex];
  const kind: MediaLightboxKind = item?.kind ?? 'image';
  const storageKey = item?.storageKey;
  const isCloud = !!storageKey && isBackendKey(storageKey);
  const isVideo = kind === 'video';
  const isText = kind === 'text';

  // 统一解析链：本地/CAS 走 useMediaObjectUrl 且优先取原文件（['orig']），云键走后端认证链
  const local = useMediaObjectUrl(isCloud ? undefined : storageKey, isVideo ? 'video' : 'image', ['orig']);
  // 全屏灯箱与本地键 ['orig'] 对称：云键图片也取 full（旧实现只取 1024px preview，放大必糊）
  const cloudUrl = useAuthResourceUrl(isCloud ? storageKey : undefined, 'full');

  // 直连条目（开源库）：主源加载失败 → 同源回退源；再失败 → 可读原因
  const [fallbackActive, setFallbackActive] = useState(false);
  const [directFailed, setDirectFailed] = useState(false);
  // 「1:1 原尺寸」可用性（真实自然尺寸 > 显示尺寸时才需要放大）
  const [naturalScale, setNaturalScale] = useState(0);
  // 顶部信息条：尺寸 / 时长
  const [sizeText, setSizeText] = useState('');
  // 文本类：storageKey 解析后读到的正文
  const [resolvedText, setResolvedText] = useState('');
  const [textFailed, setTextFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const panZoom = useImagePanZoom();

  // 点遮罩关闭：只有「按下与抬起都在遮罩上、且位移 < 6px」才关。
  // 拖拽平移/缩放松手、按下在内容抬起又在遮罩上、按下遮罩抬起在内容上，都不关。
  const backdropPressRef = useRef<{ target: EventTarget | null; x: number; y: number } | null>(null);
  /**
   * 图片元素铺满舞台（object-fit: contain），左右/上下留白也属于 <img> 的点击命中区。
   * 因此「点非媒体区域关闭」不能只比对 target===currentTarget，必须按图片真实绘制矩形判断：
   * 点在图片内容之外 = 点空白，关闭；点在图片上 = 不关（平移/缩放不受影响）。
   */
  const isImageLetterboxClick = (target: EventTarget | null, x: number, y: number): boolean => {
    if (!(target instanceof HTMLImageElement) || target.naturalWidth <= 0 || target.naturalHeight <= 0) return false;
    const rect = target.getBoundingClientRect();
    const scale = Math.min(rect.width / target.naturalWidth, rect.height / target.naturalHeight);
    const drawW = target.naturalWidth * scale;
    const drawH = target.naturalHeight * scale;
    const left = rect.left + (rect.width - drawW) / 2;
    const top = rect.top + (rect.height - drawH) / 2;
    return x < left || x > left + drawW || y < top || y > top + drawH;
  };
  const onBackdropPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    backdropPressRef.current = { target: e.target, x: e.clientX, y: e.clientY };
  };
  const onBackdropPointerUp = (e: React.PointerEvent<HTMLElement>): void => {
    const press = backdropPressRef.current;
    backdropPressRef.current = null;
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= LIGHTBOX_BACKDROP_CLOSE_MAX_MOVE) return;
    // 按下必须落在遮罩/内容/图片留白上（图片内容、按钮、视频、文本都不算）
    if (press.target !== e.currentTarget && press.target !== e.target) return;
    if (e.target === e.currentTarget || press.target === e.currentTarget) { onClose(); return; }
    if (isImageLetterboxClick(e.target, e.clientX, e.clientY)) onClose();
  };

  // 关闭后把焦点还给打开前的元素（通常是触发的卡片/按钮），并避免抢滚动位置
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement) restoreFocusRef.current = active;
    }
    return () => {
      const el = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (el && document.contains(el)) {
        try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      }
    };
  }, []);

  // 切换条目：重置回退/失败态、文本与缩放视角（不同资产不能继承上一张的状态）
  useEffect(() => {
    setFallbackActive(false);
    setDirectFailed(false);
    setNaturalScale(0);
    setSizeText('');
    setResolvedText('');
    setTextFailed(false);
    setCopied(false);
    panZoom.reset();
    // panZoom.reset 为稳定回调（useCallback），不纳入依赖以免每次渲染重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // 键盘：ESC 关闭、左右方向键切换（与同列表前后条目一致）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && clampedIndex > 0) {
        e.preventDefault();
        onIndexChange(clampedIndex - 1);
      } else if (e.key === 'ArrowRight' && clampedIndex < items.length - 1) {
        e.preventDefault();
        onIndexChange(clampedIndex + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clampedIndex, items.length, onClose, onIndexChange]);

  const src = useMemo(() => {
    if (storageKey) return cloudUrl || local.url;
    if (fallbackActive) return item?.fallbackUrl ?? '';
    return item?.url ?? '';
    // local.url 随解析就绪变化
  }, [storageKey, cloudUrl, local.url, fallbackActive, item?.fallbackUrl, item?.url]);

  // 文本：优先用调用方给的正文；只有 storageKey 时从解析后的对象 URL 读文本（不新建 blob URL）
  useEffect(() => {
    if (!isText) return;
    if (item?.content) return;
    const url = src;
    if (!url) return;
    let alive = true;
    void fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((text) => { if (alive) setResolvedText(text); })
      .catch(() => { if (alive) setTextFailed(true); });
    return () => { alive = false; };
  }, [isText, item?.content, src]);

  const failed = storageKey ? local.failed : directFailed;
  const usingFallback = !storageKey && fallbackActive;
  const textBody = item?.content ?? resolvedText;
  const textUnavailable = isText && !textBody && (textFailed || failed);

  const handleImgError = (): void => {
    if (storageKey) {
      // 走统一自愈（每轮只重试一次），仍失败给可读原因
      local.markError();
      return;
    }
    if (!fallbackActive && item?.fallbackUrl) {
      setFallbackActive(true);
      return;
    }
    setDirectFailed(true);
  };

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const el = e.currentTarget;
    const displayed = el.offsetWidth;
    if (el.naturalWidth > 0 && el.naturalHeight > 0) setSizeText(`${el.naturalWidth}×${el.naturalHeight}`);
    if (el.naturalWidth > 0 && displayed > 0 && el.naturalWidth > displayed) {
      setNaturalScale(el.naturalWidth / displayed);
    } else {
      setNaturalScale(0);
    }
  };

  const handleVideoMeta = (e: React.SyntheticEvent<HTMLVideoElement>): void => {
    const el = e.currentTarget;
    if (el.videoWidth > 0 && el.videoHeight > 0) setSizeText(`${el.videoWidth}×${el.videoHeight}`);
    const dur = formatDuration(el.duration);
    if (dur) setSizeText((prev) => (prev ? `${prev} · ${dur}` : dur));
  };

  const copyText = (): void => {
    if (!textBody) return;
    void navigator.clipboard?.writeText(textBody).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => undefined);
  };

  const failReason = storageKey
    ? local.reason || t('mediaLightbox.failed', '文件不可用（未落盘或已被清理），请重新导入后再看')
    : t('mediaLightbox.failed', '文件不可用（未落盘或已被清理），请重新导入后再看');

  // 2026-11-05 修复（用户第四条反馈「点开源资产打不开查看器」）：
  // 直接渲染时 position:fixed 遮罩会被宿主祖先（抽屉/面板的 transform、overflow:hidden、
  // contain 等）相对化或裁剪——表现为「点了没反应」。统一 portal 到 body，脱离祖先布局链。
  const overlay = (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={item?.title ?? ''}
      data-lightbox=""
      data-lightbox-backdrop=""
      data-lightbox-kind={kind}
      style={OVERLAY_STYLE}
      // 点遮罩关闭：按下+抬起都在遮罩且位移 < 6px（内容区/视频/工具条都不参与判定）
      onPointerDown={onBackdropPointerDown}
      onPointerUp={onBackdropPointerUp}
    >
      <div
        data-lightbox-content=""
        // 2026-11-05：内容容器铺 92vw/92vh，用户看到的“空白处”其实是它或舞台，
        // 只绑最外层遮罩会导致“点半天关不掉”。同一套判定（按下+抬起同元素、位移 <6px）也挂到这里。
        onPointerDown={onBackdropPointerDown}
        onPointerUp={onBackdropPointerUp}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(92vw, 1600px)',
          height: 'min(92vh, 1200px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 顶部统一信息条：名称 / 类型 / 尺寸或时长 / 来源 / 计数 / 动作区 / 关闭 */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
          color: 'rgba(255,255,255,0.88)', fontSize: 12, pointerEvents: 'none',
        }}>
          <span data-lightbox-title style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item?.title}
          </span>
          <span data-lightbox-kind-label style={{ opacity: 0.7, flexShrink: 0 }}>
            {KIND_LABEL[kind]}
          </span>
          <span data-lightbox-size style={{ opacity: 0.6, flexShrink: 0 }}>
            {sizeText}
          </span>
          {item?.source && (
            <span data-lightbox-source style={{ opacity: 0.6, flexShrink: 0 }}>
              {item.source}
            </span>
          )}
          {items.length > 1 && (
            <span data-lightbox-counter style={{ opacity: 0.65, flexShrink: 0 }}>
              {clampedIndex + 1} / {items.length}
            </span>
          )}
          {usingFallback && (
            <span data-lightbox-fallback style={{ flexShrink: 0, color: '#f0b429' }}>
              {t('mediaLightbox.fallback', '高清原图不可用，已显示本地缩略图')}
            </span>
          )}
          {/* 动作区（发送/下载等由调用方注入），pointerEvents 单独放行 */}
          <span data-lightbox-actions style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, pointerEvents: 'auto' }}>
            {src && (
              <a
                data-lightbox-download=""
                href={src}
                download={item?.title ?? ''}
                style={{ ...INFO_BTN_STYLE, textDecoration: 'none' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={12} /> {t('common.download', '下载')}
              </a>
            )}
            {actions}
          </span>
          <button
            type="button"
            data-lightbox-close=""
            aria-label={t('common.close', '关闭')}
            onClick={onClose}
            style={{
              pointerEvents: 'auto', width: 28, height: 28, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.5)',
              color: 'rgba(255,255,255,0.9)', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {isText ? (
          textUnavailable ? (
            <div
              data-lightbox-failed=""
              style={{
                maxWidth: 420, padding: '18px 20px', borderRadius: 10, textAlign: 'center',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.7,
              }}
            >
              {failReason}
            </div>
          ) : (
            <>
              <pre
                data-lightbox-text=""
                style={{
                  width: '100%', height: '100%', margin: 0, overflow: 'auto', padding: '44px 16px 16px',
                  borderRadius: 10, background: 'rgba(255,255,255,0.04)',
                  color: 'rgba(255,255,255,0.9)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  userSelect: 'text',
                }}
              >
                {textBody}
              </pre>
              <button
                type="button"
                data-lightbox-copy=""
                onClick={copyText}
                style={{ ...INFO_BTN_STYLE, position: 'absolute', right: 8, bottom: 8, pointerEvents: 'auto' }}
              >
                <Copy size={12} /> {copied ? '已复制' : '复制'}
              </button>
            </>
          )
        ) : failed || !src ? (
          <div
            data-lightbox-failed=""
            style={{
              maxWidth: 420, padding: '18px 20px', borderRadius: 10, textAlign: 'center',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 1.7,
            }}
          >
            {failReason}
          </div>
        ) : isVideo ? (
          <video
            data-lightbox-video=""
            src={src}
            controls
            autoPlay
            muted
            playsInline
            onLoadedMetadata={handleVideoMeta}
            onError={handleImgError}
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, background: '#000' }}
          />
        ) : (
          <ImageViewerStage
            src={src}
            alt={item?.title ?? ''}
            panZoom={panZoom}
            resetOnDoubleClick
            onImgError={handleImgError}
            onImgLoad={handleImgLoad}
            containerStyle={{ width: '100%', height: '100%', background: 'transparent' }}
            imgStyle={{ objectFit: 'contain' }}
            containerProps={{
              'data-lightbox-stage': '',
              // 舞台空白区（图片 contain 后的黑边）也归入“点空白关闭”；
              // 图片本体是子元素，target !== currentTarget → 平移/缩放不受影响
              onPointerDown: onBackdropPointerDown,
              onPointerUp: onBackdropPointerUp,
            } as React.HTMLAttributes<HTMLDivElement>}
          />
        )}

        {/* 同列表前后切换 */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              data-lightbox-prev=""
              aria-label={t('mediaLightbox.prev', '上一个')}
              disabled={clampedIndex <= 0}
              onClick={() => onIndexChange(clampedIndex - 1)}
              style={{ ...NAV_BTN_STYLE, left: -52, opacity: clampedIndex <= 0 ? 0.3 : 1 }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              data-lightbox-next=""
              aria-label={t('mediaLightbox.next', '下一个')}
              disabled={clampedIndex >= items.length - 1}
              onClick={() => onIndexChange(clampedIndex + 1)}
              style={{ ...NAV_BTN_STYLE, right: -52, opacity: clampedIndex >= items.length - 1 ? 0.3 : 1 }}
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}

        {/* 图片缩放工具条 + 1:1 原尺寸（视频/文本不需要） */}
        {!failed && !isText && !isVideo && src && (
          <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center' }}>
            {naturalScale > 0 && (
              <button
                type="button"
                data-lightbox-1to1=""
                onClick={() => panZoom.setScale(naturalScale)}
                title={t('mediaLightbox.actualSize', '原尺寸')}
                style={INFO_BTN_STYLE}
              >
                <Maximize2 size={12} /> 1:1
              </button>
            )}
            <ZoomToolbar panZoom={panZoom} />
          </div>
        )}
      </div>
    </section>
  );
  if (typeof document === 'undefined') return overlay;
  return createPortal(overlay, document.body);
}
