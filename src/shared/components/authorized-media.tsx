/**
 * authorized-media - 带 JWT 认证的媒体渲染组件
 *
 * <img>/<video> 标签不会发送 Authorization header,导致私有资源(resources/front/ 前缀)返回 403。
 * 此处参考 use-auth-image.ts 的实现:fetch + Bearer token → blob URL → 渲染,并在卸载时 revokeObjectURL。
 *
 * 认证加载失败时回退到原始 URL,交由浏览器触发 onError,让调用方复用既有的降级逻辑。
 *
 * 公开资源直连(2026-09-04):storageKey 命中后端匿名读白名单(resources/public/)时跳过 fetch,
 * 直接用原 URL 渲染。否则 <img loading="lazy"> 的视口懒加载会被 fetch 抢跑而失效
 * (整页卡片一次性并发拉图),且 blob 就绪前封面区空白、图片到手后整张突现(观感「突变」)。
 */

import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { getToken } from '@/services/api-client.js';

/** 匿名可读前缀(与后端 storage.controller PUBLIC_READ_PREFIXES 同源,改动需两侧同步) */
const PUBLIC_READ_PREFIXES = ['resources/public/'];

/** 从已解析的资源 URL(?key=...)判断是否指向匿名可读的公开资源 */
function isPublicResourceUrl(url: string): boolean {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return false;
  const key = new URLSearchParams(url.slice(qIndex + 1)).get('key');
  if (!key) return false;
  return PUBLIC_READ_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 带认证的资源加载:返回 { src, failed }。公开资源直连,私有资源 fetch + Bearer → blob */
function useAuthorizedMediaSrc(url: string | undefined): { src?: string; failed: boolean } {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  /**
   * 2026-11-05 修复（第三次「预览图/视频失效」根因之一）：只 revoke 本 hook 自己创建的
   * blob URL。此前把外部传入的 blob: URL 也记进 blobUrlRef，url 变化/重跑时一并 revoke——
   * 那个 URL 属于共享解析层（media-url-provider / 各存储缓存），revoke 等于击穿其他
   * 正在展示它的组件（blob: → ERR_FILE_NOT_FOUND → 空白）。同时改为 cleanup 中 revoke，
   * 修复旧实现「卸载不 revoke」的泄漏。
   */
  const createdUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setResolvedSrc(undefined);
    setFailed(false);

    if (!url) return;

    // blob/data URL 无需认证,直接使用——但绝不记录到 createdUrlRef（不拥有、不 revoke）
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      setResolvedSrc(url);
      return;
    }

    // 公开资源(命中后端匿名读白名单):直连原 URL,不 fetch →
    // 浏览器原生 lazy 视口懒加载、渐进渲染与 HTTP 缓存全部生效
    if (isPublicResourceUrl(url)) {
      setResolvedSrc(url);
      return;
    }

    let cancelled = false;
    const token = getToken();

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!cancelled) {
          const newBlobUrl = URL.createObjectURL(blob);
          createdUrlRef.current = newBlobUrl;
          setResolvedSrc(newBlobUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      // 只回收自己创建的 URL（外部传入的 blob: URL 生命周期归其所有者）
      const created = createdUrlRef.current;
      createdUrlRef.current = undefined;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return { src: resolvedSrc, failed };
}

/** 带认证的 <img>(私有资源经 fetch + Authorization header 加载)
 * 默认禁用浏览器原生拖拽(Plan#20 bug 修复:节点内图片可拖拽会被画布 drop 误判为素材投放触发上传;调用方可显式传 draggable 覆盖) */
export function AuthorizedImage(props: ImgHTMLAttributes<HTMLImageElement>): React.ReactElement {
  const { src, onError, draggable = false, ...rest } = props;
  const { src: authSrc, failed } = useAuthorizedMediaSrc(src);
  return (
    <img
      src={authSrc ?? (failed ? src : undefined)}
      onError={onError}
      draggable={draggable}
      {...rest}
    />
  );
}

/** 带认证的 <video>(私有资源经 fetch + Authorization header 加载) */
export function AuthorizedVideo(props: VideoHTMLAttributes<HTMLVideoElement>): React.ReactElement {
  const { src, onError, ...rest } = props;
  const { src: authSrc, failed } = useAuthorizedMediaSrc(src);
  return (
    <video
      src={authSrc ?? (failed ? src : undefined)}
      onError={onError}
      {...rest}
    />
  );
}
