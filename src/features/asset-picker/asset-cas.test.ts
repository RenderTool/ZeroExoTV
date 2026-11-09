/**
 * asset-store × CAS 集成单测（2026-11-04）
 * 1) 删除 cas 资产 → 逐条 releaseCas，同内容其他记录不被级联；
 * 2) 存量孪生（同 image: 键）级联删除行为不变；
 * 3) addAssets 跳过重复 cas 键时释放上传阶段注册的悬空 ref；
 * 4) addAsset 采纳预生成 id 并保留 cas 引用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@zeroexo/plugin-nodes', () => ({ nodeActionBus: { emit: vi.fn() } }));
vi.mock('@/shared/current-canvas-id.js', () => ({ getCurrentCanvasId: () => 'proj-test' }));

const releaseCasMock = vi.fn(async (..._args: unknown[]) => ({ released: true, removed: false }));
const registerCasRefMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/entities/cas-store.js', () => ({
  releaseCas: (hash: string, ref: { assetId: string; projectId?: string }) => releaseCasMock(hash, ref),
  isCasStorageKey: (k: string | undefined | null) => typeof k === 'string' && k.startsWith('cas:'),
  // 2026-11-05 写入链修复后 asset-store 新增的 cas-store 依赖（本测试 jsdom 无磁盘，自愈不触发，补齐签名防 undefined）
  readCasIndex: async () => ({ schemaVersion: 1, entries: {} }),
  casFilePath: (hash: string, ext: string) => `media/cas/${hash}.${ext}`,
  casStorageKey: (hash: string, ext: string) => `cas:${hash}.${ext}`,
  hasCasEntry: async () => false,
  registerCasRef: (hash: string, ref: { assetId: string; projectId?: string }) => registerCasRefMock(hash, ref),
}));

import { addAsset, addAssets, removeAssets, listAssets } from './asset-store.js';
import { promoteAssetToScope } from './services/cas-upload.js';
import type { Asset } from './index.js';

const HASH_X = 'x'.repeat(64);

function seedAssets(assets: Asset[]): void {
  mem.set('zeroexo:assets', assets);
}

function casImageAsset(id: string, hash = HASH_X, projectId = 'proj-test'): Asset {
  return {
    id,
    title: id,
    kind: 'image',
    scope: 'project',
    projectId,
    createdAt: '2026-11-04T00:00:00.000Z',
    bytes: 10,
    mimeType: 'image/png',
    cas: { hash, ext: 'png' },
    data: { kind: 'image', dataUrl: '', storageKey: `cas:${hash}.png`, width: 1, height: 1 },
  };
}

describe('asset-store × CAS 删除语义', () => {
  beforeEach(() => {
    mem.clear();
    releaseCasMock.mockClear();
    registerCasRefMock.mockClear();
  });

  it('删除一个 cas 资产：releaseCas 被调一次；同内容另一资产不被级联删除', async () => {
    seedAssets([casImageAsset('a1'), casImageAsset('a2')]);
    const deleted = await removeAssets(['a1']);

    expect(deleted.map((a) => a.id)).toEqual(['a1']);
    expect(releaseCasMock).toHaveBeenCalledTimes(1);
    expect(releaseCasMock).toHaveBeenCalledWith(HASH_X, { assetId: 'a1', projectId: 'proj-test' });

    const rest = await listAssets();
    expect(rest.map((a) => a.id)).toEqual(['a2']); // cas 键不按 storageKey 级联
  });

  it('删除公共库副本时，仍引用同一 CAS 的存量历史记录会被补挂 ref（不误删视频文件）', async () => {
    // 历史产物形态：只有 storageKey=cas:<hash>.<ext>，没有 cas 字段（存量/节点保存链路）
    const legacyHistory: Asset = {
      id: 'history-v1',
      title: '历史视频',
      kind: 'video',
      scope: 'project',
      projectId: 'proj-test',
      createdAt: '2026-11-04T00:00:00.000Z',
      bytes: 10,
      mimeType: 'video/mp4',
      data: { kind: 'video', url: '', storageKey: `cas:${HASH_X}.mp4`, durationMs: 1000 } as never,
    };
    const libraryCopy: Asset = {
      ...casImageAsset('lib-copy'),
      kind: 'video',
      cas: { hash: HASH_X, ext: 'mp4' },
      data: { kind: 'video', url: '', storageKey: `cas:${HASH_X}.mp4` } as never,
      scope: 'library',
      projectId: undefined,
    };
    seedAssets([legacyHistory, libraryCopy]);

    await removeAssets(['lib-copy']);

    // 删除前先给仍在引用同一内容的记录补 ref，再释放被删记录 → 文件不会因 refCount=0 被删
    expect(registerCasRefMock).toHaveBeenCalledWith(HASH_X, { assetId: 'history-v1', projectId: 'proj-test', kind: 'video' });
    expect(releaseCasMock).toHaveBeenCalledWith(HASH_X, { assetId: 'lib-copy', projectId: undefined });
    const rest = await listAssets();
    expect(rest.map((a) => a.id)).toEqual(['history-v1']);
  });

  it('两个 cas 引用都删完：releaseCas 各调一次（到 0 由 cas-store 删文件，本层不重复调）', async () => {
    seedAssets([casImageAsset('a1'), casImageAsset('a2')]);
    await removeAssets(['a1']);
    await removeAssets(['a2']);
    expect(releaseCasMock).toHaveBeenCalledTimes(2);
    expect(await listAssets()).toHaveLength(0);
  });

  it('重复删除幂等：第二次删同 id 不再调 releaseCas、不报错', async () => {
    seedAssets([casImageAsset('a1')]);
    await removeAssets(['a1']);
    releaseCasMock.mockClear();
    const again = await removeAssets(['a1']);
    expect(again).toEqual([]);
    expect(releaseCasMock).not.toHaveBeenCalled();
  });

  it('存量孪生（同 image: 键、无 cas）仍按旧语义级联删除', async () => {
    const legacy = (id: string): Asset => ({
      id,
      title: id,
      kind: 'image',
      createdAt: '2026-11-04T00:00:00.000Z',
      bytes: 10,
      data: { kind: 'image', dataUrl: '', storageKey: 'image:shared-legacy', width: 1, height: 1 },
    });
    seedAssets([legacy('t1'), legacy('t2')]);
    const deleted = await removeAssets(['t1']);
    expect(deleted.map((a) => a.id).sort()).toEqual(['t1', 't2']); // 旧级联保留
    expect(releaseCasMock).not.toHaveBeenCalled(); // 无 cas 字段不触发释放
  });
});

describe('asset-store × CAS 创建语义', () => {
  beforeEach(() => {
    mem.clear();
    releaseCasMock.mockClear();
  });

  it('addAsset 采纳预生成 id 并保留 cas 引用', async () => {
    const created = await addAsset({
      id: 'pre-1',
      cas: { hash: HASH_X, ext: 'png' },
      title: '图',
      kind: 'image',
      bytes: 10,
      data: { kind: 'image', dataUrl: '', storageKey: `cas:${HASH_X}.png` },
    });
    expect(created.id).toBe('pre-1');
    expect(created.cas).toEqual({ hash: HASH_X, ext: 'png' });
  });

  it('addAssets 跳过重复 cas 键：不建第二份记录，并释放上传阶段注册的悬空 ref', async () => {
    seedAssets([casImageAsset('a1')]);
    const created = await addAssets([
      {
        id: 'dup-9',
        cas: { hash: HASH_X, ext: 'png' },
        title: '重复上传',
        kind: 'image',
        bytes: 10,
        data: { kind: 'image', dataUrl: '', storageKey: `cas:${HASH_X}.png` },
      },
    ]);
    expect(created).toHaveLength(0); // 去重跳过
    expect(await listAssets()).toHaveLength(1);
    expect(releaseCasMock).toHaveBeenCalledTimes(1);
    expect(releaseCasMock).toHaveBeenCalledWith(HASH_X, { assetId: 'dup-9' });
  });
});

describe('promoteAssetToScope：导出目标可选，且只处理传入的那一条', () => {
  beforeEach(() => {
    mem.clear();
    releaseCasMock.mockClear();
  });

  it("target='library' → 只新增一条公共库记录（其它历史产出不被一起导出）", async () => {
    const h2 = 'y'.repeat(64);
    seedAssets([
      casImageAsset('keep-1'),
      casImageAsset('keep-2', h2),
    ]);
    const created = await promoteAssetToScope(casImageAsset('keep-1'), 'library');
    expect(created?.scope).toBe('library');
    expect(created?.projectId).toBeUndefined();
    const all = await listAssets();
    expect(all.filter((a) => (a.scope ?? 'library') === 'library')).toHaveLength(1);
    expect(all).toHaveLength(3); // 原 2 条 + 新导出 1 条，未批量复制
  });

  it("target='project' → 同项目同内容已存在时返回 null（不重复导出）", async () => {
    seedAssets([casImageAsset('p1')]);
    const created = await promoteAssetToScope(casImageAsset('p1'), 'project');
    expect(created).toBeNull();
    expect(await listAssets()).toHaveLength(1);
  });

  it("target='project' → 从公共库导出时写入 projectId=当前项目", async () => {
    const lib: Asset = { ...casImageAsset('lib-1'), scope: 'library', projectId: undefined };
    seedAssets([lib]);
    const created = await promoteAssetToScope(lib, 'project');
    expect(created?.scope).toBe('project');
    expect(created?.projectId).toBe('proj-test');
  });
});
