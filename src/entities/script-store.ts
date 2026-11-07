/**
 * script-store — 剧本实体唯一写者（2026-11-04 实体化根治第一步）
 *
 * 事实源：projects/<projectId>/entities/script.json（磁盘数据根，File System Access）。
 * 纪律：
 *  - 组件只允许通过本模块读/写/订阅剧本实体，禁止组件内自行拼路径读写文件；
 *  - 本模块是唯一拼 script.json 路径的地方（scriptPath 不导出给写入用途）；
 *  - 写采用乐观并发：writeScript 必须带 baseVersion（= 读到的 version），
 *    版本不匹配或文件被外部改动 → 抛 ScriptConflictError，拒绝写入；
 *  - baseVersion = 0 表示「创建新实体」（仅当文件不存在时合法）；
 *  - 本模块同时是 MCP/coding 工具操作剧本实体的契约口：外部写入后，
 *    watchScript 的轮询会在 ≤2s 内把变更推给前端订阅者。
 */
import { readJson, stat, writeJsonIfUnchanged } from '@/platform/fs';
import { normalizeScriptText } from '@/shared/utils/script-count.js';
import {
  preSaveSnapshot, afterWriteSnapshot, writeSnapshot, recycleSnapshots, restoreSnapshot,
  type SnapshotListItem,
} from './snapshot-store.js';

export const SCRIPT_SCHEMA_VERSION = 1 as const;

export interface ScriptLine {
  lineId: string;
  kind: 'narration' | 'dialogue';
  text: string;
  speaker: string | null;
}

export interface ScriptSegment {
  segId: string;
  seq: number;
  lines: ScriptLine[];
  sourceRange?: string;
}

/**
 * 本集信息卡（剧本页右侧抽屉）：一句话介绍 / 推荐标签 / 发布建议。
 * 由 MCP set_episode_meta 或编辑器写入；缺省 = 空态一行提示。
 */
export interface ScriptEpisodeMeta {
  logline?: string;
  tags?: string[];
  publishNote?: string;
}

export interface ScriptEpisode {
  id: string;
  number: number;
  title: string;
  /** 编辑器当前编辑的单集正文（结构化段落 lines 的纯文本/HTML 载体） */
  content: string;
  status: string;
  segments?: ScriptSegment[];
  /** 本集信息卡（一句话介绍 / 推荐标签 / 发布建议） */
  meta?: ScriptEpisodeMeta;
}

/**
 * 本剧信息（整个剧本/剧集的一句话概述 + 推荐标签）。
 * 2026-11-07 用户澄清：信息卡是「本剧」级，不是「本集」级。
 */
export interface ScriptMeta {
  /** 一句话概述（整部剧/这一季） */
  logline?: string;
  /** 推荐标签 */
  tags?: string[];
}

export interface ScriptEntity {
  schemaVersion: typeof SCRIPT_SCHEMA_VERSION;
  /** 乐观并发版本号：每次写入 +1；创建时为 1 */
  version: number;
  title: string;
  activeEpisodeId: string;
  episodes: ScriptEpisode[];
  /** 本剧信息（一句话概述 / 推荐标签） */
  meta?: ScriptMeta;
  sourceInfo: {
    origin: 'created' | 'imported';
    createdBy: 'editor-page' | 'mcp' | 'migration';
    note?: string;
  };
  updatedAt: string;
}

export interface ScriptPatch {
  /** 乐观锁基线：写入方读到的 version；创建新实体时传 0 */
  baseVersion: number;
  title?: string;
  activeEpisodeId?: string;
  episodes?: ScriptEpisode[];
  /** 本剧信息 */
  meta?: ScriptMeta;
  sourceInfo?: ScriptEntity['sourceInfo'];
}

export class ScriptConflictError extends Error {
  readonly projectId: string;
  readonly expected: number;
  readonly actual: number | null;
  constructor(projectId: string, expected: number, actual: number | null, detail: string) {
    super(`[script-store] 版本冲突 project=${projectId} baseVersion=${expected} actual=${actual}: ${detail}`);
    this.name = 'ScriptConflictError';
    this.projectId = projectId;
    this.expected = expected;
    this.actual = actual;
  }
}

/** 唯一拼路径处（不导出，组件无权自行定位实体文件） */
function scriptPath(projectId: string): string {
  return `projects/${projectId}/entities/script.json`;
}

export async function readScript(projectId: string): Promise<ScriptEntity | null> {
  const raw = await readJson<ScriptEntity>(scriptPath(projectId));
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.episodes)) return null;
  return raw;
}

