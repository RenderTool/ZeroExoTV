/**
 * importOpenLibEntry 单测（2026-11-05 重做验收；同日补 CDN 失败降级）——开源素材「仅缓存 CAS + 引用」铁律：
 * ① 发送到画布/导演台后个人资产列表数量不变（关键防回归断言：禁止 addAsset 入「我的资产库」）；
 * ② 字节真实落 CAS（media/cas/<hash>.<ext>）且登记稳定引用（openlib:<entryId>，重复发送幂等）；
 * ③ 返回的一次性引用对象：storageKey 引用、无 blob URL、带 sourceEntry 开源标记。
 * CDN 失败降级（Failed to fetch 用户已实测耗数小时）：
 * ④ cdnUrl 抛 TypeError → 回落同源打包缩略图 → 可用引用 + quality='local-thumb' 降级标记；
 * ⑤ remote 条目无本地缩略图 → 可判别失败 + 可读文案（含 name/message + 无法降级说明）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// asset-store 走 localforage（app_state 桶）——内存 map 替代
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

// CAS 落盘走 platform/fs——内存 FS 替代（与 cas-store.test 同一手法）
vi.mock('@/platform/fs', () => {
  const texts = new Map<string, { text: string; lastModified: number }>();
  const blobs = new Map<string, { data: Uint8Array; mime: string; lastModified: number }>();
  let tick = 0;
  return {
    __texts: texts,
    __blobs: blobs,
    readJson: async (p: string) => {
      const f = texts.get(p);
      return f ? (JSON.parse(f.text) as unknown) : null;
    },
    stat: async (p: string) => {
      const t = texts.get(p);
      if (t) return { size: t.text.length, lastModified: t.lastModified };
      const b = blobs.get(p);
      if (b) return { size: b.data.byteLength, lastModified: b.lastModified };
      return null;
    },
    writeJsonIfUnchanged: async (p: string, value: unknown) => {
      texts.set(p, { text: JSON.stringify(value), lastModified: ++tick });
    },
    writeFileBlob: async (p: string, data: Uint8Array, mime = 'application/octet-stream') => {
      blobs.set(p, { data: new Uint8Array(data), mime, lastModified: ++tick });
    },
    readFileHandle: async (p: string) => {
      const b = blobs.get(p);
      return b ? new Blob([b.data.slice().buffer], { type: b.mime }) : null;
    },
    removeFile: async (p: string) => {
      texts.delete(p);
      blobs.delete(p);
    },
  };
});

// 下载源 mock：可逐用例改写行为的 fetch（默认任意 URL 都成功）
// jsdom Blob 缺 arrayBuffer()（putCas 需要）——统一用 Node Blob 应答
const { Blob: NodeBlob } = await import('node:buffer');
const fetchMock = vi.fn(async (_url: string) => ({
  ok: true,
  blob: async () => new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
}));
vi.stubGlobal('fetch', fetchMock);

import { importOpenLibEntry, OPENLIB_ASSET_PREFIX } from './import-open-lib-entry.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import { readCasIndex } from '@/entities/cas-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { OpenLibEntry } from './open-library.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsMock = (await import('@/platform/fs') as any);
const blobs = fsMock.__blobs as Map<string, unknown>;

/** bundled 条目（随站点打包缩略图，可降级） */
const ENTRY = {
  id: 'e1',
  gallery: 'shisei',
  title: 'むくむくシート（整形系・スーツ・パーカ）',
  cdnUrl: 'https://cdn.example/e1.png',
  storage: 'bundled',
  imageUrl: '/openlib/thumbs/shisei/e1.webp',
} as unknown as OpenLibEntry;

/** remote 条目（仅 CDN 引用，无本地缩略图，降级不可用） */
const ENTRY_REMOTE = {
  id: 'e2',
  gallery: 'portrait',
  title: 'リモート条目',
  cdnUrl: 'https://cdn.example/e2.png',
  storage: 'remote',
  imageUrl: 'https://cdn.example/e2-thumb.png',
} as unknown as OpenLibEntry;

/** 一次性引用对象的 data 形状（Asset.data 为宽松联合，按 openlib 导出形状收窄） */
type OpenLibImportData = {
  kind: string;
  dataUrl: string;
  storageKey: string;
  quality?: string;
  sourceEntry?: { source: string; galleryId?: unknown; entryId: string };
};
const dataOf = (a: Asset): OpenLibImportData => a.data as OpenLibImportData;

function seedAssets(assets: Asset[]): void {
  mem.set('zeroexo:assets', assets);
}

const EXISTING_USER_ASSET: Asset = {
  id: 'user-a1',
  title: '用户已有资产',
  kind: 'image',
  scope: 'library',
  createdAt: '2026-11-05T00:00:00.000Z',
  bytes: 10,
  mimeType: 'image/png',
  data: { kind: 'image', dataUrl: '', storageKey: 'image:user-a1' },
};

const casFiles = () => Array.from(blobs.keys() as Iterable<string>).filter((k) => k.startsWith('media/cas/'));

