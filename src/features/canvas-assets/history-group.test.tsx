/**
 * 抽屉「历史」分组（2026-11-04 本地重建版）回归测试
 *
 * 覆盖验收四条：
 * 1) 入口渲染：DRAWER_TAB_DEFS 含 history 页签（与层级/素材/剧本同一套 SidebarNav 切换）
 * 2) 两分类数据分区：filterHistoryAssets / countHistoryByKind（project 作用域 + kind 分区 + 时间倒序）
 * 3) 空态：图片/视频两分类各自独立空态文案
 * 4) 分页/懒加载：>50 条分页（paginate 切片）+ LazyVisible 进入视口才渲染内容
 * 附带：findAssetNodeId 定位（originNodeId 优先 / storageKey 兜底 / 未命中 null）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 读仓库源码（结构断言用；vitest cwd = 仓库根） */
const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf-8');

vi.mock('localforage', () => ({
  default: {
    createInstance: vi.fn(() => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) })),
  },
}));

// @zeroexo/plugin-nodes: 只桩 HistoryGroup/store 用到的两个符号（不 importActual，避免拖入重依赖链）
vi.mock('@zeroexo/plugin-nodes', () => ({
  usePreviewImage: () => '',
  nodeActionBus: { on: () => () => undefined, emit: () => undefined },
}));

// antd：App.useApp + common.js 依赖的 Button/Pagination 桩
vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
  Button: ({ children, onClick, icon }: { children?: React.ReactNode; onClick?: () => void; icon?: React.ReactNode }) => (
    <button type="button" onClick={onClick}>{icon}{children}</button>
  ),
  Pagination: ({ total, pageSize }: { total: number; pageSize: number }) => (
    <div data-testid="pagination" data-total={total} data-page-size={pageSize} />
  ),
}));

// i18n: 复用 zh.json 资源
vi.mock('react-i18next', async () => {
  const zh = ((await vi.importActual('@/i18n/zh.json')) as { default: Record<string, Record<string, string>> }).default;
  const lookup = (key: string, opts?: { defaultValue?: string }): string => {
    const parts = key.split('.');
    const ns = zh[parts[0] ?? ''];
    return ns?.[parts[1] ?? ''] ?? opts?.defaultValue ?? key;
  };
  return {
    useTranslation: () => ({
      t: (key: string, opts?: { defaultValue?: string }) => lookup(key, opts),
    }),
  };
});

import { DRAWER_TAB_DEFS } from './tab-defs.js';
import {
  HISTORY_PAGE_SIZE,
  countHistoryByKind,
  filterHistoryAssets,
  findAssetNodeId,
  fmtRelativeTime,
  isGenerationAsset,
  paginate,
} from './history-utils.js';
import { HistoryGroup, LazyVisible } from './groups/HistoryGroup.js';
import type { Asset } from '@/features/asset-picker/index.js';

const PID = 'proj-test-1';

/** 生成产物自证元数据（与 history-autoland 写入同构） */
const GEN_META = { jobId: 'gen-001', provider: 'test-provider', model: 'test-model', prompt: '一只猫', createdAt: '2026-11-04T04:00:00.000Z' };

/** 默认造「API 生成产物」（带 origin='generation' 标记）；手动上传资产需显式去掉标记 */
function mkAsset(partial: Partial<Asset> & { id: string }): Asset {
  return {
    title: partial.id,
    kind: 'image',
    scope: 'project',
    projectId: PID,
    bytes: 1024,
    mimeType: 'image/png',
    data: { kind: 'image', dataUrl: '', storageKey: 'cas:abc.png', width: 800, height: 450, origin: 'generation', generation: GEN_META },
    createdAt: '2026-11-04T04:00:00.000Z',
    updatedAt: '2026-11-04T04:00:00.000Z',
    folderId: null,
    favorite: false,
    ...partial,
  } as Asset;
}

/** 手动上传/拖入/素材库添加的资产：project 作用域、无 origin 标记（对应 D:\Test 现存 3 条的真实形态） */
function mkManualUpload(id: string, overrides?: Partial<Asset>): Asset {
  return mkAsset({
    id,
    data: { kind: 'image', dataUrl: '', storageKey: 'cas:manual.png', width: 800, height: 450 },
    ...overrides,
  });
}

// 假 store（仅 HistoryGroup 消费的字段）
function mkStore(assets: Asset[]) {
  return {
    allAssets: assets,
    historyProjectId: PID,
    historyCounts: countHistoryByKind(assets, PID),
    libraryHashes: new Set<string>(),
    promoteToLibrary: vi.fn(async () => undefined),
    handleDownloadItem: vi.fn(async () => undefined),
  } as never;
}

const theme = {
  mode: 'dark',
  toolbar: { text: '#fff', textMuted: '#888' },
} as never;

afterEach(cleanup);

