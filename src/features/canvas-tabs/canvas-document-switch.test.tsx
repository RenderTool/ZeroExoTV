/**
 * 画布文档切换行为单测（2026-11-06 用户纠偏）
 *
 * 锁定数据安全顺序（这些顺序错了会把副本书写进主画布键）：
 * 1. 主画布 → 副本：先 `save()` 落盘主画布 → `pause()` 停主画布自动保存 → `replaceState` 换图 → 视口跟随文档；
 * 2. 副本编辑：`subscribeGraph` 触发 500ms 防抖 → 写 `canvas-store`（不是持久化插件）；
 * 3. 副本 → 主画布：先把副本落盘 → 换回主图 → `resume()` 恢复主画布自动保存。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { App as AntdApp } from 'antd';

const canvasStoreMock = vi.hoisted(() => ({
  getCanvas: vi.fn(async (_projectId: string, cid: string) => ({
    doc: { id: cid, title: cid },
    graph: { nodes: [{ id: `${cid}-node` }], edges: [], viewport: { x: 5, y: 6, k: 1 }, metadata: {} },
    stamp: { size: 1, lastModified: 1 },
  })),
  saveCanvas: vi.fn(async (_projectId: string, _cid: string, _patch: unknown, _stamp?: unknown) => ({})),
  listCanvases: vi.fn(async () => []),
}));

vi.mock('@/entities/canvas-store.js', () => ({
  MAIN_CANVAS_ID: 'main',
  getCanvas: canvasStoreMock.getCanvas,
  saveCanvas: canvasStoreMock.saveCanvas,
  listCanvases: canvasStoreMock.listCanvases,
  isCanvasConflict: () => false,
}));

vi.mock('@zeroexo/plugin-persistence', () => ({
  loadProjectGraph: vi.fn(async () => ({
    nodes: [{ id: 'main-node' }], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {},
  })),
}));

// 切文档时会退出「图片节点内编辑」；这里只关心调用，不引入节点包整条依赖链
vi.mock('@zeroexo/plugin-nodes', () => ({
  closeImageNodeEdit: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: unknown) => (typeof opts === 'string' ? opts : key) }),
}));

vi.mock('@/shared/view-prefs.js', () => ({
  useViewPrefsStore: { getState: () => ({ canvasTabs: { openCanvasesByProject: {} } }) },
}));

import { useCanvasDocumentSwitch } from './use-canvas-document-switch.js';
import { useCanvasTabStore } from './canvas-tab-store.js';

function makeEditor(calls: string[]) {
  const listeners = new Set<() => void>();
  let graph: { nodes: Array<{ id: string }>; edges: unknown[]; viewport: { x: number; y: number; k: number }; metadata: Record<string, unknown> } =
    { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
  return {
    store: {
      subscribeGraph: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      getViewport: () => graph.viewport,
      setViewport: (v: { x: number; y: number; k: number }) => { calls.push('setViewport'); graph = { ...graph, viewport: v }; },
      setSelection: () => { calls.push('clearSelection'); },
    },
    core: {
      commandQueue: {
        getState: () => graph,
        replaceState: (g: typeof graph) => { calls.push('replaceState'); graph = g; },
      },
    },
    plugins: {
      persistence: {
        save: async () => { calls.push('save-main'); },
        waitForSave: async () => {},
        pause: () => calls.push('pause'),
        resume: () => calls.push('resume'),
      },
    },
    /** 模拟画布内容变化（触发副本防抖保存） */
    emitGraphChange: () => listeners.forEach((fn) => fn()),
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(AntdApp, null, children);
}

afterEach(() => {
  cleanup();
  canvasStoreMock.getCanvas.mockClear();
  canvasStoreMock.saveCanvas.mockClear();
  useCanvasTabStore.setState({ activeTabKey: 'canvas', openCanvasTabs: [] });
});

describe('画布文档切换（同一编辑器）', () => {
  it('主画布 → 副本：先落盘主画布，再暂停主自动保存，然后换图', async () => {
    const calls: string[] = [];
    const editor = makeEditor(calls);
    useCanvasTabStore.setState({
      activeTabKey: 'canvas',
      openCanvasTabs: [{ key: 'canvas:sc1', cid: 'sc1', title: '副本1' }],
    });

    const { rerender } = renderHook(
      () => useCanvasDocumentSwitch({ projectId: 'p1', editor: editor as never }),
      { wrapper },
    );

    act(() => { useCanvasTabStore.setState({ activeTabKey: 'canvas:sc1' }); });
    rerender();

    await waitFor(() => expect(calls).toContain('pause'));
    expect(calls.indexOf('save-main')).toBeLessThan(calls.indexOf('pause'));
    expect(calls.indexOf('pause')).toBeLessThan(calls.indexOf('replaceState'));
    expect(calls).toContain('setViewport');
    expect(canvasStoreMock.getCanvas).toHaveBeenCalledWith('p1', 'sc1');
  });

  it('副本编辑走 canvas-store 防抖保存（不是持久化插件）', async () => {
    const calls: string[] = [];
    const editor = makeEditor(calls);
    useCanvasTabStore.setState({
      activeTabKey: 'canvas',
      openCanvasTabs: [{ key: 'canvas:sc1', cid: 'sc1', title: '副本1' }],
    });

    const { rerender } = renderHook(
      () => useCanvasDocumentSwitch({ projectId: 'p1', editor: editor as never }),
      { wrapper },
    );

    act(() => { useCanvasTabStore.setState({ activeTabKey: 'canvas:sc1' }); });
    rerender();
    await waitFor(() => expect(calls).toContain('replaceState'));

    act(() => { editor.emitGraphChange(); });
    await waitFor(() => expect(canvasStoreMock.saveCanvas).toHaveBeenCalled(), { timeout: 2000 });
    expect(canvasStoreMock.saveCanvas.mock.calls[0]?.[1]).toBe('sc1');
    // 主画布持久化插件在副本期间不得被调用保存
    expect(calls.filter((c) => c === 'save-main').length).toBe(1);
  });

  it('副本 → 主画布：先把副本落盘，换回主图后恢复主自动保存', async () => {
    const calls: string[] = [];
    const editor = makeEditor(calls);
    useCanvasTabStore.setState({
      activeTabKey: 'canvas',
      openCanvasTabs: [{ key: 'canvas:sc1', cid: 'sc1', title: '副本1' }],
    });

    const { rerender } = renderHook(
      () => useCanvasDocumentSwitch({ projectId: 'p1', editor: editor as never }),
      { wrapper },
    );

    act(() => { useCanvasTabStore.setState({ activeTabKey: 'canvas:sc1' }); });
    rerender();
    await waitFor(() => expect(calls).toContain('pause'));

    act(() => { editor.emitGraphChange(); });
    act(() => { useCanvasTabStore.setState({ activeTabKey: 'canvas' }); });
    rerender();

    await waitFor(() => expect(calls).toContain('resume'));
    // 切回主画布前先写盘副本
    expect(canvasStoreMock.saveCanvas).toHaveBeenCalled();
    expect(calls.indexOf('resume')).toBeGreaterThan(calls.lastIndexOf('replaceState'));
  });
});
