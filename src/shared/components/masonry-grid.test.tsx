/**
 * masonry-grid 验收（2026-11-05）
 *
 * 覆盖用户规格里的可验证项：
 * ① 列数断点表（960→5 / 1280→7 / 1440→8 / 1920→11）+ 列宽/右侧留白 ≤24px；
 * ② 高度夹取（3:4、1:1、16:9、1:9 极端）+ 极端长图改 contain（能看全）；
 * ③ 未知比例先 1:1；
 * ④ DOM 顺序稳定（CSS 多列只改视觉排布，不重排 children）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  CARD_MAX_HEIGHT_RATIO,
  CARD_MIN_HEIGHT_RATIO,
  cardCoverMetrics,
  MasonryGrid,
  masonryColumnsForWidth,
  masonryMetricsForWidth,
} from './masonry-grid.js';

describe('瀑布流列数断点表', () => {
  it('用户指定断点：960→5 / 1280→7 / 1440→8 / 1920→11', () => {
    expect(masonryColumnsForWidth(960)).toBe(5);
    expect(masonryColumnsForWidth(1280)).toBe(7);
    expect(masonryColumnsForWidth(1440)).toBe(8);
    expect(masonryColumnsForWidth(1920)).toBe(11);
  });

  it('窄容器按断点降列（抽屉场景），超宽屏继续增列', () => {
    expect(masonryColumnsForWidth(320)).toBe(1);
    expect(masonryColumnsForWidth(384)).toBe(2);
    expect(masonryColumnsForWidth(560)).toBe(3);
    expect(masonryColumnsForWidth(768)).toBe(4);
    expect(masonryColumnsForWidth(1000)).toBe(5);
    expect(masonryColumnsForWidth(2560)).toBeGreaterThanOrEqual(11);
  });

  it('列宽与右侧留白：内容宽度均分，右侧留白 ≤24px', () => {
    const cases = [960, 1280, 1440, 1920];
    for (const width of cases) {
      const m = masonryMetricsForWidth(width, { gap: 16, paddingX: 20 });
      expect(m.columns).toBe(masonryColumnsForWidth(width));
      // 列宽 = (容器宽 - 左右内边距 - 列间距) / 列数
      const expected = (width - 40 - 16 * (m.columns - 1)) / m.columns;
      expect(m.columnWidth).toBeCloseTo(expected, 5);
      expect(m.trailingWhitespace).toBeLessThanOrEqual(24);
    }
  });
});

describe('卡片封面高度夹取', () => {
  const COL = 160;

  it('3:4 竖图 = 4/3 列宽（未触上限，cover）', () => {
    expect(cardCoverMetrics(COL, 3 / 4)).toMatchObject({ height: COL / 0.75, fit: 'cover', clamped: 'none' });
  });

  it('1:1 = 列宽（cover）', () => {
    expect(cardCoverMetrics(COL, 1)).toMatchObject({ height: COL, fit: 'cover', clamped: 'none' });
  });

  it('16:9 宽图触下限 = 0.75 列宽（cover）', () => {
    const r = cardCoverMetrics(COL, 16 / 9);
    expect(r.height).toBeCloseTo(COL * CARD_MIN_HEIGHT_RATIO, 5);
    expect(r.clamped).toBe('min');
    expect(r.fit).toBe('cover');
  });

  it('1:9 极端长图触上限 = 1.9 列宽，并改 contain 保证完整可见', () => {
    const r = cardCoverMetrics(COL, 1 / 9);
    expect(r.height).toBeCloseTo(COL * CARD_MAX_HEIGHT_RATIO, 5);
    expect(r.clamped).toBe('max');
    expect(r.fit).toBe('contain');
  });

  it('未知比例先按 1:1 占位', () => {
    expect(cardCoverMetrics(COL, null)).toMatchObject({ height: COL, aspect: 1, fit: 'cover' });
    expect(cardCoverMetrics(COL, undefined)).toMatchObject({ height: COL, aspect: 1 });
  });
});

describe('MasonryGrid 容器', () => {
  it('DOM 顺序稳定（children 原序，只按列视觉排布）', () => {
    const { container } = render(
      <MasonryGrid columns={3}>
        <div>card-A</div>
        <div>card-B</div>
        <div>card-C</div>
        <div>card-D</div>
      </MasonryGrid>,
    );
    const root = container.querySelector('[data-masonry]') as HTMLElement;
    expect(root.getAttribute('data-masonry-columns')).toBe('3');
    const cells = Array.from(container.querySelectorAll('[data-masonry-cell]'));
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.textContent)).toEqual(['card-A', 'card-B', 'card-C', 'card-D']);
  });
});