// 进程内串行锁：同一 projectId 的写入串行化，杜绝「读-判-写」交错导致的并发双建
// （跨进程/外部 MCP 写入仍由 writeJsonIfUnchanged 的 size+lastModified 比对兜底）
const writeLocks = new Map<string, Promise<unknown>>();

// ---------- 快照钩子（2026-11-04 升级为统一快照库 snapshot-store） ----------
// 覆盖写盘前 pre-save 上一版、写盘后按 5 分钟时间窗生成 auto 并回收；
// 失败均不阻断主写入（红线）。创建（无上一版）不快照。

function withWriteLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeLocks.set(projectId, next);
  const cleanup = () => { if (writeLocks.get(projectId) === next) writeLocks.delete(projectId); };
  next.then(cleanup, cleanup);
  return next;
}

export async function writeScript(projectId: string, patch: ScriptPatch): Promise<ScriptEntity> {
  return withWriteLock(projectId, () => writeScriptLocked(projectId, patch));
}

async function writeScriptLocked(projectId: string, patch: ScriptPatch): Promise<ScriptEntity> {
  const p = scriptPath(projectId);
  const current = await readJson<ScriptEntity>(p);
  const st = await stat(p); // 乐观锁：外部（MCP）在读到写之间改过文件则 writeJsonIfUnchanged 抛 ConflictError
  const now = new Date().toISOString();

  if (!current) {
    if (patch.baseVersion !== 0) {
      throw new ScriptConflictError(projectId, patch.baseVersion, null, '实体不存在，仅 baseVersion=0 允许创建');
    }
    // 防创建竞态：读到「无文件」后、写入前文件又出现（并发 ensure）→ 视为冲突，调用方收敛重读
    const raced = await stat(p);
    if (raced) {
      throw new ScriptConflictError(projectId, 0, null, '创建竞态：实体已被并发创建');
    }
    const created: ScriptEntity = {
      schemaVersion: SCRIPT_SCHEMA_VERSION,
      version: 1,
      title: patch.title ?? '剧本',
      activeEpisodeId: patch.activeEpisodeId ?? '',
      episodes: patch.episodes ?? [],
      ...(patch.meta ? { meta: patch.meta } : {}),
      sourceInfo: patch.sourceInfo ?? { origin: 'created', createdBy: 'editor-page' },
      updatedAt: now,
    };
    await writeJsonIfUnchanged(p, created, st);
    notify(projectId, created);
    return created;
  }

  if (patch.baseVersion !== current.version) {
    throw new ScriptConflictError(projectId, patch.baseVersion, current.version, 'baseVersion 与磁盘版本不一致');
  }
  const next: ScriptEntity = {
    ...current,
    title: patch.title ?? current.title,
    activeEpisodeId: patch.activeEpisodeId ?? current.activeEpisodeId,
    episodes: patch.episodes ?? current.episodes,
    meta: patch.meta ?? current.meta,
    version: current.version + 1,
    updatedAt: now,
  };
  await preSaveSnapshot(projectId, 'script', current, next); // 覆盖前：上一版入快照库（失败不阻断）
  await writeJsonIfUnchanged(p, next, st);
  await afterWriteSnapshot(projectId, 'script', next); // 写后：5 分钟时间窗内不生成 auto（失败不阻断）
  notify(projectId, next);
  return next;
}

// ---------- 剧本快照 API（版本面板用；底层统一走 snapshot-store） ----------

export type ScriptSnapshot = SnapshotListItem<ScriptEntity>;

/** 用户手动创建快照（reason=manual，不受 5 分钟时间窗限制；名称可选） */
export async function createScriptSnapshot(
  projectId: string,
  name?: string,
): Promise<ScriptSnapshot | null> {
  const entity = await readScript(projectId);
  if (!entity) return null;
  const snap = await writeSnapshot<ScriptEntity>(projectId, 'script', entity, 'manual', name ? { name } : {});
  await recycleSnapshots(projectId, 'script');
  return snap;
}

/**
 * 恢复到指定快照：先落 pre-restore（当前版，失败中止），再以
 * writeScript(baseVersion=当前 version) 写入恢复内容——版本冲突抛
 * ScriptConflictError，由调用方按既有冲突提示处理，不静默覆盖。
 */
