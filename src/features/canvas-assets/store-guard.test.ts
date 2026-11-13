/**
 * canvas-assets/store 公共资产就地写单测（2026-11-05 口径调整）
 *
 * 口径：公共库资产在项目内即可就地编辑/删除，不再要求「请回到公共库」。
 *
 * 断言（直接调 store 写方法，不是只测资产库页面那一层）：
 * 1) canWriteInCanvasDrawer 新矩阵：library 资产一律可写（公共库内操作等价，不收窄）；
 *    本项目 project 资产放行；跨项目拒；无画布上下文 project 拒
 * 2) handleDeleteAsset：library 资产点击立即删除（不再弹确认框、不再拦截）
 * 3) deleteAssetsWithUndo：3 秒撤销浮层出现；点「撤销」→ restoreAssets 原样恢复（id/标题/作用域不变）
 * 4) 重命名 library 资产就地生效（写回公共作用域）
 * 5) countWorkbenchReferences：公共池 + 片段引用分别计数
 * 6) 结构断言：全库不再出现「请回到公共库」拦截文案
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ===== mock localforage：内存 Map 实现（与 asset-scope.test.ts 同口径） =====
vi.mock('localforage', () => {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    __stores: stores,
    default: {
      createInstance: ({ storeName }: { name?: string; storeName?: string }) => {
        const key = storeName ?? 'default';
        if (!stores.has(key)) stores.set(key, new Map());
        const bucket = stores.get(key)!;
        return {
          getItem: async (k: string) => (bucket.has(k) ? bucket.get(k) : null),
          setItem: async (k: string, v: unknown) => {
            bucket.set(k, v);
            return v;
          },
          removeItem: async (k: string) => {
            bucket.delete(k);
          },
        };
      },
    },
  };
});

vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { emit: () => undefined, on: () => () => undefined },
}));

// ===== antd message spy：deleteAssetsWithUndo 依赖 open/destroy/success =====
const messageSpy = vi.hoisted(() => {
  const opened: Array<{ key?: unknown; content: unknown; duration?: number; type?: string }> = [];
  return {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    open: vi.fn((cfg: { key?: unknown; content: unknown; duration?: number; type?: string }) => {
      opened.push(cfg);
    }),
    destroy: vi.fn(),
    __opened: opened,
  };
});
vi.mock('antd', () => ({
  App: { useApp: () => ({ message: messageSpy }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, dv?: unknown): string => {
      if (typeof dv === 'string') return dv;
      if (dv && typeof dv === 'object' && 'defaultValue' in dv) {
        return String((dv as { defaultValue: unknown }).defaultValue);
      }
      return key;
    },
  }),
}));

// ===== store.ts 其余外部依赖：全部打桩，只留真实 asset-store 写路径 =====
vi.mock('@/services/sync/sync-service.js', () => ({
  onAssetCreated: vi.fn(),
  onAssetUpdated: vi.fn(),
  onAssetDeleted: vi.fn(),
}));
vi.mock('@zeroexo/plugin-upload-queue', () => ({ UploadQueue: class {} }));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()), uploadImage: vi.fn() }));
vi.mock('@/features/upload-queue/use-upload-queue.js', () => ({
  useAssetUploadQueue: () => ({ uploadFiles: vi.fn(async () => []) }),
}));
vi.mock('@/services/api-client.js', () => ({ getToken: () => null }));
vi.mock('@/services/canvas-script.js', () => ({
  findCanvasScript: () => null,
  ensureCanvasScript: vi.fn(async () => null),
}));
vi.mock('@/features/canvas-tabs/canvas-tab-store.js', () => ({
  openCanvasTab: vi.fn(),
  useCanvasTabStore: (sel: (s: { activeProjectId: string | null }) => unknown) => sel({ activeProjectId: null }),
}));

import { addAsset, listAssets, clearAllAssets } from '@/features/asset-picker/asset-store.js';
import { setCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { useCanvasAssetsPanel, canWriteInCanvasDrawer } from './store.js';
import { deleteAssetsWithUndo } from '@/features/asset-library/delete-with-undo.jsx';
import { countWorkbenchReferences } from '@/entities/slot-containers.js';

const SCOPE_READONLY_TEXT = '该资产来自公共库，编辑/删除请回到公共库';

function textData(content: string): { kind: 'text'; content: string } {
  return { kind: 'text', content };
}

/** 从撤销浮层的 content JSX 里抠出「撤销」锚点的 onClick */
function findUndoHandler(content: unknown): () => Promise<void> {
  const span = content as { props?: { children?: unknown } };
  const kids = Array.isArray(span.props?.children) ? (span.props!.children as unknown[]) : [span.props?.children];
  for (const k of kids) {
    if (k && typeof k === 'object' && 'type' in (k as Record<string, unknown>) && (k as { type: unknown }).type === 'a') {
      const props = (k as { props?: { onClick?: () => Promise<void> } }).props;
      if (props?.onClick) return props.onClick;
    }
  }
  throw new Error('撤销按钮未找到');
}

