/**
 * media-fit 纯函数单测(2026-11-04)
 *
 * 验收映射:
 * 1. 竖图/横图/方图/小图四形态: 节点宽高比 == 图片宽高比(误差 <1%)、最长边 ≤ 上限
 * 2. 模拟 img onload 时元数据错误(节点先按方形/16:9 渲染): planOnloadResize 纠正到真实比例
 * 3. 比例未失配时 planOnloadResize 返回 null(用户手动 resize 结果不被回打)
 */
import { describe, it, expect } from 'vitest';
import { fitContainSize, aspectMismatch, planOnloadResize } from './media-fit.js';

const OPTS = { maxLongSide: 620, minShortSide: 80 };

/** 宽高比相对偏差 */
function ratioError(size: { width: number; height: number }, w: number, h: number): number {
  return Math.abs(size.width / size.height - w / h) / (w / h);
}

describe('fitContainSize 四形态', () => {
  it('竖图 1000×3000:最长边=620,宽高比 == 1:3(误差 <1%)', () => {
    const s = fitContainSize(1000, 3000, OPTS)!;
    expect(s).not.toBeNull();
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(620);
    expect(ratioError(s, 1000, 3000)).toBeLessThan(0.01);
    // 不裁切不变形: 620 / 3 ≈ 207
    expect(s.height).toBe(620);
    expect(s.width).toBe(207);
  });

  it('横图 3000×1000:最长边=620,宽高比 == 3:1(误差 <1%)', () => {
    const s = fitContainSize(3000, 1000, OPTS)!;
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(620);
    expect(ratioError(s, 3000, 1000)).toBeLessThan(0.01);
    expect(s.width).toBe(620);
    expect(s.height).toBe(207);
  });

  it('方图 2048×2048:620×620', () => {
    const s = fitContainSize(2048, 2048, OPTS)!;
    expect(s).toEqual({ width: 620, height: 620 });
    expect(ratioError(s, 2048, 2048)).toBeLessThan(0.01);
  });

  it('小图 300×200(短边≥下限):不放大,保持原始尺寸(修复「导入过大」)', () => {
    const s = fitContainSize(300, 200, OPTS)!;
    expect(s).toEqual({ width: 300, height: 200 });
    expect(ratioError(s, 300, 200)).toBeLessThan(0.01);
  });

  it('小图 100×40(短边<下限):等比放大到短边 80,比例不变', () => {
    const s = fitContainSize(100, 40, OPTS)!;
    expect(s).toEqual({ width: 200, height: 80 });
    expect(ratioError(s, 100, 40)).toBeLessThan(0.01);
  });

  it('极小图 40×30:短边放大到下限 80,比例不变', () => {
    const s = fitContainSize(40, 30, OPTS)!;
    expect(Math.min(s.width, s.height)).toBeGreaterThanOrEqual(80);
    expect(ratioError(s, 40, 30)).toBeLessThan(0.01);
  });

  it('非法尺寸返回 null(调用方回退 fallback)', () => {
    expect(fitContainSize(undefined, undefined, OPTS)).toBeNull();
    expect(fitContainSize(0, 100, OPTS)).toBeNull();
    expect(fitContainSize(100, -5, OPTS)).toBeNull();
    expect(fitContainSize(NaN, 100, OPTS)).toBeNull();
  });
});

describe('aspectMismatch 比例失配判定', () => {
  it('16:9 fallback 节点 + 竖图 → 失配', () => {
    expect(aspectMismatch({ width: 620, height: 348 }, 1000, 3000)).toBe(true);
  });
  it('比例一致(含整数化误差) → 不失配', () => {
    expect(aspectMismatch({ width: 207, height: 620 }, 1000, 3000)).toBe(false);
  });
  it('节点尺寸缺失/非法 → 不判定为失配(不触发校正)', () => {
    expect(aspectMismatch(undefined, 1000, 3000)).toBe(false);
    expect(aspectMismatch({ width: 0, height: 0 }, 1000, 3000)).toBe(false);
  });
});

describe('planOnloadResize 模拟 img onload 元数据纠错', () => {
  it('元数据错误(节点按方形 620×620 渲染) + 真实竖图 → 纠正为 207×620', () => {
    const s = planOnloadResize({ width: 620, height: 620 }, 1000, 3000, OPTS);
    expect(s).not.toBeNull();
    expect(ratioError(s!, 1000, 3000)).toBeLessThan(0.01);
    expect(Math.max(s!.width, s!.height)).toBeLessThanOrEqual(620);
    expect(s).toEqual({ width: 207, height: 620 });
  });

  it('元数据缺失(节点停在 16:9 fallback) + 真实方图 → 纠正为 620×620', () => {
    const s = planOnloadResize({ width: 620, height: 348 }, 2048, 2048, OPTS);
    expect(s).toEqual({ width: 620, height: 620 });
  });

  it('用户已放大节点但比例对(1240×1240 方图) → 返回 null,不回打用户尺寸', () => {
    expect(planOnloadResize({ width: 1240, height: 1240 }, 2048, 2048, OPTS)).toBeNull();
  });

  it('比例失配但用户已缩小节点 → 纠正比例且保留用户缩放尺度(最长边 = 当前最长边)', () => {
    // 用户在比例错误(620×348)时把节点拖小到 310×174,真实图是竖图
    const s = planOnloadResize({ width: 310, height: 174 }, 1000, 3000, OPTS);
    expect(s).not.toBeNull();
    expect(ratioError(s!, 1000, 3000)).toBeLessThan(0.01);
    expect(Math.max(s!.width, s!.height)).toBeLessThanOrEqual(310);
  });
});