export async function restoreScriptSnapshot(
  projectId: string,
  snapshot: { entity: ScriptEntity },
): Promise<ScriptEntity> {
  return restoreSnapshot<ScriptEntity>(projectId, 'script', snapshot, {
    readCurrent: () => readScript(projectId),
    // baseVersion 必须用「当前盘上版本」（第二个参数），不是快照里的旧 version
    write: (entity, current) => writeScript(projectId, {
      baseVersion: current?.version ?? 0,
      title: entity.title,
      activeEpisodeId: entity.activeEpisodeId,
      episodes: entity.episodes,
      meta: entity.meta,
    }),
  });
}

// ---------- 幂等创建与剧集派生规则（2026-11-04 重复剧集修复） ----------

/**
 * 幂等确保剧本实体存在：已存在 → 原样返回；不存在 → 创建；
 * 并发创建竞态（两处入口同时 ensure）→ 负方收敛为重读结果，绝不产生第二份实体。
 */
export async function ensureScript(
  projectId: string,
  init: { title?: string; episodes?: ScriptEpisode[] } = {},
): Promise<{ entity: ScriptEntity; created: boolean }> {
  const existing = await readScript(projectId);
  if (existing) return { entity: existing, created: false };
  try {
    const created = await writeScript(projectId, {
      baseVersion: 0,
      title: init.title,
      episodes: init.episodes ?? [],
      activeEpisodeId: init.episodes?.[0]?.id ?? '',
    });
    return { entity: created, created: true };
  } catch (err) {
    if (err instanceof ScriptConflictError) {
      const fresh = await readScript(projectId);
      if (fresh) return { entity: fresh, created: false };
    }
    throw err;
  }
}

/** 新剧集序号：现有最大 number + 1（删除中间集后不复用空缺号，避免与既有引用撞号） */
export function nextEpisodeNumber(episodes: ReadonlyArray<{ number: number }>): number {
  return episodes.reduce((m, e) => Math.max(m, e.number || 0), 0) + 1;
}

/** 自动标题规则：只由 number 派生「第N集」，绝不拼接旧标题（修复「第1集2集」式乱名） */
export function autoEpisodeTitle(number: number): string {
  return `第${number}集`;
}

// ---------- 集标题显示/兜底统一规则（2026-11-04 抽屉集标题错乱修复） ----------
// 全仓唯一口径：显示层一律走 displayEpisodeTitle，生成侧一律走 autoEpisodeTitle，
// 禁止任何组件/服务自拼 `第${n}集` 或用列表下标 idx 兜底（idx 兜底是编号错乱来源）。

/**
 * 判断剧集标题是否为「程序生成的默认标题」（第N集）。
 * 兼容空白变体：'第1集' / '第 1 集' / '第  1  集' 均视为默认标题。
 * 后端/AI 链路默认生成标题常带空格（如 `第 ${i + 1} 集`），
 * 若仅按无空格模板比较会误判为自定义标题，导致下拉/列表拼出「第N集 · 第N集」重复文本。
 */
export function isDefaultEpisodeTitle(title: string | undefined | null, number: number): boolean {
  if (!title) return false;
  return title.replace(/\s+/g, '') === `第${number}集`;
}

/**
 * 判断剧集标题是否为「明显脏值」——历史上旧拼接逻辑产出的乱名：
 *  - 拼接型：第1集2集 / 第3集4集（以「第N集」开头又以「M集」结尾）；
 *  - 重复编号型：「第N集」字样出现 ≥2 次（第1集第1集 / 第1集·第1集）。
 * 正常自定义标题（如「第5集·大结局」「初遇」）不会命中。
 * 默认标题（含空格变体）不算脏，由 isDefaultEpisodeTitle 判定。
 */
export function isDirtyEpisodeTitle(title: string | undefined | null, number: number): boolean {
  if (!title) return false;
  const t = title.replace(/\s+/g, '');
  if (isDefaultEpisodeTitle(t, number)) return false;
  if (/^第\d+集/.test(t) && /\d集$/.test(t) && t !== `第${number}集`) return true; // 拼接型
  if ((t.match(/第\d+集/g) ?? []).length >= 2) return true; // 重复编号型
  return false;
}

/**
 * 集标题显示统一入口（抽屉卡片/剧集列表/进度条/序列化兜底全走这里）：
 *  - 空 / 默认（含空格变体）/ 脏值 → autoEpisodeTitle(number)（可读规范名，绝不显示「第N集2集」）；
 *  - 其余 → trim 后的自定义标题。
 * 调用方拼接「第 N 集 · 标题」时先比较 displayEpisodeTitle() 与 autoEpisodeTitle()，
 * 相等则只显示序号行，避免「第 1 集 · 第1集」重复。
 */
