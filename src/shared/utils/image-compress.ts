/**
 * image-compress - 封面上传自动压缩(>5MB 不拒绝,自动压到达标)
 *
 * 策略(2026-11-04 约定):
 * 1. 最长边 > COVER_MAX_EDGE 先等比缩边;
 * 2. JPEG 走质量阶梯 COVER_JPEG_LADDER 逐档降到 ≤ COVER_TARGET_BYTES(内部目标 3MB,硬上限 5MB);
 * 3. PNG 缩边后优先保留 PNG(保透明);仍超硬上限才转 JPEG 并标记 convertedToJpeg(调用方提示);
 * 4. 解码走 createImageBitmap(异步不卡 UI),失败回退 HTMLImageElement。
 * 纯函数(scaleToMaxEdge/planJpegQualities/needsCompression)进单测;canvas 编码不进。
 */

/** 最长边上限(px) */
export const COVER_MAX_EDGE = 3840;
/** 内部目标体积(字节) —— 压缩逐档降到 ≤3MB */
export const COVER_TARGET_BYTES = 3 * 1024 * 1024;
/** 硬上限(字节) —— 超 5MB 才触发压缩;裁剪输出也不得超过 */
export const COVER_HARD_LIMIT = 5 * 1024 * 1024;
/** JPEG 质量阶梯 */
export const COVER_JPEG_LADDER = [0.92, 0.85, 0.8, 0.72, 0.6] as const;

export interface CompressInfo {
  origBytes: number;
  outBytes: number;
  origW: number;
  origH: number;
  outW: number;
  outH: number;
  /** PNG 保不住透明被转 JPEG */
  convertedToJpeg: boolean;
}

/** 等比缩到最长边 ≤ maxEdge(已小于则原样) */
export function scaleToMaxEdge(w: number, h: number, maxEdge = COVER_MAX_EDGE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w, h };
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { w, h };
  const k = maxEdge / edge;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** 是否需要压缩: 体积超目标或最长边超上限 */
export function needsCompression(bytes: number, w: number, h: number): boolean {
  return bytes > COVER_TARGET_BYTES || Math.max(w, h) > COVER_MAX_EDGE;
}

/**
 * JPEG 质量阶梯计划: 从首档开始逐档试,返回应尝试的质量序列(全部试过仍超标则由调用方取最小档并标记)。
 * 纯函数,便于断言阶梯顺序与兜底。
 */
export function planJpegQualities(): readonly number[] {
  return COVER_JPEG_LADDER;
}

/** PNG 分支决策: 缩边后的 PNG 仍超硬上限 → 保不住透明,转 JPEG(调用方需提示) */
export function pngMustConvert(pngBytes: number): boolean {
  return pngBytes > COVER_HARD_LIMIT;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // 回退 HTMLImageElement
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = url;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality);
  });
}

/**
 * 压缩封面源图: 返回可直接入库的 File + 压缩信息(供可见反馈)。
 * 若本已达标(≤目标且边长合规)仍统一重编码一遍以剥离异常元数据?——不,达标则原样返回,零损耗。
 */
export async function compressForCover(file: File): Promise<{ file: File; info: CompressInfo }> {
  const decoded = await decode(file);
  try {
    const { w: origW, h: origH } = decoded;
    const target = scaleToMaxEdge(origW, origH);
    const resized = target.w !== origW || target.h !== origH;
    const isPng = file.type === 'image/png';

    // 未超目标且未缩边 → 原样(不解码重编码,零损耗)
    if (!resized && file.size <= COVER_TARGET_BYTES) {
      return {
        file,
        info: { origBytes: file.size, outBytes: file.size, origW, origH, outW: origW, outH: origH, convertedToJpeg: false },
      };
    }

    const canvas = draw(decoded.source, target.w, target.h);

    if (isPng) {
      const png = await toBlob(canvas, 'image/png');
      if (!pngMustConvert(png.size)) {
        return {
          file: new File([png], file.name, { type: 'image/png' }),
          info: { origBytes: file.size, outBytes: png.size, origW, origH, outW: target.w, outH: target.h, convertedToJpeg: false },
        };
      }
      // PNG 保不住 → 落 JPEG 阶梯并标记
      const jpeg = await encodeJpegLadder(canvas);
      return {
        file: new File([jpeg], file.name.replace(/\.png$/i, '.jpg'), { type: 'image/jpeg' }),
        info: { origBytes: file.size, outBytes: jpeg.size, origW, origH, outW: target.w, outH: target.h, convertedToJpeg: true },
      };
    }

    const jpeg = await encodeJpegLadder(canvas);
    return {
      file: new File([jpeg], file.name, { type: 'image/jpeg' }),
      info: { origBytes: file.size, outBytes: jpeg.size, origW, origH, outW: target.w, outH: target.h, convertedToJpeg: false },
    };
  } finally {
    decoded.close?.();
  }
}

/** 沿质量阶梯编码到 ≤ COVER_TARGET_BYTES;阶梯耗尽则取最小档(此时必然 ≤ 硬上限,否则抛错) */
async function encodeJpegLadder(canvas: HTMLCanvasElement): Promise<Blob> {
  let last: Blob | null = null;
  for (const q of planJpegQualities()) {
    last = await toBlob(canvas, 'image/jpeg', q);
    if (last.size <= COVER_TARGET_BYTES) return last;
  }
  if (last && last.size <= COVER_HARD_LIMIT) return last;
  throw new Error('compressed image still exceeds 5MB hard limit');
}