describe('importOpenLibEntry：开源素材仅缓存 CAS + 引用，不入个人资产库', () => {
  beforeEach(() => {
    mem.clear();
    fsMock.__texts.clear();
    fsMock.__blobs.clear();
    seedAssets([EXISTING_USER_ASSET]);
    // 默认：任意 URL 下载成功（正常路径）
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url: string) => ({
      ok: true,
      blob: async () => new NodeBlob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }),
    }));
  });

  it('个人资产列表数量不变（禁止 addAsset），CAS 真实落盘并登记引用', async () => {
    const asset = await importOpenLibEntry(ENTRY);

    // ① 关键防回归：我的资产库不新增任何条目
    const after = await listAssets();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('user-a1');
    expect(after.some((a) => a.id.startsWith(OPENLIB_ASSET_PREFIX))).toBe(false);

    // ② 字节落到 media/cas/<hash>.png，cas_index 登记 openlib 引用
    expect(casFiles()).toHaveLength(1);
    expect(casFiles()[0]).toMatch(/^media\/cas\/[0-9a-f]{64}\.png$/);
    const index = await readCasIndex();
    const entryHash = Object.keys(index.entries)[0]!;
    const entry = index.entries[entryHash]!;
    expect(entry.refs).toEqual([
      expect.objectContaining({ assetId: 'openlib:e1', projectId: 'library', kind: 'image' }),
    ]);

    // ③ 一次性引用对象：storageKey 引用、无 blob URL、带开源标记与稳定 id、质量=源站原图
    expect(asset.id).toBe('openlib:e1');
    expect(asset.title).toBe(ENTRY.title);
    const data = dataOf(asset);
    expect(data.kind).toBe('image');
    expect(data.storageKey).toMatch(/^cas:[0-9a-f]{64}\.png$/);
    expect(data.storageKey).toBe(`cas:${entryHash}.png`);
    expect(data.dataUrl).toBe('');
    expect(data.quality).toBe('origin');
    expect(data.sourceEntry).toEqual({
      source: 'openlib',
      galleryId: 'shisei',
      entryId: 'e1',
    });
  });

  it('同一条目重复发送：id 稳定、物理文件唯一、引用不重复（幂等）', async () => {
    const a1 = await importOpenLibEntry(ENTRY);
    const a2 = await importOpenLibEntry(ENTRY);

    expect(a2.id).toBe(a1.id);
    expect(dataOf(a2).storageKey).toBe(dataOf(a1).storageKey);
    expect(casFiles()).toHaveLength(1);
    const index = await readCasIndex();
    const entry = Object.values(index.entries)[0]!;
    expect(entry.refs).toHaveLength(1);
    // 个人资产库仍不变
    expect(await listAssets()).toHaveLength(1);
  });

  describe('CDN 失败降级（Failed to fetch：网络/跨域被拦/离线）', () => {
    it('cdnUrl 抛 TypeError → 回落同源打包缩略图 → 可用引用且带降级标记', async () => {
      // cdnUrl 抛浏览器典型的 TypeError: Failed to fetch；同源缩略图正常
      fetchMock.mockImplementation(async (url: string) => {
        if (url === ENTRY.cdnUrl) throw new TypeError('Failed to fetch');
        return {
          ok: true,
          blob: async () => new NodeBlob([new Uint8Array([9, 9])], { type: 'image/webp' }),
        };
      });

      const asset = await importOpenLibEntry(ENTRY);

      // 请求顺序：先 CDN 原图，失败后取同源缩略图
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(1, ENTRY.cdnUrl);
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/openlib/thumbs/shisei/e1.webp');

      // 返回可用引用：缩略图字节真实落 CAS、带降级标记、个人资产库不变
      const data = dataOf(asset);
      expect(data.quality).toBe('local-thumb');
      expect(data.storageKey).toMatch(/^cas:[0-9a-f]{64}\.webp$/);
      expect(casFiles()).toHaveLength(1);
      expect(casFiles()[0]).toMatch(/^media\/cas\/[0-9a-f]{64}\.webp$/);
      expect(await listAssets()).toHaveLength(1);
      expect((await listAssets())[0]!.id).toBe('user-a1');
    });

    it('cdnUrl HTTP 404 同样触发降级（HTTP 错误与网络错误同一条降级策略）', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === ENTRY.cdnUrl) return { ok: false, status: 404, blob: async () => new NodeBlob([]) };
        return {
          ok: true,
          blob: async () => new NodeBlob([new Uint8Array([7])], { type: 'image/webp' }),
        };
      });

      const asset = await importOpenLibEntry(ENTRY);
      expect(dataOf(asset).quality).toBe('local-thumb');
      expect(casFiles()).toHaveLength(1);
    });

    it('remote 条目无本地缩略图 → 可判别失败 + 可读文案（含 name/message 与无法降级说明），不产任何缓存', async () => {
      fetchMock.mockImplementation(async () => {
        throw new TypeError('Failed to fetch');
      });

      await expect(importOpenLibEntry(ENTRY_REMOTE)).rejects.toThrow(
        /TypeError: Failed to fetch（网络中断\/跨域被拦\/离线）.*没有随站点打包的本地缩略图，无法降级/s,
      );

      // 失败即无产物：CAS 无文件、个人资产库不变
      expect(casFiles()).toHaveLength(0);
      expect(await listAssets()).toHaveLength(1);
      // 只试过 CDN，不会去请求不存在本地路径
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(ENTRY_REMOTE.cdnUrl);
    });
  });
});
