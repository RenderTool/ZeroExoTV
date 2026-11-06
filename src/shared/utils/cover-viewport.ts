/**
 * cover-viewport - 封面取景(固定 16:9 视口 + 平移缩放 + 真裁剪)纯函数层
 *
 * 等比铁律(2026-11-04 约定): 图片只有一个缩放因子 scale,
 * 渲染宽高恒由 imgW×(s0·scale) / imgH×(s0·scale) 派生(px),禁止 width/height 分别贴视口(会形变)。
 * - s0 = max(vw/imgW, vh/imgH): scale=1 恰好 cover(短边贴视口、长边溢出),不是 fill;
 * - tx/ty 以视口宽 vw 为单位(>0 向右/下),平移钳制按等比尺寸算,任意位置不露底;
 * - 持久化只存 { sourceKey, scale, tx, ty }(侧车);确认时按可视区真裁剪出 1920×1080;
 * - 旧封面无视景记录 → DEFAULT_VIEW(居中铺满),行为与原 objectFit:cover 一致。
 */

import { COVER_HARD_LIMIT, COVER_JPEG_LADDER } from './image-compress.js';

/** 取景参数: scale=相对 cover 基准的倍率(≥1); tx/ty=图片平移(视口宽单位) */
export interface CoverView {
  scale: number;
  tx: number;
  ty: number;
}

/** 侧车记录: 取景参数 + 原图 sourceKey(封面 key 指向裁剪结果,再调整需回到原图) */
export interface CoverViewRecord extends CoverView {
  sourceKey: string;
}

/** 默认取景: 居中铺满 */
export const DEFAULT_VIEW: CoverView = { scale: 1, tx: 0, ty: 0 };

/** 封面输出尺寸(确认时真裁剪,固定 16:9) */
export const COVER_OUT_W = 1920;
export const COVER_OUT_H = 1080;
export const COVER_ASPECT = COVER_OUT_W / COVER_OUT_H;

/** 缩放上限裕量: 显示像素密度最多放到原始 1:1 的 2 倍 */
const MAX_UPSCALE = 2;

/** cover 基准像素密度 s0(px CSS / px 原图): scale=1 时短边恰好贴视口 */
export function coverScaleBase(imgW: number, imgH: number, vw: number, vh: number): number {
  if (imgW <= 0 || imgH <= 0 || vw <= 0 || vh <= 0) return 1;
  return Math.max(vw / imgW, vh / imgH);
}

/** 当前取下的等比渲染尺寸(px): 单缩放因子派生,宽高比恒 = 原图比例 */
export function displaySizePx(
  imgW: number,
  imgH: number,
  vw: number,
  vh: number,
  view: CoverView,
): { dw: number; dh: number } {
  const s = coverScaleBase(imgW, imgH, vw, vh) * Math.max(view.scale, 1e-6);
  return { dw: imgW * s, dh: imgH * s };
}

/** 平移合法域(px): 图片超出视口部分的一半;不超出则锁 0 */
export function panLimitsPx(
  imgW: number,
  imgH: number,
  vw: number,
  vh: number,
  view: CoverView,
): { mx: number; my: number } {
  const { dw, dh } = displaySizePx(imgW, imgH, vw, vh, view);
  return { mx: Math.max(0, (dw - vw) / 2), my: Math.max(0, (dh - vh) / 2) };
}

/** 缩放上限: s0·scale ≤ MAX_UPSCALE → scale ≤ MAX_UPSCALE / s0;小图兜底 ≥1 */
export function maxScaleFor(imgW: number, imgH: number, vw: number, vh: number): number {
  const s0 = coverScaleBase(imgW, imgH, vw, vh);
  if (s0 <= 0) return 1;
  return Math.max(1, MAX_UPSCALE / s0);
}

/** 钳制取景: scale ∈ [1, maxScale],|tx·vw| ≤ mx, |ty·vw| ≤ my;非法输入回退 DEFAULT_VIEW */
export function clampView(
  imgW: number,
  imgH: number,
  vw: number,
  vh: number,
  view: CoverView,
  maxScale = Infinity,
): CoverView {
  const { scale, tx, ty } = view;
  if (![scale, tx, ty].every(Number.isFinite) || vw <= 0 || vh <= 0) return { ...DEFAULT_VIEW };
  const s = Math.min(Math.max(scale, 1), Math.max(1, maxScale));
  const { mx, my } = panLimitsPx(imgW, imgH, vw, vh, { scale: s, tx: 0, ty: 0 });
  return {
    scale: s,
    tx: Math.min(Math.max(tx, -mx / vw), mx / vw),
    ty: Math.min(Math.max(ty, -my / vw), my / vw),
  };
}

