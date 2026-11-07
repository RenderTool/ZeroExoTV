/**
 * 素材元数据存储(Phase D2.1)
 *
 * 管理用户素材库的元数据列表,独立于实际的图片/媒体文件二进制存储。
 * - 元数据(本文件): 存于 app_state 桶, key: zeroexo:assets
 * - 二进制文件: 由 persistence 插件的 image-storage / file-storage 管理
 *   (image_files / media_files 桶, key 由 storageKey 字段引用)
 *
 * 设计参考: project-store.ts(同一套 localforage + 纯函数 API 模式)
 */

import localforage from 'localforage';
import { nanoid } from 'nanoid';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { hasCasEntry, isCasStorageKey, registerCasRef, releaseCas } from '@/entities/cas-store.js';
import { readFile as fsReadFile, writeFile as fsWriteFile, removeFile as fsRemoveFile } from '@/platform/fs.js';
import type { Asset, AssetKind, AssetScope } from './index.js';

// ===== 类型定义 =====

/** 新建素材时的输入(由 upload-asset 服务构造) */
export interface CreateAssetInput {
  /** 预生成资产 id（CAS 上传需先拿 id 注册 ref）；缺省由 addAsset/addAssets 生成 */
  id?: string;
  /** CAS 内容寻址引用（hash+ext）；携带时 data.storageKey 应为派生的 cas:<hash>.<ext> */
  cas?: { hash: string; ext: string };
  title: string;
  kind: AssetKind;
  coverUrl?: string;
  tags?: string[];
  bytes: number;
  mimeType?: string;
  data: Asset['data'];
  folderId?: string | null;
  /** 归属范围：缺省 'project'（无当前项目时降级为 'library'） */
  scope?: AssetScope;
  /** 所属项目 ID：仅 scope='project' 时有效，缺省取当前画布 ID */
  projectId?: string;
}

/** 更新素材时的输入(部分字段) */
export type UpdateAssetInput = Partial<Pick<Asset, 'title' | 'tags' | 'coverUrl' | 'folderId' | 'data' | 'favorite' | 'cloudId'>>;

// ===== localforage 实例(app_state 桶,与 project-store 共用) =====

const appStateStore = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'app_state',
});

/** 存储素材列表的 key */
const ASSETS_KEY = 'zeroexo:assets';

/**
 * 素材记录的磁盘权威路径（2026-11-05 写入链修复）：
 * 与 disk-driver writeEntry 完全同路径同信封（.lf/<name>/<bucket>/<编码key>.json，
 * 内容 {__lf:1,value}），旧文件（驱动写入的 46MB 存量文件）无需迁移即可读。
 *
 * 为什么绕开 localforage 实例：boot 的驱动链（FS→IndexedDB→…）在首次使用时静默降级且
 * 实例粘滞——首次操作发生在数据根授权/httpFs 上线之前时，整个会话的写入全部落进
 * 浏览器 IndexedDB，磁盘上「addAssets 不落盘」且无任何报错（2026-11-05 用户所有图片
 * 看不到的直接根因；证据：.lf/_map.json 账本有 graph_data 键而无 app_state 键）。
 * cas_index.json 走 platform/fs 直写则一直可靠，故素材记录改走同一通道：
 * 磁盘可用时 fs 直写（权威）；fs 不可用（未授权/驱动异常）才回退旧 localforage 通道
 * 并大声警告——保持 boot「只降级不白屏」的设计，但绝不静默。
 */
const ASSETS_FILE_REL = `.lf/zeroexo/app_state/${encodeURIComponent(ASSETS_KEY)}.json`;

/** CAS 自愈重建的清单（数据根 entities/ 下，与 cas_index 同级；不在 localforage 桶内） */

// ===== 资产项目化：scope 迁移 / 默认值 / 写守卫（纯函数，可单测） =====

/**
 * 存量迁移（惰性）：凡无 scope 字段的记录一律视为公共库资产（scope: 'library'）。
 * 不改 data 字节、不动其他字段；changed 标记是否发生过迁移（由 readAll 决定是否写回一次）。
 */
