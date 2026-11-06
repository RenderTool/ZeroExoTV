/**
 * thumb-image — 缩略图/媒体单一解析入口（2026-11-05 媒体 URL 层重做）
 *
 * 所有小图/预览渲染统一走这里，按类型分派（禁止「类型未知回退胶片图标」式静默兜底）：
 * - image：派生 thumb 档 → 派生 preview 档 → 原图（限尺寸兜底）；原图只允许用于导出/运行与 hover 大图；
 * - video：派生 poster（thumb/preview）优先 → 取不到则解析原视频渲染 <video preload="metadata">（浏览器显示首帧）；
 *   hover 大图（playable）直接取原视频：<video muted loop playsInline autoPlay>，可点开播/暂停；
 * - audio：只解析原文件；hover 大图渲染 <audio controls>，格子内保持图标。
 * 云键（resources/ 前缀）走后端认证链（视频/音频取 full）；未就绪显示占位（深色底无白块）。
 *
 * 2026-11-05 根治重构（第三次「预览图/视频失效」事故）：本地键不再走
 * resolveThumbnailUrl 等字符串缓存（内存 URL 无生命周期、坏了不自愈），
 * 统一经 useMediaObjectUrl（media-url-provider 单一所有权）：
 * - 挂载 acquire / 卸载 release，refCount 归零才 revoke，绝不击穿他人显示；
 * - <img>/<video> onError → markError 自愈：丢弃坏 URL → 重读存储 → 重试一次，
 *   仍失败给可读原因；IMAGE_CONTENT_UPDATED_EVENT 到达后同 key 全部持有者换新图。
 * 页面刷新后一切按 storageKey 重新解析（绝不使用/恢复旧 blob: URL）。
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  IMAGE_VARIANT_SPECS, DEFAULT_DPR, imageVariantChain, pickImageVariant,
} from '@zeroexo/plugin-persistence';
import { isBackendKey } from '@/services/backend-upload.js';
import { useAuthResourceUrl } from '@/shared/hooks/use-auth-image.js';
import { useMediaObjectUrl } from '@/shared/hooks/use-media-object-url.js';
import type { MediaVariant } from '@/shared/media/resolve-media-blob.js';

/** 媒体类型（2026-11-05 视频预览 bug：解析链按类型分派，不再一律当图片） */
export type MediaKind = 'image' | 'video' | 'audio';

/**
 * 本地键变体链：图片一律取自 image-variants.ts 单一事实源（征集 #186）。
 * 低档缺失时优先向上取更清晰的档，绝不「preview 缺失回退 48px thumb」把图放大发糊。
 */
function localVariants(kind: MediaKind, prefer: 'thumb' | 'preview' | 'orig'): readonly MediaVariant[] {
  if (kind === 'image') {
    const cssPx = prefer === 'preview'
      ? IMAGE_VARIANT_SPECS.thumb.maxEdge
      : IMAGE_VARIANT_SPECS.thumb.maxEdge / DEFAULT_DPR;
    return imageVariantChain(cssPx, DEFAULT_DPR);
  }
  if (kind === 'audio') return ['orig'];
  // 视频：poster（thumb/preview）优先，取不到则原视频（<video> 首帧）；hover 播放直接原视频
  return prefer === 'orig' ? ['orig'] : ['thumb', 'preview', 'orig'];
}

/**
 * 缩略图解析入口（云键走认证链取 thumb/preview；本地键走媒体 URL 提供者派生链）。
 * 保留导出兼容既有调用方；新代码建议直接用 useResolvedMedia（可拿到 markError 自愈入口）。
 */
export function useResolvedThumb(storageKey: string | undefined, prefer: 'thumb' | 'preview'): string {
  const isCloud = !!storageKey && isBackendKey(storageKey);
  const variants = useMemo(() => localVariants('image', prefer), [prefer]);
  const local = useMediaObjectUrl(isCloud ? undefined : storageKey, 'image', variants);
  const cloudSrc = useAuthResourceUrl(isCloud ? storageKey : undefined, prefer === 'thumb' ? 'thumb' : 'preview');
  return cloudSrc || local.url;
}

/**
 * 媒体解析（按类型分派）：
 * - image：派生链（thumb → preview → 原图；云键走认证链）；
 * - video：poster（thumb/preview）优先，取不到则解析原视频（isOriginal=true → 渲染 <video> 取首帧）；
 *     prefer='orig'（hover 播放）直接取原视频；云键取 full（认证链）；
 * - audio：只解析原文件（派生档对音频无意义）。
 * 返回 isOriginal 标明是否为原文件本体（视频用它决定渲染 <video> 而非 <img>）；
 * markError 供 <img>/<video> onError 触发自愈（坏 URL 丢弃重读、重试一次）。
 */
