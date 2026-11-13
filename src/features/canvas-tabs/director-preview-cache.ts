import localforage from 'localforage';

/**
 * 导演台最后一帧预览缓存。
 *
 * sessionStorage 在部分浏览器/大帧下会静默 QuotaExceeded，刷新后预览就没了；
 * IndexedDB 容量与持久性都更可靠，且不与业务 localforage 实例混用。
 */
const store = localforage.createInstance({
  name: 'zeroexo-director-preview',
  storeName: 'frames',
  driver: localforage.INDEXEDDB,
});

const KEY = 'last-frame';
let pending: ReturnType<typeof setTimeout> | null = null;
let queued: unknown = null;

export function saveDirectorPreview(frame: unknown): void {
  if (!frame || typeof frame !== 'object') return;
  if (!('image' in frame) || !(frame as { image?: unknown }).image) return;
  queued = frame;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const next = queued;
    queued = null;
    if (next) void store.setItem(KEY, next).catch(() => undefined);
  }, 250);
}

export async function readDirectorPreview<T>(): Promise<T | null> {
  try {
    return await store.getItem<T>(KEY);
  } catch {
    return null;
  }
}

export function clearDirectorPreview(): void {
  if (pending) { clearTimeout(pending); pending = null; }
  queued = null;
  void store.removeItem(KEY).catch(() => undefined);
}
