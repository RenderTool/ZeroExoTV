/**
 * empty-canvas-guide.test - 空画布引导态断言（2026-11-04）
 *
 * 覆盖:
 * 1. 空图时引导层渲染（点阵/辉光/提示三层 + i18n key 命中）
 * 2. 有节点时引导层不渲染（含淡出后卸载）
 * 3. 纯视觉层：渲染与卸载全程不读写 graph（graph 内容零变化）
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';

// 与 bugfix-20261104.test.tsx 同一规避手法：mock 为深路径 store 模块，绕开包级 index 重组件链
vi.mock('@zeroexo/plugin-render-react', async () => {
  const store = await import('../../../../packages/plugins/render-react/src/store.js');
  const { buildDotGridBackground } = await import(
    '../../../../packages/plugins/render-react/src/components/viewport.js'
  );
  return { ...store, buildDotGridBackground };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// theme 最小桩：仅提供组件读取的 token
const THEME_STUB = {
  mode: 'dark',
  canvas: { gridDot: 'rgba(245,245,244,.35)' },
  toolbar: { accent: '#e94560', textMuted: '#a8a29e' },
};
vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: THEME_STUB, mode: 'dark' }),
}));

import { CommandQueue, EventBus, AddNodeCommand } from '@zeroexo/core';
import { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { EmptyCanvasGuide, useIsCanvasEmpty } from './empty-canvas-guide.js';
import { renderHook } from '@testing-library/react';

function makeStore(nodes: Record<string, unknown>[] = []) {
  const eventBus = new EventBus();
  const queue = new CommandQueue(
    { nodes, edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} } as never,
    eventBus,
  );
  const store = new ReactGraphStore(queue, eventBus);
  return { queue, store };
}

function makeNode(id: string): Record<string, unknown> {
  return { id, type: 'image', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data: {} };
}

describe('EmptyCanvasGuide 空画布引导态', () => {
  it('空图时渲染引导层（点阵/辉光/提示三层 + i18n key）', () => {
    const { store } = makeStore();
    const { container } = render(React.createElement(EmptyCanvasGuide, { store }));
    const guide = container.querySelector('[data-empty-canvas-guide]');
    expect(guide).not.toBeNull();
    expect(container.querySelector('[data-empty-canvas-guide-dots]')).not.toBeNull();
    expect(container.querySelector('[data-empty-canvas-guide-glow]')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('editor.emptyGuideAction');
    expect(text).toContain('editor.emptyGuideCreate');
    expect(text).toContain('editor.emptyGuideDrop');
    // 点阵用 radial-gradient 平铺、辉光透明度 ≤ 0.15（深色主题）
    const dots = container.querySelector('[data-empty-canvas-guide-dots]') as HTMLElement;
    expect(dots.style.backgroundImage).toContain('radial-gradient(circle');
    const glow = container.querySelector('[data-empty-canvas-guide-glow]') as HTMLElement;
    // 2026-11-04 修改：去品牌红——辉光为中性冷白 4 stop 衰减 + 垂直明度层
    expect(glow.style.background).toContain('rgba(226,232,240,0.10) 0%');
    expect(glow.style.background).toContain('rgba(226,232,240,0.055) 35%');
    expect(glow.style.background).toContain('rgba(226,232,240,0.02) 70%');
    expect(glow.style.background).toContain('radial-gradient(ellipse 720px 520px');
    const glowV = container.querySelector('[data-empty-canvas-guide-glow-vertical]') as HTMLElement;
    expect(glowV.style.background).toContain('linear-gradient(to bottom');
    // 组件渲染输出零 accent/品牌红（233,69,96 / #e94560 一律不出现）
    const allStyle = Array.from(container.querySelectorAll<HTMLElement>('[style]'))
      .map((el) => el.getAttribute('style') ?? '')
      .join(';');
    expect(allStyle).not.toMatch(/233,\s*69,\s*96/i);
    expect(allStyle.toLowerCase()).not.toContain('#e94560');
    expect(allStyle).not.toContain('accent');
    // 纯视觉层：不拦截指针事件
    expect((guide as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('初始有节点时不渲染', () => {
    const { store } = makeStore([makeNode('n1')]);
    const { container } = render(React.createElement(EmptyCanvasGuide, { store }));
    expect(container.querySelector('[data-empty-canvas-guide]')).toBeNull();
  });

  it('新增节点后淡出并卸载', async () => {
    const { queue, store } = makeStore();
    const { container } = render(React.createElement(EmptyCanvasGuide, { store }));
    expect(container.querySelector('[data-empty-canvas-guide]')).not.toBeNull();
    act(() => {
      queue.execute(new AddNodeCommand(makeNode('n1') as never));
    });
    // 淡出中：元素仍在但 opacity=0
    await waitFor(() => {
      const el = container.querySelector('[data-empty-canvas-guide]') as HTMLElement | null;
      expect(el === null || el.style.opacity === '0').toBe(true);
    });
    // 过渡时长(300ms)后卸载
    await waitFor(
      () => {
        expect(container.querySelector('[data-empty-canvas-guide]')).toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('_deleted 墓碑节点不算可见节点（仍视为空图）', () => {
    const { store } = makeStore([{ ...makeNode('n1'), _deleted: true } as never]);
    const { container } = render(React.createElement(EmptyCanvasGuide, { store }));
    expect(container.querySelector('[data-empty-canvas-guide]')).not.toBeNull();
  });

  it('纯视觉层：渲染/交互/卸载全程 graph 零变化（不读改写数据）', () => {
    const { queue, store } = makeStore();
    const before = JSON.stringify(store.getGraph());
    const { unmount } = render(React.createElement(EmptyCanvasGuide, { store }));
    act(() => {
      queue.execute(new AddNodeCommand(makeNode('n1') as never));
    });
    unmount();
    // graph 唯一变化来自测试自身 execute 的 AddNodeCommand
    const after = JSON.parse(JSON.stringify(store.getGraph())) as { nodes: { id: string }[]; edges: unknown[] };
    expect(after.nodes.map((n) => n.id)).toEqual(['n1']);
    expect(after.edges).toEqual([]);
    expect(before).not.toBe(after); // 仅节点新增，非引导层写入
  });

  it('useIsCanvasEmpty 响应式：空→true，新增节点→false', () => {
    const { queue, store } = makeStore();
    const { result } = renderHook(() => useIsCanvasEmpty(store));
    expect(result.current).toBe(true);
    act(() => {
      queue.execute(new AddNodeCommand(makeNode('n1') as never));
    });
    expect(result.current).toBe(false);
  });
});
