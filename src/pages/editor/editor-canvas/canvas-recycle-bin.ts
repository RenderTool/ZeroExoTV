/**
 * canvas-recycle-bin.ts — 画布墓碑回收站 localStorage 索引（Plan#80 Phase C）
 *
 * 职责：
 * 1. 维护 zeroeo:canvas-tombstones:<canvasId> 索引（id + title + type + deletedAt）
 * 2. 供 recycle bin UI 展示当前画布已删除但可恢复的节点
 * 3. 30 天 GC 自动清理（防 localStorage 膨胀）
 *
 * 注意：节点正文数据通过 persistence 层持久化（state.nodes 中 _deleted=true 的节点），
 * 本索引只存轻量元数据用于 UI 展示和快速定位。
 */

export interface TombstoneIndexEntry {
  id: string;
  title: string;
  type: string;
  deletedAt: number;
}

const PREFIX = 'zeroeo:canvas-tombstones:';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PER_CANVAS = 50;

function storageKey(canvasId: string): string {
  return `${PREFIX}${canvasId}`;
}

/** 读取当前画墓碑索引（已做 GC 清理） */
export function readTombstoneIndex(canvasId: string): TombstoneIndexEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(canvasId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TombstoneIndexEntry[];
    if (!Array.isArray(parsed)) return [];
    // GC: 超过 30 天的条目自动清理
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const alive = parsed.filter((e) => e.deletedAt >= cutoff).slice(0, MAX_PER_CANVAS);
    // 有清理时回写
    if (alive.length !== parsed.length) {
      localStorage.setItem(storageKey(canvasId), JSON.stringify(alive));
    }
    return alive;
  } catch {
    return [];
  }
}

/** 追加墓碑节点到索引 */
export function appendTombstone(canvasId: string, entry: TombstoneIndexEntry): void {
  const list = readTombstoneIndex(canvasId);
  // 去重（同一节点可能被多次删除/撤销重复写入）
  const filtered = list.filter((e) => e.id !== entry.id);
  filtered.unshift(entry); // 新删除放前面
  const trimmed = filtered.slice(0, MAX_PER_CANVAS);
  localStorage.setItem(storageKey(canvasId), JSON.stringify(trimmed));
}

/** 从索引移除墓碑节点（撤销恢复 or 物理清除后） */
export function removeTombstone(canvasId: string, nodeId: string): void {
  const list = readTombstoneIndex(canvasId);
  const filtered = list.filter((e) => e.id !== nodeId);
  if (filtered.length !== list.length) {
    localStorage.setItem(storageKey(canvasId), JSON.stringify(filtered));
  }
}

/** 批量物理清除后清空索引 */
export function clearTombstoneIndex(canvasId: string): void {
  localStorage.removeItem(storageKey(canvasId));
}

/** 按 id 查找墓碑元数据（用于恢复时取标题/类型） */
export function findTombstone(canvasId: string, nodeId: string): TombstoneIndexEntry | undefined {
  return readTombstoneIndex(canvasId).find((e) => e.id === nodeId);
}
