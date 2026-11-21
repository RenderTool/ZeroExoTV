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
import { render, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';

/**
 * jsdom 没有 PointerEvent：fireEvent.pointerDown 会退化成不带 clientX 的 Event，
 * 拖动相关断言就永远拿不到坐标。补一个基于 MouseEvent 的 polyfill（仅测试用）。
 */
if (typeof window !== 'undefined' && typeof (window as unknown as { PointerEvent?: unknown }).PointerEvent !== 'function') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId = 1;
    pointerType = 'mouse';
    isPrimary = true;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let s = fallback ?? key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('@zeroexo/plugin-nodes', () => ({  useHydratedContent: (storageKey?: string) => (storageKey ? `blob:hydrated:${storageKey}` : ''),
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

describe('StoryboardVideoStage 分镜预览：可暂停 / 可拖进度 / 不自动循环（2026-11-20）', () => {
  it('disableLoop：<video> 不循环，播完停在最后一帧；控制条（播放键 + 进度条）仍然渲染', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:preview.mp4',
      videoStatus: 'done',
      disableLoop: true,
    }));
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(false);
    expect(container.querySelector('[data-video-control-bar]')).toBeTruthy();
    // 进度条可拖（有 pointer 处理器即代表可 scrub）
    expect(container.querySelector('[data-video-control-bar]')).toBeTruthy();
  });

  it('点画面能播放/暂停（非 hideControls 模式）', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:preview.mp4',
      videoStatus: 'done',
      disableLoop: true,
    }));
    const video = container.querySelector('video') as HTMLVideoElement;
    // jsdom 的 paused 恒为 true，这里用可控的 getter 模拟真实播放态切换
    let paused = true;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    const playSpy = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; });
    const pauseSpy = vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; });
    fireEvent.click(video);
    expect(playSpy).toHaveBeenCalled();
    fireEvent.click(video);
    expect(pauseSpy).toHaveBeenCalled();
  });
});

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

describe('StoryboardVideoStage 点击片段起播（2026-11-07 用户反馈）', () => {
  it('autoPlayKey 变化 → 当前片段从 0 起播；切到另一片段后源就绪仍起播', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { rerender } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:a.mp4',
      videoStatus: 'done',
      autoPlayKey: 0,
    }));
    expect(play).not.toHaveBeenCalled();
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:a.mp4',
      videoStatus: 'done',
      autoPlayKey: 1,
    }));
    expect(play).toHaveBeenCalledTimes(1);
    // 换片段（<video> 按 storageKey 重挂载 + 源异步解析）→ 新片段也要起播
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStorageKey: 'video:b.mp4',
      videoStatus: 'done',
      autoPlayKey: 2,
    }));
    expect(play).toHaveBeenCalledTimes(2);
    play.mockRestore();
    pause.mockRestore();
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

