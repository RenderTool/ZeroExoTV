/**
 * useAuthImage - 带 JWT 认证的图片加载 hook
 *
 * 后端 storage/get 端点对私有资源(resources/front/assets/*)要求 JWT 认证,
 * 但 <img> 标签不会发送 Authorization header 导致 403。
 * 此 hook 通过 fetch + Bearer token 加载图片并创建 blob URL, 解决认证问题。
 */

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/services/api-client.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';

/**
 * 带认证的图片 URL hook
 * @param url 原始图片 URL(storage/get 端点)
 * @returns 可用于 <img src> 的 blob URL,加载失败返回 undefined
 */
export function useAuthImageUrl(url: string | undefined): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  /**
   * 2026-11-05 修复（第三次「预览图/视频失效」根因之一）：只记录/回收本 hook 自己
   * 创建的 blob URL。此前把外部传入的 blob: URL 也记进 blobUrlRef，url 变化重跑时
   * 一并 revoke——那个 URL 属于共享解析层（media-url-provider / 各存储缓存），
   * revoke 会击穿其他正在展示它的组件（blob: → ERR_FILE_NOT_FOUND → 空白）。
   */
  const createdUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setBlobUrl(undefined);

    if (!url) return;

    // blob/data URL 无需认证,直接使用（不拥有、不 revoke）
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      setBlobUrl(url);
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
          setBlobUrl(newBlobUrl);
        }
      })
      .catch((err) => {
        console.warn('[useAuthImageUrl] fetch failed:', url, err);
        // 失败时保持 undefined, 由调用方处理 fallback 显示
      });

    return () => {
      cancelled = true;
      // 只回收自己创建的 URL（外部传入的 blob: URL 生命周期归其所有者）
      const created = createdUrlRef.current;
      createdUrlRef.current = undefined;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return blobUrl;
}

/**
 * 带认证的资源 URL hook —— 替代 getResourceUrl 的直接使用。
 *
 * 将 storageKey 通过 getResourceUrl 转为 URL 后,
 * 再用 useAuthImageUrl 携带 JWT token 获取图片 blob,
 * 解决 <img> 标签无法发送 Authorization header 的问题。
 *
 * @param storageKey 资源存储 key
 * @param size 图片尺寸(thumb/preview/full)
 * @returns 可用于 <img src> 的 blob URL,加载失败返回 undefined
 */
export function useAuthResourceUrl(
  storageKey: string | undefined,
  size: 'thumb' | 'preview' | 'full' = 'thumb',
): string | undefined {
  const url = storageKey ? getResourceUrl(storageKey, size) : undefined;
  return useAuthImageUrl(url);
}