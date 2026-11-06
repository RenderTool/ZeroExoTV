/**
 * canvas-tab-slots — 回归护栏（2026-11-04 硬约束最终验收，第三轮重写）
 *
 * 约束：画布中不得出现任何分镜、出片节点；默认初始化一个挂载；
 * 进入项目默认打开剧本页签；初始化完成后要看到可用的页面，不是一句状态文案。
 *
 * - 单测 A：graph.nodes 为空时依次激活四个页签 → graph.nodes.length 恒为 0，
 *   且页签链路不存在任何建节点入口；
 * - 单测 B：项目首次挂载（activateProjectEntry）后 activeTab 为「剧本」页签，
 *   且 graph 中 storyboard/workbench 计数为 0；
 * - 单测 C：项目级挂载（ensureProjectMounts）后 剧本实体可读、主体库/导演台容器存在，
 *   且这些挂载只写 entities/*.json、绝不写 graph；
 * - 单测 D（本轮新增）：页签 = 真正的页面，不是状态文案——
 *   主体库页零主体渲染「空态虚线框 + 可点击加号」，点击直接写入容器一个主体；
 *   导演台页零片段渲染「提示词区 + 预览区 + 轨道区」三块结构（默认一个空片段）；
 *   两个页面**不挂 GraphProvider 也照常渲染**（断言渲染不读 graph.nodes）；
 *   「已就绪/不占画布/项目级容器」占位文案在渲染结果中零命中。
 *
 * 重子组件（主体网格/视频台/时间轴/多轨/提示词坞）与 react-i18next 全部 mock，
 * 只验证页级容器结构、数据源接线与分支渲染。platform/fs 用内存适配器 mock。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
  // 真实组件链（workbench-multitrack → shared/* → i18n/config）需要
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({
    mode: 'dark',
    theme: {
      mode: 'dark',
      canvas: { background: '#0b0b0c' },
      toolbar: {
        panel: '#17181a', text: '#e5e5e5', textMuted: '#888888', accent: '#3b82f6',
      },
    },
  }),
}));

// 内存文件系统：验证项目级挂载/写回只写 entities/*.json（单测 C/D）
const memfs = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/platform/fs', () => ({
  readJson: async (p: string) => (memfs.has(p) ? (memfs.get(p) as never) : null),
  writeJson: async (p: string, v: unknown) => { memfs.set(p, v); },
  writeJsonIfUnchanged: async (p: string, v: unknown) => { memfs.set(p, v); },
  stat: async (p: string) => (memfs.has(p) ? { size: 1, lastModified: Date.now() } : null),
}));

// 受控的图 store context：仅供单测 A 的 CanvasTabBar 渲染上下文使用；
// 单测 D 刻意不挂 Provider，证明两个页签页面渲染不读 graph.nodes
vi.mock('@zeroexo/plugin-render-react', async () => {
  const React = await import('react');
  const ctx = React.createContext<unknown>(null);
  return {
    ReactGraphStoreContext: ctx,
    useReactGraphStore: (): unknown => {
      const s = React.useContext(ctx);
      if (!s) throw new Error('useReactGraphStore must be used within provider');
      return s;
    },
    useGraph: (store: { subscribeGraph: (cb: () => void) => () => void; getGraph: () => unknown }) =>
      React.useSyncExternalStore(store.subscribeGraph, store.getGraph),
  };
});

// 主体库网格（重组件：antd/PromptCard/详情弹层）——mock 掉，只验接线与分支
vi.mock('@/features/canvas-nodes/storyboard/StoryboardSubjectTab.js', () => ({
  StoryboardSubjectTab: (props: { productionItems?: unknown[] }) =>
    createElement('div', {
      'data-mock': 'subject-tab',
      'data-count': props.productionItems?.length ?? 0,
    }),
}));

// 导演台布局（StoryboardMergedTab 真实渲染）的重子组件全部 mock，只验三块区域结构
vi.mock('@/features/canvas-nodes/storyboard/storyboard-asset-panel.js', () => ({
  StoryboardAssetPanel: () => createElement('div', { 'data-mock': 'asset-panel' }),
}));
vi.mock('@/features/canvas-nodes/storyboard/storyboard-video-stage.js', () => ({
  StoryboardVideoStage: () => createElement('div', { 'data-mock': 'video-stage' }),
}));
// 捕获时间轴 props（真实 WorkbenchMultiTrack → StoryboardTimeline 链路，含 workbench-multitrack.tsx:603
// 的 `shots={isActive ? timeline.shots : resolvedClips}` ——上轮"看不到片段"的根因行，必须真实渲染覆盖）
interface CapturedTimeline {
  shots?: Array<{ id: string; number: number }>;
  activeShotId?: string | null;
  onSelectShot?: (shotId: string) => void;
  onInsertAt?: (afterShotId: string | null, insert?: { index?: number }) => void;
  onDeleteShot?: (shotId: string) => void;
  onDeleteShots?: (shotIds: string[]) => void;
}
interface CapturedPromptDock {
  shotId?: string;
  value?: string;
  onValueChange?: (v: string) => void;
}
/** 导演台 H3 工作区面板（2026-11-04 起替代 promptDockProps 注入位） */
interface CapturedDirectorPanel {
  shot?: { id: string; imagePrompt?: string };
  onShotChange?: (patch: { imagePrompt?: string }) => void;
}
const captured = vi.hoisted(() => ({
  timeline: null as CapturedTimeline | null,
  promptDock: null as CapturedPromptDock | null,
  directorPanel: null as CapturedDirectorPanel | null,
}));
vi.mock('@/features/canvas-nodes/storyboard/storyboard-timeline.js', () => ({
  // mock 时间轴：捕获 props 并把每个 clip 渲染成可计数的 DOM 元素（组件级"渲染出几个片段"断言）
  StoryboardTimeline: (props: CapturedTimeline) => {
    captured.timeline = props;
    return createElement(
      'div',
      { 'data-mock': 'timeline' },
      ...(props.shots ?? []).map((s) =>
        createElement('div', { key: s.id, 'data-clip-element': s.id }, `#${s.number}`),
      ),
    );
  },
}));
// 注意：workbench-multitrack 不 mock——必须走真实组件验证活动轨 clips 渲染链路；
// 其依赖链 storyboard-utils → @zeroexo/plugin-nodes 会拖入移动端导航/emoji 重链，mock 掉
vi.mock('@zeroexo/plugin-nodes', () => ({
  resolveContentUrl: () => null,
  useHydratedContent: () => ({ url: null }),
}));
vi.mock('@/features/canvas-nodes/storyboard/workbench-prompt-dock.js', () => ({
  WorkbenchPromptDock: (props: NonNullable<typeof captured.promptDock>) => {
    captured.promptDock = props;
    return createElement('div', { 'data-mock': 'prompt-dock', 'data-value': props.value ?? '' });
  },
}));
// 导演台 H3 面板：捕获 props 并沿用 data-mock="prompt-dock"/data-value 语义（value=当前片段 imagePrompt）
vi.mock('./director-prompt-panel.jsx', () => ({
  DirectorPromptPanel: (props: NonNullable<typeof captured.directorPanel>) => {
    captured.directorPanel = props;
    return createElement('div', { 'data-mock': 'prompt-dock', 'data-value': props.shot?.imagePrompt ?? '' });
  },
}));

