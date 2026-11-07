/**
 * 导演台 2026-11-04 改造验收（storyboard 侧）：
 *
 * 1. storyboard-video-stage：预览区零按钮化 —— 空态（传了 emptyActions/onGenerate/onStop 也不渲染）、
 *    generating/failed 覆盖层均无 button；全屏按钮单击直接回调 onFullscreenPlay
 *    （playbackMode='all' → 'all'，否则 'clip'），无下拉菜单；全状态 `button button` 嵌套 = 0。
 * 2. timeline-clip：directorLabel=true → 「上缩略框 + 下标签行」，
 *    标签 data-director-clip-label = 「片段 NN · XXs」，不渲染 #号/旧状态文本；
 *    六态徽标缩为缩略框右上角角标；缺省旧渲染完全不变。
 * 3. workbench-multitrack：不传新 props（出片页路径）→ 无 data-track-select-mode、
 *    分割按钮 title 仍是「在播放头处分割选中片段」；传 continuityEntry → title=「段间衔接」；
 *    传 selectMode → 模式条「已选 N 段」+ 完成/取消。
 *
 * mock：react-i18next；@zeroexo/plugin-nodes 仅 stub useHydratedContent（importOriginal 保留其余导出）；
 * AuthorizedImage / VideoFilmstrip stub 为轻量元素；lucide-react 与 StoryboardTimeline 真实渲染。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { existsSync } from 'node:fs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let s = fallback ?? key;
      if (opts) for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock('@zeroexo/plugin-nodes', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, useHydratedContent: () => '' };
});

vi.mock('@/shared/components/authorized-media.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    AuthorizedImage: (props: { style?: React.CSSProperties }) =>
      createElement('img', { 'data-auth-img': true, style: props.style }),
  };
});

vi.mock('./storyboard-clip-filmstrip', () => ({
  VideoFilmstrip: (): ReactElement => createElement('div', { 'data-mock-filmstrip': true }),
}));

import { StoryboardVideoStage } from './storyboard-video-stage.jsx';
import { TimelineClip } from './timeline-clip.js';
import { WorkbenchMultiTrack, type WorkbenchMultiTrackProps } from './workbench-multitrack.jsx';
import type { StoryboardTimelineProps } from './storyboard-timeline.jsx';
import type { WorkbenchNodeData, WorkbenchTrack } from './workbench-types.js';

const theme = {
  canvas: { background: '#0b0b0c' },
  toolbar: { text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6', danger: '#ef4444' },
} as never;

// ===== 1. StoryboardVideoStage =====

function renderStage(props?: Partial<Parameters<typeof StoryboardVideoStage>[0]>) {
  return render(<StoryboardVideoStage theme={theme} isDark={true} {...props} />);
}

describe('storyboard-video-stage：预览区零按钮化', () => {
  it('空态：传了 emptyActions/onGenerate/onStop 也不渲染任何 button', () => {
    const { container } = renderStage({
      videoStatus: 'idle',
      emptyLabel: '本镜尚无视频',
      emptyActions: [{ key: 'new', label: '新建片段', onClick: () => {} }],
      onGenerate: () => {},
      onStop: () => {},
    });
    const stage = container.querySelector('[data-video-stage]') as HTMLElement;
    expect(stage).toBeTruthy();
    expect(stage.textContent).toContain('本镜尚无视频');
    expect(stage.querySelectorAll('button').length).toBe(0);
    expect(stage.querySelectorAll('button button').length).toBe(0);
  });

  it('generating 覆盖层无 button（有视频时控制条按钮在覆盖层外，且不嵌套）', () => {
    const { container } = renderStage({ videoStorageKey: 'video:k1', videoStatus: 'generating', videoProgress: 0.4 });
    const overlay = container.querySelector('[data-video-status="generating"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('40%');
    expect(overlay.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('button button').length).toBe(0);
  });

  it('failed 覆盖层无 button、无重试入口', () => {
    const { container } = renderStage({ videoStorageKey: 'video:k1', videoStatus: 'failed', videoError: '生成失败：超时' });
    const overlay = container.querySelector('[data-video-status="failed"]') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain('超时');
    expect(overlay.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('[data-video-stage] button').length).toBe(0);
  });

  it('全屏按钮单击 → onFullscreenPlay（clip）；playbackMode=all 时 → all；无下拉菜单', () => {
    const spy = vi.fn();
    const { container, unmount } = renderStage({
      videoStorageKey: 'video:k1', videoStatus: 'done', onFullscreenPlay: spy,
    });
    const btn = container.querySelector('button[title="全屏"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith('clip');
    // 无第二层下拉菜单
    expect(document.querySelectorAll('[role="menu"], [role="menuitem"], .ant-dropdown-menu').length).toBe(0);
    unmount();

    const spy2 = vi.fn();
    const seq = renderStage({
      videoStorageKey: 'video:k1', videoStatus: 'done', onFullscreenPlay: spy2, playbackMode: 'all',
    });
    fireEvent.click(seq.container.querySelector('button[title="全屏"]') as HTMLButtonElement);
    expect(spy2).toHaveBeenLastCalledWith('all');
    expect(document.querySelectorAll('[role="menu"], [role="menuitem"], .ant-dropdown-menu').length).toBe(0);
    // 播放中控制条按钮平铺，无嵌套
    expect(seq.container.querySelectorAll('button button').length).toBe(0);
  });
});

// ===== 1b. 第十二条：预览占位 = 仅状态（不回显提示词） =====

describe('storyboard-video-stage：状态型占位（第十二条）', () => {
  it('未生成：单行状态文案「未生成」+ 小图标，不含提示词文本、无按钮', () => {
    const { container } = renderStage({ placeholderStatus: 'idle', placeholderPrompt: '一只狗在跑' });
    const card = container.querySelector('[data-placeholder-status="idle"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('未生成');
    expect(card.textContent).not.toContain('一只狗在跑'); // 删除提示词回显
    expect(card.querySelector('svg')).toBeTruthy(); // 小图标
    expect(card.querySelectorAll('button').length).toBe(0);
    // 状态型优先于旧 prompt 卡
    expect(container.querySelector('[data-placeholder-prompt]')).toBeNull();
  });

  it('四种状态文案：生成中 · detail / 已生成 · 8s / 生成失败 + 一行原因', () => {
    const gen = renderStage({ placeholderStatus: 'generating', placeholderDetail: '2/5' });
    const genCard = gen.container.querySelector('[data-placeholder-status="generating"]') as HTMLElement;
    expect(genCard.querySelector('[data-generating-skeleton]')).toBeTruthy();
    expect(genCard.textContent).toContain('2/5');
    gen.unmount();

    const done = renderStage({ placeholderStatus: 'done', placeholderDetail: '8s' });
    expect(done.container.querySelector('[data-placeholder-status="done"]')?.textContent).toContain('已生成 · 8s');
    done.unmount();

    const failed = renderStage({ placeholderStatus: 'failed', placeholderReason: '生成失败：队列超时' });
    const card = failed.container.querySelector('[data-placeholder-status="failed"]') as HTMLElement;
    expect(card.textContent).toContain('生成失败');
    const reason = card.querySelector('[data-placeholder-reason]') as HTMLElement;
    expect(reason.textContent).toBe('生成失败：队列超时');
    expect(reason.style.whiteSpace).toBe('nowrap'); // 截断一行
    expect(reason.style.textOverflow).toBe('ellipsis');
  });

  it('有视频时占位不渲染（正常播放器路径）', () => {
    const { container } = renderStage({ videoStorageKey: 'video:k1', videoStatus: 'done', placeholderStatus: 'done' });
    expect(container.querySelector('[data-placeholder-status]')).toBeNull();
  });
});

const clipHandlers = {
  onPointerDown: () => {}, onPointerMove: () => {}, onPointerUp: () => {},
  onContextMenu: () => {}, onDoubleClick: () => {}, onTrimStart: () => {},
};

function renderClip(directorLabel?: boolean, width = 120) {
  return render(
    <TimelineClip
      clip={{ id: 'c1', left: 0, width, data: { id: 'c1', number: 3, duration: 8, status: 'pending' } as never }}
      isSelected={false}
      isDragging={false}
      {...clipHandlers}
      t={((_key: string, options?: Record<string, unknown>) => {
        let s = (options?.defaultValue as string | undefined) ?? '';
        if (options) for (const [k, v] of Object.entries(options)) {
          if (k !== 'defaultValue') s = s.replace(`{{${k}}}`, String(v));
        }
        return s;
      }) as never}
      isDark={true}
      clipSelectedColor="#3b82f6"
      trimHandleColor="#3b82f6"
      clipTextColor="#e5e5e5"
      directorLabel={directorLabel}
    />,
  );
}

describe('timeline-clip：directorLabel 缩略框 + 标签行', () => {
  it('directorLabel=true → 上缩略框 + 下标签「片段 NN · XXs」（data-director-clip-label），无 #号/旧状态文本', () => {
    const { container } = renderClip(true, 220);
    expect(container.querySelector('[data-director-thumb]')).toBeTruthy();
    expect(container.querySelector('[data-director-label-row]')).toBeTruthy();
    const label = container.querySelector('[data-director-clip-label]') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.textContent).toBe('片段 03 · 8s');
    expect(label.style.whiteSpace).toBe('nowrap');
    // 六态徽标缩为缩略框右上角角标（不再占用标签行）
    expect(container.querySelector('[data-clip-badge]')).toBeTruthy();
    expect(container.textContent).not.toContain('#3');
    expect(container.textContent).not.toContain('镜头号');
  });

  it('不传 directorLabel → 旧渲染不变（#号 + 状态文本 + 时长）', () => {
    const { container } = renderClip(undefined);
    expect(container.querySelector('[data-director-clip-label]')).toBeNull();
    expect(container.textContent).toContain('#3');
    expect(container.textContent).toContain('未生成');
    expect(container.textContent).toContain('8s');
  });
});

// ===== 3. WorkbenchMultiTrack =====

const track: WorkbenchTrack = {
  id: 'tr-1', name: '主轨', sourceChain: { origin: 'sb-1' }, status: 'active', order: 0, clips: [],
} as WorkbenchTrack;

const wbData = { status: 'ready', shots: [], totalDuration: 0, completedCount: 0 } as WorkbenchNodeData;

function timelineProps(): StoryboardTimelineProps {
  return {
    shots: [], activeShotId: null, pixelsPerSecond: 40,
    onPixelsPerSecondChange: () => {}, onSelectShot: () => {},
    onInsertAt: () => {}, onTrim: () => {}, onSplitShot: () => {}, onDeleteShot: () => {},
    t: ((k: string) => k) as never,
    theme, isDark: true,
  } as StoryboardTimelineProps;
}

function renderMultitrack(extra?: Partial<WorkbenchMultiTrackProps>) {
  return render(
    <WorkbenchMultiTrack
      tracks={[track]}
      data={wbData}
      focusedTrackId={null}
      onFocusTrack={() => {}}
      timeline={timelineProps()}
      {...extra}
    />,
  );
}

describe('workbench-multitrack：出片页零变化 + 导演台新 props', () => {
  it('不传新 props（出片页路径）→ 无 data-track-select-mode；分割按钮已整项删除（2026-11-05 调整）', () => {
    const { container } = renderMultitrack();
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect(container.querySelector('[data-continuity-mode]')).toBeNull();
    expect(container.querySelector('button[title="在播放头处分割选中片段"]')).toBeNull();
  });

  it('不传 clipChecks/contentOverlay（出片页路径）→ 渲染片段但无 [data-clip-check]/[data-continuity-arrow]', () => {
    const shots = [
      { id: 's1', number: 1, duration: 5, status: 'idle' },
      { id: 's2', number: 2, duration: 5, status: 'idle' },
    ] as StoryboardTimelineProps['shots'];
    const data = {
      status: 'ready',
      shots: [
        { id: 's1', number: 1, duration: 5, status: 'pending' },
        { id: 's2', number: 2, duration: 5, status: 'pending' },
      ],
      totalDuration: 10,
      completedCount: 0,
    } as unknown as WorkbenchNodeData;
    const { container } = render(
      <WorkbenchMultiTrack
        tracks={[track]}
        data={data}
        focusedTrackId={null}
        onFocusTrack={() => {}}
        timeline={{ ...timelineProps(), shots }}
      />,
    );
    expect(container.querySelectorAll('[data-clip-id]').length).toBe(2);
    expect(container.querySelectorAll('[data-clip-check]').length).toBe(0);
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(0);
  });

  it('第八条B：片段内勾选框整块移除——任何模式下 clip 内 [data-clip-check] 零渲染（残留 0）', () => {
    const shots = [
      { id: 's1', number: 1, duration: 5, status: 'idle' },
      { id: 's2', number: 2, duration: 5, status: 'idle' },
    ] as StoryboardTimelineProps['shots'];
    const data = {
      status: 'ready',
      shots: [
        { id: 's1', number: 1, duration: 5, status: 'pending' },
        { id: 's2', number: 2, duration: 5, status: 'pending' },
      ],
      totalDuration: 10,
      completedCount: 0,
    } as unknown as WorkbenchNodeData;
    const { container } = render(
      <WorkbenchMultiTrack
        tracks={[track]}
        data={data}
        focusedTrackId={null}
        onFocusTrack={() => {}}
        timeline={{ ...timelineProps(), shots }}
        batchEntry={{ active: true, onToggle: () => {} }}
        selectMode={{ kind: 'batch', count: 1, onDone: () => {}, onCancel: () => {} }}
      />,
    );
    expect(container.querySelectorAll('[data-clip-check]').length).toBe(0);
  });

  it('第七条B：添加/链接(段间衔接)/删除/批量 四按钮均为 图标+文字（非纯 icon），同基线高 25', () => {
    const { container } = renderMultitrack({
      continuityEntry: { active: false, onToggle: () => {} },
      batchEntry: { active: false, onToggle: () => {} },
    });
    const expectLabeled = (title: string, label: string) => {
      const btn = container.querySelector(`button[title="${title}"]`) as HTMLElement;
      expect(btn).toBeTruthy();
      expect(btn.querySelector('svg')).toBeTruthy(); // 图标
      const labelEl = btn.querySelector('[data-rail-label]');
      expect(labelEl?.textContent).toBe(label); // 文字
      expect(btn.style.height).toBe('25px');
      expect(btn.style.whiteSpace).toBe('nowrap'); // 不换行、不退化纯 icon
    };
    expectLabeled('在末尾添加新片段', '添加');
    expectLabeled('段间衔接', '链接');
    expectLabeled('删除选中片段', '删除');
    expectLabeled('批量运行（勾选片段）', '批量');
    // 批量按钮去重：导轨工具行内 [data-batch-mode] 唯一（重复入口已删除，非隐藏）
    expect(container.querySelectorAll('[data-batch-mode]').length).toBe(1);
  });

  it('工具行无重复入口：添加/链接/删除/批量 每个动作恰好一个可见按钮', () => {
    const { container } = renderMultitrack({
      continuityEntry: { active: false, onToggle: () => {} },
      batchEntry: { active: false, onToggle: () => {} },
    });
    expect(container.querySelectorAll('button[title="在末尾添加新片段"]').length).toBe(1);
    expect(container.querySelectorAll('[data-continuity-mode]').length).toBe(1);
    expect(container.querySelectorAll('button[title="删除选中片段"]').length).toBe(1);
    expect(container.querySelectorAll('[data-batch-mode]').length).toBe(1);
  });

  it('第八条A（2026-11-04 更新）：continuity 模式显示「已选 M/M」计数 + 全选/取消全选按钮（链接模式草稿语义；完成/取消同批量同一行）', () => {
    const onSelectAll = vi.fn();
    const { container } = renderMultitrack({
      continuityEntry: { active: true, onToggle: () => {} },
      selectMode: { kind: 'continuity', count: 1, total: 2, allSelected: false, onSelectAll, onDone: () => {}, onCancel: () => {} },
    });
    expect(container.querySelector('[data-track-select-mode="continuity"]')).toBeTruthy();
    // 计数 = 已选 M/M（2026-11-04 起链接模式也有计数；「已选 N 段」只服务批量）
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 1/2');
    const selectAllBtn = container.querySelector('[data-select-all]') as HTMLElement;
    expect(selectAllBtn).toBeTruthy();
    expect(selectAllBtn.textContent).toBe('全选');
    fireEvent.click(selectAllBtn);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-select-mode-done]')).toBeTruthy();
    expect(container.querySelector('[data-select-mode-done]')?.textContent).toBe('完成');
    expect(container.querySelector('[data-select-mode-cancel]')).toBeTruthy();
  });

  it('第八条A2（2026-11-04）：continuity 全选态按钮文案 = 「取消全选」；批量模式不渲染 [data-select-all]', () => {
    const { container, unmount } = renderMultitrack({
      continuityEntry: { active: true, onToggle: () => {} },
      selectMode: { kind: 'continuity', count: 2, total: 2, allSelected: true, onSelectAll: () => {}, onDone: () => {}, onCancel: () => {} },
    });
    expect(container.querySelector('[data-select-all]')?.textContent).toBe('取消全选');
    unmount();
    const { container: c2 } = renderMultitrack({
      selectMode: { kind: 'batch', count: 2, onDone: () => {}, onCancel: () => {} },
    });
    expect(c2.querySelector('[data-select-all]')).toBeNull();
    expect(c2.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 2 段');
    expect(c2.querySelector('[data-select-mode-done]')?.textContent).toBe('生成');
  });

  it('传 continuityEntry → 分割图标 title=「段间衔接」，点击回调 onToggle', () => {
    const onToggle = vi.fn();
    const { container } = renderMultitrack({ continuityEntry: { active: false, onToggle } });
    const btn = container.querySelector('[data-continuity-mode]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.title).toBe('段间衔接');
    expect(container.querySelector('button[title="在播放头处分割选中片段"]')).toBeNull();
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('传 selectMode → 完成/取消/已选计数与批量入口同一行（紧跟其后），普通工具行不让位', () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    const { container } = renderMultitrack({
      batchEntry: { active: true, onToggle: () => {} },
      selectMode: { kind: 'batch', count: 3, onDone, onCancel },
    });
    const bar = container.querySelector('[data-track-select-mode="batch"]') as HTMLElement;
    expect(bar).toBeTruthy();
    const batchBtn = container.querySelector('[data-batch-mode]') as HTMLElement;
    expect(batchBtn).toBeTruthy();
    // 与入口按钮同一行容器（紧跟批量按钮之后注入）
    expect(bar.parentElement).toBe(batchBtn.parentElement);
    expect(bar.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 3 段');
    // 工具行不让位：添加/删除按钮仍渲染（分割入口已于 2026-11-05 调整整项删除）
    expect(container.querySelector('button[title="在末尾添加新片段"]')).toBeTruthy();
    expect(container.querySelector('button[title="删除选中片段"]')).toBeTruthy();
    fireEvent.click(bar.querySelector('[data-select-mode-done]') as Element);
    expect(onDone).toHaveBeenCalledTimes(1);
    fireEvent.click(bar.querySelector('[data-select-mode-cancel]') as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('selectMode 键盘：Esc=取消、Enter=完成（与点击等价）；焦点在文本输入时不拦截', () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    renderMultitrack({ selectMode: { kind: 'batch', count: 1, onDone, onCancel } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDone).toHaveBeenCalledTimes(1);
    // 焦点在 INPUT/TEXTAREA/contentEditable 内时不拦截
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('模式关闭（selectMode 置空）→ 完成/取消/计数零渲染、不占位', () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    const { container, rerender } = renderMultitrack({
      selectMode: { kind: 'batch', count: 2, onDone, onCancel },
    });
    expect(container.querySelector('[data-track-select-mode]')).toBeTruthy();
    rerender(
      <WorkbenchMultiTrack
        tracks={[track]}
        data={wbData}
        focusedTrackId={null}
        onFocusTrack={() => {}}
        timeline={timelineProps()}
      />,
    );
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect(container.querySelector('[data-select-mode-count]')).toBeNull();
    expect(container.querySelector('[data-select-mode-done]')).toBeNull();
    expect(container.querySelector('[data-select-mode-cancel]')).toBeNull();
  });

  it('director-batch-panel 已删除：源文件不存在，旧简化面板 UI 零残留', () => {
    // 批量运行复用 dry-run 预检页后，DirectorBatchPanel 组件文件已删除（非隐藏糊过）。
    // 用文件系统存在性断言（写 import() 会在 vite import-analysis 阶段直接报错，等效证明模块已不存在）。
    expect(existsSync(new URL('../../canvas-tabs/director-batch-panel.tsx', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../../canvas-tabs/director-batch-panel.jsx', import.meta.url))).toBe(false);
  });
});
