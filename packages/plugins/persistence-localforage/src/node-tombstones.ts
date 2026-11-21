/**
 * 画布节点删除墓碑（2026-11-22）
 *
 * 用户报障：**删除节点后立刻刷新页面，节点又回来了**。
 *
 * 根因：图落盘是「400ms 防抖 + requestIdleCallback(最多再等 2s)」的异步写；
 * 删完立刻刷新时，待写盘的快照根本没发出去，刷新加载的还是删前那份 graph。
 *
 * 这个模块提供一条**同步**兜底：命令执行时把「从上一版里消失的节点 id」直接写进 localStorage
 * （同步、不经过 IndexedDB），load 时先把这些 id 从磁盘图里剔掉。
 * 写盘成功后再清墓碑 —— 这样「删了立刻刷新」也不会复活，同时不影响撤销（撤销会把 id 加回集合，墓碑随之清除）。
 *
 * 只存 id，不存节点正文，体积可忽略；上限 500 条，防无限增长。
 */
export const NODE_TOMBSTONE_KEY_PREFIX = 'zeroexo:node-tombstones:';
const MAX_TOMBSTONES = 500;

type TombstoneFile = { __zeroexo: 1; ids: string[] };

function storageKey(projectId?: string): string {
  return `${NODE_TOMBSTONE_KEY_PREFIX}${projectId ?? 'default'}`;
}

/** 同步读取（load 阶段用；localStorage 不可用时返回空集，不让它阻断加载） */
export function readNodeTombstones(projectId?: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as TombstoneFile;
    if (!Array.isArray(parsed?.ids)) return new Set();
    return new Set(parsed.ids.filter((x) => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** 同步写回（失败不抛：墓碑是兜底，不是主线） */
export function writeNodeTombstones(projectId: string | undefined, ids: Set<string>): void {
  try {
    if (!globalThis.localStorage) return;
    if (ids.size === 0) {
      globalThis.localStorage.removeItem(storageKey(projectId));
      return;
    }
    const kept = [...ids].slice(-MAX_TOMBSTONES);
    const payload: TombstoneFile = { __zeroexo: 1, ids: kept };
    globalThis.localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** 清空某项目的墓碑 */
export function clearNodeTombstones(projectId?: string): void {
  try {
    globalThis.localStorage?.removeItem(storageKey(projectId));
  } catch {
    /* ignore */
  }
}
