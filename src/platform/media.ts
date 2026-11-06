/**
 * 媒体存储层（Plan#83 D9，机制照搬参考项目 infinite-canvas，落点改为本地目录）
 *
 * 四条约定：
 * 1. **节点只存 storageKey，不存内容**。key 形态 = `kind:相对路径`
 *    （沿用现有「按前缀分途加载」契约：image:/video:/audio: → 磁盘；resources/ → 后端已废弃）
 *    例：`image:assets/ZV-001/images/p_a1b2c3.png`
 * 2. **objectURL Map 缓存**：同一 key 只 createObjectURL 一次，删除/换图时 revoke（视频大文件必撞的泄漏点）
 * 3. **孤儿回收**：存盘时递归扫全图收集在用 key，删掉 assets 目录里不在用集合的文件
 *    （对应我们旧坑「删除节点后资产残留」）
 * 4. **配额监测**：目录字节统计 + `navigator.storage.estimate()`（浏览器侧缓存占用）
 */

import { listDir, readFileHandle, removeFile, statMany, writeFileBlob, type FileStat } from './fs.js';

export type MediaKind = 'image' | 'video' | 'audio';

const KIND_DIR: Record<MediaKind, string> = { image: 'images', video: 'videos', audio: 'audios' };

/** key → 磁盘相对路径（key 去掉 `kind:` 前缀即路径，无映射表；cas: 键映射到 media/cas/） */
export function mediaRelPath(storageKey: string): string | null {
  const i = storageKey.indexOf(':');
  if (i < 0) return null;
  const kind = storageKey.slice(0, i);
  const rest = storageKey.slice(i + 1);
  // CAS 内容寻址键（2026-11-04）：cas:<sha256>.<ext> → media/cas/<sha256>.<ext>
  if (kind === 'cas') return /^[0-9a-f]{64}\.[a-z0-9]+$/.test(rest) ? `media/cas/${rest}` : null;
  if (!(kind in KIND_DIR)) return null; // resources/ 等旧后端前缀不再支持
  return rest;
}

function nanoid(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

/**
 * 生成新的 storageKey：`kind:assets/<project>/<kindDir>/<id>.<ext>`
 * 调用方拿到 key 后必须用 putMedia(key, blob) 落盘，节点 data 只写这个 key。
 */
export function newMediaKey(kind: MediaKind, projectSlug: string, mimeType: string): { storageKey: string; relPath: string } {
  const ext = extFromMime(kind, mimeType);
  const relPath = `assets/${projectSlug}/${KIND_DIR[kind]}/${nanoid()}.${ext}`;
  return { storageKey: `${kind}:${relPath}`, relPath };
}

function extFromMime(kind: MediaKind, mime: string): string {
  const sub = (mime.split('/')[1] ?? '').toLowerCase();
  const table: Record<string, string> = {
    'image/jpeg': 'jpg', jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', svg: 'svg', avif: 'avif',
    'video/mp4': 'mp4', mpeg4: 'mp4', 'video/quicktime': 'mov', mov: 'mov', webm: 'webm', mkv: 'mkv',
    mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'audio/aac': 'aac', aac: 'aac', ogg: 'ogg', opus: 'opus', m4a: 'm4a', flac: 'flac',
  };
  return table[sub] ?? (kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3');
}

/** 落盘（原子写由 fs.writeFileBlob 保证） */
export async function putMedia(storageKey: string, data: Blob | Uint8Array | ArrayBuffer, mimeType = 'application/octet-stream'): Promise<void> {
  const rel = mediaRelPath(storageKey);
  if (!rel) throw new Error(`BAD_MEDIA_KEY: ${storageKey}`);
  const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof Uint8Array ? data : new Uint8Array(data);
  await writeFileBlob(rel, buf, mimeType || 'application/octet-stream');
}

/** 读盘为 Blob（无缓存；resolveMediaUrl 内部用） */
export async function getMediaBlob(storageKey: string): Promise<Blob | null> {
  const rel = mediaRelPath(storageKey);
  if (!rel) return null;
  return readFileHandle(rel);
}

// ===== objectURL 缓存 =====

const objectUrls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export async function resolveMediaUrl(storageKey: string | undefined, fallback = ''): Promise<string> {
  if (!storageKey) return fallback;
  const cached = objectUrls.get(storageKey);
  if (cached) return cached;
  // 并发去重：同一 key 的多次解析只读一次盘
  const inflight = pending.get(storageKey);
  if (inflight) return (await inflight) ?? fallback;
  const task = (async () => {
    const blob = await getMediaBlob(storageKey);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
  })();
  pending.set(storageKey, task);
  try {
    return (await task) ?? fallback;
  } finally {
    pending.delete(storageKey);
  }
}

export function revokeMediaUrls(keys?: Iterable<string>): void {
  const list = keys ? Array.from(keys) : Array.from(objectUrls.keys());
  for (const k of list) {
    const u = objectUrls.get(k);
    if (u) URL.revokeObjectURL(u);
    objectUrls.delete(k);
  }
}

// ===== 在用集合与孤儿回收 =====

/** 递归扫描图数据里所有 media storageKey（含 _dataRef 分片里的对象），照搬参考项目实现 */
export function collectUsedMediaKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectUsedMediaKeys(item, out);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((k === 'storageKey' || k === 'posterKey' || k === 'thumbnailKey') && typeof v === 'string' && v.includes(':')) out.add(v);
    else collectUsedMediaKeys(v, out);
  }
  return out;
}