export function migrateAssetScopes(list: Asset[]): { list: Asset[]; changed: boolean } {
  let changed = false;
  const migrated = list.map((a) => {
    if (a.scope === 'project' || a.scope === 'library') return a;
    changed = true;
    return { ...a, scope: 'library' as AssetScope };
  });
  return { list: migrated, changed };
}

/**
 * 写入守卫：目标资产在当前视图上下文中是否可写（编辑/删除）。
 * - library 资产：仅 view==='library' 可写
 * - project 资产：仅 view==='project' 且 projectId 匹配可写
 * - 无 scope 的视为 library（与迁移口径一致）
 */
export function canWriteAsset(
  asset: Pick<Asset, 'scope' | 'projectId'>,
  ctx: { view: 'project' | 'library'; projectId: string | null },
): boolean {
  const scope: AssetScope = asset.scope ?? 'library';
  if (scope === 'library') return ctx.view === 'library';
  return ctx.view === 'project' && ctx.projectId != null && asset.projectId === ctx.projectId;
}

/**
 * 公共库资产类型白名单（资产项目化追加口径）：
 * 场外空间（主页/公共库视图）只收图片、视频、音频、文本四类素材资产；
 * 剧本、分镜、出片、工程类等业务 kind 一律不进公共库列表、不给创建入口。
 * 项目内视图不受此限（可保留业务类型）。
 */
export const LIBRARY_ALLOWED_KINDS: readonly AssetKind[] = ['image', 'video', 'audio', 'text'];

/** 判断某资产类型是否允许进入公共库 */
export function isLibraryAllowedKind(kind: AssetKind): boolean {
  return (LIBRARY_ALLOWED_KINDS as readonly string[]).includes(kind);
}

/**
 * 公共库创建路径守卫：非四类 kind 一律拒绝（抛错）。
 * 在 addAsset/addAssets 归属落定为 library 时调用，兜底 UI 层遗漏的业务类型创建入口。
 */
export function assertLibraryKind(kind: AssetKind): void {
  if (!isLibraryAllowedKind(kind)) {
    throw new Error(`全局资产库只收图片、视频、音频、文本四类资产，收到业务类型: ${String(kind)}`);
  }
}

/**
 * 归属过滤（资产项目化）：按当前视图上下文过滤资产列表。
 * - 无项目上下文（projectId=null，主页/独立资产页等场外空间）：只列公共库资产，
 *   任何 scope='project' 的资产都不得出现（即使调用方误传 scopeTab='project' 也兜底）；
 *   且公共库只列白名单四类（image/video/audio/text），业务 kind 不出现
 * - scopeTab='library'：仅公共库资产（同样只列白名单四类）
 * - scopeTab='project' 且有项目上下文：本项目资产 + 全部公共库资产（引用态混入，不受四类限制）
 */
export function filterAssetsByScope(
  list: Asset[],
  ctx: { scopeTab: AssetScope; projectId: string | null },
): Asset[] {
  if (ctx.scopeTab === 'library' || ctx.projectId == null) {
    return list.filter((a) => (a.scope ?? 'library') === 'library' && isLibraryAllowedKind(a.kind));
  }
  const pid = ctx.projectId;
  return list.filter((a) => {
    if ((a.scope ?? 'library') === 'library') return true;
    return a.projectId === pid;
  });
}

/** 解析新建资产的归属：缺省 project+当前画布；无当前项目降级 library；library 不写 projectId */
function resolveScope(input: CreateAssetInput): { scope: AssetScope; projectId?: string } {
  const scope: AssetScope = input.scope ?? 'project';
  if (scope === 'library') return { scope: 'library' };
  const projectId = input.projectId ?? getCurrentCanvasId();
  if (!projectId) return { scope: 'library' };
  return { scope: 'project', projectId };
}

/**
 * 严格归属过滤（资产库「公共资产 / 本项目」胶囊 Tab 口径，2026-11-04 约定）：
 * 单段内不混排两种作用域——
 * - scopeTab='project' 且有项目上下文：只出当前 projectId 的项目资产（公共库不再以引用态混入）
 * - 其余（library 页签 / 无项目上下文兜底）：只出公共库资产（限白名单四类）
 */
