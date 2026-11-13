/**
 * 主体库页面化（2026-11-05）单测：三级导航/面包屑、发送直达当前状态、无当前状态弹层、
 * 返回不丢草稿、刷新恢复层级、navigateToView('subject') 扩展。
 *
 * 断言全部盯真实 DOM 可见（页面标记/面包屑/卡片/输入值），不以「回调被调用」代替。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { App as AntdApp } from 'antd';

vi.mock('react-i18next', () => ({
  // DockFooterBar 静态链路会加载 i18n/config；给 mock 补一个可被 `.use()` 的插件占位
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const opts = (typeof fallback === 'object' ? fallback : options) as Record<string, unknown> | undefined;
      const tpl = typeof fallback === 'string'
        ? fallback
        : (opts?.defaultValue as string | undefined) ?? key;
      // 模拟 i18next 的 {{name}} 插值（3 参 / 2 参两种调用都覆盖）
      return opts
        ? Object.entries(opts).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)), tpl)
        : tpl;
    },
  }),
}));

const memfs = vi.hoisted(() => new Map<string, unknown>());
/** 剧本集数据源（可被单个用例改写；默认两集） */
const scriptMock = vi.hoisted(() => ({
  episodes: [
    { id: 'ep-1', number: 1, title: '第一集' },
    { id: 'ep-2', number: 2, title: '第二集' },
  ] as Array<{ id: string; number: number; title: string }>,
  meta: null as null | { visualStyle?: { presetId: string; name: string; prompt: string } },
}));
vi.mock('@/platform/fs', () => ({
  readJson: async (p: string) => (memfs.has(p) ? (memfs.get(p) as never) : null),
  writeJson: async (p: string, v: unknown) => { memfs.set(p, v); },
  writeJsonIfUnchanged: async (p: string, v: unknown) => { memfs.set(p, v); },
  stat: async (p: string) => (memfs.has(p) ? { size: 1, lastModified: Date.now() } : null),
  listDir: async () => [] as string[],
}));

