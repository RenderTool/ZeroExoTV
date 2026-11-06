/**
 * fix-episode-titles.cjs 规则对照 + 幂等测试（2026-11-04）
 * 脚本 repairPlan 镜像 script-store.planEpisodeTitleRepair——本测试保证两侧逐条同义，
 * 防止未来只改一侧造成「单测过了、脚本修错」的漂移。
 */
import { describe, expect, it } from 'vitest';
import {
  planEpisodeTitleRepair, isDefaultEpisodeTitle, isDirtyEpisodeTitle,
} from '@/entities/script-store.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import scriptRules from '../../../scripts/fix-episode-titles.cjs';

const FIXTURE = [
  { id: 'ep-1', number: 1, title: '第1集2集' },   // 拼接脏值
  { id: 'ep-2', number: 2, title: '第 2 集' },    // 空格变体
  { id: 'ep-3', number: 3, title: '第7集' },      // 编号错乱（默认模式数字不符）
  { id: 'ep-4', number: 4, title: '第4集第4集' }, // 重复编号
  { id: 'ep-5', number: 5, title: '夜宴' },       // 自定义（不动）
  { id: 'ep-6', number: 6, title: '' },           // 空（不动）
  { id: 'ep-7', number: 7, title: '第7集' },      // 干净默认（不动）
];

const CASES: Array<[string, number]> = [
  ['第1集2集', 1], ['第 1 集', 1], ['第1集', 1], ['夜宴', 4], ['第7集', 3], ['', 1], [null as unknown as string, 2],
];

describe('fix-episode-titles.cjs 规则镜像 script-store', () => {
  it('repairPlan 与 planEpisodeTitleRepair 对同一 fixture 输出完全一致（4 条修复计划）', () => {
    const fromScript = scriptRules.repairPlan(FIXTURE);
    const fromStore = planEpisodeTitleRepair(FIXTURE);
    expect(fromScript).toEqual(fromStore);
    expect(fromScript).toHaveLength(4);
  });

  it('脚本幂等：按 plan 修复后再跑两侧均为 0 改动（二次运行零写入）', () => {
    const plan = scriptRules.repairPlan(FIXTURE);
    const byId = new Map(plan.map((p: { episodeId: string; to: string }) => [p.episodeId, p.to]));
    const repaired = FIXTURE.map((ep) => (byId.has(ep.id) ? { ...ep, title: byId.get(ep.id)! } : ep));
    expect(scriptRules.repairPlan(repaired)).toHaveLength(0);
    expect(planEpisodeTitleRepair(repaired)).toHaveLength(0);
  });

  it('isDirtyEpisodeTitle / isDefaultEpisodeTitle 镜像逐例一致', () => {
    for (const [title, n] of CASES) {
      expect(scriptRules.isDirtyEpisodeTitle(title, n)).toBe(isDirtyEpisodeTitle(title, n));
      expect(scriptRules.isDefaultEpisodeTitle(title, n)).toBe(isDefaultEpisodeTitle(title, n));
    }
  });
});
