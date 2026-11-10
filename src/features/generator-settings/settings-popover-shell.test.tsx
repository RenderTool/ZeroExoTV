/**
 * 参数浮层内嵌 antd 下拉回归：
 * antd 全局把下拉挂到 document.body，自建浮层的 window 捕获 pointerdown 会误判「点在外部」
 * 而先卸载面板，导致选项点不中。嵌套浮层必须视为内部。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SettingsPopoverShell } from './settings-popover-shell.js';

afterEach(cleanup);

const theme = {
  mode: 'dark',
  toolbar: { text: '#fff', textMuted: '#aaa', border: '#333', accent: '#00c758', background: '#111' },
} as any;

describe('SettingsPopoverShell 嵌套浮层豁免', () => {
  it('点击 antd 下拉浮层不收起参数面板；点击真正外部才收起', () => {
    render(
      <SettingsPopoverShell summary="参数" theme={theme}>
        <div data-panel-child>参考图尺寸</div>
      </SettingsPopoverShell>,
    );
    fireEvent.click(document.querySelector('button') as HTMLButtonElement);
    expect(document.querySelector('[data-panel-child]')).toBeTruthy();

    const dropdown = document.createElement('div');
    dropdown.className = 'ant-select-dropdown';
    document.body.appendChild(dropdown);
    fireEvent.pointerDown(dropdown);
    expect(document.querySelector('[data-panel-child]')).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(document.querySelector('[data-panel-child]')).toBeNull();
    dropdown.remove();
  });
});