describe('抽屉历史入口', () => {
  it('DRAWER_TAB_DEFS 含 history 页签（与层级/素材同一套切换），且剧本页签已移除', () => {
    const keys = DRAWER_TAB_DEFS.map((d) => d.key);
    expect(keys).toContain('history');
    expect(keys).toContain('hierarchy');
    expect(keys).toContain('material');
    // 2026-11-05 用户指令（征集 #174）：抽屉不再重复「剧本」入口，
    // 剧本正文唯一入口 = 顶部固定槽位页签（一个项目 = 1 剧本）。
    expect(keys).not.toContain('script');
    const historyDef = DRAWER_TAB_DEFS.find((d) => d.key === 'history');
    expect(historyDef?.labelKey).toBe('assetLibrary.filterHistory');
  });

  it('CanvasAssetsPanel 源码：ScriptGroup 入口彻底下线（无组件、无渲染分支）', () => {
    const src = readSrc('src/features/canvas-assets/CanvasAssetsPanel.tsx');
    expect(src).not.toContain('ScriptGroup');
    expect(src).not.toContain("activeGroup === 'script'");
  });
});

describe('真实抽屉渲染链结构断言（无浏览器）', () => {
  it('CanvasAssetsPanel 源码：页签由 DRAWER_TAB_DEFS 派生且渲染分支含 HistoryGroup', () => {
    const src = readSrc('src/features/canvas-assets/CanvasAssetsPanel.tsx');
    // 页签数组真实来源 = DRAWER_TAB_DEFS（不是另一份内联副本）
    expect(src).toContain('DRAWER_TAB_DEFS.map');
    // 「历史」分支真实接到 HistoryGroup 组件
    expect(src).toContain("activeGroup === 'history'");
    expect(src).toContain('<HistoryGroup');
    expect(src).toContain("from './groups/HistoryGroup.js'");
  });

  it('真实渲染链：editor-page → HierarchyPanelSidebar → CanvasAssetsPanel', () => {
    const editorPage = readSrc('src/pages/editor/editor-canvas/editor-page.tsx');
    expect(editorPage).toContain('<HierarchyPanelSidebar');
    const hierarchyPanel = readSrc('src/features/hierarchy/components/hierarchy-panel.tsx');
    expect(hierarchyPanel).toContain('<CanvasAssetsPanel');
  });
});

describe('两分类数据分区（唯一判据 = API 生成标记，手动上传一律排除）', () => {
  const assets = [
    mkAsset({ id: 'a-img-old', createdAt: '2026-11-04T01:00:00.000Z' }),
    mkAsset({ id: 'a-img-new', createdAt: '2026-11-04T05:00:00.000Z' }),
    mkAsset({
      id: 'a-video', kind: 'video', mimeType: 'video/mp4',
      data: { kind: 'video', url: '', storageKey: 'cas:def.mp4', durationMs: 5000, origin: 'generation', generation: GEN_META },
      createdAt: '2026-11-04T03:00:00.000Z',
    }),
    // 手动上传（用户自己传入的图片）：同项目同 kind，但无 origin 标记 → 必须被排除
    mkManualUpload('a-manual-upload'),
    // 公共库资产不进历史
    mkAsset({ id: 'a-lib', scope: 'library', projectId: undefined }),
    // 其他项目资产不进历史
    mkAsset({ id: 'a-other-proj', projectId: 'proj-other' }),
    // 剧本/文本不进历史
    mkAsset({ id: 'a-script', kind: 'script', data: { kind: 'script', content: '' } as never }),
  ];

  it('图片/视频按 kind 分区，仅本项目 API 生成产物，按时间倒序', () => {
    const images = filterHistoryAssets(assets, PID, 'image');
    expect(images.map((a) => a.id)).toEqual(['a-img-new', 'a-img-old']);
    const videos = filterHistoryAssets(assets, PID, 'video');
    expect(videos.map((a) => a.id)).toEqual(['a-video']);
  });

  it('手动上传资产被正确排除（a-manual-upload 不出现在任何分类）', () => {
    expect(filterHistoryAssets(assets, PID, 'image').map((a) => a.id)).not.toContain('a-manual-upload');
    expect(filterHistoryAssets(assets, PID, 'video').map((a) => a.id)).not.toContain('a-manual-upload');
    expect(countHistoryByKind(assets, PID)).toEqual({ image: 2, video: 1 });
  });

  it('isGenerationAsset：唯一判据 data.origin===generation', () => {
    expect(isGenerationAsset(mkAsset({ id: 'g' }))).toBe(true);
    expect(isGenerationAsset(mkManualUpload('m'))).toBe(false);
    // 生成元数据自证字段随资产保存
    const gen = mkAsset({ id: 'g2' });
    const meta = (gen.data as { generation?: typeof GEN_META }).generation;
    expect(meta?.jobId).toBe('gen-001');
    expect(meta?.provider).toBe('test-provider');
    expect(meta?.createdAt).toBe('2026-11-04T04:00:00.000Z');
  });

  it('计数与过滤一致；无项目上下文时为空', () => {
    expect(filterHistoryAssets(assets, null, 'image')).toEqual([]);
    expect(countHistoryByKind(assets, null)).toEqual({ image: 0, video: 0 });
  });
});

