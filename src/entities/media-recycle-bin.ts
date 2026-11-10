/**
 * media-recycle-bin — 孤立媒体回收站（2026-11-10 用户要求）
 *
 * 背景：画布 / 资产 / 历史 / 主体都不再引用的图片、视频会留在 `media/cas`，越攒越大。
 *
 * 铁律（用户拍板）：
 * - **不静默硬删**：扫描到的孤立文件先移进 `media/recycle/`，记账后保留 30 天；
 * - 只有保留期结束（`cleanupExpired`）才真正删除物理文件；
 * - 移入前记录来源、大小、时间，界面上可查看，可一键恢复或立即彻底删除；
 * - 判定「孤立」只看 CAS 索引：条目的 `refs` 为空 = 没人引用；物理文件不在索引里 = 崩溃残留。
 *   有存活引用的条目一律不动。
 */
import {
  listDir,
  readFileHandle,
  readJson,
  removeFile,
  stat,
  writeFile,
  writeJson,
} from '@/platform/fs';
import { detachEmptyCasEntry, readCasIndex } from './cas-store';

export const RECYCLE_INDEX_PATH = 'entities/media_recycle_bin.json';
export const RECYCLE_DIR = 'media/recycle';
/** 回收站保留天数（用户可查，过期才真删） */
export const RECYCLE_RETENTION_DAYS = 30;

export interface RecycleItem {
  id: string;
  /** 原始磁盘路径（恢复时写回这里） */
  originalPath: string;
  /** 回收站内的路径 */
  recycledPath: string;
  name: string;
  size: number;
  ext: string;
  /** cas-empty = 索引里 0 引用的条目；cas = 索引里根本没有的残留文件 */
  source: 'cas-empty' | 'cas';
  /** 来源线索（hash / 入索引时间），界面上用于辨认 */
  originNote?: string;
  hash?: string;
  deletedAt: string;
  expiresAt: string;
}

export interface RecycleIndex {
  schemaVersion: 1;
  items: RecycleItem[];
}

export interface SweepResult {
  moved: number;
  /** 移入失败（读不了/权限）跳过，不阻断其它文件 */
  failed: number;
  items: RecycleItem[];
}

const EMPTY_INDEX: RecycleIndex = { schemaVersion: 1, items: [] };

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function readRecycleIndex(): Promise<RecycleIndex> {
  const raw = await readJson<RecycleIndex>(RECYCLE_INDEX_PATH);
  if (!raw || !Array.isArray(raw.items)) return { ...EMPTY_INDEX, items: [] };
  return { schemaVersion: 1, items: raw.items };
}

async function writeRecycleIndex(index: RecycleIndex): Promise<void> {
  await writeJson(RECYCLE_INDEX_PATH, index);
}