/** 是否默认取景(居中铺满,容差 1e-6) */
export function isDefaultView(view: CoverView | null | undefined): boolean {
  if (!view) return true;
  return Math.abs(view.scale - 1) < 1e-6 && Math.abs(view.tx) < 1e-6 && Math.abs(view.ty) < 1e-6;
}

/**
 * 取景 → 原图可视矩形(像素),即确认时真正裁出的区域。
 * 与视口 CSS 尺寸无关(vw 在推导中约掉):
 *   sw = min(imgW, aspect·imgH)/scale,sh = sw/aspect —— 比例恒 16:9,无二次拉伸;
 *   sx = (imgW-sw)/2 - tx·sw,sy = (imgH-sh)/2 - ty·sh,再钳进原图边界。
 */
export function viewToCropRect(
  imgW: number,
  imgH: number,
  view: CoverView,
): { sx: number; sy: number; sw: number; sh: number } {
  if (imgW <= 0 || imgH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const scale = Number.isFinite(view.scale) ? Math.max(view.scale, 1) : 1;
  const sw = Math.min(imgW, COVER_ASPECT * imgH) / scale;
  const sh = sw / COVER_ASPECT;
  const tx = Number.isFinite(view.tx) ? view.tx : 0;
  const ty = Number.isFinite(view.ty) ? view.ty : 0;
  const sx = Math.min(Math.max((imgW - sw) / 2 - tx * sw, 0), imgW - sw);
  const sy = Math.min(Math.max((imgH - sh) / 2 - ty * sh, 0), imgH - sh);
  return { sx, sy, sw, sh };
}

/**
 * 视口内 <img> 的 px 定位样式(外层需 relative + overflow:hidden + aspect-ratio: aspect)。
 * width/height 由同一缩放因子派生 —— 严格等比,禁止改成分别贴视口的 % 写法。
 */
export function viewImageStylePx(
  imgW: number,
  imgH: number,
  vw: number,
  vh: number,
  view: CoverView,
): { position: 'absolute'; left: string; top: string; width: string; height: string; display: 'block' } {
  const { dw, dh } = displaySizePx(imgW, imgH, vw, vh, view);
  const left = (vw - dw) / 2 + view.tx * vw;
  const top = (vh - dh) / 2 + view.ty * vw;
  return {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${dw}px`,
    height: `${dh}px`,
    display: 'block',
  };
}

/**
 * 再编辑的底图抉择: 有取景记录用原图(sourceKey);记录缺失/旧封面 → 封面本身,degraded=false;
 * 原图加载失败由调用方回退封面并置 degraded=true(提示「原图不可用」)。
 */
export function resolveSourceKey(
  record: CoverViewRecord | null,
  coverKey: string | null | undefined,
): { key: string | null; degraded: boolean } {
  if (record?.sourceKey) return { key: record.sourceKey, degraded: false };
  return { key: coverKey ?? null, degraded: false };
}

/**
 * 确认即真裁剪: 按可视区从原图裁出 1920×1080 JPEG(源矩形比例恒 16:9,目标 1920×1080,无二次拉伸)。
 * 体积兜底: 若首档超 5MB 沿质量阶梯重编码;失败抛错(调用方提示并保留原封面)。
 * jsdom 无 canvas,此函数不进单测;几何由 viewToCropRect 单测保证。
 */
export async function cropToCoverFile(
  image: HTMLImageElement | ImageBitmap,
  imgW: number,
  imgH: number,
  view: CoverView,
): Promise<File> {
  const { sx, sy, sw, sh } = viewToCropRect(imgW, imgH, view);
  const canvas = document.createElement('canvas');
  canvas.width = COVER_OUT_W;
  canvas.height = COVER_OUT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, COVER_OUT_W, COVER_OUT_H);
  // 体积兜底: 沿共享质量阶梯重编码到 ≤5MB 硬上限;失败抛错(调用方提示并保留原封面)
  for (const q of COVER_JPEG_LADDER) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    if (!blob) throw new Error('canvas.toBlob failed');
    if (blob.size <= COVER_HARD_LIMIT) {
      return new File([blob], 'cover-1920x1080.jpg', { type: 'image/jpeg' });
    }
  }
  throw new Error('cropped cover exceeds 5MB even at lowest quality');
}
