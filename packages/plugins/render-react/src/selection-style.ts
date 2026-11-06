/**
 * 节点选中态样式常量与反色判定（2026-11-04 选中态治理，同日二轮收敛）
 *
 * 需求（用户原话要点）：选中环与节点边缘保持 2px 距离；不用 accent 红
 * (#e94560)；用"主体反色"——深底节点给浅环、浅底节点给深环；不扎眼。
 * 二轮反馈「白边太粗」：线宽 2px→1px，透明度 0.55→0.38，无 glow，hover 无环。
 *
 * 说明：全局主题 token（packages/shared outlineSelectedColor）未改动；
 * 节点外壳的选中态不再引用该 token，改用本模块按节点底色计算的局部常量。
 */

/** 选中环与节点边缘的外扩距离(px) —— outline-offset */
export const SELECTION_RING_OFFSET = 2;
/** 选中环线宽(px) —— 二轮收敛 2→1 */
export const SELECTION_RING_WIDTH = 1;
/** 深底节点选中环：半透明白（alpha 0.38，二轮收敛 0.55→0.38） */
export const SELECTION_RING_ON_DARK = 'rgba(255, 255, 255, 0.38)';
/** 浅底节点选中环：半透明深 slate（alpha 0.38） */
export const SELECTION_RING_ON_LIGHT = 'rgba(15, 23, 42, 0.38)';
/** 选中标题色（标题栏位于节点外的画布背景上）：中性 slate 0.85 透明度，与环同档收敛 */
export const SELECTION_TITLE_ON_DARK = 'rgba(203, 213, 225, 0.85)';
export const SELECTION_TITLE_ON_LIGHT = 'rgba(71, 85, 105, 0.85)';
/** 重命名输入框下划线（选中态）：中性 slate-400 0.5 透明度，与环同档收敛 */
export const SELECTION_RENAME_UNDERLINE = 'rgba(148, 163, 184, 0.5)';

/**
 * WCAG 相对亮度（0=纯黑，1=纯白）。支持 #rgb/#rrggbb/rgb()/rgba()。
 * 无法解析（如 CSS 变量、颜色关键字）返回 null。
 */
export function relativeLuminance(color: string): number | null {
  const c = color.trim();
  let r: number; let g: number; let b: number;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3) {
      r = parseInt(h[0]! + h[0]!, 16);
      g = parseInt(h[1]! + h[1]!, 16);
      b = parseInt(h[2]! + h[2]!, 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
  } else {
    const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i.exec(c);
    if (!rgb) return null;
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
    if (r > 255 || g > 255 || b > 255) return null;
  }
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 亮度翻转阈值：WCAG 亮度 0.22 ≈ sRGB 中灰 #808080，两侧环色可读性相当 */
const LUMINANCE_FLIP_THRESHOLD = 0.22;

/**
 * 主体反色选中环：按节点底色亮度取反方向的中性色。
 * 底色无法解析时按深底处理（画布默认深色主题，白环可读）。
 */
export function selectionRingColor(background?: string | null): string {
  const lum = background ? relativeLuminance(background) : null;
  if (lum === null) return SELECTION_RING_ON_DARK;
  return lum < LUMINANCE_FLIP_THRESHOLD ? SELECTION_RING_ON_DARK : SELECTION_RING_ON_LIGHT;
}

/** 选中标题色：按节点主题明暗取中性色（标题在节点外，参点画布背景而非节点底色） */
export function selectionTitleColor(theme: string | undefined): string {
  return theme === 'light' ? SELECTION_TITLE_ON_LIGHT : SELECTION_TITLE_ON_DARK;
}