export function filterAssetsStrictScope(
  list: Asset[],
  ctx: { scopeTab: AssetScope; projectId: string | null },
): Asset[] {
  if (ctx.scopeTab === 'project' && ctx.projectId != null) {
    const pid = ctx.projectId;
    return list.filter((a) => (a.scope ?? 'library') === 'project' && a.projectId === pid);
  }
  return list.filter((a) => (a.scope ?? 'library') === 'library' && isLibraryAllowedKind(a.kind));
}

/** 胶囊 Tab 数量徽标口径：公共=library+四类白名单；本项目=当前 projectId 项目资产；无项目上下文 project=null（置灰） */
export interface AssetScopeCounts {
  library: number;
  project: number | null;
}

export function countAssetsByScope(list: Asset[], projectId: string | null): AssetScopeCounts {
  let library = 0;
  let project = 0;
  for (const a of list) {
    const scope = a.scope ?? 'library';
    if (scope === 'library') {
      if (isLibraryAllowedKind(a.kind)) library++;
    } else if (projectId != null && a.projectId === projectId) {
      project++;
    }
  }
  return { library, project: projectId == null ? null : project };
}

/**
 * 上传归属跟随当前 Tab（纯函数，可单测）：
 * 公共段上传 → scope='library'（store 层 assertLibraryKind 兜底四类校验）；
 * 本项目段且有项目上下文 → scope='project'+当前 projectId；
 * 其余（无项目上下文）→ 兜底 'library'。
 */
export function resolveUploadScope(
  scopeTab: AssetScope,
  projectId: string | null,
): Pick<CreateAssetInput, 'scope' | 'projectId'> {
  if (scopeTab === 'project' && projectId != null) return { scope: 'project', projectId };
  return { scope: 'library' };
}

// ===== 内部辅助 =====

/**
 * 读取全部素材(按 createdAt 降序,最新在前)；含存量记录的惰性迁移写回：
 * - scope 迁移：无 scope 字段视为公共库资产；
 * - 地址清洗（2026-11-05 存量清洗）：历史版本曾把会话 blob: URL 持久化进
 *   data.url / data.dataUrl / coverUrl，刷新后必然失效（用户「看不到图」的直接原因）。
 *   读取时一律剥离（幂等）：blob: 无条件剥；有 storageKey 时冗余的 data: 也剥。
 *   清洗后写回一次，之后每次读取零开销；渲染层只剩 storageKey 一条可靠路径。
 */
// ===== 磁盘直读直写（权威通道）+ 旧通道回退 + CAS 自愈 =====

/** 磁盘读结果：available=false 表示 fs 不可用（未授权/异常），不是「列表为空」 */
type DiskAssetsRead = { available: true; list: Asset[] | null } | { available: false };

/** 读磁盘上的素材信封文件（disk-driver 兼容格式；也兼容裸数组） */
async function readAssetsFromDisk(): Promise<DiskAssetsRead> {
  try {
    const raw = await fsReadFile(ASSETS_FILE_REL);
    if (raw === null) return { available: true, list: null };
    const parsed = JSON.parse(raw) as unknown;
    // 信封 {__lf:1,value}（disk-driver writeEntry 格式）；裸数组按存量兼容读
    const value =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { __lf?: unknown }).__lf === 1
        ? (parsed as { value?: unknown }).value
        : parsed;
    return { available: true, list: Array.isArray(value) ? (value as Asset[]) : null };
  } catch (err) {
    console.warn('[asset-store] 素材记录磁盘读取失败，本次回退旧 localforage 通道:', err);
    return { available: false };
  }
}

/** 读旧 localforage 通道（驱动回退年代的幸存记录可能还在里面；失败按空处理） */
async function readAssetsFromLegacy(): Promise<Asset[]> {
  try {
    return (await appStateStore.getItem<Asset[]>(ASSETS_KEY)) ?? [];
  } catch {
    return [];
  }
}

/** 旧通道里的孤儿记录迁回磁盘（每会话一次；磁盘已有的同 id 记录不覆盖） */
let legacyMergedOnce = false;
/** CAS 自愈重建（每会话一次；仅磁盘可用时执行） */
let casRebuiltOnce = false;


