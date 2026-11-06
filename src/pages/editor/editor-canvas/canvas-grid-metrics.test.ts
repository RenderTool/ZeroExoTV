/**
 * 2026-11-05 用户要求：画布点阵密度提高（间距 24 → 16），点半径略缩、透明度压低，
 * 且缩放时按同一规则连续变化，不允许某档位突然变密/变疏。
 */
import { describe, expect, it } from 'vitest';
import { buildDotGridBackground, computeDotGridMetrics } from '@zeroexo/plugin-render-react';

const DARK_DOT = 'rgba(245,245,244,.35)';
const LIGHT_DOT = 'rgba(68,64,60,.40)';
const GRID_SIZE = 16;

describe('canvas dot grid metrics', () => {
  it('zoom=1.0：间距 16px、半径 0.9px、透明度 0.35', () => {
    const m = computeDotGridMetrics(DARK_DOT, GRID_SIZE, 1);
    expect(m.spacing).toBe(16);
    expect(m.dotRadius).toBeCloseTo(0.9, 5);
    expect(m.fadeRadius).toBeCloseTo(1.1, 5);
    expect(m.opacity).toBeCloseTo(0.35, 5);
    expect(m.rgb).toBe('245,245,244');
  });

  it('zoom=0.5：间距 8px、半径减半、透明度同步压低（无阈值跳变）', () => {
    const m = computeDotGridMetrics(DARK_DOT, GRID_SIZE, 0.5);
    expect(m.spacing).toBe(8);
    expect(m.dotRadius).toBeCloseTo(0.45, 5);
    expect(m.fadeRadius).toBeCloseTo(0.55, 5);
    expect(m.opacity).toBeCloseTo(0.175, 5);
  });

  it('zoom=2.0：间距 32px、半径封顶 1.8px、透明度回到基色值', () => {
    const m = computeDotGridMetrics(DARK_DOT, GRID_SIZE, 2);
    expect(m.spacing).toBe(32);
    expect(m.dotRadius).toBeCloseTo(1.8, 5);
    expect(m.opacity).toBeCloseTo(0.35, 5);
  });

  it('浅色主题基色透明度 0.40 同样生效', () => {
    expect(computeDotGridMetrics(LIGHT_DOT, GRID_SIZE, 1).opacity).toBeCloseTo(0.40, 5);
    expect(computeDotGridMetrics(LIGHT_DOT, GRID_SIZE, 1).rgb).toBe('68,64,60');
  });

  it('缩放全程同一规则：间距严格随 k 线性、无突变', () => {
    for (const k of [0.1, 0.24, 0.25, 0.26, 0.5, 0.75, 1, 1.5, 2]) {
      expect(computeDotGridMetrics(DARK_DOT, GRID_SIZE, k).spacing).toBeCloseTo(GRID_SIZE * k, 8);
    }
    // 旧实现 k<0.25 时点阵直接消失，这里在临界点两侧必须连续
    const before = computeDotGridMetrics(DARK_DOT, GRID_SIZE, 0.24).opacity;
    const after = computeDotGridMetrics(DARK_DOT, GRID_SIZE, 0.25).opacity;
    expect(before).toBeGreaterThan(0);
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('background-image 使用同一套半径/透明度数值', () => {
    const at1 = buildDotGridBackground(DARK_DOT, 1);
    expect(at1).toBe('radial-gradient(circle, rgba(245,245,244,0.350) 0.90px, transparent 1.10px)');
    const atHalf = buildDotGridBackground(DARK_DOT, 0.5);
    expect(atHalf).toContain('rgba(245,245,244,0.175)');
    expect(atHalf).toContain('0.45px');
  });
});
