/**
 * resize-geometry 锁比例单测(2026-11-04)
 *
 * 验收映射: 拖角 resize 在 lockAspectRatio 下宽高比恒定。
 */
import { describe, it, expect } from 'vitest';
import { computeResizeRect } from './resize-geometry.js';
import type { ResizeConfig } from './types.js';

const IMAGE_CONFIG: ResizeConfig = {
  resizable: true,
  lockAspectRatio: true,
  minSize: { width: 80, height: 80 },
  defaultSize: { width: 620, height: 348 },
};

function ratioOf(r: { width: number; height: number }): number {
  return r.width / r.height;
}

describe('computeResizeRect 拖角锁比例', () => {
  const start = { x: 100, y: 100, width: 620, height: 348 };
  const contractRatio = 620 / 348;

  it('se 角拖 +100px: 宽高比恒等于契约比例(误差 <1%)', () => {
    const r = computeResizeRect(start, 'se', IMAGE_CONFIG, 100, 40);
    expect(Math.abs(ratioOf(r) - contractRatio) / contractRatio).toBeLessThan(0.01);
    expect(r.width).toBeGreaterThan(start.width);
    expect(r.height).toBeGreaterThan(start.height);
  });

  it('nw 角拖: 宽高比恒定,且对角(se 角)位置不动', () => {
    const r = computeResizeRect(start, 'nw', IMAGE_CONFIG, -80, -20);
    expect(Math.abs(ratioOf(r) - contractRatio) / contractRatio).toBeLessThan(0.01);
    // 对角不动: x + width / y + height 终点不变
    expect(r.x + r.width).toBeCloseTo(start.x + start.width, 0);
    expect(r.y + r.height).toBeCloseTo(start.y + start.height, 0);
  });

  it('sw/ne 角拖: 宽高比恒定', () => {
    for (const handle of ['sw', 'ne'] as const) {
      const r = computeResizeRect(start, handle, IMAGE_CONFIG, 60, 90);
      expect(Math.abs(ratioOf(r) - contractRatio) / contractRatio).toBeLessThan(0.01);
    }
  });

  it('拖到 minSize 以下: 宽度钳制在 80,锁比例优先(高度随比例,既有语义)', () => {
    const r = computeResizeRect(start, 'se', IMAGE_CONFIG, -1000, -1000);
    expect(r.width).toBeGreaterThanOrEqual(80);
    // 既有行为: min 钳制后锁比例覆盖高度(620/348 契约 → 80 宽对应高 ≈ 45)
    expect(Math.abs(ratioOf(r) - contractRatio) / contractRatio).toBeLessThan(0.01);
  });

  it('比例偏离契约的节点(如 620×620 方图节点): 锁起始比例而非拉回契约', () => {
    const squareStart = { x: 0, y: 0, width: 620, height: 620 };
    const r = computeResizeRect(squareStart, 'se', IMAGE_CONFIG, 120, 0);
    expect(Math.abs(ratioOf(r) - 1)).toBeLessThan(0.01);
  });

  it('无 lockAspectRatio 的节点: 宽高各自独立(不锁)', () => {
    const freeConfig: ResizeConfig = { ...IMAGE_CONFIG, lockAspectRatio: false };
    const r = computeResizeRect(start, 'se', freeConfig, 100, 0);
    expect(r.width).toBe(720);
    expect(r.height).toBe(348);
  });
});
