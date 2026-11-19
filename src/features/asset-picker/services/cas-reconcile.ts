/**
 * cas-reconcile —— CAS 引用对账（2026-11-16 用户拍板：CAS 核心 = 去重 + 引用计数归零自动删除）
 *
 * 背景：refs 历史上只覆盖「资产记录」与「主体状态」两个写入点，画布节点、导演台 shot、
 * 剧本从不注册 → 引用计数无法覆盖真实消费方。
 *
 * 对账模型（保守优先，2026-11-16 事故后定型）：
 * 1. **只补挂、不按扫描结果摘除**：扫描到的每个引用都以固定身份 registerCasRef（补挂保护），
 *    扫描结果绝不用于「摘掉看不见的引用」——那是 2026-11-16 误删事故的直接原因。
 * 2. **唯一允许摘除的引用**：资产记录自己注册的 ref（kind ∈ image/video/audio）。
 *    记录被删 → 该 ref 的 assetId 已不在资产列表 → 只摘这一条。
 *    主体状态（subject-state-media）、对账扫描（reconcile）等其它身份一律不摘。
 * 3. **安全阀（任一不满足 → 本轮完全跳过摘除，只补挂）**：
 *    - 资产列表必须读取成功（否则无法判定「记录是否还存在」）；
 *    - 项目列表必须读取成功，且每个列出的项目，其画布图/工作台/主体库/剧本四个读取
 *      **全部成功**（任何一处失败 = 覆盖不完整，不得据此判断引用失效）。
 * 4. **物理回收**：仅「索引里 refs 归零」的条目连文件一起回收（purgeOrphanMedia），
 *    且本轮扫描完整时才允许触发。
 *
 * 引用身份：
 *   - 资产记录：ref.assetId = 记录 id（kind 沿用资产 kind）；
 *   - 主体状态：subject-state-media（不由本模块管理，永久保留）；
 *   - 容器扫描：scan:canvas|shots|subjects|script:<pid>（kind='reconcile'，永久保留）。
 */
import { isCasStorageKey, readCasIndex, registerCasRef, releaseCas } from '@/entities/cas-store.js';
import { purgeOrphanMedia } from '@/entities/orphan-media.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { readScript } from '@/entities/script-store.js';
import { readStoryboardContainer, readWorkbenchContainer } from '@/entities/slot-containers.js';
import { listProjects, loadProjectGraph } from '@zeroexo/plugin-persistence';

/** 资产记录注册的 ref 会带上这些 kind（见 cas-upload）；只有它们允许在对账里被摘除 */
const ASSET_KINDS = new Set(['image', 'video', 'audio']);
const SCAN_KIND = 'reconcile';

/** cas:<hash>.<ext> → <hash>（hash 为 hex，不含点） */
function casHashOf(key: string): string | null {
  if (!isCasStorageKey(key)) return null;
  const dot = key.lastIndexOf('.');
  return dot > 4 ? key.slice(4, dot) : null;
}

