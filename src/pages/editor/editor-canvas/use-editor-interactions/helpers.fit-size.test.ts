/**
 * 图片结果节点尺寸（2026-11-11 用户反馈：Krea2 返回后比例没按原图）：
 * 宽高必须按原图比例同时重算，长边 ≤320、短边 ≥120。
 */
import { describe, expect, it } from 'vitest';
import { fitImageNodeSize } from './helpers.js';

describe('fitImageNodeSize', () => {
  it('正方形原图 1728×1728 → 320×320（不再停在旧的 16:9 节点）', () => {
    expect(fitImageNodeSize(340, 1728, 1728)).toEqual({ width: 320, height: 320 });
    expect(fitImageNodeSize(600, 1728, 1728)).toEqual({ width: 320, height: 320 });
  });

  it('竖图 1088×1920 → 长边 320 封顶，宽按比例收窄（不会出现左右黑边）', () => {
    const r = fitImageNodeSize(340, 1088, 1920);
    expect(r.height).toBe(320);
    expect(r.width).toBeLessThan(r.height);
    expect(Math.abs(r.width / r.height - 1088 / 1920)).toBeLessThan(0.01);
  });

  it('横图 1920×1088 → 长边 320 封顶，高按比例收窄', () => {
    const r = fitImageNodeSize(340, 1920, 1088);
    expect(r.width).toBe(320);
    expect(r.height).toBeLessThan(r.width);
    expect(Math.abs(r.width / r.height - 1920 / 1088)).toBeLessThan(0.01);
  });

  it('元数据缺失时兜底为当前宽度的正方形，不产生 NaN', () => {
    expect(fitImageNodeSize(340, 0, 0)).toEqual({ width: 340, height: 340 });
  });
});