export async function listRecycleItems(): Promise<RecycleItem[]> {
  const index = await readRecycleIndex();
  return index.items.slice().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** 列出 media/cas 下的物理文件（文件名 = `<hash>.<ext>`） */
async function listCasFiles(): Promise<string[]> {
  try {
    const entries = await listDir('media/cas');
    return entries.filter((e) => e.kind === 'file').map((e) => e.name);
  } catch {
    return []; // 目录不存在 = 没有孤立文件
  }
}

interface Orphan {
  /** 磁盘路径 */
  path: string;
  /** 文件名（已含扩展名） */
  name: string;
  hash?: string;
  ext: string;
  source: RecycleItem['source'];
  originNote?: string;
}

/** 扫描孤立媒体：0 引用索引条目 + 不在索引里的残留文件（只读，不动文件） */
export async function scanOrphanMedia(): Promise<Orphan[]> {
  const index = await readCasIndex();
  const out: Orphan[] = [];
  // 1) 索引条目 refs 为空（理论上 releaseCas 会直接删，崩溃/外部写入可能留下）
  for (const [hash, entry] of Object.entries(index.entries)) {
    if (entry.refs.length > 0 || entry.refCount > 0) continue;
    out.push({
      path: entry.path,
      name: entry.path.split(/[\\/]/).pop() ?? `${hash}.${entry.ext}`,
      hash,
      ext: entry.ext,
      source: 'cas-empty',
      originNote: `索引零引用 · ${entry.createdAt}`,
    });
  }
  // 2) 物理文件但索引里没有（崩溃残留 / 旧路径遗留）
  for (const name of await listCasFiles()) {
    const dot = name.lastIndexOf('.');
    const hash = dot > 0 ? name.slice(0, dot) : name;
    if (index.entries[hash]) continue;
    out.push({
      path: `media/cas/${name}`,
      name,
      hash,
      ext: dot > 0 ? name.slice(dot + 1) : 'bin',
      source: 'cas',
      originNote: '索引里没有这条记录（崩溃残留）',
    });
  }
  return out;
}

/** 把一个孤立文件移入回收站并记账（物理文件搬走，不删除） */
async function moveToRecycle(orphan: Orphan, now: Date): Promise<RecycleItem | null> {
  const id = `rc_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const blob = await readFileHandle(orphan.path);
  if (!blob || blob.size === 0) return null;
  const recycledPath = `${RECYCLE_DIR}/${id}.${orphan.ext}`;
  await writeFile(recycledPath, blob);
  await removeFile(orphan.path);
  // 索引条目（如果有）此时才摘掉；物理文件已搬走，摘索引不会产生断链读取
  if (orphan.source === 'cas-empty' && orphan.hash) {
    await detachEmptyCasEntry(orphan.hash).catch(() => null);
  }
  const deletedAt = now.toISOString();
  return {
    id,
    originalPath: orphan.path,
    recycledPath,
    name: orphan.name,
    size: blob.size,
    ext: orphan.ext,
    source: orphan.source,
    originNote: orphan.originNote,
    hash: orphan.hash,
    deletedAt,
    expiresAt: addDays(deletedAt, RECYCLE_RETENTION_DAYS),
  };
}

/**
 * 扫描并把孤立媒体移入回收站。
 * 只移动「确认没人引用」的文件；有引用的条目不动。失败的文件跳过，不阻断其它文件。
 */
export async function sweepOrphansToRecycle(now = new Date()): Promise<SweepResult> {
  const orphans = await scanOrphanMedia();
  const index = await readRecycleIndex();
  const moved: RecycleItem[] = [];
  let failed = 0;
  for (const orphan of orphans) {
    try {
      const item = await moveToRecycle(orphan, now);
      if (item) moved.push(item);
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  if (moved.length > 0) {
    await writeRecycleIndex({ schemaVersion: 1, items: [...moved, ...index.items] });
  }
  return { moved: moved.length, failed, items: moved };
}

/** 从回收站恢复（写回原路径；原路径已被占用时抛错，不覆盖） */
export async function restoreRecycleItem(id: string): Promise<void> {
  const index = await readRecycleIndex();
  const item = index.items.find((i) => i.id === id);
  if (!item) throw new Error('回收站里没有这条记录');
  const exists = await stat(item.originalPath);
  if (exists) throw new Error('原路径已有同名文件，已停止恢复（不覆盖现有文件）');
  const blob = await readFileHandle(item.recycledPath);
  if (!blob) throw new Error('回收站文件已不存在');
  await writeFile(item.originalPath, blob);
  await removeFile(item.recycledPath);
  await writeRecycleIndex({ schemaVersion: 1, items: index.items.filter((i) => i.id !== id) });
}

/** 立即彻底删除一条（不再等保留期） */
export async function purgeRecycleItem(id: string): Promise<void> {
  const index = await readRecycleIndex();
  const item = index.items.find((i) => i.id === id);
  if (!item) return;
  await removeFile(item.recycledPath).catch(() => undefined);
  await writeRecycleIndex({ schemaVersion: 1, items: index.items.filter((i) => i.id !== id) });
}

/** 清空回收站（全部彻底删除） */
export async function clearRecycleBin(): Promise<number> {
  const index = await readRecycleIndex();
  for (const item of index.items) {
    await removeFile(item.recycledPath).catch(() => undefined);
  }
  await writeRecycleIndex({ schemaVersion: 1, items: [] });
  return index.items.length;
}

/** 保留期到期清理（定时任务调用）：只删过期的，返回删掉的数量 */
export async function cleanupExpiredRecycleItems(now = new Date()): Promise<number> {
  const index = await readRecycleIndex();
  const cutoff = now.getTime();
  const expired = index.items.filter((i) => new Date(i.expiresAt).getTime() <= cutoff);
  if (expired.length === 0) return 0;
  for (const item of expired) {
    await removeFile(item.recycledPath).catch(() => undefined);
  }
  const expiredIds = new Set(expired.map((i) => i.id));
  await writeRecycleIndex({ schemaVersion: 1, items: index.items.filter((i) => !expiredIds.has(i.id)) });
  return expired.length;
}

/** 人类可读大小（界面用） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
