/**
 * 图片档位单一事实源单测（2026-11-06 征集 #186）
 * 覆盖：2x DPR 选档边界、解析链顺序、物理 key 映射、无解码环境的安全回退。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_VARIANT_SPECS,
  DEFAULT_DPR,
  CAS_KEY_PATTERN,
  pickImageVariant,
  imageVariantChain,
  variantStorageKey,
  casVariantPath,
  generateImageVariantBlobs,
} from './image-variants.js';

describe('IMAGE_VARIANT_SPECS（档位表）', () => {
  it('thumb 96 / preview 1024 / orig 无穷，且质量递减', () => {
    expect(IMAGE_VARIANT_SPECS.thumb.maxEdge).toBe(96);
    expect(IMAGE_VARIANT_SPECS.preview.maxEdge).toBe(1024);
    expect(IMAGE_VARIANT_SPECS.orig.maxEdge).toBe(Number.POSITIVE_INFINITY);
    expect(IMAGE_VARIANT_SPECS.thumb.quality).toBeLessThan(IMAGE_VARIANT_SPECS.preview.quality);
    expect(DEFAULT_DPR).toBe(2);
  });
});

describe('pickImageVariant（设计尺寸 × DPR 协商）', () => {
  it('小槽位取 thumb：36px(2x=72)、48px(2x=96)', () => {
    expect(pickImageVariant(36)).toBe('thumb');
    expect(pickImageVariant(48)).toBe('thumb');
  });

  it('用户点名的 60px 设计尺寸(2x=120 > 96)必须取 preview，不能落到更小的档', () => {
    expect(pickImageVariant(60)).toBe('preview');
    expect(pickImageVariant(52)).toBe('preview'); // 生成器节点 52px(2x=104)
    expect(pickImageVariant(220)).toBe('preview'); // 瀑布流卡片
  });

  it('视口级 / 1x 大尺寸取 orig', () => {
    expect(pickImageVariant(1200)).toBe('orig');
    expect(pickImageVariant(600, 1)).toBe('preview');
    expect(pickImageVariant(1200, 1)).toBe('orig');
  });

  it('非法/缺省尺寸不崩，且 DPR 越大越倾向清晰档', () => {
    expect(pickImageVariant(0)).toBe('thumb');
    expect(pickImageVariant(-10)).toBe('thumb');
    expect(pickImageVariant(50, 1)).toBe('thumb');
    expect(pickImageVariant(50, 2)).toBe('preview');
  });
});

describe('imageVariantChain（低档缺失不向下取更糊的档）', () => {
  it('thumb 首选：thumb → preview → orig', () => {
    expect(imageVariantChain(36)).toEqual(['thumb', 'preview', 'orig']);
  });

  it('preview 首选：preview → orig → thumb（绝不 preview 缺失就回退 thumb）', () => {
    expect(imageVariantChain(60)).toEqual(['preview', 'orig', 'thumb']);
  });

  it('orig 首选：orig → preview → thumb，且链恒含 orig（存量零迁移兜底）', () => {
    expect(imageVariantChain(1200)).toEqual(['orig', 'preview', 'thumb']);
    for (const css of [16, 36, 60, 220, 1200]) {
      expect(imageVariantChain(css)).toContain('orig');
    }
  });
});

describe('物理 key 映射', () => {
  it('旧 image: 键派生 :thumb / :preview，orig 保持本体', () => {
    expect(variantStorageKey('image:abc', 'thumb')).toBe('image:abc:thumb');
    expect(variantStorageKey('image:abc', 'preview')).toBe('image:abc:preview');
    expect(variantStorageKey('image:abc', 'orig')).toBe('image:abc');
  });

  it('CAS 键格式与派生档路径', () => {
    const hash = 'a'.repeat(64);
    const key = `cas:${hash}.png`;
    expect(CAS_KEY_PATTERN.test(key)).toBe(true);
    expect(CAS_KEY_PATTERN.exec(key)?.[1]).toBe(hash);
    expect(CAS_KEY_PATTERN.test('image:abc')).toBe(false);
    expect(casVariantPath(hash, 'thumb')).toBe(`media/cas/${hash}.thumb.jpg`);
    expect(casVariantPath(hash, 'preview')).toBe(`media/cas/${hash}.preview.jpg`);
  });
});

describe('generateImageVariantBlobs（性能与安全回退）', () => {
  it('jsdom 无 createImageBitmap → 两档皆 null，调用方按派生档缺失回退原图', async () => {
    if (typeof createImageBitmap === 'function') return; // 环境具备解码能力则跳过该分支断言
    const out = await generateImageVariantBlobs(new Blob(['x'], { type: 'image/png' }));
    expect(out).toEqual({ thumb: null, preview: null });
  });

  it('一次解码产出两档（禁止每档各解码一次），并释放 ImageBitmap', async () => {
    const bitmap = { width: 2000, height: 1000, close: vi.fn() };
    const decodeSpy = vi.fn(async () => bitmap);
    const drawSpy = vi.fn();
    const originalDecode = globalThis.createImageBitmap;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = decodeSpy;
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage: drawSpy })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = ((cb: BlobCallback) => cb(new Blob(['enc'], { type: 'image/jpeg' }))) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
    try {
      const out = await generateImageVariantBlobs(new Blob(['src'], { type: 'image/png' }));
      expect(decodeSpy).toHaveBeenCalledTimes(1);
      expect(drawSpy).toHaveBeenCalledTimes(2);
      expect(bitmap.close).toHaveBeenCalledTimes(1);
      expect(out.thumb).toBeTruthy();
      expect(out.preview).toBeTruthy();
    } finally {
      (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = originalDecode;
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
    }
  });

  it('小图不放大：两档皆不生成', async () => {
    const bitmap = { width: 48, height: 48, close: vi.fn() };
    const originalDecode = globalThis.createImageBitmap;
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn(async () => bitmap);
    try {
      const out = await generateImageVariantBlobs(new Blob(['src'], { type: 'image/png' }));
      expect(out).toEqual({ thumb: null, preview: null });
    } finally {
      (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = originalDecode;
    }
  });
});
