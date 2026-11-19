/**
 * workbench-version-detach —— 删除历史版本时把片段自身状态收回（2026-11-16 用户要求）
 *
 * 事故/缺陷：历史里的「版本」只是 `workbench.json` 里 shot.cache.versions 的投影。
 * 只在资产记录里删掉，片段实体仍留着该版本 → 预览继续显示成片、卡片仍是「已完成」，
 * 刷新后还会按 shot 缓存把这一版重新出现在历史里（用户：「删了为什么又回来了」）。
 *
 * 本模块唯一职责：按「已删除的 (shotId, storageKey)」把版本从片段缓存里摘掉，
 * 并保持 `media` = 当前选中版本投影：
 * - 还有别的版本 → 选中最新剩余版本，片段仍是 completed/done；
 * - 一个都不剩 → 片段回到 placeholder 默认空态（media / cache / guide 清空）。
 */
import { updateWorkbenchContainer } from '@/entities/slot-containers.js';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types';

export interface DeletedVersionRef {
  /** 片段 id（资产 data.originNodeId） */
  shotId: string;
  /** 被删版本的媒体键（= shot.cache.versions[].storageKey） */
  storageKey: string;
}

/** 把已删除版本从片段缓存里摘掉；无片段的资产（公共库/画布图）直接跳过 */
export async function detachDeletedShotVersions(projectId: string, refs: DeletedVersionRef[]): Promise<void> {
  if (!projectId || refs.length === 0) return;
  const byShot = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.storageKey) continue;
    const set = byShot.get(ref.shotId) ?? new Set<string>();
    set.add(ref.storageKey);
    byShot.set(ref.shotId, set);
  }
  if (byShot.size === 0) return;
  /** 全局待摘媒体键（不按 shotId 限定，见下方说明） */
  const removedKeysAll = new Set<string>();
  for (const set of byShot.values()) for (const key of set) removedKeysAll.add(key);

  // 2026-11-16 实测：资产记录的 originNodeId 可能指向已不存在的旧片段 id（早期片段被重建过），
  // 只按 shotId 匹配会漏摘 → 删了刷新又回来。改为按 storageKey 全局匹配：
  // 同一媒体键在哪个片段缓存里存在就摘哪个，与标题兜底归组保持同一口径。
  await updateWorkbenchContainer(projectId, (container) => ({
    shots: (container.shots as unknown as WorkbenchShot[]).map((shot): WorkbenchShot => {
      const removedKeys = removedKeysAll;
      if (!removedKeys) return shot;
      const currentVersions = shot.cache?.versions ?? [];
      const versions = currentVersions.filter((v) => !removedKeys.has(v.storageKey));
      if (versions.length === currentVersions.length) return shot;

      const selected = versions.find((v) => v.id === shot.cache?.selectedVersionId)
        ?? [...versions].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
      if (!selected) {
        // 最后一个版本也没了 → 片段回默认空态（未生成），不留旧成片/旧引导
        return {
          ...shot,
          clipState: 'placeholder',
          status: 'pending',
          media: undefined,
          cache: undefined,
          guide: undefined,
        };
      }
      return {
        ...shot,
        clipState: 'completed',
        status: 'done',
        cache: { selectedVersionId: selected.id, versions },
        media: {
          storageKey: selected.storageKey,
          source: 'generated',
          createdAt: selected.createdAt,
          prompt: selected.prompt,
          guide: selected.guide ?? undefined,
        },
      };
    }),
  }));
}
