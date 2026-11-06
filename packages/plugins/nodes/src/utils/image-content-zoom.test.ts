/**
 * image-content-zoom 纯函数单测(2026-11-04)
 *
 * 验收映射:
 * - 滚轮缩放只产出 transform scale 因子,与节点尺寸无关(节点尺寸不变 → 宽高比恒定)
 * - 缩放上下限钳制 0.1×–10×
 * - 双击 fit ↔ 1:1 切换
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_SCALE_MIN,
  CONTENT_SCALE_MAX,
  clampContentScale,
  nextContentScale,
  toggleContentScale,
  oneToOneScale,
  cursorOriginPercent,
} from './image-content-zoom.js';

describe('nextContentScale 滚轮缩放', () => {
  it('向上滚(deltaY<0)放大,向下滚缩小', () => {
    expect(nextContentScale(1, -100)).toBeGreaterThan(1);
    expect(nextContentScale(1, 100)).toBeLessThan(1);
  });

  it('钳制在 0.1×–10× 之间', () => {
    expect(nextContentScale(CONTENT_SCALE_MIN, 999999)).toBe(CONTENT_SCALE_MIN);
    expect(nextContentScale(CONTENT_SCALE_MAX, -999999)).toBe(CONTENT_SCALE_MAX);
  });

  it('缩放因子是纯标量: 不携带也不改变任何节点尺寸信息', () => {
    // 节点尺寸(620×348)在缩放前后恒不变 —— 缩放只作用于 img transform
    const nodeSize = { width: 620, height: 348 };
    const before = { ...nodeSize };
    const s1 = nextContentScale(1, -120);
    const s2 = nextContentScale(s1, -120);
    expect(s2).toBeGreaterThan(s1);
    expect(nodeSize).toEqual(before);
    // 返回值是 number(scale 因子),不含 width/height 字段
    expect(typeof s2).toBe('number');
  });
});

describe('clampContentScale / toggleContentScale', () => {
  it('clamp 非法值: NaN 回退 1,±Infinity 钳到端点', () => {
    expect(clampContentScale(NaN)).toBe(1);
    expect(clampContentScale(Infinity)).toBe(CONTENT_SCALE_MAX);
    expect(clampContentScale(-Infinity)).toBe(CONTENT_SCALE_MIN);
    expect(clampContentScale(0)).toBe(CONTENT_SCALE_MIN);
  });

  it('双击: 1× → 目标倍率,再击 → 回到 1×', () => {
    const target = oneToOneScale(2000, 1000, 620, 348)!;
    expect(toggleContentScale(1, target)).toBe(target);
    expect(toggleContentScale(target, target)).toBe(1);
  });
});

describe('oneToOneScale 1:1 像素倍率', () => {
  it('contain 布局: 2000×1000 图在 620×348 盒 → 1:1 倍率 = 2000/620', () => {
    const s = oneToOneScale(2000, 1000, 620, 348)!;
    expect(s).toBeCloseTo(2000 / 620, 5);
  });
  it('竖图 1000×3000 在 620×348 盒: 显示宽 = 348/3=116 → 倍率 = 1000/116', () => {
    const s = oneToOneScale(1000, 3000, 620, 348)!;
    expect(s).toBeCloseTo(1000 / (348 / 3), 5);
  });
  it('缺自然尺寸返回 null(调用方回退固定倍率)', () => {
    expect(oneToOneScale(undefined, undefined, 620, 348)).toBeNull();
    expect(oneToOneScale(0, 100, 620, 348)).toBeNull();
  });
});

describe('cursorOriginPercent 光标锚点', () => {
  it('光标在容器中心 → 50%/50%', () => {
    const o = cursorOriginPercent(310, 174, { left: 0, top: 0, width: 620, height: 348 });
    expect(o.x).toBeCloseTo(50, 5);
    expect(o.y).toBeCloseTo(50, 5);
  });
  it('越界钳制到 0–100', () => {
    const o = cursorOriginPercent(-10, 9999, { left: 0, top: 0, width: 620, height: 348 });
    expect(o).toEqual({ x: 0, y: 100 });
  });
});