// 取图解析链：测试里把 storageKey 映射成可断言的 src（真实链路已由 use-media-object-url 单测覆盖）
vi.mock('@zeroexo/plugin-nodes', () => ({
  usePreviewImage: (key: string, fallback: string) => (key ? `/media/${key}` : fallback),
  nodeActionBus: { emit: vi.fn(), on: vi.fn(() => () => {}) },
}));
vi.mock('@/shared/utils/resource-url.js', () => ({
  getResourceUrl: (key: string) => `/media/${key}`,
}));
vi.mock('@/entities/cas-store.js', () => ({
  isCasStorageKey: () => false,
  parseCasStorageKey: () => null,
  hasCasEntry: async () => true,
  registerCasRef: async () => {},
  releaseCas: async () => {},
}));
vi.mock('@/entities/script-store.js', () => ({
  readScript: async () => ({ episodes: scriptMock.episodes, meta: scriptMock.meta ?? undefined }),
  watchScript: () => () => {},
  displayEpisodeTitle: (title: string | undefined, n: number) => title || `第${n}集`,
}));
vi.mock('@/features/auth/auth-store.js', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock('@/features/asset-picker/services/upload-asset.js', () => ({
  uploadAsset: async () => ({ data: { storageKey: 'uploaded-key' } }),
}));
vi.mock('./subject-media-source-panel.js', () => ({
  SubjectMediaSourcePanel: () => null,
}));

import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { SubjectLibraryPages } from './subject-library-pages';
import { SubjectLinkDialogHost, useSubjectLinkDialogStore } from './subject-link-dialog';
import { sendAssetToSubject } from './subject-send';
import { navigateToView, takePendingNavigateFocus } from '@/features/canvas-tabs/navigate-to-view.js';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { readStoryboardContainer } from '@/entities/slot-containers.js';
import { useSubjectMediaLinkEventStore } from './subject-state-media';
import { clearCurrentSubjectStateContext, getCurrentSubjectStateContext } from './subject-page-nav';
import { createSubjectNode, createSubjectTree, type SubjectTree } from './subject-tree-types';
import type { ProductionItem } from '../production-manager/production-manager-types';
import {
  UI_CARD_BORDER_WIDTH,
  UI_CARD_RADIUS,
  uiCardBorder,
  uiCardSurface,
} from '@/shared/ui/index.js';
import {
  SUBJECT_STATE_CARD_MIN_WIDTH,
  SUBJECT_STATE_COVER_ASPECT,
  subjectStateColumnsForWidth,
} from './subject-card-metrics';

const THEME = {
  mode: 'dark',
  toolbar: {
    panel: '#17181a', text: '#e5e5e5', textMuted: '#888888',
    accent: '#3b82f6', border: '#333333', danger: '#ef4444',
  },
} as never;

const PID = 'p-subject-pages';

function makeTree(): SubjectTree {
  const tr = createSubjectTree('character', '东海龙王');
  tr.rootId = 'subj-1';
  const base = tr.states[0]!; // 基础状态 = states[0] 真节点
  base.fullPrompt = '东海龙王三视图定妆';
  base.deltaPrompt = base.fullPrompt;
  const node = createSubjectNode('东海龙王 · 状态2', 'image', 'user', tr.rootId, { step: 2 });
  node.id = 'state-1';
  node.appearEpisodes = [1];
  tr.states = [base, node];
  return tr;
}

function makeItem(): ProductionItem {
  return {
    id: 'item-1', name: '东海龙王', kind: 'character', aliases: [], consistency: '龙首人身',
    note: '', episodeIds: [], images: [], coverKey: null,
  };
}

function seedContainer(projectId: string, tree: SubjectTree): void {
  memfs.set(`projects/${projectId}/entities/storyboard.json`, {
    schemaVersion: 1, version: 1, title: '主体库', shots: [], entities: [], subjectTree: [tree],
    updatedAt: new Date().toISOString(),
  });
}

function renderPages(
  tree: SubjectTree,
  projectId = PID,
  onChangeTree = vi.fn(),
  onUpdateItem = vi.fn(),
  opts: {
    embedded?: boolean; onAddSubject?: () => void;
    items?: ProductionItem[]; trees?: SubjectTree[];
    onUpdateItems?: (ids: readonly string[], patch: Partial<ProductionItem>) => void;
    onDeleteItems?: (ids: readonly string[]) => void;
    onDeleteItem?: (id: string) => void;
  } = {},
) {
  const shared = {
    productionItems: opts.items ?? [makeItem()],
    theme: THEME,
    projectId,
    subjectTree: opts.trees ?? [tree],
    onChangeTree,
    onUpdateItem,
    onUpdateItems: opts.onUpdateItems,
    onDeleteItem: opts.onDeleteItem ?? vi.fn(),
    onDeleteItems: opts.onDeleteItems,
    onAddSubject: opts.onAddSubject ?? vi.fn(),
  };
  return render(
    createElement(AntdApp, null,
      createElement(SubjectLibraryPages, {
        ...shared,
        embedded: opts.embedded,
      }),
      createElement(SubjectLinkDialogHost),
    ),
  );
}

async function openSubjectPage(): Promise<void> {
  fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
}

beforeEach(() => {
  memfs.clear();
  scriptMock.episodes = [
    { id: 'ep-1', number: 1, title: '第一集' },
    { id: 'ep-2', number: 2, title: '第二集' },
  ];
  scriptMock.meta = null;
  // 清掉上一条用例残留的 subject 页面 history marker / pending 聚焦请求，避免跨用例恢复层级
  window.history.replaceState(null, '');
  takePendingNavigateFocus();
  useViewPrefsStore.setState({
    assetLibrary: { viewMode: 'list', activeGroup: 'script', activeChild: 'image', search: '', hierarchyTypeFilter: 'all' },
    scriptEditor: { showLabels: true },
    subjectLibrary: { activeKind: 'all', activeEpisodeByProject: {} },
    subjectPages: { lastByProject: {} },
    workbench: { pixelsPerSecond: 40, activeEpisodeByProject: {} },
    canvasTabs: { lastSlotByProject: {}, openCanvasesByProject: {} },
  });
  useCanvasTabStore.setState({
    tabs: [], activeTabKey: 'canvas',
    slotOrder: ['script', 'storyboard', 'workbench', 'canvas'],
    slotBindings: { script: PID, storyboard: null, workbench: null },
  });
  useSubjectLinkDialogStore.getState().close();
  clearCurrentSubjectStateContext(PID, 'subj-1', 'state-1');
  useSubjectMediaLinkEventStore.setState({ version: 0, last: null });
});

describe('两级导航与面包屑', () => {
  it('列表 → 主体（就地展开编辑，不再叠第三级面包屑）', async () => {
    const tree = makeTree();
    renderPages(tree);

    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '主体库' })).toBeTruthy();

    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    // 面包屑二级：主体库 / 东海龙王（基础状态卡同名，限定面包屑内查找）
    expect(document.querySelector('[data-subject-crumb="subject"]')?.textContent).toContain('东海龙王');
    expect(document.querySelector('[data-state-card="state-1"]')).toBeTruthy();
    expect(document.querySelector('[data-state-card="__base__"]')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    // 仍在同一页：面包屑只到主体，状态由卡内编辑面板标出
    expect(document.querySelector('[data-subject-crumb="state"]')).toBeNull();
    expect(document.querySelector('[data-state-edit-panel]')?.getAttribute('data-state-id')).toBe('state-1');
    // 状态编辑字段（真实输入控件）：状态名就在卡片最上方，编辑态可直接改
    expect((document.querySelector('[data-state-name-input]') as HTMLInputElement).value).toBe('东海龙王 · 状态2');
    expect((document.querySelector('[data-field="prompt"]') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('出现集数')).toBeTruthy();

    // 点二级面包屑 → 收起编辑面板，回主体状态页
    fireEvent.click(document.querySelector('[data-subject-crumb="subject"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-page="state"]')).toBeNull();

    // 点一级面包屑 → 回列表页
    fireEvent.click(document.querySelector('[data-subject-crumb="library"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());
  });

  it('显式「返回上一级」按钮：状态页 → 主体页 → 列表页（一级页面不渲染返回）', async () => {
    const tree = makeTree();
    renderPages(tree);
    // 列表页（一级）：无返回按钮
    expect(document.querySelector('[data-subject-back]')).toBeNull();

    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    const backToLibrary = document.querySelector('[data-subject-back]') as HTMLButtonElement;
    expect(backToLibrary).toBeTruthy();
    expect(backToLibrary.getAttribute('aria-label')).toBe('返回上一级');

    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    // 状态页：返回 = 主体页
    fireEvent.click(document.querySelector('[data-subject-back]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-page="state"]')).toBeNull();
    // 主体页：返回 = 列表页
    fireEvent.click(document.querySelector('[data-subject-back]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());
  });

  it('添加状态后主体页计数即时更新（1 → 2）', async () => {
    const tree = makeTree();
    renderPages(tree);
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    expect(document.querySelector('[data-state-count]')?.textContent).toContain('1 状态');

    fireEvent.click(document.querySelector('[data-add-state]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-subject-crumb="subject"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    expect(document.querySelector('[data-state-count]')?.textContent).toContain('2 状态');
  });

  it('返回不丢草稿：状态页改提示词 → 回主体页 → 再进状态页仍在', async () => {
    const tree = makeTree();
    renderPages(tree);
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    fireEvent.change(document.querySelector('[data-field="prompt"]') as HTMLTextAreaElement, { target: { value: '左臂缠白色绷带' } });
    // 2026-11-12：提示词改为失焦提交（避免逐字落盘卡顿）
    fireEvent.blur(document.querySelector('[data-field="prompt"]') as HTMLTextAreaElement);
    fireEvent.click(document.querySelector('[data-subject-crumb="subject"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect((document.querySelector('[data-field="prompt"]') as HTMLTextAreaElement).value).toBe('左臂缠白色绷带');
  });
});

describe('刷新/重进项目恢复层级（按项目记忆）', () => {
  it('上次停在状态编辑页 → 重挂载直接展开该状态的编辑面板', async () => {
    useViewPrefsStore.getState().setSubjectPageLast(PID, { rootId: 'subj-1', stateId: 'state-1' });
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-state-edit-panel]')?.getAttribute('data-state-id')).toBe('state-1');
  });

  it('记忆的主体已被删除 → 回落到列表页', async () => {
    useViewPrefsStore.getState().setSubjectPageLast(PID, { rootId: 'subj-missing', stateId: null });
    renderPages(makeTree());
    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();
  });
});

describe('发送资产到主体', () => {
  it('当前停在状态编辑页 → 直达该状态（linkSubjectStateMedia 写容器 + 缩略图即时出现）', async () => {
    const tree = makeTree();
    seedContainer('p-send', tree);
    renderPages(tree, 'p-send');
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    await act(async () => {
      await sendAssetToSubject({ storageKey: 'asset-key-9', kind: 'image', sourceLabel: '画布资产' });
    });

    // 唯一写入函数落容器（真实数据断言，不是回调查用）
    const container = await readStoryboardContainer('p-send');
    const states = (container?.subjectTree as SubjectTree[] | undefined)?.[0]?.states ?? [];
    expect(states.find((s) => s.id === 'state-1')?.media?.[0]?.key).toBe('asset-key-9');

    // 状态编辑页缩略图即时可见
    await waitFor(() => expect(document.querySelector('img[data-subject-media-thumb]')).toBeTruthy());
    expect(document.querySelector('img[data-subject-media-thumb]')?.getAttribute('src')).toContain('asset-key-9');
    // 成功反馈（真实 toast 文案）
    expect(await screen.findByText(/已发送到/)).toBeTruthy();
    // 跳转目标 = 主体库页签
    expect(useCanvasTabStore.getState().activeTabKey).toBe('storyboard');
    expect(getCurrentSubjectStateContext()?.stateId).toBe('state-1');

    // 保存后状态卡缩略图即时更新（主体页卡片也走同一份本地树）
    fireEvent.click(document.querySelector('[data-subject-crumb="subject"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    expect(document.querySelector('[data-state-card="state-1"] img[data-subject-media-thumb]')).toBeTruthy();
  });

  it('无当前状态 → 弹出主体→状态选择弹层（真实 Modal 可见）', async () => {
    const tree = makeTree();
    seedContainer('p-dialog', tree);
    renderPages(tree, 'p-dialog');

    await act(async () => {
      const result = await sendAssetToSubject({ storageKey: 'asset-key-7', kind: 'image', sourceLabel: '我的资产' });
      expect(result).toBe('dialog');
    });

    // 复用现有 subject-link-dialog 形态：Modal 标题可见
    expect(await screen.findByText('发送到主体状态')).toBeTruthy();
    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();
  });
});

describe('统一导航入口扩展 subject', () => {
  it("navigateToView('subject', {rootId,stateId}) → 事件直达状态编辑面板", async () => {
    const tree = makeTree();
    renderPages(tree);
    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();

    act(() => {
      navigateToView('subject', { rootId: 'subj-1', stateId: 'state-1', projectId: PID });
    });
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-state-edit-panel]')?.getAttribute('data-state-id')).toBe('state-1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe('storyboard');
  });
});

describe('卡片视觉对齐资产库（2026-11-05 用户拍板）', () => {
  it('主体卡与资产卡共用 shared/ui：圆角/细边界/名称/元信息/中性徽标', async () => {
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());

    // token 契约 = 资产卡同一取值源（asset-card.tsx 引用同一组函数）
    expect(UI_CARD_RADIUS).toBe(12);
    expect(UI_CARD_BORDER_WIDTH).toBe(1);
    expect(uiCardBorder(THEME)).toBe('1px solid rgba(255,255,255,0.10)');
    expect(uiCardSurface(THEME)).toBe('rgba(255,255,255,0.02)');

    const card = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;
    const cover = card.querySelector('[data-subject-card-cover]') as HTMLElement;
    expect(cover.style.borderRadius).toBe('12px');
    expect(cover.style.border.replace(/\s/g, '')).toBe('1pxsolidrgba(255,255,255,0.1)');
    expect(cover.style.background.replace(/\s/g, '')).toBe('rgba(255,255,255,0.02)');
    // 卡片外壳来自 shared/ui（与资产卡同一组件）
    expect(cover.hasAttribute('data-ui-card-shell')).toBe(true);

    const name = card.querySelector('[data-subject-card-name]') as HTMLElement;
    expect(name.style.fontSize).toBe('12px');
    expect(name.style.lineHeight).toBe('22px');
    expect(name.style.fontWeight).toBe('500');

    const meta = card.querySelector('[data-subject-card-meta]') as HTMLElement;
    expect(meta.style.fontSize).toBe('11px');
    expect(meta.style.fontWeight).toBe('500');

    // 角标：shared/ui 中性徽标；类型不参与着色（角色/场景/道具统一中性灰）
    const badge = card.querySelector('[data-subject-card-badge]') as HTMLElement;
    expect(badge.hasAttribute('data-thumb-badge')).toBe(true);
    expect(badge.style.borderRadius).toBe('4px');
    expect(badge.style.fontSize).toBe('10px');
    expect(badge.style.background.replace(/\s/g, '')).toBe('rgba(0,0,0,0.62)');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');
  });

  it('收色：整页唯一强调色 = 主题 accent，主体库零绿色', async () => {
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    const card = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;

    // 绿色零残留（旧 LIBRARY_ACCENT #00c758 / rgba(0,199,88,*)）
    expect(document.body.innerHTML).not.toMatch(/0,\s*199,\s*88|#00c758|#0a8a43|rgba\(34,\s*197,\s*94/i);

    // 主按钮：走 antd 主操作（theme accent），不再自绘绿色实底
    const addBtn = document.querySelector('[data-subject-add]') as HTMLElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.className).toContain('ant-btn-primary');

    // 类型 Tab：选中 = 主题 accent 下划线 + 主文本色；未选中 = 中性 muted
    const active = document.querySelector('[data-subject-kind-filter="all"]') as HTMLElement;
    expect((active.querySelector('[data-kind-underline]') as HTMLElement).style.background).toContain('rgb(59, 130, 246)');
    expect(active.style.color).toBe('rgb(229, 229, 229)');
    const idle = document.querySelector('[data-subject-kind-filter="prop"]') as HTMLElement;
    expect((idle.querySelector('[data-kind-underline]') as HTMLElement).style.background).toBe('transparent');
    expect(idle.style.color).toBe('rgb(136, 136, 136)');

    // 类型角标：一律中性灰，不按类型上色
    const badge = card.querySelector('[data-subject-card-badge]') as HTMLElement;
    expect(badge.style.background.replace(/\s/g, '')).toBe('rgba(0,0,0,0.62)');
    expect(badge.style.color).toBe('rgb(255, 255, 255)');

    // 空封面：中性灰剪影（lucide svg）+ 中性灰文字，不再用彩色 emoji
    const cover = card.querySelector('[data-subject-card-cover]') as HTMLElement;
    expect(cover.querySelector('svg')).toBeTruthy();
    expect(cover.textContent).toContain('暂无封面图');
    expect(cover.textContent).not.toContain('👤');

    // 2026-11-05 用户指令：主体卡 hover 行为与资产卡一致——不改边框（accent 环只留给真实选中态），
    // 只上遮罩 + 浮出动作（资产卡 AssetCardGrid 同样不给 CardShell 传 hovered）。
    fireEvent.mouseEnter(card);
    await waitFor(() => expect(cover.style.border).not.toContain('rgb(59, 130, 246)'));
    expect(cover.style.border).toContain('rgba(255, 255, 255, 0.1)');
  });

  it('悬停露出动作入口（进入主体 / 改类型 / 删除），与资产卡 hover 行为同构', async () => {
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    const card = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;
    const actions = card.querySelector('[data-subject-card-actions]') as HTMLElement;
    expect(actions.style.opacity).toBe('0');
    fireEvent.mouseEnter(card);
    await waitFor(() => expect(actions.style.opacity).toBe('1'));
    expect(actions.querySelector('[data-card-action="enter"]')).toBeTruthy();
    expect(actions.querySelector('[data-card-action="delete"]')).toBeTruthy();
    expect(actions.querySelector('[data-card-action="kind"]')).toBeTruthy();
  });

  // 2026-11-05 用户反馈：「主体没法改类型？？改类型会错误的跳转具体主体状态页」
  // 根因：antd Dropdown 菜单在 portal，但 React 事件沿组件树冒泡到卡片 onClick → 抢在写入前导航
  it('卡片内「改类型」只写类型，不误跳主体状态页', async () => {
    const onChangeTree = vi.fn();
    const onUpdateItem = vi.fn();
    renderPages(makeTree(), PID, onChangeTree, onUpdateItem);
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    const card = document.querySelector('[data-subject-card="item-1"]') as HTMLElement;

    fireEvent.mouseEnter(card);
    fireEvent.click(card.querySelector('[data-card-action="kind"]') as Element);
    await waitFor(() => expect(document.querySelector('.ant-dropdown')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-subject-kind-option="scene"]') as Element);

    // 类型写入发生（有树 → commitTrees + 条目写回），且仍在列表页
    await waitFor(() => expect(onChangeTree).toHaveBeenCalled());
    expect(document.querySelector('[data-subject-page="subject"]')).toBeNull();
    expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy();
  });

  it('状态卡：固定卡片尺寸 / 最小宽 260 / 信息在封面下 / 无右侧箭头', async () => {
    renderPages(makeTree());
    await openSubjectPage();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    expect(card.style.minWidth).toBe(`${SUBJECT_STATE_CARD_MIN_WIDTH}px`);
    expect(card.style.flexDirection).toBe('column');
    const cover = card.querySelector('[data-state-cover]') as HTMLElement;
    // 2026-11-12：详情页用固定卡片（16:9），图片 contain 完整显示
    expect(cover.style.aspectRatio.replace(/\s/g, '')).toBe('16/9');
    expect(cover.style.borderRadius).toBe('12px');

    // 信息区是最后一个直接子节点（右侧箭头已删除）
    expect((card.lastElementChild as HTMLElement).hasAttribute('data-state-info')).toBe(true);
    expect(card.querySelector('[data-state-arrow]')).toBeNull();

    const name = card.querySelector('[data-state-name]') as HTMLElement;
    expect(name.textContent).toContain('东海龙王 · 状态2');
    expect(name.style.fontSize).toBe('12px');
    expect(card.querySelector('[data-state-episodes]')).toBeNull();
    expect(card.querySelector('[data-state-ready]')).toBeTruthy();
  });

  it('「添加状态」= 原来的整宽虚线格（不改页头主按钮样式）', async () => {
    renderPages(makeTree());
    await openSubjectPage();

    expect(document.querySelectorAll('[data-add-state]').length).toBe(1);
    const add = document.querySelector('[data-add-state]') as HTMLElement;
    expect(add.tagName).toBe('BUTTON');
    expect(add.className).not.toContain('ant-btn');
    expect(add.style.width).toBe('100%');
    expect(add.style.border).toContain('dashed');
    expect(add.textContent).toContain('添加新状态');
    // 旧形态零残留
    expect(document.querySelector('[data-add-state-cover]')).toBeNull();
    expect(document.querySelector('[data-add-state-header]')).toBeNull();
    expect(document.body.textContent).not.toContain('悬停状态卡可编辑或删除');
  });

  it('状态卡悬停露出「换图 / 删除」；编辑靠点卡片，基础状态不提供删除入口', async () => {
    renderPages(makeTree());
    await openSubjectPage();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    const actions = card.querySelector('[data-state-actions]') as HTMLElement;
    expect(actions.style.opacity).toBe('0');
    fireEvent.mouseEnter(card);
    await waitFor(() => expect(actions.style.opacity).toBe('1'));
    expect(actions.querySelector('[data-state-action="edit"]')).toBeNull();
    expect(actions.querySelector('[data-state-action="delete"]')).toBeTruthy();

    // 基础状态是主体树根：只能进入编辑，没有删除入口
    const base = document.querySelector('[data-state-card="__base__"]') as HTMLElement;
    fireEvent.mouseEnter(base);
    await waitFor(() => expect((base.querySelector('[data-state-actions]') as HTMLElement).style.opacity).toBe('1'));
    expect(base.querySelector('[data-state-action="edit"]')).toBeNull();
    expect(base.querySelector('[data-state-action="delete"]')).toBeNull();
  });

  it('2026-11-12 最终形态：点状态卡不跳新页面，编辑面板就在卡片内展开', async () => {
    renderPages(makeTree());
    await openSubjectPage();
    expect(document.querySelector('[data-state-edit-panel]')).toBeNull();

    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    // 仍在主体状态页：网格、主体名、其它状态卡都还在
    expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy();
    expect(document.querySelector('[data-subject-state-grid]')).toBeTruthy();
    expect(document.querySelector('[data-field="subject-name"]')).toBeTruthy();
    expect(document.querySelector('[data-state-card="__base__"]')).toBeTruthy();
    const panel = document.querySelector('[data-state-edit-panel]') as HTMLElement;
    // 面板挂在被编辑的那张卡内部，不是独立页面，也不是右侧抽屉
    expect(panel.closest('[data-state-card="state-1"]')).toBeTruthy();
    // 2026-11-12 用户指令：编辑卡拉通整行，且不再顶一张 16:9 大图
    expect((document.querySelector('[data-state-card="state-1"]') as HTMLElement).style.gridColumn).toBe('1 / -1');
    expect(document.querySelector('[data-state-card="state-1"] [data-state-cover]')).toBeNull();
    expect(panel.querySelector('[data-field="prompt"]')).toBeTruthy();
    expect(panel.querySelector('[data-episodes-picker]')).toBeTruthy();
    // 2026-11-12 用户指令：编辑态有明确的「收纳回卡片」按钮，不必再点一次卡
    const collapse = document.querySelector('[data-state-card="state-1"] [data-state-action="collapse"]') as HTMLElement;
    expect(collapse).toBeTruthy();
    expect(collapse.textContent).toContain('收起编辑');
    fireEvent.click(collapse);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeNull());
    // 点另一张卡，编辑面板跟着换
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')?.getAttribute('data-state-id')).toBe('__base__'));
  });

  it('出现集数：只给一个摘要按钮，不再把每个已选集铺成标签', async () => {
    renderPages(makeTree());
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    // 已选第 1 集：摘要按标题显示（与弹层里勾选行同一口径），不渲染标签
    expect(document.querySelector('[data-episode-chip]')).toBeNull();
    expect(document.querySelector('[data-episodes-picker]')?.textContent).toContain('第一集');
    // 点按钮才展开下拉列表；勾选第 2 集后摘要显示两集标题，仍然不铺标签
    fireEvent.click(document.querySelector('[data-episodes-picker]') as Element);
    await waitFor(() => expect(document.querySelector('[data-episode-option="2"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-episode-option="2"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-episodes-picker]')?.textContent).toContain('第一集、第二集'));
    expect(document.querySelector('[data-episode-chip]')).toBeNull();
  });

  it('剧本第 1 条是「故事大纲」时：勾选哪一行就只勾哪一行，摘要按同一行显示（不按 number 错位）', async () => {
    scriptMock.episodes = [
      { id: 'ep-outline', number: 1, title: '故事大纲（全剧设定以此为准）' },
      ...Array.from({ length: 16 }, (_, i) => ({
        id: `ep-${i + 1}`,
        number: i + 2,
        title: `第${i + 1}集｜标题${i + 1}`,
      })),
    ];
    const tree = makeTree();
    tree.states.find((s) => s.id === 'state-1')!.appearEpisodes = [];
    renderPages(tree);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-episodes-picker]') as Element);
    await waitFor(() => expect(document.querySelector('[data-episode-option="2"]')).toBeTruthy());

    // 点「第1集｜标题1」这一行（number 2）：只勾这一行，摘要显示这一行的标题
    const row = document.querySelector('[data-episode-option="2"]') as HTMLElement;
    expect(row.textContent).toContain('第1集｜标题1');
    fireEvent.click(row);
    await waitFor(() => expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true));
    expect((document.querySelector('[data-episode-option="1"] input') as HTMLInputElement).checked).toBe(false);
    expect(document.querySelector('[data-episodes-picker]')?.textContent).toContain('第1集｜标题1');
  });

  it('出现集数「全选」一次写入全部集（不是只留最后一项）', async () => {
    scriptMock.episodes = [
      { id: 'ep-1', number: 1, title: '第1集' },
      { id: 'ep-2', number: 2, title: '第2集' },
      { id: 'ep-3', number: 3, title: '第3集' },
    ];
    const tree = makeTree();
    tree.states.find((s) => s.id === 'state-1')!.appearEpisodes = [];
    renderPages(tree);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-episodes-picker]') as Element);
    await waitFor(() => expect(document.querySelector('[data-episode-option="1"]')).toBeTruthy());
    fireEvent.click(screen.getByText('全选'));
    await waitFor(() => expect(document.querySelector('[data-episodes-picker]')?.textContent).toContain('第1集、第2集、第3集'));
    expect(screen.getByText('已选 3 集')).toBeTruthy();
  });

  it('状态页不再放全剧风格入口（归本剧信息 / 导演台）', async () => {
    scriptMock.meta = { visualStyle: { presetId: 'wong-kar-wai', name: '王家卫', prompt: '王家卫电影风格' } };
    renderPages(makeTree());
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    expect(document.querySelector('[data-prompt-style-summary]')).toBeNull();
    expect(document.querySelector('[data-prompt-style-form]')).toBeNull();
  });

  it('每状态「画布生成」只把提示词挂进事件，不发起 API', async () => {
    const tree = makeTree();
    const st = tree.states.find((s) => s.id === 'state-1')!;
    st.fullPrompt = '左臂缠白色绷带';
    st.media = [{ key: 'state-key-1', type: 'image' }];
    const emit = vi.mocked(nodeActionBus.emit);
    emit.mockClear();
    renderPages(tree);
    await openSubjectPage();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card.querySelector('[data-state-action="canvas-generate"]') as Element);

    expect(emit).toHaveBeenCalledWith('subject:sendStateToCanvas', expect.objectContaining({
      prompt: '左臂缠白色绷带',
      storageKey: 'state-key-1',
    }));
    expect(emit).not.toHaveBeenCalledWith('subject:sendToCanvas', expect.anything());
    // 点画布生成不会展开编辑面板（动作按钮 stopPropagation）
    expect(document.querySelector('[data-state-edit-panel]')).toBeNull();
  });

  it('卡内删除状态：确认后该状态卡消失（不必进详情页）', async () => {
    const onChangeTree = vi.fn();
    renderPages(makeTree(), PID, onChangeTree);
    await openSubjectPage();
    expect(document.querySelector('[data-state-card="state-1"]')).toBeTruthy();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.click(card.querySelector('[data-state-action="delete"]') as Element);

    // antd Modal.confirm：danger 主按钮 = 确认删除
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    fireEvent.click(document.querySelector('.ant-modal-confirm .ant-btn-dangerous') as Element);

    await waitFor(() => expect(document.querySelector('[data-state-card="state-1"]')).toBeNull());
    expect(onChangeTree).toHaveBeenCalled();
  });

  it('状态网格列数：960→3 / 1280→4 / 1920→6', () => {
    expect(SUBJECT_STATE_COVER_ASPECT.replace(/\s/g, '')).toBe('16/9');
    expect(subjectStateColumnsForWidth(960)).toBe(3);
    expect(subjectStateColumnsForWidth(1280)).toBe(4);
    expect(subjectStateColumnsForWidth(1920)).toBe(6);
  });
});

describe('主体类型只在主体层级设置（状态页不设分类）', () => {
  it('状态编辑页不渲染分类下拉，徽标仍显示主体类型', async () => {
    renderPages(makeTree(), PID);
    expect(document.querySelector('[data-subject-card-badge]')?.textContent).toBe('角色');
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-field="kind"]')).toBeNull();
  });

  it('老数据缺 kind → 列表徽标显示未分类', async () => {
    const tree = makeTree();
    delete (tree as unknown as { kind?: string }).kind;
    renderPages(tree, PID);

    expect(document.querySelector('[data-subject-card-badge]')?.textContent).toBe('未分类');
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-field="kind"]')).toBeNull();
  });
});

describe('状态编辑页精简与媒体动作归位（2026-11-06 用户指令）', () => {
  it('只剩字段本身：无分区标题 / 无「素材接收位」/ 无冗余提示', async () => {
    renderPages(makeTree(), PID);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    const basic = document.querySelector('[data-form-section="basic"]') as HTMLElement;
    expect(basic.querySelector('[data-media-slot]')).toBeTruthy();
    expect(document.querySelectorAll('[data-form-section]').length).toBe(3); // basic + reference + media（后两者嵌套在 basic 内）
    expect(document.querySelector('[data-form-section="reference"]')).toBeTruthy();
    expect(document.querySelectorAll('section[data-form-section="media"]').length).toBe(0);
    // 卡片风格（圆角+描边+面板底色）已移除
    expect(basic.style.borderRadius).toBe('');
    expect(basic.style.border).toBe('');
    expect(basic.style.background).toBe('');
    // 2026-11-06 用户指令：分区标题与说明文案都是废话
    expect(basic.textContent).not.toContain('基本信息');
    expect(basic.textContent).not.toContain('名称与提示词会写入生成上下文');
    expect(basic.textContent).not.toContain('素材接收位');
    expect(basic.textContent).not.toContain('媒体已就绪');
    expect(basic.textContent).not.toContain('删除后不可恢复');
  });

  it('媒体动作换到封面右上角（与外层卡片同位）；页头不再有「返回主体 / 删除状态」', async () => {
    const tree = makeTree();
    tree.states.find((s) => s.id === 'state-1')!.media = [{ key: 'state-key-1', type: 'image' }];
    renderPages(tree, PID);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    const actions = document.querySelector('[data-media-actions]') as HTMLElement;
    expect(actions).toBeTruthy();
    // 动作在封面卡内部右上角（CardShell 子树），不再排在图片下方成一条
    expect(actions.closest('[data-ui-card-shell]')).toBeTruthy();
    expect(actions.style.top).toBe('6px');
    expect(actions.style.right).toBe('6px');
    expect(actions.querySelector('[data-media-action="replace"]')).toBeTruthy();
    expect(actions.querySelector('[data-media-action="remove"]')).toBeTruthy();
    // 旧按钮行与隐藏 file input 全部下线
    expect(document.querySelector('[data-open-media-panel]')).toBeNull();
    expect(document.querySelector('[data-remove-media]')).toBeNull();
    expect(document.querySelector('[data-base-upload]')).toBeNull();
    // 返回入口 = 显式「返回上一级」按钮 + 面包屑（2026-11-07 用户指令）
    expect(document.querySelector('[data-subject-back]')).toBeTruthy();
    expect(document.querySelector('[data-delete-state]')).toBeNull();
    expect(document.querySelector('[data-subject-crumb="subject"]')).toBeTruthy();
  });

  it('基础状态无图时也能开替换面板（只给上传入口，不给删除媒体）', async () => {
    renderPages(makeTree(), PID);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-media-action="replace"]')).toBeTruthy();
    expect(document.querySelector('[data-media-action="remove"]')).toBeNull();
  });

  it('状态卡悬停多一枚「封面」动作；无图状态点封面只提示不写入', async () => {
    const onUpdateItem = vi.fn();
    renderPages(makeTree(), PID, vi.fn(), onUpdateItem);
    await openSubjectPage();

    const card = document.querySelector('[data-state-card="state-1"]') as HTMLElement;
    fireEvent.mouseEnter(card);
    const cover = card.querySelector('[data-state-action="cover"]') as HTMLElement;
    expect(cover).toBeTruthy();
    expect(cover.querySelector('svg')).toBeTruthy();

    fireEvent.click(cover);
    await waitFor(() => expect(screen.getByText(/该状态还没有图片/)).toBeTruthy());
    expect(onUpdateItem).not.toHaveBeenCalled();
  });
});

