/**
 * storyboard-merged-tab 出片页布局结构断言（2026-11-04 出片页布局改造）
 *
 * 结构契约（三块区域）：
 * 1. 上排 [data-wb="top-row"] 同时包含 [data-wb="prompt-area"]（提示词区）与
 *    [data-wb="video-preview"]（视频预览），二者同级并排；
 * 2. 下排 [data-wb="track-area"]（轨道通栏）与 top-row 同级、位于其后（不含于 top-row，
 *    视频预览不会延伸到轨道区域）；
 * 3. 提示词区与预览之间有竖向分隔拖拽条 [data-wb="prompt-split"]（两列可伸缩）。
 *
 * 附属契约：已完成镜头提示词区不留空壳——promptReadonlyText 有值显示摘要、空串显示
 * 「无提示词」占位（[data-wb="prompt-empty"]）。
 *
 * 子组件（资产栏/视频台/时间轴/多轨/提示词坞）与 react-i18next 全部 mock，
 * 只验证本组件的容器结构与分支渲染。
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('./storyboard-asset-panel', () => ({
  StoryboardAssetPanel: (): ReactElement => <div data-mock="asset-panel" />,
}));
vi.mock('./storyboard-video-stage', () => ({
  StoryboardVideoStage: (): ReactElement => <div data-mock="video-stage" />,
}));
vi.mock('./storyboard-timeline', () => ({
  StoryboardTimeline: (): ReactElement => <div data-mock="timeline" />,
}));
vi.mock('./workbench-multitrack', () => ({
  WorkbenchMultiTrack: (): ReactElement => <div data-mock="multitrack" />,
}));
vi.mock('./workbench-prompt-dock', () => ({
  WorkbenchPromptDock: (): ReactElement => <div data-mock="prompt-dock" />,
}));

import { StoryboardMergedTab, previewMinHeightPx } from './storyboard-merged-tab';

const theme = {
  canvas: { background: '#0b0b0c' },
  toolbar: { text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6' },
} as any;

const minimalMultitrackProps = {
  tracks: [],
  data: { status: 'ready', shots: [], totalDuration: 0, completedCount: 0 } as any,
  focusedTrackId: null,
  onFocusTrack: () => {},
};

function renderTab(extra?: Partial<Parameters<typeof StoryboardMergedTab>[0]>) {
  return render(
    <StoryboardMergedTab
      entities={[]}
      showAssetSidebar={false}
      multitrackProps={minimalMultitrackProps}
      theme={theme}
      isDark={true}
      {...extra}
    />,
  );
}

describe('StoryboardMergedTab 出片页布局（2026-11-04）', () => {
  it('提示词区与视频预览在同一行容器（top-row）内，且彼此同级', () => {
    const { container } = renderTab();
    const topRow = container.querySelector('[data-wb="top-row"]');
    const promptArea = container.querySelector('[data-wb="prompt-area"]');
    const videoPreview = container.querySelector('[data-wb="video-preview"]');
    expect(topRow).toBeTruthy();
    expect(promptArea).toBeTruthy();
    expect(videoPreview).toBeTruthy();
    // 两块都直接/间接挂在 top-row 下
    expect(topRow!.contains(promptArea)).toBe(true);
    expect(topRow!.contains(videoPreview)).toBe(true);
    // 彼此同级（同一父元素 → 并排一行）
    expect(promptArea!.parentElement).toBe(videoPreview!.parentElement);
    // 提示词区在视频预览左侧（DOM 顺序）
    expect(
      promptArea!.compareDocumentPosition(videoPreview!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('轨道区是 top-row 之后的独立一行（通栏），预览不延伸到轨道区域', () => {
    const { container } = renderTab();
    const topRow = container.querySelector('[data-wb="top-row"]')!;
    const trackArea = container.querySelector('[data-wb="track-area"]')!;
    const videoPreview = container.querySelector('[data-wb="video-preview"]')!;
    expect(trackArea).toBeTruthy();
    // 轨道区不含于上排（否则预览/轨道会上下重叠）
    expect(topRow.contains(trackArea)).toBe(false);
    // 轨道区与上排同父、紧随其后 → 通栏独立一行
    expect(trackArea.parentElement).toBe(topRow.parentElement);
    expect(topRow.compareDocumentPosition(trackArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 视频预览不含轨道区
    expect(videoPreview.contains(trackArea)).toBe(false);
  });

  it('提示词区与预览之间存在竖向分隔拖拽条（两列可伸缩）', () => {
    const { container } = renderTab();
    const topRow = container.querySelector('[data-wb="top-row"]')!;
    const promptArea = container.querySelector('[data-wb="prompt-area"]')!;
    const videoPreview = container.querySelector('[data-wb="video-preview"]')!;
    const split = container.querySelector('[data-wb="prompt-split"]')!;
    expect(split).toBeTruthy();
    expect(topRow.contains(split)).toBe(true);
    // 分隔条位于两者之间
    expect(promptArea.compareDocumentPosition(split) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(split.compareDocumentPosition(videoPreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 提示词区初始宽度 44%（占比拖拽基准）
    expect((promptArea as HTMLElement).style.width).toBe('44%');
  });

  it('已完成镜头：有提示词显示只读摘要，空串显示「无提示词」占位（不留空壳）', () => {
    const withText = renderTab({ promptReadonlyText: '一位老人在海边回头' });
    expect(withText.container.textContent).toContain('一位老人在海边回头');
    expect(withText.container.querySelector('[data-wb="prompt-empty"]')).toBeNull();
    withText.unmount();

    const empty = renderTab({ promptReadonlyText: '' });
    expect(empty.container.querySelector('[data-wb="prompt-empty"]')).toBeTruthy();
    expect(empty.container.textContent).toContain('无提示词');
    empty.unmount();
  });
});

describe('第七条A：导演台默认 提示词:预览 = 3:1 + 用户比例持久化 + 预览最小高', () => {
  const KEY = 'zerovideo.director.promptRatio:test-proj';

  it('promptRatioDefault=0.75 → 提示词区初始宽度 75%（3:1）；不传 = 44%（其余页面零变化）', () => {
    const a = renderTab({ promptRatioDefault: 0.75 });
    expect((a.container.querySelector('[data-wb="prompt-area"]') as HTMLElement).style.width).toBe('75%');
    a.unmount();
    const d = renderTab();
    expect((d.container.querySelector('[data-wb="prompt-area"]') as HTMLElement).style.width).toBe('44%');
    d.unmount();
  });

  it('用户比例持久化：localStorage 合法值 → 沿用（0.6 → 60%）；越界非法值 → 回落默认 75%', () => {
    window.localStorage.setItem(KEY, '0.6');
    const a = renderTab({ promptRatioDefault: 0.75, promptRatioStorageKey: KEY });
    expect((a.container.querySelector('[data-wb="prompt-area"]') as HTMLElement).style.width).toBe('60%');
    a.unmount();
    window.localStorage.setItem(KEY, '9.9');
    const b = renderTab({ promptRatioDefault: 0.75, promptRatioStorageKey: KEY });
    expect((b.container.querySelector('[data-wb="prompt-area"]') as HTMLElement).style.width).toBe('75%');
    b.unmount();
    window.localStorage.removeItem(KEY);
  });

  it('预览最小高 = max(120px, 25vh)：400px 视口 → 120；2000px 视口 → 500', () => {
    const original = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    expect(previewMinHeightPx()).toBe(120);
    Object.defineProperty(window, 'innerHeight', { value: 2000, configurable: true });
    expect(previewMinHeightPx()).toBe(500);
    Object.defineProperty(window, 'innerHeight', { value: original, configurable: true });
  });
});
