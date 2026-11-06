/**
 * 媒体文件存储分桶(Phase VI.2)
 *
 * 存储分层:
 * - storeName: 'media_files'
 * - storageKey 前缀: 'video:' / 'audio:'(由调用方传入 prefix)
 *
 * 与 image-storage 的差异:
 * - collectMediaStorageKeys 匹配任意带 ':' 的 storageKey(不限定前缀)
 *   所以 'image:' 也会被匹配
 *   → 调用方需注意:cleanupUnusedMedia 会清理 image 存储(若 graph 同时含图与视频)
 *   设计原因:视频节点也可能含 image 参考帧
 */
import localforage from 'localforage';
import { nanoid } from 'nanoid';

// ===== 类型 =====

export type UploadedFile = {
  url: string;
  storageKey: string;
  bytes: number;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

// ===== localforage 实例(独立于 image-storage 与 PersistencePlugin) =====

const store = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'media_files',
});

/** storageKey → blob URL 的内存缓存(刷新后需重建) */
const objectUrls = new Map<string, string>();

// ===== 公开 API =====

/**
 * 上传媒体文件到存储分桶
 * @param input dataUrl 字符串或 Blob
 * @param prefix 'video' | 'audio' | 'file'(默认 'file')
 * @returns UploadedFile(自动读取视频宽高/时长或音频时长)
 */
export async function uploadMediaFile(
  input: string | Blob,
  prefix = 'file',
): Promise<UploadedFile> {
  const blob = typeof input === 'string' ? await (await fetch(input)).blob() : input;
  const storageKey = `${prefix}:${nanoid()}`;
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  const meta = blob.type.startsWith('video/')
    ? await readVideoMeta(url)
    : blob.type.startsWith('audio/')
      ? await readAudioMeta(url)
      : {};
  return {
    url,
    storageKey,
    bytes: blob.size,
    mimeType: blob.type || 'application/octet-stream',
    ...meta,
  };
}

/**
 * 解析 storageKey → blob URL
 * 优先取内存缓存,缓存未命中则从 localforage 加载 Blob 并创建 URL
 */
