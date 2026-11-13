/**
 * workbench-episodes - 导演台片段按集分组（2026-11-13 用户反馈「导演台没有集数切换」）
 *
 * 数据契约：
 * - 片段归属 = WorkbenchShot.episodeId；缺省 = 未分集（本功能上线前的存量数据）。
 * - 未分集单独一桶，不冒充任何一集；界面可一键归入某一集。
 * - 容器仍是一份平铺 shots[]：落盘时按「剧本集顺序 → 其它集 → 未分集」展平，
 *   每组内部重新编号 1..N（每集镜头号从 1 开始）。
 */

import type { WorkbenchShot } from './workbench-types';

/** 未分集桶的键（不是真实集 id，禁止写进 episodeId） */
export const UNASSIGNED_EPISODE_KEY = '__unassigned__';

export type EpisodeGroups = Record<string, WorkbenchShot[]>;

/** 片段 → 分组键（空串/缺省都算未分集） */
export function episodeKeyOf(shot: WorkbenchShot): string {
  const id = typeof shot.episodeId === 'string' ? shot.episodeId.trim() : '';
  return id || UNASSIGNED_EPISODE_KEY;
}

/** 平铺片段 → 分组（保持组内原顺序；空组不建键） */
export function groupShotsByEpisode(shots: readonly WorkbenchShot[]): EpisodeGroups {
  const groups: EpisodeGroups = {};
  for (const shot of shots) {
    if (!shot || typeof shot !== 'object') continue;
    const key = episodeKeyOf(shot);
    (groups[key] ??= []).push(shot);
  }
  return groups;
}

/** 分组展示/落盘顺序：剧本集顺序 → 剧本已删但还有片段的集（保留数据）→ 未分集最后 */
export function orderEpisodeKeys(groups: EpisodeGroups, episodeIds: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of episodeIds) {
    if (id && groups[id]?.length && !seen.has(id)) { out.push(id); seen.add(id); }
  }
  for (const key of Object.keys(groups)) {
    if (!groups[key]?.length || seen.has(key) || key === UNASSIGNED_EPISODE_KEY) continue;
    out.push(key); seen.add(key);
  }
  if (groups[UNASSIGNED_EPISODE_KEY]?.length) out.push(UNASSIGNED_EPISODE_KEY);
  return out;
}

/** 分组 → 平铺：每组内部重排 number 1..N；未分集不带 episodeId */
export function flattenEpisodeGroups(groups: EpisodeGroups, order: readonly string[]): WorkbenchShot[] {
  const out: WorkbenchShot[] = [];
  for (const key of order) {
    const list = groups[key] ?? [];
    list.forEach((shot, i) => {
      if (key === UNASSIGNED_EPISODE_KEY) {
        const { episodeId: _drop, ...rest } = shot;
        out.push({ ...rest, number: i + 1 });
      } else {
        out.push({ ...shot, episodeId: key, number: i + 1 });
      }
    });
  }
  return out;
}

/** 首次进入选哪一集：记忆里的集 → 剧本当前集（有片段才用）→ 第一个有片段的集 → 未分集 → 第一集 */
export function pickInitialEpisodeKey(
  groups: EpisodeGroups,
  episodeIds: readonly string[],
  opts: { remembered?: string | null; scriptActiveId?: string | null } = {},
): string | null {
  if (episodeIds.length === 0) return null; // 单集项目/无剧本：不分组，行为同旧版
  const remembered = opts.remembered ?? null;
  if (remembered && (remembered === UNASSIGNED_EPISODE_KEY ? groups[remembered]?.length : episodeIds.includes(remembered))) {
    return remembered;
  }
  const active = opts.scriptActiveId ?? null;
  if (active && episodeIds.includes(active) && groups[active]?.length) return active;
  const firstWithShots = episodeIds.find((id) => groups[id]?.length);
  if (firstWithShots) return firstWithShots;
  if (groups[UNASSIGNED_EPISODE_KEY]?.length) return UNASSIGNED_EPISODE_KEY;
  return episodeIds[0] ?? null;
}
