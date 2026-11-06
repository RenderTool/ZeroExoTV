/**
 * panel-width - 资产抽屉默认宽度推导（2026-11-05 用户定稿）
 *
 * 目标：默认宽度约等于「两个卡片宽度」。宽度的唯一来源是瀑布流参数
 * （`masonry-grid` 的基准卡宽 / 列间距 / 容器左右内边距），本文件与卡片侧共用同一组常量，
 * 不在两处各写一份数字。
 *
 * 规则：
 * 1. 默认值 = 2 * cardWidth + gap + 2 * paddingX（当前 = 496px）；
 * 2. 最小值 360px（保证 ≥1 列可读）；上限随视口变化，不用固定像素：
 *    max(2/3 视口, 视口 − 画布保留 320px)，再受 92vw 约束，且不低于 360px；
 * 3. 用户拖拽过的值优先（持久化在 view-prefs 的同一存储键内，不新增存储键）；
 * 4. 历史默认值（400 为持久化实测，450 为旧固定布局宽）视为「未自定义」，载入时一次性迁移到 496 并回写。
 */
import {
  MASONRY_BASE_CARD_WIDTH,
  MASONRY_GAP,
  MASONRY_PADDING_X,
} from '@/shared/components/masonry-grid.js';

/** 抽屉最小可读宽度（≥1 列卡片） */
export const HIERARCHY_PANEL_MIN_WIDTH = 360;
/** 视口占比上限（超宽屏时的绝对保护，避免覆盖层溢出） */
export const HIERARCHY_PANEL_VIEWPORT_RATIO = 0.92;
/** 拖宽时至少给画布保留的像素宽（视口不足时退化为 2/3 视口） */
export const HIERARCHY_PANEL_CANVAS_RESERVE = 320;
/** 拖宽上限占视口的最小比例 */
export const HIERARCHY_PANEL_MIN_VIEWPORT_COVERAGE = 2 / 3;

/** 默认抽屉宽度（不写死数字：由瀑布流卡宽 + 间距 + 内边距推导） */
export function deriveHierarchyPanelWidth(
  cardWidth: number = MASONRY_BASE_CARD_WIDTH,
  gap: number = MASONRY_GAP,
  paddingX: number = MASONRY_PADDING_X,
): number {
  return 2 * cardWidth + gap + 2 * paddingX;
}

/** 当前默认宽度（496）：迁移回写与初值推导共用 */
export const HIERARCHY_PANEL_DEFAULT_WIDTH = deriveHierarchyPanelWidth();

/** 历史默认宽度：落盘值与其中之一相等 → 从未自定义，应迁移到当前默认值 */
export const LEGACY_HIERARCHY_PANEL_WIDTHS: readonly number[] = [450, 400];

/** 是否为历史默认宽度（取整比较，落盘值可能存在亚像素） */
export function isLegacyHierarchyPanelWidth(width: number): boolean {
  return Number.isFinite(width) && LEGACY_HIERARCHY_PANEL_WIDTHS.includes(Math.round(width));
}

/**
 * 抽屉宽度上限（随视口变化）：
 * - 常规屏：视口 − 320（给画布留 320px）；
 * - 视口较窄时：至少 2/3 视口，保证拖宽空间；
 * - 始终受 92vw 约束，且不低于最小可读宽度。
 */
export function hierarchyPanelWidthCap(viewportWidth: number): number {
  const vw = Math.max(0, viewportWidth);
  const relative = Math.max(vw * HIERARCHY_PANEL_MIN_VIEWPORT_COVERAGE, vw - HIERARCHY_PANEL_CANVAS_RESERVE);
  const capped = Math.min(relative, vw * HIERARCHY_PANEL_VIEWPORT_RATIO);
  return Math.max(HIERARCHY_PANEL_MIN_WIDTH, Math.round(capped));
}

/** 把任意宽度夹到 [360, 视口上限]（拖拽与初值共用同一套边界） */
export function clampHierarchyPanelWidth(width: number, viewportWidth: number): number {
  return Math.round(Math.max(HIERARCHY_PANEL_MIN_WIDTH, Math.min(width, hierarchyPanelWidthCap(viewportWidth))));
}

/**
 * 解析实际使用的宽度：
 * - 有用户拖拽值（>0）→ 优先用户值（仍收在视口上限与最小宽之内）；
 * - 否则用推导默认值；
 * - 最终按 clampHierarchyPanelWidth 取整夹取。
 */
export function resolveHierarchyPanelWidth(
  savedWidth: number,
  viewportWidth: number,
  cardWidth?: number,
  gap?: number,
  paddingX?: number,
): number {
  const base = savedWidth > 0 && Number.isFinite(savedWidth)
    ? savedWidth
    : deriveHierarchyPanelWidth(cardWidth, gap, paddingX);
  return clampHierarchyPanelWidth(base, viewportWidth);
}
