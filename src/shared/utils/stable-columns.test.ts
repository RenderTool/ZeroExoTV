/**
 * 列数滞回单测（2026-11-06 抽屉瀑布流抖动，征集 #182）
 *
 * 抖动链条：列数=f(宽度) → 卡片高度=g(列宽) → 内容超高与否决定竖向滚动条 → 滚动条吃掉 ~15px 宽度。
 * 宽度压在断点上时三者互相推，ResizeObserver 每轮都 setState = 打开后一直抖。
 * 这里锁死「边界死区」行为：±COLUMN_HYSTERESIS_PX 内维持原列数。
 */
import { describe, expect, it } from 'vitest';
import { COLUMN_HYSTERESIS_PX, stableColumnCount } from './stable-columns.js';
import { masonryColumnsForWidth } from '@/shared/components/masonry-grid.js';
import { subjectStateGridMetricsForWidth } from '@/features/canvas-nodes/storyboard/subject-card-metrics';

const stateColumns = (w: number): number => subjectStateGridMetricsForWidth(w, { paddingX: 0 }).columns;

describe('stableColumnCount 死区', () => {
  it('首次测量按自然档；宽度 ≤0（隐藏容器/展开动画首帧）维持原值', () => {
    expect(stableColumnCount(560, 0, masonryColumnsForWidth)).toBe(3);
    expect(stableColumnCount(0, 3, masonryColumnsForWidth)).toBe(3);
    expect(stableColumnCount(-10, 2, masonryColumnsForWidth)).toBe(2);
    expect(stableColumnCount(Number.NaN, 4, masonryColumnsForWidth)).toBe(4);
  });

  it('断点 560 附近 ±15px 往返（滚动条出现/消失的幅度）不翻列', () => {
    let cols = stableColumnCount(545, 2, masonryColumnsForWidth);   // 2 列区间内 → 维持 2
    expect(cols).toBe(2);
    cols = stableColumnCount(560, cols, masonryColumnsForWidth);     // 刚进 3 列入口，未过死区 → 仍 2
    expect(cols).toBe(2);
    cols = stableColumnCount(545, cols, masonryColumnsForWidth);     // 回到 2 列区间 → 仍 2
    expect(cols).toBe(2);
    // 反复横跳一整轮都不该翻（旧实现在这里每轮都换列数）
    for (let i = 0; i < 20; i++) {
      cols = stableColumnCount(i % 2 === 0 ? 560 : 545, cols, masonryColumnsForWidth);
    }
    expect(cols).toBe(2);
  });

  it('真的往大/往小拖过死区后才改档（增列 ≥ 入口+死区，减列 ≤ 回档入口−死区）', () => {
    expect(stableColumnCount(560 + COLUMN_HYSTERESIS_PX, 2, masonryColumnsForWidth)).toBe(3);
    expect(stableColumnCount(585, 2, masonryColumnsForWidth)).toBe(3);
    // 已 3 列后，561 仍在 3 列区间（自然值相同，直接维持）
    expect(stableColumnCount(561, 3, masonryColumnsForWidth)).toBe(3);
    // 减列需要 ≤ 560 − 死区
    expect(stableColumnCount(545, 3, masonryColumnsForWidth)).toBe(3);
    expect(stableColumnCount(536, 3, masonryColumnsForWidth)).toBe(2);
  });

  it('主体状态卡网格（最小卡宽 260 + gap 16）同样有死区', () => {
    // 自然档：floor((宽 + 16) / 276) → 800 宽 = 2 列，812 宽 = 3 列
    expect(stateColumns(800)).toBe(2);
    expect(stateColumns(812)).toBe(3);
    // 刚进 3 列入口（812）但未过死区 → 维持 2 列
    expect(stableColumnCount(820, 2, stateColumns)).toBe(2);
    expect(stableColumnCount(836, 2, stateColumns)).toBe(3);
    // 已 3 列后回到 800：差 12px 不足以掉档（需 ≤ 812 − 24）
    expect(stableColumnCount(800, 3, stateColumns)).toBe(3);
    expect(stableColumnCount(788, 3, stateColumns)).toBe(2);
  });

  it('超宽动态增列区（≥1920）与跨多档跳变都能收敛，不抛不震荡', () => {
    expect(stableColumnCount(2400, 8, masonryColumnsForWidth)).toBeGreaterThan(8);
    // 一次跳回窄容器：直接落到目标档（低于回档入口 − 死区）
    expect(stableColumnCount(600, 11, masonryColumnsForWidth)).toBe(3);
    // 单调映射下反复喂同一宽度 = 同一结果（幂等，StrictMode 双跑安全）
    const once = stableColumnCount(1000, 4, masonryColumnsForWidth);
    expect(stableColumnCount(1000, once, masonryColumnsForWidth)).toBe(once);
  });
});