export function useResolvedMedia(
  storageKey: string | undefined,
  kind: MediaKind,
  prefer: 'thumb' | 'preview' | 'orig',
): { url: string; isOriginal: boolean; markError: () => void; failed: boolean; reason: string } {
  const isCloud = !!storageKey && isBackendKey(storageKey);
  const variants = useMemo(() => localVariants(kind, prefer), [kind, prefer]);
  const local = useMediaObjectUrl(isCloud ? undefined : storageKey, kind, variants);
  // 云键：图片取 size 档（thumb/preview），视频/音频取 full（原文件 → blob URL，可播）
  const cloudSized = useAuthResourceUrl(isCloud && kind === 'image' ? storageKey : undefined, prefer === 'thumb' ? 'thumb' : 'preview');
  const cloudFull = useAuthResourceUrl(isCloud && kind !== 'image' ? storageKey : undefined, 'full');
  if (kind === 'image') {
    return { url: cloudSized || local.url, isOriginal: false, markError: local.markError, failed: local.failed, reason: local.reason };
  }
  if (isCloud) {
    // 云视频/音频：URL 未就绪走「源未就绪」占位（认证链挂起≠失败，不报错因）
    return { url: cloudFull || '', isOriginal: true, markError: local.markError, failed: false, reason: '' };
  }
  return { url: local.url, isOriginal: local.origin === 'orig', markError: local.markError, failed: local.failed, reason: local.reason };
}

/** 缩略图/媒体格子：深底 + object-fit cover + 统一圆角。
 *  image → <img>；video → poster <img> 或 <video preload="metadata">（首帧），playable 时 autoPlay 可点播/暂停；
 *  audio → 格子图标、playable 时 <audio controls>；视频/音频源取不到 → 占位 + 可读原因（不静默兜底）；
 *  onError → markError 自愈（丢弃坏 URL、重读重试一次，仍失败给可读原因）。 */
export function ThumbImage({
  storageKey,
  url,
  prefer,
  kind = 'image',
  playable = false,
  width,
  height,
  radius,
  title,
  icon,
}: {
  storageKey?: string;
  /** 无 storageKey 的外部 URL 资产直连（既有行为；本地资产一律走 storageKey 派生链） */
  url?: string;
  prefer?: 'thumb' | 'preview';
  kind?: MediaKind;
  /** hover 大图等可播场景：video → autoPlay + 点按播/暂停；audio → <audio controls> */
  playable?: boolean;
  width: number | string;
  height: number;
  radius: number;
  title?: string;
  icon: ReactElement;
}): ReactElement {
  // 2026-11-06（征集 #186）：未显式传 prefer 时，按设计显示尺寸 × DPR 自动选档，
  // 杜绝「设计 60px 却取 30/48px 档」；显式 prefer 保留最高优先级（大图/灯箱调用方）。
  // 画布节点不走这里（自己按 viewport.k × DPR 做像素预算协商）。
  const autoPrefer: 'thumb' | 'preview' = useMemo(() => {
    const cssW = typeof width === 'number' ? width : 240;
    const cssPx = Math.max(cssW, height, 1);
    const dpr = typeof window === 'undefined' ? DEFAULT_DPR : (window.devicePixelRatio || DEFAULT_DPR);
    return pickImageVariant(cssPx, dpr) === 'thumb' ? 'thumb' : 'preview';
  }, [width, height]);
  // 视频可播/音频一律取原文件；图片按协商档（或显式 prefer）
  const effPrefer: 'thumb' | 'preview' | 'orig' =
    kind === 'audio' || (kind === 'video' && playable) ? 'orig' : (prefer ?? autoPrefer);
  const media = useResolvedMedia(storageKey, kind, effPrefer);
  const [hardFailed, setHardFailed] = useState(false);
  useEffect(() => { setHardFailed(false); }, [media.url, url]);
  const src = storageKey ? media.url : (url ?? '');
  // 视频源取不到：可读原因（不静默显示图标当作完成）
  const kindLabel = kind === 'video' ? '视频' : '音频';
  const unresolvedReason = !storageKey && !url
    ? `${kindLabel}源缺失（资产无存储键）`
    : media.failed
      ? `${kindLabel}${media.reason || '源未就绪（storageKey 未解析到文件）'}`
      : `${kindLabel}源未就绪（storageKey 未解析到文件）`;
  const failed = hardFailed || media.failed;
  const mediaUnresolved = kind !== 'image' && (!src || failed);
  return (
    <span
      data-thumb={storageKey ?? url}
      data-media-unresolved={mediaUnresolved ? '' : undefined}
      title={mediaUnresolved ? `${title ?? ''}｜${unresolvedReason}` : title}
      style={{
        width, height, borderRadius: radius, overflow: 'hidden', flexShrink: 0,
        background: 'rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {src && !failed ? (
        kind === 'video' && (media.isOriginal || !storageKey) ? (
          <video
            src={src}
            data-thumb-video=""
            muted
            loop
            playsInline
            preload="metadata"
            autoPlay={playable}
            onError={() => {
              if (storageKey) media.markError();
              else setHardFailed(true);
            }}
            onClick={playable
              ? (e) => {
                  const v = e.currentTarget;
                  if (v.paused) void v.play().catch(() => {});
                  else v.pause();
                }
              : undefined}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : kind === 'audio' && playable ? (
          <audio data-thumb-audio="" controls src={src} style={{ width: '100%' }} />
        ) : (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              if (storageKey) media.markError();
              else setHardFailed(true);
            }}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )
      ) : mediaUnresolved ? (
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 6px', textAlign: 'center' }}>
          {icon}
          <span style={{ fontSize: 10, lineHeight: '13px', opacity: 0.75 }}>{unresolvedReason}</span>
        </span>
      ) : icon}
    </span>
  );
}