export function displayEpisodeTitle(title: string | undefined | null, number: number): string {
  const t = (title ?? '').trim();
  if (!t) return autoEpisodeTitle(number);
  if (isDefaultEpisodeTitle(t, number)) return autoEpisodeTitle(number);
  if (isDirtyEpisodeTitle(t, number)) return autoEpisodeTitle(number);
  return t;
}

/** 集标题是否为用户自定义（非默认、非脏、非空）——「第 N 集 · 标题」是否追加标题段的判定 */
export function hasCustomEpisodeTitle(title: string | undefined | null, number: number): boolean {
  return displayEpisodeTitle(title, number) !== autoEpisodeTitle(number);
}

export interface EpisodeTitleRepairItem {
  episodeId: string;
  from: string;
  to: string;
}

/**
 * 存量脏 title 修复计划（纯函数，IO 由调用方承担）：
 *  - 脏值（拼接型/重复编号型）→ autoEpisodeTitle(number)；
 *  - 默认标题空格变体（'第 1 集'）→ 规范 '第1集'；
 *  - 默认标题但数字与 number 不符（编号错乱，如 title='第3集' 而 number=1）→ autoEpisodeTitle(number)；
 *  - 空 title / 正常自定义标题 → 不动（空由显示层兜底）。
 * 幂等：修复后的实体再次 plan 结果为空。
 */
export function planEpisodeTitleRepair(episodes: ReadonlyArray<{ id: string; number: number; title: string }>): EpisodeTitleRepairItem[] {
  const plan: EpisodeTitleRepairItem[] = [];
  for (const ep of episodes) {
    const t = (ep.title ?? '').trim();
    if (!t) continue;
    const canonical = autoEpisodeTitle(ep.number);
    const squeezed = t.replace(/\s+/g, '');
    const isWrongDefault = isDefaultEpisodeTitle(t, ep.number) === false
      && /^第\d+集$/.test(squeezed); // 默认模式但数字与 number 不符
    if (isDirtyEpisodeTitle(t, ep.number) || isWrongDefault || (isDefaultEpisodeTitle(t, ep.number) && t !== canonical)) {
      plan.push({ episodeId: ep.id, from: t, to: canonical });
    }
  }
  return plan;
}

/**
 * 剧集内容判空：经统一规范化（去标签/解实体/压空白）后无任何可见文字即为空。
 * 用于存量清理的安全闸——有真实内容的剧集不得被合并/删除。
 * 2026-11-04：委托 normalizeScriptText，与字数统计同源（修前自写一套 strip 正则）。
 */
export function isEpisodeBlank(content: string | null | undefined): boolean {
  return normalizeScriptText(content).replace(/\s/g, '').length === 0;
}

/** 场次统计（信息卡用）：数 <p class="script-scene-heading"> 块，与编辑器块类型同口径 */
export function countScriptScenes(content: string | null | undefined): number {
  if (!content) return 0;
  return (content.match(/<p[^>]*script-scene-heading[^>]*>/gi) ?? []).length;
}

// ---------- watchScript：会话内即时推送 + 轮询捕捉外部（MCP）写入 ----------

type Listener = (entity: ScriptEntity | null) => void;
const listeners = new Map<string, Set<Listener>>();

function notify(projectId: string, entity: ScriptEntity | null): void {
  const set = listeners.get(projectId);
  if (!set) return;
  for (const cb of set) cb(entity);
}

const WATCH_POLL_MS = 2000;

/**
 * 订阅项目剧本实体变更：本会话内的 writeScript 立即推送；
 * 外部写入（MCP/手工改文件）通过 2s 轮询 stat 的 lastModified 发现。
 * 返回取消订阅函数。
 */
export function watchScript(projectId: string, cb: Listener): () => void {
  let set = listeners.get(projectId);
  if (!set) {
    set = new Set();
    listeners.set(projectId, set);
  }
  set.add(cb);

  let cancelled = false;
  let lastMtime = 0;
  void stat(scriptPath(projectId)).then((st) => { lastMtime = st?.lastModified ?? 0; });
  const timer = setInterval(() => {
    void (async () => {
      const st = await stat(scriptPath(projectId));
      const mtime = st?.lastModified ?? 0;
      if (cancelled || mtime === lastMtime) return;
      lastMtime = mtime;
      const entity = await readScript(projectId);
      if (!cancelled) notify(projectId, entity);
    })();
  }, WATCH_POLL_MS);

  return () => {
    cancelled = true;
    clearInterval(timer);
    const s = listeners.get(projectId);
    if (s) {
      s.delete(cb);
      if (s.size === 0) listeners.delete(projectId);
    }
  };
}
