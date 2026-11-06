/**
 * 一次性迁移器：IndexedDB 旧数据 → 本地数据目录（Plan#83 Phase 3）
 *
 * 做法：对每个 (db name, storeName) 桶，用「强制只用 IndexedDB」的源实例读出 key 清单，
 * 再逐条写入「磁盘驱动优先」的目标实例（映射规则见 disk-driver / fs.pathForStorageKey）。
 * 迁移期间不删源数据（幂等可重跑；确认无误后由用户手动清理浏览器数据）。
 */

import localforage from 'localforage';

/** 与 boot.ts 约定的旁路标记（Symbol.for 全局注册表，两处取到同一 symbol） */
const FORCE_NO_FS = Symbol.for('zeroexo.forceNoFs');

export interface MigrateResult {
  buckets: number;
  moved: number;
  skipped: number;
  errors: string[];
}

const DETECT_BLOB_STORE = 'local-forage-detect-blob-support';

interface Bucket {
  name: string;
  storeName: string;
}

async function listIdbBuckets(): Promise<Bucket[]> {
  const dbs: IDBDatabaseInfo[] = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
  const out: Bucket[] = [];
  for (const info of dbs) {
    if (!info.name || !info.version) continue;
    const name = info.name;
    const stores = await new Promise<string[]>((resolve) => {
      const req = indexedDB.open(name, info.version);
      req.onsuccess = () => {
        const db = req.result;
        const list = Array.from(db.objectStoreNames).filter((s) => s !== DETECT_BLOB_STORE) as string[];
        db.close();
        resolve(list);
      };
      req.onerror = () => resolve([]);
      req.onupgradeneeded = () => req.result.close();
    });
    for (const storeName of stores) out.push({ name, storeName });
  }
  return out;
}

function idbOnlyInstance(b: Bucket) {
  return localforage.createInstance({
    name: b.name,
    storeName: b.storeName,
    driver: [localforage.INDEXEDDB],
    [FORCE_NO_FS]: true,
  } as unknown as Parameters<typeof localforage.createInstance>[0]);
}

function diskInstance(b: Bucket) {
  // 不指定 driver ⇒ 走 boot 注入的顺序（磁盘优先，未授权时回落 IDB）
  return localforage.createInstance({ name: b.name, storeName: b.storeName });
}

/** 浏览器里还有多少条旧数据（用于首启门提示与迁移按钮显隐） */
export async function countBrowserItems(): Promise<number> {
  const buckets = await listIdbBuckets();
  let total = 0;
  for (const b of buckets) {
    try {
      const src = idbOnlyInstance(b);
      const keys: string[] = [];
      await src.iterate((_v: unknown, key: string) => {
        keys.push(key);
      });
      total += keys.length;
    } catch {
      /* 单桶失败忽略 */
    }
  }
  return total;
}

/** 执行迁移（幂等：目标已存在同 key 时覆盖为浏览器版本，因为浏览器版本是较新的写路径产物） */
export async function migrateBrowserToDisk(onProgress?: (done: number, total: number) => void): Promise<MigrateResult> {
  const result: MigrateResult = { buckets: 0, moved: 0, skipped: 0, errors: [] };
  const buckets = await listIdbBuckets();

  const plan: { bucket: Bucket; keys: string[] }[] = [];
  for (const bucket of buckets) {
    try {
      const src = idbOnlyInstance(bucket);
      const keys: string[] = [];
      await src.iterate((_v: unknown, key: string) => {
        keys.push(key);
      });
      plan.push({ bucket, keys });
    } catch (err) {
      result.errors.push(`${bucket.name}/${bucket.storeName}: ${String(err)}`);
    }
  }

  const total = plan.reduce((n, p) => n + p.keys.length, 0);
  let done = 0;

  for (const { bucket, keys } of plan) {
    result.buckets += 1;
    if (keys.length === 0) continue;
    const src = idbOnlyInstance(bucket);
    const dst = diskInstance(bucket);
    try {
      await dst.ready();
    } catch (err) {
      result.errors.push(`目标实例不可用 ${bucket.name}/${bucket.storeName}: ${String(err)}`);
      continue;
    }
    for (const key of keys) {
      try {
        const value = await src.getItem(key);
        if (value === null || value === undefined) {
          result.skipped += 1;
          continue;
        }
        await dst.setItem(key, value);
        result.moved += 1;
      } catch (err) {
        result.errors.push(`${bucket.name}/${bucket.storeName} :: ${key}: ${String(err)}`);
      }
      done += 1;
      onProgress?.(done, total);
    }
  }

  return result;
}