beforeEach(async () => {
  await clearAllAssets();
  setCurrentCanvasId(null);
  messageSpy.warning.mockClear();
  messageSpy.error.mockClear();
  messageSpy.success.mockClear();
  messageSpy.open.mockClear();
  messageSpy.destroy.mockClear();
  messageSpy.__opened.length = 0;
});

describe('canWriteInCanvasDrawer 新矩阵（2026-11-05：公共就地可写，不收窄）', () => {
  it('library 资产一律可写；本项目放行；跨项目拒；无画布上下文 project 拒', () => {
    const libraryAsset = { scope: 'library' as const, kind: 'image' as const, data: { kind: 'image' as const, storageKey: 'k', dataUrl: '' } };
    const ownProject = { scope: 'project' as const, projectId: 'c1', kind: 'image' as const, data: { kind: 'image' as const, storageKey: 'k', dataUrl: '' } };
    const otherProject = { scope: 'project' as const, projectId: 'c2', kind: 'image' as const, data: { kind: 'image' as const, storageKey: 'k', dataUrl: '' } };

    // 2026-11-05 约定：公共库资产在抽屉内与公共库操作等价——就地编辑、就地删除
    expect(canWriteInCanvasDrawer(libraryAsset, 'c1')).toBe(true);
    expect(canWriteInCanvasDrawer(libraryAsset, null)).toBe(true);
    expect(canWriteInCanvasDrawer(ownProject, 'c1')).toBe(true);
    expect(canWriteInCanvasDrawer(otherProject, 'c1')).toBe(false);
    expect(canWriteInCanvasDrawer(ownProject, null)).toBe(false);
    expect(canWriteInCanvasDrawer(null, 'c1')).toBe(false);
  });
});

describe('useCanvasAssetsPanel 写入口（公共资产就地写）', () => {
  it('删除 library 资产：点击立即生效，无拦截、无 warning', async () => {
    setCurrentCanvasId('c1');
    const lib = await addAsset({ kind: 'text', title: '公共文本', bytes: 1, data: textData('L'), scope: 'library' });

    const { result } = renderHook(() => useCanvasAssetsPanel({}));
    await act(async () => { await result.current.refreshAssets(); });

    await act(async () => { await result.current.handleDeleteAsset(lib); });
    expect(messageSpy.warning).not.toHaveBeenCalledWith(SCOPE_READONLY_TEXT);
    expect((await listAssets()).some((a) => a.id === lib.id)).toBe(false); // 立即删除
    expect(messageSpy.open).toHaveBeenCalled(); // 撤销浮层出现
  });

  it('重命名 library 资产：就地生效，写回公共作用域', async () => {
    setCurrentCanvasId('c1');
    const lib = await addAsset({ kind: 'text', title: '公共素材', bytes: 1, data: textData('L'), scope: 'library' });

    const { result } = renderHook(() => useCanvasAssetsPanel({}));
    await act(async () => { await result.current.refreshAssets(); });

    act(() => {
      result.current.setRenameItemTarget({ type: 'asset', id: lib.id, name: lib.title });
      result.current.setRenameItemName('公共素材V2');
    });
    await act(async () => { await result.current.handleRenameItem(); });
    expect(messageSpy.warning).not.toHaveBeenCalled();
    const after = (await listAssets()).find((a) => a.id === lib.id);
    expect(after?.title).toBe('公共素材V2');
    expect(after?.scope).toBe('library'); // 作用域仍是公共库
  });
});

