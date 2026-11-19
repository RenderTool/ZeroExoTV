/**
 * 本地 HTTP 实体服务客户端（dev 手动旁路，配套 mcp-server `--fs-server`）
 *
 * 2026-11-05 修复：vite dev/preview 启动时会自动拉起 8790 fs-server（见 vite.config.ts），
 * 因此 boot.ts 必须在启动时主动探测一次并接管读写，否则驱动链会静默降级到 IndexedDB，
 * 造成「记录不落盘 + cas: 键读不到真实文件 → 全站图片空白」。探测失败则保持
 * File System Access 目录授权路径，离线仍可用。
 *
 * 失败语义：不静默回退。fetch 失败直接抛错（带可读提示），由上层 UI 呈现。
 * 端口可配：localStorage['zeroexo.httpFsBase']（完整 base URL），默认 http://127.0.0.1:8790。
 */

import type { DirEntry, FileStat } from './fs';

export interface HttpFsInfo {
  baseUrl: string;
  dataRoot: string;
  rootName: string;
}

const LS_KEY = 'zeroexo.httpFsBase';
/** 探测超时：fs-server 为本地 Node 进程，冷启动竞态时 600ms 偶发不够，放宽到 1500ms */
const PROBE_TIMEOUT_MS = 1500;

function baseUrl(): string {
  const saved = (localStorage.getItem(LS_KEY) ?? '').trim();
  // 防御：localStorage 残留空串/无效值时回退默认端口，不许 fetch 到错误地址
  if (saved && /^https?:\/\//.test(saved)) return saved.replace(/\/+$/, '');
  if (saved) console.warn('[http-fs] localStorage 残留无效 httpFsBase，已回退默认端口:', saved);
  return 'http://127.0.0.1:8790';
}

let info: HttpFsInfo | null = null;
/** 本会话是否成功连过本地数据服务（离线判定用：连过 = 数据权威本来在服务端，不是目录没授权） */
let everOnline = false;

/**
 * 数据权威来源（2026-11-18 授权弹框修复）：区分「服务端数据根」与「浏览器目录授权」。
 * 两者互斥，刷新后仍需知道自己属于哪一路——服务离线不能被当成目录未授权去弹选目录框。
 */
const ORIGIN_KEY = 'zeroexo.dataRootOrigin';
export type DataRootOrigin = 'service' | 'browser';

export function markDataRootOrigin(origin: DataRootOrigin): void {
  try { localStorage.setItem(ORIGIN_KEY, origin); } catch { /* 隐私模式忽略 */ }
}

export function dataRootOrigin(): DataRootOrigin | null {
  try {
    const v = localStorage.getItem(ORIGIN_KEY);
    return v === 'service' || v === 'browser' ? v : null;
  } catch {
    return null;
  }
}

/** 本会话连过服务，或上次就是服务模式 → 数据权威在服务端；离线时不许弹目录授权 */
export function dataRootExpectsService(): boolean {
  if (everOnline || dataRootOrigin() === 'service') return true;
  try {
    // 存量安装：换过数据根 / 配过 httpFsBase 的用户，数据本来就在服务端数据根里
    return Boolean(
      (localStorage.getItem('zeroexo.dataRootPath') ?? '').trim()
      || (localStorage.getItem('zeroexo.httpFsBase') ?? '').trim(),
    );
  } catch {
    return false;
  }
}

/**
 * 启动期探测（模块加载即发起，不等 bootReady 的 async 链）。
 * 所有依赖方（尤其 isAuthorized / FS_DRIVER 的 _initStorage）必须 await 它：
 * 否则 localforage 实例会在探测落定前 init，判定「未授权」后永久粘滞到 IndexedDB，
 * 之后 cas: 键再也不会读 media/cas 真实文件（表现为图片全空白）。
 */
export const httpFsReady: Promise<HttpFsInfo | null> = probeOnce().catch(() => null);

export function httpFsOnline(): boolean {
  return info !== null;
}

export function httpFsInfo(): HttpFsInfo | null {
  return info;
}

/**
 * 运行期发现本地数据服务已经掉线（例如用户中途关掉了 MCP / fs-server）：
 * 立即清掉 online 标记，后续读写回落到 FSA 目录，而不是继续拿旧 baseUrl 发请求把
 * 所有素材都判成「读取失败」。启动期探测在下次刷新时仍会重新建立。
 */
export function markHttpFsOffline(): void {
  if (!info) return;
  console.warn(`[http-fs] 运行期服务已掉线，回落到目录授权（base=${info.baseUrl}）`);
  info = null;
}

/** 探测（默认两次：首次失败多为冷启动竞态，1.5s 后重试一次）。离线返回 null，不抛错。
 *  boot 启动链传 `{ retry: false }` 只探一次，避免离线时阻塞首屏渲染。 */
export async function probeHttpFs(opts?: { retry?: boolean }): Promise<HttpFsInfo | null> {
  const first = await httpFsReady;
  if (first || opts?.retry === false) return first;
  const base = baseUrl();
  console.warn(`[http-fs] 首次探测失败（base=${base}），1.5s 后重试一次…`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return probeOnce();
}

/**
 * dev 手动旁路入口（控制台调用）：探测并接管 fs.ts 读写。
 * 成功后建议 window.location.reload() 让已 init 的 localforage 实例重新绑驱动。
 * 用户流程中不可达——主存储恒为 FSA 目录句柄。
 */
export async function enableHttpFsForDev(): Promise<HttpFsInfo | null> {
  const info = await probeHttpFs();
  if (info) {
    console.info('[http-fs] dev 旁路已启用，建议刷新页面使全部实例重新绑驱动');
  } else {
    console.warn('[http-fs] dev 旁路未启用：fs-server 不在线（保持 FSA 目录存储）');
  }
  return info;
}

async function probeOnce(): Promise<HttpFsInfo | null> {
  const base = baseUrl();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    // 2026-11-19：线上页面（https）访问 127.0.0.1 属 Private Network Access，浏览器会缓存失败的
    // 预检结果，短期内重试仍失败。带一个时间戳参数让每次探测都是新请求，服务恢复后能立刻连上。
    const res = await fetch(`${base}/health?t=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; dataRoot?: string; rootName?: string };
    if (!body.ok) return null;
    info = { baseUrl: base, dataRoot: body.dataRoot ?? '', rootName: body.rootName ?? '本地数据服务' };
    everOnline = true;
    markDataRootOrigin('service');
    console.info(`[http-fs] 在线，数据根 = ${info.dataRoot}（${base}）`);
    return info;
  } catch (e) {
    // 诊断纪律（C3）：降级原因必须留在控制台（含实际 base 与错误），不许静默
    console.warn(
      `[http-fs] 本地数据服务探测失败 base=${base}:`,
      e instanceof Error ? `${e.name}: ${e.message}` : e,
    );
    return null;
  }
}

/**
 * 切换本地数据服务的根目录（2026-11-11 用户要求：网页里换目录必须真的生效）。
 * 服务端 POST /root 会校验绝对路径、建目录，并让网页与 MCP 工具同时改用新根。
 */
export async function switchHttpFsRoot(next: string): Promise<HttpFsInfo> {
  if (!info) throw new Error('本地数据服务不在线：无法切换数据目录');
  const res = await fetch(`${info.baseUrl}/root`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: next }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; dataRoot?: string; rootName?: string; message?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.message ?? `切换失败（HTTP ${res.status}）`);
  info = { ...info, dataRoot: body.dataRoot ?? '', rootName: body.rootName ?? '本地数据服务' };
  return info;
}

export interface PickedDataRoot {
  path: string;
  rootName: string;
  projects: number;
  assets: number;
}

/**
 * 目录选择（2026-11-17 用户要求）：选目录用**浏览器自带的资源管理器风格选择框**，
 * 它由浏览器弹出，一定在页面之上。浏览器拿不到绝对路径，所以页面先在选中的目录里写一个
 * 一次性探针文件，服务端据此反查绝对路径（同名目录靠探针内容区分）。
 */
export async function locateHttpFsRoot(name: string, token: string): Promise<string> {
  if (!info) throw new Error('本地数据服务不在线：无法定位数据目录');
  const res = await fetch(`${info.baseUrl}/root/locate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, token }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; path?: string; message?: string } | null;
  if (!res.ok || !body) throw new Error(body?.message ?? `定位数据目录失败（HTTP ${res.status}）`);
  if (!body.ok || !body.path) throw new Error(body.message ?? '没有定位到所选目录的绝对路径');
  return body.path;
}

/** 目录统计：里面已有多少项目/资产，供「迁移还是取消」提示用 */
export async function statHttpFsRoot(dir: string): Promise<PickedDataRoot> {
  if (!info) throw new Error('本地数据服务不在线：无法校验数据目录');
  const res = await fetch(`${info.baseUrl}/root/stat?p=${encodeURIComponent(dir)}`);
  const body = (await res.json().catch(() => null)) as (PickedDataRoot & { ok?: boolean; message?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.message ?? `读取目录失败（HTTP ${res.status}）`);
  if (!body.ok) throw new Error(body.message ?? '读取目录失败');
  return { path: body.path, rootName: body.rootName, projects: body.projects, assets: body.assets };
}

/** 一键安装并启动 MCP：装到 <数据根>\.mcp-server\next，不进 C 盘，装完直接拉起服务 */
export async function installHttpMcp(downloadUrl: string): Promise<void> {
  if (!info) throw new Error('本地数据服务不在线：无法自动安装 MCP');
  const res = await fetch(`${info.baseUrl}/mcp/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadUrl }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !body) throw new Error(body?.message ?? `安装 MCP 失败（HTTP ${res.status}）`);
  if (!body.ok) throw new Error(body.message ?? '安装 MCP 失败');
}

/** 迁移数据根：旧根内容复制到新根（不覆盖已有文件），完成后切根 */
export async function migrateHttpFsRoot(from: string, to: string): Promise<HttpFsInfo> {
  if (!info) throw new Error('本地数据服务不在线：无法迁移数据目录');
  const res = await fetch(`${info.baseUrl}/root/migrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; dataRoot?: string; rootName?: string; message?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(body?.message ?? `迁移失败（HTTP ${res.status}）`);
  info = { ...info, dataRoot: body.dataRoot ?? '', rootName: body.rootName ?? '本地数据服务' };
  return info;
}

function err(path: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(`本地数据服务读写失败（${path}）：${detail}。请确认 fs-server（端口 ${baseUrl().split(':').pop()}）仍在运行。`);
}

function q(path: string): string {
  return `?p=${encodeURIComponent(path)}`;
}

async function text(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${info!.baseUrl}/file${q(path)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    throw err(path, e);
  }
}

async function blob(path: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${info!.baseUrl}/file${q(path)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (e) {
    throw err(path, e);
  }
}

async function put(path: string, body: BodyInit): Promise<void> {
  try {
    const res = await fetch(`${info!.baseUrl}/file${q(path)}`, { method: 'PUT', body });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw err(path, e);
  }
}

async function remove(path: string): Promise<void> {
  try {
    const res = await fetch(`${info!.baseUrl}/file${q(path)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw err(path, e);
  }
}

async function stat(path: string): Promise<{ size: number; lastModified: number } | null> {
  try {
    const res = await fetch(`${info!.baseUrl}/stat${q(path)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { size: number; lastModified: number };
  } catch (e) {
    throw err(path, e);
  }
}

async function listDir(path: string): Promise<DirEntry[]> {
  try {
    const res = await fetch(`${info!.baseUrl}/list${q(path)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { entries: DirEntry[] };
    return body.entries;
  } catch (e) {
    throw err(path, e);
  }
}

async function walkFiles(dirPath: string): Promise<string[]> {
  try {
    const res = await fetch(`${info!.baseUrl}/walk${q(dirPath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { files: string[] };
    return body.files;
  } catch (e) {
    throw err(dirPath, e);
  }
}

async function statMany(dirPath: string): Promise<FileStat[]> {
  try {
    const res = await fetch(`${info!.baseUrl}/statmany${q(dirPath)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { stats: FileStat[] };
    return body.stats;
  } catch (e) {
    throw err(dirPath, e);
  }
}

async function ensureDir(path: string): Promise<void> {
  try {
    const res = await fetch(`${info!.baseUrl}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw err(path, e);
  }
}

export const httpFs = {
  get online(): boolean {
    return info !== null;
  },
  get info(): HttpFsInfo | null {
    return info;
  },
  readFile: text,
  readBlob: blob,
  writeFile: (path: string, data: string) => put(path, data),
  writeFileBlob: (path: string, data: Uint8Array, mimeType: string) =>
    put(path, new Blob([data as unknown as BlobPart], { type: mimeType })),
  remove,
  stat,
  listDir,
  walkFiles,
  statMany,
  ensureDir,
};
