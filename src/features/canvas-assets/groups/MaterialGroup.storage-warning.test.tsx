/**
 * 素材空态回归（S-19）：数据目录未授权 / 8790 离线时，不能只显示「该文件夹暂无内容」，
 * 必须给出真实原因、说明与 MCP 服务无关，并提供一次点击即可恢复授权的入口。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { createElement } from 'react';

const fsMock = vi.hoisted(() => ({
  isAuthorized: vi.fn(),
  restoreRoot: vi.fn(),
  pickRoot: vi.fn(),
  withPermissionPrompt: vi.fn((fn: () => Promise<unknown>) => fn()),
}));
const bootMock = vi.hoisted(() => ({ reloadWithDisk: vi.fn() }));
// 只替换授权相关函数，其余 fs/boot 导出保持真实（slot-containers 等模块要用 readJson/writeJson）
vi.mock('@/platform/fs.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...fsMock };
});
vi.mock('@/platform/boot.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ...bootMock };
});
vi.mock('@/features/asset-picker/components/scope-badge.js', () => ({ AssetScopeBadge: () => null }));
vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: () => ({ url: '', failed: false, reason: undefined, markError: vi.fn(), origin: 'blob' }) }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: () => ({ url: '', failed: false, markError: vi.fn() }) }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: unknown) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && 'defaultValue' in d) return String((d as { defaultValue?: unknown }).defaultValue ?? k);
      return k;
    },
  }),
}));
vi.mock('@zeroexo/plugin-nodes', () => ({ usePreviewImage: (key?: string) => (key ? `/media/${key}` : ''), nodeActionBus: { emit: vi.fn() } }));
vi.mock('../send-to-workbench.js', () => ({ sendAssetToWorkbench: vi.fn() }));
vi.mock('./OpenLibGroup.js', () => ({ OpenLibGroup: () => null }));
vi.mock('./SubjectGroup.js', () => ({ SubjectGroup: () => null }));
vi.mock('@/features/asset-library/components/scope-capsule-tabs.js', () => ({ ScopeCapsuleTabs: () => null }));
vi.mock('@/shared/components/asset-detail-viewer.js', () => ({ AssetDetailViewer: () => null }));

import { MaterialGroup } from './MaterialGroup.js';
import type { CanvasAssetsPanelStore } from '../store.js';

const THEME = {
  mode: 'light',
  toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff', danger: '#ef4444', background: '#fff', panel: '#fff' },
  canvas: { background: '#fafafa' },
  node: { fill: '#fff' },
} as never;

function makeStore(): CanvasAssetsPanelStore {
  return {
    assets: [], loadingAssets: false, materialKind: 'all', setMaterialKind: vi.fn(),
    search: '', setSearch: vi.fn(), handleUpload: vi.fn(), setAssetDetail: vi.fn(),
    handleDeleteAsset: vi.fn(), setRenameItemTarget: vi.fn(), setRenameItemOpen: vi.fn(),
    handleDownloadItem: vi.fn(), sendToCanvas: vi.fn(), focusAssetId: null, assetDetail: null,
    updateAsset: vi.fn(), materialScopeTab: 'project', setMaterialScopeTab: vi.fn(),
    materialScopeCounts: { library: 0, project: 0 }, openLibCount: null,
    assetMultiSelect: false, setAssetMultiSelect: vi.fn(), assetSelectedIds: new Set<string>(),
    assetSelectedAssets: [], toggleAssetSelect: vi.fn(), toggleAssetSelectAll: vi.fn(),
    handleBatchDeleteAssets: vi.fn(), handleBatchSendToCanvas: vi.fn(), handleBatchSendToDirector: vi.fn(),
    renameItemOpen: false, renameItemName: '', setRenameItemName: vi.fn(), handleRenameItem: vi.fn(),
  } as unknown as CanvasAssetsPanelStore;
}

function renderGroup(): void {
  render(createElement(App, null, createElement(MaterialGroup, { store: makeStore(), theme: THEME })));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fsMock.isAuthorized.mockResolvedValue(false);
  fsMock.restoreRoot.mockResolvedValue(null);
  fsMock.pickRoot.mockResolvedValue('data');
  fsMock.withPermissionPrompt.mockImplementation((fn: () => Promise<unknown>) => fn());
});

describe('素材空态：目录未就绪不再伪装成空文件夹', () => {
  it('未授权 → 显示诊断块，说明与 MCP 服务无关，不显示普通空态', async () => {
    renderGroup();
    await waitFor(() => expect(document.querySelector('[data-storage-warning]')).toBeTruthy());
    expect(document.body.textContent).toContain('与 MCP 服务无关');
    expect(document.body.textContent).toContain('数据目录未就绪');
    expect(document.body.textContent).not.toContain('assetLibrary.empty');
  });

  it('点「重新授权 / 选择目录」→ 用户手势恢复授权并刷新页面', async () => {
    renderGroup();
    await waitFor(() => expect(document.querySelector('[data-storage-warning]')).toBeTruthy());
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('重新授权'));
    expect(btn).toBeTruthy();
    fireEvent.click(btn as HTMLButtonElement);
    await waitFor(() => expect(fsMock.restoreRoot).toHaveBeenCalledWith(true));
    await waitFor(() => expect(fsMock.pickRoot).toHaveBeenCalled());
    await waitFor(() => expect(bootMock.reloadWithDisk).toHaveBeenCalled());
  });

  it('已授权且确实无素材 → 仍是普通空态，不误报未授权', async () => {
    fsMock.isAuthorized.mockResolvedValue(true);
    renderGroup();
    await waitFor(() => expect(document.querySelector('[data-storage-warning]')).toBeNull());
    expect(document.body.textContent).toContain('assetLibrary.empty');
  });
});