describe('主体列表页按集筛选（选项来自剧本真实集数）', () => {
  it('下拉列出「全集 / 第1集 / 第2集」且与类型/搜索交叉生效', async () => {
    const tree = makeTree();
    // 加一个未标注状态 → 第 2 集按「全集适用」保留主体
    tree.states = [tree.states[0]!, { ...tree.states[0]!, id: 'state-unmarked', step: 3, appearEpisodes: [] }];
    renderPages(tree);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(document.querySelector('[data-subject-episode-filter]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-episode-option="1"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-episode-option="all"]')).toBeTruthy();
    expect(document.querySelector('[data-subject-episode-option="2"]')).toBeTruthy();

    // 选第 2 集：state-1 只标第 1 集，未标注状态不算“全剧出场” → 主体隐藏
    fireEvent.click(document.querySelector('[data-subject-episode-option="2"]') as Element);
    await waitFor(() => expect((document.querySelector('[data-subject-episode-filter]') as HTMLElement).dataset.episode).toBe('2'));
    expect(document.querySelector('[data-subject-card="item-1"]')).toBeNull();
    expect(document.querySelector('[data-subject-episode-empty]')).toBeTruthy();

    // 回全集后再验证类型交叉
    fireEvent.click(document.querySelector('[data-subject-episode-filter]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-episode-option="all"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-subject-episode-option="all"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-subject-kind-filter="scene"]') as Element);
    expect(document.querySelector('[data-subject-card="item-1"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-subject-kind-filter="all"]') as Element);

    // 与搜索交叉：无匹配 → 空态
    fireEvent.change(document.querySelector('[data-subject-search]') as HTMLInputElement, { target: { value: '不存在' } });
    expect(document.querySelector('[data-subject-card="item-1"]')).toBeNull();
    expect(document.querySelector('[data-subject-list-empty]')).toBeTruthy();
  });

  it('未标注状态不参与集筛选（空 ≠ 全剧）；全部状态都不命中 → 整卡隐藏 + 一键回全集', async () => {
    const tree = makeTree();
    const state1 = tree.states.find((s) => s.id === 'state-1')!;
    const unmarked = { ...state1, id: 'state-unmarked', step: 3, appearEpisodes: [] as number[] };
    tree.states = [...tree.states, unmarked];
    renderPages(tree);
    await act(async () => { await Promise.resolve(); });

    // 选第 2 集：只有未标注状态 → 视为未分配，不显示
    act(() => useViewPrefsStore.getState().setSubjectActiveEpisode(PID, 2));
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeNull());

    // 去掉未标注状态 → 选第 2 集时主体整卡隐藏
    cleanup();
    const marked = makeTree();
    // 全部状态（含基础状态）都标注为其它集 → 选第 2 集整卡隐藏
    marked.states = marked.states.map((s) => ({ ...s, appearEpisodes: [1] }));
    renderPages(marked);
    act(() => useViewPrefsStore.getState().setSubjectActiveEpisode(PID, 2));
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeNull());
    expect(document.querySelector('[data-subject-episode-empty]')?.textContent).toContain('第二集 暂无主体');

    fireEvent.click(document.querySelector('[data-subject-episode-reset]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
  });

  it('按项目记忆：刷新后恢复上次选择的集', async () => {
    act(() => useViewPrefsStore.getState().setSubjectActiveEpisode(PID, 2));
    renderPages(makeTree());
    await waitFor(() => {
      const btn = document.querySelector('[data-subject-episode-filter]') as HTMLElement;
      expect(btn.dataset.episode).toBe('2');
    });
    expect((document.querySelector('[data-subject-episode-filter]') as HTMLElement).textContent).toContain('第二集');
  });
});