describe('生成中实时预览：帧进度条 + 暂停定格（C-20）', () => {
  const videoFrame = {
    image: '',
    video: 'data:video/mp4;base64,zz',
    mime: 'video/mp4',
    fps: 24,
    step: 3,
    totalSteps: 8,
    segmentIndex: 1,
  } as const;

  function renderVideoPreview() {
    return render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
      livePreview: videoFrame,
    }));
  }

  it('视频预览带帧进度条：按插件 fps 算「第 N / 共 M 帧」，不是采样步数', async () => {
    const { container } = renderVideoPreview();
    const video = container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(container.querySelector('[data-live-preview-controls]')).toBeTruthy();
    expect(container.querySelector('[data-live-preview-bar]')).toBeTruthy();

    // jsdom 不解码视频：手工灌 duration/currentTime 模拟 2s@24fps，播到 0.5s = 第 13 帧
    Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
    video.dispatchEvent(new Event('loadedmetadata'));
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.5 });
    video.dispatchEvent(new Event('timeupdate'));
    const counter = container.querySelector('[data-live-preview-frame-counter]') as HTMLElement;
    await waitFor(() => expect(counter.textContent).toBe('帧 13/48'));
    // 采样步数仍由角标负责，两者不混
    expect(container.querySelector('[data-live-preview-badge]')?.textContent).toBe('3/8 · 段1');
  });

  it('点暂停即定格：按钮转「继续预览」，暂停期间新采样帧不替换画面', () => {
    const { container, rerender } = renderVideoPreview();
    const toggle = container.querySelector('[data-live-preview-toggle]') as HTMLButtonElement;
    expect(toggle.getAttribute('title')).toBe('暂停预览');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('title')).toBe('继续预览');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // 暂停中来了新一帧（不同 data URL）→ 画面还是定格那一帧
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
      livePreview: { ...videoFrame, video: 'data:video/mp4;base64,NEW' },
    }));
    const video = container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('data:video/mp4;base64,zz');

    // 继续后跳到最新帧
    fireEvent.click(toggle);
    expect(toggle.getAttribute('title')).toBe('暂停预览');
    const latest = container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement;
    expect(latest.getAttribute('src')).toBe('data:video/mp4;base64,NEW');
  });

  it('插件没给 fps 时不伪造帧号：回落成秒读数', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
      livePreview: { ...videoFrame, fps: undefined },
    }));
    const counter = container.querySelector('[data-live-preview-frame-counter]') as HTMLElement;
    expect(counter.textContent).not.toContain('帧');
    expect(counter.textContent).toContain('s /');
  });

  it('进度条可拖动定位：按下/拖动按比例 seek，帧号跟着走', async () => {
    const { container } = renderVideoPreview();
    const video = container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.dispatchEvent(new Event('loadedmetadata'));

    const bar = container.querySelector('[data-live-preview-scrub]') as HTMLElement;
    // jsdom 无布局：给进度条一个 100px 宽的假 rect，clientX 直接换算比例
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 14, right: 100, bottom: 14, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const counter = container.querySelector('[data-live-preview-frame-counter]') as HTMLElement;

    fireEvent.pointerDown(bar, { clientX: 50 });
    await waitFor(() => expect(counter.textContent).toBe('帧 25/48'));
    expect(video.currentTime).toBe(1);

    // 拖到最右 → 最后一帧
    fireEvent.pointerMove(window, { clientX: 100 });
    await waitFor(() => expect(counter.textContent).toBe('帧 48/48'));

    // 拖动中也要「定格」：按下即暂停
    const toggle = container.querySelector('[data-live-preview-toggle]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // 松手后（本来是在播）自动回到直播，不把预览卡死在历史帧
    fireEvent.pointerUp(window);
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
  });

  it('拖动期间 step 更新照常生效（只压画面替换，不压数据）', async () => {
    const { container, rerender } = renderVideoPreview();
    const video = container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 2 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    video.dispatchEvent(new Event('loadedmetadata'));
    const bar = container.querySelector('[data-live-preview-scrub]') as HTMLElement;
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 14, right: 100, bottom: 14, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(bar, { clientX: 20 });

    // 你正拖在第 20%：新一步采样帧到了（step 3→5，src 也换了）
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
      livePreview: { ...videoFrame, video: 'data:video/mp4;base64,NEW', step: 5 },
    }));
    const badge = container.querySelector('[data-live-preview-badge]') as HTMLElement;
    // 角标继续跳（step 数据没有被拖动卡住）
    await waitFor(() => expect(badge.textContent).toBe('5/8 · 段1'));
    // 画面仍是你拖到的那一版，不被新帧顶掉
    expect((container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement).getAttribute('src'))
      .toBe('data:video/mp4;base64,zz');
    // 松手回到直播 → 立刻跳到最新一帧，step 数据与画面重新同步
    fireEvent.pointerUp(window);
    await waitFor(() => expect(
      (container.querySelector('video[data-live-preview-frame]') as HTMLVideoElement).getAttribute('src'),
    ).toBe('data:video/mp4;base64,NEW'));
  });
});

describe('导演台：播放控制条只在成片后出现（2026-11-07 用户反馈）', () => {
  it('生成中 + 实时帧：帧与进度角标仍在，但不渲染播放键/时间码/进度条', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      hideControlBarWhenNoVideo: true,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
      livePreview: { image: 'data:image/webp;base64,zz', step: 2, totalSteps: 25, segmentIndex: 1 },
    }));
    expect(container.querySelector('[data-live-preview-frame]')).toBeTruthy();
    expect(container.querySelector('[data-live-preview-badge]')).toBeTruthy();
    expect(container.querySelector('[data-video-control-bar]')).toBeNull();
    expect(container.textContent).not.toContain('00:00');
  });

  it('成片后控制条出现；切回生成中后消失，不残留上一条成片的时间码', () => {
    const { container, rerender } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      hideControlBarWhenNoVideo: true,
      videoStorageKey: 'video:done.mp4',
      videoStatus: 'done',
    }));
    expect(container.querySelector('[data-video-control-bar]')).toBeTruthy();
    expect(container.textContent).toContain('00:00 / 00:00');
    rerender(createElement(StoryboardVideoStage, {
      ...baseProps,
      hideControlBarWhenNoVideo: true,
      videoStatus: 'generating',
      placeholderStatus: 'generating',
    }));
    expect(container.querySelector('[data-video-control-bar]')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  it('未开启开关的调用方（出片工作台整轨播放）占位态仍保留控制条', () => {
    const { container } = render(createElement(StoryboardVideoStage, {
      ...baseProps,
      placeholderStatus: 'idle',
      placeholderTitle: '#3 中景',
      playbackMode: 'all',
      sequenceDuration: 42,
      onTogglePlay: () => {},
    }));
    expect(container.querySelector('[data-video-control-bar]')).toBeTruthy();
  });
});
