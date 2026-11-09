/**
 * localforage 磁盘驱动（Plan#83 Phase 3 核心）
 *
 * 为什么换驱动而不是改调用点：`plugin-persistence` 与 app 层共 30+ 处通过 localforage
 * 读写（graph / 项目元数据 / 图片桶 / 媒体桶 / 文本资源）。换驱动即可把权威存储从 IndexedDB
 * 搬到用户本地目录，**引擎包与应用代码一行不改**。
 *
 * 方法签名按 localforage 内部驱动的真实契约：
 *   _initStorage(options) → 自己把桶信息存进 this._dbInfo
 *   getItem(key, cb) / setItem(key, value, cb) / removeItem(key, cb)
 *   iterate(iterator, cb) / clear(cb) / length(cb) / key(n, cb) / keys(cb) / dropInstance(cb)
 *
 * 编码格式自定义（不再依赖 localforage 未导出的内部 serializer）：
 *   可读目标（projects/<id>/project.json、meta.json）→ 直接写裸 JSON，MCP 与人都能读
 *   其余 JSON 值      → `.lf/<bucket>/<编码key>.json`，内容 `{__lf:1,value:...}`
 *   Blob/File         → `.lf/<bucket>/<编码key>.blob`，原始字节
 *
 * 未授权数据目录时 `_initStorage` reject 且**不回落 IndexedDB**（本版本不用浏览器存储）。
 */

import localforage from 'localforage';
import { ensureDir, isAuthorized, pathForStorageKey, readFile, readFileHandle, remove, walkFiles, writeFile, writeFileBlob } from './fs.js';
import { touchBaseline } from './watcher.js';

export const FS_DRIVER = 'zeroexoFsDriver';

type Cb = ((...args: unknown[]) => unknown) | undefined;
interface InstanceLike { _dbInfo?: { name?: string; storeName?: string } }

/** 首次写入某 key 时打印一次映射，便于校对目录结构 */
const logged = new Set<string>();
const mapBook = new Map<string, string>();

function bucketOf(this: InstanceLike): string {
  const info = this._dbInfo ?? {};
  return `${info.name ?? 'zeroexo'}/${info.storeName ?? 'default'}`;
}

/** 这些目标写裸 JSON（目录契约里的可读位置），其余走信封 */
function isBareTarget(rel: string): boolean {
  return rel.endsWith('/project.json') || rel.endsWith('/meta.json') || rel.endsWith('/index.json');
}

function relPathFor(this: InstanceLike, key: string): string {
  const readable = pathForStorageKey(key);
  if (readable) return readable;
  return `.lf/${bucketOf.call(this)}/${encodeURIComponent(key)}`;
}

function isBinary(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

/** localforage 约定：成功 cb(null, result)，失败 cb(err) */
function settle<T>(promise: Promise<T>, callback: Cb): Promise<T> {
  promise.then((value) => callback?.(null, value)).catch((err) => callback?.(err));
  return promise;
}

async function noteMap(bucket: string, key: string, rel: string): Promise<void> {
  if (logged.has(rel)) return;
  logged.add(rel);
  mapBook.set(`${bucket} :: ${key}`, rel);
  console.info(`[lf-disk] ${key} → ${rel}`);
  try {
    await ensureDir('.lf');
    await writeFile('.lf/_map.json', JSON.stringify(Object.fromEntries(mapBook), null, 2));
  } catch {
    /* 账本失败不影响读写 */
  }
}

/** 一个 key 可能是 .json 或 .blob，也可能被用户手动删了；cas: 键直读 media/cas 实际文件（无后缀） */
async function readEntry(rel: string, key: string): Promise<unknown> {
  if (key.startsWith('cas:')) return readFileHandle(rel); // CAS 物理文件，生命周期由 cas-store refCount 管
  const blob = await readFileHandle(`${rel}.blob`);
  if (blob) return blob;
  const text = await readFile(`${rel}.json`);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { __lf?: number; value?: unknown };
    return parsed && parsed.__lf === 1 && 'value' in parsed ? parsed.value : parsed;
  } catch {
    return null;
  }
}

async function writeEntry(rel: string, value: unknown): Promise<void> {
  if (isBinary(value)) {
    await writeFileBlob(`${rel}.blob`, new Uint8Array(await value.arrayBuffer()), value.type || 'application/octet-stream');
    touchBaseline(`${rel}.blob`);
    return;
  }
  const body = isBareTarget(rel) ? JSON.stringify(value, null, 2) : JSON.stringify({ __lf: 1, value }, null, 2);
  await writeFile(`${rel}.json`, body);
  touchBaseline(`${rel}.json`);
}

async function dropEntry(rel: string): Promise<void> {
  await remove(`${rel}.json`);
  await remove(`${rel}.blob`);
}