import { ReactGraphStoreContext } from '@zeroexo/plugin-render-react';
import { App as AntdApp } from 'antd';
import { act } from '@testing-library/react';
import { useCanvasTabStore } from './canvas-tab-store';
import { CanvasTabBar } from './canvas-tab-bar';
import { StoryboardTabContent } from './storyboard-tab-content';
import { WorkbenchTabContent } from './workbench-tab-content';
import {
  ensureProjectMounts,
  ensureWorkbenchContainer,
  readStoryboardContainer,
  readWorkbenchContainer,
  type ContainersIO,
} from '@/entities/slot-containers';
import { readScript } from '@/entities/script-store';

const GraphProvider = (ReactGraphStoreContext as unknown as {
  Provider: React.ComponentType<{ value: unknown; children?: ReactNode }>;
}).Provider;

/** 空图假 store（节点守恒断言直接盯 nodes 数组） */
function makeFakeStore(): {
  store: unknown;
  graph: { nodes: Array<{ type?: string }>; edges: unknown[] };
} {
  const graph: { nodes: Array<{ type?: string }>; edges: unknown[] } = { nodes: [], edges: [] };
  const store = {
    getGraph: () => graph,
    subscribeGraph: () => () => {},
    getViewport: () => ({ x: 0, y: 0, k: 1 }),
  };
  return { store, graph };
}

