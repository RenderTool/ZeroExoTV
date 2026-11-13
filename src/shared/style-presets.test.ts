import { describe, expect, it } from 'vitest';
import {
  STYLE_PRESETS, applyStylePromptToPrompt, stylePresetPrompt, stylePresetById,
} from './style-presets.js';

describe('风格画廊数据（2026-11-13）', () => {
  it('39 套：9 导演 / 6 主流 / 8 动画 / 16 题材；电影美学有缩略图，题材卡用渐变', () => {
    expect(STYLE_PRESETS).toHaveLength(39);
    expect(STYLE_PRESETS.filter((s) => s.category === 'director')).toHaveLength(9);
    expect(STYLE_PRESETS.filter((s) => s.category === 'mainstream')).toHaveLength(6);
    expect(STYLE_PRESETS.filter((s) => s.category === 'animation')).toHaveLength(8);
    expect(STYLE_PRESETS.filter((s) => s.category === 'genre')).toHaveLength(16);
    for (const s of STYLE_PRESETS) {
      expect(s.promptZh.startsWith('[主体]')).toBe(true);
      if (s.category !== 'genre') expect(s.image?.startsWith('style-presets/')).toBe(true);
    }
    expect(stylePresetById('wong-kar-wai')?.nameZh).toContain('王家卫');
  });

  it('风格片段去掉 [主体] 前缀', () => {
    const preset = STYLE_PRESETS[0]!;
    expect(stylePresetPrompt(preset).startsWith('韦斯·安德森')).toBe(true);
  });

  it('applyStylePromptToPrompt：删旧风格行，追加一行全剧风格', () => {
    const prompt = '人设：古装女侠\n风格：旧风格\n灯光：旧灯光\n色彩：旧色彩\n质感：旧质感\n背景：中性灰';
    const out = applyStylePromptToPrompt(prompt, '王家卫电影风格, 高饱和色彩');
    expect(out).toContain('人设：古装女侠');
    expect(out).toContain('背景：中性灰');
    expect(out).not.toContain('旧灯光');
    expect(out.trim().endsWith('风格：王家卫电影风格, 高饱和色彩')).toBe(true);
  });

  it('空提示词不生成只有风格的提示词', () => {
    expect(applyStylePromptToPrompt('   ', '风格片段')).toBe('');
  });
});