function keyFromFileName(fileName: string): string | null {
  if (fileName.endsWith('.json')) return decodeURIComponent(fileName.slice(0, -5));
  if (fileName.endsWith('.blob')) return decodeURIComponent(fileName.slice(0, -5));
  return null;
}

async function diskKeys(this: InstanceLike): Promise<string[]> {
  const dir = `.lf/${bucketOf.call(this)}`;
  const files = await walkFiles(dir);
  const out: string[] = [];
  for (const f of files) {
    const k = keyFromFileName(f.slice(dir.length + 1));
    if (k !== null) out.push(k);
  }
  return out;
}

export const fsDriver = {
  _driver: FS_DRIVER,
  version: 1,

  /** 未授权直接 reject，且不回落 IndexedDB —— 本版本不用浏览器存储 */
  _initStorage(this: InstanceLike, options?: { name?: string; storeName?: string }): Promise<void> {
    return isAuthorized().then((ok) => {
      if (!ok) throw new Error('zeroexo data root not authorized');
      this._dbInfo = { name: options?.name ?? 'zeroexo', storeName: options?.storeName ?? 'default' };
      return ensureDir(`.lf/${bucketOf.call(this)}`).then(() => undefined);
    });
  },

  getItem<T>(this: InstanceLike, key: string, callback?: Cb): Promise<T | null> {
    return settle(readEntry(relPathFor.call(this, key), key) as Promise<T | null>, callback);
  },

  setItem<T>(this: InstanceLike, key: string, value: T, callback?: Cb): Promise<T> {
    // CAS 单点写入纪律：cas: 键只能由 entities/cas-store 落盘，驱动拒绝覆盖（防 refCount 外绕过）
    if (key.startsWith('cas:')) {
      const err = new Error(`[lf-disk] cas: 键由 cas-store 单点写入，禁止经 localforage 覆盖: ${key}`);
      callback?.(err);
      return Promise.reject(err);
    }
    return settle((async () => {
      const rel = relPathFor.call(this, key);
      await writeEntry(rel, value);
      await noteMap(bucketOf.call(this), key, rel);
      return value;
    })(), callback);
  },

  removeItem(this: InstanceLike, key: string, callback?: Cb): Promise<void> {
    // CAS 文件生命周期由 refCount 管理：驱动层对 cas: 键的删除静默忽略（不删实体文件）
    if (key.startsWith('cas:')) {
      console.warn(`[lf-disk] cas: 键删除请求已忽略（由 cas-store.releaseCas 管理）: ${key}`);
      callback?.(null);
      return Promise.resolve();
    }
    return settle(dropEntry(relPathFor.call(this, key)), callback);
  },

  clear(this: InstanceLike, callback?: Cb): Promise<void> {
    return settle((async () => {
      const keys = await diskKeys.call(this);
      const dir = `.lf/${bucketOf.call(this)}`;
      for (const k of keys) await dropEntry(`${dir}/${encodeURIComponent(k)}`);
    })(), callback);
  },

  length(this: InstanceLike, callback?: Cb): Promise<number> {
    return settle((async () => (await diskKeys.call(this)).length)(), callback);
  },

  key(this: InstanceLike, n: number, callback?: Cb): Promise<string | null> {
    return settle((async () => ((await diskKeys.call(this))[n] ?? null))(), callback);
  },

  // defineDriver 的合规检查要求 keys 存在（只有 dropInstance 可选）
  keys(this: InstanceLike, callback?: Cb): Promise<string[]> {
    return settle(diskKeys.call(this), callback);
  },

  /** 项目级清理会调它；不实现会被 localforage 填成 reject */
  dropInstance(this: InstanceLike, callback?: Cb): Promise<void> {
    return settle((async () => {
      const dir = `.lf/${bucketOf.call(this)}`;
      const keys = await diskKeys.call(this);
      for (const k of keys) await dropEntry(`${dir}/${encodeURIComponent(k)}`);
    })(), callback);
  },

  iterate<T>(this: InstanceLike, iteratorCallback: (value: T, key: string, n: number) => unknown, callback?: Cb): Promise<void> {
    return settle((async () => {
      const dir = `.lf/${bucketOf.call(this)}`;
      const keys = await diskKeys.call(this);
      let count = 0;
      for (const key of keys) {
        const value = (await readEntry(`${dir}/${encodeURIComponent(key)}`, key)) as T;
        count += 1;
        if (iteratorCallback(value, key, count) === false) return;
      }
    })(), callback);
  },
};

/** 必须在任何 localforage 实例创建之前调用（见 platform/boot.ts） */
export function registerFsDriver(): Promise<void> {
  return localforage.defineDriver(fsDriver as unknown as Parameters<typeof localforage.defineDriver>[0]).then(() => undefined);
}