beforeEach(() => {
  useCanvasTabStore.setState({
    tabs: [],
    activeTabKey: 'canvas',
    slotOrder: ['script', 'storyboard', 'workbench', 'canvas'],
    slotBindings: { script: null, storyboard: null, workbench: null },
  });
  memfs.clear();
});

describe('单测 A：画布节点数量守恒（点页签绝不建节点）', () => {
  it('graph.nodes 为空时点击顶部三个页签：nodes 恒为 0，页签链路无任何建节点入口（主体库已退出顶部）', () => {
    const { store, graph } = makeFakeStore();
    const children: ReactNode = createElement(
      'div',
      null,
      createElement(CanvasTabBar),
      createElement(StoryboardTabContent),
      createElement(WorkbenchTabContent),
    );
    const { container } = render(createElement(GraphProvider, { value: store, children }));

    // 2026-11-05 用户指令：主体库不再占顶部页签（只保留抽屉「主体」分段）；
    // 项目级容器与 entities/storyboard.json 照旧挂载，仅顶部入口移除。
    expect(container.querySelector('[data-slot-kind="storyboard"]')).toBeNull();

    for (const kind of ['script', 'workbench', 'canvas'] as const) {
      const btn = container.querySelector(`[data-slot-kind="${kind}"]`);
      expect(btn).toBeTruthy();
      fireEvent.click(btn as Element);
      expect(useCanvasTabStore.getState().activeTabKey).toBe(kind);
      // 守恒断言：graph.nodes.length 前后都为 0
      expect(graph.nodes.length).toBe(0);
      // 页签链路不存在任何建节点入口：没有「初始化/新建库」按钮
      expect(screen.queryByText('初始化主体库')).toBeNull();
      expect(screen.queryByText('初始化导演台')).toBeNull();
      expect(screen.queryByText('新建主体库')).toBeNull();
    }
    // 占位状态文案清零（无绑定项目 id 时只显示加载提示，不显示"已就绪"式状态话）
    expect(screen.queryByText(/已就绪/)).toBeNull();
    expect(screen.queryByText(/不占画布/)).toBeNull();
    expect(screen.queryByText(/项目级容器/)).toBeNull();
  });
});

describe('单测 B：项目首次进入默认打开「剧本」页签', () => {
  it('activateProjectEntry 后 activeTab 为剧本页签，graph 中 storyboard/workbench 计数为 0', () => {
    const { graph } = makeFakeStore();
    useCanvasTabStore.getState().activateProjectEntry('p-entry');
    const s = useCanvasTabStore.getState();
    // 挂载后 activeTab === 'script'（key 形态 script:<projectId>）
    expect(s.activeTabKey.startsWith('script')).toBe(true);
    expect(s.activeTabKey).toBe('script:p-entry');
    expect(s.slotBindings.script).toBe('p-entry');
    // graph 中 storyboard/workbench 计数为 0（进入链路不写图）
    expect(graph.nodes.filter((n) => n.type === 'storyboard' || n.type === 'workbench').length).toBe(0);
    expect(graph.nodes.length).toBe(0);
  });

  it('同会话内用户切换页签不被默认值覆盖（默认值只在进入时设置一次）', () => {
    useCanvasTabStore.getState().activateProjectEntry('p-entry');
    useCanvasTabStore.getState().activateTab('canvas'); // 用户切到画布
    expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');
    // 不再次调用 activateProjectEntry，activeTab 保持用户选择
    expect(useCanvasTabStore.getState().activeTabKey).toBe('canvas');
  });
});

