/**
 * subject-card-metrics - 主体状态卡固定列宽网格（2026-11-05 用户拍板）
 *
 * 与资产库瀑布流（masonry-grid，列优先、高度随图比例）不同：
 * 主体状态卡封面统一 16:9、总高一致，所以用**固定列宽的行优先网格**，不用瀑布流。
 * 列数按容器实测宽度推导，规则 = 保证单卡不小于 SUBJECT_STATE_CARD_MIN_WIDTH。
 *
 * 用户验收档位：960 → 3 列 / 1280 → 4 列 / 1920 → 6 列。
 * 大屏放宽到 300px+（1920 档单卡约 312px）。
 */

/** 状态卡最小宽度（用户硬要求 260） */
export const SUBJECT_STATE_CARD_MIN_WIDTH = 260;
/** 状态卡列间距 */
export const SUBJECT_STATE_CARD_GAP = 16;
/** 纯函数默认左右内边距（与 masonry-grid 口径一致；组件实测时传 0，因为测量盒本身已去掉页边距） */
export const SUBJECT_STATE_GRID_PADDING_X = 20;
/** 封面固定宽高比（16:9） */
export const SUBJECT_STATE_COVER_ASPECT = '16 / 9';

export interface SubjectStateGridMetrics {
  /** 列数 */
  columns: number;
  /** 单卡宽度（px） */
  cardWidth: number;
  gap: number;
  paddingX: number;
  containerWidth: number;
}

export interface SubjectStateGridOptions {
  gap?: number;
  paddingX?: number;
  /**
   * 显式列数（2026-11-06 修抽屉抖动）：组件侧用 `stableColumnCount` 算出滞回列数后传进来，
   * 保证单卡宽度与实际渲染的列数同源；缺省 = 按容器宽度自然取档。
   */
  columns?: number;
}

/**
 * 固定列宽网格度量：cols = floor((内容宽 + gap) / (最小卡宽 + gap))，至少 1 列。
 * 不设上限列数；卡宽随容器自然增长（大屏可到 300+）。
 */
export function subjectStateGridMetricsForWidth(
  width: number,
  opts: SubjectStateGridOptions = {},
): SubjectStateGridMetrics {
  const gap = opts.gap ?? SUBJECT_STATE_CARD_GAP;
  const paddingX = opts.paddingX ?? SUBJECT_STATE_GRID_PADDING_X;
  const containerWidth = Math.max(0, width);
  const contentWidth = Math.max(0, containerWidth - paddingX * 2);
  const natural = contentWidth >= SUBJECT_STATE_CARD_MIN_WIDTH
    ? Math.max(1, Math.floor((contentWidth + gap) / (SUBJECT_STATE_CARD_MIN_WIDTH + gap)))
    : 1;
  const columns = opts.columns && opts.columns > 0 ? opts.columns : natural;
  const cardWidth = Math.max(0, (contentWidth - gap * (columns - 1)) / columns);
  return { columns, cardWidth, gap, paddingX, containerWidth };
}

/** 只要列数（验收档位：960→3 / 1280→4 / 1920→6） */
export function subjectStateColumnsForWidth(
  width: number,
  opts: SubjectStateGridOptions = {},
): number {
  return subjectStateGridMetricsForWidth(width, opts).columns;
}
