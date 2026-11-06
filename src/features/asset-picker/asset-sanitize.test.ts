/**
 * 资产持久化地址清洗 — 验收测试（2026-11-05「用户仍看不到图」存量清洗轮）
 *
 * 背景：历史版本 uploadAsset 把 URL.createObjectURL(file) 的会话 blob: 地址写进
 * asset.data.url / dataUrl / coverUrl 并落盘——刷新后必然失效，渲染层回退到它们
 * 就是用户看到的 ERR_FILE_NOT_FOUND（图片/视频空白）。
 *
 * 验收契约：
 * ① 读取迁移：带 blob: 旧数据的资产加载即被清洗（幂等写回），渲染只剩 storageKey；
 * ② 写入硬约束：任何写路径（新增/更新/同步回流）都不允许 blob: 进入持久化；
 * ③ 清洗规则：blob: 无条件剥；data: 有 storageKey 剥（冗余）、无 storageKey 留
 *    （唯一自包含显示源）；文本 content 永不触碰；coverUrl blob: 剥；
 * ④ resolver 防御：resolveImageUrl / resolveMediaUrl 文件缺失时绝不返回 blob: fallback
 *    （宁可空串走「未就绪」，不回必坏地址）；
 * ⑤ 渲染兜底：无 storageKey 且无可显示源的媒体资产显示可读原因，不空白不坏图。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { ThemeProvider } from '@zeroexo/plugin-theme';

const mem = new Map<string, unknown>();

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: async (k: string) => mem.get(k) ?? null,
      setItem: async (k: string, v: unknown) => {
        mem.set(k, v);
        return v;
      },
      removeItem: async (k: string) => {
        mem.delete(k);
      },
    }),
  },
}));

vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { emit: vi.fn() },
  // asset-card 封面解析链桩掉（本套件测数据层与兜底文案，不测解析）
  usePreviewImage: () => '',
}));
vi.mock('@/shared/current-canvas-id.js', () => ({ getCurrentCanvasId: () => 'proj-test' }));
vi.mock('@/entities/cas-store.js', () => ({
  releaseCas: vi.fn(async () => ({ released: true, removed: false })),
  registerCasRef: vi.fn(async () => undefined),
  hasCasEntry: vi.fn(async () => true),
  isCasStorageKey: (k: string | undefined | null) => typeof k === 'string' && k.startsWith('cas:'),
}));

import {
  addAsset,
  listAssets,
  sanitizePersistedAsset,
  updateAsset,
  upsertAsset,
} from './asset-store.js';
import { resolveImageUrl, resolveMediaUrl } from '@zeroexo/plugin-persistence';
import type { Asset } from './index.js';

const ASSETS_KEY = 'zeroexo:assets';

function legacyImageAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'legacy-1',
    title: '旧上传图片',
    kind: 'image',
    scope: 'library',
    createdAt: '2026-11-04T00:00:00.000Z',
    bytes: 10,
    mimeType: 'image/png',
    data: {
      kind: 'image',
      // 历史版本持久化的会话地址（刷新后必然失效）+ 可靠的存储键
      dataUrl: 'blob:http://localhost:5180/0ea02e7f-legacy',
      storageKey: 'image:legacy-1',
      width: 1,
      height: 1,
    },
    ...overrides,
  };
}

describe('① 读取迁移：存量 blob: 旧数据加载即清洗（幂等写回）', () => {
  beforeEach(() => { mem.clear(); });
  afterEach(() => cleanup());

  it('listAssets 剥离持久化 blob: 地址并写回；渲染数据只剩 storageKey', async () => {
    mem.set(ASSETS_KEY, [legacyImageAsset(), legacyImageAsset({
      id: 'legacy-2',
      data: { kind: 'image', dataUrl: 'data:image/png;base64,AAAA', storageKey: 'image:legacy-2' },
    })]);
    const list = await listAssets();
    const a1 = list.find((a) => a.id === 'legacy-1')!;
    expect(a1.data.kind === 'image' && (a1.data as { dataUrl?: string }).dataUrl).toBe(''); // blob: 被剥离
    expect((a1.data as { storageKey?: string }).storageKey).toBe('image:legacy-1'); // 存储键保留
    // 冗余 data: 副本（有 storageKey）也剥离
    const a2 = list.find((a) => a.id === 'legacy-2')!;
    expect(a2.data.kind === 'image' && (a2.data as { dataUrl?: string }).dataUrl).toBe('');
    // 幂等写回：持久层已更新为清洗后的列表
    const persisted = mem.get(ASSETS_KEY) as Asset[];
    expect((persisted[0]!.data as { dataUrl?: string }).dataUrl).toBe('');
    // 幂等性：再次读取不再触发写回语义（数据稳定一致）
    const again = await listAssets();
    expect((again.find((a) => a.id === 'legacy-1')!.data as { dataUrl?: string }).dataUrl).toBe('');
  });
});

describe('② 写入硬约束：任何写路径都不允许 blob: 进入持久化', () => {
  beforeEach(() => { mem.clear(); });
  afterEach(() => cleanup());

  it('addAsset：上传服务传入的会话 blob: 入库前被剥离（storageKey 保留）', async () => {
    await addAsset({
      title: '新上传',
      kind: 'image',
      bytes: 10,
      mimeType: 'image/png',
      data: {
        kind: 'image',
        dataUrl: 'blob:http://localhost:5180/fresh-upload',
        storageKey: 'image:fresh',
      },
    });
    const persisted = mem.get(ASSETS_KEY) as Asset[];
    expect((persisted[0]!.data as { dataUrl?: string }).dataUrl).toBe('');
    expect((persisted[0]!.data as { storageKey?: string }).storageKey).toBe('image:fresh');
  });

  it('updateAsset：patch.data 携带 blob: 回流 → 落盘前被拦截', async () => {
    mem.set(ASSETS_KEY, [legacyImageAsset({ id: 'u1', data: { kind: 'image', dataUrl: '', storageKey: 'image:u1' } })]);
    await updateAsset('u1', {
      data: { kind: 'image', dataUrl: 'blob:http://localhost:5180/regress', storageKey: 'image:u1' },
    });
    const persisted = mem.get(ASSETS_KEY) as Asset[];
    expect((persisted[0]!.data as { dataUrl?: string }).dataUrl).toBe('');
  });

  it('upsertAsset（同步拉取回流）：携带 blob: 的云端记录落盘前被清洗', async () => {
    await upsertAsset(legacyImageAsset({ id: 'sync-1', cloudId: 'c1' }));
    const persisted = mem.get(ASSETS_KEY) as Asset[];
    expect((persisted[0]!.data as { dataUrl?: string }).dataUrl).toBe('');
    expect((persisted[0]!.data as { storageKey?: string }).storageKey).toBe('image:legacy-1');
  });
});

describe('③ 清洗规则（纯函数 sanitizePersistedAsset）', () => {
  it('blob: 无条件剥离（无论有无 storageKey）', () => {
    const withKey = sanitizePersistedAsset(legacyImageAsset());
    expect((withKey.data as { dataUrl?: string }).dataUrl).toBe('');
    const noKey = sanitizePersistedAsset(legacyImageAsset({
      data: { kind: 'image', dataUrl: 'blob:x', width: 1, height: 1 },
    }));
    expect((noKey.data as { dataUrl?: string }).dataUrl).toBe('');
  });

  it('data: 有 storageKey 剥离（冗余副本）；无 storageKey 保留（唯一显示源）', () => {
    const withKey = sanitizePersistedAsset(legacyImageAsset({
      data: { kind: 'image', dataUrl: 'data:image/png;base64,AA', storageKey: 'image:k', width: 1, height: 1 },
    }));
    expect((withKey.data as { dataUrl?: string }).dataUrl).toBe('');
    const noKey = sanitizePersistedAsset(legacyImageAsset({
      data: { kind: 'image', dataUrl: 'data:image/png;base64,AA', width: 1, height: 1 },
    }));
    expect((noKey.data as { dataUrl?: string }).dataUrl).toBe('data:image/png;base64,AA');
  });

  it('video url / coverUrl 同规则；文本 content 永不触碰；干净记录原对象返回（零拷贝）', () => {
    const video = sanitizePersistedAsset(legacyImageAsset({
      kind: 'video',
      coverUrl: 'blob:http://x/cover',
      data: { kind: 'video', url: 'blob:http://x/v', storageKey: 'video:v' },
    }));
    expect((video.data as { url?: string }).url).toBe('');
    expect(video.coverUrl).toBe('');
    const text = { kind: 'text', content: 'blob:看似地址的正文原样保留' } as Asset['data'];
    const textAsset = sanitizePersistedAsset(legacyImageAsset({ kind: 'text', data: text }));
    expect((textAsset.data as { content: string }).content).toContain('blob:');
    const clean = legacyImageAsset({ data: { kind: 'image', dataUrl: '', storageKey: 'image:c' } });
    expect(sanitizePersistedAsset(clean)).toBe(clean);
  });
});

describe('④ resolver 防御：文件缺失时绝不返回 blob: fallback', () => {
  beforeEach(() => {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:new');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  });

  it('resolveImageUrl：CAS/桶无文件 + blob: fallback → 返回空串（不回必坏地址）', async () => {
    await expect(resolveImageUrl(undefined, 'blob:http://x/stale')).resolves.toBe('');
  });

  it('resolveMediaUrl：同防御（视频/音频链路）', async () => {
    await expect(resolveMediaUrl(undefined, 'blob:http://x/stale')).resolves.toBe('');
    await expect(resolveMediaUrl(undefined, 'data:video/mp4;base64,AA')).resolves.toBe('data:video/mp4;base64,AA');
  });
});

describe('⑤ 渲染兜底：无 storageKey 的媒体资产显示可读原因（不空白）', () => {
  beforeEach(() => { mem.clear(); });
  afterEach(() => cleanup());

  it('asset-card：未落盘图片显示「该图片未落盘或文件缺失，请重新导入」', async () => {
    const { AssetCardGrid } = await import('./../asset-library/cards/asset-card.js');
    const { container } = render(createElement(ThemeProvider, null, createElement(AssetCardGrid as never, {
      item: legacyImageAsset({ data: { kind: 'image', dataUrl: '', width: 1, height: 1 } }),
      multiSelectEnabled: false,
      onToggleSelect: () => {},
      onOpen: () => {},
      onRename: () => {},
      onDelete: () => {},
      onContextMenu: () => {},
      theme: { toolbar: { text: '#000', textMuted: '#888', border: '#ddd' } },
      t: (k: string, d?: string) => d ?? k,
    } as never)));
    await waitFor(() => {
      expect(container.textContent).toContain('该图片未落盘或文件缺失，请重新导入');
    });
  });
});
