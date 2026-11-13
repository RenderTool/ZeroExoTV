import { describe, expect, it } from 'vitest';
import { STYLE_PRESETS, stylePresetById, stylePresetPrompt } from '../src/lib/style-presets.js';

describe('MCP 风格预设库（与前端同一份 23 套）', () => {
  it('23 套：9 导演 / 6 主流 / 8 动画', () => {
    expect(STYLE_PRESETS).toHaveLength(23);
    expect(STYLE_PRESETS.filter((s) => s.category === 'director')).toHaveLength(9);
    expect(STYLE_PRESETS.filter((s) => s.category === 'mainstream')).toHaveLength(6);
    expect(STYLE_PRESETS.filter((s) => s.category === 'animation')).toHaveLength(8);
  });

  it('每套有中文提示词，片段去掉 [主体] 前缀', () => {
    for (const p of STYLE_PRESETS) {
      expect(p.promptZh.startsWith('[主体]')).toBe(true);
      expect(stylePresetPrompt(p).startsWith('[')).toBe(false);
    }
    expect(stylePresetById('wong-kar-wai')?.nameZh).toContain('王家卫');
    expect(stylePresetById('nope')).toBeUndefined();
  });
});
