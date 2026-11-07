/**
 * StoryboardVideoStage — 媒体与状态占位互斥回归断言（2026-11-05）
 *
 * 断言（对应「预览图片消失」回归的验收口径）：
 * 1. 有媒体（videoStorageKey 且 videoStatus≠failed）→ 渲染 <video>，不渲染状态占位
 * 2. 无媒体有 placeholderStatus → 渲染状态占位（data-placeholder-status），不渲染 <video>
 * 3. 媒体与占位互斥：同一 props 下二者必居其一；切换片段（改 props）后互斥保持正确
 * 4. videoStatus='failed' 时即使有 storageKey 也不渲染 <video>
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let s = fallback ?? key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('@zeroexo/plugin-nodes', () => ({
  useHydratedContent: (storageKey?: string) => (storageKey ? `blob:hydrated:${storageKey}` : ''),
  AISkeleton: () => null,
}));

import { StoryboardVideoStage } from './storyboard-video-stage.jsx';

const baseProps = {
  aspect: '16:9',
  isDark: true,
  generating: false,
  onGenerate: () => {},
  onError: () => {},
  theme: {
    toolbar: { panel: '#1e1e20', text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6', danger: '#ef4444' },
    canvas: { background: '#17171a' },
  } as never,
};

describe('StoryboardVideoStage 媒体/占位互斥', () => {
  it('有媒体：渲染 <video>（src 已解析）且无状态占位节点', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:abc.mp4',
      videoStatus: 'done',
    }));
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.src).toBe('blob:hydrated:video:abc.mp4');
    expect(container.querySelector('[data-placeholder-status]')).toBeNull();
    // 尺寸钉死（jsdom 无布局，断言内联 100% 高宽链路存在）
    const stage = container.querySelector('[data-video-stage]') as HTMLElement;
    expect(stage.style.height).toBe('100%');
  });

  it('无媒体有状态：渲染状态占位（未生成）且不渲染 <video>', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'idle',
      paramsLabel: '16:9 · 864×480',
    }));
    expect(container.querySelector('video')).toBeNull();
    const ph = container.querySelector('[data-placeholder-status]') as HTMLElement;
    expect(ph).toBeTruthy();
    expect(ph.textContent).toContain('未生成');
    // 参数标签在占位态仍可见（右上角）
    expect(container.querySelector('[data-video-stage]')!.textContent).toContain('16:9 · 864×480');
  });

  it('切换片段：媒体 ↔ 占位互斥翻转正确', () => {
    const { container, rerender } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:abc.mp4',
      videoStatus: 'done',
    }));
    expect(container.querySelector('video')).toBeTruthy();
    expect(container.querySelector('[data-placeholder-status]')).toBeNull();
    // 切到无媒体片段
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'generating',
    }));
    expect(container.querySelector('video')).toBeNull();
    const ph = container.querySelector('[data-placeholder-status]') as HTMLElement;
    expect(ph.querySelector('[data-generating-skeleton]')).toBeTruthy();
    // 切回有媒体片段
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:def.mp4',
      videoStatus: 'done',
    }));
    expect(container.querySelector('video')!.src).toBe('blob:hydrated:video:def.mp4');
    expect(container.querySelector('[data-placeholder-status]')).toBeNull();
  });

  it('videoStatus=failed：即使有 storageKey 也不渲染 <video>，走失败占位', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:abc.mp4',
      videoStatus: 'failed',
      placeholderStatus: 'failed',
    }));
    expect(container.querySelector('video')).toBeNull();
    const ph = container.querySelector('[data-placeholder-status]') as HTMLElement;
    expect(ph.textContent).toContain('生成失败');
  });
});

describe('StoryboardVideoStage 实时预览角标（2026-11-05 修复：文本标签不压画面）', () => {
  const liveFrame = {
    livePreview: { image: 'data:image/webp;base64,zz', step: 2, totalSteps: 25, segmentIndex: 1 },
  } as const;

  it('生成中 + 实时帧：状态合并为左下角紧凑角标（2/25 · 段1），不居中、不拦截点击，「生成中」不再单独出现', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'generating',
      ...liveFrame,
    }));
    // 帧与测试标识保持
    expect(container.querySelector('[data-live-preview-frame]')).toBeTruthy();
    const badge = container.querySelector('[data-live-preview-badge]') as HTMLElement;
    expect(badge).toBeTruthy();
    // 角落定位：绝对定位在预览区左下角，非居中覆盖层
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.left).toBe('10px');
    expect(badge.style.bottom).toBe('10px');
    // 不拦截点击/拖拽
    expect(badge.style.pointerEvents).toBe('none');
    // 紧凑文案；完整文案在 title 悬停
    expect(badge.textContent).toBe('2/25 · 段1');
    expect(badge.getAttribute('title')).toBe('实时预览中 · 2/25 · 第 1 段');
    // 「生成中」一词不再出现在预览区（被脉冲点 + 角标取代）
    const stage = container.querySelector('[data-video-stage]') as HTMLElement;
    expect(stage.textContent).not.toContain('生成中');
  });

  it('完成/取消后角标消失；无实时帧时居中状态行保持原样', () => {
    const { container, rerender } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'generating',
      ...liveFrame,
    }));
    expect(container.querySelector('[data-live-preview-badge]')).toBeTruthy();
    // 运行结束（done，已有视频）→ 角标消失
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:abc.mp4',
      videoStatus: 'done',
    }));
    expect(container.querySelector('[data-live-preview-badge]')).toBeNull();
    // 生成中但无实时帧（如取消后回落）→ 无角标，居中状态行仍在
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'generating',
    }));
    expect(container.querySelector('[data-live-preview-badge]')).toBeNull();
    const ph = container.querySelector('[data-placeholder-status]') as HTMLElement;
    expect(ph.querySelector('[data-generating-skeleton]')).toBeTruthy();
  });
});
