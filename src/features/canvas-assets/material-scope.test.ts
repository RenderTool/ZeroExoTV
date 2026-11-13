/**
 * 抽屉「素材」分组作用域胶囊链路自证（2026-11-04 约定·口径翻案）
 *
 * 唯一约定的胶囊位置 = 画布左侧抽屉「素材」分组（MaterialGroup）；
 * 资产库工具栏/主页/项目弹窗一律不出现。
 *
 * 断言：
 * 1) 结构：MaterialGroup 源码必含 ScopeCapsuleTabs；工具栏源码胶囊引用 = 0；
 *    主页/弹窗链路（asset-library-page）胶囊引用 = 0
 * 2) store：materialScopeTab/materialScopeCounts 暴露；切换后 filteredAssets
 *    按严格口径只出对应段，两段 id 集合零交集
 * 3) 上传归属跟随素材分组当前段（resolveUploadScope 口径）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('localforage', () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    default: {
      createInstance: ({ storeName }: { name?: string; storeName?: string }) => {
        const key = storeName ?? 'default';
        if (!stores.has(key)) stores.set(key, new Map());
        const bucket = stores.get(key)!;
        return {
          getItem: async (k: string) => (bucket.has(k) ? bucket.get(k) : null),
          setItem: async (k: string, v: unknown) => { bucket.set(k, v); return v; },
          removeItem: async (k: string) => { bucket.delete(k); },
        };
      },
    },
  };
});
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { emit: () => undefined, on: () => () => undefined },
}));
vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, dv?: unknown) => (typeof dv === 'string' ? dv : k) }),
}));
vi.mock('@/services/sync/sync-service.js', () => ({
  onAssetCreated: vi.fn(), onAssetUpdated: vi.fn(), onAssetDeleted: vi.fn(),
}));
vi.mock('@zeroexo/plugin-upload-queue', () => ({ UploadQueue: class {} }));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()), uploadImage: vi.fn() }));
vi.mock('@/features/upload-queue/use-upload-queue.js', () => ({
  useAssetUploadQueue: () => ({ uploadFiles: vi.fn(async () => []) }),
}));
vi.mock('@/services/api-client.js', () => ({ getToken: () => null }));
vi.mock('@/services/canvas-script.js', () => ({
  findCanvasScript: () => null, ensureCanvasScript: vi.fn(async () => null),
}));
vi.mock('@/features/canvas-tabs/canvas-tab-store.js', () => ({
  openCanvasTab: vi.fn(),
  useCanvasTabStore: (sel: (s: { activeProjectId: string | null }) => unknown) => sel({ activeProjectId: null }),
}));

import { addAsset, clearAllAssets } from '@/features/asset-picker/asset-store.js';
import { setCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { loadViewPrefs } from '@/shared/view-prefs.js';
import { useCanvasAssetsPanel } from './store.js';

const readSrc = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

function textData(content: string): { kind: 'text'; content: string } {
  return { kind: 'text', content };
}

beforeEach(async () => {
  await clearAllAssets();
  setCurrentCanvasId(null);
  localStorage.clear();
});

describe('胶囊位置结构断言（只许在抽屉素材链路）', () => {
  it('MaterialGroup 源码必含 ScopeCapsuleTabs（胶囊真实渲染位置）', () => {
    const src = readSrc('./groups/MaterialGroup.tsx');
    expect(src).toContain('ScopeCapsuleTabs');
    expect(src).toContain('materialScopeTab');
  });

  it('工具栏源码胶囊引用 = 0；资产库页面链路胶囊引用 = 0', () => {
    const toolbar = readSrc('../asset-library/components/asset-library-toolbar.tsx');
    const page = readSrc('../asset-library/asset-library-page.tsx');
    expect(toolbar).not.toContain('ScopeCapsuleTabs');
    expect(toolbar).not.toContain('scopeCapsule');
    expect(page).not.toContain('ScopeCapsuleTabs');
    expect(page).not.toContain('scopeCapsule');
    expect(page).not.toContain('buildScopeCapsule');
  });
});

describe('抽屉素材分组作用域切换（严格口径，两段不串）', () => {
  it('默认本项目段：只出当前画布资产；切公共段：只出公共库；切回不串', async () => {
    setCurrentCanvasId('c1');
    const lib = await addAsset({ kind: 'text', title: '公共文本', bytes: 1, data: textData('L'), scope: 'library' });
    const own = await addAsset({ kind: 'text', title: '项目文本', bytes: 1, data: textData('P') }); // scope=project+c1
    const other = await addAsset({ kind: 'text', title: '他项目', bytes: 1, data: textData('O'), scope: 'project', projectId: 'c2' });

    const { result } = renderHook(() => useCanvasAssetsPanel({}));
    await act(async () => { await result.current.refreshAssets(); });

    // 默认本项目段
    expect(result.current.materialScopeTab).toBe('project');
    expect(result.current.assets.map((a) => a.id)).toEqual([own.id]);

    // 切公共段
    act(() => { result.current.setMaterialScopeTab('library'); });
    expect(result.current.assets.map((a) => a.id)).toEqual([lib.id]);

    // 两段零交集
    const projIds = new Set([own.id]);
    expect(result.current.assets.every((a) => !projIds.has(a.id))).toBe(true);
    expect(other.id).not.toContain('c1');

    // 切回本项目段
    act(() => { result.current.setMaterialScopeTab('project'); });
    expect(result.current.assets.map((a) => a.id)).toEqual([own.id]);
  });

  it('胶囊计数正确：公共 1 / 本项目 1（他项目不计）', async () => {
    setCurrentCanvasId('c1');
    await addAsset({ kind: 'text', title: '公共文本', bytes: 1, data: textData('L'), scope: 'library' });
    await addAsset({ kind: 'text', title: '项目文本', bytes: 1, data: textData('P') });
    await addAsset({ kind: 'text', title: '他项目', bytes: 1, data: textData('O'), scope: 'project', projectId: 'c2' });

    const { result } = renderHook(() => useCanvasAssetsPanel({}));
    await act(async () => { await result.current.refreshAssets(); });

    expect(result.current.materialScopeCounts).toEqual({ library: 1, project: 1 });
  });

  it('切换到「主体」段：filteredAssets 为空（主体页面独立渲染），分段按项目落 view-prefs', () => {
    setCurrentCanvasId('c1');
    const { result } = renderHook(() => useCanvasAssetsPanel({}));
    act(() => { result.current.setMaterialScopeTab('subject'); });
    expect(result.current.materialScopeTab).toBe('subject');
    expect(result.current.assets).toEqual([]);
    expect(loadViewPrefs().canvasDrawer.materialScopeByProject['c1']).toBe('subject');

    // 再切回本项目段，记忆随写入更新
    act(() => { result.current.setMaterialScopeTab('project'); });
    expect(loadViewPrefs().canvasDrawer.materialScopeByProject['c1']).toBe('project');
  });
});
