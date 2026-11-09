/**
 * 导演台轨道真实渲染链验收（2026-11-04 收口轮：真实链渲染，不 mock 单组件自证）
 *
 * 真实链：WorkbenchTabContent → StoryboardMergedTab → WorkbenchMultiTrack →
 * StoryboardTimeline → TimelineClip 全部真实渲染；只 mock IO/存储层（platform/fs
 * 内存适配器）与重媒体组件（视频台/资产面板/授权图/胶片条/提示词面板）——timeline 组件一律不 mock。
 *
 * 本轮覆盖（2026-11-04 第四轮：拖拽实时预览 / 链接模式全选取消 / 文案微调）：
 * 1. 衔接 = 交界常显开关（2026-11-07 用户指令：链接/断链图标，点击直接切换）：每个交界渲染
 *    [data-continuity-arrow]（34×22 占位、深色胶囊），data-continuity-on=true 绿链接 / false 红断链；
 *    项目同款深色胶囊：半透明底 + 1px 细描边 + 圆角 5 + 阴影；glyph = 起点实心圆点 + 连接线 + 右向单箭头，
 *    stroke/fill #00c758、stroke-width 1.7、round），left=交界中心-17 / top=卡片垂直中心-11；第 1 段恒无、未开启零渲染；绿色拼合缝残留 = 0
 *    （clip 边框无 #00c758、圆角恒 4px）。
 *    1b. 选中态（2026-11-05 用户指令去绿色）= 中性亮描边（深 rgba(226,232,240,*) / 浅 rgba(68,64,60,*)），
 *    选中卡片/批量勾选块零命中 #00c758（绿色只保留给衔接箭头这一语义标记）。
 *    链接模式 = 草稿语义：进入快照 → 模式内改动只写草稿；「全选/取消全选」一键切换
 *    段 2..N 全部可衔接交界（计数 已选 M/M 同步）；「完成」/Enter 落盘、「取消」/Esc 回滚。
 * 2. 白色竖线移除 + 零基线对齐：轨道行 borderLeft 无 2px 白线/透明占位、margin '1px 0'；
 *    首片段 left === 刻度0 left === 0px；200% 缩放后 刻度5 left === 段2 left。
 * 3. 批量复用 dry-run 预检：[data-batch-mode] 唯一 → 模式条 + 轨道勾选块 →「生成」打开
 *    同一个 [data-director-dry-run] 预检；预检主按钮只写「确认运行」（无 dry-run 字样），
 *    dry-run 说明在正文信息条 [data-dry-run-note]；断开衔接显式列出（不改持久值）。
 * 4. 拖拽 = 实时预览重排（project-rules/specs/director-h3-workspace/drag-spec.md）：
 *    ≤4px 视为点击；>4px 启动浮层幽灵（translateX 跟手/scale/半透明/grabbing）；
 *    其余片段按预览顺序实时让位（transform delta，过渡 ~120ms），预览落位渲染整段
 *    占位框 [data-drop-placeholder]；预览跟手无 100ms 防抖；中点判定 ±8px 容差；
 *    原位（index === from / from+1）不提交；Esc 取消零残留；提交后顺序正确且残留 = 0；
 *    批量/衔接模式禁拖。旧 [data-drop-line] 插入线与 [data-drag-placeholder] 覆盖层零残留。
 * 5. 横向滚动条：[data-rail-scroll] overflowX auto + zx-timeline-scroll 细条样式；
 *    scrollLeft 1:1 同步刻度尺容器（[data-rail-ruler]）。
 * 6. 参数区 = 导轨工具行唯一一份：[data-params-run-row] 全 DOM 恰 1 个、位于工具行
 *    「批量」按钮右侧；比例/×系数/换算尺寸 chip/运行选中 四件套齐全；「运行选中」
 *    点击打开同一个 dry-run 预检；DirectorRunParamsRow 单测：比例切换/非法系数回退/
 *    禁用态 title。（提示词面板侧零渲染由 director-prompt-panel.test 保证。）
 * 7. 出片页零变化：不传新 props 的 WorkbenchMultiTrack 无任何新能力 DOM。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';
import { App as AntdApp } from 'antd';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      // 2026-11-05 六态徽标：与 i18next 实际签名一致 —— 第二参可传 { defaultValue } 选项对象
      const fb = typeof fallbackOrOpts === 'string'
        ? fallbackOrOpts
        : (fallbackOrOpts as { defaultValue?: string } | undefined)?.defaultValue;
      let s = fb ?? key;
      const merged = (typeof fallbackOrOpts === 'object' && fallbackOrOpts ? { ...fallbackOrOpts, ...(opts ?? {}) } : opts);
      if (merged) for (const [k, v] of Object.entries(merged)) s = s.replace(`{{${k}}}`, String(v));
      return s;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: ReactNode }) => children ?? null,
}));
const themeMode = vi.hoisted(() => ({ mode: 'dark' as 'dark' | 'light' }));
vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => themeMode.mode === 'light'
    ? {
        mode: 'light',
        theme: {
          mode: 'light',
          canvas: { background: '#ffffff' },
          toolbar: { panel: '#f8f8f8', text: '#1c1917', textMuted: '#57534e', accent: '#00c758' },
        },
      }
    : {
        mode: 'dark',
        theme: {
          mode: 'dark',
          canvas: { background: '#0b0b0c' },
          toolbar: { panel: '#17181a', text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6' },
        },
      },
}));

// 内存文件系统（唯一 mock 的 IO 层）
const memfs = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/platform/fs', () => ({
  readJson: async (p: string) => (memfs.has(p) ? (memfs.get(p) as never) : null),
  writeJson: async (p: string, v: unknown) => { memfs.set(p, v); },
  writeJsonIfUnchanged: async (p: string, v: unknown) => { memfs.set(p, v); },
  stat: async (p: string) => (memfs.has(p) ? { size: 1, lastModified: Date.now() } : null),
}));

// workbench-sync → storyboard-utils → @zeroexo/plugin-nodes（重链），stub 掉（非 timeline 组件）
vi.mock('@zeroexo/plugin-nodes', () => ({
  resolveContentUrl: () => null,
  useHydratedContent: () => ({ url: null }),
}));

// 平台媒体层：首帧 storageKey → 可渲染 URL（仅 frame-seg-1 命中，其余模拟文件缺失）
vi.mock('@/platform/media.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/media.js')>();
  return {
    ...actual,
    resolveMediaUrl: async (key?: string) => (key === 'frame-seg-1' ? 'blob:frame-seg-1' : ''),
  };
});

// 重媒体组件 stub（非 timeline 组件）
vi.mock('@/shared/components/authorized-media.js', () => ({
  AuthorizedImage: (p: { src?: string }) => createElement('img', { 'data-auth-img': true, 'data-auth-src': p.src }),
}));
vi.mock('@/features/canvas-nodes/storyboard/storyboard-clip-filmstrip', () => ({
  VideoFilmstrip: () => createElement('div', { 'data-mock-filmstrip': true }),
}));
vi.mock('@/features/canvas-nodes/storyboard/storyboard-asset-panel.js', () => ({
  StoryboardAssetPanel: () => createElement('div', { 'data-mock': 'asset-panel' }),
}));
vi.mock('@/features/canvas-nodes/storyboard/storyboard-video-stage.js', () => ({
  StoryboardVideoStage: (p: { paramsLabel?: string; videoStorageKey?: string; placeholderStatus?: string }) =>
    createElement('div', { 'data-mock': 'video-stage' },
      p.paramsLabel ? createElement('span', { 'data-params-label': '' }, p.paramsLabel) : null,
      /* 2026-11-05 220px 卡片验收：点击卡片 → 预览切换（有产物=可播 key，无产物=状态占位） */
      p.videoStorageKey ? createElement('span', { 'data-stage-video-key': '' }, p.videoStorageKey) : null,
      p.placeholderStatus ? createElement('span', { 'data-stage-status': '' }, p.placeholderStatus) : null),
}));

// 导演台面板 stub：参数行已搬走（面板侧零渲染由 director-prompt-panel.test 保证），本链只验导轨侧
vi.mock('./director-prompt-panel.jsx', () => ({
  DirectorPromptPanel: () => createElement('div', { 'data-mock': 'director-panel' }),
}));

import { useCanvasTabStore } from './canvas-tab-store';
import { useViewPrefsStore } from '@/shared/view-prefs';
import { WorkbenchTabContent, resolveClipStatus } from './workbench-tab-content';
import { WorkbenchMultiTrack } from '@/features/canvas-nodes/storyboard/workbench-multitrack';
import { TimelineClip } from '@/features/canvas-nodes/storyboard/timeline-clip';
import { pickDirectorCardWidth, directorCardHeight, DIRECTOR_RAIL_HEIGHT, DIRECTOR_ARROW_SIZE, directorRailTone, directorBadgeTone } from '@/features/canvas-nodes/storyboard/timeline-constants';
import { WORKSPACE_SURFACE_RADIUS } from '@/shared/components/LAYOUT_CONSTANTS';
import { DirectorParamsButton, DirectorParamsPanel, DirectorRunButton } from './director-run-params-row';
import type { WorkbenchSharedParams } from '@/entities/slot-containers';
import type { StoryboardTimelineProps } from '@/features/canvas-nodes/storyboard/storyboard-timeline';
import type { WorkbenchNodeData, WorkbenchTrack } from '@/features/canvas-nodes/storyboard/workbench-types';

const theme = {
  canvas: { background: '#0b0b0c' },
  toolbar: { text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6' },
} as never;

const ARROW_GREEN = 'rgb(0, 199, 88)'; // #00c758（只许出现在衔接箭头上）

function seedWorkbench(): void {
  memfs.set('projects/p-track/entities/workbench.json', {
    schemaVersion: 1,
    version: 1,
    title: '导演台',
    tracks: [],
    shots: [
      { id: 'seg-1', number: 1, description: '', shotType: '', duration: 5, imagePrompt: '', status: 'pending', clipState: 'placeholder' },
      // 段2 勾上段间衔接 → 段1/段2 交界渲染 ComfyUI 同款箭头
      { id: 'seg-2', number: 2, description: '', shotType: '', duration: 5, imagePrompt: '', status: 'pending', clipState: 'placeholder', continuation: { enabled: true } },
      // 段3 显式关闭 → 段2/段3 交界零渲染
      { id: 'seg-3', number: 3, description: '', shotType: '', duration: 5, imagePrompt: '', status: 'pending', clipState: 'placeholder', continuation: { enabled: false } },
    ],
    totalDuration: 15,
    updatedAt: new Date().toISOString(),
  });
}

async function renderWorkbench() {
  seedWorkbench();
  useCanvasTabStore.setState({
    slotBindings: { script: 'p-track', storyboard: null, workbench: null },
    activeTabKey: 'workbench',
  });
  const utils = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
  // 真实链就绪：3 个 clip 元素渲染出来
  await waitFor(() => expect(utils.container.querySelectorAll('[data-clip-id]').length).toBe(3));
  return utils;
}

/** jsdom 无 PointerEvent → 用 MouseEvent 派发 pointerdown/up（e.button 归一化为 0） */
const clickClip = (el: HTMLElement, x: number) => {
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x }));
  fireEvent(el, new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: x }));
};

