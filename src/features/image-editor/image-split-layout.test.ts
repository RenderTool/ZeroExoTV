/**
 * 分割切片布局单测（2026-11-06 用户反馈：非均匀分割拼不回原图）
 *
 * 根因：旧布局给每个切片固定宽度 200，非均匀切片的显示缩放比例各不相同 → 并排放置必然错位。
 * 新口径：**同一缩放比例 + 累计边界取整**，切片默认零间距紧贴，宽度/高度之和恒等于整图缩放后的尺寸。
 */
import { describe, expect, it } from 'vitest';
import { computeSplitLayout } from './image-edit-actions.js';

/** 断言同一行内水平无缝、相邻行垂直无缝 */
function expectTiled(dims: { width: number; height: number }[], columns: number): void {
  const { cells, totalWidth, totalHeight } = computeSplitLayout(dims, columns);
  expect(cells).toHaveLength(dims.length);
  const rows = Math.ceil(dims.length / columns);
  for (let r = 0; r < rows; r++) {
    const row = cells.slice(r * columns, (r + 1) * columns);
    // 行内：第一块从 0 起，块块相接，最后一块右边缘 = 总宽
    expect(row[0]?.x).toBe(0);
    for (let c = 1; c < row.length; c++) {
      expect(row[c]!.x).toBe(row[c - 1]!.x + row[c - 1]!.width);
    }
    const last = row[row.length - 1]!;
    expect(last.x + last.width).toBe(totalWidth);
    // 行高整行一致
    for (const cell of row) expect(cell.height).toBe(row[0]!.height);
  }
  // 行间：下一行 y = 上一行 y + 行高，最后一行底边 = 总高
  for (let r = 1; r < rows; r++) {
    const prev = cells[(r - 1) * columns]!;
    const cur = cells[r * columns]!;
    expect(cur.y).toBe(prev.y + prev.height);
  }
  const lastRowCell = cells[(rows - 1) * columns]!;
  expect(lastRowCell.y + lastRowCell.height).toBe(totalHeight);
}

describe('分割切片布局：非均匀也能严丝合缝', () => {
  it('2 列非均匀（187 / 549）：宽度之和等于整图、块块相接', () => {
    const dims = [
      { width: 187, height: 654 }, { width: 549, height: 654 },
      { width: 187, height: 654 }, { width: 549, height: 654 },
    ];
    expectTiled(dims, 2);
    const { totalWidth } = computeSplitLayout(dims, 2);
    expect(totalWidth).toBe(Math.round(736 * Math.min(1, 480 / 736)));
  });

  it('2 列均匀（368 / 368）同样无缝', () => {
    expectTiled([
      { width: 368, height: 654 }, { width: 368, height: 654 },
      { width: 368, height: 654 }, { width: 368, height: 654 },
    ], 2);
  });

  it('3 列 + 3 行非均匀（分数缩放）也块块相接、无缝隙无重叠', () => {
    const dims: { width: number; height: number }[] = [];
    const colWidths = [137, 251, 348];
    const rowHeights = [211, 349, 440];
    for (const h of rowHeights) for (const w of colWidths) dims.push({ width: w, height: h });
    expectTiled(dims, 3);
  });

  it('小图不放大：总宽小于目标宽度时 scale=1（按原像素）', () => {
    const { scale, totalWidth } = computeSplitLayout([{ width: 100, height: 50 }, { width: 100, height: 50 }], 2);
    expect(scale).toBe(1);
    expect(totalWidth).toBe(200);
  });

  it('非法输入安全兜底（0 列 / 空切片）', () => {
    expect(computeSplitLayout([], 2).cells).toHaveLength(0);
    expect(computeSplitLayout([{ width: 10, height: 10 }], 0).cells).toHaveLength(0);
  });
});
