/**
 * canvas-assets/history-utils - 抽屉「历史」分组纯函数层（可单测）
 *
 * 数据口径（2026-11-04 约定修正）：历史 = **API/生成链路产物**，唯一判据是
 * data.origin === 'generation'（isGenerationAsset）——由生成完成点自动落库
 * （history-autoland）写入，并附 generation 元数据（jobId/provider/model/prompt/
 * durationSec/frames/createdAt）自证来源。
 * 用户手动上传、拖入画布、从素材库添加的资产一律不写该标记 → 不进历史。
 */

import type { Asset } from '@/features/asset-picker/index.js';

export type HistoryKind = 'image' | 'video';

/** 单页条数：超过即分页（验收要求 >50 分页） */
export const HISTORY_PAGE_SIZE = 50;

/** 生成产物判据：唯一依据 data.origin === 'generation'（手动上传路径不写此标记） */
export function isGenerationAsset(asset: Asset): boolean {
  return (asset.data as { origin?: string }).origin === 'generation';
}

/** 过滤某项目的历史产出（仅生成产物 + 指定 kind），按 createdAt 倒序 */
export function filterHistoryAssets(assets: Asset[], projectId: string | null, kind: HistoryKind): Asset[] {
  if (!projectId) return [];
  return assets
    .filter((a) => isGenerationAsset(a) && a.projectId === projectId && a.kind === kind)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 两分类计数（一次遍历；仅生成产物） */
export function countHistoryByKind(assets: Asset[], projectId: string | null): { image: number; video: number } {
  let image = 0;
  let video = 0;
  if (projectId) {
    for (const a of assets) {
      if (!isGenerationAsset(a) || a.projectId !== projectId) continue;
      if (a.kind === 'image') image++;
      else if (a.kind === 'video') video++;
    }
  }
  return { image, video };
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

/**
 * 资产 → 画布节点定位：
 * 1) data.originNodeId（生成落库时写入）且节点仍在图中 → 命中；
 * 2) 兜底按 storageKey 扫节点（资产拖回画布建的节点带 data.storageKey）；
 * 3) 都没有 → null（调用方提示「未找到对应节点」）。
 */
export function findAssetNodeId(
  graph: { nodes: Array<{ id: string; data?: unknown }> } | null | undefined,
  asset: Asset,
): string | null {
  if (!graph) return null;
  const d = asset.data as { originNodeId?: string; storageKey?: string };
  if (d.originNodeId && graph.nodes.some((n) => n.id === d.originNodeId)) return d.originNodeId;
  if (d.storageKey) {
    const hit = graph.nodes.find(
      (n) => (n.data as { storageKey?: string } | undefined)?.storageKey === d.storageKey,
    );
    if (hit) return hit.id;
  }
  return null;
}
