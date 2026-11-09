/** AppTopBar 服务入口：ComfyUI / MCP / 数据目录 / 插件统一进服务中心。 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { App as AntdApp } from 'antd';

vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { mode: 'light', toolbar: { text: '#111', textMuted: '#999' } } }),
}));
vi.mock('@/shared/components/language-switcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('@/shared/hooks/use-media-query.js', () => ({ useIsMobile: () => false }));

import { AppTopBar } from './app-top-bar.js';
import { OPEN_SERVICE_CENTER_EVENT } from '@/features/service-center/service-center-events.js';

describe('顶部导航服务入口', () => {
  it('只有一个服务按钮，点击广播打开事件', () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_SERVICE_CENTER_EVENT, handler);
    try {
      render(createElement(AntdApp, null, createElement(AppTopBar, { onNavigate: () => {} })));
      expect(screen.queryByTestId('mcp-entry')).toBeNull();
      const entry = screen.getByTestId('services-entry');
      fireEvent.click(entry);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_SERVICE_CENTER_EVENT, handler);
    }
  });
});