/**
 * CAS 自愈重建：cas_index 有引用、物理文件确实存在、但资产记录丢失（如 app_state 被清）时，
 * 按索引把记录重建回来。幂等、只增不删不改：
 * - id 沿用索引里的 assetId（沿用用户原有 id，与既有节点/槽位引用天然对齐）；
 * - storageKey 指向真实存在的 CAS 文件；字段结构与现有 schema 一致；
 * - 文件不存在的条目绝不造记录（孤儿索引交回 cas-store 收敛，不越权处理）；
 * - `openlib:` 前缀的合成 id 是「仅缓存引用、不建记录」的设计（发送到画布不入我的资产库），
 *   自愈必须跳过，否则会把开源素材重新塞回个人资产库（防回归）；
 * - 项目索引（projects.json）与 assets.json 常被同一次误删一起清掉，此时 CAS 恢复出来的
 *   记录若仍标 `scope:'project'` 会因无项目视图而永远显示为「还没有资产」。
 *   归属项目已不在项目列表 → 一律归公共库，保证恢复的图立刻可见（id/storageKey 不变，
 *   既有节点引用不受影响）。
 */
async function rebuildMissingAssetsFromCasIndex(_existing: Asset[]): Promise<Asset[]> {
  // 2026-11-07 用户指令：彻底禁用「恢复的图片/视频·hash」自愈重建。
  // 该路径会在 app_state 丢失时把 CAS 里的历史产物重新造回素材页，标题只能是垃圾 hash；
  // 生成链路（autoLandGenerationBlob）本身已负责落记录，不依赖这里。
  return [];
}

async function readAll(): Promise<Asset[]> {
  const disk = await readAssetsFromDisk();
  if (!disk.available) {
    // 磁盘不可用：旧 localforage 通道即唯一事实源，每次都读（与旧行为一致；不做成一次性合并）
    return finalizeList(await readAssetsFromLegacy(), false);
  }

  let list: Asset[] = disk.list ?? [];
  let changed = false;

  // 旧 localforage 通道孤儿记录合并（每会话一次）：驱动回退年代写进 IndexedDB 的幸存记录迁回磁盘
  if (!legacyMergedOnce) {
    legacyMergedOnce = true;
    const legacy = await readAssetsFromLegacy();
    if (legacy.length > 0) {
      const byId = new Set(list.map((a) => a.id));
      const orphans = legacy.filter((a) => !byId.has(a.id));
      if (orphans.length > 0) {
        list = [...list, ...orphans];
        changed = true;
      }
    }
  }

  // CAS 自愈重建（每会话一次，仅磁盘可用时）：只补缺失记录，不动存量
  if (!casRebuiltOnce) {
    casRebuiltOnce = true;
    try {
      const rebuilt = await rebuildMissingAssetsFromCasIndex(list);
      if (rebuilt.length > 0) {
        list = [...list, ...rebuilt];
        changed = true;
      }
    } catch (err) {
      console.warn('[asset-store] CAS 自愈重建失败（不影响本次读取）:', err);
    }
  }

  return finalizeList(list, changed);
}

