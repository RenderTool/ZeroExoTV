/**
 * 本地目录存储层（Plan#83 D1/D2）
 *
 * 权威数据 = 用户在「设置」里授权的本地目录；IndexedDB 只存**目录句柄**与派生缓存，
 * 任何业务内容都不落浏览器。外部工具（MCP）直接读写同一目录，因此本模块必须：
 * 1) 全量原子替换（createWritable 一次性 close），不留半文件；
 * 2) 写前用 size + lastModified 做乐观锁，冲突时抛 ConflictError 由 UI 决策。
 *
 * 数据同源（2026-11-05）：若本地 HTTP 实体服务在线（http-fs 探测成功），
 * 所有读写分派到该服务（权威数据 = 服务端数据根磁盘），不再依赖
 * File System Access 授权；离线时走原授权路径，二者互斥、不产生双写。
 */

import { httpFs, httpFsReady, switchHttpFsRoot } from './http-fs.js';

const DB_NAME = 'zeroexo-local';
const DB_STORE = 'handles';
const ROOT_KEY = 'dataRoot';
/** 用户填写的数据根绝对路径（FSA 拿不到绝对路径，由设置面板登记一次） */
const ROOT_PATH_HINT_KEY = 'rootPathHint';

export class ConflictError extends Error {
  constructor(public readonly path: string, public readonly current: { size: number; lastModified: number }) {
    super(`CONFLICT: ${path} 已被外部修改`);
    this.name = 'ConflictError';
  }
}

export class NotAuthorizedError extends Error {
  constructor() {
    super('NOT_AUTHORIZED: 尚未授权本地数据目录');
    this.name = 'NotAuthorizedError';
  }
}

// ===== IndexedDB：只放句柄 =====

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: unknown, key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const out = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const g = tx.objectStore(DB_STORE).get(key);
    g.onsuccess = () => resolve((g.result as T) ?? null);
    g.onerror = () => reject(g.error);
  });
  db.close();
  return out;
}

// ===== 授权与句柄 =====

type DirHandle = FileSystemDirectoryHandle;
type PermState = 'granted' | 'denied' | 'prompt';

async function probe(handle: DirHandle, mode: 'read' | 'readwrite'): Promise<PermState> {
  const q = handle as unknown as { queryPermission?: (o: { mode: string }) => Promise<PermState> };
  if (q.queryPermission) return q.queryPermission({ mode });
  return 'prompt';
}

async function ensure(handle: DirHandle, mode: 'read' | 'readwrite', ask: boolean): Promise<boolean> {
  if ((await probe(handle, mode)) === 'granted') return true;
  if (!ask) return false;
  const r = handle as unknown as { requestPermission?: (o: { mode: string }) => Promise<PermState> };
  if (!r?.requestPermission) return false;
  return (await r.requestPermission({ mode })) === 'granted';
}

let root: DirHandle | null = null;
let rootAsking = false;

/** 测试注入点：直接指定根句柄（生产代码禁用）。注入后 isAuthorized 直接生效。 */
export function setRootHandleForTest(handle: DirHandle | null): void {
  root = handle;
}

