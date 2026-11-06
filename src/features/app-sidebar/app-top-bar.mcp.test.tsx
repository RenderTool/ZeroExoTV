/**
 * AppTopBar MCP 入口单测（2026-11-04，验收①前半：设置入口存在且可点击打开）
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { App as AntdApp } from 'antd';

vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { mode: 'light', toolbar: { text: '#111', textMuted: '#999' } } }),
}));
vi.mock('@/shared/components/language-switcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('@/shared/hooks/use-media-query.js', () => ({ useIsMobile: () => false }));
vi.mock('@/platform/fs.js', () => ({
  restoreRoot: vi.fn(async () => 'Test'),
  rootName: () => 'Test',
}));
vi.mock('@/platform/root-flow.js', () => ({ activateRoot: vi.fn() }));

import { AppTopBar } from './app-top-bar.js';

describe('顶部导航 MCP 入口（验收①）', () => {
  it('存在 MCP 入口按钮，点击触发 onRequestMcp', () => {
    const onRequestMcp = vi.fn();
    render(
      createElement(AntdApp, null, createElement(AppTopBar, { onNavigate: () => {}, onRequestMcp })),
    );
    const entry = screen.getByTestId('mcp-entry');
    fireEvent.click(entry);
    expect(onRequestMcp).toHaveBeenCalledTimes(1);
  });
});
