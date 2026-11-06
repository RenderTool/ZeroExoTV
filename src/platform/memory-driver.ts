/**
 * localforage 内存驱动（最后一级兜底，2026-11-05 存储白屏修复）
 *
 * 为什么：磁盘驱动未授权、IndexedDB/localStorage 又被浏览器策略禁用时，
 * localforage 会抛「No available storage method found.」并把异常抛成
 * 未捕获 promise，整个应用白屏。本驱动保证驱动链最后一级必然成功，
 * 界面至少能开（数据不持久化，由 boot 层的临时存储横幅明确标注）。
 *
 * 契约与 disk-driver 相同（localforage 内部驱动接口）：
 *   _initStorage(options) → 把桶信息存进 this._dbInfo
 *   getItem/setItem/removeItem/iterate/clear/length/key/keys/dropInstance
 */

import localforage from 'localforage';

export const MEMORY_DRIVER = 'zeroexoMemoryDriver';

type Cb = ((...args: unknown[]) => unknown) | undefined;
interface InstanceLike { _dbInfo?: { name?: string; storeName?: string } }

/** bucket → Map<key, value>；进程生命周期内有效，刷新即丢（这正是要向用户标注的语义） */
const stores = new Map<string, Map<string, unknown>>();

function bucketOf(this: InstanceLike): string {
  const info = this._dbInfo ?? {};
  return `${info.name ?? 'zeroexo'}/${info.storeName ?? 'default'}`;
}

function bucketMap(this: InstanceLike): Map<string, unknown> {
  const key = bucketOf.call(this);
  let m = stores.get(key);
  if (!m) {
    m = new Map();
    stores.set(key, m);
  }
  return m;
}

/** localforage 约定：成功 cb(null, result)，失败 cb(err) */
function settle<T>(promise: Promise<T>, callback: Cb): Promise<T> {
  promise.then((value) => callback?.(null, value)).catch((err) => callback?.(err));
  return promise;
}

export const memoryDriver = {
  _driver: MEMORY_DRIVER,
  version: 1,

  /** 内存驱动永不失败：这是驱动链的最后一级，init 必须成功 */
  _initStorage(this: InstanceLike, options?: { name?: string; storeName?: string }): Promise<void> {
    this._dbInfo = { name: options?.name ?? 'zeroexo', storeName: options?.storeName ?? 'default' };
    return Promise.resolve();
  },

  getItem<T>(this: InstanceLike, key: string, callback?: Cb): Promise<T | null> {
    return settle(Promise.resolve((bucketMap.call(this).get(key) as T | undefined) ?? null), callback);
  },

  setItem<T>(this: InstanceLike, key: string, value: T, callback?: Cb): Promise<T> {
    const p = Promise.resolve(bucketMap.call(this).set(key, value)).then(() => value);
    return settle(p, callback);
  },

  removeItem(this: InstanceLike, key: string, callback?: Cb): Promise<void> {
    return settle(Promise.resolve(bucketMap.call(this).delete(key)).then(() => undefined), callback);
  },

  clear(this: InstanceLike, callback?: Cb): Promise<void> {
    return settle(Promise.resolve(bucketMap.call(this).clear()), callback);
  },

  length(this: InstanceLike, callback?: Cb): Promise<number> {
    return settle(Promise.resolve(bucketMap.call(this).size), callback);
  },

  key(this: InstanceLike, n: number, callback?: Cb): Promise<string | null> {
    return settle(Promise.resolve([...bucketMap.call(this).keys()][n] ?? null), callback);
  },

  // defineDriver 的合规检查要求 keys 存在（只有 dropInstance 可选）
  keys(this: InstanceLike, callback?: Cb): Promise<string[]> {
    return settle(Promise.resolve([...bucketMap.call(this).keys()]), callback);
  },

  dropInstance(this: InstanceLike, callback?: Cb): Promise<void> {
    return settle(Promise.resolve(stores.delete(bucketOf.call(this))).then(() => undefined), callback);
  },

  iterate<T>(this: InstanceLike, iteratorCallback: (value: T, key: string, n: number) => unknown, callback?: Cb): Promise<void> {
    return settle((async () => {
      let count = 0;
      for (const [key, value] of bucketMap.call(this)) {
        count += 1;
        if (iteratorCallback(value as T, key, count) === false) return;
      }
    })(), callback);
  },
};

/** 必须在任何 localforage 实例创建之前调用（见 platform/boot.ts） */
export function registerMemoryDriver(): Promise<void> {
  return localforage.defineDriver(memoryDriver as unknown as Parameters<typeof localforage.defineDriver>[0]).then(() => undefined);
}