describe('deleteAssetsWithUndo + restoreAssets（3 秒撤销浮层）', () => {
  it('删公共资产 → 浮层出现（3 秒）→ 点撤销 → 原样恢复（id/标题/作用域不变）', async () => {
    const lib = await addAsset({ kind: 'text', title: '公共素材', bytes: 1, data: textData('L'), scope: 'library' });
    const onRestored = vi.fn();

    const t = (key: string, dv?: unknown): string => {
      if (typeof dv === 'string') return dv;
      if (dv && typeof dv === 'object' && 'defaultValue' in dv) return String((dv as { defaultValue: unknown }).defaultValue);
      return key;
    };

    const n = await deleteAssetsWithUndo({
      assets: [lib],
      projectId: null, // 无项目上下文：不统计引用
      message: messageSpy as never,
      t: t as never,
      onRestored,
    });
    expect(n).toBe(1);
    expect((await listAssets()).some((a) => a.id === lib.id)).toBe(false);

    const cfg = messageSpy.__opened.at(-1);
    expect(cfg?.duration).toBe(3); // 与槽位移除同口径：3 秒
    const undo = findUndoHandler(cfg?.content);
    await undo();
    expect(onRestored).toHaveBeenCalled();

    const restored = (await listAssets()).find((a) => a.id === lib.id);
    expect(restored?.title).toBe('公共素材');
    expect(restored?.scope).toBe('library');
    expect(restored?.data).toEqual(textData('L'));
  });
});

describe('countWorkbenchReferences（引用计数提示，不阻断）', () => {
  it('公共池 1 处 + 片段 1 处 = 2；未引用资产 = 0；无引用 id = 0', async () => {
    const io = {
      readJson: async () => ({
        tracks: [],
        shots: [
          { id: 'shot-1', references: [{ id: 'lib-1' }] },
          { id: 'shot-2', references: [{ id: 'other' }] },
        ],
        sharedParams: { assets: [{ id: 'lib-1' }] },
      }),
      writeJson: async () => {},
      listContainers: async () => [],
    };
    expect(await countWorkbenchReferences('c1', ['lib-1'], io as never)).toBe(2);
    expect(await countWorkbenchReferences('c1', ['nobody'], io as never)).toBe(0);
    expect(await countWorkbenchReferences('c1', [], io as never)).toBe(0);
  });
});

describe('结构断言：拦截文案全库清零', () => {
  const readSrc = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

  it('store.ts / use-asset-library / asset-card / asset-library-page 不再出现「请回到公共库」', () => {
    expect(readSrc('./store.ts')).not.toContain('请回到公共库');
    expect(readSrc('./store.ts')).not.toContain('scopeReadonly');
    expect(readSrc('../asset-library/use-asset-library.tsx')).not.toContain('请回到公共库');
    expect(readSrc('../asset-library/use-asset-library.tsx')).not.toContain('scopeReadonly');
    expect(readSrc('../asset-library/cards/asset-card.tsx')).not.toContain('请回到公共库');
    expect(readSrc('../asset-library/cards/asset-card.tsx')).not.toContain('编辑需回公共库');
    expect(readSrc('../asset-library/asset-library-page.tsx')).not.toContain('请回到公共库');
    expect(readSrc('../asset-library/asset-library-page.tsx')).not.toContain('scopeReadonly');
  });

  it('asset-card 保留中性「公共」小标签（仅标识，不带操作限制）；重命名/删除入口无 readonly 门控', () => {
    const src = readSrc('../asset-library/cards/asset-card.tsx');
    expect(src).toContain("scopeTagLibrary");
    expect(src).not.toContain('readonlyFromLibrary');
  });
});
