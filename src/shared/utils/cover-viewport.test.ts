/**
 * cover-viewport 单测(等比 px 模型,2026-11-04 硬验收):
 * - 竖图 1080×1920 / 横图 1920×1080 / 超宽图 3000×800,
 *   scale = 1 / 1.5 / maxScale 时渲染宽高比与原图比例差 ≤ 0.001(严格等比,无形变);
 * - scale=1 时短边恰好等于视口对应边(误差 ≤ 1px)—— cover 而非 fill;
 * - 裁剪输出恒 1920×1080 且源矩形比例 16:9;
 * - 平移钳制按等比尺寸算,任意位置不露底。
 */

import { describe, expect, it } from 'vitest';
import {
  COVER_ASPECT,
  COVER_OUT_H,
  COVER_OUT_W,
  DEFAULT_VIEW,
  clampView,
  coverScaleBase,
  displaySizePx,
  isDefaultView,
  maxScaleFor,
  panLimitsPx,
  resolveSourceKey,
  viewImageStylePx,
  viewToCropRect,
} from './cover-viewport.js';

const VW = 640;
const VH = VW / COVER_ASPECT; // 360

const PORTRAIT = { w: 1080, h: 1920 }; // 竖图 9:16
const LANDSCAPE = { w: 1920, h: 1080 }; // 横图 16:9
const WIDE = { w: 3000, h: 800 }; // 超宽图 15:4

/** 断言可视矩形严格落在原图内(= 视口内不露底) */
function expectRectInsideImage(imgW: number, imgH: number, view: { scale: number; tx: number; ty: number }) {
  const r = viewToCropRect(imgW, imgH, view);
  expect(r.sx).toBeGreaterThanOrEqual(-1e-6);
  expect(r.sy).toBeGreaterThanOrEqual(-1e-6);
  expect(r.sx + r.sw).toBeLessThanOrEqual(imgW + 1e-6);
  expect(r.sy + r.sh).toBeLessThanOrEqual(imgH + 1e-6);
  expect(r.sw).toBeGreaterThan(0);
  expect(r.sh).toBeGreaterThan(0);
  return r;
}

describe('严格等比(渲染宽高比 = 原图比例,偏差 ≤ 0.001)', () => {
  it.each([
    ['竖图', PORTRAIT],
    ['横图', LANDSCAPE],
    ['超宽图', WIDE],
  ] as const)('%s %dx%d: scale = 1 / 1.5 / maxScale 均不形变', (_name, img) => {
    const maxScale = maxScaleFor(img.w, img.h, VW, VH);
    expect(maxScale).toBeGreaterThanOrEqual(1);
    for (const scale of [1, 1.5, maxScale]) {
      const { dw, dh } = displaySizePx(img.w, img.h, VW, VH, { scale, tx: 0, ty: 0 });
      expect(Math.abs(dw / dh - img.w / img.h)).toBeLessThanOrEqual(0.001);
      // 单缩放因子派生: dw = imgW·s, dh = imgH·s
      const s = coverScaleBase(img.w, img.h, VW, VH) * scale;
      expect(dw).toBeCloseTo(img.w * s, 6);
      expect(dh).toBeCloseTo(img.h * s, 6);
    }
  });

  it('viewImageStylePx 输出的 width/height 也是等比派生(px,非 %)', () => {
    for (const img of [PORTRAIT, LANDSCAPE, WIDE]) {
      const s = viewImageStylePx(img.w, img.h, VW, VH, { scale: 1.5, tx: 0, ty: 0 });
      expect(s.width.endsWith('px')).toBe(true);
      expect(s.height.endsWith('px')).toBe(true);
      const dw = parseFloat(s.width);
      const dh = parseFloat(s.height);
      expect(Math.abs(dw / dh - img.w / img.h)).toBeLessThanOrEqual(0.001);
    }
  });
});

