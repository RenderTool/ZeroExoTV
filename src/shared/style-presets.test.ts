import { describe, expect, it } from 'vitest';
import {
  STYLE_PRESETS, applyStylePromptToPrompt, stylePresetPrompt, stylePresetById,
} from './style-presets.js';
import { STYLE_CRAFT } from './style-craft.js';

describe('风格画廊数据（2026-11-13）', () => {
  it('45 套：9 导演 / 6 主流 / 8 动画 / 16 题材 / 6 组合技；电影美学有缩略图，题材卡用渐变', () => {
    expect(STYLE_PRESETS).toHaveLength(45);
    expect(STYLE_PRESETS.filter((s) => s.category === 'director')).toHaveLength(9);
    expect(STYLE_PRESETS.filter((s) => s.category === 'mainstream')).toHaveLength(6);
    expect(STYLE_PRESETS.filter((s) => s.category === 'animation')).toHaveLength(8);
    expect(STYLE_PRESETS.filter((s) => s.category === 'genre')).toHaveLength(16);
    expect(STYLE_PRESETS.filter((s) => s.category === 'combo')).toHaveLength(6);
    for (const s of STYLE_PRESETS) {
      expect(s.promptZh.startsWith('[主体]')).toBe(true);
      if (s.category !== 'genre' && s.category !== 'combo') expect(s.image?.startsWith('style-presets/')).toBe(true);
    }
    expect(stylePresetById('wong-kar-wai')?.nameZh).toContain('王家卫');
  });

  it('45 套风格全部有技法详情：节奏基准 + 技法/运镜/叙事各至少 2 条 + 至少 1 个依据来源', () => {
    for (const s of STYLE_PRESETS) {
      const craft = STYLE_CRAFT[s.id];
      expect(craft, `缺少技法条目：${s.id}`).toBeTruthy();
      if (!craft) continue;
      expect(craft.asl.length).toBeGreaterThan(10);
      expect(craft.techniques.length).toBeGreaterThanOrEqual(2);
      expect(craft.camera.length).toBeGreaterThanOrEqual(2);
      expect(craft.narrative.length).toBeGreaterThanOrEqual(2);
      expect(craft.sources.length).toBeGreaterThanOrEqual(1);
      for (const cam of craft.camera) expect(cam).toMatch(/(\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?\s*s)|(\d+(\.\d+)?\s*s)|秒/);
    }
    expect(Object.keys(STYLE_CRAFT)).toHaveLength(STYLE_PRESETS.length);
  });

  it('风格片段去掉 [主体] 前缀', () => {
    const preset = STYLE_PRESETS[0]!;
    expect(stylePresetPrompt(preset).startsWith('[主体]')).toBe(false);
    expect(stylePresetPrompt(preset).length).toBeGreaterThan(10);
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
