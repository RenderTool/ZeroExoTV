/**
 * 抽屉素材分段「批量操作」验收（2026-11-06，征集 #183）
 *
 * 用户要求：「我的资产、本项目都应该支持批量操作」（此前抽屉素材段写死
 * `multiSelectEnabled={false}`，等于没有批量）。
 * 断言口径：只看真实 DOM（复选框/批量条/按钮可用态）+ 回调参数，
 * 不以「handler 被调用过」代替界面结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { App } from 'antd';
import { createElement } from 'react';

// 卡片链里的 AssetScopeBadge 会调 useTheme（无 ThemeProvider 就抛）→ 直接替身掉这个叶子
vi.mock('@/features/asset-picker/components/scope-badge.js', () => ({
  AssetScopeBadge: () => <span data-scope-badge />,
}));
vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: () => ({ url: '', failed: false, reason: undefined, markError: vi.fn(), origin: 'blob' }) }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: () => ({ url: '', failed: false, markError: vi.fn() }) }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) => {
      if (typeof d === 'string') return d;
      // 插值形式 t(key, { n, defaultValue }) 同样要回到中文默认值（否则断言拿到的是 key）
      if (d && typeof d === 'object' && 'defaultValue' in d) return String((d as { defaultValue?: unknown }).defaultValue ?? k);
      return k;
    },
  }),
}));
vi.mock('@zeroexo/plugin-nodes', () => ({ usePreviewImage: (key?: string) => (key ? `/media/${key}` : '') }));
vi.mock('../send-to-workbench.js', () => ({ sendAssetToWorkbench: vi.fn() }));
vi.mock('./OpenLibGroup.js', () => ({ OpenLibGroup: () => null }));
vi.mock('./SubjectGroup.js', () => ({ SubjectGroup: () => <div data-subject-group /> }));
vi.mock('@/features/asset-library/components/scope-capsule-tabs.js', () => ({
  ScopeCapsuleTabs: (props: { subjectCount?: number | null }) => (
    <div data-scope-tabs>{`主体 ${props.subjectCount ?? '—'}`}</div>
  ),
}));
vi.mock('@/shared/components/asset-detail-viewer.js', () => ({
  AssetDetailViewer: () => <div data-asset-detail />,
}));

import { MaterialGroup } from './MaterialGroup.js';
import type { CanvasAssetsPanelStore } from '../store.js';

const THEME = {
  mode: 'light',
  toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff', danger: '#ef4444', background: '#fff', panel: '#fff' },
  canvas: { background: '#fafafa' },
  node: { fill: '#fff' },
} as never;

const ASSETS = [
  { id: 'a1', title: '素材 1', kind: 'image', scope: 'library', createdAt: '2026-11-06T00:00:00.000Z', data: { kind: 'image', storageKey: 'cas:111.png', width: 800, height: 450 } },
  { id: 'a2', title: '素材 2', kind: 'image', scope: 'library', createdAt: '2026-11-06T00:00:00.000Z', data: { kind: 'image', storageKey: 'cas:222.png', width: 450, height: 800 } },
] as never[];

function makeStore(overrides: Partial<CanvasAssetsPanelStore> = {}): CanvasAssetsPanelStore {
  return {
    assets: ASSETS,
    loadingAssets: false,
    materialKind: 'all',
    setMaterialKind: vi.fn(),
    search: '',
    setSearch: vi.fn(),
    handleUpload: vi.fn(),
    setAssetDetail: vi.fn(),
    handleDeleteAsset: vi.fn(),
    setRenameItemTarget: vi.fn(),
    setRenameItemOpen: vi.fn(),
    handleDownloadItem: vi.fn(),
    sendToCanvas: vi.fn(),
    focusAssetId: null,
    assetDetail: null,
    updateAsset: vi.fn(),
    materialScopeTab: 'library',
    setMaterialScopeTab: vi.fn(),
    materialScopeCounts: { library: 2, project: 0 },
    openLibCount: null,
    assetMultiSelect: false,
    setAssetMultiSelect: vi.fn(),
    assetSelectedIds: new Set<string>(),
    assetSelectedAssets: [],
    toggleAssetSelect: vi.fn(),
    toggleAssetSelectAll: vi.fn(),
    handleBatchDeleteAssets: vi.fn(),
    handleBatchSendToCanvas: vi.fn(),
    handleBatchSendToDirector: vi.fn(),
    renameItemOpen: false,
    renameItemName: '',
    setRenameItemName: vi.fn(),
    handleRenameItem: vi.fn(),
    ...overrides,
  } as unknown as CanvasAssetsPanelStore;
}

function renderGroup(store: CanvasAssetsPanelStore) {
  return render(createElement(App, null, createElement(MaterialGroup, { store, theme: THEME })));
}

beforeEach(() => { vi.clearAllMocks(); cleanup(); });

describe('抽屉素材分段批量操作', () => {
  it('非多选态：没有复选框与批量条，多选开关在搜索行右侧且未按下', () => {
    renderGroup(makeStore());
    expect(document.querySelector('[data-multi-select-checkbox]')).toBeNull();
    expect(document.querySelector('[data-asset-batch-bar]')).toBeNull();
    const toggle = document.querySelector('[data-asset-multiselect]') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('多选态：每张卡左上同款复选框；点卡片回调 toggleAssetSelect(该卡 id)，不再开大图', () => {
    const store = makeStore({ assetMultiSelect: true });
    renderGroup(store);
    expect(document.querySelectorAll('[data-multi-select-checkbox]').length).toBe(2);
    expect((document.querySelector('[data-asset-multiselect]') as HTMLElement).getAttribute('aria-pressed')).toBe('true');

    // 点卡片本体（封面在卡片根内，事件上抛给根节点的 onClick）
    const cells = document.querySelectorAll('[data-masonry-cell]');
    const second = cells[1] as HTMLElement;
    const first = cells[0] as HTMLElement;
    fireEvent.click(second.querySelector('[data-card-cover]') as Element);
    expect(store.toggleAssetSelect).toHaveBeenCalledWith('a2');
    expect(store.setAssetDetail).not.toHaveBeenCalled();

    // 点左上复选框 = 同一个切换入口
    fireEvent.click(first.querySelector('[data-multi-select-checkbox]') as Element);
    expect(store.toggleAssetSelect).toHaveBeenCalledWith('a1');
  });

  it('批量条：已选计数、全选/取消全选文案随选中比例切换、动作按钮可用态与回调', () => {
    const store = makeStore({
      assetMultiSelect: true,
      assetSelectedIds: new Set(['a1']),
      assetSelectedAssets: [ASSETS[0] as never],
    });
    renderGroup(store);
    const bar = document.querySelector('[data-asset-batch-bar]') as HTMLElement;
    expect(bar.textContent).toContain('已选 1 项');
    // 未全选 → 按钮写「全选」；点击走 toggleAssetSelectAll
    // （antd Button 会在两个汉字间插空格，比对前去掉空白）
    const selectAll = bar.querySelector('[data-batch-select-all]') as HTMLButtonElement;
    expect(selectAll.textContent?.replace(/\s/g, '')).toBe('全选');
    fireEvent.click(selectAll);
    expect(store.toggleAssetSelectAll).toHaveBeenCalledTimes(1);

    // 三个动作在「有选中」时可用，点击各走自己的批量入口
    expect((bar.querySelector('[data-batch-send-canvas]') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bar.querySelector('[data-batch-send-canvas]') as Element);
    expect(store.handleBatchSendToCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(bar.querySelector('[data-batch-send-director]') as Element);
    expect(store.handleBatchSendToDirector).toHaveBeenCalledTimes(1);
    fireEvent.click(bar.querySelector('[data-batch-delete]') as Element);
    expect(store.handleBatchDeleteAssets).toHaveBeenCalledTimes(1);

    // 退出多选只关模式，不自己清选中（清理由 store 负责）
    fireEvent.click(bar.querySelector('[data-batch-exit]') as Element);
    expect(store.setAssetMultiSelect).toHaveBeenCalledWith(false);
  });

  it('多选态但零选中：三个动作置灰（不留点了没反应的按钮）', () => {
    renderGroup(makeStore({ assetMultiSelect: true }));
    const bar = document.querySelector('[data-asset-batch-bar]') as HTMLElement;
    expect(bar.textContent).toContain('已选 0 项');
    for (const sel of ['[data-batch-send-canvas]', '[data-batch-send-director]', '[data-batch-delete]']) {
      expect((bar.querySelector(sel) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('已全选时按钮文案变「取消全选」', () => {
    const store = makeStore({
      assetMultiSelect: true,
      assetSelectedIds: new Set(['a1', 'a2']),
      assetSelectedAssets: ASSETS as never,
    });
    renderGroup(store);
    expect((document.querySelector('[data-batch-select-all]') as HTMLElement).textContent?.replace(/\s/g, '')).toBe('取消全选');
  });

  it('多选态隐藏卡内快捷发送按钮（一个时刻只留一套操作）', () => {
    const { unmount } = renderGroup(makeStore());
    // 非多选：卡片信息区带快捷动作（2026-11-05 用户纠偏要求保留）
    expect(document.querySelectorAll('[data-card-action="send"]').length).toBeGreaterThan(0);
    unmount();
    renderGroup(makeStore({ assetMultiSelect: true }));
    expect(document.querySelectorAll('[data-card-action="send"]').length).toBe(0);
  });
});
