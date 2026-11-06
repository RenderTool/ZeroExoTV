/**
 * useMediaObjectUrl — 媒体对象 URL 消费 hook（2026-11-05 媒体 URL 层重做）
 *
 * 契约（对应「图片整片空白」事故的根治要求）：
 * 1. 挂载 acquire；提供者是会话级 Map，URL 一经创建就不再随组件卸载回收——
 *    彻底删除 refCount / 延迟 revoke / 竞态记账，杜绝「创建即回收」的坏图循环；
 * 2. 卸载 / 换 key 只做本地状态清理，不调用 release（提供者 API 保留兼容但为空操作）；
 *    失效通知（自愈轮）只重新 acquire，绝不 revoke 旧 URL；
 * 3. 同一持有者对同一 key 绝不并发 acquire 两次（inflightRef 去重），防止挂载解析
 *    与自愈解析竞态时对同一代条目双计 refCount（卸载后泄漏为永不清零）；
 * 4. onError 自愈：markError() → invalidate → 通知所有同 key 持有者重新解析一次；
 *    每轮失效只自动重试一次，仍失败给可读原因（不展示坏图/空白）；
 * 5. IMAGE_CONTENT_UPDATED_EVENT（图片编辑覆盖写/缩略图异步生成/视频首帧持久化）→
 *    invalidate + 重解析，所有持有者同步换新 URL；
 * 6. 刷新/HMR 后一切按 storageKey 重新解析，不恢复旧 URL（旧 blob: 必然失效）。
 * 云键（resources/ 前缀）不适用本 hook（走后端认证链 useAuthResourceUrl）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acquireMediaObjectUrl,
  IMAGE_CONTENT_UPDATED_EVENT,
  invalidateMediaObjectUrl,
  subscribeMediaObjectUrl,
} from '@zeroexo/plugin-persistence';
import { resolveMediaBlobChain, type MediaKind, type MediaVariant } from '@/shared/media/resolve-media-blob.js';

export interface MediaObjectUrlState {
  /** 解析就绪的 blob URL（挂起中为 ''） */
  url: string;
  /** 命中的变体名（'orig' = 原文件本体，视频用此决定渲染 <video>） */
  origin: MediaVariant | '';
  /** 重试一次后仍失败 → true，消费方展示可读原因 */
  failed: boolean;
  reason: string;
  /** <img>/<video> onError 入口：触发一轮自愈（每轮只重试一次） */
  markError: () => void;
}

export function useMediaObjectUrl(
  storageKey: string | undefined,
  kind: MediaKind,
  variants: readonly MediaVariant[],
): MediaObjectUrlState {
  const variantKey = variants.join('>');
  const providerKey = storageKey ? `media|${kind}|${variantKey}|${storageKey}` : '';
  const [state, setState] = useState<Omit<MediaObjectUrlState, 'markError'>>({
    url: '', origin: '', failed: false, reason: '',
  });
  /** 每轮失效的自愈重试预算（换到新 URL 即恢复） */
  const healBudgetRef = useRef(1);
  /** 最新变体链（resolve 闭包读 ref，避免数组引用不稳定触发重跑） */
  const variantsRef = useRef(variants);
  variantsRef.current = variants;
  /** 本 key 是否已有未落定的 acquire（同一持有者绝不并发两次，防 refCount 双计） */
  const inflightRef = useRef(false);
  /** 本 key 是否存活（卸载/换 key 后 inflight 落定不再发布状态） */
  const aliveRef = useRef(true);
  /** 本 key 的解析入口（每次渲染刷新闭包；effect/订阅回调统一经它发起） */
  const resolveRef = useRef<() => void>(() => {});
  resolveRef.current = () => {
    if (!providerKey || !storageKey || inflightRef.current) return;
    inflightRef.current = true;
    void (async () => {
      try {
        const res = await acquireMediaObjectUrl(providerKey, async () => {
          try {
            return await resolveMediaBlobChain(storageKey, kind, variantsRef.current);
          } catch {
            return null;
          }
        });
        if (aliveRef.current) {
          if (res.ok) setState({ url: res.url, origin: res.origin as MediaVariant, failed: false, reason: '' });
          else setState({ url: '', origin: '', failed: true, reason: res.reason });
        }
      } finally {
        inflightRef.current = false;
      }
    })();
  };

  // 生命周期边界（挂载 / 卸载 / 换 key）：只重新解析；URL 由提供者会话级持有，不随卸载回收
  useEffect(() => {
    if (!providerKey || !storageKey) {
      aliveRef.current = true;
      inflightRef.current = false;
      setState({ url: '', origin: '', failed: false, reason: '' });
      return;
    }
    aliveRef.current = true;
    inflightRef.current = false; // 上一 key 的挂起标志对新 key 无意义
    healBudgetRef.current = 1;
    setState({ url: '', origin: '', failed: false, reason: '' });
    resolveRef.current();
    return () => {
      aliveRef.current = false;
      inflightRef.current = false;
    };
  }, [providerKey, storageKey]);

  // 失效通知（任一持有者 markError / 内容更新 invalidate）→ 只重新 acquire（见头部契约 2）
  useEffect(() => {
    if (!providerKey) return;
    return subscribeMediaObjectUrl(providerKey, () => resolveRef.current());
  }, [providerKey]);

  // 内容更新事件（图片覆盖写/派生图生成/视频首帧持久化）→ invalidate 让全部持有者换新
  useEffect(() => {
    if (!storageKey || !providerKey) return;
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ storageKey?: string }>).detail;
      if (detail?.storageKey === storageKey) invalidateMediaObjectUrl(providerKey);
    };
    window.addEventListener(IMAGE_CONTENT_UPDATED_EVENT, handler);
    return () => window.removeEventListener(IMAGE_CONTENT_UPDATED_EVENT, handler);
  }, [storageKey, providerKey]);

  const markError = useCallback((): void => {
    if (!providerKey) return;
    if (healBudgetRef.current <= 0) {
      setState((s) => ({ ...s, failed: true, reason: '素材加载失败（已自动重试一次仍未恢复）' }));
      return;
    }
    healBudgetRef.current -= 1;
    invalidateMediaObjectUrl(providerKey);
  }, [providerKey]);

  // 换到新 URL = 本轮自愈成功，恢复下一轮预算
  useEffect(() => {
    if (state.url) healBudgetRef.current = 1;
  }, [state.url]);

  return { ...state, markError };
}