describe('主体库入口归并：只保留资产抽屉内的主体分段', () => {
  it('整页渲染不再挂载第二层抽屉，也没有「抽屉打开」按钮', async () => {
    const historyBefore = window.history.length;
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-drawer]')).toBeNull();
    expect(document.querySelector('[data-subject-drawer-overlay]')).toBeNull();
    expect(document.querySelector('[data-subject-drawer-close]')).toBeNull();
    expect(document.querySelector('[data-open-subject-drawer]')).toBeNull();
    expect(window.history.length).toBe(historyBefore);
  });

  it('嵌在资产抽屉内：面包屑只到主体，返回按钮先收编辑面板再回列表', async () => {
    renderPages(makeTree(), PID, vi.fn(), vi.fn(), { embedded: true });
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-crumb="state"]')).toBeNull();
    expect(document.querySelector('[data-subject-crumb="subject-collapsed"]')).toBeNull();
    fireEvent.click(document.querySelector('[data-subject-back]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="subject"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-subject-crumb="library"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());
  });
});

// 2026-11-05 用户指令（征集 #176）：抽屉内主体库「标题去掉 + 添加主体与上传素材同款同位、不用红色」
describe('抽屉内（embedded）列表页页头下线与新建入口同位', () => {
  it('无「主体库」面包屑标题与计数徽标；「添加主体」= 顶部共享 AddTile（整宽虚线格、非 antd 主按钮、无红色底）', async () => {
    const onAdd = vi.fn();
    renderPages(makeTree(), PID, vi.fn(), vi.fn(), { embedded: true, onAddSubject: onAdd });
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());

    // 页头整块下线（计数与 chips 的「全部」同源，不丢信息）
    expect(document.querySelector('[data-subject-crumb="library"]')).toBeNull();
    expect(document.querySelector('[data-subject-count]')).toBeNull();

    // 新建入口仍在（同一 data-subject-add 标记），但形态 = AddTile
    const add = document.querySelector('[data-subject-add]') as HTMLElement;
    expect(add).toBeTruthy();
    expect(add.tagName).toBe('BUTTON');
    expect(add.className).not.toContain('ant-btn');
    expect(add.style.border).toContain('dashed');
    expect(add.style.background).toBe('transparent');
    expect(add.textContent).toContain('添加主体');

    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('整页模式（非 embedded）不受影响：页头面包屑 + antd 主按钮照旧', async () => {
    renderPages(makeTree());
    await waitFor(() => expect(document.querySelector('[data-subject-page="list"]')).toBeTruthy());
    expect(document.querySelector('[data-subject-crumb="library"]')).toBeTruthy();
    expect(document.querySelector('[data-subject-count]')).toBeTruthy();
    expect((document.querySelector('[data-subject-add]') as HTMLElement).className).toContain('ant-btn-primary');
  });
});

// 2026-11-06 用户反馈（图1/图2 布局差异 + 「没法批量编辑」）
describe('抽屉工具栏与素材同源 + 批量编辑', () => {
  const item = (id: string, name: string): ProductionItem => ({
    id, name, kind: 'character', aliases: [], consistency: '', note: '', episodeIds: [], images: [], coverKey: null,
  });
  const twoItems = (): ProductionItem[] => [item('item-1', '东海龙王'), item('item-2', '东海龙王 2')];

  it('embedded：搜索框高 26 与素材同源；多选开关与集筛选都在搜索行内，chips 单独一行', async () => {
    renderPages(makeTree(), PID, vi.fn(), vi.fn(), { embedded: true, items: twoItems() });
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());

    const search = document.querySelector('[data-subject-search]') as HTMLInputElement;
    // SearchBox（高 26）→ ToolbarRow：与素材分段同一组件同一尺寸
    expect(search.parentElement?.style.height).toBe('26px');
    const searchRow = search.parentElement?.parentElement as HTMLElement;
    expect(searchRow.querySelector('[data-subject-multiselect]')).toBeTruthy();
    expect(searchRow.querySelector('[data-subject-episode-filter]')).toBeTruthy();
    // 集筛选不再挂在列外（旧 marginLeft:auto 在窄抽屉被右边缘裁成半截）
    expect(searchRow.style.marginLeft).toBe('');
    // chips 在另一行
    const chip = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.startsWith('全部')) as HTMLElement;
    expect(chip.parentElement?.parentElement).not.toBe(searchRow);
  });

  it('多选开关：卡片出现复选框，点卡片只选中不跳转；卡内动作区隐藏', async () => {
    renderPages(makeTree(), PID, vi.fn(), vi.fn(), { embedded: true, items: twoItems() });
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());
    expect(document.querySelector('[data-multi-select-checkbox]')).toBeNull();

    fireEvent.click(document.querySelector('[data-subject-multiselect]') as Element);
    await waitFor(() => expect(document.querySelectorAll('[data-multi-select-checkbox]').length).toBe(2));
    expect(document.querySelector('[data-subject-batch-bar]')).toBeTruthy();

    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-batch-bar]')?.textContent).toContain('已选 1 项'));
    expect(document.querySelector('[data-subject-page="subject"]')).toBeNull();
    expect((document.querySelector('[data-subject-card-actions]') as HTMLElement).style.display).toBe('none');

    // 再点一次 = 取消选中
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-batch-bar]')?.textContent).toContain('已选 0 项'));
    // 未选中时动作置灰（不留点了没反应的按钮）
    expect((document.querySelector('[data-batch-kind]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('批量改类型：两个主体一笔 entities 写回 + 绑定树一笔，树顺手补上 itemId', async () => {
    const onChangeTree = vi.fn();
    const onUpdateItems = vi.fn();
    renderPages(makeTree(), PID, onChangeTree, vi.fn(), { embedded: true, items: twoItems(), onUpdateItems });
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-2"]')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-subject-multiselect]') as Element);
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    fireEvent.click(document.querySelector('[data-subject-card="item-2"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-batch-bar]')?.textContent).toContain('已选 2 项'));

    fireEvent.click(document.querySelector('[data-batch-kind]') as Element);
    await waitFor(() => expect(document.querySelector('.ant-dropdown')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-batch-kind-option="scene"]') as Element);

    await waitFor(() => expect(onUpdateItems).toHaveBeenCalledTimes(1));
    expect(onUpdateItems.mock.calls[0]![0]).toEqual(['item-1', 'item-2']);
    expect(onUpdateItems.mock.calls[0]![1]).toEqual({ kind: 'scene' });
    // 树只写一笔（不是每人一笔），且只改有绑定的那条
    expect(onChangeTree).toHaveBeenCalledTimes(1);
    const treesArg = onChangeTree.mock.calls[0]![0] as SubjectTree[];
    expect(treesArg[0]?.kind).toBe('scene');
    expect(treesArg[0]?.itemId).toBe('item-1');
  });

  it('批量删除：只剔除选中主体及其绑定树，未选中的同名之外主体树原封不动', async () => {
    const onChangeTree = vi.fn();
    const onDeleteItems = vi.fn();
    const other = createSubjectTree('scene', '山神庙');
    other.rootId = 'subj-2';
    renderPages(makeTree(), PID, onChangeTree, vi.fn(), {
      embedded: true,
      items: [item('item-1', '东海龙王')],
      trees: [makeTree(), other],
      onDeleteItems,
    });
    await waitFor(() => expect(document.querySelector('[data-subject-card="item-1"]')).toBeTruthy());

    fireEvent.click(document.querySelector('[data-subject-multiselect]') as Element);
    fireEvent.click(document.querySelector('[data-subject-card="item-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-batch-bar]')?.textContent).toContain('已选 1 项'));

    fireEvent.click(document.querySelector('[data-batch-delete]') as Element);
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeTruthy());
    expect(document.querySelector('.ant-modal-confirm')?.textContent).toContain('删除这 1 个主体');
    fireEvent.click(document.querySelector('.ant-modal-confirm .ant-btn-dangerous') as Element);

    await waitFor(() => expect(onDeleteItems).toHaveBeenCalledTimes(1));
    expect(onDeleteItems.mock.calls[0]![0]).toEqual(['item-1']);
    await waitFor(() => expect(onChangeTree).toHaveBeenCalledTimes(1));
    const left = onChangeTree.mock.calls[0]![0] as SubjectTree[];
    expect(left.map((tr) => tr.rootId)).toEqual(['subj-2']);
  });
});