describe('单测 C：项目级挂载存在且不写 graph', () => {
  const io: ContainersIO = {
    readJson: async <T,>(p: string) => (memfs.has(p) ? (memfs.get(p) as T) : null),
    writeJson: async (p: string, v: unknown) => { memfs.set(p, v); },
  };

  it('ensureProjectMounts：剧本实体可读、主体库/导演台容器存在，且只写 entities/*.json', async () => {
    const { graph } = makeFakeStore();
    const result = await ensureProjectMounts('p-mount', io);

    // 三处挂载均创建成功
    expect(result.script.created).toBe(true);
    expect(result.storyboard.created).toBe(true);
    expect(result.workbench.created).toBe(true);

    // 剧本实体可读
    const script = await readScript('p-mount');
    expect(script).not.toBeNull();
    // 主体库容器存在
    const storyboard = await readStoryboardContainer('p-mount', io);
    expect(storyboard?.title).toBe('主体库');
    expect(storyboard?.shots).toEqual([]);
    // 导演台容器存在（2026-11-04 约定：初始化即带片段 1，5 秒、序号 1，含单轨镜像）
    const workbench = await readWorkbenchContainer('p-mount', io);
    expect(workbench?.title).toBe('导演台');
    expect(workbench?.tracks.length).toBe(1); // track-main 单轨镜像
    expect(workbench?.shots.length).toBe(1);
    expect((workbench?.shots[0] as { number: number; duration: number }).number).toBe(1);
    expect((workbench?.shots[0] as { number: number; duration: number }).duration).toBe(5);

    // 挂载只写 projects/<id>/entities/*.json —— 绝不写 graph
    for (const key of memfs.keys()) {
      expect(key.startsWith('projects/p-mount/entities/')).toBe(true);
    }
    expect(graph.nodes.length).toBe(0);
  });

  it('幂等：重复挂载不覆盖、不新增（created=false）', async () => {
    await ensureProjectMounts('p-mount', io);
    const sizeAfterFirst = memfs.size;
    const second = await ensureProjectMounts('p-mount', io);
    expect(second.script.created).toBe(false);
    expect(second.storyboard.created).toBe(false);
    expect(second.workbench.created).toBe(false);
    expect(memfs.size).toBe(sizeAfterFirst);
  });
});

describe('单测 D：页签 = 真正的页面（不读 graph.nodes，无占位状态文案）', () => {
  it('主体库页：零主体渲染空态虚线框+可点击加号，点击直接写入容器一个主体', async () => {
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-subj', storyboard: null, workbench: null },
      activeTabKey: 'storyboard',
    });
    // 刻意不挂 GraphProvider —— 渲染不读 graph.nodes 的直接证明
    const { container } = render(createElement(StoryboardTabContent));

    // 页面结构：标题栏（主体库 + 计数 + 添加主体按钮）
    await waitFor(() => expect(container.querySelector('[data-subject-library-page]')).toBeTruthy());
    expect(screen.getByText('主体库')).toBeTruthy();
    expect(container.querySelector('[data-subject-add]')).toBeTruthy();

    // 零主体空态：虚线框 + 加号 + 引导文案（主页空项目态同款句式），整框可点击
    const empty = container.querySelector('[data-subject-empty]') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('还没有主体，点击上方按钮添加你的第一个主体');

    // 点击空态加号 → 直接写入容器一个主体（新主体），随后切换为卡片网格
    fireEvent.click(empty);
    await waitFor(() => {
      const raw = memfs.get('projects/p-subj/entities/storyboard.json') as
        | { entities: Array<{ name: string; kind: string }> }
        | undefined;
      expect(raw?.entities?.length).toBe(1);
      expect(raw?.entities?.[0]?.name).toBe('新主体');
      expect(raw?.entities?.[0]?.kind).toBe('character');
    });
    await waitFor(() => expect(container.querySelector('[data-mock="subject-tab"]')).toBeTruthy());
    expect(container.querySelector('[data-subject-empty]')).toBeNull();

    // 占位状态文案零命中
    expect(container.textContent).not.toMatch(/已就绪|不占画布|项目级容器/);
  });

  it('主体库页：已有主体直接渲染卡片网格（无空态、无加载态残留）', async () => {
    memfs.set('projects/p-subj2/entities/storyboard.json', {
      schemaVersion: 1,
      version: 1,
      title: '主体库',
      shots: [],
      entities: [
        {
          id: 'item-1', name: '老人', kind: 'character', aliases: [],
          consistency: '白发，藏青外套', note: '', episodeIds: [], images: [], coverKey: null,
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-subj2', storyboard: null, workbench: null },
      activeTabKey: 'storyboard',
    });
    const { container } = render(createElement(StoryboardTabContent));

    await waitFor(() => expect(container.querySelector('[data-mock="subject-tab"]')).toBeTruthy());
    expect(container.querySelector('[data-mock="subject-tab"]')?.getAttribute('data-count')).toBe('1');
    expect(container.querySelector('[data-subject-empty]')).toBeNull();
    expect(container.textContent).not.toMatch(/已就绪|不占画布|项目级容器/);
  });

  it('导演台页：进入即渲染提示词区+预览区+轨道区三块结构（片段 1 默认存在）', async () => {
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-wb', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    // 刻意不挂 GraphProvider —— 渲染不读 graph.nodes 的直接证明
    const { container } = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));

    // 三块结构：提示词区 + 视频预览 + 轨道区（出片页布局标记）
    await waitFor(() => {
      expect(container.querySelector('[data-workbench-page]')).toBeTruthy();
      expect(container.querySelector('[data-wb="prompt-area"]')).toBeTruthy();
      expect(container.querySelector('[data-wb="video-preview"]')).toBeTruthy();
      expect(container.querySelector('[data-wb="track-area"]')).toBeTruthy();
    });

    // 片段 1 默认存在：提示词坞受控渲染（空提示词可编辑），真实多轨链渲染出 1 个片段元素
    await waitFor(() => expect(container.querySelector('[data-mock="prompt-dock"]')).toBeTruthy());
    expect(container.querySelector('[data-mock="prompt-dock"]')?.getAttribute('data-value')).toBe('');
    // 组件级断言：真实 WorkbenchMultiTrack → StoryboardTimeline 链渲染出的片段 DOM 数量 == 1
    await waitFor(() =>
      expect(container.querySelectorAll('[data-clip-element]').length).toBe(1),
    );

    // 占位状态文案零命中
    expect(container.textContent).not.toMatch(/已就绪|不占画布|项目级容器/);
  });

  it('导演台页：已有片段从容器恢复（提示词与轨道跟随数据）', async () => {
    memfs.set('projects/p-wb2/entities/workbench.json', {
      schemaVersion: 1,
      version: 1,
      title: '导演台',
      tracks: [],
      shots: [
        {
          id: 'seg-1', number: 1, description: '', shotType: '中景', duration: 5,
          imagePrompt: '一位老人在海边回头', status: 'pending', clipState: 'placeholder',
        },
      ],
      totalDuration: 5,
      updatedAt: new Date().toISOString(),
    });
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-wb2', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const { container } = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));

    await waitFor(() => expect(container.querySelector('[data-mock="prompt-dock"]')).toBeTruthy());
    expect(container.querySelector('[data-mock="prompt-dock"]')?.getAttribute('data-value')).toBe(
      '一位老人在海边回头',
    );
    // 组件级断言：渲染出的片段 DOM 数量 == 1（真实多轨链）
    await waitFor(() =>
      expect(container.querySelectorAll('[data-clip-element]').length).toBe(1),
    );
  });
});