/** 深度遍历任意 JSON 结构，收集全部 cas: 存储键（不依赖各 schema 字段名） */
function collectCasKeys(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (isCasStorageKey(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectCasKeys(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectCasKeys(v, out);
  }
}

export interface ReconcileResult {
  /** 扫描到的存活引用数 */
  liveRefs: number;
  /** 摘除的「已删除资产记录」引用数（仅此一类） */
  released: number;
  /** 补挂的保护引用数 */
  protectedRefs: number;
  /** 归零回收的文件数 */
  purged: number;
  /** 本轮是否具备完整覆盖（false = 只补挂、未摘除） */
  complete: boolean;
}

export async function reconcileCasRefs(): Promise<ReconcileResult> {
  const live = new Map<string, Map<string, string>>(); // hash -> (refId -> projectId)
  const addRef = (hash: string, refId: string, pid: string): void => {
    if (!live.has(hash)) live.set(hash, new Map());
    live.get(hash)!.set(refId, pid);
  };

  let complete = true;

  // 1) 资产记录（ref 沿用记录自身 id）——同时得到「现存记录 id 集合」，用于判定已删记录
  const assetIds = new Set<string>();
  let assetsRead = true;
  try {
    const assets = await listAssets();
    for (const a of assets) {
      assetIds.add(a.id);
      const data = a.data as { storageKey?: string } | null | undefined;
      const h = data?.storageKey ? casHashOf(data.storageKey) : null;
      if (h) addRef(h, a.id, a.projectId ?? 'library');
    }
  } catch (err) {
    assetsRead = false;
    complete = false;
    console.warn('[cas-reconcile] 资产记录读取失败，本轮只补挂不摘除:', err);
  }

  // 2) 逐项目扫描画布图 / 导演台 / 主体库 / 剧本
  let projects: Awaited<ReturnType<typeof listProjects>> = [];
  try {
    projects = await listProjects();
  } catch (err) {
    complete = false;
    console.warn('[cas-reconcile] 项目列表读取失败，本轮只补挂不摘除:', err);
  }
  const containers: Array<{ tag: string; pid: string; read: () => Promise<unknown> }> = [];
  for (const p of projects) {
    const pid = String((p as { id?: unknown }).id ?? '');
    if (!pid) { complete = false; continue; }
    containers.push(
      { tag: `scan:canvas:${pid}`, pid, read: () => loadProjectGraph(pid) },
      { tag: `scan:shots:${pid}`, pid, read: () => readWorkbenchContainer(pid) },
      { tag: `scan:subjects:${pid}`, pid, read: () => readStoryboardContainer(pid) },
      { tag: `scan:script:${pid}`, pid, read: () => readScript(pid) },
    );
  }
  for (const c of containers) {
    try {
      const keys = new Set<string>();
      collectCasKeys(await c.read(), keys);
      for (const key of keys) {
        const h = casHashOf(key);
        if (h) addRef(h, c.tag, c.tag);
      }
    } catch (err) {
      // 任何容器读取失败 = 覆盖不完整：本轮不允许摘除任何引用
      complete = false;
      console.warn(`[cas-reconcile] ${c.tag} 读取失败，本轮只补挂不摘除:`, err);
    }
  }

  // 3) 索引对账：补挂扫描到的引用；只摘「已删除资产记录」自己的 ref
  const index = await readCasIndex();
  let released = 0;
  let protectedRefs = 0;
  let liveCount = 0;
  for (const refs of live.values()) liveCount += refs.size;
  for (const [hash, entry] of Object.entries(index.entries)) {
    const desired = live.get(hash);
    // 3a) 摘除：只允许 asset-kind ref 且其记录已不存在；必须覆盖完整
    if (complete && assetsRead) {
      for (const r of [...entry.refs]) {
        const kind = (r as { kind?: string }).kind;
        if (!kind || !ASSET_KINDS.has(kind)) continue; // 主体状态/扫描引用永久保留
        if (assetIds.has(r.assetId)) continue;
        const res = await releaseCas(hash, { assetId: r.assetId, projectId: r.projectId }).catch(() => null);
        if (res?.released) released += 1;
      }
    }
    // 3b) 补挂：扫描到的每个引用都确保在索引里
    if (desired) {
      for (const [refId, pid] of desired) {
        const present = entry.refs.some((r) => r.assetId === refId);
        if (present) continue;
        await registerCasRef(hash, { assetId: refId, projectId: pid, kind: SCAN_KIND }).catch((err) => {
          console.warn('[cas-reconcile] 补挂 ref 失败（文件可能已被并发回收）:', hash, refId, err);
        });
        protectedRefs += 1;
      }
    }
  }

  // 4) 物理回收：只回收「refs 归零」条目，且必须覆盖完整
  let purged = 0;
  if (complete) {
    const purge = await purgeOrphanMedia();
    purged = purge.removed;
  }

  return { liveRefs: liveCount, released, protectedRefs, purged, complete };
}
