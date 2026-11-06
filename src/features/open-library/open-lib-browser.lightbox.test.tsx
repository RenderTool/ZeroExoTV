/**
 * 开源资产库卡片验收（2026-11-05）：
 * ① 点卡片任意位置 → 大图查看器可见，img src = 源站高清原图；
 * ② 高清原图失败 → 回落站点同源打包缩略图并标注；
 * ③ ESC 关闭、方向键切换同列表前后条目。
 *
 * 用真实 OpenLibBrowser + 真实 MediaLightbox；仅 mock 数据查询 hooks（不打网络）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';

const { mediaUrlMock, authUrlMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  /** i18n/config.ts 初始化需要；测试不真正初始化 i18n */
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));
vi.mock('./open-library.js', () => ({
  confirmAge: vi.fn(),
  revokeAgeConfirmation: vi.fn(),
  isAgeConfirmed: () => false,
  openLibSiteUrl: (rel: string) => (rel.startsWith('/') ? rel : `/${rel}`),
}));
vi.mock('./cleanup-open-lib-spill.js', () => ({
  runOpenLibSpillCleanupOnce: vi.fn(async () => undefined),
}));

const ENTRIES = [
  { id: 'openlib:g1:e1', title: '开源图 1', cdnUrl: 'https://cdn.example/1.jpg', imageUrl: '/openlib/thumbs/g1/1.jpg', storage: 'bundled', gallery: 'g1' },
  { id: 'openlib:g1:e2', title: '开源图 2', cdnUrl: 'https://cdn.example/2.jpg', imageUrl: '/openlib/thumbs/g1/2.jpg', storage: 'bundled', gallery: 'g1' },
];
const GALLERY = {
  id: 'g1', title: '图库 G', entryCount: 2, indexed: true, sourceUrl: 'https://src.example',
  license: { commercialUse: true, redistribution: true, type: 'cc0' }, categories: [],
};

vi.mock('./open-library-ui.js', () => ({
  OPEN_LIB_PAGE_SIZE: 60,
  OpenLibThumb: ({ entry }: any) => <div data-thumb>{entry.title}</div>,
  useOpenLibMeta: () => ({ meta: { galleries: { g1: GALLERY } }, loading: false }),
  useOpenLibGallery: () => ({
    result: { items: ENTRIES, total: 2, adultHidden: 0 },
    loading: false,
    category: null,
    keyword: '',
    page: 1,
    setCategory: vi.fn(),
    setKeyword: vi.fn(),
    setPage: vi.fn(),
  }),
}));

import { OpenLibBrowser } from './open-lib-browser.js';

const THEME = {
  mode: 'light',
  toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff' },
  node: { fill: '#fff' },
} as any;

describe('开源库卡片：点击打开大图查看器（只读浏览，无悬浮按钮）', () => {
  beforeEach(() => {
    mediaUrlMock.mockReset();
    mediaUrlMock.mockReturnValue({ url: undefined, failed: false, reason: undefined, markError: vi.fn(), origin: 'none' });
    authUrlMock.mockReset();
    authUrlMock.mockReturnValue(undefined);
  });

  it('点卡片 → viewer 可见且 img src = 源站高清原图；ESC 关闭；方向键切换', async () => {
    const { container } = render(
      <App>
        <OpenLibBrowser theme={THEME} />
      </App>,
    );

    await waitFor(() => expect(container.textContent).toContain('开源图 1'));

    // 真实 DOM 手势序列：卡片根元素 pointerdown → pointerup → click（拖拽阈值内视为点击）
    const card = document.querySelector('[data-openlib-entry="openlib:g1:e1"]') as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(card);

    const overlay = document.querySelector('[data-lightbox]');
    expect(overlay).toBeTruthy();
    // portal 到 body：不受抽屉/面板祖先 transform、overflow 裁剪（否则「点了没反应」）
    expect(overlay?.parentElement).toBe(document.body);
    expect(getComputedStyle(overlay as HTMLElement).position).toBe('fixed');
    const img = document.querySelector('[data-lightbox] img') as HTMLImageElement | null;
    expect(img?.getAttribute('src')).toBe('https://cdn.example/1.jpg');
    expect(document.querySelector('[data-lightbox-counter]')?.textContent?.replace(/\s/g, '')).toBe('1/2');

    // 高清原图加载失败 → 站点同源缩略图
    fireEvent.error(img as HTMLImageElement);
    await waitFor(() => {
      const fallback = document.querySelector('[data-lightbox] img') as HTMLImageElement | null;
      expect(fallback?.getAttribute('src')).toBe('/openlib/thumbs/g1/1.jpg');
    });
    expect(document.querySelector('[data-lightbox-fallback]')).toBeTruthy();

    // 方向键切到下一条
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('[data-lightbox-title]')?.textContent).toContain('开源图 2');

    // ESC 关闭
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-lightbox]')).toBeNull());
  });
});
