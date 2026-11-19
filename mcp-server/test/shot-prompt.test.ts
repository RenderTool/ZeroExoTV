/**
 * 片段提示词回归（C-07 P1）：
 * 主体定义行只锁身份、不描述外貌；不追加「主体锚定」重复行；不出现「锁形制、不锁构图」汇总句。
 */
import { describe, expect, it } from 'vitest';
import { composeImagePrompt, type ComposeShotInput } from '../src/lib/shot-prompt.js';

function base(overrides: Partial<ComposeShotInput> = {}): ComposeShotInput {
  return {
    index: 0,
    number: 1,
    durationSec: 5,
    scene: { name: '中州驿站', place: '外', time: '夜' },
    action: '推门而入，停在门槛内侧',
    subjects: [],
    style: { look: '70 年代邵氏 35mm 胶片质感' },
    assetsBound: true,
    ...overrides,
  };
}

describe('composeImagePrompt：主体定义口径', () => {
  it('角色行只锁身份，不出现外貌/发型/服装/体型的否定式描述', () => {
    const prompt = composeImagePrompt(base({
      action: '<Subject 2> 季沧海 推门而入，停在门槛内侧',
      subjects: [
        { name: '中州驿站', kind: 'scene', slot: 1 },
        { name: '季沧海', kind: 'character', slot: 2, state: '定妆' },
      ],
    }));
    expect(prompt).toContain('只锁身份，不描述外貌');
    expect(prompt).not.toContain('不得改写外貌');
    expect(prompt).not.toContain('发型');
    expect(prompt).not.toContain('主体锚定：');
  });

  it('道具行只作形制与材质基准，不追加汇总空话', () => {
    const prompt = composeImagePrompt(base({
      action: '<Subject 1> 铜油灯 放在案上',
      subjects: [
        { name: '中州驿站', kind: 'scene', slot: 1 },
        { name: '铜油灯', kind: 'prop', slot: 2 },
      ],
    }));
    expect(prompt).toContain('只作道具形制与材质基准');
    expect(prompt).not.toContain('凡正文出现其中任一主体');
  });

  it('纯文字主体（无参考图）不引用不存在的 @PictureN', () => {
    const prompt = composeImagePrompt(base({
      assetsBound: false,
      action: '<Subject 1> 季沧海 推门而入',
      subjects: [{ name: '季沧海', kind: 'character', slot: 1 }],
    }));
    expect(prompt).not.toContain('@Picture');
  });
});