describe('scale=1 恰好 cover(短边贴视口,误差 ≤ 1px)', () => {
  it('竖图: 宽 = 视口宽(短边),高溢出', () => {
    const { dw, dh } = displaySizePx(PORTRAIT.w, PORTRAIT.h, VW, VH, DEFAULT_VIEW);
    expect(Math.abs(dw - VW)).toBeLessThanOrEqual(1);
    expect(dh).toBeGreaterThan(VH);
  });

  it('横图 16:9: 宽高同时 = 视口(恰好全贴合)', () => {
    const { dw, dh } = displaySizePx(LANDSCAPE.w, LANDSCAPE.h, VW, VH, DEFAULT_VIEW);
    expect(Math.abs(dw - VW)).toBeLessThanOrEqual(1);
    expect(Math.abs(dh - VH)).toBeLessThanOrEqual(1);
  });

  it('超宽图: 高 = 视口高(短边),宽溢出', () => {
    const { dw, dh } = displaySizePx(WIDE.w, WIDE.h, VW, VH, DEFAULT_VIEW);
    expect(Math.abs(dh - VH)).toBeLessThanOrEqual(1);
    expect(dw).toBeGreaterThan(VW);
  });

  it('cover 基准 s0 = max(vw/imgW, vh/imgH)', () => {
    expect(coverScaleBase(PORTRAIT.w, PORTRAIT.h, VW, VH)).toBeCloseTo(VW / PORTRAIT.w, 9);
    expect(coverScaleBase(WIDE.w, WIDE.h, VW, VH)).toBeCloseTo(VH / WIDE.h, 9);
  });
});

describe('平移钳制不露底', () => {
  it('竖图 scale=1: 横向锁死,纵向钳制后不露空白', () => {
    const v = clampView(PORTRAIT.w, PORTRAIT.h, VW, VH, { scale: 1, tx: 999, ty: -999 });
    const { mx, my } = panLimitsPx(PORTRAIT.w, PORTRAIT.h, VW, VH, v);
    expect(mx).toBeCloseTo(0, 6); // 宽恰好撑满 → 横向不可动
    expect(my).toBeGreaterThan(0);
    expect(v.tx).toBe(0);
    expect(v.ty).toBeCloseTo(-my / VW, 9);
    expectRectInsideImage(PORTRAIT.w, PORTRAIT.h, v);
  });

  it('超宽图 scale=1: 纵向锁死,横向钳制', () => {
    const v = clampView(WIDE.w, WIDE.h, VW, VH, { scale: 1, tx: -999, ty: 999 });
    const { mx, my } = panLimitsPx(WIDE.w, WIDE.h, VW, VH, v);
    expect(my).toBeCloseTo(0, 6);
    expect(v.tx).toBeCloseTo(-mx / VW, 9);
    expect(v.ty).toBe(0);
    expectRectInsideImage(WIDE.w, WIDE.h, v);
  });

  it('scale<1 被抬回 1(缩放下限 = 刚好铺满)', () => {
    const v = clampView(PORTRAIT.w, PORTRAIT.h, VW, VH, { scale: 0.3, tx: 0, ty: 0 });
    expect(v.scale).toBe(1);
    expectRectInsideImage(PORTRAIT.w, PORTRAIT.h, v);
  });

  it('放大后平移到四象限极限仍不露底(三种图型)', () => {
    for (const img of [PORTRAIT, LANDSCAPE, WIDE]) {
      const s = 1.5;
      const { mx, my } = panLimitsPx(img.w, img.h, VW, VH, { scale: s, tx: 0, ty: 0 });
      for (const tx of [-mx / VW, mx / VW]) {
        for (const ty of [-my / VW, my / VW]) {
          expectRectInsideImage(img.w, img.h, { scale: s, tx, ty });
        }
      }
    }
  });
});