/** 用户手动选择目录（必须由点击等用户手势触发） */
export async function pickRoot(suggestPath?: string): Promise<string> {
  // 不能先 await 任何探测：httpFsReady 慢/失败会吃掉用户手势，
  // showDirectoryPicker 随后抛 SecurityError，表现为“点选择文件夹没反应、一直停在选择目录页”。
  // 目录选择本身只依赖浏览器 FSA，不需要等本地数据服务。
  // startIn 只接受两种形状：WellKnownDirectory 字符串枚举，或 { mode: 'path', path }
  // 传对象字面量（如 { id: 'documents' }）会直接抛 TypeError
  type PickerOptions = { id?: string; mode?: 'read' | 'readwrite'; startIn?: string | { mode: 'path'; path: string | string[] } };
  const picker = (window as unknown as { showDirectoryPicker?: (o: PickerOptions) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持 File System Access API（请用 Chromium 内核浏览器）');
  const options: PickerOptions = { id: 'zeroexo-data', mode: 'readwrite' };
  if (suggestPath) options.startIn = { mode: 'path', path: suggestPath };
  else options.startIn = 'documents';
  const h = await picker.call(window, options);
  root = h;
  await idbPut(h, ROOT_KEY);
  return h.name;
}

/** 页面启动时恢复授权；ask=true 时可在一次用户手势内请求补授权（HTTP 模式恒可用） */
export async function restoreRoot(ask = false): Promise<string | null> {
  if (httpFs.online) return httpFs.info?.rootName ?? null;
  if (root && (await ensure(root, 'readwrite', ask))) return root.name;
  const saved = await idbGet<DirHandle>(ROOT_KEY);
  if (!saved) return null;
  if (!(await ensure(saved, 'readwrite', ask))) return null;
  root = saved;
  return root.name;
}

const SAVED_DATA_ROOT_KEY = 'zeroexo.dataRootPath';

/** 当前数据目录的绝对路径（本地服务模式才有；浏览器目录模式没有绝对路径） */
export function currentDataRootPath(): string | null {
  return httpFs.online ? (httpFs.info?.dataRoot ?? null) : null;
}

/**
 * 切换数据目录（2026-11-11 用户要求）：本地服务模式走 POST /root，网页与 MCP 同时生效；
 * 记到 localStorage，下次打开页面由 applySavedDataRoot 自动重新应用。
 */
export async function switchDataRoot(next: string): Promise<string> {
  await httpFsReady;
  if (!httpFs.online) {
    throw new Error('当前未连接本地数据服务：请先用「选择目录」授权一个浏览器目录');
  }
  const info = await switchHttpFsRoot(next);
  try { localStorage.setItem(SAVED_DATA_ROOT_KEY, info.dataRoot); } catch { /* 隐私模式忽略 */ }
  return info.dataRoot;
}

/** 启动时把上次切换的目录重新应用到本地服务（服务重启后仍生效） */
export async function applySavedDataRoot(): Promise<void> {
  await httpFsReady;
  if (!httpFs.online) return;
  let saved: string | null = null;
  try { saved = localStorage.getItem(SAVED_DATA_ROOT_KEY); } catch { return; }
  if (!saved || saved === httpFs.info?.dataRoot) return;
  try { await switchHttpFsRoot(saved); } catch { /* 目录可能已不可用：保持当前根 */ }
}


export function rootName(): string | null {
  if (httpFs.online) return httpFs.info?.rootName ?? null;
  return root?.name ?? null;
}

/**
 * 登记数据根的绝对路径（用户在设置里填一次）。
 * FSA 句柄只有目录名没有绝对路径；MCP stdio 服务的 ZEROEXO_DATA_ROOT
 * 需要真实绝对路径，故由用户显式提供，存 IndexedDB handles store。
 */
export async function setRootPathHint(path: string): Promise<void> {
  await idbPut(path, ROOT_PATH_HINT_KEY);
}

/** 读取用户登记的数据根绝对路径；未填过返回 null */
export async function getRootPathHint(): Promise<string | null> {
  return idbGet<string>(ROOT_PATH_HINT_KEY);
}

/** 是否已拿到可读写的存储（HTTP 实体服务在线 或 目录授权有效） */
export async function isAuthorized(): Promise<boolean> {
  // 必须等启动期探测落定：否则 FS_DRIVER 的 _initStorage 会在 httpFs 上线前判「未授权」，
  // localforage 实例一旦降级到 IndexedDB 就永久粘滞（cas: 键再也读不到磁盘文件）。
  await httpFsReady;
  if (httpFs.online) return true;
  if (root) return (await probe(root, 'readwrite')) === 'granted';
  const saved = await idbGet<DirHandle>(ROOT_KEY);
  if (!saved) return false;
  if ((await probe(saved, 'readwrite')) !== 'granted') return false;
  root = saved;
  return true;
}

export async function getRoot(): Promise<DirHandle> {
  if (!root) {
    const restored = await restoreRoot(rootAsking);
    if (!restored) throw new NotAuthorizedError();
  }
  return root!;
}

/** 授权类操作默认允许弹一次原生请求（由按钮点击驱动时安全） */
export function withPermissionPrompt<T>(fn: () => Promise<T>): Promise<T> {
  rootAsking = true;
  return fn().finally(() => {
    rootAsking = false;
  });
}

// ===== 路径与读写 =====

async function walk(path: string, create: boolean): Promise<DirHandle> {
  const parts = path.split('/').filter(Boolean);
  let dir = await getRoot();
  for (const p of parts) {
    dir = await dir.getDirectoryHandle(p, { create });
  }
  return dir;
}

/** 只解析已存在的目录；缺失时返回 null（读场景不建目录） */
async function walkExisting(path: string): Promise<DirHandle | null> {
  const parts = path.split('/').filter(Boolean);
  let dir = await getRoot();
  for (const p of parts) {
    try {
      dir = await dir.getDirectoryHandle(p);
    } catch {
      return null;
    }
  }
  return dir;
}

async function fileAt(path: string): Promise<FileSystemFileHandle | null> {
  const i = path.lastIndexOf('/');
  const dir = i < 0 ? await getRoot() : await walkExisting(path.slice(0, i));
  if (!dir) return null;
  try {
    return await dir.getFileHandle(path.slice(i + 1));
  } catch {
    return null;
  }
}

export async function ensureDir(path: string): Promise<void> {
  if (httpFs.online) return httpFs.ensureDir(path);
  await walk(path, true);
}

export async function writeFile(path: string, data: string | Blob): Promise<void> {
  if (httpFs.online) {
    if (typeof data !== 'string') data = await data.text();
    await httpFs.writeFile(path, data);
  } else {
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? await getRoot() : await walk(path.slice(0, i), true);
    const name = path.slice(i + 1);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await (fh as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
    await w.write(data as string);
    await w.close(); // 关闭即提交，中途异常不会留下半文件
  }
  // 自己写文件后刷新 watcher 指纹基线，避免把自己写的误判为外部变更（导演台改时间整页刷新 BUG）
  void import('./watcher.js').then((m) => m.touchBaseline(path)).catch(() => undefined);
}

export async function readFile(path: string): Promise<string | null> {
  if (httpFs.online) return httpFs.readFile(path);
  const fh = await fileAt(path);
  if (!fh) return null;
  const f = await fh.getFile();
  return f.text();
}

export async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2));
}

