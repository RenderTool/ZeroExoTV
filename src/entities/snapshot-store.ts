/**
 * snapshot-store — 实体统一快照库（2026-11-04 快照/版本功能）
 *
 * 分工（与编辑器撤销栈互补，互不替代）：
 *  - 撤销栈（script-history）= 会话内逐步撤销/重做，关闭编辑器即丢；
 *  - 快照（本模块）= 持久版本，跨会话可恢复。
 *
 * 存储：projects/<projectId>/entities/snapshots/<type>/（type = script/storyboard/workbench），
 * 文件名 snap-<YYYYMMDDHHmmssSSS>.json（含毫秒，字典序=时间序），内容：
 *   { schemaVersion, type, reason, createdAt, name?, hash, entity }
 *
 * 生成规则（防磁盘爆）：
 *  - pre-save  ：覆盖写盘前把「上一版」入库（内容有实质变化且最新快照 ≠ 上一版内容时才写；
 *                失败不阻断主写入——红线）；
 *  - auto      ：写盘成功后，内容 hash ≠ 最新快照 且 距上一份快照 ≥ 5 分钟才生成；
 *  - manual    ：用户手动创建，不受时间窗限制；
 *  - pre-restore：恢复写盘前把「当前版」入库（失败则中止恢复，安全优先）。
 *
 * 回收（单类目录内，不跨项目）：
 *  - 保留最近 30 份且不早于 7 天（超出任一条件即回收）；
 *  - 目录总量 > 200MB 时按最旧继续回收；
 *  - 永不回收：最近 3 份（任意 reason）与最近 1 份 pre-restore。
 *
 * 迁移：老 entities/backups/ 下文件（上轮 pre-save 备份 + 导入覆盖备份）一次性归并到
 * snapshots/script/（reason=pre-save），先 dry-run 打印清单再执行，幂等。
 *
 * 红线：不写画布 graph；不新增画布节点；撤销栈行为不变。
 */
import { readJson, writeJson, listDir, remove, stat } from '@/platform/fs';

export type SnapshotType = 'script' | 'storyboard' | 'workbench';
export type SnapshotReason = 'pre-save' | 'auto' | 'manual' | 'pre-restore';

export interface EntitySnapshot<T = unknown> {
  schemaVersion: 1;
  type: SnapshotType;
  reason: SnapshotReason;
  /** 创建时刻（ISO）；legacy 迁移件 = 迁移时刻 */
  createdAt: string;
  /** manual 可选名称（面板展示用，留空显示时间） */
  name?: string;
  /** 实质内容 hash（去重/校验口径见 snapshotContentOf） */
  hash: string;
  entity: T;
}

/** 列表项（带文件名，用于预览/恢复定位与回收；sizeBytes 仅 withSize 查询时填充） */
export type SnapshotListItem<T = unknown> = EntitySnapshot<T> & { fileName: string; sizeBytes?: number };

/** auto 快照最小间隔（ms）：距上一份快照不足此值不生成 auto（pre-save 不受限） */
export const SNAPSHOT_AUTO_INTERVAL_MS = 5 * 60 * 1000;
/** 每类保留份数上限 */
export const SNAPSHOT_KEEP_COUNT = 30;
/** 每类保留时长上限（ms） */
export const SNAPSHOT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** 单类快照目录总量上限（字节） */
export const SNAPSHOT_DIR_MAX_BYTES = 200 * 1024 * 1024;

const SNAPSHOT_FILE_PREFIX = 'snap-';

/** 唯一拼路径处 */
export function snapshotDir(projectId: string, type: SnapshotType): string {
  return `projects/${projectId}/entities/snapshots/${type}`;
}

/**
 * 实质内容提取（hash/去重口径）：
 *  - script：title + episodes（activeEpisodeId/version/updatedAt 等元数据推进不算内容变化）；
 *  - storyboard/workbench：整个容器对象（本轮无更细定义，整体比对）。
 */
export function snapshotContentOf(type: SnapshotType, entity: unknown): unknown {
  if (type === 'script' && entity && typeof entity === 'object') {
    const e = entity as { title?: unknown; episodes?: unknown };
    return { title: e.title, episodes: e.episodes };
  }
  return entity;
}

