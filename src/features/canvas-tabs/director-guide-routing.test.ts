/**
 * 引导数据必须真的进引擎（2026-11-10 用户实测：用了引导没效果）。
 *
 * 桥接（direct）走官方 MiniMaxH3DirectorZX，timeline 段里没有显式引导字段 →
 * 只要本次运行含片段引导槽，就必须改走 /zeroexo/v1/jobs（reference_video 模板有 prev_guide_path）。
 */
import { describe, expect, it } from 'vitest';
import { needsZeroexoForGuides } from './use-director-run.js';

const G1 = 'gd_aaaaaaaaaaaa';
const shots = [{ id: 'a' }, { id: 'b', guide: { id: G1 } }];

describe('needsZeroexoForGuides', () => {
  it('direct + 选中的段有显式引导 → 必须切 v1 作业通道', () => {
    expect(needsZeroexoForGuides('direct', shots, ['b'])).toBe(true);
  });

  it('direct + 开着段间衔接 → 也必须切（桥接不产出引导数据，下一段接不上）', () => {
    expect(needsZeroexoForGuides('direct', [{ id: 'a' }], ['a'], true)).toBe(true);
  });

  it('direct + 引导在未选中的段上 → 不切（只跑选中的段）', () => {
    expect(needsZeroexoForGuides('direct', shots, ['a'])).toBe(false);
  });

  it('没有引导 / 没有衔接 / 已经是 zeroexo / openai → 不切', () => {
    expect(needsZeroexoForGuides('direct', [{ id: 'a' }], ['a'])).toBe(false);
    expect(needsZeroexoForGuides('zeroexo', shots, ['b'])).toBe(false);
    expect(needsZeroexoForGuides('openai', shots, ['b'])).toBe(false);
  });
});
