/**
 * canvas-script - 画布剧本绑定服务（本地版：一个画布对应一个剧本）
 *
 * 契约（2026-11-02 约定）：
 * - 一个画布项目默认自带一个剧本：创建项目时即生成，并按 canvasId 绑定到该画布。
 * - 剧本资产沿用原数据结构：kind='script'，data.content 存 { episodes: Episode[] } JSON；
 *   仅在 data 上多一个可选 canvasId（照 kind='plan' 的「画布强关联」先例）。
 * - 主页资产库不按画布过滤（主页新建 / 查看行为不变）；画布抽屉的「剧本」分组只看本画布剧本。
 * - 剧本节点（画布内）是被挂载的运行态：同一画布只保留一个剧本节点。
 */

import { addAssets, listAssets, updateAsset } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import { autoEpisodeTitle } from '@/entities/script-store.js';
import { onAssetCreated, onAssetUpdated } from '@/services/sync/sync-service.js';

/** 剧本资产 → 所属画布 id（未绑定返回 null） */
export function getScriptCanvasId(asset: Asset | null | undefined): string | null {
  if (!asset) return null;
  return (asset.data as { canvasId?: string } | undefined)?.canvasId ?? null;
}

/** 找出绑定到指定画布的剧本资产（一个画布一个剧本；资产列表按 createdAt 降序，取最新一条） */
export function findCanvasScript(assets: Asset[], canvasId: string | null | undefined): Asset | undefined {
  if (!canvasId) return undefined;
  return (Array.isArray(assets) ? assets : []).find(
    (a) => (a.kind as string) === 'script' && getScriptCanvasId(a) === canvasId,
  );
}

/** 解析剧本资产的剧集（容错：脏 JSON / 旧结构一律降级为空集） */
export function parseScriptEpisodes(asset: Asset | null | undefined): Episode[] {
  const raw = (asset?.data as { content?: string } | undefined)?.content ?? '';
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : (parsed?.episodes ?? []);
    return (list as Array<Partial<Episode>>).map((ep, idx) => ({
      id: ep.id ?? `ep-${idx + 1}`,
      number: typeof ep.number === 'number' ? ep.number : idx + 1,
      // 2026-11-04：兜底标题统一 autoEpisodeTitle（按集号，禁用列表下标自拼——下标在乱序/删集后会错号）
      title: ep.title ?? autoEpisodeTitle(typeof ep.number === 'number' ? ep.number : idx + 1),
      content: ep.content ?? '',
    })) as Episode[];
  } catch {
    return [];
  }
}

/** 默认剧本内容：单集空剧本 */
export function buildDefaultEpisodes(): Episode[] {
  // 2026-11-04：默认首集标题统一 autoEpisodeTitle（禁止硬编码自拼）
  return [{ id: 'ep-1', number: 1, title: autoEpisodeTitle(1), content: '' }];
}

/** 创建并绑定一个画布剧本资产 */
export async function createCanvasScript(canvasId: string, title: string, episodes?: Episode[]): Promise<Asset | null> {
  if (!canvasId) return null;
  const eps = episodes && episodes.length > 0 ? episodes : buildDefaultEpisodes();
  const content = JSON.stringify({ episodes: eps });
  const [asset] = await addAssets([{
    title,
    kind: 'script',
    tags: [],
    bytes: content.length,
    mimeType: 'application/json',
    data: { kind: 'script', content, canvasId },
  }]);
  if (asset) onAssetCreated(asset.id);
  return asset ?? null;
}

/** 幂等：确保该画布已有剧本（老项目兜底 / 打开画布时调用） */
export async function ensureCanvasScript(canvasId: string, title: string): Promise<Asset | null> {
  if (!canvasId) return null;
  const existing = findCanvasScript(await listAssets(), canvasId);
  if (existing) return existing;
  return createCanvasScript(canvasId, title);
}

/** 复制画布剧本（复制项目时用：内容继承，绑定改到新画布） */
export async function copyCanvasScript(fromCanvasId: string, toCanvasId: string, title: string): Promise<Asset | null> {
  if (!fromCanvasId || !toCanvasId) return null;
  const source = findCanvasScript(await listAssets(), fromCanvasId);
  if (!source) return createCanvasScript(toCanvasId, title);
  return createCanvasScript(toCanvasId, source.title || title, parseScriptEpisodes(source));
}

/** 把剧本资产绑定到画布（同画布的其它剧本自动解绑，保证一个画布一个剧本） */
export async function bindCanvasScript(assetId: string, canvasId: string): Promise<void> {
  if (!assetId || !canvasId) return;
  const all = await listAssets();
  const target = all.find((a) => a.id === assetId);
  if (!target) return;
  for (const a of all) {
    if (a.id === assetId) continue;
    if ((a.kind as string) === 'script' && getScriptCanvasId(a) === canvasId) {
      await updateAsset(a.id, { data: { ...(a.data as { kind: 'script'; content: string }), canvasId: undefined } });
    }
  }
  await updateAsset(assetId, { data: { ...(target.data as { kind: 'script'; content: string }), canvasId } });
  onAssetUpdated(assetId);
}

/** 把剧本内容写回本画布绑定的剧本资产（一个画布一个剧本：复用同一条，不新建） */
export async function saveCanvasScript(canvasId: string, title: string, episodes: Episode[]): Promise<Asset | null> {
  if (!canvasId) return null;
  const content = JSON.stringify({ episodes });
  const existing = findCanvasScript(await listAssets(), canvasId);
  if (!existing) return createCanvasScript(canvasId, title, episodes);
  const updated = await updateAsset(existing.id, {
    title: title || existing.title,
    data: { ...(existing.data as { kind: 'script'; content: string }), content },
  });
  if (updated) onAssetUpdated(updated.id);
  return updated;
}