/**
 * 删除 `<dataRoot>/assets/<project>/` 下不在 used 集合里的文件。
 * 只清媒体目录，不碰 scripts/ storyboard/ prompts/（那些是文本权威，宁可留）。
 */
export async function cleanupUnusedMedia(projectSlug: string, used: Set<string>, dryRun = false): Promise<string[]> {
  const removed: string[] = [];
  for (const dir of Object.values(KIND_DIR)) {
    const base = `assets/${projectSlug}/${dir}`;
    const entries = await listDir(base);
    for (const e of entries) {
      if (e.kind !== 'file') continue;
      const rel = `${base}/${e.name}`;
      if (used.has(`image:${rel}`) || used.has(`video:${rel}`) || used.has(`audio:${rel}`)) continue;
      removed.push(rel);
      if (!dryRun) await removeFile(rel);
    }
  }
  return removed;
}

// ===== 配额监测 =====

export interface MediaUsage {
  files: number;
  bytes: number;
  byKind: Record<MediaKind, number>;
  /** 浏览器存储配额（估算，磁盘目录不计入） */
  quota?: { usageBytes: number; quotaBytes: number };
}

export async function mediaUsage(projectSlug?: string): Promise<MediaUsage> {
  const scanTargets: string[] = [];
  if (projectSlug) {
    for (const dir of Object.values(KIND_DIR)) scanTargets.push(`assets/${projectSlug}/${dir}`);
  } else {
    const projects = await listDir('assets');
    for (const p of projects) {
      if (p.kind !== 'dir') continue;
      for (const dir of Object.values(KIND_DIR)) scanTargets.push(`assets/${p.name}/${dir}`);
    }
  }
  const stats: FileStat[] = [];
  for (const t of scanTargets) stats.push(...(await statMany(t)));
  const byKind: Record<MediaKind, number> = { image: 0, video: 0, audio: 0 };
  let bytes = 0;
  for (const s of stats) {
    bytes += s.size;
    const kind: MediaKind = s.path.includes('/videos/') ? 'video' : s.path.includes('/audios/') ? 'audio' : 'image';
    byKind[kind] += s.size;
  }
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
  return {
    files: stats.length,
    bytes,
    byKind,
    quota: estimate?.usage !== undefined || estimate?.quota !== undefined ? { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 } : undefined,
  };
}
