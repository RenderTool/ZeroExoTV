/**
 * 画布抽屉开源卡片动作验收（2026-11-05）：
 * ① 抽屉宿主（注入 sendToCanvas）内，开源卡片渲染「发送到画布 / 发送到导演台」两枚动作；
 * ② 点动作不打开大图查看器（stopPropagation，与资产卡同行为）；
 * ③ 两条发送路径：画布 → sendToCanvas 回调；导演台 → sendAssetToWorkbench（均为 importOpenLibEntry 按需落 CAS 后发送）；
 * ④ 无画布宿主（独立 #/openlib 页）不渲染发送动作，维持既有取舍。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';

const { mediaUrlMock, authUrlMock, importMock, sendMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
  importMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (k: string, d?: string | Record<string, unknown>) => (typeof d === 'string' ? d : k) }),
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
// 动作执行器：不入库、按需落 CAS 的引用对象（稳定 id = openlib:<entryId>）
vi.mock('./import-open-lib-entry.js', () => ({ importOpenLibEntry: importMock }));
vi.mock('@/features/canvas-assets/send-to-workbench.js', () => ({ sendAssetToWorkbench: sendMock }));

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

/** 首个条目的卡片（等 meta/query 异步落定后才存在） */
async function waitForFirstCard(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector('[data-openlib-entry="openlib:g1:e1"]') as HTMLElement | null;
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
}

beforeEach(() => {
  mediaUrlMock.mockReset();
  mediaUrlMock.mockReturnValue({ url: undefined, failed: false, reason: undefined, markError: vi.fn(), origin: 'none' });
  authUrlMock.mockReset();
  authUrlMock.mockReturnValue(undefined);
  importMock.mockReset();
  importMock.mockImplementation(async (entry: { id: string; title: string }) => ({
    id: entry.id,
    title: entry.title,
    kind: 'image',
    scope: 'library',
    createdAt: '2026-11-05T00:00:00.000Z',
    data: { kind: 'image', dataUrl: '', storageKey: 'cas:abc.png', quality: 'origin' },
  }));
  sendMock.mockReset();
});

describe('画布抽屉开源卡片：动作与资产卡一致', () => {
  it('有画布/导演台两枚动作；点击不打开大图；两条发送路径均被调用；已落盘后动作仍可用', async () => {
    const sendToCanvas = vi.fn();
    render(
      <App>
        <OpenLibBrowser theme={THEME} sendToCanvas={sendToCanvas} />
      </App>,
    );

    const card = await waitForFirstCard();
    expect(document.querySelector('[data-lightbox]')).toBeNull();

    const sendBtn = card.querySelector('[data-card-action="send"]') as HTMLButtonElement;
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.disabled).toBe(false);

    // ① 发送到画布：按需导入 → sendToCanvas；不打开大图、不误发导演台
    fireEvent.click(sendBtn);
    const canvasItem = await waitFor(() => {
      const el = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find((n) => n.textContent?.includes('assetLibrary.sendToCanvas'));
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.click(canvasItem);
    await waitFor(() => expect(sendToCanvas).toHaveBeenCalledTimes(1));
    expect(importMock).toHaveBeenCalledTimes(1);
    expect(importMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ id: 'openlib:g1:e1' }));
    expect(sendToCanvas).toHaveBeenCalledWith(expect.objectContaining({ id: 'openlib:g1:e1' }));
    expect(sendMock).not.toHaveBeenCalled();
    expect(document.querySelector('[data-lightbox]')).toBeNull();

    // ② 发送到导演台：同一导入执行器 → sendAssetToWorkbench；动作仍存在（已导入状态不消失）
    const sendBtnAfter = (await waitForFirstCard()).querySelector('[data-card-action="send"]') as HTMLButtonElement;
    expect(sendBtnAfter).toBeTruthy();
    fireEvent.click(sendBtnAfter);
    const directorItem = await waitFor(() => {
      const el = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find((n) => n.textContent?.includes('assetLibrary.sendToDirector'));
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    fireEvent.click(directorItem);
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(importMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openlib:g1:e1' }),
      expect.anything(),
      expect.anything(),
    );
    expect(document.querySelector('[data-lightbox]')).toBeNull();
  });

  it('独立页（无画布宿主）：开源卡片不渲染发送动作，点击仍是浏览', async () => {
    render(
      <App>
        <OpenLibBrowser theme={THEME} />
      </App>,
    );

    const card = await waitForFirstCard();
    expect(card.querySelector('[data-card-action="send"]')).toBeNull();

    // 卡片本体点击仍打开大图（浏览路径不变）
    fireEvent.click(card);
    const overlay = document.querySelector('[data-lightbox]');
    expect(overlay).toBeTruthy();
    expect(importMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-lightbox]')).toBeNull());
  });
});