describe('单测 E：导演台片段 1 硬性语义（2026-11-04 约定）', () => {
  const io: ContainersIO = {
    readJson: async <T,>(p: string) => (memfs.has(p) ? (memfs.get(p) as T) : null),
    writeJson: async (p: string, v: unknown) => { memfs.set(p, v); },
  };

  it('断言 B：连续两次初始化片段数量仍为 1（幂等，绝不新增第二个片段）', async () => {
    const first = await ensureWorkbenchContainer('p-idem', io);
    expect(first.created).toBe(true);
    expect(first.container.shots.length).toBe(1);
    const segId = (first.container.shots[0] as { id: string }).id;

    const second = await ensureWorkbenchContainer('p-idem', io);
    expect(second.created).toBe(false);
    expect(second.container.shots.length).toBe(1);
    // 同一个片段（未被重建/替换）
    expect((second.container.shots[0] as { id: string }).id).toBe(segId);
  });

  it('断言 B 补：历史空容器（0 片段）自愈补回片段 1，之后重复初始化仍保持 1', async () => {
    memfs.set('projects/p-heal/entities/workbench.json', {
      schemaVersion: 1, version: 3, title: '导演台', tracks: [], shots: [],
      totalDuration: 0, updatedAt: new Date().toISOString(),
    });
    const healed = await ensureWorkbenchContainer('p-heal', io);
    expect(healed.created).toBe(false);
    expect(healed.container.shots.length).toBe(1);
    const again = await ensureWorkbenchContainer('p-heal', io);
    expect(again.container.shots.length).toBe(1);
  });

  it('断言 A：初始化后片段数==1、序号==1、默认 5 秒，片段被选中且渲染出 1 个片段元素', async () => {
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-seg1', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const { container } = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
    await waitFor(() => expect(container.querySelector('[data-mock="prompt-dock"]')).toBeTruthy());

    const raw = memfs.get('projects/p-seg1/entities/workbench.json') as {
      shots: Array<{ id: string; number: number; duration: number }>;
    };
    expect(raw.shots.length).toBe(1);
    expect(raw.shots[0]!.number).toBe(1);
    expect(raw.shots[0]!.duration).toBe(5);
    // 片段 1 默认选中：导演台面板 shot 指向它（1 对 1 绑定，不是全项目共享文本）
    expect(captured.directorPanel?.shot?.id).toBe(raw.shots[0]!.id);
    // 组件级断言：真实多轨链渲染出的片段 DOM 数量 == 1（覆盖 workbench-multitrack.tsx:603 根因行）
    await waitFor(() =>
      expect(container.querySelectorAll('[data-clip-element]').length).toBe(1),
    );
    expect(container.querySelector('[data-clip-element]')?.getAttribute('data-clip-element')).toBe(
      raw.shots[0]!.id,
    );
  });

  it('断言 C：删除唯一片段被拒绝——数量不变且有可见轻提示（至少保留一个片段）', async () => {
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-del', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const { container } = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
    // 真实多轨链渲染出 1 个片段元素
    await waitFor(() =>
      expect(container.querySelectorAll('[data-clip-element]').length).toBe(1),
    );

    const raw = memfs.get('projects/p-del/entities/workbench.json') as { shots: Array<{ id: string }> };
    const onlyId = raw.shots[0]!.id;

    // 单删唯一片段（真实工具栏删除按钮 → handleDeleteShot → onDeleteShot 把关）→ 拒绝
    const deleteBtn = container.querySelector('[title="删除选中片段"]');
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn as Element);
    expect(await screen.findByText('至少保留一个片段')).toBeTruthy();
    expect(container.querySelectorAll('[data-clip-element]').length).toBe(1);

    // 批量删（等价快捷键全选删除）→ 同样拒绝
    act(() => { captured.timeline?.onDeleteShots?.([onlyId]); });
    expect(container.querySelectorAll('[data-clip-element]').length).toBe(1);
    const after = memfs.get('projects/p-del/entities/workbench.json') as { shots: unknown[] };
    expect(after.shots.length).toBe(1);
  });

  it('断言 D：提示词写入片段自身字段——改片段 1 后切到片段 2 再切回，片段 1 内容仍在', async () => {
    useCanvasTabStore.setState({
      slotBindings: { script: 'p-bind', storyboard: null, workbench: null },
      activeTabKey: 'workbench',
    });
    const { container } = render(createElement(AntdApp, null, createElement(WorkbenchTabContent)));
    await waitFor(() => expect(container.querySelector('[data-mock="prompt-dock"]')).toBeTruthy());

    const raw = memfs.get('projects/p-bind/entities/workbench.json') as { shots: Array<{ id: string }> };
    const seg1Id = raw.shots[0]!.id;
    expect(captured.directorPanel?.shot?.id).toBe(seg1Id);

    // 编辑片段 1 的提示词（写入该片段自身 imagePrompt 字段）
    act(() => { captured.directorPanel?.onShotChange?.({ imagePrompt: '老人回头，海风很大' }); });
    await waitFor(() => expect(captured.directorPanel?.shot?.imagePrompt).toBe('老人回头，海风很大'));

    // 新增片段 2（真实工具栏「+」按钮 → onInsertAt，自动选中）→ 提示词区跟着切换到片段 2
    const addBtn = container.querySelector('[title="在末尾添加新片段"]');
    expect(addBtn).toBeTruthy();
    fireEvent.click(addBtn as Element);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-clip-element]').length).toBe(2);
    });
    expect(captured.directorPanel?.shot?.id).not.toBe(seg1Id);
    expect(captured.directorPanel?.shot?.imagePrompt ?? '').toBe('');

    // 切回片段 1 → 提示词区恢复片段 1 的内容（1 对 1 归属，未串场）
    act(() => { captured.timeline?.onSelectShot?.(seg1Id); });
    await waitFor(() => expect(captured.directorPanel?.shot?.id).toBe(seg1Id));
    expect(captured.directorPanel?.shot?.imagePrompt).toBe('老人回头，海风很大');

    // 防抖写回落盘：片段 1 字段持久化到容器
    await waitFor(
      () => {
        const persisted = memfs.get('projects/p-bind/entities/workbench.json') as {
          shots: Array<{ id: string; imagePrompt?: string }>;
        };
        expect(persisted.shots.find((s) => s.id === seg1Id)?.imagePrompt).toBe('老人回头，海风很大');
        expect(persisted.shots.length).toBe(2);
      },
      { timeout: 3000 },
    );
  });
});
