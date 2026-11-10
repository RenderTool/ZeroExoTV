/**
 * script-fullscreen-editor 剧本页滚动条贴边断言（2026-11-04 布局修正）
 *
 * 结构契约（剧本页签编辑/阅读区域）：
 * 1. 唯一纵向滚动容器 = ScriptStructuredEditor 的 [data-script-scroll]（overflow-y:auto），
 *    其右缘 = 纸张右缘 = editorArea 右缘 → 滚动条轨道紧贴容器右边缘，右侧无留白；
 * 2. 右侧空隙不来自任何外层容器：从滚动容器到 body 的全部 DIV 祖先右向
 *    padding/margin 内联值均为空或 0px（此前为 editorArea 16px + 纸张 24px = 40px 内缩）；
 * 3. 文字呼吸间距来自滚动容器内层 paddingRight(24px)（内层 padding），而非外层空隙；
 * 4. 不出横向滚动条（scroll 容器 overflow-x:hidden）、不出双滚动条（纸张根 overflow:hidden）。
 *
 * 与 layout 测试不同：ScriptStructuredEditor 保持真实渲染（被断言的滚动链路主体），
 * 仅 mock 其重量级依赖（SimpleSelect / i18next / plugin-theme / plugin-nodes）。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const theme = {
  mode: 'dark',
  toolbar: {
    text: '#e5e5e5',
    textMuted: '#888888',
    accent: '#e94560',
    border: '#333',
    editorSurface: '#1b1b1b',
    editorPaper: '#141414',
  },
} as any;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: unknown) => (typeof opts === 'string' ? opts : key) }),
}));
vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key } }));
vi.mock('i18next', () => ({
  default: {
    t: (key: string) => key,
    use: () => ({ init: () => Promise.resolve() }),
  },
  createInstance: () => ({ use: () => ({ init: () => Promise.resolve() }) }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
// 包级 index 链到 @zeroexo/plugin-render-react 等（jsdom 解析重），与既有测试同法 mock 掉
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { on: () => () => {}, off: () => () => {}, emit: () => {} },
}));
vi.mock('@/shared/components/index.js', () => ({
  SimpleSelect: (): React.ReactElement => <div data-mock="simple-select" />,
}));

import { App } from 'antd';
import { ScriptFullscreenEditor } from './script-fullscreen-editor';
import type { Episode } from './script-types';

const episodes: Episode[] = [
  { id: 'ep-1', number: 1, title: '第1集', content: '' },
  { id: 'ep-2', number: 2, title: '第2集', content: '' },
] as Episode[];

function renderEditor() {
  return render(
    <App>
      <ScriptFullscreenEditor
        open
        embedded
        onClose={() => {}}
        title="测试剧本"
        episodes={episodes}
        activeEpisodeId="ep-1"
        onEpisodesChange={() => {}}
        onActiveEpisodeChange={() => {}}
        onEpisodesAndActiveChange={() => {}}
        onAddEpisode={() => {}}
      />
    </App>,
  );
}

/** 内联右向留白：''（未设置）与 '0px' 都视为零内缩 */
function expectZeroRightInset(el: HTMLElement): void {
  expect(['', '0px']).toContain(el.style.paddingRight);
  expect(['', '0px']).toContain(el.style.marginRight);
}

describe('剧本页滚动条贴边', () => {
  it('滚动容器为唯一纵向滚动区，且外层链路右侧零内缩（滚动条贴容器右缘）', () => {
    const { baseElement } = renderEditor();
    const scroll = baseElement.querySelector('[data-script-scroll]') as HTMLElement;
    expect(scroll).not.toBeNull();
    // 真实滚动容器：纵向可滚、不出横向滚动条
    expect(scroll.style.overflowY).toBe('auto');
    expect(scroll.style.overflowX).toBe('hidden');

    // 从滚动容器向上直至 body，任何 DIV 祖先都不贡献右向留白
    // （修正前：editorArea padding-right 16px + 纸张 padding-right 24px = 40px 视觉内缩）
    const ancestors: HTMLElement[] = [];
    let node = scroll.parentElement;
    while (node && node !== document.body) {
      ancestors.push(node);
      node = node.parentElement;
    }
    expect(ancestors.length).toBeGreaterThanOrEqual(3); // 至少经过 纸张根 / editorArea / mainRow / overlay
    for (const el of ancestors) {
      expectZeroRightInset(el);
    }

    // 纸张根 overflow:hidden——不产生第二根纵向滚动条（无双滚动条）
    const paper = scroll.parentElement as HTMLElement;
    expect(paper.style.overflow).toBe('hidden');
    // editorArea（纸张的父级）同样裁剪且右侧零留白
    const editorArea = paper.parentElement as HTMLElement;
    expect(editorArea.style.overflow).toBe('hidden');
    expect(editorArea.style.paddingRight).toBe('0px');
  });

  it('文字呼吸间距来自滚动容器内层 padding(24px)，而非外层空隙', () => {
    const { baseElement } = renderEditor();
    const scroll = baseElement.querySelector('[data-script-scroll]') as HTMLElement;
    expect(scroll).not.toBeNull();
    // 内层呼吸间距：滚动内容（文字行）距滚动条轨道 24px，滚动中全程保持
    expect(scroll.style.paddingRight).toBe('24px');

    // 外层不再留白：纸张与 editorArea 右 padding 均为 0px（滚动条贴边的来源）
    const paper = scroll.parentElement as HTMLElement;
    expect(paper.style.paddingRight).toBe('0px');
    const editorArea = paper.parentElement as HTMLElement;
    expect(editorArea.style.paddingRight).toBe('0px');

    // 底部固定「新段落」按钮 wrap 有独立的 24px 右呼吸，不贴右边缘、不与滚动条相撞
    const bottomWrap = paper.lastElementChild as HTMLElement;
    expect(bottomWrap.style.paddingRight).toBe('24px');
  });

  it('光标在文字上滚轮也能滚动剧本页（2026-11-10 用户反馈）', () => {
    const { baseElement } = renderEditor();
    const scroll = baseElement.querySelector('[data-script-scroll]') as HTMLElement;
    expect(scroll).not.toBeNull();
    const textarea = scroll.querySelector('textarea');
    expect(textarea).not.toBeNull();

    // jsdom 没有布局：给滚动容器装一个可观测的 scrollTop，断言滚轮被转发成滚动
    let top = 0;
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v: number) => { top = v; },
    });
    textarea!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    expect(top).toBe(120);
    // 向上滚同理
    textarea!.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true }));
    expect(top).toBe(80);
  });
});
