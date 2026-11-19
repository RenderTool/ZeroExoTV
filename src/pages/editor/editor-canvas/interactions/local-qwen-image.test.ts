/**
 * Qwen Image 编辑指令组装：
 * 有输入图必须点名「参考图1」，否则 Qwen Image 会按文生图重画（用户实测退化）。
 */
import { describe, expect, it } from 'vitest';
import { buildQwenEditPrompt, resolveQwenTargetSize } from './local-qwen-image.js';

describe('buildQwenEditPrompt', () => {
  it('无输入图（文生图）不加参考图前缀', () => {
    expect(buildQwenEditPrompt({
      prompt: '一只橘猫', hasInputImage: false, hasMask: false, transparentBackground: false,
    })).toBe('一只橘猫');
  });

  it('有输入图（图生图）以「参考图1：」开头', () => {
    expect(buildQwenEditPrompt({
      prompt: '把外套换成红色', hasInputImage: true, hasMask: false, transparentBackground: false,
    })).toBe('参考图1：把外套换成红色');
  });

  it('遮罩编辑同样点名参考图，并保留红区约束', () => {
    const text = buildQwenEditPrompt({
      prompt: '把天空换成晚霞', hasInputImage: true, hasMask: true, transparentBackground: false,
    });
    expect(text.startsWith('参考图1：')).toBe(true);
    expect(text).toContain('Edit only the red-marked area: 把天空换成晚霞');
    expect(text).toContain('keep everything outside that area unchanged');
  });

  it('透明底要求追加在正文之后、仍在参考图前缀之内', () => {
    const text = buildQwenEditPrompt({
      prompt: '一个苹果', hasInputImage: true, hasMask: false, transparentBackground: true,
    });
    expect(text.startsWith('参考图1：一个苹果')).toBe(true);
    expect(text).toContain('output a PNG with an alpha channel');
  });
});

describe('resolveQwenTargetSize（参考图与出图尺寸解耦）', () => {
  it('1:1 参考图 + 请求 16:9 时按请求尺寸出图，不被参考图拉回 1:1', () => {
    const size = resolveQwenTargetSize({
      width: 1376, height: 768,
      params: { aspect: '16:9', megapixels: 2 },
      sourceSize: { width: 1024, height: 1024 },
    });
    expect(size.width).toBeGreaterThan(size.height);
    expect(size.width).toBe(1376);
  });

  it('无参考图时直接用请求尺寸', () => {
    expect(resolveQwenTargetSize({ width: 1024, height: 1024 })).toEqual({ width: 1024, height: 1024 });
  });

  it('只有显式「跟随原图」才吃参考图尺寸（改图场景）', () => {
    const size = resolveQwenTargetSize({
      width: 1376, height: 768,
      params: { sizeMode: 'source' },
      sourceSize: { width: 1024, height: 1024 },
    });
    expect(size).toEqual({ width: 1024, height: 1024 });
  });
});