describe('基础状态 = 独立状态（2026-11-08）', () => {
  it('状态卡不再显示集数；集数信息只在状态详情页编辑', async () => {
    renderPages(makeTree());
    await openSubjectPage();
    // 2026-11-12 用户要求：集数不在卡片上铺开，避免 100 集时卡片变长文
    expect(document.querySelector('[data-state-card="__base__"]')?.textContent).not.toContain('全部');
    expect(document.querySelector('[data-state-card="state-1"]')?.textContent).not.toContain('第 1 集');

    // 详情页仍有「出现集数」入口
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    expect(screen.getByText('出现集数')).toBeTruthy();
  });

  it('基础状态编辑页与更多状态同一套表单：提示词 + 出现集数，勾选写回 baseState', async () => {
    const onChangeTree = vi.fn();
    renderPages(makeTree(), PID, onChangeTree);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());

    // label 统一为「提示词」（不再是「完整提示词 / 备注」二选一）
    expect(document.querySelector('[data-field="prompt"]')?.getAttribute('aria-label')).toBe('提示词');
    expect(screen.getByText('出现集数')).toBeTruthy();
    // 2026-11-12：集数选择收进弹层（80+ 集不再平铺），先打开「选择集数」
    fireEvent.click(document.querySelector('[data-episodes-picker]') as Element);
    await waitFor(() => expect(document.querySelectorAll('[data-episode-option]').length).toBe(2));

    fireEvent.click(document.querySelector('[data-episode-option="2"]') as Element);
    await waitFor(() => {
      const calls = onChangeTree.mock.calls;
      const next = calls[calls.length - 1]?.[0] as SubjectTree[] | undefined;
      expect(next?.[0]?.states[0]?.appearEpisodes).toEqual([2]);
    });
  });
});

