/**
 * asset-store 磁盘写入链集成单测（2026-11-05 用户所有图片看不到 · 根因修复验收）
 *
 * 根因：素材记录经 localforage app_state 实例写入，boot 驱动链（FS→IndexedDB→…）首次
 * 使用时静默降级且粘滞——数据根授权前发起的首个操作让整个会话的写入全部落进浏览器
 * IndexedDB，磁盘零写入且无任何报错（.lf/_map.json 账本无 app_state 键为证）。
 * 修复：readAll/writeAll 直走 platform/fs（与 disk-driver 同路径同信封
 * `.lf/zeroexo/app_state/zeroexo%3Aassets.json`，格式 {__lf:1,value}），磁盘不可用才回退
 * 旧通道并大声警告；另按 cas_index + media/cas 实际文件做一次性自愈重建（带重建清单）。
 *
 * 本套验证（fs 全 mock 为内存 FS，localforage mock 为内存 map）：
 * 1) addAssets → 磁盘权威文件真实出现（驱动兼容信封格式），listAssets 读回一致；
 * 2) 驱动时代旧信封文件（含 data: 大图）可直接读并完成清洗迁移；
 * 3) 自愈重建：cas_index 引用 + 物理文件在 + 记录缺失 → 重建；文件缺失不造记录；
 *    openlib: 合成 id 跳过（发送到画布不入我的资产库，防回归）；重建清单先落盘；
 * 4) 自愈幂等、不覆盖既有记录；
 * 5) 磁盘写失败 → 回退旧 localforage 通道（不静默炸）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 旧 localforage 通道 mock（内存 map）
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

const { listProjectsMock } = vi.hoisted(() => ({ listProjectsMock: vi.fn() }));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()), listProjects: () => listProjectsMock() }));
vi.mock('@zeroexo/plugin-nodes', () => ({ nodeActionBus: { emit: vi.fn() } }));
vi.mock('@/shared/current-canvas-id.js', () => ({ getCurrentCanvasId: () => 'proj-test' }));

// 磁盘权威通道 mock：platform/fs 内存 FS（cas_index 经真实 cas-store 走同一 mock）
vi.mock('@/platform/fs', () => {
  const texts = new Map<string, { text: string; lastModified: number }>();
  const blobs = new Map<string, { data: Uint8Array; mime: string; lastModified: number }>();
  let tick = 0;
  return {
    __texts: texts,
    __blobs: blobs,
    readFile: async (p: string) => {
      const f = texts.get(p);
      return f ? f.text : null;
    },
    writeFile: async (p: string, data: string | Blob) => {
      texts.set(p, { text: String(data), lastModified: ++tick });
    },
    writeJson: async (p: string, value: unknown) => {
      texts.set(p, { text: JSON.stringify(value), lastModified: ++tick });
    },
    // cas-store 读索引 / 乐观锁写索引都走这两个导出；缺了会让自愈重建整批失败
    readJson: async (p: string) => {
      const f = texts.get(p);
      return f ? JSON.parse(f.text) : null;
    },
    writeJsonIfUnchanged: async (p: string, value: unknown) => {
      texts.set(p, { text: JSON.stringify(value), lastModified: ++tick });
    },
    stat: async (p: string) => {
      const t = texts.get(p);
      if (t) return { size: t.text.length, lastModified: t.lastModified };
      const b = blobs.get(p);
      if (b) return { size: b.data.byteLength, lastModified: b.lastModified };
      return null;
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

import { addAssets, listAssets, clearAllAssets, __resetAssetStoreSessionGuardsForTest } from './asset-store.js';
import type { Asset } from './index.js';

// 会话级守卫每用例重置（legacy 合并 / CAS 自愈都是「每会话一次」）
beforeEach(() => {
  __resetAssetStoreSessionGuardsForTest();
  listProjectsMock.mockResolvedValue([{ id: 'proj-live' }]);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsMock = (await import('@/platform/fs') as any);
const texts = fsMock.__texts as Map<string, { text: string }>;
const blobs = fsMock.__blobs as Map<string, unknown>;

const ASSETS_FILE = '.lf/zeroexo/app_state/zeroexo%3Aassets.json';
const MANIFEST_FILE = 'entities/asset-rebuild-manifest.json';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);
const H4 = 'd'.repeat(64);

function seedCasFile(hash: string, bytes = [1, 2, 3]): void {
  fsMock.writeFileBlob(`media/cas/${hash}.png`, new Uint8Array(bytes), 'image/png');
}

function seedCasIndex(entries: Record<string, unknown>): void {
  texts.set('entities/cas_index.json', { text: JSON.stringify({ schemaVersion: 1, entries }) });
}

function readDiskAssets(): Array<Record<string, unknown>> {
  const f = texts.get(ASSETS_FILE);
  if (!f) return [];
  const parsed = JSON.parse(f.text) as { value?: Array<Record<string, unknown>> };
  return parsed.value ?? [];
}

function legacyRecord(id: string, storageKey: string): Record<string, unknown> {
  return {
    id,
    title: id,
    kind: 'image',
    createdAt: '2026-11-05T00:00:00.000Z',
    bytes: 10,
    mimeType: 'image/png',
    data: { kind: 'image', dataUrl: '', storageKey },
  };
}

const NEW_CAS_ASSET: Parameters<typeof addAssets>[0][number] = {
  id: 'new-1',
  cas: { hash: H1, ext: 'png' },
  title: '新图',
  kind: 'image',
  bytes: 3,
  mimeType: 'image/png',
  data: { kind: 'image', dataUrl: '', storageKey: `cas:${H1}.png` },
};

describe('写入链：addAssets → 磁盘权威文件（驱动兼容信封）', () => {
  beforeEach(() => {
    mem.clear();
    texts.clear();
    blobs.clear();
  });

  it('addAssets 后 .lf/zeroexo/app_state/zeroexo%3Aassets.json 真实出现，格式为 disk-driver 信封 {__lf:1,value}', async () => {
    await addAssets([NEW_CAS_ASSET]);

    const f = texts.get(ASSETS_FILE);
    expect(f).toBeTruthy();
    const parsed = JSON.parse(f!.text) as { __lf?: number; value?: Array<Record<string, unknown>> };
    // 信封格式与 disk-driver writeEntry 逐字一致（驱动可读、旧文件可互换）
    expect(parsed.__lf).toBe(1);
    expect(parsed.value).toHaveLength(1);
    expect(parsed.value![0]!.id).toBe('new-1');
    // listAssets 从磁盘读回同一记录（导入一张图 → assets.json 多一条 → 网格可见）
    const list = await listAssets();
    expect(list.map((a) => a.id)).toEqual(['new-1']);
  });

  it('驱动时代旧信封文件（data: 大图记录）可直接读并完成清洗迁移', async () => {
    // 模拟 46MB 存量文件（驱动写入的同格式信封，记录里带 data: URL）
    texts.set(ASSETS_FILE, {
      text: JSON.stringify({
        __lf: 1,
        value: [
          {
            id: 'old-1',
            title: '存量图',
            kind: 'image',
            createdAt: '2026-11-04T00:00:00.000Z',
            bytes: 10,
            mimeType: 'image/png',
            data: { kind: 'image', dataUrl: 'data:image/png;base64,AAAA', storageKey: 'image:old-1' },
          },
        ],
      }),
    });

    const list = await listAssets();
    expect(list.map((a) => a.id)).toEqual(['old-1']);
    // data: 被清洗（storageKey 在位时冗余 data: 剥离），清洗结果写回磁盘
    const onDisk = readDiskAssets();
    expect((onDisk[0]!.data as Record<string, unknown>).dataUrl).toBe('');
    expect((onDisk[0]!.data as Record<string, unknown>).storageKey).toBe('image:old-1');
  });

  it('磁盘写失败 → 回退旧 localforage 通道，addAssets 仍成功且不静默炸', async () => {
    const realWriteFile = fsMock.writeFile;
    fsMock.writeFile = async () => {
      throw new Error('磁盘不可用');
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await addAssets([NEW_CAS_ASSET]);
      // 回退通道生效：旧 localforage 里拿到记录
      const legacy = mem.get('zeroexo:assets') as Asset[];
      expect(legacy.map((a) => a.id)).toEqual(['new-1']);
      expect(warnSpy).toHaveBeenCalled(); // 大声警告，绝不静默
    } finally {
      fsMock.writeFile = realWriteFile;
      warnSpy.mockRestore();
    }
  });
});

describe('自愈重建：按 cas_index + media/cas 实际文件重建丢失记录（幂等）', () => {
  beforeEach(() => {
    mem.clear();
    texts.clear();
    blobs.clear();
    // 索引：h1/h3 文件在（可重建）；h2 文件缺失（绝不造记录）；h4 是 openlib 合成 id（跳过）
    seedCasFile(H1);
    seedCasFile(H3);
    seedCasIndex({
      [H1]: { path: `media/cas/${H1}.png`, size: 3, mime: 'image/png', ext: 'png', refCount: 1, createdAt: '2026-11-05T07:31:16.000Z', refs: [{ assetId: 'ReG0xI5J59vOc0VlVcWNz', projectId: 'proj-live', kind: 'image' }] },
      [H2]: { path: `media/cas/${H2}.png`, size: 3, mime: 'image/png', ext: 'png', refCount: 1, createdAt: '2026-11-05T07:33:53.000Z', refs: [{ assetId: 'knHuHiEKMCvjm-gecCcVl', projectId: 'proj-live', kind: 'image' }] },
      [H3]: { path: `media/cas/${H3}.png`, size: 3, mime: 'image/png', ext: 'png', refCount: 1, createdAt: '2026-11-05T07:20:00.000Z', refs: [{ assetId: 'lib-asset-1', projectId: 'library', kind: 'image' }] },
      [H4]: { path: `media/cas/${H4}.png`, size: 3, mime: 'image/png', ext: 'png', refCount: 1, createdAt: '2026-11-05T07:10:00.000Z', refs: [{ assetId: 'openlib:e9', projectId: 'library', kind: 'image' }] },
    });
  });

  it('assets.json 缺失：首次 listAssets 重建记录（文件在的才建、文件缺失的不建），重建清单先落盘', async () => {
    // openlib: 合成 id 虽有引用且文件在（补一份物理文件验证跳过逻辑）
    seedCasFile(H4);
    const list = await listAssets();

    // 只重建 h1（项目作用域）与 h3（library 作用域）；h2 物理文件缺失不造记录；h4 openlib 跳过
    expect(list.map((a) => a.id).sort()).toEqual(['ReG0xI5J59vOc0VlVcWNz', 'lib-asset-1']);

    const rebuiltProject = list.find((a) => a.id === 'ReG0xI5J59vOc0VlVcWNz')!;
    expect(rebuiltProject.scope).toBe('project');
    expect(rebuiltProject.projectId).toBe('proj-live');
    expect(rebuiltProject.cas).toEqual({ hash: H1, ext: 'png' });
    expect((rebuiltProject.data as Record<string, unknown>).storageKey).toBe(`cas:${H1}.png`);

    const rebuiltLib = list.find((a) => a.id === 'lib-asset-1')!;
    expect(rebuiltLib.scope).toBe('library');

    // 记录真实落盘（信封格式）
    expect(readDiskAssets().map((a) => a.id).sort()).toEqual(['ReG0xI5J59vOc0VlVcWNz', 'lib-asset-1']);

    // 重建清单已写入，内容与重建一致
    const manifest = JSON.parse(texts.get(MANIFEST_FILE)!.text) as {
      items: Array<{ id: string; hash: string; kind: string; projectId: string }>;
    };
    expect(manifest.items.map((i) => i.id).sort()).toEqual(['ReG0xI5J59vOc0VlVcWNz', 'lib-asset-1']);
  });

  it('项目索引也被删：恢复记录归公共库（否则资产页永远显示「还没有资产」）', async () => {
    listProjectsMock.mockResolvedValue([]);
    const list = await listAssets();
    const rebuilt = list.find((a) => a.id === 'ReG0xI5J59vOc0VlVcWNz')!;
    expect(rebuilt.scope).toBe('library');
    expect((rebuilt.data as Record<string, unknown>).storageKey).toBe(`cas:${H1}.png`);
  });

  it('幂等：再次 listAssets 不重复重建、不覆盖既有记录', async () => {
    // 先有一条用户记录（磁盘信封在位）
    texts.set(ASSETS_FILE, { text: JSON.stringify({ __lf: 1, value: [legacyRecord('user-keep', 'image:user-keep')] }) });

    const first = await listAssets();
    expect(first.map((a) => a.id).sort()).toEqual(['ReG0xI5J59vOc0VlVcWNz', 'lib-asset-1', 'user-keep']);

    const second = await listAssets();
    expect(second).toHaveLength(3); // 不重复、不叠加
    // 既有记录原样保留（先读后写，不覆盖他人记录）
    const keep = second.find((a) => a.id === 'user-keep')!;
    expect(keep.title).toBe('user-keep');
  });

  it('记录已在（id 或同内容 storageKey）→ 不造孪生', async () => {
    texts.set(ASSETS_FILE, {
      text: JSON.stringify({
        __lf: 1,
        value: [
          // 同 h1 内容、但换了 id 的既有记录：不得因 ref.assetId 缺失而造孪生
          { ...legacyRecord('existing-owner', `cas:${H1}.png`), cas: { hash: H1, ext: 'png' } },
        ],
      }),
    });

    const list = await listAssets();
    expect(list.map((a) => a.id).sort()).toEqual(['existing-owner', 'lib-asset-1']); // h1 未被重建第二条
  });
});

describe('clearAllAssets：双通道都清', () => {
  it('磁盘文件与旧通道记录都被清除', async () => {
    await addAssets([NEW_CAS_ASSET]);
    expect(texts.get(ASSETS_FILE)).toBeTruthy();
    await clearAllAssets();
    expect(texts.get(ASSETS_FILE)).toBeUndefined();
    expect(mem.get('zeroexo:assets')).toBeUndefined();
  });
});
