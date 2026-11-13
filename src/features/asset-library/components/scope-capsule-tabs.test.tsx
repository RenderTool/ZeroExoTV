/**
 * ScopeCapsuleTabs 第四段「主体」单元测试（2026-11-05）
 *
 * 断言：
 * 1) showSubject=true → 全局 / 本项目 / 主体 / 开源库 四段（2026-11-06 用户指令：开源库排最后）；
 * 2) 不传 showSubject → 保持原三段（资产库其它调用方零改动）；
 * 3) 点「主体」段回传 'subject'，与抽屉 store 的分段键同形。
 */

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ThemeConfig } from '@zeroexo/shared';
import { ScopeCapsuleTabs } from './scope-capsule-tabs.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, dv?: unknown) => (typeof dv === 'string' ? dv : key) }),
}));

const THEME = {
  mode: 'dark',
  toolbar: { text: '#e5e5e5', textMuted: '#8a8a8a' },
} as unknown as ThemeConfig;

function renderTabs(showSubject: boolean, onChange = vi.fn()) {
  render(
    <ScopeCapsuleTabs
      value="project"
      onChange={onChange}
      libraryCount={2}
      projectCount={3}
      showSubject={showSubject}
      theme={THEME}
    />,
  );
  return onChange;
}

describe('ScopeCapsuleTabs 主体段', () => {
  it('showSubject=true：渲染四段且开源库排最后，主体段可点并回传 subject', () => {
    const onChange = renderTabs(true);
    const tabs = document.querySelectorAll('[data-scope]');
    expect(Array.from(tabs).map((el) => el.getAttribute('data-scope'))).toEqual([
      'library', 'project', 'subject',
    ]);
    const subjectTab = document.querySelector('[data-scope="subject"]') as HTMLElement;
    expect(subjectTab.textContent).toContain('主体');
    fireEvent.click(subjectTab);
    expect(onChange).toHaveBeenCalledWith('subject');
  });

  it('不传 showSubject：保持三段，不出现主体段', () => {
    renderTabs(false);
    const tabs = document.querySelectorAll('[data-scope]');
    expect(Array.from(tabs).map((el) => el.getAttribute('data-scope'))).toEqual([
      'library', 'project',
    ]);
    expect(screen.queryByText('主体')).toBeNull();
  });

  // 2026-11-06 用户反馈：其它三段都有计数，主体段没有 → 补上总数徽标
  it('传 subjectCount：主体段显示总数；不传/未加载则不显示徽标（不假称 0）', () => {
    render(<ScopeCapsuleTabs value="subject" onChange={vi.fn()} libraryCount={5} projectCount={2} showSubject subjectCount={12} theme={THEME} />);
    expect(document.querySelector('[data-scope="subject"]')?.textContent).toContain('12');
    expect(document.querySelector('[data-scope-count="subject"]')).toBeTruthy();

    cleanup();
    render(<ScopeCapsuleTabs value="subject" onChange={vi.fn()} libraryCount={5} projectCount={2} showSubject theme={THEME} />);
    expect(document.querySelector('[data-scope-count="subject"]')).toBeNull();
    expect(document.querySelector('[data-scope="subject"]')?.textContent).toBe('主体');
  });
});
