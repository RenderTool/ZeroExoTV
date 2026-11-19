/**
 * canvas-assets/history-utils - 抽屉「历史」分组纯函数层（可单测）
 *
 * 数据口径（2026-11-04 约定修正）：历史 = **API/生成链路产物**，唯一判据是
 * data.origin === 'generation'（isGenerationAsset）——由生成完成点自动落库
 * （history-autoland）写入，并附 generation 元数据（jobId/provider/model/prompt/
 * durationSec/frames/createdAt）自证来源。
 * 用户手动上传、拖入画布、从素材库添加的资产一律不写该标记 → 不进历史。
 */

import type { Asset, HistorySource } from '@/features/asset-picker/index.js';

export type { HistorySource } from '@/features/asset-picker/index.js';

export type HistoryKind = 'image' | 'video' | 'all';

/**
 * 历史分类（2026-11-19 用户口径）：与主体库同一套——角色 / 场景 / 道具 / 备选。
 * 类型（图片/视频）只在卡片左上角做角标，不再作为分类标签。
 * 判定顺序：资产记录显式 `data.subjectKind`（用户改类型 / MCP 归类）→ 该图属于哪个主体状态
 * （storageKey → 主体 kind）→ 备选。
 */
export type HistoryCategory = 'character' | 'scene' | 'prop' | 'other';

export const HISTORY_CATEGORIES: HistoryCategory[] = ['character', 'scene', 'prop', 'other'];

export function subjectKindToCategory(kind: string | undefined | null): HistoryCategory {
  if (kind === 'character') return 'character';
  if (kind === 'scene') return 'scene';
  if (kind === 'prop') return 'prop';
  return 'other';
}

/** 历史条目分类：显式标注 > 主体状态归属 > 备选 */
export function categoryOfAsset(asset: Asset, keyToKind?: Map<string, string>): HistoryCategory {
  const d = asset.data as { subjectKind?: string; storageKey?: string };
  if (d.subjectKind) return subjectKindToCategory(d.subjectKind);
  const key = d.storageKey;
  if (key && keyToKind?.has(key)) return subjectKindToCategory(keyToKind.get(key));
  return 'other';
}

/**
 * 历史产出来源判定（2026-11-07）：优先读落库字段 data.originSource；
 * 存量记录（该字段上线前产生）按「导演台特征」兜底：本机 provider（zeroexo /
 * comfyui-direct）或导演台标题「片段 N · Ns」。其余一律视为画布生成。
 * 只用于展示分区，不改写资产数据。
 */
export function getHistorySource(asset: Asset): HistorySource {
  const d = asset.data as {
    originSource?: HistorySource;
    generation?: { provider?: string };
  };
  if (d.originSource === 'canvas' || d.originSource === 'director') return d.originSource;
  const provider = d.generation?.provider;
  if (provider === 'zeroexo' || provider === 'comfyui-direct') return 'director';
  if (/^片段\s*\d+/.test(asset.title)) return 'director';
  return 'canvas';
}

/** 单页条数：超过即分页（验收要求 >50 分页） */
export const HISTORY_PAGE_SIZE = 50;

/** 生成产物判据：唯一依据 data.origin === 'generation'（手动上传路径不写此标记） */
export function isGenerationAsset(asset: Asset): boolean {
  return (asset.data as { origin?: string }).origin === 'generation';
}

/**
 * 同一产物被重复落库时只保留一条（2026-11-11 用户反馈：历史里同图两张卡）。
 * 判据：生成产物的 CAS storageKey 相同 = 同一份内容；保留列表里先出现的那条（已按时间倒序）。
 */
export function dedupeGenerationAssets(assets: Asset[]): Asset[] {
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (const a of assets) {
    const key = (a.data as { storageKey?: string } | undefined)?.storageKey;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(a);
  }
  return out;
}

/**
 * 过滤某项目的历史产出（仅生成产物 + 指定 kind），按 createdAt 倒序。
 * source 省略或 'all' = 不按来源过滤（存量调用方/测试零影响）；
 * 传 'canvas' / 'director' = 抽屉来源 Tab 的分区口径。
 */
export function filterHistoryAssets(
  assets: Asset[],
  projectId: string | null,
  kind: HistoryKind,
  source?: HistorySource | 'all',
): Asset[] {
  if (!projectId) return [];
  return dedupeGenerationAssets(assets
    .filter((a) => isGenerationAsset(a)
      && a.projectId === projectId
      && (kind === 'all' || a.kind === kind)
      && (!source || source === 'all' || getHistorySource(a) === source))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

/** 两分类计数（一次遍历；仅生成产物，不分来源；保留给旧调用方） */
export function countHistoryByKind(assets: Asset[], projectId: string | null): { image: number; video: number } {
  let image = 0;
  let video = 0;
  if (projectId) {
    for (const a of dedupeGenerationAssets(assets.filter((x) => isGenerationAsset(x) && x.projectId === projectId))) {
      if (a.kind === 'image') image++;
      else if (a.kind === 'video') video++;
    }
  }
  return { image, video };
}

/**
 * 来源 Tab × 类型 chips 的实时计数（一次遍历）：
 * 每段胶囊徽标显示该来源总数，类型 chips 显示当前来源下该类型的条数。
 */
export function countHistoryBySourceAndKind(
  assets: Asset[],
  projectId: string | null,
): Record<HistorySource, { image: number; video: number; total: number }> {
  const result: Record<HistorySource, { image: number; video: number; total: number }> = {
    canvas: { image: 0, video: 0, total: 0 },
    director: { image: 0, video: 0, total: 0 },
  };
  if (!projectId) return result;
  for (const a of dedupeGenerationAssets(assets.filter((x) => isGenerationAsset(x) && x.projectId === projectId))) {
    const bucket = result[getHistorySource(a)];
    bucket.total++;
    if (a.kind === 'image') bucket.image++;
    else if (a.kind === 'video') bucket.video++;
  }
  return result;
}

/** 当前来源下四个分类的条数（一次遍历；分类口径见 categoryOfAsset） */
export function countHistoryByCategory(
  assets: Asset[],
  projectId: string | null,
  source: HistorySource,
  keyToKind?: Map<string, string>,
): Record<HistoryCategory, number> {
  const out: Record<HistoryCategory, number> = { character: 0, scene: 0, prop: 0, other: 0 };
  if (!projectId) return out;
  for (const a of dedupeGenerationAssets(assets.filter((x) => isGenerationAsset(x) && x.projectId === projectId))) {
    if (getHistorySource(a) !== source) continue;
    out[categoryOfAsset(a, keyToKind)]++;
  }
  return out;
}

/** 公共库已有的内容 hash 集合（历史卡片「加入资产库」按钮据此隐藏） */
export function libraryCasHashes(assets: Asset[]): Set<string> {
  const set = new Set<string>();
  for (const a of assets) {
    if ((a.scope ?? 'library') === 'library' && a.cas?.hash) set.add(a.cas.hash);
  }
  return set;
}

/** 分页切片（page 从 1 起；越界回收到末页） */
export function paginate<T>(items: T[], page: number, pageSize = HISTORY_PAGE_SIZE): { page: number; slice: T[] } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { page: p, slice: items.slice((p - 1) * pageSize, p * pageSize) };
}

/** ISO 时间 → 相对时间（中文粗粒度；与资产卡片同款口径） */
export function fmtRelativeTime(iso: string, now = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = now - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString();
}

/** 毫秒 → mm:ss（视频卡片时长） */
export function fmtDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

