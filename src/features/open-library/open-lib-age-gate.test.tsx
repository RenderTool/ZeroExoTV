/**
 * 开源库 18+ 确认模态验收（2026-11-05）：
 * ① 模态 portal 到 document.body，position:fixed + flex 居中，宽度 min(440px, 92vw)；
 * ② 点遮罩取消（按下+抬起同目标、位移 <6px）；点卡片本体不取消；Esc 取消；
 * ③ 打开时焦点在主按钮，关闭后焦点回触发的 chip。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { App } from 'antd';

const { mediaUrlMock, authUrlMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  // 第二参可能是插值对象（如 {count}），只有字符串 defaultValue 才回退，否则回 key
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

const GALLERY = {
  id: 'g1', title: '图库 G', entryCount: 0, indexed: true, sourceUrl: 'https://src.example',
  license: { commercialUse: true, redistribution: true, type: 'cc0' }, categories: [],
};

vi.mock('./open-library-ui.js', () => ({
  OPEN_LIB_PAGE_SIZE: 60,
  OpenLibThumb: ({ entry }: any) => <div data-thumb>{entry.title}</div>,
  useOpenLibMeta: () => ({ meta: { galleries: { g1: GALLERY } }, loading: false }),
  useOpenLibGallery: () => ({
    // adultHidden > 0 才会展示 18+ 门控条 / 确认按钮
    result: { items: [], total: 0, adultHidden: 1 },
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

function renderBrowser() {
  return render(
    <App>
      <OpenLibBrowser theme={THEME} />
    </App>,
  );
}

describe('开源库 18+ 确认：屏幕居中模态', () => {
  beforeEach(() => {
    mediaUrlMock.mockReset();
    mediaUrlMock.mockReturnValue({ url: undefined, failed: false, reason: undefined, markError: vi.fn(), origin: 'none' });
    authUrlMock.mockReset();
    authUrlMock.mockReturnValue(undefined);
  });

  it('模态 portal 到 body、fixed 居中、宽度 min(440px, 92vw)、焦点在主按钮', async () => {
    renderBrowser();
    const chip = await screen.findByTestId('openlib-age-gate-button');
    chip.focus();
    fireEvent.click(chip);

    const backdrop = document.querySelector('[data-openlib-age-backdrop]') as HTMLElement;
    const modal = document.querySelector('[data-openlib-age-modal]') as HTMLElement;
    expect(backdrop).toBeTruthy();
    expect(modal).toBeTruthy();
    expect(backdrop.parentElement).toBe(document.body);
    expect(getComputedStyle(backdrop).position).toBe('fixed');
    expect(backdrop.style.display).toBe('flex');
    expect(backdrop.style.alignItems).toBe('center');
    expect(backdrop.style.justifyContent).toBe('center');
    expect(backdrop.style.background).toBe('rgba(0, 0, 0, 0.45)');
    expect(modal.style.width).toBe('min(440px, 92vw)');
    expect(document.activeElement).toBe(document.querySelector('[data-openlib-age-confirm]'));
  });

  it('点遮罩关闭，焦点回到触发的 chip', async () => {
    renderBrowser();
    const chip = await screen.findByTestId('openlib-age-gate-button');
    chip.focus();
    fireEvent.click(chip);
    const backdrop = document.querySelector('[data-openlib-age-backdrop]') as HTMLElement;
    fireEvent.pointerDown(backdrop, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(backdrop, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(document.querySelector('[data-openlib-age-modal]')).toBeNull());
    expect(document.activeElement).toBe(chip);
  });

  it('点卡片本体不关闭；拖拽位移 >6px 不关闭', async () => {
    renderBrowser();
    const chip = await screen.findByTestId('openlib-age-gate-button');
    fireEvent.click(chip);
    const modal = document.querySelector('[data-openlib-age-modal]') as HTMLElement;
    fireEvent.pointerDown(modal, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(modal, { clientX: 40, clientY: 40 });
    expect(document.querySelector('[data-openlib-age-modal]')).toBeTruthy();
    const backdrop = document.querySelector('[data-openlib-age-backdrop]') as HTMLElement;
    // jsdom 无 PointerEvent 构造器：用 MouseEvent + pointer* 类型，clientX/Y 才真实生效
    fireEvent(backdrop, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent(backdrop, new MouseEvent('pointerup', { bubbles: true, clientX: 26, clientY: 24 }));
    expect(document.querySelector('[data-openlib-age-modal]')).toBeTruthy();
  });

  it('Esc 取消，焦点回到触发的 chip', async () => {
    renderBrowser();
    const chip = await screen.findByTestId('openlib-age-gate-button');
    chip.focus();
    fireEvent.click(chip);
    expect(document.querySelector('[data-openlib-age-modal]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-openlib-age-modal]')).toBeNull());
    expect(document.activeElement).toBe(chip);
  });
});
