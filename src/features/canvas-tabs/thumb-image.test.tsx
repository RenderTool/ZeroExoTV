/**
 * ThumbImage 分派回归（2026-11-05 媒体 URL 层重做后更新）：
 * - 云端键仍走认证链（isBackendKey + useAuthResourceUrl）；
 * - 本地键改经 useMediaObjectUrl → media-url-provider（单一所有权 + 自愈），
 *   数据源为 image_files 桶派生档（getImageVariantBlob），不再消费字符串 URL 缓存。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const { backendUrlMock } = vi.hoisted(() => ({ backendUrlMock: vi.fn() }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: backendUrlMock, uploadToBackend: vi.fn() }));

const { resourceUrlMock } = vi.hoisted(() => ({ resourceUrlMock: vi.fn((): string | undefined => undefined) }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: resourceUrlMock }));

// provider 用真实实现；桩掉本地派生档读取（本地链数据源）
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zeroexo/plugin-persistence')>();
  return {
    ...actual,
    IMAGE_CONTENT_UPDATED_EVENT: 'zeroexo:image-content-updated',
    resolveThumbnailUrl: vi.fn(async () => ''),
    resolvePreviewUrl: vi.fn(async () => ''),
    resolveImageUrl: vi.fn(async () => ''),
    getImageVariantBlob: vi.fn(async (_k: string, variant: 'thumb' | 'preview' | 'orig') =>
      variant === 'thumb' ? new Blob(['thumb-bytes']) : null),
    getVideoThumbBlob: vi.fn(async () => null),
    getMediaBlob: vi.fn(async () => new Blob(['video-bytes'], { type: 'video/mp4' })),
  };
});

import { __configureMediaUrlProviderForTests } from '@zeroexo/plugin-persistence';
import { ThumbImage } from './thumb-image.js';

const ICON = createElement('span');
const BASE = { prefer: 'thumb', width: 48, height: 48, radius: 6, icon: ICON } as const;

beforeEach(() => {
  backendUrlMock.mockReset();
  backendUrlMock.mockReturnValue(false);
  resourceUrlMock.mockReset();
  resourceUrlMock.mockImplementation(() => undefined);
  URL.createObjectURL = vi.fn((): string => 'blob:provider-thumb') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  __configureMediaUrlProviderForTests({ idleRevokeMs: 0 });
});

describe('ThumbImage 分派', () => {
  it('本地键：经媒体 URL 提供者解析派生 thumb 档（不再消费字符串 URL 缓存）', async () => {
    const { container } = render(createElement(ThumbImage, { storageKey: 'image:local/x.png', ...BASE }));
    await waitFor(() => { expect(container.querySelector('img')).toBeTruthy(); });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:provider-thumb');
  });

  it('云端键走认证链(isBackendKey + useAuthResourceUrl)', () => {
    backendUrlMock.mockReturnValue(true);
    resourceUrlMock.mockReturnValue('blob:cloud-thumb');
    const { container } = render(createElement(ThumbImage, { storageKey: 'resources/cloud.png', ...BASE }));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:cloud-thumb');
  });
});