/** 2026-11-05 六态徽标：t(key, { defaultValue }) 测试桩 —— 与 i18next 实际签名一致（string 兜底两兼容） */
const tStub = (k: string, fb?: string | Record<string, unknown>): string => {
  const s = typeof fb === 'string' ? fb : ((fb as { defaultValue?: string } | undefined)?.defaultValue ?? k);
  const opts = typeof fb === 'object' && fb ? fb as Record<string, unknown> : undefined;
  if (!opts) return s;
  return Object.entries(opts).reduce((acc, [key, value]) => (key === 'defaultValue' ? acc : acc.replace(`{{${key}}}`, String(value))), s);
};

/** 轨道行（滚动容器内第一个子元素 = 唯一轨道行；导演台无播放头竖线） */
const trackRowOf = (container: HTMLElement) =>
  container.querySelector('[data-rail-scroll]')!.firstElementChild as HTMLElement;

/** DOM 顺序（data-clip-id 数组） */
const orderOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-clip-id]')).map((el) => el.getAttribute('data-clip-id'));

beforeEach(() => {
  memfs.clear();
  themeMode.mode = 'dark';
  useCanvasTabStore.setState({
    tabs: [],
    activeTabKey: 'canvas',
    slotOrder: ['script', 'storyboard', 'workbench', 'canvas'],
    slotBindings: { script: null, storyboard: null, workbench: null },
  });
  // pps 固定 40（真实 view-prefs store，避免 localStorage 残留影响 left 断言）
  useViewPrefsStore.setState({ workbench: { pixelsPerSecond: 40 } });
});

// ===== 1. 衔接 = ComfyUI 导演台同款箭头（绿色拼合缝残留 = 0）=====

