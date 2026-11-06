/**
 * 图片档位单一事实源（2026-11-06，征集 #186）
 *
 * 背景：档位尺寸/命名/物理 key 曾散落在 image-storage.ts、hydrate.ts、backend-upload.ts、
 * resource-url.ts、resolve-media-blob.ts、thumb-image.tsx 六处，注释还停留在 48/256px，
 * 导致「设计 60px 却取 30px 档」、灯箱用缩略图、项目卡拉原图等混乱。
 *
 * 本模块是全仓唯一定义「档位 → 物理尺寸 → 编码参数 → 物理 key → 选档规则」的地方：
 * - 生成侧（uploadImage / CAS 入库）读 IMAGE_VARIANT_SPECS + generateImageVariantBlobs；
 * - 解析侧（resolve-media-blob）读 casVariantPath / variantStorageKey；
 * - 消费侧（ThumbImage 等所有 UI）读 pickImageVariant / imageVariantChain，按 CSS 尺寸 × DPR 协商。
 *
 * 兼容口径：保持既有 thumb 96px / preview 1024px 与 :thumb / :preview 派生键，存量零迁移；
 * 任何档位文件缺失一律回退链内下一档，最终回退 orig（原图）。
 */
export type ImageVariant = 'thumb' | 'preview' | 'orig';

export interface ImageVariantSpec {
  variant: ImageVariant;
  /** 该档物理最大边长（px） */
  maxEdge: number;
  /** JPEG 编码质量（0-1） */
  quality: number;
  /** 源图两边都不超过该值时跳过生成（避免放大失真） */
  sourceMinEdge: number;
}

export const IMAGE_VARIANT_SPECS: Record<ImageVariant, ImageVariantSpec> = {
  thumb: { variant: 'thumb', maxEdge: 96, quality: 0.6, sourceMinEdge: 96 },
  preview: { variant: 'preview', maxEdge: 1024, quality: 0.8, sourceMinEdge: 1024 },
  orig: { variant: 'orig', maxEdge: Number.POSITIVE_INFINITY, quality: 1, sourceMinEdge: 0 },
};

/** 设计尺寸按 2x DPR 预留（层级面板 36px 槽位需 72px，故 thumb 定 96px） */
export const DEFAULT_DPR = 2;

/**
 * 设计显示尺寸 → 应取的最小档位。
 * 例：36px → 72 ≤ 96 → thumb；60px → 120 > 96 → preview；80vw 灯箱 → orig。
 */
export function pickImageVariant(cssPx: number, dpr: number = DEFAULT_DPR): ImageVariant {
  const need = Math.max(1, cssPx) * Math.max(1, dpr);
  if (need <= IMAGE_VARIANT_SPECS.thumb.maxEdge) return 'thumb';
  if (need <= IMAGE_VARIANT_SPECS.preview.maxEdge) return 'preview';
  return 'orig';
}

/** 解析链：首选档 → 更高档兜底 → 原图；低档缺失时宁可取清晰档，绝不向下取更糊的档 */
export function imageVariantChain(cssPx: number, dpr: number = DEFAULT_DPR): readonly ImageVariant[] {
  const pick = pickImageVariant(cssPx, dpr);
  if (pick === 'thumb') return ['thumb', 'preview', 'orig'];
  if (pick === 'preview') return ['preview', 'orig', 'thumb'];
  return ['orig', 'preview', 'thumb'];
}

/** 旧 image:/video: 键的派生档物理 key：'image:xxx' → 'image:xxx:thumb' */
export function variantStorageKey(storageKey: string, variant: ImageVariant): string {
  return variant === 'orig' ? storageKey : `${storageKey}:${variant}`;
}

/** CAS 键格式：cas:<sha256>.<ext> */
export const CAS_KEY_PATTERN = /^cas:([0-9a-f]{64})\.[a-z0-9]+$/i;

/** CAS 派生档物理路径：media/cas/<hash>.thumb.jpg / .preview.jpg（零迁移，缺失即回退 orig） */
export function casVariantPath(hash: string, variant: 'thumb' | 'preview'): string {
  return `media/cas/${hash}.${variant}.jpg`;
}

export interface GeneratedImageVariants {
  thumb: Blob | null;
  preview: Blob | null;
}

/**
 * 一次解码产出两档（性能：旧链路每档各 createImageBitmap 一次，共 3 次解码）。
 * 无 createImageBitmap / 解码失败时返回空，调用方按「派生档缺失」回退原图，不阻断入库。
 */
export async function generateImageVariantBlobs(source: Blob): Promise<GeneratedImageVariants> {
  const out: GeneratedImageVariants = { thumb: null, preview: null };
  if (typeof createImageBitmap !== 'function') return out;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(source);
  } catch {
    return out;
  }
  try {
    for (const variant of ['thumb', 'preview'] as const) {
      const spec = IMAGE_VARIANT_SPECS[variant];
      if (bmp.width <= spec.sourceMinEdge && bmp.height <= spec.sourceMinEdge) continue;
      const scale = Math.min(spec.maxEdge / bmp.width, spec.maxEdge / bmp.height, 1);
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const blob = await encodeVariant(bmp, w, h, spec.quality);
      if (blob) out[variant] = blob;
    }
    return out;
  } finally {
    bmp.close?.();
  }
}

async function encodeVariant(src: ImageBitmap, w: number, h: number, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(src, 0, 0, w, h);
        return await canvas.convertToBlob({ type: 'image/jpeg', quality });
      }
    } catch {
      /* 环境不支持 OffscreenCanvas 编码时回退 DOM canvas */
    }
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}
