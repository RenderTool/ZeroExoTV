/**
 * image-compress 单测(纯函数层;canvas 编码路径依赖浏览器,不进 jsdom):
 * - 常量契约: 内部目标 3MB < 硬上限 5MB;质量阶梯 = 0.92→0.85→0.8→0.72→0.6;
 * - scaleToMaxEdge: 等比缩边到 ≤3840,已合规不动;
 * - needsCompression: >3MB 或最长边 >3840 触发;
 * - planJpegQualities: 阶梯顺序与兜底。
 */

import { describe, expect, it } from 'vitest';
import {
  COVER_HARD_LIMIT,
  COVER_JPEG_LADDER,
  COVER_MAX_EDGE,
  COVER_TARGET_BYTES,
  needsCompression,
  planJpegQualities,
  pngMustConvert,
  scaleToMaxEdge,
} from './image-compress.js';

describe('压缩常量契约', () => {
  it('内部目标 3MB,硬上限 5MB,目标 < 硬上限', () => {
    expect(COVER_TARGET_BYTES).toBe(3 * 1024 * 1024);
    expect(COVER_HARD_LIMIT).toBe(5 * 1024 * 1024);
    expect(COVER_TARGET_BYTES).toBeLessThan(COVER_HARD_LIMIT);
  });

  it('最长边上限 3840', () => {
    expect(COVER_MAX_EDGE).toBe(3840);
  });

  it('JPEG 质量阶梯 = 0.92→0.85→0.8→0.72→0.6(递减)', () => {
    expect([...COVER_JPEG_LADDER]).toEqual([0.92, 0.85, 0.8, 0.72, 0.6]);
    for (let i = 1; i < COVER_JPEG_LADDER.length; i++) {
      expect(COVER_JPEG_LADDER[i]!).toBeLessThan(COVER_JPEG_LADDER[i - 1]!);
    }
    expect(planJpegQualities()).toEqual(COVER_JPEG_LADDER);
  });
});

describe('scaleToMaxEdge 等比缩边', () => {
  it('4000×3000 → 最长边压到 3840,比例不变', () => {
    const r = scaleToMaxEdge(4000, 3000);
    expect(r.w).toBe(3840);
    expect(r.h).toBe(2880);
    expect(Math.abs(r.w / r.h - 4000 / 3000)).toBeLessThanOrEqual(0.001);
  });

  it('8000×6000(手机原图)→ 3840×2880', () => {
    expect(scaleToMaxEdge(8000, 6000)).toEqual({ w: 3840, h: 2880 });
  });

  it('竖图 3000×4000 → 2880×3840(最长边是高)', () => {
    expect(scaleToMaxEdge(3000, 4000)).toEqual({ w: 2880, h: 3840 });
  });

  it('已合规 → 原样返回', () => {
    expect(scaleToMaxEdge(1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(scaleToMaxEdge(3840, 2160)).toEqual({ w: 3840, h: 2160 });
  });

  it('非法尺寸原样返回(不 NaN)', () => {
    expect(scaleToMaxEdge(0, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('needsCompression 触发条件', () => {
  it('>3MB 触发(内部目标),≤3MB 且边长合规则不触发', () => {
    expect(needsCompression(5 * 1024 * 1024 + 1, 1920, 1080)).toBe(true);
    expect(needsCompression(4 * 1024 * 1024, 1920, 1080)).toBe(true); // 4MB 也压到 ≤3MB
    expect(needsCompression(3 * 1024 * 1024, 1920, 1080)).toBe(false);
    expect(needsCompression(1024, 1920, 1080)).toBe(false);
  });

  it('最长边 >3840 触发(哪怕体积小)', () => {
    expect(needsCompression(1024, 8000, 6000)).toBe(true);
    expect(needsCompression(1024, 3840, 2160)).toBe(false);
  });

  it('12MB / 4000×3000 必然触发', () => {
    expect(needsCompression(12 * 1024 * 1024, 4000, 3000)).toBe(true);
  });
});

describe('PNG 透明分支决策(pngMustConvert)', () => {
  it('缩边后 PNG ≤5MB → 保留 PNG(保透明)', () => {
    expect(pngMustConvert(5 * 1024 * 1024)).toBe(false);
    expect(pngMustConvert(1024)).toBe(false);
  });

  it('缩边后 PNG 仍 >5MB → 转 JPEG(保不住才转,调用方提示)', () => {
    expect(pngMustConvert(5 * 1024 * 1024 + 1)).toBe(true);
  });
});
