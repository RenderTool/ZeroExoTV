/**
 * 本项目浏览器侧缓存清理（「清理浏览器缓存」按钮）
 *
 * 边界纪律（绝对不可越界）：
 * 1. 只清**本项目命名空间**的浏览器数据：localStorage 键前缀清单 + IndexedDB 库名清单；
 *    不在清单内的一律不动（不得整站清空、不碰其他应用数据）。
 * 2. **绝不碰磁盘数据**：数据根目录的文件本模块零操作，清完磁盘数据原样在。
 * 3. 清理幂等：键不存在 / 库不存在 / 无 SW 注册时静默计 0，不报错。
 * 4. `zeroexo-local`（IndexedDB 句柄库）一并清理——里面只有目录授权句柄与
 *    绝对路径登记（rootPathHint），清掉即"忘记授权"，清理后需重新选择目录。
 */

/** 将被清理的 localStorage 键前缀（本项目命名空间；zeroeo 为历史拼写，一并纳入） */
export const LOCAL_STORAGE_PREFIXES = ['zeroexo.', 'zeroexo:', 'zeroeo:', 'localforage'] as const;

/**
 * 将被删除的 IndexedDB 库名（本项目 localforage 实例名，见 platform/cover.ts、disk-driver 默认名；
 * `zeroexo-local` = platform/fs 的目录句柄库，清理后需重新选择目录）
 */
export const IDB_DATABASES = ['zeroexo', 'localforage', 'zeroexo-local'] as const;

export interface BrowserCacheCleanReport {
  /** 实际删除的 localStorage 键（供统计与核对） */
  localStorageKeys: string[];
  /** 实际删除的 IndexedDB 库名 */
  idbDatabases: string[];
  /** 实际删除的 Cache Storage 名 */
  cacheStorages: string[];
  /** 注销的 Service Worker 数（仅本 origin） */
  serviceWorkers: number;
}

function deleteIdb(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve(name);
    req.onerror = () => resolve(null); // 幂等：删不掉（被占用等）不报错，如实回报
    req.onblocked = () => resolve(null);
  });
}

/** 执行清理（幂等；返回实际删了什么）。localStorage 只删匹配前缀清单的键。 */
export async function cleanProjectBrowserCache(): Promise<BrowserCacheCleanReport> {
  // 1. localStorage：按前缀清单逐键删
  const lsKeys: string[] = [];
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key && LOCAL_STORAGE_PREFIXES.some((p) => key.startsWith(p))) {
      lsKeys.push(key);
      localStorage.removeItem(key);
    }
  }

  // 2. IndexedDB：只删清单里的库名
  const idbDeleted: string[] = [];
  for (const name of IDB_DATABASES) {
    if (await deleteIdb(name)) idbDeleted.push(name);
  }

  // 3. Cache Storage：本 origin 的缓存即本项目 dev 站点缓存
  const cacheDeleted: string[] = [];
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys()) {
      if (await caches.delete(name)) cacheDeleted.push(name);
    }
  }

  // 4. Service Worker：仅本 origin 注册
  let swCount = 0;
  if (navigator.serviceWorker) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      await reg.unregister();
      swCount += 1;
    }
  }

  return {
    localStorageKeys: lsKeys,
    idbDatabases: idbDeleted,
    cacheStorages: cacheDeleted,
    serviceWorkers: swCount,
  };
}