describe('衔接视觉 = 链接/断链图标（2026-11-07 用户指令）', () => {
  it('每个交界常显一枚开关：开启=绿色链接、断开=红色断链；34×22 胶囊、点击即切换；第 1 段恒无；clip 绿缝残留 = 0', async () => {
    const { container } = await renderWorkbench();

    // 段 2/段 3 两个交界都渲染开关（开启与断开都可见，靠状态区分）
    const arrows = container.querySelectorAll('[data-continuity-arrow]');
    expect(arrows.length).toBe(2);
    expect(container.querySelector('[data-director-continuity-overlay]')).toBeTruthy();
    expect(container.querySelector('[data-continuity-arrow="seg-1"]')).toBeNull(); // 第 1 段恒无

    // 2026-11-05 放大尺寸：34×22 占位 + 间隙中心 + 卡片垂直中心
    const arrow = container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement;
    expect(arrow.style.width).toBe('34px');
    expect(arrow.style.height).toBe('22px');
    expect(arrow.style.background).not.toBe('');
    expect(arrow.style.borderWidth).toBe('1px');
    expect(arrow.style.borderRadius).toBe('5px');
    expect(arrow.style.boxSizing).toBe('border-box');
    expect(arrow.style.pointerEvents).toBe('auto');
    expect(arrow.style.opacity).toBe('0.86');
    // 220+6 间距：间隙中心 = 1×226−3 → left = 223−17；卡片高 168、top=7+84−11=80
    expect(arrow.style.left).toBe('206px');
    expect(arrow.style.top).toBe('80px');
    // 开启态 = 绿色链接图标 + 点击后断开
    expect(arrow.getAttribute('data-continuity-on')).toBe('true');
    expect(arrow.title).toBe('断开衔接');
    expect(arrow.querySelector('svg')?.getAttribute('class')).toContain('lucide-link2');
    expect(arrow.style.color).toBe('rgb(0, 199, 88)');

    // 断开态 = 红色断链图标 + 点击后开启
    const offArrow = container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement;
    expect(offArrow.getAttribute('data-continuity-on')).toBe('false');
    expect(offArrow.title).toBe('开启衔接');
    expect(offArrow.querySelector('svg')?.getAttribute('class')).toContain('lucide-link2-off');
    expect(offArrow.style.color).toBe('rgb(239, 68, 68)');

    // 点击图标本身 = 切换（段 2 开 → 关）
    fireEvent.click(arrow);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).title).toBe('开启衔接');
    // 再点一次恢复
    fireEvent.click(container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');

    // 绿色拼合缝残留 = 0：所有片段边框无 #00c758、圆角 = 画布同源 WORKSPACE_SURFACE_RADIUS（2026-11-07）
    const clip1 = container.querySelector('[data-clip-id="seg-1"]') as HTMLElement;
    const clip2 = container.querySelector('[data-clip-id="seg-2"]') as HTMLElement;
    const clip3 = container.querySelector('[data-clip-id="seg-3"]') as HTMLElement;
    for (const c of [clip1, clip2, clip3]) {
      expect(c.style.borderLeftColor).not.toBe(ARROW_GREEN);
      expect(c.style.borderRightColor).not.toBe(ARROW_GREEN);
      expect(c.style.borderRadius).toBe(`${WORKSPACE_SURFACE_RADIUS}px`);
    }

    // 2026-11-05 固定宽度片段卡片（220px 基准修订）：等宽卡片 220px、间距 6px（left = 下标×226），不随时长/缩放变化
    expect(clip1.style.left).toBe('0px');
    expect(clip2.style.left).toBe('226px');
    expect(clip3.style.left).toBe('452px');
    for (const c of [clip1, clip2, clip3]) expect(c.style.width).toBe('220px');
  });

  it('链接模式内点击片段 = 切换衔接状态（段1 恒无）；完成退出后持久态保留；全程绿缝 = 0', async () => {
    const { container } = await renderWorkbench();
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    expect(container.querySelector('[data-track-select-mode="continuity"]')).toBeTruthy();

    // 关：点 seg-2 → 图标仍在，但状态变断开（红色断链，不是消失）
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 100);
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(2);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');

    // 段1（无前序）点击不生效
    clickClip(container.querySelector('[data-clip-id="seg-1"]') as HTMLElement, 20);
    expect(container.querySelector('[data-continuity-arrow="seg-1"]')).toBeNull();

    // 再开：点 seg-2 → 链接图标恢复
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 100);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');

    // 全程无绿缝：圆角 = 画布同源半径、边框无绿
    for (const id of ['seg-1', 'seg-2', 'seg-3']) {
      const c = container.querySelector(`[data-clip-id="${id}"]`) as HTMLElement;
      expect(c.style.borderRadius).toBe(`${WORKSPACE_SURFACE_RADIUS}px`);
      expect(c.style.borderLeftColor).not.toBe(ARROW_GREEN);
      expect(c.style.borderRightColor).not.toBe(ARROW_GREEN);
    }

    // 「完成」退出 → 持久态保留（段2 仍为开启）
    fireEvent.click(container.querySelector('[data-select-mode-done]') as Element);
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
  });

  it('链接模式「全选/取消全选」：一键切换段 2..N 全部可衔接交界（段1 恒不可选），计数 已选 M/M 同步；「完成」落盘后状态保留', async () => {
    const { container } = await renderWorkbench();
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    expect(container.querySelector('[data-track-select-mode="continuity"]')).toBeTruthy();
    // 进入即有 全选/取消/完成 三动作（初始：段2 开、段3 关 → 已选 1/2）
    const selectAllBtn = container.querySelector('[data-select-all]') as HTMLElement;
    expect(selectAllBtn).toBeTruthy();
    expect(selectAllBtn.textContent).toBe('全选');
    expect(container.querySelector('[data-select-mode-cancel]')?.textContent).toBe('取消');
    expect(container.querySelector('[data-select-mode-done]')?.textContent).toBe('完成');
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 1/2');

    // 全选 → 段2/段3 交界都开启（段1 恒无），计数 2/2，按钮变为「取消全选」
    fireEvent.click(selectAllBtn);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 2/2');
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(2);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
    expect((container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
    expect(container.querySelector('[data-continuity-arrow="seg-1"]')).toBeNull(); // 段1 恒不可选
    expect((container.querySelector('[data-select-all]') as HTMLElement).textContent).toBe('取消全选');

    // 全选后单独取消段2 → 计数同步回退、全选按钮恢复可点态
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 250);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 1/2');
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');
    expect((container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
    expect((container.querySelector('[data-select-all]') as HTMLElement).textContent).toBe('全选');

    // 取消全选（先全选再点）→ 全部清空（图标仍在，状态全断开）
    fireEvent.click(container.querySelector('[data-select-all]') as Element);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 2/2');
    fireEvent.click(container.querySelector('[data-select-all]') as Element);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 0/2');
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(2);
    expect(container.querySelectorAll('[data-continuity-on="true"]').length).toBe(0);

    // 再全选 → 「完成」落盘：退出后图标按最终结果渲染、重进模式计数 = 2/2
    fireEvent.click(container.querySelector('[data-select-all]') as Element);
    fireEvent.click(container.querySelector('[data-select-mode-done]') as Element);
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect(container.querySelectorAll('[data-continuity-on="true"]').length).toBe(2);
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 2/2');
    // 收尾：取消退出（回到持久态，不影响后续用例种子）
    fireEvent.click(container.querySelector('[data-select-mode-cancel]') as Element);
  });

  it('链接模式「取消」= 回滚：模式内改动不生效，退出后持久值/渲染与进入前一致；Esc 同取消、Enter 同完成', async () => {
    const { container } = await renderWorkbench();
    // 进入前持久态：段2 开、段3 关（两个图标、状态不同）
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(2);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
    expect((container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');

    // 取消回滚：全选后点「取消」→ 恢复进入前状态
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    fireEvent.click(container.querySelector('[data-select-all]') as Element);
    expect(container.querySelectorAll('[data-continuity-on="true"]').length).toBe(2); // 草稿态
    fireEvent.click(container.querySelector('[data-select-mode-cancel]') as Element);
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    // 回滚生效：渲染与进入前一致（段3 回到断开）
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('true');
    expect((container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');

    // Esc 同取消
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    fireEvent.click(container.querySelector('[data-select-all]') as Element);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect((container.querySelector('[data-continuity-arrow="seg-3"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');

    // Enter 同完成：草稿落盘（取消 seg-2 → 提交后段2 保持断开且重进不恢复）
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 250);
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).getAttribute('data-continuity-on')).toBe('false');
    fireEvent.click(container.querySelector('[data-continuity-mode]') as HTMLButtonElement);
    expect(container.querySelector('[data-select-mode-count]')?.textContent).toBe('已选 0/2');
    // 收尾：取消退出（草稿丢弃，持久态保持 seg-2 关）
    fireEvent.click(container.querySelector('[data-select-mode-cancel]') as Element);
  });

  it('2026-11-05 固定宽度卡片：卡片/箭头不随 pps 变化（pps=80 几何不变）；刻度尺零渲染（随卡片决策删除）', async () => {
    useViewPrefsStore.setState({ workbench: { pixelsPerSecond: 80 } });
    const { container } = await renderWorkbench();
    const arrow = container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement;
    expect(arrow.style.left).toBe('206px');
    expect(arrow.style.width).toBe('34px');
    expect(arrow.style.pointerEvents).toBe('auto');
    expect(arrow.style.background).not.toBe(''); // 2026-11-06 胶囊底
    // 卡片几何不随缩放变化：等宽 220px、left = 下标×226
    expect((container.querySelector('[data-clip-id="seg-2"]') as HTMLElement).style.left).toBe('226px');
    expect((container.querySelector('[data-clip-id="seg-2"]') as HTMLElement).style.width).toBe('220px');
    // 刻度尺已按决策删除：ruler 容器与刻度 tick 零渲染
    expect(container.querySelector('[data-rail-ruler]')).toBeNull();
    expect(container.querySelectorAll('[data-ruler-tick]').length).toBe(0);
  });
});

// ===== 2. 白色竖线移除 + 片段与刻度 0 对齐（零基线）=====

describe('导轨白色竖线移除 + 零基线对齐', () => {
  it('轨道行无 2px 竖线/透明占位（borderLeft 非 solid、宽度非 2px）、margin=1px 0；首片段 left=刻度0 left=0px；无左 padding 占位', async () => {
    const { container } = await renderWorkbench();
    const row = trackRowOf(container);
    expect(row.style.borderLeftStyle).not.toBe('solid');
    expect(row.style.borderLeftWidth).not.toBe('2px');
    expect(row.style.borderLeftColor).not.toBe('rgb(242, 243, 244)');
    expect(row.style.margin).toBe('1px 0px');

    // 首个片段左缘 = 零基线（同一坐标系，0 偏差）；中间无 padding/gap/占位列
    // 2026-11-05 固定宽度卡片：刻度尺已删，无 tick 可对齐，断言零渲染
    expect(container.querySelector('[data-rail-ruler]')).toBeNull();
    expect((container.querySelector('[data-clip-id="seg-1"]') as HTMLElement).style.left).toBe('0px');
    expect((container.querySelector('[data-timeline-body]') as HTMLElement).style.paddingLeft).toBe('0px');
  });

  it('2026-11-05 固定宽度卡片：pps=80 下几何不变（卡片仍零基线、等宽 220px、间距 6px）', async () => {
    useViewPrefsStore.setState({ workbench: { pixelsPerSecond: 80 } });
    const { container } = await renderWorkbench();
    expect((container.querySelector('[data-clip-id="seg-1"]') as HTMLElement).style.left).toBe('0px');
    expect((container.querySelector('[data-clip-id="seg-2"]') as HTMLElement).style.left).toBe('226px');
    expect((container.querySelector('[data-clip-id="seg-2"]') as HTMLElement).style.width).toBe('220px');
  });
});

// ===== 3. 批量运行 = 复用 dry-run 预检（无第二套面板）=====

describe('批量运行界面 = 复用现有 dry-run 预检', () => {
  it('统一生成入口：导轨无批量按钮，「运行」打开片段选择面板；确认后进入全页唯一的预检', async () => {
    const { container } = await renderWorkbench();

    // 2026-11-07 用户指令：批量按钮下线，所有生成走「运行」→ 片段选择面板
    expect(container.querySelectorAll('[data-batch-mode]').length).toBe(0);
    expect(container.querySelectorAll('[data-run-all]').length).toBe(0);
    expect(container.querySelectorAll('[data-run-selected]').length).toBe(1);

    fireEvent.click(container.querySelector('[data-run-selected]') as HTMLElement);
    const picker = await waitFor(() => {
      const el = Array.from(document.querySelectorAll('.ant-modal'))
        .find((m) => (m.textContent ?? '').includes('选择要生成的片段')) as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    // 三个片段各一个勾选框，默认只勾当前片段
    expect(picker.querySelectorAll('input[type="checkbox"]').length).toBe(3);

    const confirmBtn = Array.from(picker.querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').startsWith('确认')) as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(document.querySelector('[data-director-dry-run]')).toBeTruthy());
    expect(document.querySelectorAll('[data-director-dry-run]').length).toBe(1);
    const dryRun = document.querySelector('[data-director-dry-run]') as HTMLElement;
    const note = dryRun.querySelector('[data-dry-run-note]') as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('ComfyUI 真实生成');
  });

  it('片段选择面板：全选 → 预检按时间线列出全部片段；返回后导轨数据不变', async () => {
    const { container } = await renderWorkbench();
    fireEvent.click(container.querySelector('[data-run-selected]') as HTMLElement);
    const allBtn = await waitFor(() => {
      // antd 双字中文按钮会自动插入空格（「全 选」），比较前先去掉空白
      const btn = Array.from(document.querySelectorAll('.ant-modal button'))
        .find((b) => (b.textContent ?? '').replace(/\s/g, '') === '全选') as HTMLElement;
      expect(btn).toBeTruthy();
      return btn;
    });
    fireEvent.click(allBtn);
    const confirmBtn = await waitFor(() => {
      const btn = Array.from(document.querySelectorAll('.ant-modal button'))
        .find((b) => (b.textContent ?? '').startsWith('确认')) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      return btn;
    });
    fireEvent.click(confirmBtn);

    const dryRun = await waitFor(() => {
      const el = document.querySelector('[data-director-dry-run]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    const rows = Array.from(dryRun.querySelectorAll('[data-dry-run-segment]'));
    expect(rows.length).toBe(3);
    expect(rows[0]!.textContent).toContain('片段 1');
    expect(rows[2]!.textContent).toContain('片段 3');

    // 返回 → 导轨片段一个不少（jsdom 下 antd Modal 退场动画不销毁 DOM，不断言节点移除）
    fireEvent.click(document.querySelector('[data-dry-run-cancel]') as Element);
    expect(container.querySelectorAll('[data-clip-id]').length).toBe(3);
  });

  it('片段选择面板：全不选时「确认」禁用，不会打开预检', async () => {
    const { container } = await renderWorkbench();
    fireEvent.click(container.querySelector('[data-run-selected]') as HTMLElement);
    const noneBtn = await waitFor(() => {
      const btn = Array.from(document.querySelectorAll('.ant-modal button'))
        .find((b) => b.textContent === '全不选') as HTMLElement;
      expect(btn).toBeTruthy();
      return btn;
    });
    fireEvent.click(noneBtn);
    await waitFor(() => {
      const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button'))
        .find((b) => (b.textContent ?? '').startsWith('确认')) as HTMLButtonElement;
      expect(confirmBtn?.disabled).toBe(true);
    });
    expect(document.querySelector('[data-director-dry-run]')).toBeNull();
  });
});

// ===== 4. 拖拽 = 实时预览重排（drag-spec.md：幽灵跟手 + 实时让位 + 整段占位框）=====

describe('拖拽 = 实时预览重排（拖动中呈现 = 松手后排列）', () => {
  let rectSpy: ReturnType<typeof vi.spyOn> | null = null;

  /** jsdom 无真实布局（getBoundingClientRect 全 0 会被 trim 排除拦截）→ 统一 stub 超大矩形 */
  const stubRects = () => {
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100000, bottom: 56, width: 100000, height: 56, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
  };
  const pdown = (el: Element, x: number) =>
    fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x }));
  const pmove = (x: number) =>
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientX: x }));
  const pup = (x: number) =>
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: x }));
  const clipOf = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-clip-id="${id}"]`) as HTMLElement;

  afterEach(() => {
    rectSpy?.mockRestore();
    rectSpy = null;
  });

  it('>4px 启动浮层幽灵（跟手/scale/半透明/grabbing）；其余片段按预览顺序实时让位（无 100ms 防抖）；占位框 = 预览落位；松手提交唯一一次 → 顺序 = 预览顺序、残留 = 0；旧插入线零残留', async () => {
    const { container } = await renderWorkbench();
    stubRects();
    const clip1 = clipOf(container, 'seg-1');

    // 记录拖拽前几何（2026-11-05 固定宽度卡片 220px 基准：等宽 220px、间距 6px）
    const before = ['seg-1', 'seg-2', 'seg-3'].map((id) => {
      const el = clipOf(container, id);
      return `${el.style.left}x${el.style.width}`;
    });
    expect(before).toEqual(['0pxx220px', '226pxx220px', '452pxx220px']);

    // ≤4px：仍是点击，无幽灵、无占位
    pdown(clip1, 50);
    pmove(53);
    expect(container.querySelector('[data-drop-placeholder]')).toBeNull();
    expect(clipOf(container, 'seg-1').style.transform).toBe('none');

    // dx=8 >4：启动 —— 幽灵跟手（translateX(8px) scale(1.04)、半透明、grabbing、zIndex 10）
    pmove(58);
    const ghost = clipOf(container, 'seg-1');
    expect(ghost.style.transform).toBe('translateX(8px) scale(1.04)');
    expect(ghost.style.opacity).toBe('0.7');
    expect(ghost.style.zIndex).toBe('10');
    expect(ghost.style.cursor).toBe('grabbing');
    // 预览落位 = 整段占位框（原位缝，宽=卡片宽），不是 2px 插入线
    const slot0 = container.querySelector('[data-drop-placeholder]') as HTMLElement;
    expect(slot0).toBeTruthy();
    expect(slot0.style.left).toBe('0px');
    expect(slot0.style.width).toBe('220px');
    // 旧 [data-drop-line] / [data-drag-placeholder] 零残留
    expect(container.querySelectorAll('[data-drop-line]').length).toBe(0);
    expect(container.querySelectorAll('[data-drag-placeholder]').length).toBe(0);
    expect(container.querySelectorAll('[data-drop-hover]').length).toBe(0);

    // 预览跟手（无 100ms 防抖）：一次 pmove 到段3 左半（卡片 [452,672] 中点 562 内）→ 让位立即发生
    pmove(500);
    // 占位框移到预览落位（预览序 [seg-2, seg-1, seg-3] → 段2 让位到 0，占位在 226）
    const slot1 = container.querySelector('[data-drop-placeholder]') as HTMLElement;
    expect(slot1.style.left).toBe('226px');
    expect(slot1.style.width).toBe('220px');
    // 实时让位：seg-2 被推到自己预览位（delta -226），seg-3 不动（delta 0）
    expect(clipOf(container, 'seg-2').style.transform).toBe('translateX(-226px)');
    expect(clipOf(container, 'seg-3').style.transform).toBe('none');
    // 幽灵持续跟手（dx=450）
    expect(clipOf(container, 'seg-1').style.transform).toBe('translateX(450px) scale(1.04)');
    // 有效视觉位置 = 预览排列：left+让位/跟手位移 → [seg-2@0, seg-1@226(跟手中), seg-3@452]
    // （left 属性本身不变 —— 让位走 transform，规格#11）
    const during = ['seg-1', 'seg-2', 'seg-3'].map((id) => {
      const el = clipOf(container, id);
      return `${el.style.left}x${el.style.width}`;
    });
    expect(during).toEqual(before);

    // 松手 = 提交当前预览顺序唯一一次（落点 === 预览位置）→ [seg-2, seg-1, seg-3]
    pup(500);
    await waitFor(() => expect(orderOf(container)).toEqual(['seg-2', 'seg-1', 'seg-3']));
    // 重排后几何仍 = 等宽卡片按间距铺排
    expect(clipOf(container, 'seg-2').style.left).toBe('0px');
    expect(clipOf(container, 'seg-1').style.left).toBe('226px');
    // 残留 = 0：无占位框、无幽灵态、光标恢复
    expect(container.querySelectorAll('[data-drop-placeholder]').length).toBe(0);
    expect(clipOf(container, 'seg-1').style.transform).toBe('none');
    expect(clipOf(container, 'seg-1').style.opacity).toBe('1');
    expect(document.body.style.cursor).toBe('');
  });

  it('≤4px 松手 = 点击（不启动拖拽、不提交、顺序不变、零预览残留）', async () => {
    const { container } = await renderWorkbench();
    stubRects();
    const clip1 = clipOf(container, 'seg-1');
    pdown(clip1, 50);
    pmove(53);
    pup(53);
    expect(container.querySelectorAll('[data-drop-placeholder]').length).toBe(0);
    expect(orderOf(container)).toEqual(['seg-1', 'seg-2', 'seg-3']);
  });

  it('原位落点（index === from+1）不提交：占位框可回原位缝，松手顺序不变、残留 = 0', async () => {
    const { container } = await renderWorkbench();
    stubRects();
    const clip1 = clipOf(container, 'seg-1');
    pdown(clip1, 50);
    pmove(58); // 启动
    pmove(280); // 段2 卡片 [226,446] 左半（中点 336 内）→ 落点 1（= from+1，原位）
    // 预览序 = 原序：占位框回 0，无让位
    const slot = container.querySelector('[data-drop-placeholder]') as HTMLElement;
    expect(slot.style.left).toBe('0px');
    expect(clipOf(container, 'seg-2').style.transform).toBe('none');
    pup(280);
    expect(orderOf(container)).toEqual(['seg-1', 'seg-2', 'seg-3']);
    expect(container.querySelectorAll('[data-drop-placeholder]').length).toBe(0);
  });

  it('Esc = 取消并恢复原顺序：让位/幽灵/占位即刻清零、不提交、残留 = 0', async () => {
    const { container } = await renderWorkbench();
    stubRects();
    const clip1 = clipOf(container, 'seg-1');
    pdown(clip1, 50);
    pmove(58);
    pmove(500); // 预览序 [seg-2, seg-1, seg-3]
    expect((container.querySelector('[data-drop-placeholder]') as HTMLElement).style.left).toBe('226px');
    expect(clipOf(container, 'seg-2').style.transform).toBe('translateX(-226px)');
    fireEvent.keyDown(window, { key: 'Escape' });
    // 即刻清零：占位/让位/幽灵全撤，顺序不变
    expect(container.querySelectorAll('[data-drop-placeholder]').length).toBe(0);
    expect(clipOf(container, 'seg-2').style.transform).toBe('none');
    expect(clipOf(container, 'seg-1').style.transform).toBe('none');
    expect(orderOf(container)).toEqual(['seg-1', 'seg-2', 'seg-3']);
    expect(document.body.style.cursor).toBe('');
  });

  it('片段选择面板打开期间，导轨顺序稳定（弹层不改变片段排列）', async () => {
    const { container } = await renderWorkbench();
    fireEvent.click(container.querySelector('[data-run-selected]') as HTMLElement);
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll('.ant-modal'))
        .some((el) => (el.textContent ?? '').includes('选择要生成的片段'))).toBe(true));
    expect(orderOf(container)).toEqual(['seg-1', 'seg-2', 'seg-3']);
    const cancelBtn = Array.from(document.querySelectorAll('.ant-modal button'))
      .find((b) => (b.textContent ?? '').replace(/\s/g, '') === '取消') as HTMLElement;
    fireEvent.click(cancelBtn);
    expect(orderOf(container)).toEqual(['seg-1', 'seg-2', 'seg-3']);
  });
});

// ===== 5. 横向滚动条（同一 scroll 容器，刻度尺 1:1 同步）=====

describe('导轨横向滚动条 = 有（轨道区底部同一 scroll 容器）', () => {
  it('[data-rail-scroll] overflowX=auto + 细条样式类；2026-11-05 卡片导轨：刻度尺零渲染、滚动不报错；导演台无播放头竖线（白色竖线零残留）', async () => {
    const { container } = await renderWorkbench();
    const rail = container.querySelector('[data-rail-scroll]') as HTMLElement;
    expect(rail).toBeTruthy();
    expect(rail.style.overflowX).toBe('auto');
    expect(rail.className).toContain('zx-timeline-scroll');

    // 2026-11-05 固定宽度卡片（约定）：刻度尺/播放头随卡片化删除 → ruler 容器零渲染
    expect(container.querySelector('[data-rail-ruler]')).toBeNull();
    // 卡片导轨下滚动只作用于轨道区自身，无刻度同步对象 → 滚动不报错即可
    rail.scrollLeft = 120;
    fireEvent.scroll(rail);
    rail.scrollLeft = 0;
    fireEvent.scroll(rail);

    // 滚回最左：首卡片仍在零基线
    expect((container.querySelector('[data-clip-id="seg-1"]') as HTMLElement).style.left).toBe('0px');
  });
});

// ===== 6. 参数 = 合并进「参数」按钮；运行按钮 = 运行（批量同组）；预览区文字标签 =====

describe('参数 = 合并进「参数」按钮（裸控件 0）；运行按钮 = 运行；预览标签实时同步', () => {
  it('「参数」唯一且面板含比例/×系数/尺寸 chip；导轨裸控件 = 0；工具行顺序 = 添加/链接/删除/参数/批量/运行（批量紧邻运行左侧，高均 25）；参数按钮无边框无描边；预览标签随参数实时联动；「运行」打开同一个 dry-run 预检', async () => {
    const { container } = await renderWorkbench();

    // 唯一性 + 旧标记/裸控件零残留（比例下拉/系数输入/尺寸 chip 不直接出现在导轨工具行）
    expect(container.querySelectorAll('[data-params-trigger]').length).toBe(1);
    expect(container.querySelectorAll('[data-params-run-row]').length).toBe(0);
    expect(container.querySelectorAll('[data-params-run-group]').length).toBe(0);
    // 2026-11-05 卡片导轨：刻度尺已删 → 工具行 = [data-rail-scroll] 的前一个兄弟节点
    const toolbar = container.querySelector('[data-rail-scroll]')!.previousElementSibling as HTMLElement;
    expect(toolbar.querySelectorAll('[data-param-key]').length).toBe(0);
    expect(toolbar.querySelectorAll('[data-resolved-size]').length).toBe(0);

    // 2026-11-07：批量按钮下线 —— 顺序 添加/链接/删除/参数/运行
    const paramsBtn = container.querySelector('[data-params-trigger]') as HTMLElement;
    const runBtn = container.querySelector('[data-run-selected]') as HTMLButtonElement;
    const deleteBtn = Array.from(toolbar.querySelectorAll('button'))
      .find((b) => (b as HTMLButtonElement).title === '删除选中片段') as HTMLElement;
    expect(container.querySelectorAll('[data-batch-mode]').length).toBe(0);
    expect(toolbar.contains(paramsBtn)).toBe(true);
    expect(toolbar.contains(runBtn)).toBe(true);
    expect(deleteBtn.compareDocumentPosition(paramsBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(paramsBtn.compareDocumentPosition(runBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 2026-11-05 二调：「参数」按钮无边框无描边（border/outline/描边 box-shadow 全 0），
    // hover/激活只靠背景色（CSS 规则在组件 <style> 内，此处断言内联基线 + 无 solid 边框）
    expect(paramsBtn.style.border).not.toContain('solid');
    expect(paramsBtn.style.outline).toBe('none');
    expect(paramsBtn.style.boxShadow).toBe('none');
    expect(getComputedStyle(paramsBtn).borderTopWidth).toBe('0px');

    // 「运行」按钮：文案 = 运行（不是「运行选中」）、与「参数」同高 25、默认可用（选中段1）
    expect(runBtn.textContent).toBe('运行');
    expect(runBtn.style.height).toBe('25px');
    expect(paramsBtn.style.height).toBe('25px');
    expect(runBtn.disabled).toBe(false);

    // 预览区文字标签：在预览区内、初始 = 公共参数 16:9 · 864×480、不参与点击（aria-hidden 只读文本）
    const stage = container.querySelector('[data-mock="video-stage"]') as HTMLElement;
    const label = stage.querySelector('[data-params-label]') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.textContent).toBe('16:9 · 864×480');
    expect(label.tagName).toBe('SPAN');

    // 点开「参数」→ 浮层面板含三类控件（比例下拉 / ×系数输入 / 换算尺寸只读 chip）
    fireEvent.click(paramsBtn);
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-params-panel]') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(panel.querySelector('[data-aspect-picker]')).toBeTruthy();
    expect(panel.querySelector('[data-aspect-option="16:9"]')).toBeTruthy();
    expect(panel.querySelector('[data-param-key="scaleFactor"]')).toBeTruthy();
    expect((panel.querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('864×480');

    // 面板改比例 16:9 → 9:16：chip 与预览标签实时联动
    fireEvent.click(panel.querySelector('[data-aspect-option="9:16"]') as Element);
    await waitFor(() =>
      expect((document.querySelector('[data-params-panel] [data-resolved-size]') as HTMLElement).textContent).toBe('480×864'));
    await waitFor(() =>
      expect((container.querySelector('[data-params-label]') as HTMLElement).textContent).toBe('9:16 · 480×864'));

    // 「运行」→ 打开片段选择面板（2026-11-07 统一生成入口），确认后才进预检
    fireEvent.click(runBtn);
    await waitFor(() =>
      expect(Array.from(document.querySelectorAll('.ant-modal'))
        .some((el) => (el.textContent ?? '').includes('选择要生成的片段'))).toBe(true));
    expect(document.querySelector('[data-director-dry-run]')).toBeNull();
  });
});

describe('DirectorParamsButton/RunButton/Panel 单测（比例/系数/运行链路未退化）', () => {
  const baseShared = { enabled: false, assets: [], presetId: 'h3', params: {} as Record<string, unknown> };

  function renderGroup(params: Record<string, unknown> = {}) {
    const onSharedChange = vi.fn();
    const onRun = vi.fn();
    function Harness() {
      const [shared, setShared] = useState({ ...baseShared, params } as unknown as WorkbenchSharedParams);
      return (
        <>
          <DirectorParamsButton
            shared={shared}
            onSharedChange={(patch) => {
              onSharedChange(patch);
              setShared((s) => ({ ...s, ...patch }));
            }}
            subColor="#888888"
          />
          <DirectorRunButton runDisabled={false} onRun={onRun} accentColor="#3b82f6" />
        </>
      );
    }
    const utils = render(<Harness />);
    // 打开浮层面板
    fireEvent.click(utils.container.querySelector('[data-params-trigger]') as Element);
    return { ...utils, onSharedChange, onRun };
  }
  const panel = () => document.querySelector('[data-params-panel]') as HTMLElement;

  it('比例切换 16:9 → 9:16：onSharedChange 收到 params.aspect，换算尺寸 chip 联动 864×480 → 480×864', async () => {
    const { onSharedChange } = renderGroup();
    expect((panel().querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('864×480');
    fireEvent.click(panel().querySelector('[data-aspect-option="9:16"]') as Element);
    expect(onSharedChange).toHaveBeenLastCalledWith({ params: { aspect: '9:16' } });
    await waitFor(() =>
      expect((panel().querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('480×864'));
  });

  it('×系数：越界输入 blur 夹取（9 → 2）；非法输入 blur 回退默认（abc → 1）；chip 同步换算', async () => {
    const { onSharedChange } = renderGroup({ scaleFactor: 1.5 });
    expect((panel().querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('1296×720'); // ×1.5
    const input = panel().querySelector('input[data-param-key="scaleFactor"]') as HTMLInputElement;

    // 越界 → 夹到上限 2（864×2=1728 / 480×2=960）
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSharedChange).toHaveBeenLastCalledWith({ params: { scaleFactor: 2 } }));
    await waitFor(() =>
      expect((panel().querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('1728×960'));

    // 非法 → 回退默认 1
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSharedChange).toHaveBeenLastCalledWith({ params: { scaleFactor: 1 } }));
    await waitFor(() =>
      expect((panel().querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('864×480'));
  });

  it('运行：点击透传 onRun；禁用态 disabled + title「没有选中片段」，点击不透传', () => {
    const { container, onRun } = renderGroup();
    fireEvent.click(container.querySelector('[data-run-selected]') as Element);
    expect(onRun).toHaveBeenCalledTimes(1);

    const onRun2 = vi.fn();
    const { container: c2 } = render(
      <DirectorRunButton runDisabled onRun={onRun2} accentColor="#3b82f6" />,
    );
    const btn = c2.querySelector('[data-run-selected]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('没有选中片段');
    fireEvent.click(btn);
    expect(onRun2).not.toHaveBeenCalled();
  });

  it('DirectorParamsPanel 独立渲染：比例/×系数/换算尺寸/步数/种子 齐备', () => {
    const { container } = render(
      <DirectorParamsPanel shared={baseShared as never} onSharedChange={() => {}} subColor="#888888" />,
    );
    expect(container.querySelector('[data-aspect-picker]')).toBeTruthy();
    expect(container.querySelector('[data-param-key="scaleFactor"]')).toBeTruthy();
    expect(container.querySelector('[data-param-key="steps"]')).toBeTruthy();
    expect(container.querySelector('[data-param-key="seed"]')).toBeTruthy();
    expect((container.querySelector('[data-resolved-size]') as HTMLElement).textContent).toBe('864×480');
  });
});

// ===== 6b. 2026-11-05 固定宽度卡片导轨（约定）：等宽卡片铺排 + 刻度尺/播放头删除 =====

describe('卡片导轨总宽 = 按卡片数计算（卡片间距 + 尾部余量 200px，下限 800px）；刻度尺/播放头零渲染', () => {
  it('内容 3 段 → 等宽卡片 220px、间距 6px（left = 下标×226）；刻度尺/缩放控件零渲染（卡片化后 pps 不再影响布局）', async () => {
    const { container } = await renderWorkbench();
    // 刻度尺已按决策删除：ruler 容器与 tick 零渲染
    expect(container.querySelector('[data-rail-ruler]')).toBeNull();
    expect(container.querySelectorAll('[data-ruler-tick]').length).toBe(0);
    // 缩放控件（导演台卡片导轨）：+/- 按钮、滑杆、百分比零渲染
    expect(container.querySelector('.zx-timeline-zoom')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some((b) => (b as HTMLButtonElement).title === '放大')).toBe(false);
    // 等宽卡片：3 段 → left = 0 / 226 / 452，宽恒 220（总渲染宽 max(3×226+200, 800) = 878px）
    const ids = ['seg-1', 'seg-2', 'seg-3'];
    ids.forEach((id, i) => {
      const el = container.querySelector(`[data-clip-id="${id}"]`) as HTMLElement;
      expect(el.style.left).toBe(`${i * 226}px`);
      expect(el.style.width).toBe('220px');
    });
  });

  it('长内容 80 段：全部等宽卡片、最后一张卡片在渲染总宽内（不出现「最后一张卡片在滚动范围外」）', () => {
    const shots80 = Array.from({ length: 80 }, (_, i) => ({ id: `s${i + 1}`, number: i + 1, duration: 5, status: 'idle' }));
    const track = {
      id: 'tr-1', name: '主轨', sourceChain: { origin: 'sb-1' }, status: 'active', order: 0,
      clips: shots80.map((s) => ({ ref: { sourceShotId: s.id }, instanceData: s, timeline: { durationMs: 5000 } })),
    } as unknown as WorkbenchTrack;
    const data = {
      status: 'ready',
      shots: shots80.map((s) => ({ ...s, status: 'pending' })),
      totalDuration: 400,
      completedCount: 0,
    } as unknown as WorkbenchNodeData;
    const timeline = {
      shots: shots80,
      activeShotId: null,
      pixelsPerSecond: 40,
      onPixelsPerSecondChange: () => {},
      onSelectShot: () => {},
      t: tStub as never,
      theme,
      isDark: true,
    } as unknown as StoryboardTimelineProps;
    const { container } = render(
      createElement(WorkbenchMultiTrack, {
        tracks: [track], data, focusedTrackId: track.id, onFocusTrack: () => {}, timeline,
        zeroBaseRail: true,
      }),
    );
    // 卡片导轨：刻度尺零渲染
    expect(container.querySelector('[data-rail-ruler]')).toBeNull();
    // 80 张等宽卡片：总渲染宽 = 80×226 + 200 = 18280px；最后一张 left = 79×226 = 17854、右缘 18074 ≤ 18280
    const last = container.querySelector('[data-clip-id="s80"]') as HTMLElement;
    expect(last.style.left).toBe('17854px');
    expect(last.style.width).toBe('220px');
    expect(parseFloat(last.style.left) + parseFloat(last.style.width)).toBeLessThanOrEqual(80 * 226 + 200);
  });
});

// ===== 6c. 2026-11-05 220px 固定宽度卡片规格验收（约定修订版）=====

describe('220px 固定宽度卡片规格：不同时长等宽 + 卡片元素齐全 + 点击切预览 + 六态徽标 + 容器降级', () => {
  /** 自定义 seed 渲染（renderWorkbench 的去 seed 版） */
  const renderWorkbenchWith = async (seed: () => void) => {
    seed();
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-track', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const utils = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
    await waitFor(() => expect(utils.container.querySelectorAll('[data-clip-id]').length).toBe(3));
    return utils;
  };
  const stageOf = (container: HTMLElement) => container.querySelector('[data-mock="video-stage"]') as HTMLElement;

  it('不同时长（5s/8s/10s）卡片宽度完全相等（220px 基准，left = 下标×226）；卡片元素齐全：镜头号 N · Xs、首帧缩略（有产物=真实帧）、状态徽标', async () => {
    const { container } = await renderWorkbenchWith(() => {
      memfs.set('projects/p-track/entities/workbench.json', {
        schemaVersion: 1,
        version: 1,
        title: '导演台',
        tracks: [],
        shots: [
          { id: 'seg-1', number: 1, description: '', shotType: '', duration: 5, imagePrompt: '甲提示词一', status: 'done', clipState: 'completed', media: { storageKey: 'v-seg-1', trimStart: 0 }, firstFrameKey: 'frame-seg-1' },
          { id: 'seg-2', number: 2, description: '', shotType: '', duration: 8, imagePrompt: '乙提示词二', status: 'pending', clipState: 'placeholder' },
          { id: 'seg-3', number: 3, description: '', shotType: '', duration: 10, imagePrompt: '丙提示词三', status: 'failed', clipState: 'placeholder' },
        ],
        totalDuration: 23,
        updatedAt: new Date().toISOString(),
      });
    });
    // 不同时长等宽：5s/8s/10s 卡片宽度完全相同（规格第 1 条核心断言）
    const ids = ['seg-1', 'seg-2', 'seg-3'];
    ids.forEach((id, i) => {
      const el = container.querySelector(`[data-clip-id="${id}"]`) as HTMLElement;
      expect(el.style.width).toBe('220px');
      expect(el.style.left).toBe(`${i * 226}px`);
    });
    // 卡片元素：片段 NN · XXs 单行标签（i18n key，不硬编码中文）
    expect((container.querySelector('[data-clip-id="seg-1"] [data-director-clip-label]') as HTMLElement).textContent).toBe('片段 01 · 5s');
    expect((container.querySelector('[data-clip-id="seg-3"] [data-director-clip-label]') as HTMLElement).textContent).toBe('片段 03 · 10s');
    // 首帧缩略：有产物（seg-1 done）显示真实帧图
    await waitFor(() => expect(container.querySelector('[data-clip-id="seg-1"] [data-auth-img]')).toBeTruthy());
    // 无产物（seg-2 pending）中性占位：状态底色渐变、无真实帧图
    const seg2 = container.querySelector('[data-clip-id="seg-2"]') as HTMLElement;
    expect(seg2.querySelector('[data-auth-img]')).toBeNull();
    // 卡片不填色（跟画布导轨同底色）+ 只留细描边（2026-11-07 用户指令）
    expect(seg2.style.background).toBe('transparent');
    expect(seg2.style.borderWidth).toBe('1px');
    // 状态徽标：done=完成 / idle=未生成 / failed=失败，颜色区分
    const badgeOf = (id: string) => container.querySelector(`[data-clip-id="${id}"] [data-clip-badge]`) as HTMLElement;
    expect(badgeOf('seg-1').getAttribute('data-clip-badge')).toBe('done');
    expect(badgeOf('seg-1').textContent).toBe('完成');
    expect(badgeOf('seg-2').getAttribute('data-clip-badge')).toBe('idle');
    expect(badgeOf('seg-2').textContent).toBe('未生成');
    expect(badgeOf('seg-3').getAttribute('data-clip-badge')).toBe('failed');
    expect(badgeOf('seg-3').textContent).toBe('失败');
    // 颜色区分（dark 主题基色）：done 绿 / failed 红 / idle 灰，三者互不相同
    const cDone = badgeOf('seg-1').style.color;
    const cIdle = badgeOf('seg-2').style.color;
    const cFailed = badgeOf('seg-3').style.color;
    expect(new Set([cDone, cIdle, cFailed]).size).toBe(3);
    expect(cDone).toBe('rgb(134, 239, 172)'); // #86efac（dark 徽标文字）
    expect(cFailed).toBe('rgb(252, 165, 165)'); // #fca5a5（dark 徽标文字）
  });

  it('点击卡片 = 选中该段，右侧预览区切到该段：有产物→可播 key，无产物→状态占位；预览区不重复提示词', async () => {
    const { container } = await renderWorkbenchWith(() => {
      memfs.set('projects/p-track/entities/workbench.json', {
        schemaVersion: 1,
        version: 1,
        title: '导演台',
        tracks: [],
        shots: [
          { id: 'seg-1', number: 1, description: '', shotType: '', duration: 5, imagePrompt: '甲提示词一', status: 'done', clipState: 'completed', media: { storageKey: 'v-seg-1', trimStart: 0 } },
          { id: 'seg-2', number: 2, description: '', shotType: '', duration: 5, imagePrompt: '乙提示词二', status: 'pending', clipState: 'placeholder' },
          { id: 'seg-3', number: 3, description: '', shotType: '', duration: 5, imagePrompt: '丙提示词三', status: 'pending', clipState: 'placeholder' },
        ],
        totalDuration: 15,
        updatedAt: new Date().toISOString(),
      });
    });
    const stage = stageOf(container);
    expect(stage).toBeTruthy();
    // 初始（selectedShot=shots[0]=seg-1，有产物）：预览显示该段可播 key
    expect((stage.querySelector('[data-stage-video-key]') as HTMLElement).textContent).toBe('v-seg-1');
    // 点击 seg-2 卡片（≤4px = 点击语义）→ 预览切到 seg-2：无产物 → 状态占位（idle），无视频 key
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 250);
    await waitFor(() => {
      expect(stage.querySelector('[data-stage-video-key]')).toBeNull();
      expect((stage.querySelector('[data-stage-status]') as HTMLElement).textContent).toBe('idle');
    });
    // 预览区不重复提示词（占位只显示状态）
    expect(stage.textContent).not.toContain('乙提示词二');
    // 点回 seg-1 → 预览恢复可播 key
    clickClip(container.querySelector('[data-clip-id="seg-1"]') as HTMLElement, 20);
    await waitFor(() => expect((stage.querySelector('[data-stage-video-key]') as HTMLElement).textContent).toBe('v-seg-1'));
    expect(stage.textContent).not.toContain('甲提示词一');
  });

  it('resolveClipStatus 六态映射：排队（提交/在队/运行中未轮到）、已取消（取消且未完成）、其余透传；不在运行序列不误标', () => {
    const run = { phase: 'queued', segmentShotIds: ['a', 'b', 'c'], currentSegment: null };
    expect(resolveClipStatus('pending', run, 'a')).toBe('idle');
    expect(resolveClipStatus('done', run, 'a')).toBe('done');
    expect(resolveClipStatus('failed', run, 'a')).toBe('failed');
    expect(resolveClipStatus('generating', undefined, 'a')).toBe('generating');
    // 排队：提交中 / 在队 / 运行中未轮到本段
    expect(resolveClipStatus('generating', { ...run, phase: 'submitting' }, 'a')).toBe('queued');
    expect(resolveClipStatus('generating', run, 'b')).toBe('queued');
    expect(resolveClipStatus('generating', { phase: 'running', segmentShotIds: ['a', 'b'], currentSegment: 1 }, 'b')).toBe('queued');
    // 生成中：运行中轮到本段；不在运行序列（历史残留）保持原态
    expect(resolveClipStatus('generating', { phase: 'running', segmentShotIds: ['a', 'b'], currentSegment: 1 }, 'a')).toBe('generating');
    expect(resolveClipStatus('generating', { phase: 'running', segmentShotIds: ['a'], currentSegment: 1 }, 'c')).toBe('generating');
    // 已取消：运行取消且本段未完成
    expect(resolveClipStatus('generating', { phase: 'canceled', segmentShotIds: ['a'], currentSegment: null }, 'a')).toBe('cancelled');
  });

  it('导演台卡片渲染排队/已取消徽标（颜色区分）；出片页（无 directorLabel）徽标零渲染', () => {
    const renderClip = (status: string, directorLabel?: boolean) => render(createElement(TimelineClip, {
      clip: { id: 'x', left: 0, width: 220, data: { id: 'x', number: 1, duration: 5, status: status as never } },
      isSelected: false, isDragging: false,
      onPointerDown: () => {}, onPointerMove: () => {}, onPointerUp: () => {},
      onContextMenu: () => {}, onDoubleClick: () => {}, onTrimStart: () => {},
      t: tStub,
      isDark: true, clipSelectedColor: '#ffffff', trimHandleColor: '#ffffff', clipTextColor: '#ffffff',
      directorLabel,
    })).container;
    // 排队：蓝（2026-11-05 参考图六态口径）
    const q = renderClip('queued', true);
    const qBadge = q.querySelector('[data-clip-badge="queued"]') as HTMLElement;
    expect(qBadge.textContent).toBe('排队');
    expect(qBadge.style.color).toBe('rgb(147, 197, 253)'); // #93c5fd（dark）
    // 已取消：灰虚线
    const c = renderClip('cancelled', true);
    const cBadge = c.querySelector('[data-clip-badge="cancelled"]') as HTMLElement;
    expect(cBadge.textContent).toBe('已取消');
    expect(cBadge.style.color).toBe('rgb(203, 213, 225)'); // #cbd5e1（dark）
    expect(cBadge.style.borderStyle).toBe('dashed');
    // 出片页：directorLabel 缺省 → 徽标零渲染（出片页零变化）
    expect(renderClip('queued').querySelector('[data-clip-badge]')).toBeNull();
  });

  it('pickDirectorCardWidth 容器降级：≥720→220；480–719→180；<480→160；测量不可用（0/负）→基准 220', () => {
    expect(pickDirectorCardWidth(1280)).toBe(220);
    expect(pickDirectorCardWidth(720)).toBe(220);
    expect(pickDirectorCardWidth(719)).toBe(180);
    expect(pickDirectorCardWidth(480)).toBe(180);
    expect(pickDirectorCardWidth(479)).toBe(160);
    expect(pickDirectorCardWidth(200)).toBe(160);
    expect(pickDirectorCardWidth(0)).toBe(220);
    expect(pickDirectorCardWidth(-5)).toBe(220);
  });
});

// ===== 7. 出片页零变化（不传新 props 的 WorkbenchMultiTrack）=====

describe('出片页零变化（不传新 props 的 WorkbenchMultiTrack）', () => {
  it('渲染片段但无勾选块/箭头/插入线/占位/模式条/参数行（旧 borderLeft 占位与 14px padding 原样），分割/合并入口 = 0，clip 圆角 4px 无绿缝', () => {
    const track: WorkbenchTrack = {
      id: 'tr-1', name: '主轨', sourceChain: { origin: 'sb-1' }, status: 'active', order: 0, clips: [],
    } as WorkbenchTrack;
    const data = {
      status: 'ready',
      shots: [
        { id: 's1', number: 1, duration: 5, status: 'pending' },
        { id: 's2', number: 2, duration: 5, status: 'pending' },
      ],
      totalDuration: 10,
      completedCount: 0,
    } as unknown as WorkbenchNodeData;
    const timeline = {
      shots: [
        { id: 's1', number: 1, duration: 5, status: 'idle' },
        { id: 's2', number: 2, duration: 5, status: 'idle' },
      ],
      activeShotId: null,
      pixelsPerSecond: 40,
      onPixelsPerSecondChange: () => {},
      onSelectShot: () => {},
      t: ((k: string, fb?: string) => fb ?? k) as never,
      theme,
      isDark: true,
    } as unknown as StoryboardTimelineProps;
    const { container } = render(
      createElement(WorkbenchMultiTrack, {
        tracks: [track], data, focusedTrackId: null, onFocusTrack: () => {}, timeline,
      }),
    );
    // 片段真实渲染
    expect(container.querySelectorAll('[data-clip-id]').length).toBe(2);
    // 新能力零渲染（衔接箭头/勾选块/插入线/虚线占位/旧整块高亮/模式条/参数行）
    expect(container.querySelectorAll('[data-clip-check]').length).toBe(0);
    expect(container.querySelectorAll('[data-continuity-arrow]').length).toBe(0);
    expect(container.querySelectorAll('[data-drop-line]').length).toBe(0);
    expect(container.querySelectorAll('[data-drag-placeholder]').length).toBe(0);
    expect(container.querySelectorAll('[data-drop-placeholder]').length).toBe(0);
    expect(container.querySelectorAll('[data-drop-hover]').length).toBe(0);
    expect(container.querySelectorAll('[data-params-run-row]').length).toBe(0);
    expect(container.querySelector('[data-track-select-mode]')).toBeNull();
    // 2026-11-05：整项删除分割/合并入口（菜单/工具栏/快捷键已清），断言残留 = 0
    expect(container.querySelectorAll('button[title="在播放头处分割选中片段"]').length).toBe(0);
    // 零基线未开启：旧 14px 刻度 padding 与轨道行 borderLeft 占位原样保留
    expect((container.querySelector('[data-ruler-tick="0"]') as HTMLElement).style.left).toBe('14px');
    const row = container.querySelector('[data-rail-scroll]')!.firstElementChild as HTMLElement;
    expect(row.style.borderLeftWidth).toBe('2px'); // transparent 占位（旧行为，不动出片页）
    expect((container.querySelector('[data-timeline-body]') as HTMLElement).style.paddingLeft).toBe('14px');
    // 绿缝残留 = 0：圆角恒 4px、边框无 #00c758
    const clip2 = container.querySelector('[data-clip-id="s2"]') as HTMLElement;
    expect(clip2.style.borderRadius).toBe('4px');
    expect(clip2.style.borderLeftColor).not.toBe(ARROW_GREEN);
  });
});

// ===== 8. 2026-11-05 参考图修订：缩略框 + 标签行 / 选中轻量描边 / 六态角标 / 箭头居中 / 固定高度 =====

describe('2026-11-05 参考图修订：卡片结构 + 选中态 + 六态角标 + 箭头 + 固定高度', () => {
  const renderSeeded = async (seed: () => void) => {
    seed();
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-track', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const utils = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
    await waitFor(() => expect(utils.container.querySelectorAll('[data-clip-id]').length).toBe(3));
    return utils;
  };
  const seedCards = () => {
    memfs.set('projects/p-track/entities/workbench.json', {
      schemaVersion: 1,
      version: 1,
      title: '导演台',
      tracks: [],
      shots: [
        { id: 'seg-1', number: 1, description: '', shotType: '', duration: 5, imagePrompt: '', status: 'done', clipState: 'completed', media: { storageKey: 'v-seg-1', trimStart: 0 }, firstFrameKey: 'frame-seg-1' },
        { id: 'seg-2', number: 2, description: '', shotType: '', duration: 8, imagePrompt: '', status: 'pending', clipState: 'placeholder', continuation: { enabled: true } },
        { id: 'seg-3', number: 3, description: '', shotType: '', duration: 10, imagePrompt: '', status: 'failed', clipState: 'placeholder', continuation: { enabled: false } },
      ],
      totalDuration: 23,
      updatedAt: new Date().toISOString(),
    });
  };

  it('卡片结构 = 上缩略框 + 下标签行；有产物首帧 + 播放键 + 时长角标；无产物播放三角 + 可读原因且无角标', async () => {
    const { container } = await renderSeeded(seedCards);
    const card1 = container.querySelector('[data-clip-id="seg-1"]') as HTMLElement;
    const card2 = container.querySelector('[data-clip-id="seg-2"]') as HTMLElement;
    // 结构：缩略框 + 标签行；卡片高 = 缩略框 136 + 标签 20 + 上下 padding 12 = 168
    for (const card of [card1, card2]) {
      expect(card.querySelector('[data-director-thumb]')).toBeTruthy();
      expect(card.querySelector('[data-director-label-row]')).toBeTruthy();
      expect(card.style.height).toBe(`${directorCardHeight(220)}px`);
      expect(card.style.height).toBe('168px');
      expect((card.querySelector('[data-director-thumb]') as HTMLElement).style.height).toBe('136px');
      expect((card.querySelector('[data-director-label-row]') as HTMLElement).style.height).toBe('20px');
    }
    // 有产物：首帧 img > 0、圆形播放键、右下角紧凑时长角标（只显示秒数 05）
    await waitFor(() => expect(card1.querySelectorAll('[data-auth-img]').length).toBeGreaterThan(0));
    // 首帧走媒体层解析：img 拿到的是可渲染 URL，而不是 image: 前缀的 storageKey
    expect((card1.querySelector('[data-auth-img]') as HTMLElement).getAttribute('data-auth-src')).toBe('blob:frame-seg-1');
    expect(card1.querySelector('[data-director-play="seg-1"]')).toBeTruthy();
    expect((card1.querySelector('[data-director-duration]') as HTMLElement).textContent).toBe('05');
    // 无产物：播放三角 + 可读原因，无播放键、无时长角标
    expect(card2.querySelector('[data-director-empty]')).toBeTruthy();
    expect((card2.querySelector('[data-director-empty]') as HTMLElement).textContent).toContain('暂无首帧');
    expect(card2.querySelector('[data-director-play]')).toBeNull();
    expect(card2.querySelector('[data-director-duration]')).toBeNull();
    // 标签行：片段 NN · XXs（不是旧的「镜头号」）
    expect((card1.querySelector('[data-director-clip-label]') as HTMLElement).textContent).toBe('片段 01 · 5s');
    expect((card2.querySelector('[data-director-clip-label]') as HTMLElement).textContent).toBe('片段 02 · 8s');
  });

  it('首帧解析失败：有产物卡片给「首帧加载失败」明确文案，播放键与时长角标照常可播', async () => {
    const { container } = await renderSeeded(() => {
      memfs.set('projects/p-track/entities/workbench.json', {
        schemaVersion: 1,
        version: 1,
        title: '导演台',
        tracks: [],
        shots: [
          { id: 'seg-1', number: 1, description: '', shotType: '', duration: 5, imagePrompt: '', status: 'done', clipState: 'completed', media: { storageKey: 'v-missing', trimStart: 0 }, firstFrameKey: 'frame-missing' },
          { id: 'seg-2', number: 2, description: '', shotType: '', duration: 8, imagePrompt: '', status: 'pending', clipState: 'placeholder' },
          { id: 'seg-3', number: 3, description: '', shotType: '', duration: 10, imagePrompt: '', status: 'pending', clipState: 'placeholder' },
        ],
        totalDuration: 23,
        updatedAt: new Date().toISOString(),
      });
    });
    const card = container.querySelector('[data-clip-id="seg-1"]') as HTMLElement;
    await waitFor(() => expect(card.querySelector('[data-director-empty]')).toBeTruthy());
    expect((card.querySelector('[data-director-empty]') as HTMLElement).textContent).toContain('首帧加载失败');
    expect(card.querySelector('[data-auth-img]')).toBeNull();
    expect(card.querySelector('[data-director-play="seg-1"]')).toBeTruthy();
    expect((card.querySelector('[data-director-duration]') as HTMLElement).textContent).toBe('05');
  });

  it('选中态 = 1px 中性亮描边 + 外发光 + 2px 抬高（2026-11-05 去绿色，也不是 2px 纯黑）；未选中 0.62 / hover 0.85 / 选中 1', async () => {
    const { container } = await renderSeeded(seedCards);
    const selected = container.querySelector('[data-clip-id="seg-1"]') as HTMLElement;
    const rest = container.querySelector('[data-clip-id="seg-2"]') as HTMLElement;
    expect(selected.getAttribute('data-clip-selected')).toBe('true');
    // 不会出现 2px 纯黑边框
    expect(selected.style.borderWidth).toBe('1px');
    expect(selected.style.borderLeftColor).not.toBe('rgb(0, 0, 0)');
    // 细亮描边 = 中性亮色（outline 内缩 1px，子元素缩略框 overflow:hidden 不可压住）
    expect(selected.style.outline).toContain('1px');
    expect(selected.style.outline).toMatch(/rgba\((245,245,244|68,64,60)/);
    // 选中态零绿色残留（#00c758 / rgba(0,199,88,*) 只允许出现在衔接箭头 SVG 上）
    expect(selected.style.outline).not.toMatch(/0,\s*199,\s*88|#00c758/i);
    expect(selected.style.outlineOffset).toBe('-1px');
    expect(selected.style.boxShadow).not.toMatch(/0,\s*199,\s*88|#00c758/i);
    // 2px 抬高走 top（不改 transform，拖拽 的 transform 断言保持 none）
    expect(selected.style.top).toBe('5px');
    expect(selected.style.transform).toBe('none');
    expect(selected.style.zIndex).toBe('2');
    expect((selected.querySelector('[data-director-thumb]') as HTMLElement).style.overflow).toBe('hidden');
    // 卡片不填色、不压暗：所有卡片同一底色（导轨底），仅描边区分（2026-11-07 用户指令）
    expect(selected.style.opacity).toBe('1');
    expect(rest.style.opacity).toBe('1');
    expect(selected.style.background).toBe('transparent');
    expect(rest.style.background).toBe('transparent');
    // 选中描边是中性亮色/中性灰，不是纯黑也不是绿色
    const lightTone = directorRailTone(false);
    expect(lightTone.selectedOutline).toBe('rgba(68,64,60,0.85)');
    expect(lightTone.selectedOutline).not.toMatch(/0,\s*199,\s*88|#00c758/i);
    expect(lightTone.selectedBorder).not.toMatch(/#000/);
    const darkTone = directorRailTone(true);
    expect(darkTone.selectedOutline).toBe('rgba(245,245,244,0.90)');
    expect(darkTone.selectedShadow).not.toMatch(/0,\s*199,\s*88/);
  });

  it('播放键点击 = 选中该段并打开右侧预览（onDirectorPlay 回调，不触发拖拽）', async () => {
    const { container } = await renderSeeded(seedCards);
    const play = container.querySelector('[data-clip-id="seg-1"] [data-director-play]') as HTMLButtonElement;
    expect(play).toBeTruthy();
    // 点击卡片 → 右侧预览切到 seg-2；再点 seg-1 播放键 → 预览切回 seg-1（有产物 key）
    clickClip(container.querySelector('[data-clip-id="seg-2"]') as HTMLElement, 240);
    await waitFor(() => expect(container.querySelector('[data-mock="video-stage"]')));
    fireEvent.click(container.querySelector('[data-clip-id="seg-1"] [data-director-play]') as HTMLButtonElement);
    const stage = container.querySelector('[data-mock="video-stage"]') as HTMLElement;
    await waitFor(() => expect(stage.querySelector('[data-stage-video-key]')).toBeTruthy());
  });

  it('六态角标：状态色点 + 半透明底 + 细描边；排队蓝 / 生成中绿脉冲 / 完成绿 / 失败红 / 取消灰虚线 / 未生成中性灰', () => {
    const renderClip = (status: string, isDark: boolean, extra: Record<string, unknown> = {}) => render(createElement(TimelineClip, {
      clip: { id: 'x', left: 0, width: 220, data: { id: 'x', number: 1, duration: 5, status: status as never } },
      isSelected: false, isDragging: false,
      onPointerDown: () => {}, onPointerMove: () => {}, onPointerUp: () => {},
      onContextMenu: () => {}, onDoubleClick: () => {}, onTrimStart: () => {},
      t: tStub,
      isDark, clipSelectedColor: '#ffffff', trimHandleColor: '#ffffff', clipTextColor: '#ffffff',
      directorLabel: true,
      ...extra,
    })).container;
    for (const dark of [true, false]) {
      const tone = directorBadgeTone('idle', dark);
      expect(tone).toBeTruthy();
    }
    const cases: Array<[string, boolean, string]> = [
      ['idle', true, 'rgb(199, 199, 199)'],
      ['queued', true, 'rgb(147, 197, 253)'],
      ['generating', true, 'rgb(134, 239, 172)'],
      ['done', true, 'rgb(134, 239, 172)'],
      ['failed', true, 'rgb(252, 165, 165)'],
      ['cancelled', true, 'rgb(203, 213, 225)'],
    ];
    for (const [status, isDark, color] of cases) {
      const el = renderClip(status, isDark);
      const badge = el.querySelector('[data-clip-badge]') as HTMLElement;
      expect(badge.getAttribute('data-clip-badge')).toBe(status);
      expect(badge.style.color).toBe(color);
      // 色点 + 半透明底 + 细描边（取消态虚线）
      expect(badge.querySelector('[data-clip-badge-dot]')).toBeTruthy();
      expect(badge.style.background).toMatch(/rgba\(/);
      expect(badge.style.borderWidth).toBe('1px');
      expect(badge.style.borderStyle).toBe(status === 'cancelled' ? 'dashed' : 'solid');
      expect(badge.style.fontSize).toBe('8px');
      expect(badge.style.fontWeight).toBe('500');
      // 角标叠在缩略框右上角，不占标签行
      expect((badge.parentElement as HTMLElement).hasAttribute('data-director-thumb')).toBe(true);
      // 生成中：绿点脉冲
      const dot = badge.querySelector('[data-clip-badge-dot]') as HTMLElement;
      expect(dot.style.animation).toBe(status === 'generating' ? 'zx-director-badge-pulse 1.2s ease-in-out infinite' : '');
    }
  });

  it('六态徽标文字对卡片底对比度 ≥ 4.5:1（浅/深各自成立）', () => {
    const channel = (hex: string, i: number) => parseInt(hex.replace('#', '').slice(i * 2, i * 2 + 2), 16);
    const luminance = (hex: string) => {
      const rgb = [0, 1, 2].map((i) => channel(hex, i) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    };
    const contrast = (fg: string, bg: string) => {
      const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    };
    const statuses = ['idle', 'queued', 'generating', 'done', 'failed', 'cancelled'] as const;
    for (const status of statuses) {
      expect(contrast(directorBadgeTone(status, false).text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(directorBadgeTone(status, true).text, '#161412')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('段间箭头：垂直居中于卡片、落在两卡间隙中心、hover 才回满强度', async () => {
    const { container } = await renderSeeded(seedCards);
    const card = container.querySelector('[data-clip-id="seg-2"]') as HTMLElement;
    const cardTop = parseFloat(card.style.top);
    const cardH = parseFloat(card.style.height);
    const arrow = container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement;
    const arrowTop = parseFloat(arrow.style.top);
    const arrowH = parseFloat(arrow.style.height);
    // 与卡片垂直居中：cardTop + cardH/2 === arrowTop + arrowH/2
    expect(cardTop + cardH / 2).toBe(arrowTop + arrowH / 2);
    // 位于两卡间隙中心：left + width/2 === 交界 − 间隙/2（226 − 3）
    expect(parseFloat(arrow.style.left) + parseFloat(arrow.style.width) / 2).toBe(226 - 3);
    expect(arrow.style.width).toBe(`${DIRECTOR_ARROW_SIZE.width}px`);
    // 造型/命中行为保持原样：静息 0.86，hover 回 1；2026-11-06 起承载于深色胶囊（非白底）
    expect(arrow.style.opacity).toBe('0.86');
    expect(arrow.style.pointerEvents).toBe('auto');
    expect(arrow.style.background).not.toBe('');
    fireEvent.mouseEnter(arrow);
    await waitFor(() => expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).style.opacity).toBe('1'));
    fireEvent.mouseLeave(container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement);
    await waitFor(() => expect((container.querySelector('[data-continuity-arrow="seg-2"]') as HTMLElement).style.opacity).toBe('0.86'));
  });

  it('导轨高度固定：不存在高度拖拽分割手柄（testid/class = 0），轨道区高度 = DIRECTOR_RAIL_HEIGHT', async () => {
    const { container } = await renderSeeded(seedCards);
    expect(container.querySelectorAll('[data-wb="rail-resize"]').length).toBe(0);
    expect(container.querySelectorAll('[data-rail-resize]').length).toBe(0);
    expect(container.querySelectorAll('.zx-rail-resize').length).toBe(0);
    const trackArea = container.querySelector('[data-wb="track-area"]') as HTMLElement;
    expect(trackArea.style.height).toBe(`${DIRECTOR_RAIL_HEIGHT}px`);
    expect(DIRECTOR_RAIL_HEIGHT).toBe(directorCardHeight(220) + 62);
    // 高度不可拖：轨道区内不存在 row-resize 光标入口
    expect(Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => el.style.cursor === 'row-resize').length).toBe(0);
  });

  it('时长不可拖拽：导轨无 trim 手柄 / ew-resize 热区 / trim class（三处计数 = 0）', async () => {
    const { container } = await renderSeeded(seedCards);
    const rail = container.querySelector('[data-rail-scroll]') as HTMLElement;
    expect(container.querySelectorAll('[data-clip-trim]').length).toBe(0);
    expect(container.querySelectorAll('.zx-clip-trim').length).toBe(0);
    expect(Array.from(rail.querySelectorAll<HTMLElement>('*'))
      .filter((el) => el.style.cursor === 'ew-resize' || getComputedStyle(el).cursor === 'ew-resize').length).toBe(0);
    // 标签行 = 只读展示 duration（数据来源 = 参数），不因拖拽改变
    const labels = Array.from(container.querySelectorAll('[data-director-clip-label]')).map((el) => el.textContent);
    expect(labels).toEqual(['片段 01 · 5s', '片段 02 · 8s', '片段 03 · 10s']);
  });

  it('时长来源 = 参数：duration 变化时标签行同步变化（只读派生，不依赖拖拽）', () => {
    const renderDirectorClip = (duration: number) => render(createElement(TimelineClip, {
      clip: { id: 'd1', left: 0, width: 220, data: { id: 'd1', number: 1, duration, status: 'pending' as never } },
      isSelected: false, isDragging: false,
      onPointerDown: () => {}, onPointerMove: () => {}, onPointerUp: () => {},
      onContextMenu: () => {}, onDoubleClick: () => {},
      // 即便外部误传 trim 回调，导演台卡片也不渲染 trim 手柄
      onTrimStart: () => {},
      t: tStub,
      isDark: true, clipSelectedColor: '#ffffff', trimHandleColor: '#ffffff', clipTextColor: '#ffffff',
      directorLabel: true,
    })).container;
    const five = renderDirectorClip(5);
    expect((five.querySelector('[data-director-clip-label]') as HTMLElement).textContent).toBe('片段 01 · 5s');
    expect(five.querySelectorAll('[data-clip-trim]').length).toBe(0);
    const nine = renderDirectorClip(9);
    expect((nine.querySelector('[data-director-clip-label]') as HTMLElement).textContent).toBe('片段 01 · 9s');
    expect(nine.querySelectorAll('[data-clip-trim]').length).toBe(0);
  });

  /** 纯白边框/分隔/细条判定（允许白色文字，只抓边框/背景/outline） */
  const pureWhiteOffenders = (root: HTMLElement): HTMLElement[] => {
    const isPureWhite = (c: string): boolean => {
      const v = c.replace(/\s+/g, '');
      return v === 'rgb(255,255,255)' || v === '#fff' || v === '#ffffff'
        || /^rgba\(255,255,255,(0\.8|0\.85|0\.9|0\.95|1)\)$/.test(v);
    };
    const sides = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'] as const;
    return Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const s = getComputedStyle(el);
      const whiteBorder = sides.some((side) => {
        const width = s[`${side}Width` as 'borderTopWidth'] as string;
        const color = s[`${side}Color` as 'borderTopColor'] as string;
        return parseFloat(width) > 0 && isPureWhite(color);
      });
      const whiteOutline = parseFloat(s.outlineWidth) > 0 && isPureWhite(s.outlineColor);
      // 背景白只抓「条」：高度或宽度 ≤ 6px（白缝/白横条），放过大面积底色
      const whiteBar = isPureWhite(s.backgroundColor)
        && (parseFloat(s.height) <= 6 || parseFloat(s.width) <= 6);
      return whiteBorder || whiteOutline || whiteBar;
    });
  };

  it('深色：上方两条横向边线已删（工具栏 borderBottom=0 / 内层时间轴 borderTop=0），导轨无纯白条', async () => {
    const { container } = await renderSeeded(seedCards);
    const rail = container.querySelector('.zx-director-rail') as HTMLElement;
    const toolbar = rail.parentElement!.querySelector('[data-rail-toolbar]') as HTMLElement;
    // 上方第一条：工具行下沿边框 = 0（jsdom 对无边框的 computed width 返回空串）
    expect(Number.parseFloat(getComputedStyle(toolbar).borderBottomWidth) || 0).toBe(0);
    expect(getComputedStyle(toolbar).borderBottomStyle || 'none').toBe('none');
    const shell = trackRowOf(container).firstElementChild as HTMLElement;
    // 上方第二条：内层时间轴容器上沿边框 = 0
    expect(Number.parseFloat(getComputedStyle(shell).borderTopWidth) || 0).toBe(0);
    expect(getComputedStyle(shell).borderTopStyle || 'none').toBe('none');
    expect(pureWhiteOffenders(rail).length).toBe(0);
  });

  it('浅色：同样无上方分割线、无纯白边/缝；选中描边仍是中性亮色', async () => {
    themeMode.mode = 'light';
    const { container } = await renderSeeded(seedCards);
    const rail = container.querySelector('.zx-director-rail') as HTMLElement;
    const toolbar = rail.parentElement!.querySelector('[data-rail-toolbar]') as HTMLElement;
    expect(toolbar.style.borderBottom).toBe('');
    expect(Number.parseFloat(getComputedStyle(toolbar).borderBottomWidth) || 0).toBe(0);
    const shell = trackRowOf(container).firstElementChild as HTMLElement;
    expect(shell.style.borderTop).toBe('');
    expect(Number.parseFloat(getComputedStyle(shell).borderTopWidth) || 0).toBe(0);
    expect(pureWhiteOffenders(rail).length).toBe(0);
    const selected = container.querySelector('[data-clip-id="seg-1"]') as HTMLElement;
    expect(selected.style.outline).toContain('rgba(68,64,60');
    expect(selected.style.outline).not.toMatch(/0,\s*199,\s*88|#00c758/i);
    expect(selected.style.borderLeftColor).not.toBe('rgb(255, 255, 255)');
  });
});