describe('裁剪矩形恒 16:9,输出恒 1920×1080', () => {
  it.each([
    [PORTRAIT, DEFAULT_VIEW],
    [PORTRAIT, { scale: 1.5, tx: 0, ty: 0.2 }],
    [PORTRAIT, { scale: 2, tx: 0, ty: -0.3 }],
    [LANDSCAPE, { scale: 1.5, tx: 0.1, ty: 0 }],
    [WIDE, { scale: 1.2, tx: -0.2, ty: 0 }],
    [WIDE, { scale: 1, tx: 0.5, ty: 0 }],
  ] as const)('viewToCropRect 源矩形宽高比 = 16/9', (img, view) => {
    const r = viewToCropRect(img.w, img.h, { ...view });
    expect(r.sw / r.sh).toBeCloseTo(COVER_ASPECT, 6);
    expect(COVER_OUT_W / COVER_OUT_H).toBeCloseTo(COVER_ASPECT, 6);
  });

  it('竖图默认取景: 全宽入画,上下居中裁', () => {
    const r = viewToCropRect(PORTRAIT.w, PORTRAIT.h, DEFAULT_VIEW);
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(PORTRAIT.w, 6);
    expect(r.sh).toBeCloseTo(PORTRAIT.w / COVER_ASPECT, 6);
  });

  it('16:9 图默认取景 = 全图', () => {
    const r = viewToCropRect(LANDSCAPE.w, LANDSCAPE.h, DEFAULT_VIEW);
    expect(r.sx).toBeCloseTo(0, 6);
    expect(r.sy).toBeCloseTo(0, 6);
    expect(r.sw).toBeCloseTo(LANDSCAPE.w, 6);
    expect(r.sh).toBeCloseTo(LANDSCAPE.h, 6);
  });

  it('输出尺寸常量 = 1920×1080', () => {
    expect(COVER_OUT_W).toBe(1920);
    expect(COVER_OUT_H).toBe(1080);
  });
});

describe('再编辑底图抉择(resolveSourceKey)', () => {
  it('有取景记录 → 用原图 sourceKey 回填', () => {
    const r = resolveSourceKey({ sourceKey: 'image:src/1.jpg', scale: 1.5, tx: 0.1, ty: -0.2 }, 'image:cover/2.jpg');
    expect(r).toEqual({ key: 'image:src/1.jpg', degraded: false });
  });

  it('旧封面无记录 → 封面本身当底图', () => {
    expect(resolveSourceKey(null, 'image:cover/2.jpg')).toEqual({ key: 'image:cover/2.jpg', degraded: false });
    expect(resolveSourceKey(null, null)).toEqual({ key: null, degraded: false });
  });
});

describe('钳制与兜底', () => {
  it('非法输入(NaN)回退居中铺满', () => {
    expect(clampView(PORTRAIT.w, PORTRAIT.h, VW, VH, { scale: NaN, tx: 0, ty: 0 })).toEqual(DEFAULT_VIEW);
    expect(clampView(PORTRAIT.w, PORTRAIT.h, 0, 0, { scale: 2, tx: 1, ty: 1 })).toEqual(DEFAULT_VIEW);
  });

  it('isDefaultView 判定', () => {
    expect(isDefaultView(null)).toBe(true);
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView({ scale: 1.1, tx: 0, ty: 0 })).toBe(false);
  });

  it('maxScaleFor: s0·scale ≤ 2(原始像素 1:1 的 2 倍)', () => {
    // 竖图: s0 = 640/1080 → maxScale = 2/s0 ≈ 3.375
    expect(maxScaleFor(PORTRAIT.w, PORTRAIT.h, VW, VH)).toBeCloseTo((2 * PORTRAIT.w) / VW, 6);
    // 极小图(s0 ≥ 2): 上限抬回 1
    expect(maxScaleFor(100, 100, VW, VH)).toBe(1);
    // 非法尺寸: s0 兜底为 1 → 上限 = MAX_UPSCALE
    expect(maxScaleFor(0, 0, VW, VH)).toBe(2);
  });
});
