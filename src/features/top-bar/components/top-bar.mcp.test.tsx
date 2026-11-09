/**
 * 画布顶栏「服务」唯一入口（ComfyUI / MCP / 数据目录 / 插件统一进服务中心）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { mode: 'light', toolbar: { text: '#111', textMuted: '#999' } } }),
}));
vi.mock('@/shared/components/index.js', () => ({
  AppearanceDialog: () => null,
  ShortcutsDialog: () => null,
  LanguageSwitcher: () => null,
}));
vi.mock('@/shared/hooks/use-media-query.js', () => ({ useIsMobile: () => false }));
vi.mock('@/features/canvas-tabs/canvas-tab-bar.js', () => ({ CanvasTabBar: () => null }));

import { TopBar } from './top-bar.js';
import { OPEN_SERVICE_CENTER_EVENT } from '@/features/service-center/service-center-events.js';

function renderTopBar() {
  return render(
    createElement(TopBar, {
      title: '测试画布',
      titleDraft: '测试画布',
      isTitleEditing: false,
      onTitleDraftChange: () => {},
      onStartTitleEditing: () => {},
      onFinishTitleEditing: () => {},
      onCancelTitleEditing: () => {},
      gridStyle: 'grid' as never,
      onGridStyleChange: () => {},
      onOpenSettings: () => {},
    }),
  );
}

describe('画布顶栏服务入口', () => {
  it('只保留一个服务按钮', () => {
    renderTopBar();
    expect(screen.getByTestId('topbar-services-btn')).toBeTruthy();
    expect(screen.queryByTestId('topbar-data-root-btn')).toBeNull();
    expect(screen.queryByTestId('topbar-mcp-btn')).toBeNull();
  });

  it('点击广播服务中心打开事件', () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_SERVICE_CENTER_EVENT, handler);
    try {
      renderTopBar();
      fireEvent.click(screen.getByTestId('topbar-services-btn'));
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_SERVICE_CENTER_EVENT, handler);
    }
  });

  it('图标仍为 16×16 / 描边 1.7', () => {
    renderTopBar();
    const frame = screen.getByTestId('topbar-services-btn').querySelector('[data-icon-frame]') as HTMLElement;
    expect(frame.style.width).toBe('16px');
    expect(frame.style.height).toBe('16px');
    const svg = frame.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('1.7');
  });
});
