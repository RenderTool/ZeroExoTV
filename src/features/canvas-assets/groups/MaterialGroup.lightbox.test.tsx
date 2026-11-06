/**
 * 画布素材抽屉 MaterialGroup 卡片验收（2026-11-05，用户第四条反馈）
 *
 * 验收口径：对卡片根元素派发完整 pointerdown → pointerup → click 序列后，
 * 查看器必须真实出现在 DOM（`document.querySelector('[data-lightbox]')` 存在、
 * img 有非空 src），而不是只断言 handler 被调用；ESC 关闭。
 * 抽屉宿主常有 transform / overflow:hidden 祖先，故 MediaLightbox 必须 portal 到 body。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';

const { mediaUrlMock, authUrlMock, sendMock } = vi.hoisted(() => ({
  mediaUrlMock: vi.fn(),
  authUrlMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('@/shared/hooks/use-media-object-url.js', () => ({ useMediaObjectUrl: mediaUrlMock }));
vi.mock('@/shared/hooks/use-auth-image.js', () => ({ useAuthResourceUrl: authUrlMock }));
vi.mock('@/services/backend-upload.js', () => ({ isBackendKey: vi.fn(() => false) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }),
}));
// 卡片封面解析：本用例只关心点击入口，封面给空串走可读占位
vi.mock('@zeroexo/plugin-nodes', () => ({ usePreviewImage: () => '' }));
vi.mock('../send-to-workbench.js', () => ({ sendAssetToWorkbench: sendMock }));
vi.mock('./OpenLibGroup.js', () => ({ OpenLibGroup: () => null }));
vi.mock('@/features/asset-library/components/scope-capsule-tabs.js', () => ({
  ScopeCapsuleTabs: () => <div data-scope-tabs />,
}));
vi.mock('@/shared/components/asset-detail-viewer.js', () => ({
  AssetDetailViewer: () => <div data-asset-detail />,
}));

import { ThemeProvider } from '@zeroexo/plugin-theme';
import { MaterialGroup } from './MaterialGroup.js';
import type { CanvasAssetsPanelStore } from '../store.js';

const THEME = {
  mode: 'light',
  toolbar: { text: '#111', textMuted: '#888', border: '#ddd', accent: '#1677ff' },
  node: { fill: '#fff' },
} as any;

const ASSETS = [
  {
    id: 'a1', title: '素材 1', kind: 'image', scope: 'library', createdAt: '2026-11-05T00:00:00.000Z',
    data: { kind: 'image', storageKey: 'cas:111.png' },
  },
  {
    id: 'a2', title: '素材 2', kind: 'image', scope: 'library', createdAt: '2026-11-05T00:00:00.000Z',
    data: { kind: 'image', storageKey: 'cas:222.png' },
  },
] as any[];

function makeStore(): CanvasAssetsPanelStore {
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
    materialScopeTab: 'project',
    setMaterialScopeTab: vi.fn(),
    materialScopeCounts: { library: 0, project: 2 },
    openLibCount: null,
    // 批量操作（2026-11-06）：假 store 必须跟住真实返回结构，否则组件解构到 undefined
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
  } as unknown as CanvasAssetsPanelStore;
}

beforeEach(() => {
  mediaUrlMock.mockReset();
  mediaUrlMock.mockImplementation((key: string | undefined) => ({
    url: `blob:${key}`, failed: false, reason: undefined, markError: vi.fn(), origin: 'blob',
  }));
  authUrlMock.mockReset();
  authUrlMock.mockReturnValue(undefined);
});

describe('素材抽屉卡片：完整 pointer 序列 → 查看器真实可见', () => {
  it('对卡片根派发 pointerdown/pointerup/click → lightbox 存在 + src 非空 + ESC 关闭', async () => {
    const store = makeStore();
    const { container } = render(
      <ThemeProvider>
        <App>
          <MaterialGroup store={store} theme={THEME} />
        </App>
      </ThemeProvider>,
    );

    await waitFor(() => expect(container.textContent).toContain('素材 1'));

    // 2026-11-05 用户纠偏：抽屉卡片必须保留两枚快捷动作按钮（列表页才隐藏）
    const sendCanvasBtn = container.querySelector('[data-card-action="sendToCanvas"]') as HTMLButtonElement;
    const sendDirectorBtn = container.querySelector('[data-card-action="sendToDirector"]') as HTMLButtonElement;
    expect(sendCanvasBtn).toBeTruthy();
    expect(sendDirectorBtn).toBeTruthy();
    expect(sendCanvasBtn.disabled).toBe(false);
    expect(sendDirectorBtn.disabled).toBe(false);
    expect(getComputedStyle(sendCanvasBtn).opacity).toBe('0.75'); // 常驻半透明可见
    sendMock.mockClear();
    (store.sendToCanvas as any).mockClear();
    fireEvent.click(sendCanvasBtn);
    expect(store.sendToCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(sendDirectorBtn);
    expect(sendMock).toHaveBeenCalledTimes(1);
    // 发送不应误触大图查看
    expect(document.querySelector('[data-lightbox]')).toBeNull();
    // 清空上面快捷动作的调用记录，下面只校验「打开查看器」不产生副作用
    (store.sendToCanvas as any).mockClear();
    sendMock.mockClear();

    // 卡片根 = 标题 span 的上两级（root → 底部信息 → 标题行）
    const title = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === '素材 1') as HTMLElement;
    const card = title.parentElement?.parentElement as HTMLElement;
    expect(card).toBeTruthy();

    fireEvent.pointerDown(card, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(card);

    const overlay = document.querySelector('[data-lightbox]');
    expect(overlay).toBeTruthy();
    // 抽屉宿主祖先（transform/overflow:hidden）不再裁剪遮罩：遮罩是 body 直接子节点
    expect(overlay?.parentElement).toBe(document.body);
    expect(getComputedStyle(overlay as HTMLElement).position).toBe('fixed');

    const img = document.querySelector('[data-lightbox] img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('blob:cas:111.png');
    // 同列表前后切换（2 条）
    expect(document.querySelector('[data-lightbox-counter]')?.textContent?.replace(/\s/g, '')).toBe('1/2');

    // 打开查看器不应触发「选中/发送」副作用
    expect(store.sendToCanvas).not.toHaveBeenCalled();
    expect(store.setAssetDetail).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-lightbox]')).toBeNull());
  });

  it('抽屉 drop 外部文件 → 走同一 handleUpload，一次且文件数正确；不支持格式给可读原因', async () => {
    const store = makeStore();
    const { container } = render(
      <ThemeProvider>
        <App>
          <MaterialGroup store={store} theme={THEME} />
        </App>
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.textContent).toContain('素材 1'));
    const zone = container.querySelector('[data-upload-dropzone]') as HTMLElement;
    expect(zone).toBeTruthy();
    const f1 = new File(['x'], 'a.png', { type: 'image/png' });
    const f2 = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    fireEvent.drop(zone, { dataTransfer: { files: [f1, f2], types: ['Files'] } });
    expect(store.handleUpload).toHaveBeenCalledTimes(1);
    expect((store.handleUpload as any).mock.calls[0][0].length).toBe(2);

    // 不支持格式：不调用上传，落区内联可读原因
    (store.handleUpload as any).mockClear();
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.exe', { type: 'application/x-msdownload' })], types: ['Files'] } });
    expect(store.handleUpload).not.toHaveBeenCalled();
    expect(container.querySelector('[data-upload-dropzone-error]')?.textContent).toContain('不支持的格式：a.exe');
  });
});
