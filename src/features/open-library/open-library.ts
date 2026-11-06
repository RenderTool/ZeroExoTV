/**
 * 开源资产库（Open Library）只读接口 · 2026-11-05
 *
 * 数据源：photoai.life 五库 + shisei.indaloop.app（CC0 姿势）。
 * 站点自带内容：索引与缩略图随构建发布在站点根 /openlib/（public/openlib/），
 * 任何用户打开站点即可见——无需导入、无需选目录、离线可用。
 * 原图不打包：运行时按需从条目 cdnUrl 拉取，命中后缓存到用户数据目录 CAS（复用现有缓存链路）。
 * 独立作用域：不进用户资产库（zeroexo:assets）、只读（本模块无任何写 API）。
 *
 * 18+ 门控：adult 条目默认隐藏；isAgeConfirmed() 为 true 且查询传 includeAdult 时才返回。
 *   年龄确认为全局一次生效、可撤销，存 localStorage。
 * 性能：按库懒加载索引文件 + 查询侧分页（pageSize 默认 60），UI 层只渲染单页。
 */

/** 站点根下的 openlib 路径（Vite BASE_URL 兼容子路径部署） */
const SITE_BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

async function readJsonFromSite<T>(rel: string): Promise<T | null> {
  try {
    const res = await fetch(`${SITE_BASE}openlib/${rel}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 站点根下 openlib 资源的完整 URL（含 Vite BASE_URL 子路径部署兼容）。
 * 供同源资源引用使用（如 cdnUrl 拿不到高清原图时的打包缩略图降级源）。
 */
export function openLibSiteUrl(rel: string): string {
  return `${SITE_BASE}${rel.replace(/^\//, '')}`;
}

// ===== 类型 =====

export type OpenLibGalleryId =
  | 'portrait' | 'costume' | 'pose' | 'pose-depth' | 'shisei' | 'character' | 'costume-anime';

export interface OpenLibLicense {
  /** cc0 | restricted（原站自述口径） */
  type: 'cc0' | 'restricted';
  /** 是否允许商用 */
  commercialUse: boolean;
  /** 是否允许再分发 */
  redistribution: boolean;
  /** 原站授权自述（逐字保留） */
  note: string;
}

export interface OpenLibCategory { id: string; title: string; count: number }

export interface OpenLibGalleryMeta {
  id: OpenLibGalleryId;
  title: string;
  /** 是否已建条目索引（false = 仅有库级元数据，无本地条目数据） */
  indexed: boolean;
  license: OpenLibLicense;
  /** 原站链接（photoai.life 库页） */
  sourceUrl: string;
  /** 图片 CDN 域名（远程引用用） */
  cdnDomains: string[];
  entryCount: number;
  localCount: number;
  adultCount: number;
  categories?: OpenLibCategory[];
  note?: string;
}

export interface OpenLibEntry {
  /** 条目 id，形如 openlib:<gallery>:<srcId> */
  id: string;
  gallery: OpenLibGalleryId;
  /** 源站原始 id（逐字保留） */
  srcId: string;
  /** 中文标题（源 name 逐字保留；日文标题源数据未提供，不猜填） */
  title: string;
  subtitle?: string;
  /** 分类（源 series） */
  category: string;
  group?: string;
  /** 服装库的英文关键词（可并入提示词框） */
  promptText?: string;
  /** 姿势库机位（front/side/diag/high/low） */
  angles?: string[];
  tags: string[];
  /** 18+ 标记（源 nsfw / shisei rating!=general），默认隐藏 */
  adult: boolean;
  /** bundled=缩略图随站点发布；remote=仅远程 CDN 引用 */
  storage: 'bundled' | 'remote';
  /** bundled 时为站点根相对路径（/openlib/thumbs/...）；远程时为 CDN URL */
  imageUrl: string;
  /** 原站大图地址（原图按需拉取并缓存到用户 CAS） */
  cdnUrl: string;
  /** 原站库页链接 */
  sourceUrl: string;
  license: OpenLibLicense;
  /** 日文标题（shisei 库提供，逐字保留） */
  titleJp?: string;
}

export interface OpenLibMeta {
  schemaVersion: number;
  generatedAt: string;
  relocatedAt?: string;
  source: { repo: string; site: string };
  ageGate: { defaultHidden: boolean; note: string };
  /** 随站点发布的资源根与缩略图根（/openlib/、/openlib/thumbs/） */
  bundle?: { root: string; thumbs: string; note: string };
  galleries: Record<OpenLibGalleryId, OpenLibGalleryMeta>;
  /** v2：bundled=随站点发布的条目数；v1 旧字段 local 兼容读取 */
  totals: { entries: number; bundled?: number; local?: number; remote: number; adult: number };
}

export interface OpenLibQuery {
  /** 库过滤；缺省 = 全部已索引库 */
  gallery?: OpenLibGalleryId;
  /** 分类过滤（库内 series id） */
  category?: string;
  /** 关键字（title/srcId/promptText/tags，不区分大小写） */
  keyword?: string;
  /** 是否包含 18+ 条目；需年龄确认通过才生效 */
  includeAdult?: boolean;
  /** 从 1 开始；缺省 1 */
  page?: number;
  /** 缺省 60 */
  pageSize?: number;
}

export interface OpenLibPage {
  items: OpenLibEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** 因 18+ 默认隐藏而不在本查询结果中的条数（提示 UI 显示解锁入口） */
  adultHidden: number;
  /**
   * 当前库内各分类的可用条数（2026-11-05 修复「有计数、无结果」）：
   * 与列表过滤**同一份数据、同一 predicate、同一归一化**，且已应用 18+ 门控——
   * UI 分类条必须用这里的数字，不得再用 meta.json 的静态统计（那份统计可能与
   * 条目实际字段不一致，如 shisei 的 meta 按 group 聚合而条目 category 是 std/sexy）。
   */
  categoryCounts?: Record<string, number>;
}

// ===== 分类归一化 / 匹配（计数与过滤唯一规则） =====

/**
 * 分类键归一化：全角→半角（NFKC）+ 去首尾空白 + 小写。
 * 计数（categoryCounts）与过滤（queryOpenLib.category）必须都走本函数，否则
 * 「内衣」/「內衣」、「Ａ」/「A」这类同义分类会出现「有计数、无结果」。
 */
export function normalizeOpenLibCategory(value: string): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

/**
 * 条目是否命中分类键。命中字段（任一即可，全部走同一归一化）：
 * - `category`（源 series / 粗分类，多数库使用）
 * - `group`（细分类；shisei 的 meta 分类就来自这一字段）
 * - `tags` 中的 `class:<名称>`（源数据用 tags 承载分类时的兼容字段）
 * 之所以多字段：meta.json 的分类统计与 entries-*.json 的字段并不总是同一个
 * （shisei 统计按 group，条目过滤字段是 category），只认 category 会让整条分类条全空。
 */
export function entryMatchesCategory(entry: OpenLibEntry, categoryId: string): boolean {
  const key = normalizeOpenLibCategory(categoryId);
  if (!key) return true;
  if (normalizeOpenLibCategory(entry.category) === key) return true;
  if (entry.group && normalizeOpenLibCategory(entry.group) === key) return true;
  for (const tag of entry.tags ?? []) {
    const sep = tag.indexOf(':');
    if (sep <= 0) continue;
    if (normalizeOpenLibCategory(tag.slice(0, sep)) !== 'class') continue;
    if (normalizeOpenLibCategory(tag.slice(sep + 1)) === key) return true;
  }
  return false;
}

// ===== 年龄确认（全局一次生效，可撤销） =====

const AGE_GATE_KEY = 'zeroexo:openlib-age-confirmed';

export function isAgeConfirmed(): boolean {
  try {
    return localStorage.getItem(AGE_GATE_KEY) === '1';
  } catch {
    return false;
  }
}

export function confirmAge(): void {
  try {
    localStorage.setItem(AGE_GATE_KEY, '1');
  } catch { /* 存储不可用时静默降级为未确认 */ }
}

export function revokeAgeConfirmation(): void {
  try {
    localStorage.removeItem(AGE_GATE_KEY);
  } catch { /* 同上 */ }
}

// ===== 加载（懒加载 + 缓存） =====

interface GalleryFile { gallery: string; categories: OpenLibCategory[]; entries: OpenLibEntry[] }

let metaCache: Promise<OpenLibMeta | null> | null = null;
const galleryCache = new Map<string, Promise<GalleryFile | null>>();

/** 开源库总览（库级元数据/授权/分类/计数）——首页分类展示用；从站点根加载 */
export function getOpenLibMeta(): Promise<OpenLibMeta | null> {
  if (!metaCache) metaCache = readJsonFromSite<OpenLibMeta>('meta.json');
  return metaCache;
}

function loadGallery(id: string): Promise<GalleryFile | null> {
  let p = galleryCache.get(id);
  if (!p) {
    p = readJsonFromSite<GalleryFile>(`entries-${id}.json`);
    galleryCache.set(id, p);
  }
  return p;
}

function invalidateCache(): void {
  metaCache = null;
  galleryCache.clear();
}

// ===== 查询（过滤 + 分页；无任何写 API，天然只读） =====

/**
 * 分页查询开源库条目。
 * 18+ 条目：默认隐藏（adultHidden 返回被隐藏数量）；includeAdult 且 isAgeConfirmed() 才返回。
 */
export async function queryOpenLib(query: OpenLibQuery = {}): Promise<OpenLibPage> {
  const meta = await getOpenLibMeta();
  if (!meta) {
    return { items: [], page: 1, pageSize: query.pageSize ?? 60, total: 0, totalPages: 1, adultHidden: 0 };
  }
  const pageSize = query.pageSize ?? 60;
  const page = Math.max(1, query.page ?? 1);
  const adultOk = query.includeAdult === true && isAgeConfirmed();

  const galleryIds = query.gallery
    ? [query.gallery]
    : (Object.keys(meta.galleries) as OpenLibGalleryId[]).filter((g) => meta.galleries[g]?.indexed);

  const keyword = query.keyword?.trim().toLowerCase() ?? '';
  const categoryKey = query.category ? normalizeOpenLibCategory(query.category) : '';
  let matched: OpenLibEntry[] = [];
  let adultHidden = 0;
  // 年龄门控后的可见条目（分类计数与列表过滤共用这一份数据）
  const visible: OpenLibEntry[] = [];
  for (const gid of galleryIds) {
    const file = await loadGallery(gid);
    if (!file) continue;
    for (const e of file.entries) {
      if (e.adult && !adultOk) { adultHidden++; continue; }
      visible.push(e);
      if (categoryKey && !entryMatchesCategory(e, query.category as string)) continue;
      if (keyword) {
        const hay = [e.title, e.srcId, e.subtitle, e.promptText, ...e.tags].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(keyword)) continue;
      }
      matched.push(e);
    }
  }

  // 分类计数 = 对同一份可见条目、用同一 predicate 求长度（不用 meta.json 静态统计）
  const categoryCounts: Record<string, number> = {};
  for (const gid of galleryIds) {
    for (const c of (meta.galleries[gid]?.categories ?? [])) {
      const n = visible.filter((e) => e.gallery === gid && entryMatchesCategory(e, c.id)).length;
      categoryCounts[c.id] = (categoryCounts[c.id] ?? 0) + n;
    }
  }

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: matched.slice(start, start + pageSize),
    page: Math.min(page, totalPages),
    pageSize,
    total,
    totalPages,
    adultHidden,
    categoryCounts,
  };
}

/** 按条目 id 精确取一条（详情/插入节点用）；adult 条目同样走年龄门控 */
export async function getOpenLibEntry(id: string, includeAdult = false): Promise<OpenLibEntry | null> {
  const gallery = id.split(':')[1];
  if (!gallery) return null;
  const file = await loadGallery(gallery);
  const e = file?.entries.find((x) => x.id === id) ?? null;
  if (!e) return null;
  if (e.adult && !(includeAdult && isAgeConfirmed())) return null;
  return e;
}

/** 库列表（首页分类展示用）：按 meta 顺序返回已索引库 + 分类 */
export async function listOpenLibGalleries(): Promise<OpenLibGalleryMeta[]> {
  const meta = await getOpenLibMeta();
  if (!meta) return [];
  return (Object.keys(meta.galleries) as OpenLibGalleryId[]).map((g) => meta.galleries[g]);
}

export { invalidateCache as __invalidateOpenLibCache };
