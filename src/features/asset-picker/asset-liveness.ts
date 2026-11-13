/**
 * asset-liveness —— 过滤引用已失效的资产（2026-11-11 用户反馈）
 *
 * 症状：用户早已删除的资源仍出现在「资产 → 项目/全局」列表里（文件其实没了，只剩一条死记录）。
 * 规则：列表只展示**文件仍然存在**的资产：
 * - cas 资产：CAS 索引里仍有该 hash；
 * - 旧 storageKey：对应文件存在；
 * - 文本类：记录本身即内容，直接保留；
 * - 没有任何落盘键也没有内容：视为死记录，隐藏。
 * 只读，不删记录（删除由用户显式操作触发，删完即时清理文件）。
 */
import { readCasIndex, parseCasStorageKey } from '@/entities/cas-store';
import { stat } from '@/platform/fs';
import type { Asset } from './index.js';

export async function filterLiveAssets(assets: Asset[]): Promise<Asset[]> {
  if (assets.length === 0) return assets;
  let index: Awaited<ReturnType<typeof readCasIndex>> | null = null;
  const ensureIndex = async (): Promise<Awaited<ReturnType<typeof readCasIndex>>> => {
    if (!index) {
      index = await readCasIndex().catch(() => ({ schemaVersion: 1, entries: {} } as Awaited<ReturnType<typeof readCasIndex>>));
    }
    return index;
  };

  const checks = await Promise.all(assets.map(async (asset): Promise<Asset | null> => {
    const data = (asset.data ?? {}) as Record<string, unknown>;
    const kind = data.kind;
    if (kind === 'text' || kind === 'script') return asset;
    if (asset.cas?.hash) {
      const idx = await ensureIndex();
      if (idx.entries[asset.cas.hash]) return asset;
      // 索引缺项但 CAS 文件实际存在（手工导入/索引未回写）：仍应显示，不能静默隐藏
      const ext = asset.cas.ext || 'bin';
      const s = await stat(`media/cas/${asset.cas.hash}.${ext}`).catch(() => null);
      return s ? asset : null;
    }
    const storageKey = typeof data.storageKey === 'string' ? data.storageKey : '';
    if (storageKey.startsWith('cas:')) {
      const parsed = parseCasStorageKey(storageKey);
      if (!parsed) return null;
      const idx = await ensureIndex();
      return idx.entries[parsed.hash] ? asset : null;
    }
    if (storageKey && !storageKey.startsWith('blob:')) {
      const s = await stat(storageKey).catch(() => null);
      return s ? asset : null;
    }
    // 没有落盘键：只有还带着内容（内联 dataURL / 文本）才保留
    return data.dataUrl || data.url || data.content ? asset : null;
  }));

  return checks.filter((a): a is Asset => a !== null);
}
