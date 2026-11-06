/**
 * stable-columns - 列数滞回（2026-11-06 修复抽屉瀑布流「疯狂抖动」）
 *
 * 抖动链条（三者构成闭环，缺一环都不会抖）：
 * 1) 列数 = f(容器宽度)（断点表）；
 * 2) 卡片高度 = g(列宽)（瀑布流封面按真实比例算高度，状态卡网格同理）；
 * 3) 容器宽度 = 抽屉内宽 − 竖向滚动条宽（Windows Chrome 经典滚动条占 ~15px，且**只在内容超高时出现**）。
 *
 * 于是：宽度正好压在某个断点上、内容高度又压在容器高度附近时——
 * N 列 → 内容变矮 → 滚动条消失 → 宽度 +15px → 越过断点 → N+1 列 → 内容变高 → 滚动条出现 → 宽度 −15px → 回到 N 列 →
 * ResizeObserver 每轮都触发 setState，肉眼就是「打开后一直抖」。
 *
 * 根治分两层（本模块只做第 2 层，第 1 层是滚动容器加 `scrollbar-gutter: stable` 让宽度恒定）：
 * 列数只在**真正进入新区间并留够死区**时才改变，边界 ±死区内维持原列数，
 * 让 2) 3) 的反馈断开；顺带把「测到宽度 0」（隐藏容器 / 抽屉展开动画首帧）也维持原值，
 * 不再出现先 1 列再跳列的闪动。
 */

/** 列数切换死区（px）：大于滚动条宽度（~15px），小于一个可感知的布局档位差 */
export const COLUMN_HYSTERESIS_PX = 24;

/** 二分上界保护（宽度不可能有意义地超过它） */
const MAX_WIDTH_PROBE = 1_000_000;

/**
 * 单调 `columnsFor` 下，第一次达到 target 列的最小宽度（1px 精度二分）。
 * 不要求调用方提供断点表——边界从映射函数本身反查，新增断点无需改这里。
 */
function widthForColumns(columnsFor: (width: number) => number, target: number, hint: number): number {
  let lo = 0;
  let hi = Math.max(Math.round(hint), target * 40, 1);
  let guard = 0;
  while (columnsFor(hi) < target && hi < MAX_WIDTH_PROBE && guard++ < 40) hi *= 2;
  if (columnsFor(hi) < target) return MAX_WIDTH_PROBE;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (columnsFor(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * 带滞回的列数：`previous` 为当前已生效列数（0 = 尚未测量）。
 * - 测到宽度 ≤ 0 → 维持 previous（隐藏容器 / 展开动画首帧）；
 * - 目标列数比当前多 → 要求宽度 ≥ 该列数入口边界 + 死区；
 * - 目标列数比当前少 → 要求宽度 ≤ 回到当前列数的入口边界 − 死区。
 * 纯函数，输入相同输出相同，可直接单测。
 */
export function stableColumnCount(
  width: number,
  previous: number,
  columnsFor: (width: number) => number,
): number {
  if (!Number.isFinite(width) || width <= 0) return previous;
  const natural = columnsFor(width);
  if (previous <= 0 || natural === previous) return natural;
  if (natural > previous) {
    const enter = widthForColumns(columnsFor, natural, width);
    return width >= enter + COLUMN_HYSTERESIS_PX ? natural : previous;
  }
  const backUp = widthForColumns(columnsFor, previous, width);
  return width <= backUp - COLUMN_HYSTERESIS_PX ? natural : previous;
}
