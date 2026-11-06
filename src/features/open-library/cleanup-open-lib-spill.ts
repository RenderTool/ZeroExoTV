/**
 * cleanupOpenLibSpillAssets - 清理「发送到画布」误入个人资产库的历史遗留（2026-11-05）
 *
 * 背景：旧版 importOpenLibEntry 会把开源素材 addAsset 进用户资产库（scope=library），
 * 造成「点发送 → 我的资产库多出坏缩略图卡片」。该路径已重做为仅 CAS 缓存+引用。
 *
 * 识别口径（自动识别「由开源发送动作产生且未被真实使用」）：
 * - data.sourceEntry.source === 'openlib'（开源导入标记）
 * - 且任何项目图数据中都不含其 storageKey（未被画布节点/槽位真实引用）
 * 满足两条即删除；被真实引用的条目保留，由引用方持有。
 */
import { listAssets, removeAssets } from '@/features/asset-picker/asset-store.js';
import { listProjects, loadProjectGraph } from '@zeroexo/plugin-persistence';
import type { Asset } from '@/features/asset-picker/index.js';

/** 会话级去重：清理只自动执行一次 */
let cleanupStarted = false;
let cleanupPromise: Promise<string[]> | null = null;

function isOpenLibSpill(asset: Asset): boolean {
  const data = asset.data as { sourceEntry?: { source?: string } } | null | undefined;
  return asset.scope === 'library' && data?.sourceEntry?.source === 'openlib';
}

/** 执行清理，返回被删除的资产 id 列表（空数组=无需清理） */
export async function cleanupOpenLibSpillAssets(): Promise<string[]> {
  const assets = await listAssets();
  const spilled = assets.filter(isOpenLibSpill);
  if (spilled.length === 0) return [];

  // 「真实使用」判定：任一项目图序列化文本包含该 storageKey 即视为被引用
  const projects = await listProjects().catch(() => []);
  const graphTexts: string[] = [];
  for (const p of projects) {
    const g = await loadProjectGraph(p.id).catch(() => null);
    if (g) graphTexts.push(JSON.stringify(g));
  }
  const removable = spilled.filter((a) => {
    const key = (a.data as { storageKey?: string } | null | undefined)?.storageKey;
    if (!key) return true; // 无引用键的导入残留，必删
    return !graphTexts.some((text) => text.includes(key));
  });
  if (removable.length === 0) return [];
  await removeAssets(removable.map((a) => a.id));
  return removable.map((a) => a.id);
}

/** 会话级自动清理入口（幂等）：供开源库浏览器挂载时调用，删除误入库条目 */
export function runOpenLibSpillCleanupOnce(): Promise<string[]> {
  if (cleanupStarted) return cleanupPromise ?? Promise.resolve([]);
  cleanupStarted = true;
  cleanupPromise = cleanupOpenLibSpillAssets().catch((err) => {
    console.warn('[open-library] 清理误入库条目失败:', err);
    return [];
  });
  return cleanupPromise;
}