describe('基础状态与更多状态：同一套「状态名 / 提示词 / 出现集数」（2026-11-08）', () => {
  it('基础状态 = 主体本身：状态名就是卡片标题，编辑态可直接改主体名', async () => {
    const onChangeTree = vi.fn();
    renderPages(makeTree(), PID, onChangeTree);
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    // 主体名移到编辑面板参考素材上方（2026-11-13 用户指令）
    expect((document.querySelector('[data-field="subject-name"]') as HTMLInputElement).value).toBe('东海龙王');
    // 2026-11-13：基础状态名移到卡片最上方，编辑态是可直接修改的输入框（不再重复一行只读文本）
    expect((document.querySelector('[data-state-name-input]') as HTMLInputElement).value).toBe('东海龙王');
    expect(document.querySelector('[data-field="name"]')).toBeNull();
    expect(document.querySelector('[data-field="prompt"]')).toBeTruthy();
    expect(screen.getByText('出现集数')).toBeTruthy();
  });

  it('基础状态卡与面包屑显示主体名（基础状态即主体）', async () => {
    const tr = makeTree();
    tr.states[0]!.state = '正常人类';
    renderPages(tr);
    await openSubjectPage();
    expect(document.querySelector('[data-state-card="__base__"]')?.textContent).toContain('东海龙王');
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    // 基础状态即主体：编辑面板直接用主体名，面包屑不再重复第三级
    expect((document.querySelector('[data-state-name-input]') as HTMLInputElement).value).toBe('东海龙王');
    expect(document.querySelector('[data-subject-crumb="state"]')).toBeNull();
  });

  it('数据层统一：基础状态是 states[0] 真节点，旧单树不再有第二套卡片', () => {
    const types = readFileSync(resolve(process.cwd(), 'src/features/canvas-nodes/storyboard/subject-tree-types.ts'), 'utf8');
    expect(types).toContain("SUBJECT_BASE_STATE_ID = '__base__'");
    expect(types).toContain('migrateSubjectTree');
    expect(types).not.toContain('baseState: SubjectBaseState;');
    const tree = readFileSync(resolve(process.cwd(), 'src/features/canvas-nodes/storyboard/StoryboardSubjectTree.tsx'), 'utf8');
    expect(tree).not.toContain('function BaseStateCard');
    expect(tree).toContain('isBase={node.id === SUBJECT_BASE_STATE_ID}');
    expect(tree).toContain("t('subject.statePromptLabel', '提示词')");
    expect(tree).toContain('<EpisodeMultiSelect');
  });
});