describe('空态（两分类各自独立文案，「还没有生成记录」语义）', () => {
  it('无数据时图片/视频分类分别显示各自空态文案', () => {
    const store = mkStore([]);
    render(<HistoryGroup store={store} theme={theme} />);
    expect(screen.getByText('还没有图片生成记录，在画布上调用 API 生成图片后自动收录')).toBeTruthy();
    fireEvent.click(screen.getByText('视频生成'));
    expect(screen.getByText('还没有视频生成记录，在画布上调用 API 生成视频后自动收录')).toBeTruthy();
  });

  it('只有手动上传资产（无生成记录）时同样走空态——D:\\Test 现状即此形态', () => {
    const store = mkStore([mkManualUpload('m1'), mkManualUpload('m2')]);
    render(<HistoryGroup store={store} theme={theme} />);
    expect(screen.getByText('还没有图片生成记录，在画布上调用 API 生成图片后自动收录')).toBeTruthy();
  });
});

describe('分页与懒加载', () => {
  it('paginate：>50 条分页，越界页回收到末页', () => {
    const items = Array.from({ length: 55 }, (_, i) => i);
    expect(paginate(items, 1).slice).toHaveLength(HISTORY_PAGE_SIZE);
    expect(paginate(items, 2).slice).toHaveLength(5);
    expect(paginate(items, 99).page).toBe(2);
    expect(paginate([], 1).slice).toEqual([]);
  });

  it('55 条历史卡片只渲染 50 张并出现分页条', () => {
    const assets = Array.from({ length: 55 }, (_, i) =>
      mkAsset({ id: `a-${i}`, createdAt: `2026-11-04T04:${String(i).padStart(2, '0')}:00.000Z` }));
    const store = mkStore(assets);
    render(<HistoryGroup store={store} theme={theme} />);
    // jsdom 无 IntersectionObserver → LazyVisible 回退直接可见；卡片按页切片 50 张
    expect(screen.getAllByTitle(/定位到画布节点/)).toHaveLength(HISTORY_PAGE_SIZE);
    const pager = screen.getByTestId('pagination');
    expect(pager.getAttribute('data-total')).toBe('55');
  });

  it('LazyVisible：有 IntersectionObserver 时进入视口才渲染子内容', () => {
    const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    class FakeIO {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { callbacks.push(cb); }
      observe(): void { /* noop */ }
      disconnect(): void { /* noop */ }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO);
    try {
      render(<LazyVisible>{(visible) => <span>{visible ? '已可见' : '未可见'}</span>}</LazyVisible>);
      expect(screen.queryByText('已可见')).toBeNull();
      act(() => callbacks.forEach((cb) => cb([{ isIntersecting: true }])));
      expect(screen.getByText('已可见')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('定位画布节点', () => {
  const graph = {
    nodes: [
      { id: 'node-1', data: { storageKey: 'cas:abc.png' } },
      { id: 'node-2', data: {} },
    ],
  };

  it('originNodeId 优先；节点已删则退回 storageKey 扫描；都未命中返回 null', () => {
    const byOrigin = mkAsset({ id: 'x1', data: { kind: 'image', dataUrl: '', storageKey: 'cas:none.png', originNodeId: 'node-2' } as never });
    expect(findAssetNodeId(graph, byOrigin)).toBe('node-2');
    const byKey = mkAsset({ id: 'x2' });
    expect(findAssetNodeId(graph, byKey)).toBe('node-1');
    const miss = mkAsset({ id: 'x3', data: { kind: 'image', dataUrl: '', storageKey: 'cas:zzz.png', originNodeId: 'gone' } as never });
    expect(findAssetNodeId(graph, miss)).toBeNull();
    expect(findAssetNodeId(null, miss)).toBeNull();
  });
});

describe('相对时间', () => {
  it('按分钟/小时/天粗粒度格式化', () => {
    const now = Date.parse('2026-11-04T10:00:00.000Z');
    expect(fmtRelativeTime('2026-11-04T09:59:30.000Z', now)).toBe('刚刚');
    expect(fmtRelativeTime('2026-11-04T09:57:00.000Z', now)).toBe('3 分钟前');
    expect(fmtRelativeTime('2026-11-04T08:00:00.000Z', now)).toBe('2 小时前');
    expect(fmtRelativeTime('2026-11-02T10:00:00.000Z', now)).toBe('2 天前');
    expect(fmtRelativeTime('bad', now)).toBe('');
  });
});