export async function resolveMediaUrl(storageKey?: string, fallback = ''): Promise<string> {
  // 2026-11-05 防御：blob: fallback 是会话级地址，跨刷新必然失效——文件缺失时
  // 宁可返回空串让渲染层走「未就绪/失败」路径，绝不回坏地址（同 resolveImageUrl）
  const safeFallback = fallback.startsWith('blob:') ? '' : fallback;
  if (!storageKey) return safeFallback;
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  const blob = await store.getItem<Blob>(storageKey);
  if (!blob) return safeFallback;
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

/** 直接读取 Blob(不创建 URL) */
export async function getMediaBlob(storageKey: string): Promise<Blob | null> {
  return store.getItem<Blob>(storageKey);
}

/**
 * 覆盖写入 Blob(用于编辑后替换原文件)
 * @returns 新创建的 blob URL
 */
export async function setMediaBlob(storageKey: string, blob: Blob): Promise<string> {
  await store.setItem(storageKey, blob);
  const url = URL.createObjectURL(blob);
  objectUrls.set(storageKey, url);
  return url;
}

/**
 * 删除指定 storageKey 的媒体文件(同时 revoke Object URL)
 * @param keys storageKey 可迭代集合(自动去重)
 */
export async function deleteStoredMedia(keys: Iterable<string>): Promise<void> {
  await Promise.all(
    Array.from(new Set(keys)).map(async (key) => {
      const url = objectUrls.get(key);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(key);
      await store.removeItem(key);
    }),
  );
}

// ===== 文本资源(长文本工作区资源,Plan#74 Phase D:对齐视频/图片,不落资产库) =====
// 正文以 + 字符串存 'media_files' 分桶,key = 'text:<nanoid>';collectMediaStorageKeys
// 匹配任意含 ':' 的 key → 复用 cleanupUnusedMedia 自动回收,零新增分桶零 GC 改造。

export type TextResource = { storageKey: string; bytes: number };

/**
 * 上传文本资源到本地存储分桶(key = 'text:<nanoid>')
 * 对齐视频/图片:仅存工作区,不落资产库;手动"保存到素材"才由调用方生成资产。
 */
export async function uploadTextResource(content: string): Promise<TextResource> {
  const storageKey = `text:${nanoid()}`;
  await store.setItem(storageKey, content);
  return { storageKey, bytes: content.length };
}

/**
 * 解析 text storageKey → 字符串内容(空/无命中返回 '')
 */
export async function resolveTextContent(storageKey?: string): Promise<string> {
  if (!storageKey) return '';
  const value = await store.getItem<string>(storageKey);
  return typeof value === 'string' ? value : '';
}

/**
 * 覆盖写入已存在的文本资源（Plan#75 D5 编辑保存链：同 key 覆盖，storageKey 不变、引用不断）
 */
export async function saveTextResource(storageKey: string, content: string): Promise<void> {
  await store.setItem(storageKey, content);
}

/**
 * 删除文本资源(复用 deleteStoredMedia;key 不含 Object URL,行为等价 removeItem)
 */
export async function deleteTextResources(keys: Iterable<string>): Promise<void> {
  await deleteStoredMedia(keys);
}

/**
 * GC: 清理未被引用的媒体文件存储
 * @param usedData 任意包含 storageKey 字段的对象，或已收集好的 storageKey 集合
 *
 * 2026-09-06 修复:cleanupOrphanedResources 传入累积的 Set 时,collectMediaStorageKeys
 * 对 Set 递归 Object.values 会得到空集 → usedKeys 为空 → 会误删整桶媒体。现支持
 * 直接传入已收集的 Set<string> 作为 used keys,避免该隐患。
 */
export async function cleanupUnusedMedia(usedData: unknown): Promise<void> {
  const usedKeys = usedData instanceof Set ? usedData : collectMediaStorageKeys(usedData);
  const unused: string[] = [];
  await store.iterate((_value, key) => {
    if (!usedKeys.has(key)) unused.push(key);
  });
  await Promise.all(unused.map((key) => store.removeItem(key)));
}

/**
 * 递归收集对象中所有带 ':' 的 storageKey(含 'video:' / 'audio:' / 'image:')
 * @param value 任意嵌套对象/数组
 * @param keys 累积集合
 *
 * 注意: includes(':') 匹配,所以 'image:' 也会被匹配
 * 设计原因:cleanupUnusedMedia 会同时清理 image 存储(因为媒体 store 也可能存图片参考帧)
 * 若需精确区分,调用方应使用 collectImageStorageKeys
 */
export function collectMediaStorageKeys(value: unknown, keys = new Set<string>(), visited = new WeakSet<object>()): Set<string> {
  if (!value || typeof value !== 'object') return keys;
  if (visited.has(value)) return keys;
  visited.add(value);
  if (
    'storageKey' in value &&
    typeof value.storageKey === 'string' &&
    value.storageKey.includes(':')
  ) {
    keys.add(value.storageKey);
  }
  Object.values(value).forEach((item) =>
    Array.isArray(item)
      ? item.forEach((child) => collectMediaStorageKeys(child, keys, visited))
      : collectMediaStorageKeys(item, keys, visited),
  );
  return keys;
}

// ===== 内部辅助 =====

/**
 * 读取视频元信息(宽高 + 时长)
 * 通过 <video>.onloadedmetadata
 * 失败回退默认值 1280x720
 */
function readVideoMeta(url: string): Promise<{ width: number; height: number; durationMs?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const done = (): void => {
      resolve({
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : undefined,
      });
    };
    video.onloadedmetadata = done;
    video.onerror = done;
    video.src = url;
  });
}

/**
 * 读取音频元信息(时长)
 * 通过 <audio>.onloadedmetadata
 */
function readAudioMeta(url: string): Promise<{ durationMs?: number }> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const done = (): void => {
      resolve({
        durationMs: Number.isFinite(audio.duration)
          ? Math.round(audio.duration * 1000)
          : undefined,
      });
    };
    audio.onloadedmetadata = done;
    audio.onerror = done;
    audio.src = url;
  });
}