describe('状态页直接出图 + 参考素材（2026-11-13 P0）', () => {
  it('编辑态顶部有参考素材入口；底部复用画布提示词底栏（模型/参数弹层/提示词/生成）', async () => {
    renderPages(makeTree());
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());

    expect(document.querySelector('[data-subject-ref-add]')).toBeTruthy();
    expect(document.querySelector('[data-subject-gen-footer]')).toBeTruthy();
    expect(document.querySelector('[data-subject-send-canvas]')).toBeTruthy();
    expect(document.querySelector('[data-subject-baseref]')).toBeTruthy();
    // 画布底栏同款：StyledSelect 模型 + 参数摘要弹层 + 提示词库
    expect(document.querySelector('[data-subject-gen-footer]')?.textContent).toContain('QwenImage2.1');
    expect(document.querySelector('[data-subject-gen-footer]')?.textContent).toContain('提示词');
    // 提示词为空时生成按钮禁用（不发起空任务）
    const generate = document.querySelector('[data-subject-gen-footer] button[aria-label="生成"]') as HTMLButtonElement | null;
    expect(generate).toBeTruthy();
    expect(generate?.disabled).toBe(true);
  });

  it('基础状态没有「引用基础状态」开关（自己就是基准）', async () => {
    renderPages(makeTree());
    await openSubjectPage();
    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')).toBeTruthy());
    expect(document.querySelector('[data-subject-baseref]')).toBeNull();
    expect(document.querySelector('[data-subject-ref-add]')).toBeTruthy();
  });

  it('状态名在卡片最上方直接改：基础状态改名 = 主体改名，派生状态只改 state', async () => {
    const onChangeTree = vi.fn();
    renderPages(makeTree(), PID, onChangeTree);
    await openSubjectPage();

    fireEvent.click(document.querySelector('[data-state-card="__base__"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-subject-page="state"]')).toBeTruthy());
    const baseInput = document.querySelector('[data-state-name-input]') as HTMLInputElement;
    fireEvent.change(baseInput, { target: { value: '敖广' } });
    fireEvent.blur(baseInput);
    await waitFor(() => {
      const calls = onChangeTree.mock.calls;
      const next = calls[calls.length - 1]?.[0] as SubjectTree[] | undefined;
      expect(next?.[0]?.name).toBe('敖广');
    });

    fireEvent.click(document.querySelector('[data-state-card="state-1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-state-edit-panel]')?.getAttribute('data-state-id')).toBe('state-1'));
    const stateInput = document.querySelector('[data-state-name-input]') as HTMLInputElement;
    fireEvent.change(stateInput, { target: { value: '战损' } });
    fireEvent.blur(stateInput);
    await waitFor(() => {
      const calls = onChangeTree.mock.calls;
      const next = calls[calls.length - 1]?.[0] as SubjectTree[] | undefined;
      expect(next?.[0]?.states.find((s) => s.id === 'state-1')?.state).toBe('战损');
      // 改派生状态名不会顺手改主体名（基础状态那一步已把主体名改成「敖广」）
      expect(next?.[0]?.name).toBe('敖广');
    });
  });
});
