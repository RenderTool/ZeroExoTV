/**
 * 主体数据层统一回归（2026-11-08）
 *
 * 口径：基础状态是 states[0] 真节点（id = '__base__'），不再有 baseState 单对象；
 * 旧数据读盘时幂等迁移，六个旧字段一个不能丢，step 不重排，已落盘的引用 id 不变。
 */
import { describe, expect, it } from 'vitest';
import {
  SUBJECT_BASE_STATE_ID,
  baseStateNodeOf,
  createSubjectNode,
  createSubjectTree,
  migrateSubjectTree,
  migrateSubjectTrees,
  nextStateStep,
  nonBaseStates,
  treeEpisodeRank,
  type LegacySubjectTree,
} from './subject-tree-types';

describe('主体数据层统一（states[0] = 基础状态）', () => {
  it('createSubjectTree 直接产出基础节点；树上不再有 baseState 字段', () => {
    const tr = createSubjectTree('character', '女鬼');
    expect(tr.states).toHaveLength(1);
    expect(tr.states[0]?.id).toBe(SUBJECT_BASE_STATE_ID);
    expect(tr.states[0]?.step).toBe(1);
    expect((tr as unknown as { baseState?: unknown }).baseState).toBeUndefined();
    expect(baseStateNodeOf(tr)?.id).toBe(SUBJECT_BASE_STATE_ID);
    expect(nonBaseStates(tr)).toHaveLength(0);
  });

  it('旧数据迁移：提示词/定妆图/状态名/集数/模板/幂等键全保留，step 不重排', () => {
    const legacy: LegacySubjectTree = {
      rootId: 'r1', name: '女鬼', kind: 'character', aliases: [],
      baseState: {
        name: '正常人类',
        prompt: '三视图模板',
        templateType: 'creature_reference',
        templateReason: '非人形',
        referenceImages: [{ key: 'cas:base.png', type: 'image' }],
        aiStableKey: 'r1_base',
        appearEpisodes: [2],
      },
      states: [{
        id: 's1', state: '恶鬼', type: 'image', step: 2,
        deltaPrompt: 'd', fullPrompt: 'f', recognitionTerms: [],
        media: [{ key: 'cas:s1.png', type: 'image' }],
        source: 'ai', baseRef: 'r1', appearEpisodes: [1],
      }],
    };
    const next = migrateSubjectTree(legacy);
    expect((next as unknown as { baseState?: unknown }).baseState).toBeUndefined();
    expect(next.states).toHaveLength(2);

    const base = next.states[0]!;
    expect(base.id).toBe(SUBJECT_BASE_STATE_ID);
    expect(base.state).toBe('正常人类');
    expect(base.fullPrompt).toBe('三视图模板');
    expect(base.media).toEqual([{ key: 'cas:base.png', type: 'image' }]);
    expect(base.appearEpisodes).toEqual([2]);
    expect(base.templateType).toBe('creature_reference');
    expect(base.templateReason).toBe('非人形');
    expect(base.aiStableKey).toBe('r1_base');
    expect(base.step).toBe(1);

    expect(next.states[1]?.id).toBe('s1');
    expect(next.states[1]?.step).toBe(2); // 老 step 原样保留
    expect(nextStateStep(next)).toBe(3);
    expect(migrateSubjectTree(next)).toEqual(next); // 幂等
  });

  it('migrateSubjectTrees 批量归一化且二次调用无变化', () => {
    const fresh = createSubjectTree('character', 'A');
    const legacy: LegacySubjectTree = {
      rootId: 'r2', name: 'B', kind: 'character', aliases: [],
      baseState: { prompt: 'p' }, states: [],
    };
    const out = migrateSubjectTrees([fresh, legacy]);
    expect(out).toHaveLength(2);
    expect(out[0]?.states[0]?.id).toBe(SUBJECT_BASE_STATE_ID);
    expect(out[1]?.states[0]?.fullPrompt).toBe('p');
    expect(migrateSubjectTrees(out)).toEqual(out);
    expect(migrateSubjectTrees(null)).toEqual([]);
  });

  it('baseStateNodeOf 兼容未迁移旧树；nonBaseStates 只给迭代状态', () => {
    const legacy: LegacySubjectTree = {
      rootId: 'r3', name: 'C', kind: 'prop', aliases: [],
      baseState: { prompt: '旧提示词', referenceImages: [{ key: 'cas:old.png', type: 'image' }] },
      states: [],
    };
    expect(baseStateNodeOf(legacy)?.fullPrompt).toBe('旧提示词');
    expect(baseStateNodeOf(legacy)?.media[0]?.key).toBe('cas:old.png');

    const tr = createSubjectTree('character', 'D');
    tr.states.push(createSubjectNode('恶鬼', 'image', 'user', tr.rootId, { step: 2 }));
    expect(nonBaseStates(tr).map((n) => n.id)).toEqual([tr.states[1]?.id]);
  });

  it('基础状态与其它状态同口径参与集数相关性', () => {
    const tr = createSubjectTree('character', 'E');
    tr.states[0]!.appearEpisodes = [1];
    tr.states.push(createSubjectNode('恶鬼', 'image', 'user', tr.rootId, { step: 2 }));
    tr.states[1]!.appearEpisodes = [1];
    expect(treeEpisodeRank(tr.states, 1)).toBe(0); // 命中本集
    expect(treeEpisodeRank(tr.states, 2)).toBe(1); // 全部标注为其它集
  });
});
