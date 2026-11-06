/**
 * asset-version - 素材内容版本号 + 变更通知(2026-11-04)
 *
 * 问题: 同 storageKey 覆盖写(setImageBlob,云端同步回写)后,
 * 各视图层的 URL 缓存(层级缩略图 thumbCache 等)仍持旧 blob URL,
 * 且 node.data 未变 → React 不重渲染 → 缩略图永久陈旧。
 *
 * 方案(双管):
 * 1. 版本号: 每次覆盖写 +1,视图层把版本号拼进缓存 key(旧 key 自然失效);
 * 2. 事件: 覆盖写完成后派发 IMAGE_CONTENT_UPDATED_EVENT,
 *    视图层订阅后主动重解析(即使 node.data 未变也能刷新)。
 *
 * 注意: 版本号是会话内内存状态(刷新后归零)——blob URL 本身也是会话级的,
 * 刷新后所有 URL 重新解析,无需持久化版本号。
 */

/** 素材内容变更事件名(window CustomEvent, detail: { storageKey }) */
export const IMAGE_CONTENT_UPDATED_EVENT = 'zeroexo:image-content-updated';

const versions = new Map<string, number>();

/** 读取素材当前内容版本(无记录时为 0) */
export function getImageContentVersion(storageKey?: string): number {
  if (!storageKey) return 0;
  return versions.get(storageKey) ?? 0;
}

/**
 * 内容版本 +1 并派发变更事件。
 * 由 image-storage.setImageBlob 在缩略图/预览图重建完成后调用,
 * 保证监听者重解析时新缩略图已就绪。
 */
export function bumpImageContentVersion(storageKey: string): void {
  const next = (versions.get(storageKey) ?? 0) + 1;
  versions.set(storageKey, next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(IMAGE_CONTENT_UPDATED_EVENT, { detail: { storageKey } }),
    );
  }
}
