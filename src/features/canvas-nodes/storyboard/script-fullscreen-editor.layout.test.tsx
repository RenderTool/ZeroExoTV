/**
 * script-fullscreen-editor 剧本卡片布局结构断言（2026-11-04 跳转按钮与统计条重排）
 *
 * 结构契约：
 * 1. [data-script-jump]「跳转」按钮的父级归属 = 剧集列表标题行 [data-script-episodes-header]；
 * 2. 统计容器 [data-script-stats] 不含跳转按钮，且右对齐（justify-content: flex-end）；
 * 3. 剧集行集名文字色 = 中性文字色（不用主题 accent 红 #e94560，激活态由底色/描边/字重表达）。
 *
 * 子组件（纸张编辑器）与 react-i18next / @zeroexo/plugin-theme / @/i18n/config 全部 mock，
 * EpisodeList 保持真实渲染（它是被断言的结构主体）。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

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
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
// 包级 index 链到 antd/fluent-emoji（jsdom 无法解析 ESM 目录导入），与既有测试同法 mock 掉
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { on: () => () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../script-editor/script-structured-editor', () => ({
  ScriptStructuredEditor: (): ReactElement => <div data-mock="structured-editor" />,
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

describe('script-fullscreen-editor 剧本卡片布局', () => {
  it('跳转按钮在剧集标题行内', () => {
    const { baseElement } = renderEditor();
    const jump = baseElement.querySelector('[data-script-jump]');
    expect(jump).not.toBeNull();
    expect(jump!.closest('[data-script-episodes-header]')).not.toBeNull();
  });

  it('统计容器不含跳转按钮且右对齐', () => {
    const { baseElement } = renderEditor();
    const stats = baseElement.querySelector('[data-script-stats]') as HTMLElement;
    expect(stats).not.toBeNull();
    expect(stats.querySelector('[data-script-jump]')).toBeNull();
    expect(stats.style.justifyContent).toBe('flex-end');
  });

  it('集名文字色为中性色（非 accent 红）', () => {
    const { baseElement } = renderEditor();
    const header = baseElement.querySelector('[data-script-episodes-header]')!;
    expect(header).not.toBeNull();
    // 列表区集名（顶栏当前集标题同为中性色，不排除）均不使用 accent 红
    const titles = Array.from(baseElement.querySelectorAll('span'))
      .filter((el) => el.textContent === '第1集' || el.textContent === '第2集');
    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const el of titles) {
      expect((el as HTMLElement).style.color).not.toBe(theme.toolbar.accent);
    }
  });
});
