/**
 * storyboard-fullscreen-editor 顶栏结构断言（2026-11-21 统一模块工具栏口径）
 *
 * 契约（与剧本顶栏一致）：
 * 1. 左上第一个操作 = 切集（`data-storyboard-episode-switch`），不是裸 Select；
 * 2. 主操作（重新生成该集）必须在左侧操作组、且带文字（不是裸图标）；
 * 3. 右侧 `data-storyboard-stats` 只放统计，不能出现任何 button；
 * 4. 顶部结构分区 `data-toolbar-zone=left/right` 存在。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

const theme = {
  mode: 'dark',
  toolbar: { text: '#e5e5e5', textMuted: '#888', accent: '#e94560', border: '#333' },
  canvas: { background: '#141414' },
} as any;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      if (typeof second === 'string') return second;
      if (third && typeof third === 'object') {
        return Object.entries(third as Record<string, unknown>).reduce(
          (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), key,
        );
      }
      return key;
    },
  }),
}));
vi.mock('@zeroexo/plugin-theme', () => ({ useTheme: () => ({ theme }) }));
vi.mock('./StoryboardSubjectTab', () => ({
  StoryboardSubjectTab: (): ReactElement => <div data-mock="subject-tab" />,
}));

import { App } from 'antd';
import { StoryboardFullscreenEditor } from './storyboard-fullscreen-editor';

const episodes = [
  { id: 'ep-1', title: '第1集 | 三娘，等我' },
  { id: 'ep-2', title: '第2集' },
];

function renderHeader() {
  return render(
    <App>
      <StoryboardFullscreenEditor
        open
        embedded
        onClose={() => {}}
        episodes={episodes}
        activeEpisodeId="ep-1"
        onEpisodeChange={() => {}}
        productionItems={[{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never}
        onRequestRegenerate={() => {}}
      />
    </App>,
  );
}

describe('storyboard-fullscreen-editor 顶栏统一口径', () => {
  it('左上第一项是切集控件，且使用带标题的下拉按钮（不是 antd Select）', () => {
    const { container } = renderHeader();
    const left = container.querySelector('[data-toolbar-zone="left"]') as HTMLElement;
    expect(left).not.toBeNull();
    const first = left.firstElementChild as HTMLElement;
    const sw = left.querySelector('[data-storyboard-episode-switch]') as HTMLElement;
    expect(sw).not.toBeNull();
    expect(sw.textContent).toContain('三娘，等我');
    expect(first.contains(sw)).toBe(true);
    // 不是裸 Select（antd Select 会渲染 .ant-select）
    expect(left.querySelector('.ant-select')).toBeNull();
  });

  it('重新生成在左侧、带文字；右侧统计区零按钮', () => {
    const { container } = renderHeader();
    const left = container.querySelector('[data-toolbar-zone="left"]') as HTMLElement;
    const stats = container.querySelector('[data-storyboard-stats]') as HTMLElement;
    const regen = left.querySelector('[data-storyboard-regenerate]') as HTMLElement;
    expect(regen).not.toBeNull();
    expect(regen.textContent).toContain('重新生成该集');
    expect(stats.querySelector('button')).toBeNull();
    expect(stats.textContent).toContain('主体');
    expect(stats.textContent).toContain('3');
    expect(stats.style.justifyContent).toBe('flex-end');
  });
});
