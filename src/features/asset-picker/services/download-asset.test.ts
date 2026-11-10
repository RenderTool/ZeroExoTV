/**
 * downloadAsset 单测（2026-11-07 修复「点击下载视频没有任何反应」）
 *
 * 锁定：生成产物的 data.url/dataUrl 为空、只有 storageKey 时，必须按 storageKey 读盘
 * 并触发下载；读不到文件必须返回 false（调用方提示），绝不静默。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaMock = vi.hoisted(() => ({ getMediaBlob: vi.fn() }));
const guideMock = vi.hoisted(() => ({ fetchGuideBlob: vi.fn() }));
vi.mock('@/platform/media.js', () => ({ getMediaBlob: mediaMock.getMediaBlob }));
vi.mock('@zeroexo/plugin-nodes', () => ({ resolveContentUrl: vi.fn(async () => '') }));
vi.mock('@/shared/utils/guide-file.js', () => ({ fetchGuideBlob: guideMock.fetchGuideBlob }));

import { downloadAsset, downloadAssetWithGuide, downloadFilesAsZip } from './download-asset.js';
import type { Asset } from '../index.js';

function videoAsset(overrides: Partial<Asset> = {}, data: Record<string, unknown> = {}): Asset {
  return {
    id: 'a1',
    title: '片段 1',
    kind: 'video',
    createdAt: '2026-11-07T00:00:00.000Z',
    bytes: 10,
    mimeType: 'video/mp4',
    data: { kind: 'video', url: '', storageKey: 'video:assets/p/videos/x.mp4', ...data } as Asset['data'],
    ...overrides,
  };
}

let clicked: Array<{ href: string; download: string }> = [];

beforeEach(() => {
  clicked = [];
  mediaMock.getMediaBlob.mockReset();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:download-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('downloadAsset', () => {
  it('视频只有 storageKey 时按 key 读盘并触发下载（不再静默无反应）', async () => {
    mediaMock.getMediaBlob.mockResolvedValue(new Blob(['video-bytes'], { type: 'video/mp4' }));
    const ok = await downloadAsset(videoAsset());
    expect(ok).toBe(true);
    expect(mediaMock.getMediaBlob).toHaveBeenCalledWith('video:assets/p/videos/x.mp4');
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('片段 1.mp4');
  });

  it('同一标题已带扩展名时不重复追加', async () => {
    mediaMock.getMediaBlob.mockResolvedValue(new Blob(['x'], { type: 'video/mp4' }));
    const ok = await downloadAsset(videoAsset({ title: '成片.mp4' }));
    expect(ok).toBe(true);
    expect(clicked[0]?.download).toBe('成片.mp4');
  });

  it('storageKey 读不到且无可用 url → false（调用方必须提示）', async () => {
    mediaMock.getMediaBlob.mockResolvedValue(null);
    const ok = await downloadAsset(videoAsset({}, { storageKey: 'video:missing.mp4', url: 'blob:http://x/dead' }));
    expect(ok).toBe(false);
    expect(clicked).toHaveLength(0);
  });

  it('文本资产直接导出 .txt', async () => {
    const asset: Asset = {
      id: 't1',
      title: '提示词',
      kind: 'text',
      createdAt: '2026-11-07T00:00:00.000Z',
      bytes: 0,
      data: { kind: 'text', content: 'hello' },
    };
    const ok = await downloadAsset(asset);
    expect(ok).toBe(true);
    expect(clicked[0]?.download).toBe('提示词.txt');
  });
});

describe('打包下载（视频 + 引导只触发一次浏览器下载）', () => {
  beforeEach(() => guideMock.fetchGuideBlob.mockReset());

  it('引导可取回 → 打成 zip，返回 ok + guideOk', async () => {
    mediaMock.getMediaBlob.mockResolvedValue(new Blob(['video-bytes'], { type: 'video/mp4' }));
    guideMock.fetchGuideBlob.mockResolvedValue(new Blob(['guide-bytes']));
    const res = await downloadAssetWithGuide(videoAsset(), { id: 'gd_abc123' });
    expect(res).toEqual({ ok: true, guideOk: true });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('片段 1.zip');
  });

  it('引导取不到 → 仍下载视频单文件，不让视频丢失', async () => {
    mediaMock.getMediaBlob.mockResolvedValue(new Blob(['video-bytes'], { type: 'video/mp4' }));
    guideMock.fetchGuideBlob.mockResolvedValue(null);
    const res = await downloadAssetWithGuide(videoAsset(), { id: 'gd_abc123' });
    expect(res).toEqual({ ok: true, guideOk: false });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('片段 1.mp4');
  });

  it('downloadFilesAsZip 同名文件自动加序号，不互相覆盖', async () => {
    const n = await downloadFilesAsZip([
      { blob: new Blob(['a']), filename: 'a.mp4' },
      { blob: new Blob(['b']), filename: 'a.mp4' },
    ], 'bundle');
    expect(n).toBe(2);
    expect(clicked[0]?.download).toBe('bundle.zip');
  });
});
