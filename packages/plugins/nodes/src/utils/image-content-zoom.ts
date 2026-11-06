/**
 * image-content-zoom - 图片节点内容缩放纯函数(2026-11-04)
 *
 * 背景: 用户实测「图片节点无法缩放」——角柄 resize 依赖选中态且 28px 透明命中区不易发现。
 * 这里提供不依赖选中态的节点内缩放:滚轮按光标位置缩放 + 双击 fit/1:1 切换。
 * 只缩放节点内图片内容(transform scale),节点尺寸不变 → 宽高比恒不变。
 */

/** 内容缩放上下限 */
export const CONTENT_SCALE_MIN = 0.1;
export const CONTENT_SCALE_MAX = 10;

/** 滚轮灵敏度:每 1000 deltaY ≈ e^-1.8 ≈ 0.165 倍 */
const WHEEL_SENSITIVITY = 0.0018;

export function clampContentScale(scale: number): number {
  // NaN(无方向)回退 1;±Infinity(极端 deltaY 指数溢出)钳到对应端点
  if (Number.isNaN(scale)) return 1;
  if (!Number.isFinite(scale)) return scale > 0 ? CONTENT_SCALE_MAX : CONTENT_SCALE_MIN;
  return Math.min(CONTENT_SCALE_MAX, Math.max(CONTENT_SCALE_MIN, scale));
}

/** 滚轮一步后的新缩放:deltaY<0(向上滚)放大,deltaY>0 缩小 */
export function nextContentScale(scale: number, deltaY: number): number {
  return clampContentScale(scale * Math.exp(-deltaY * WHEEL_SENSITIVITY));
}

/** 光标在容器内的百分比位置(作为 transform-origin,实现「按光标位置缩放」) */
export function cursorOriginPercent(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 50, y: 50 };
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
  };
}

/** 双击切换:fit(scale=1) ↔ 目标倍率(1:1 或回退值) */
export function toggleContentScale(current: number, target: number): number {
  return current === 1 ? clampContentScale(target) : 1;
}

/**
 * contain 布局下「1:1 像素」对应的内容缩放倍率:
 * contain 显示尺寸 = min(boxW, boxH × 宽高比) 宽;1:1 倍率 = 原图宽 / 显示宽。
 * 入参缺失/非法时返回 null(调用方回退固定倍率)。
 */
export function oneToOneScale(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  boxWidth: number,
  boxHeight: number,
): number | null {
  if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) return null;
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  const ratio = naturalWidth / naturalHeight;
  const displayedWidth = Math.min(boxWidth, boxHeight * ratio);
  if (displayedWidth <= 0) return null;
  return clampContentScale(naturalWidth / displayedWidth);
}