/** 读取收尾：scope 迁移 + 地址清洗 + 变更写回（磁盘/旧通道由 writeAll 内部分派） */
async function finalizeList(list: Asset[], changed: boolean): Promise<Asset[]> {
  // 历史垃圾清理：清掉旧「恢复的图片/视频·hash」记录（只删记录，不动 CAS 文件）
  const junkRe = /^恢复的(图片|视频|音频)[·\-]/;
  const kept = list.filter((a) => !junkRe.test(String(a.title ?? '')));
  const removedJunk = kept.length !== list.length;
  const migrated = migrateAssetScopes(kept);
  const sanitized = sanitizeAssetsList(migrated.list);
  if (changed || removedJunk || migrated.changed || sanitized.changed) {
    await writeAll(sanitized.list);
  }
  return [...sanitized.list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 写入全部素材（写前硬约束）：任何来源（新增/更新/同步拉取/撤销恢复）落盘前
 * 都过一遍地址清洗——持久化状态里不允许存在 blob: 会话地址（未来回归在此拦截）。
 */
async function writeAll(list: Asset[]): Promise<void> {
  const sanitized = sanitizeAssetsList(list).list;
  try {
    // 权威通道：platform/fs 直写（与 disk-driver 同路径同信封；与 cas_index 同一可靠通道）
    await fsWriteFile(ASSETS_FILE_REL, JSON.stringify({ __lf: 1, value: sanitized }, null, 2));
    return;
  } catch (err) {
    console.warn('[asset-store] 素材记录磁盘写入失败，回退旧 localforage 通道（本次会话可能不持久）:', err);
  }
  // 回退通道：仅在 fs 不可用时使用（boot「只降级不白屏」口径）；仍失败则抛给调用方提示，不静默
  await appStateStore.setItem(ASSETS_KEY, sanitized);
}

/** 生成当前 ISO 时间字符串 */
function now(): string {
  return new Date().toISOString();
}

/** 仅供单测：重置会话级一次性守卫（旧通道合并 / CAS 自愈重建），使每条用例可独立验证 */
export function __resetAssetStoreSessionGuardsForTest(): void {
  legacyMergedOnce = false;
  casRebuiltOnce = false;
}

// ===== 公开 API =====

/**
 * 列出所有素材(按 createdAt 降序)
 */
export async function listAssets(): Promise<Asset[]> {
  return readAll();
}

/**
 * 新增素材元数据
 * @param input 由 upload-asset 服务构造的输入(含 storageKey 等)
 * @param opts.source 事件来源标记（如 'autoland' 生成产物自动落库；抽屉据此只刷新不抢焦点分组）
 * @returns 新创建的 Asset(含生成的 id 与时间戳)
 */
/**
 * 持久化前剥离会话 blob: URL（2026-11-05 第三次「预览图/视频失效」根因之一）。
 * uploadAsset 曾把 URL.createObjectURL(file) 的结果写进 data.url / data.dataUrl 并随
 * writeAll 落盘——页面刷新后这些 blob: 必然失效，渲染层回退到它们就报
 * ERR_FILE_NOT_FOUND（预览/视频空白）。
 *
 * 2026-11-05（用户仍看不到图·存量清洗轮）规则升级为「资产级全字段清洗」：
 * 1. blob: 地址无条件剥离——它是会话级地址，刷新后必然失效，持久化它没有任何价值；
 * 2. data: URL 自包含、跨刷新有效：有 storageKey 时剥离（冗余副本，渲染按 key 解析），
 *    无 storageKey 时保留（该资产唯一有效的显示源）；
 * 3. coverUrl 同规则（blob: 必剥）；
 * 4. 文本类 data.content 是正文不是地址，永不触碰。
 */
function sanitizeAssetDataForPersist(data: Asset['data']): Asset['data'] {
  if (data.kind === 'text' || data.kind === 'script') return data;
  const storageKey = (data as { storageKey?: string }).storageKey;
  const url = (data as { url?: string }).url;
  const dataUrl = (data as { dataUrl?: string }).dataUrl;
  const next: Record<string, unknown> = { ...data };
  let changed = false;
  if (typeof url === 'string' && (url.startsWith('blob:') || (storageKey && url.startsWith('data:')))) {
    next.url = '';
    changed = true;
  }
  if (typeof dataUrl === 'string' && (dataUrl.startsWith('blob:') || (storageKey && dataUrl.startsWith('data:')))) {
    next.dataUrl = '';
    changed = true;
  }
  return changed ? (next as Asset['data']) : data;
}

/** 资产级持久化清洗（data + coverUrl）：写入与读取迁移共用的单一实现，幂等 */
export function sanitizePersistedAsset(a: Asset): Asset {
  const data = sanitizeAssetDataForPersist(a.data);
  const coverUrl = a.coverUrl?.startsWith('blob:') ? '' : a.coverUrl;
  if (data === a.data && coverUrl === a.coverUrl) return a;
  return { ...a, data, coverUrl };
}

/** 列表级清洗：返回清洗后列表与是否发生过变化（供读取迁移决定写回） */
function sanitizeAssetsList(list: Asset[]): { list: Asset[]; changed: boolean } {
  let changed = false;
  const out = list.map((a) => {
    const s = sanitizePersistedAsset(a);
    if (s !== a) changed = true;
    return s;
  });
  return { list: out, changed };
}

export async function addAsset(input: CreateAssetInput, opts?: { source?: string }): Promise<Asset> {
  const scope = resolveScope(input);
  // 公共库只收四类素材资产（image/video/audio/text），业务类型创建请求在此兜底拒绝
  if (scope.scope === 'library') assertLibraryKind(input.kind);
  const asset: Asset = {
    id: input.id ?? nanoid(),
    cas: input.cas,
    title: input.title.trim() || '未命名素材',
    kind: input.kind,
    coverUrl: input.coverUrl,
    tags: input.tags ?? [],
    createdAt: now(),
    bytes: input.bytes,
    mimeType: input.mimeType,
    data: sanitizeAssetDataForPersist(input.data),
    folderId: input.folderId ?? null,
    favorite: false,
    ...scope,
  };
  const list = await readAll();
  list.push(asset);
  await writeAll(list);
  nodeActionBus.emit('assets:created', { nodeId: '', assetId: asset.id, kind: asset.kind, source: opts?.source });
  return asset;
}

/**
 * 批量新增素材元数据（单次读写，避免逐条读写导致的竞态问题）
 * 幂等:同一 storageKey(后端 CAS 文件)已存在时跳过创建,复用已有记录,避免重复入库
 * @param inputs 由 upload-asset 服务构造的输入数组
 * @returns 新创建的 Asset 数组(去重跳过的记录不会出现在结果中)
 */
export async function addAssets(inputs: CreateAssetInput[]): Promise<Asset[]> {
  if (inputs.length === 0) return [];
  const list = await readAll();
  const nowStr = now();
  // 预建已有 storageKey 集合,用于去重判断(文本类无 storageKey,天然不参与)
  const existingKeys = new Set<string>();
  for (const a of list) {
    const key = getStorageKeyOfAsset(a);
    if (key) existingKeys.add(key);
  }
  const created: Asset[] = [];
  for (const input of inputs) {
    const key = getStorageKeyOfAsset(input);
    if (key && existingKeys.has(key)) {
      // CAS 防漏（2026-11-04）：上传阶段已用预生成 id 注册过 ref，但记录被去重跳过
      // → 必须释放该悬空 ref，否则 refCount 永不归零、文件永远无法回收
      if (input.cas && input.id) {
        await releaseCas(input.cas.hash, { assetId: input.id }).catch((err) => {
          console.warn('[asset-store] 跳过重复资产时释放 CAS ref 失败:', err);
        });
      }
      continue;
    }
    const scope = resolveScope(input);
    // 公共库只收四类素材资产（image/video/audio/text），业务类型创建请求在此兜底拒绝
    if (scope.scope === 'library') assertLibraryKind(input.kind);
    const asset: Asset = {
      id: input.id ?? nanoid(),
      cas: input.cas,
      title: input.title.trim() || '未命名素材',
      kind: input.kind,
      coverUrl: input.coverUrl,
      tags: input.tags ?? [],
      createdAt: nowStr,
      bytes: input.bytes,
      mimeType: input.mimeType,
      data: sanitizeAssetDataForPersist(input.data),
      folderId: input.folderId ?? null,
      favorite: false,
      ...scope,
    };
    created.push(asset);
    list.push(asset);
    if (key) existingKeys.add(key);
  }
  // 追加而非 unshift，保持 createdAt 降序排序由 readAll 保证
  await writeAll(list);
  // Plan#64: 滚动定位 — 逐条发射资产创建事件
  for (const a of created) {
    nodeActionBus.emit('assets:created', { nodeId: '', assetId: a.id, kind: a.kind });
  }
  return created;
}

/** 提取素材记录/输入的后端 storageKey(文本等纯元数据资产无存储文件,返回 undefined) */
export function getStorageKeyOfAsset(a: Pick<Asset, 'data'> | CreateAssetInput): string | undefined {
  const d = a.data;
  if (d.kind === 'text') return undefined;
  return d.storageKey;
}

/**
 * 更新素材元数据(部分字段,自动更新 createdAt 以提升排序)
 */
export async function updateAsset(id: string, patch: UpdateAssetInput): Promise<Asset | null> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  const current = list[idx];
  if (!current) return null;
  const updated: Asset = {
    ...current,
    title: patch.title ?? current.title,
    tags: patch.tags ?? current.tags,
    coverUrl: patch.coverUrl ?? current.coverUrl,
    folderId: patch.folderId !== undefined ? patch.folderId : current.folderId,
    data: patch.data ?? current.data,
    favorite: patch.favorite !== undefined ? patch.favorite : current.favorite,
    cloudId: patch.cloudId !== undefined ? patch.cloudId : current.cloudId,
    createdAt: now(),
  };
  list[idx] = updated;
  await writeAll(list);
  return updated;
}

/**
 * 删除单个素材元数据(级联:同 storageKey/同 cloudId 孪生记录一并删除,征集 #74 防复活)
 * 仅删除素材记录,不删除底层资源文件。
 * 资源生命周期由后端引用计数管理。
 */
export async function removeAsset(id: string): Promise<Asset | null> {
  const removed = await removeAssets([id]);
  return removed[0] ?? null;
}

/**
 * 批量删除素材元数据(级联删除孪生记录,征集 #74 修复"删不完复活"循环)
 *
 * 背景:同一文件可能对应多条本地记录(同 storageKey 的幽灵孪生/同 cloudId 竞态残留),
 * 只删选中 id 会让孪生幸存 → 下个同步周期把已删云资产原地复活。级联后绝育。
 * @param ids 要删除的素材 id 数组
 * 仅删除素材记录,不删除底层资源文件(由后端引用计数管理)。
 */
export async function removeAssets(ids: string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const list = await readAll();
  const directTargets = list.filter((a) => idSet.has(a.id));
  // 级联键:目标记录的同 storageKey / 同 cloudId 孪生一并删除(文本类无 storageKey,仅按 cloudId)
  // CAS 例外（2026-11-04）：cas: 键是共享内容地址而非孪生信号，同内容的不同资产记录
  // 各自持独立 ref，必须逐条删除+逐条 release，不得按 storageKey 级联（否则 refCount 语义被破坏）
  const cascadeKeys = new Set<string>();
  const cascadeCloudIds = new Set<string>();
  for (const t of directTargets) {
    const k = getStorageKeyOfAsset(t);
    if (k && !isCasStorageKey(k)) cascadeKeys.add(k);
    if (t.cloudId) cascadeCloudIds.add(t.cloudId);
  }
  const deleted: Asset[] = [];
  const remaining: Asset[] = [];
  for (const a of list) {
    const k = getStorageKeyOfAsset(a);
    const hit = idSet.has(a.id)
      || (!!k && !isCasStorageKey(k) && cascadeKeys.has(k))
      || (!!a.cloudId && cascadeCloudIds.has(a.cloudId));
    if (hit) deleted.push(a);
    else remaining.push(a);
  }
  await writeAll(remaining);
  // 释放 CAS 引用：refCount-1，到 0 由 cas-store 删物理文件并摘索引；两端幂等，重复删除不报错
  for (const a of deleted) {
    if (!a.cas) continue;
    await releaseCas(a.cas.hash, { assetId: a.id, projectId: a.projectId }).catch((err) => {
      console.warn('[asset-store] 释放 CAS ref 失败（索引不受影响时可由迁移脚本收敛）:', a.id, err);
    });
  }
  return deleted;
}

/**
 * 清空所有素材元数据(不清理二进制文件)
 * 危险操作,仅供"清空全部"或测试使用
 */
export async function clearAllAssets(): Promise<void> {
  // 双通道都清（磁盘权威文件 + 旧 localforage 兜底），两处都尽力而为、互不阻断
  try {
    await fsRemoveFile(ASSETS_FILE_REL);
  } catch (err) {
    console.warn('[asset-store] 清空素材：磁盘文件删除失败:', err);
  }
  try {
    await appStateStore.removeItem(ASSETS_KEY);
  } catch (err) {
    console.warn('[asset-store] 清空素材：旧通道删除失败:', err);
  }
}

/**
 * 撤销删除：原样恢复 removeAssets 删掉的素材记录（2026-11-05 约定：
 * 公共资产就地删除 + 3 秒浮层撤销，与槽位移除同口径）。
 * - 同 id 幂等：记录还在时跳过，不产生重复；
 * - CAS 资产：物理条目仍在时补挂 ref（撤销 removeAssets 的 releaseCas）；
 *   条目已被 GC（refCount 归零）时不再挂 ref，记录照常恢复（存活探测按「引用已失效」诚实显示）；
 * - 保留原 id/createdAt/scope/projectId/cloudId —— 撤销即回到删除前状态。
 */
export async function restoreAssets(assets: Asset[]): Promise<Asset[]> {
  if (assets.length === 0) return [];
  const list = await readAll();
  const present = new Set(list.map((a) => a.id));
  const restored: Asset[] = [];
  for (const a of assets) {
    if (present.has(a.id)) continue;
    if (a.cas?.hash) {
      // 仅物理文件仍存活时补挂 ref；被 GC 则诚实留断链
      if (await hasCasEntry(a.cas.hash)) {
        await registerCasRef(a.cas.hash, { assetId: a.id, projectId: a.projectId ?? 'library', kind: a.kind }).catch((err) => {
          console.warn('[asset-store] 撤销删除时补挂 CAS ref 失败:', a.id, err);
        });
      }
    }
    restored.push(a);
    list.push(a);
  }
  if (restored.length > 0) {
    await writeAll(list);
    for (const a of restored) {
      nodeActionBus.emit('assets:created', { nodeId: '', assetId: a.id, kind: a.kind });
    }
  }
  return restored;
}

/**
 * 插入或更新素材(同步拉取时使用)
 * 按 cloudId 匹配已有素材,存在则更新,不存在则插入;
 * 无 cloudId 匹配时再按 storageKey 收敛(征集 #74:幽灵记录与云端同文件命中时归并,不再新建孪生)。
 * 竞态防御:同一 cloudId 出现多条(云端创建与本地 markAssetSynced 之间的 pull 竞态)时收敛为一条。
 */
export async function upsertAsset(asset: Asset): Promise<void> {
  const list = await readAll();
  if (asset.cloudId) {
    const dups = list.filter((a) => a.cloudId === asset.cloudId);
    if (dups.length > 1) {
      // 收敛重复:以列表第一条为准合并传入记录,移除其余同 cloudId 记录
      const keep = dups[0]!;
      const cleaned = list.filter((a) => !(a.cloudId === asset.cloudId && a.id !== keep.id));
      const merged = { ...keep, ...asset, id: keep.id };
      const idx = cleaned.findIndex((a) => a.id === keep.id);
      if (idx >= 0) cleaned[idx] = merged;
      else cleaned.push(merged);
      await writeAll(cleaned);
      return;
    }
  }
  const idx = list.findIndex((a) => a.cloudId && a.cloudId === asset.cloudId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...asset };
    await writeAll(list);
    return;
  }
  // storageKey 收敛(征集 #74):同文件已有本地记录时归并(保留本地 id,补全云端身份),
  // 避免无 cloudId 幽灵记录与云端拉取记录同图并存 → 显示重复/删除后复活。
  const incomingKey = getStorageKeyOfAsset(asset);
  if (incomingKey) {
    const keyIdx = list.findIndex((a) => getStorageKeyOfAsset(a) === incomingKey);
    if (keyIdx >= 0) {
      const existing = list[keyIdx]!;
      list[keyIdx] = { ...existing, ...asset, id: existing.id };
      await writeAll(list);
      return;
    }
  }
  list.push(asset);
  await writeAll(list);
}

/**
 * 标记素材已同步(更新 cloudId + version + lastSyncedAt)
 */
export async function markAssetSynced(
  localId: string,
  cloudId: string,
  version: number,
  lastSyncedAt: string,
): Promise<void> {
  const list = await readAll();
  const idx = list.findIndex((a) => a.id === localId);
  if (idx >= 0) {
    const current = list[idx];
    if (current) {
      list[idx] = {
        ...current,
        cloudId,
        version,
        lastSyncedAt,
      };
      await writeAll(list);
    }
  }
}
