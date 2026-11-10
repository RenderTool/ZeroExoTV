/**
 * 上传格式（2026-11-10 用户反馈「本项目里上传图片也报格式不支持」）：
 * avif / heic / heif / tiff / jfif 这些常见图片格式必须能过格式校验，
 * 只有真正的未知扩展名才拒绝。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./cas-upload.js', () => ({
  stageCasUpload: async (_file: Blob, kind: string) => ({
    id: 'asset-1',
    cas: { hash: 'a'.repeat(64), ext: 'avif' },
    storageKey: `cas:${'a'.repeat(64)}.avif`,
    bytes: 8,
    mimeType: kind === 'image' ? 'image/avif' : 'application/octet-stream',
    dedupedExistingAsset: false,
  }),
  readImageDims: async () => ({ width: 800, height: 600 }),
  readMediaMeta: async () => ({ width: 1280, height: 720, durationMs: 1000 }),
}));

import { UnsupportedFileTypeError, getSupportedFileTypes, uploadAsset } from './upload-asset.js';

const fileOf = (name: string, type: string): File => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('uploadAsset 图片格式', () => {
  it('常见图片 MIME 都在支持清单里', () => {
    const list = getSupportedFileTypes();
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/tiff']) {
      expect(list).toContain(mime);
    }
  });

  it.each([
    ['photo.avif', 'image/avif'],
    ['photo.heic', 'image/heic'],
    ['photo.heif', 'image/heif'],
    ['photo.tiff', 'image/tiff'],
    ['photo.jfif', 'image/jpeg'],
    ['photo.JPG', 'image/jpeg'],
  ])('%s 能识别为图片并入库', async (name, type) => {
    const input = await uploadAsset(fileOf(name, type));
    expect(input.kind).toBe('image');
    expect(input.data).toMatchObject({ kind: 'image' });
  });

  it('未知扩展名仍然拒绝（不静默吞文件）', async () => {
    await expect(uploadAsset(fileOf('evil.exe', 'application/x-msdownload'))).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  it('浏览器没给 MIME 时按扩展名兜底识别', async () => {
    const input = await uploadAsset(fileOf('screenshot.png', ''));
    expect(input.kind).toBe('image');
  });
});