/** 乐观锁写：expected 为上次读到的 size/lastModified；外部改过则抛 ConflictError */
export async function writeJsonIfUnchanged(path: string, value: unknown, expected: { size: number; lastModified: number } | null): Promise<void> {
  if (expected) {
    const now = await stat(path);
    if (now && (now.size !== expected.size || now.lastModified !== expected.lastModified)) throw new ConflictError(path, now);
  }
  await writeJson(path, value);
}

export async function stat(path: string): Promise<{ size: number; lastModified: number } | null> {
  if (httpFs.online) return httpFs.stat(path);
  const fh = await fileAt(path);
  if (!fh) return null;
  const f = await fh.getFile();
  return { size: f.size, lastModified: f.lastModified };
}

export async function remove(path: string): Promise<void> {
  if (httpFs.online) return httpFs.remove(path);
  const i = path.lastIndexOf('/');
  const dir = i < 0 ? await getRoot() : await walkExisting(path.slice(0, i));
  if (!dir) return;
  try {
    await dir.removeEntry(path.slice(i + 1));
  } catch {
    /* 不存在即忽略 */
  }
}

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
}

export async function listDir(path: string): Promise<DirEntry[]> {
  if (httpFs.online) return httpFs.listDir(path);
  const dir = await walkExisting(path);
  if (!dir) return [];
  const out: DirEntry[] = [];
  const entries = (dir as unknown as { values: () => AsyncIterable<{ name: string; kind: 'file' | 'directory' }> }).values();
  for await (const e of entries) out.push({ name: e.name, kind: e.kind === 'directory' ? 'dir' : 'file' });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 外部改动探针（MCP 写盘后轮询兜底用） */
export async function fingerprint(path: string): Promise<string> {
  const s = await stat(path);
  return s ? `${s.size}:${s.lastModified}` : 'absent';
}

// ===== 二进制与批量 stat（媒体层 platform/media.ts 依赖）=====

export interface FileStat {
  path: string;
  size: number;
  lastModified: number;
}

/** 二进制落盘（同样走 HTTP 服务或 createWritable 全量提交，不留半文件） */
export async function writeFileBlob(path: string, data: Uint8Array, mimeType = 'application/octet-stream'): Promise<void> {
  if (httpFs.online) return httpFs.writeFileBlob(path, data, mimeType);
  const i = path.lastIndexOf('/');
  const dir = i < 0 ? await getRoot() : await walk(path.slice(0, i), true);
  const fh = await dir.getFileHandle(path.slice(i + 1), { create: true });
  const w = await (fh as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
  await w.write(new Blob([data as unknown as BlobPart], { type: mimeType === 'application/octet-stream' ? '' : mimeType }));
  await w.close();
}

/** 读为 Blob（objectURL 用）；不存在返回 null */
export async function readFileHandle(path: string): Promise<Blob | null> {
  if (httpFs.online) return httpFs.readBlob(path);
  const fh = await fileAt(path);
  if (!fh) return null;
  return fh.getFile();
}

/** 删文件（不存在静默） */
export async function removeFile(path: string): Promise<void> {
  await remove(path);
}

/** 批量取一个目录直属文件的 stat（递归由调用方按目录层次组织，避免深目录卡顿） */
export async function statMany(dirPath: string): Promise<FileStat[]> {
  if (httpFs.online) return httpFs.statMany(dirPath);
  const dir = await walkExisting(dirPath);
  if (!dir) return [];
  const out: FileStat[] = [];
  const entries = (dir as unknown as { values: () => AsyncIterable<{ name: string; kind: 'file' | 'directory' }> }).values();
  for await (const e of entries) {
    if (e.kind !== 'file') continue;
    const f = await (e as unknown as { getFile: () => Promise<File> }).getFile();
    out.push({ path: `${dirPath}/${e.name}`, size: f.size, lastModified: f.lastModified });
  }
  return out;
}

// ===== 磁盘驱动所需的底层能力（raw 读写 + 递归遍历 + key→路径约定）=====

/**
 * storageKey → 目录内可读相对路径；不可映射返回 null（调用方落到 `.lf/` 内部区）。
 * 这是目录契约的一部分，外部工具（MCP）按同一规则解读。
 *
 * 注意：媒体（image:/video:/audio:）**不在此映射**——它们由 platform/media.ts 显式写到
 * `assets/<项目>/<类型>/` 原始文件，不经 localforage；否则会把无目录前缀的旧 key 写到根目录。
 */
export function pathForStorageKey(key: string): string | null {
  const i = key.indexOf(':');
  if (i < 0) return null;
  const kind = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (!rest) return null;
  // id 必须是单段安全名字（不含 / 与 ..），否则不映射，避免写出预期外的目录
  const safeId = !rest.includes('/') && !rest.includes('..') && !rest.includes('\\');
  if (!safeId) return null;
  if (kind === 'graph') return `projects/${rest}/project.json`;
  if (kind === 'project') return `projects/${rest.split('::')[0]}/meta.json`;
  // CAS 只读穿透（2026-11-04）：cas:<sha256>.<ext> → media/cas/<sha256>.<ext>
  // 仅驱动 readEntry 使用；写入由 entities/cas-store 单点负责（驱动侧 setItem 对 cas: 键拒绝）
  if (kind === 'cas' && /^[0-9a-f]{64}\.[a-z0-9]+$/.test(rest)) return `media/cas/${rest}`;
  return null;
}

/** 递归列出目录下的文件相对路径（深度限制 6，避免异常结构卡住） */
export async function walkFiles(dirPath: string, depth = 6): Promise<string[]> {
  if (httpFs.online) return httpFs.walkFiles(dirPath);
  if (depth <= 0) return [];
  const dir = await walkExisting(dirPath);
  if (!dir) return [];
  const out: string[] = [];
  const entries = (dir as unknown as { values: () => AsyncIterable<{ name: string; kind: 'file' | 'directory' }> }).values();
  for await (const e of entries) {
    if (e.kind === 'file') out.push(`${dirPath}/${e.name}`);
    else out.push(...(await walkFiles(`${dirPath}/${e.name}`, depth - 1)));
  }
  return out;
}

/** 写文本/JSON（与 writeFile 同语义，驱动侧语义化名字） */
export async function writeRaw(path: string, text: string, _mime = 'application/json'): Promise<void> {
  await writeFile(path, text);
}

/** 读文本；不存在返回 null */
export async function readRaw(path: string): Promise<string | null> {
  return readFile(path);
}

/** 删文件（不存在静默） */
export async function removeRaw(path: string): Promise<void> {
  await remove(path);
}
