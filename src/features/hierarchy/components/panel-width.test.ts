/**
 * panel-width 验收（2026-11-05）
 *
 * 1) 默认宽度由瀑布流卡宽推导：2*cardWidth + gap + 2*paddingX，不写死；
 * 2) 上限随视口变化：max(2/3vw, vw−320) 且 ≤92vw，不再用固定像素；
 * 3) 用户拖拽值优先；
 * 4) 窄窗不低于 360（≥1 列可读）；
 * 5) 历史默认 400/450 可识别（迁移由 view-prefs 载入时执行）。
 */
import { describe, expect, it } from 'vitest';
import { masonryColumnsForWidth } from '@/shared/components/masonry-grid.js';
import {
  HIERARCHY_PANEL_DEFAULT_WIDTH,
  HIERARCHY_PANEL_MIN_WIDTH,
  clampHierarchyPanelWidth,
  deriveHierarchyPanelWidth,
  hierarchyPanelWidthCap,
  isLegacyHierarchyPanelWidth,
  resolveHierarchyPanelWidth,
} from './panel-width.js';

describe('默认宽度公式（与瀑布流参数共用同一组常量）', () => {
  it('cardWidth 176 / 182 / 220 三档', () => {
    expect(deriveHierarchyPanelWidth(176, 16, 20)).toBe(408); // 352+16+40
    expect(deriveHierarchyPanelWidth(182, 16, 20)).toBe(420); // 364+16+40
    expect(deriveHierarchyPanelWidth(220, 16, 20)).toBe(496); // 440+16+40
  });

  it('缺省参数 = 基准卡宽 220 → 496（≈ 两个卡片宽）', () => {
    expect(deriveHierarchyPanelWidth()).toBe(496);
  });

  it('默认宽度容纳两列卡片：496 − 右侧拖拽让位 12 = 484 → 2 列', () => {
    expect(masonryColumnsForWidth(HIERARCHY_PANEL_DEFAULT_WIDTH - 12)).toBe(2);
  });

  it('历史默认宽度识别：400 / 450 是，520 不是', () => {
    expect(isLegacyHierarchyPanelWidth(400)).toBe(true);
    expect(isLegacyHierarchyPanelWidth(450)).toBe(true);
    expect(isLegacyHierarchyPanelWidth(520)).toBe(false);
    expect(isLegacyHierarchyPanelWidth(0)).toBe(false);
  });
});

describe('视口夹取与用户值优先级', () => {
  it('1080 / 1440 视口：默认值不被 92vw 截断', () => {
    expect(resolveHierarchyPanelWidth(0, 1080)).toBe(496);
    expect(resolveHierarchyPanelWidth(0, 1440)).toBe(496);
  });

  it('1280 / 1440 / 1920 视口：默认均为 496，不做手拖也保持两列', () => {
    expect(resolveHierarchyPanelWidth(0, 1280)).toBe(496);
    expect(resolveHierarchyPanelWidth(0, 1440)).toBe(496);
    expect(resolveHierarchyPanelWidth(0, 1920)).toBe(496);
  });

  it('窄视口上限随视口收缩，仍不低于 360', () => {
    expect(resolveHierarchyPanelWidth(0, 500)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
    expect(resolveHierarchyPanelWidth(0, 400)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
  });

  it('极窄视口不低于 360（1 列可读）', () => {
    expect(resolveHierarchyPanelWidth(0, 380)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
    expect(resolveHierarchyPanelWidth(0, 300)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
  });

  it('用户拖拽过的值优先于默认值', () => {
    expect(resolveHierarchyPanelWidth(520, 1080)).toBe(520);
    expect(resolveHierarchyPanelWidth(520, 1440)).toBe(520);
  });

  it('用户值仍收在最小宽与视口上限内', () => {
    expect(resolveHierarchyPanelWidth(300, 1440)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
    expect(resolveHierarchyPanelWidth(900, 500)).toBe(HIERARCHY_PANEL_MIN_WIDTH);
  });

  it('上限不再钉死 640：1280 / 1440 / 1920 可拖到 960 / 1120 / 1600', () => {
    expect(hierarchyPanelWidthCap(1280)).toBe(960);
    expect(hierarchyPanelWidthCap(1440)).toBe(1120);
    expect(hierarchyPanelWidthCap(1920)).toBe(1600);
  });

  it('上限至少覆盖 2/3 视口', () => {
    for (const vw of [1024, 1280, 1440, 1920]) {
      expect(hierarchyPanelWidthCap(vw)).toBeGreaterThanOrEqual(Math.ceil(vw * 2 / 3));
    }
  });

  it('拖拽 clamps 用同一套边界：850 在 1920 保留，在 1024 收到 704', () => {
    expect(clampHierarchyPanelWidth(850, 1920)).toBe(850);
    expect(clampHierarchyPanelWidth(850, 1024)).toBe(704);
    expect(clampHierarchyPanelWidth(1600, 1920)).toBe(1600);
    expect(clampHierarchyPanelWidth(2000, 1920)).toBe(1600);
  });
});
