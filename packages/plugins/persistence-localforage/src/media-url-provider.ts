/**
 * 媒体对象 URL 提供者（2026-11-05 简化版）
 *
 * 事故背景：上一版用 refCount + 15s 延迟 revoke + invalidate 立即 revoke + onError 自愈，
 * 且存在「创建后立即 revoke 却仍把 URL 交给消费者」的竞态分支，线上出现
 * 「CREATE → REVOKE → CREATE」循环，整片图片空白（控制台 ERR_FILE_NOT_FOUND）。
 *
 * 现行契约（会话级单一所有权 + 明确 LRU 缓存；2026-11-06 征集 #186 补充）：
 * 1. key → blob URL 会话级 LRU Map；解析一次即缓存，之后所有消费者复用同一 URL；
 * 2. 提供者是唯一创建者；组件卸载绝不 revoke（避免击穿在用的 <img>）；
 *    仅当缓存超过 MAX_CACHED_URLS(512) 时，回收「无活跃订阅者」的最久未用条目；
 * 3. invalidate(key) 只丢弃缓存条目并通知持有者重新解析（生成新 URL），
 *    绝不 revoke 旧 URL——旧 URL 可能仍被某个 <img> 使用，击穿即坏图；
 * 4. release(key) 保留为空操作（历史调用点无需改动），URL 生命周期与组件挂载解耦；
 * 5. 绝不把 URL 写入持久化状态；刷新 / HMR 后按 storageKey 重新解析。
 */

export type MediaUrlOrigin = string;

export type MediaUrlResult =
  | { ok: true; url: string; origin: MediaUrlOrigin }
  | { ok: false; reason: string };

/** 变体加载器：返回 { blob, origin }，origin 标明命中的变体（消费方决定 <img>/<video>） */
export type MediaUrlLoader = () => Promise<{ blob: Blob; origin: MediaUrlOrigin } | null>;

interface Entry {
  url: string;
  origin: MediaUrlOrigin;
}

/**
 * key → 会话级 URL（LRU，Map 顺序 = 最近使用）。
 * 2026-11-06 征集 #186：明确缓存策略——会话内不随组件卸载回收（避免击穿在用的 <img>），
 * 但设上限防止长会话无限累积；仅当溢出时回收「无活跃订阅者」的最久未用条目。
 */
const entries = new Map<string, Entry>();
/** 缓存上限：覆盖 60/页 列表 + 画布节点 + 派生档组合，超出后按 LRU 回收闲置项 */
const MAX_CACHED_URLS = 512;
/** key → 加载中的 Promise（并发 acquire 去重，同一 key 只读一次存储） */
const inflight = new Map<string, Promise<{ blob: Blob; origin: MediaUrlOrigin } | null>>();
/** key → 失效通知订阅者（invalidate 后持有者重新 acquire） */
const listeners = new Map<string, Set<() => void>>();
/** 同一 microtask 轮内的重复 invalidate 合并为一轮，避免多持有者反复重读磁盘 */
const pendingInvalidations = new Set<string>();

function safeCreateObjectUrl(blob: Blob): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  // jsdom 未 mock 时兜底（仅测试环境）
  return `blob:provider-fallback:${Math.random().toString(36).slice(2)}`;
}

function safeRevokeObjectUrl(url: string): void {
  try {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  } catch {
    /* revoke 失败不影响主流程 */
  }
}

/** 溢出时按 LRU 回收闲置条目；有活跃订阅者（组件仍在显示）的条目绝不回收 */
function evictIdleUrls(): void {
  if (entries.size <= MAX_CACHED_URLS) return;
  for (const key of Array.from(entries.keys())) {
    if (entries.size <= MAX_CACHED_URLS) break;
    if (listeners.has(key)) continue;
    const entry = entries.get(key);
    if (!entry) continue;
    safeRevokeObjectUrl(entry.url);
    entries.delete(key);
  }
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of Array.from(set)) {
    try {
      cb();
    } catch {
      /* 单个订阅者异常不阻断其他自愈 */
    }
  }
}

/**
 * 获取媒体 URL（消费者挂载时调用；同一 key 多个消费者共享同一 URL）。
 * 解析失败不缓存，下次仍可重试（文件落盘后自动恢复）。
 */
export async function acquireMediaObjectUrl(key: string, load: MediaUrlLoader): Promise<MediaUrlResult> {
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing); // 命中即刷新为最近使用（LRU）
    return { ok: true, url: existing.url, origin: existing.origin };
  }

  let p = inflight.get(key);
  if (!p) {
    p = load().catch(() => null);
    inflight.set(key, p);
    void p.then(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  }
  const res = await p;

  // 等待期间已有同 key 消费者完成发布 → 直接复用
  const again = entries.get(key);
  if (again) return { ok: true, url: again.url, origin: again.origin };

  if (!res) return { ok: false, reason: '素材文件缺失或目录未授权' };

  const entry: Entry = { url: safeCreateObjectUrl(res.blob), origin: res.origin };
  entries.set(key, entry);
  evictIdleUrls();
  return { ok: true, url: entry.url, origin: entry.origin };
}

/** 释放媒体 URL：会话级缓存不随组件卸载回收，保留 API 兼容历史调用点 */
export function releaseMediaObjectUrl(_key: string): void {
  /* 空操作：URL 生命周期与组件挂载解耦，绝不中途 revoke */
}

/**
 * 标记内容已更新 / URL 已损坏：丢弃缓存并通知持有者重新解析，生成新 URL。
 * 旧 URL 不 revoke——仍可能被某个 <img> 使用，revoke 就是坏图。
 */
export function invalidateMediaObjectUrl(key: string): void {
  if (pendingInvalidations.has(key)) return;
  pendingInvalidations.add(key);
  void Promise.resolve().then(() => {
    pendingInvalidations.delete(key);
    entries.delete(key);
    notify(key);
  });
}

/** 订阅某 key 的失效通知（hook 用来重新 acquire），返回退订函数 */
export function subscribeMediaObjectUrl(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    const cur = listeners.get(key);
    if (!cur) return;
    cur.delete(cb);
    if (cur.size === 0) listeners.delete(key);
  };
}

/** 测试专用：重置全部状态（唯一允许 revoke 的入口）。勿在业务代码调用 */
export function __configureMediaUrlProviderForTests(_opts?: { idleRevokeMs?: number }): void {
  for (const entry of Array.from(entries.values())) safeRevokeObjectUrl(entry.url);
  entries.clear();
  inflight.clear();
  pendingInvalidations.clear();
  listeners.clear();
}