/** 内容 hash（FNV 双通道 64bit，JSON 序列化后哈希；非加密，仅去重/比对用） */
export function contentHash(value: unknown): string {
  const s = JSON.stringify(value) ?? 'null';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = ((h1 ^ c) >>> 0) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** 文件名时间戳：17 位本地时间 + 2 位同毫秒序号（定宽保证字典序 = 时间序；
 *  同毫秒内连续写两份快照——如 pre-save 后紧接 manual——不会同名互相覆盖） */
let lastSnapTime = -1;
let snapSeq = 0;
function snapTimestamp(d: Date): string {
  const t = d.getTime();
  if (t === lastSnapTime) snapSeq += 1;
  else {
    lastSnapTime = t;
    snapSeq = 0;
  }
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}${p(snapSeq)}`;
}

/** 写入一份快照（不做任何去重/时间窗判断——规则由 preSave/afterWrite/manual 编排） */
export async function writeSnapshot<T>(
  projectId: string,
  type: SnapshotType,
  entity: T,
  reason: SnapshotReason,
  opts: { name?: string; now?: Date } = {},
): Promise<SnapshotListItem<T>> {
  const now = opts.now ?? new Date();
  const fileName = `${SNAPSHOT_FILE_PREFIX}${snapTimestamp(now)}.json`;
  const snap: EntitySnapshot<T> = {
    schemaVersion: 1,
    type,
    reason,
    createdAt: now.toISOString(),
    ...(opts.name ? { name: opts.name } : {}),
    hash: contentHash(snapshotContentOf(type, entity)),
    entity,
  };
  await writeJson(`${snapshotDir(projectId, type)}/${fileName}`, snap);
  return { ...snap, fileName };
}

/** 列出某类全部快照（按文件名字典序 = 时间序，旧 → 新）；
 *  opts.withSize=true 时逐份 stat 填充 sizeBytes（面板计数/占用用；回收等热路径不开） */
export async function listSnapshots<T = unknown>(
  projectId: string,
  type: SnapshotType,
  opts: { withSize?: boolean } = {},
): Promise<SnapshotListItem<T>[]> {
  const dir = snapshotDir(projectId, type);
  const entries = await listDir(dir);
  const items: SnapshotListItem<T>[] = [];
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.startsWith(SNAPSHOT_FILE_PREFIX)) continue;
    const raw = await readJson<EntitySnapshot<T>>(`${dir}/${e.name}`);
    if (!raw || typeof raw !== 'object' || typeof raw.hash !== 'string') continue;
    const item: SnapshotListItem<T> = { ...raw, fileName: e.name };
    if (opts.withSize) item.sizeBytes = (await stat(`${dir}/${e.name}`))?.size ?? 0;
    items.push(item);
  }
  items.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  return items;
}

/** 最新一份快照（无则 null） */
export async function getLatestSnapshot<T = unknown>(projectId: string, type: SnapshotType): Promise<SnapshotListItem<T> | null> {
  const all = await listSnapshots<T>(projectId, type);
  return all[all.length - 1] ?? null;
}

/**
 * 覆盖写盘前：把「上一版」入库（reason=pre-save）。
 *  - 实质内容无变化（元数据-only 写入）→ 不入库；
 *  - 最新快照内容已等于上一版（如恢复流程刚写过 pre-restore）→ 不入库（保证不重复）；
 *  - 任何失败只 log，不阻断主写入（红线：pre-save 失败不阻断）。
 */
export async function preSaveSnapshot(projectId: string, type: SnapshotType, current: unknown, next: unknown): Promise<void> {
  try {
    const currentHash = contentHash(snapshotContentOf(type, current));
    if (currentHash === contentHash(snapshotContentOf(type, next))) return; // 元数据-only
    const latest = await getLatestSnapshot(projectId, type);
    if (latest && latest.hash === currentHash) return; // 上一版已在库
    await writeSnapshot(projectId, type, current, 'pre-save');
    await recycleSnapshots(projectId, type);
  } catch (err) {
    console.error('[snapshot-store] pre-save snapshot failed (continue main write):', err);
  }
}

/**
 * 写盘成功后：满足时间窗则生成 auto 并回收。任何失败只 log（不阻断调用方）。
 * 规则：内容 hash 与最新快照相同 → 不生成；距上一份 < 5 分钟 → 不生成（等下一次写盘再判断）。
 */
export async function afterWriteSnapshot(projectId: string, type: SnapshotType, entity: unknown): Promise<void> {
  try {
    const hash = contentHash(snapshotContentOf(type, entity));
    const latest = await getLatestSnapshot(projectId, type);
    if (!latest || latest.hash !== hash) {
      if (!latest || Date.now() - Date.parse(latest.createdAt) >= SNAPSHOT_AUTO_INTERVAL_MS) {
        await writeSnapshot(projectId, type, entity, 'auto');
      }
    }
    await recycleSnapshots(projectId, type);
  } catch (err) {
    console.error('[snapshot-store] auto snapshot failed (skip):', err);
  }
}

/**
 * 回收（单类目录内，不跨项目）：
 *  - 删除条件（满足其一）：不在最近 30 份内，或创建于 7 天前；
 *  - 目录总量 > 200MB 时按最旧继续回收；
 *  - 保护：最近 3 份（任意 reason）与最近 1 份 pre-restore 永不回收。
 * @returns 实际回收份数
 */
export async function recycleSnapshots(projectId: string, type: SnapshotType, now = new Date()): Promise<number> {
  const dir = snapshotDir(projectId, type);
  const snaps = await listSnapshots(projectId, type);
  if (snaps.length === 0) return 0;

  // 保护集：最近 3 份（任意 reason）+ 最近 1 份 pre-restore
  const protectedNames = new Set<string>();
  for (const s of snaps.slice(-3)) protectedNames.add(s.fileName);
  for (let i = snaps.length - 1; i >= 0; i -= 1) {
    if (snaps[i]!.reason === 'pre-restore') { protectedNames.add(snaps[i]!.fileName); break; }
  }

  let removed = 0;
  const t = now.getTime();
  for (let i = 0; i < snaps.length; i += 1) {
    const s = snaps[i]!;
    if (protectedNames.has(s.fileName)) continue;
    const fromEnd = snaps.length - i; // 1 = 最新
    const tooMany = fromEnd > SNAPSHOT_KEEP_COUNT;
    const tooOld = t - Date.parse(s.createdAt) > SNAPSHOT_KEEP_MS;
    if (tooMany || tooOld) {
      await remove(`${dir}/${s.fileName}`);
      removed += 1;
    }
  }

  // 200MB 总量上限：对剩余文件按最旧继续回收（跳过保护集）
  const survivors = removed > 0 ? await listSnapshots(projectId, type) : snaps;
  let total = 0;
  const sizes = new Map<string, number>();
  for (const s of survivors) {
    const st = await stat(`${dir}/${s.fileName}`);
    const size = st?.size ?? 0;
    sizes.set(s.fileName, size);
    total += size;
  }
  for (const s of survivors) {
    if (total <= SNAPSHOT_DIR_MAX_BYTES) break;
    if (protectedNames.has(s.fileName)) continue;
    total -= sizes.get(s.fileName) ?? 0;
    await remove(`${dir}/${s.fileName}`);
    removed += 1;
  }
  return removed;
}

/**
 * 手动删除（版本面板用，2026-11-05）：
 *  - 面板先「软删」——从列表移除并把完整快照留在内存（撤销窗内可一键恢复）；
 *  - 撤销窗超时 / 面板关闭时才调用 deleteSnapshotFile 真删文件；
 *  - 真删后文件从盘上消失 → 不再参与自动回收计数（回收只看盘上现存文件）；
 *  - 幂等：文件已缺失/损坏时 remove 静默，不抛错（remove 对不存在路径本就静默）。
 */
export async function deleteSnapshotFile(projectId: string, type: SnapshotType, fileName: string): Promise<void> {
  await remove(`${snapshotDir(projectId, type)}/${fileName}`);
}

/**
 * 撤销删除：按原文件名、原内容原子写回（writeJson → createWritable 全量提交，不留半文件）。
 *  文件名不变 → 字典序排序位置与删除前完全一致；快照缺失的可选字段（name）自然保留。
 */
export async function undeleteSnapshot<T>(
  projectId: string,
  type: SnapshotType,
  snap: SnapshotListItem<T>,
): Promise<void> {
  const { fileName: _fileName, ...rest } = snap;
  await writeJson(`${snapshotDir(projectId, type)}/${snap.fileName}`, rest);
}

/**
 * 恢复编排：先落 pre-restore（当前版），再由注入的 write 落恢复内容。
 *  - write 收到 (恢复实体, 当前实体)：baseVersion 语义由调用方用「当前盘上版本」
 *    构造（版本冲突在 write 内抛错，不静默覆盖）；
 *  - pre-restore 写入失败 → 抛错中止恢复（当前版无兜底时不得覆盖，安全优先；
 *    与 pre-save「失败不阻断」的红线区分：那是对主写入的容错，这是对破坏性覆盖的闸门）。
 */
export async function restoreSnapshot<T>(
  projectId: string,
  type: SnapshotType,
  snapshot: { entity: T },
  io: { readCurrent: () => Promise<T | null>; write: (entity: T, current: T | null) => Promise<T> },
): Promise<T> {
  const current = await io.readCurrent();
  if (current) {
    await writeSnapshot(projectId, type, current, 'pre-restore'); // 失败直接抛（中止恢复）
  }
  return io.write(snapshot.entity, current);
}

/**
 * 导出前只读校验（导演台实体用，本轮无 UI 恢复入口）：最近一份快照存在且 hash 可比对。
 * 只打 log，不阻断导出。@returns 校验是否通过。
 */
export async function verifySnapshotForExport(
  projectId: string,
  type: SnapshotType,
  currentEntity: unknown,
): Promise<boolean> {
  try {
    const latest = await getLatestSnapshot(projectId, type);
    if (!latest) {
      console.warn(`[snapshot-store] export check: project=${projectId} type=${type} 无快照（建议先产生一次写入以建立快照基线）`);
      return false;
    }
    const ok = latest.hash === contentHash(snapshotContentOf(type, currentEntity));
    console.log(`[snapshot-store] export check: project=${projectId} type=${type} latest=${latest.createdAt} reason=${latest.reason} hashMatch=${ok}`);
    return ok;
  } catch (err) {
    console.error('[snapshot-store] export check failed (continue export):', err);
    return false;
  }
}

// ---------- 老 backups/ 一次性归并（幂等） ----------

export interface LegacyMigrationPlan {
  from: string;
  to: string;
  createdAt: string;
}

/** 老 backups 目录（上轮 pre-save 备份 + 导入覆盖备份所在） */
function legacyBackupsDir(projectId: string): string {
  return `projects/${projectId}/entities/backups`;
}

/** 从老文件名抽时间戳数字串（script-presave-<17位>.json / script-ep-1-<14位>.json） */
function legacyStampFromName(name: string): string | null {
  const m = name.match(/(\d{14,17})/);
  return m ? m[1]! : null;
}

/**
 * 把老 entities/backups/ 下全部文件归并到 snapshots/script/（reason=pre-save）。
 *  - dryRun=true 只返回清单不动盘（调用方先打印再执行）；
 *  - 幂等：目标文件已存在则跳过并继续（二次运行 backups/ 已空 → 0 改动）；
 *  - 只处理 backups/ 一级文件，不递归；不写 graph。
 */
export async function migrateLegacyBackups(
  projectId: string,
  opts: { dryRun?: boolean } = {},
): Promise<LegacyMigrationPlan[]> {
  const dir = legacyBackupsDir(projectId);
  const entries = await listDir(dir);
  const plans: LegacyMigrationPlan[] = [];
  const targetDir = snapshotDir(projectId, 'script');
  for (const e of entries) {
    if (e.kind !== 'file') continue;
    const from = `${dir}/${e.name}`;
    const raw = await readJson<Record<string, unknown>>(from);
    if (!raw || typeof raw !== 'object') continue;
    // 老 pre-save 包 { reason, backedAt, entity }；导入覆盖备份为裸实体
    const entity = (raw.entity && typeof raw.entity === 'object') ? raw.entity : raw;
    const createdAt = (typeof raw.backedAt === 'string' ? raw.backedAt : null)
      ?? new Date().toISOString(); // 老文件缺可靠创建时间 → 迁移时刻（保序靠文件名数字）
    const stamp = legacyStampFromName(e.name);
    const fileName = stamp ? `${SNAPSHOT_FILE_PREFIX}${stamp}-legacy.json` : `${SNAPSHOT_FILE_PREFIX}${snapTimestamp(new Date())}-legacy.json`;
    const to = `${targetDir}/${fileName}`;
    plans.push({ from, to, createdAt });
    if (opts.dryRun) continue;
    const exists = await readJson(to);
    if (exists) continue; // 幂等：目标已存在
    await writeJson(to, {
      schemaVersion: 1,
      type: 'script',
      reason: 'pre-save',
      createdAt,
      hash: contentHash(snapshotContentOf('script', entity)),
      entity,
    });
    await remove(from);
  }
  return plans;
}

/** 会话级已迁移标记（面板打开时触发：先 dry-run 打清单，再迁移一次） */
const migratedProjects = new Set<string>();

export async function ensureLegacyMigrated(projectId: string): Promise<void> {
  if (migratedProjects.has(projectId)) return;
  migratedProjects.add(projectId);
  try {
    const plan = await migrateLegacyBackups(projectId, { dryRun: true });
    if (plan.length > 0) {
      console.log(`[snapshot-store] legacy backups to migrate (project=${projectId}):`, plan.map((p) => p.from));
      await migrateLegacyBackups(projectId);
      console.log(`[snapshot-store] legacy backups migrated: ${plan.length} file(s)`);
    }
  } catch (err) {
    console.error('[snapshot-store] legacy migration failed:', err);
  }
}
