/**
 * asset-scope 单测：资产项目化（公共/私有可视区分）数据层契约
 * 1) 存量无 scope 记录经 listAssets 惰性迁移为 scope='library'（且写回持久层一次）
 * 2) setCurrentCanvasId('c1') 后 addAsset 默认 scope='project' 且 projectId='c1'；
 *    无当前项目时降级为 scope='library' 且不写 projectId
 * 3) canWriteAsset 守卫矩阵：library 资产 project 视图不可写/library 视图可写；
 *    project 资产跨项目不可写/本项目可写；无 scope 视为 library
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== mock localforage：内存 Map 实现 =====
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

// ===== mock nodeActionBus：emit 空实现（@zeroexo/plugin-nodes 其余导出本测试不触达） =====
vi.mock('@zeroexo/plugin-nodes', () => ({
  nodeActionBus: { emit: () => undefined },
}));

import {
  listAssets,
  addAsset,
  clearAllAssets,
  migrateAssetScopes,
  canWriteAsset,
  filterAssetsByScope,
  filterAssetsStrictScope,
  countAssetsByScope,
  resolveUploadScope,
  isLibraryAllowedKind,
  assertLibraryKind,
  LIBRARY_ALLOWED_KINDS,
} from './asset-store.js';
import type { Asset } from './index.js';
import { setCurrentCanvasId } from '@/shared/current-canvas-id.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stores = (await import('localforage') as any).__stores as Map<string, Map<string, unknown>>;
const appStateBucket = (): Map<string, unknown> => {
  if (!stores.has('app_state')) stores.set('app_state', new Map());
  return stores.get('app_state')!;
};
const ASSETS_KEY = 'zeroexo:assets';

/** 构造最小合法存量记录（无 scope，模拟迁移前数据） */
function legacyAsset(id: string, title: string): Record<string, unknown> {
  return {
    id,
    title,
    kind: 'text',
    createdAt: '2026-01-01T00:00:00.000Z',
    bytes: 0,
    data: { kind: 'text', content: 'x' },
    folderId: null,
    favorite: false,
  };
}

beforeEach(async () => {
  appStateBucket().clear();
  setCurrentCanvasId(null);
  await clearAllAssets();
});

describe('migrateAssetScopes 纯函数', () => {
  it('无 scope 记录迁移为 library，已有 scope 不动，changed 标记正确', () => {
    const input = [
      legacyAsset('a1', '旧记录'),
      { ...legacyAsset('a2', '已是公共'), scope: 'library' },
      { ...legacyAsset('a3', '已是项目'), scope: 'project', projectId: 'c1' },
    ] as unknown as Asset[];
    const r = migrateAssetScopes(input);
    expect(r.changed).toBe(true);
    expect(r.list.map((a) => a.scope)).toEqual(['library', 'library', 'project']);
    expect(r.list.find((a) => a.id === 'a3')?.projectId).toBe('c1');
    // 不迁移时 changed=false 且引用不变
    const r2 = migrateAssetScopes(r.list);
    expect(r2.changed).toBe(false);
    expect(r2.list[0]).toBe(r.list[0]);
  });
});

describe('listAssets 惰性迁移写回', () => {
  it('存量无 scope 记录经 listAssets 后全部 scope=library，且持久层已写回', async () => {
    appStateBucket().set(ASSETS_KEY, [legacyAsset('a1', '旧1'), legacyAsset('a2', '旧2')]);
    const list = await listAssets();
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.scope === 'library')).toBe(true);
    // 写回持久层
    const persisted = appStateBucket().get(ASSETS_KEY) as Asset[];
    expect(persisted.every((a) => a.scope === 'library')).toBe(true);
  });

  it('全部已带 scope 时不触发写回（持久层引用不变）', async () => {
    const seeded = [{ ...legacyAsset('a1', '新1'), scope: 'library' as const }];
    appStateBucket().set(ASSETS_KEY, seeded);
    await listAssets();
    expect(appStateBucket().get(ASSETS_KEY)).toBe(seeded);
  });
});

describe('addAsset 归属默认值', () => {
  it("setCurrentCanvasId('c1') 后默认 scope='project' 且 projectId='c1'", async () => {
    setCurrentCanvasId('c1');
    const a = await addAsset({
      title: '项目资产',
      kind: 'text',
      bytes: 1,
      data: { kind: 'text', content: 'hello' },
    });
    expect(a.scope).toBe('project');
    expect(a.projectId).toBe('c1');
  });

  it('无当前项目时降级为 library 且不写 projectId', async () => {
    setCurrentCanvasId(null);
    const a = await addAsset({
      title: '降级资产',
      kind: 'text',
      bytes: 1,
      data: { kind: 'text', content: 'hello' },
    });
    expect(a.scope).toBe('library');
    expect(a.projectId).toBeUndefined();
  });

  it("显式 scope='library' 时不写 projectId（即使传入 projectId）", async () => {
    setCurrentCanvasId('c1');
    const a = await addAsset({
      title: '公共资产',
      kind: 'text',
      bytes: 1,
      data: { kind: 'text', content: 'hello' },
      scope: 'library',
      projectId: 'c9',
    });
    expect(a.scope).toBe('library');
    expect(a.projectId).toBeUndefined();
  });

  it("显式 scope='project' + 显式 projectId 优先于当前画布", async () => {
    setCurrentCanvasId('c1');
    const a = await addAsset({
      title: '跨项目资产',
      kind: 'text',
      bytes: 1,
      data: { kind: 'text', content: 'hello' },
      scope: 'project',
      projectId: 'c2',
    });
    expect(a.scope).toBe('project');
    expect(a.projectId).toBe('c2');
  });
});

describe('canWriteAsset 守卫矩阵', () => {
  const lib = { scope: 'library' as const };
  const projC1 = { scope: 'project' as const, projectId: 'c1' };

  it('library 资产：project 视图 false，library 视图 true', () => {
    expect(canWriteAsset(lib, { view: 'project', projectId: 'c1' })).toBe(false);
    expect(canWriteAsset(lib, { view: 'library', projectId: 'c1' })).toBe(true);
    expect(canWriteAsset(lib, { view: 'library', projectId: null })).toBe(true);
  });

  it('project 资产：跨项目 false，本项目 true，library 视图 false', () => {
    expect(canWriteAsset(projC1, { view: 'project', projectId: 'c2' })).toBe(false);
    expect(canWriteAsset(projC1, { view: 'project', projectId: null })).toBe(false);
    expect(canWriteAsset(projC1, { view: 'project', projectId: 'c1' })).toBe(true);
    expect(canWriteAsset(projC1, { view: 'library', projectId: 'c1' })).toBe(false);
  });

  it('无 scope 的视为 library', () => {
    expect(canWriteAsset({}, { view: 'project', projectId: 'c1' })).toBe(false);
    expect(canWriteAsset({}, { view: 'library', projectId: null })).toBe(true);
  });
});

describe('filterAssetsByScope 场外空间口径', () => {
  const mixed = [
    { ...legacyAsset('p1', '项目c1资产'), scope: 'project', projectId: 'c1' },
    { ...legacyAsset('p2', '项目c2资产'), scope: 'project', projectId: 'c2' },
    { ...legacyAsset('l1', '公共资产1'), scope: 'library' },
    legacyAsset('l2', '存量无scope资产'), // 无 scope 视为 library
  ] as unknown as Asset[];
  const countProject = (list: Asset[]): number =>
    list.filter((a) => (a.scope ?? 'library') === 'project').length;

  it('无项目上下文（projectId=null）：project 资产计数为 0（scopeTab=library）', () => {
    const out = filterAssetsByScope(mixed, { scopeTab: 'library', projectId: null });
    expect(out).toHaveLength(2);
    expect(countProject(out)).toBe(0);
  });

  it("无项目上下文（projectId=null）：即使误传 scopeTab='project' 也兜底只出公共库", () => {
    const out = filterAssetsByScope(mixed, { scopeTab: 'project', projectId: null });
    expect(countProject(out)).toBe(0);
    expect(out.every((a) => (a.scope ?? 'library') === 'library')).toBe(true);
  });

  it('项目内 + 本项目页签：本项目资产 + 全部公共库资产，排除他项目资产', () => {
    const out = filterAssetsByScope(mixed, { scopeTab: 'project', projectId: 'c1' });
    expect(out.map((a) => a.id).sort()).toEqual(['l1', 'l2', 'p1']);
  });

  it('项目内 + 公共库页签：仅公共库资产', () => {
    const out = filterAssetsByScope(mixed, { scopeTab: 'library', projectId: 'c1' });
    expect(out.map((a) => a.id).sort()).toEqual(['l1', 'l2']);
  });

  it('公共库视图过滤业务 kind：library 范围的剧本/工程类资产不出现在公共库列表', () => {
    const withBiz = [
      ...mixed,
      { ...legacyAsset('s1', '公共剧本'), kind: 'script', scope: 'library' },
      { ...legacyAsset('g1', '工程类'), kind: 'plan', scope: 'library' },
    ] as unknown as Asset[];
    const out = filterAssetsByScope(withBiz, { scopeTab: 'library', projectId: null });
    expect(out.some((a) => a.id === 's1' || a.id === 'g1')).toBe(false);
    // 项目内视图不受此限：本项目页签仍可见公共库业务资产（引用态）
    const outProject = filterAssetsByScope(withBiz, { scopeTab: 'project', projectId: 'c1' });
    expect(outProject.some((a) => a.id === 's1')).toBe(true);
  });
});

describe('公共库四类白名单（LIBRARY_ALLOWED_KINDS / assertLibraryKind）', () => {
  it('白名单恰为 image/video/audio/text 四类', () => {
    expect([...LIBRARY_ALLOWED_KINDS].sort()).toEqual(['audio', 'image', 'text', 'video']);
    for (const k of LIBRARY_ALLOWED_KINDS) expect(isLibraryAllowedKind(k)).toBe(true);
  });

  it('assertLibraryKind：四类放行，业务 kind（script/plan 等）抛错拒绝', () => {
    expect(() => assertLibraryKind('image')).not.toThrow();
    expect(() => assertLibraryKind('video')).not.toThrow();
    expect(() => assertLibraryKind('audio')).not.toThrow();
    expect(() => assertLibraryKind('text')).not.toThrow();
    expect(() => assertLibraryKind('script' as Asset['kind'])).toThrow(/全局资产库只收图片、视频、音频、文本/);
    expect(() => assertLibraryKind('plan' as Asset['kind'])).toThrow(/全局资产库只收图片、视频、音频、文本/);
  });

  it("addAsset 公共库创建路径：scope='library' + 业务 kind 被拒（抛错，不落库）", async () => {
    await expect(
      addAsset({
        title: '误建剧本',
        kind: 'script',
        bytes: 0,
        data: { kind: 'script', content: '{}', storageKey: '' } as Asset['data'],
        scope: 'library',
      }),
    ).rejects.toThrow(/全局资产库只收图片、视频、音频、文本/);
    expect(appStateBucket().has(ASSETS_KEY)).toBe(false);
  });

  it("addAsset 公共库创建路径：scope='library' + 四类 kind 正常创建", async () => {
    const a = await addAsset({
      title: '公共文本',
      kind: 'text',
      bytes: 1,
      data: { kind: 'text', content: 'ok' },
      scope: 'library',
    });
    expect(a.scope).toBe('library');
  });

  it('addAsset 项目内不受四类限制：scope=project 可建业务 kind', async () => {
    setCurrentCanvasId('c1');
    const a = await addAsset({
      title: '项目剧本',
      kind: 'script',
      bytes: 0,
      data: { kind: 'script', content: '{}', storageKey: '' } as Asset['data'],
    });
    expect(a.scope).toBe('project');
    expect(a.kind).toBe('script');
  });
});

// ===== 2026-11-04 胶囊 Tab 严格口径：单段不混排 / 数量徽标 / 上传归属分流 =====

describe('filterAssetsStrictScope 胶囊 Tab 严格口径（单段不混排）', () => {
  const mixed = [
    { ...legacyAsset('p1', '项目c1资产'), scope: 'project', projectId: 'c1' },
    { ...legacyAsset('p2', '项目c2资产'), scope: 'project', projectId: 'c2' },
    { ...legacyAsset('l1', '公共资产1'), scope: 'library' },
    legacyAsset('l2', '存量无scope资产'), // 无 scope 视为 library
    { ...legacyAsset('s1', '公共剧本'), kind: 'script', scope: 'library' }, // 业务 kind 不进公共段
  ] as unknown as Asset[];

  it('本项目段：只出当前 projectId 的项目资产，公共库不以引用态混入、他项目不出现', () => {
    const out = filterAssetsStrictScope(mixed, { scopeTab: 'project', projectId: 'c1' });
    expect(out.map((a) => a.id)).toEqual(['p1']);
    expect(out.every((a) => a.scope === 'project' && a.projectId === 'c1')).toBe(true);
  });

  it('公共段：只出公共库资产（四类白名单），项目资产与业务 kind 均不出现', () => {
    const out = filterAssetsStrictScope(mixed, { scopeTab: 'library', projectId: 'c1' });
    expect(out.map((a) => a.id).sort()).toEqual(['l1', 'l2']);
    expect(out.some((a) => a.id === 's1')).toBe(false);
  });

  it("无项目上下文兜底：即使误传 scopeTab='project' 也只出公共库（主页无假页面）", () => {
    const out = filterAssetsStrictScope(mixed, { scopeTab: 'project', projectId: null });
    expect(out.every((a) => (a.scope ?? 'library') === 'library')).toBe(true);
    expect(out.map((a) => a.id).sort()).toEqual(['l1', 'l2']);
  });

  it('切换后两段互不串数据：同一数据源两段的 id 集合无交集', () => {
    const lib = filterAssetsStrictScope(mixed, { scopeTab: 'library', projectId: 'c1' });
    const proj = filterAssetsStrictScope(mixed, { scopeTab: 'project', projectId: 'c1' });
    const libIds = new Set(lib.map((a) => a.id));
    expect(proj.every((a) => !libIds.has(a.id))).toBe(true);
  });
});

describe('countAssetsByScope 数量徽标口径', () => {
  const mixed = [
    { ...legacyAsset('p1', '项目c1资产'), scope: 'project', projectId: 'c1' },
    { ...legacyAsset('p2', '项目c2资产'), scope: 'project', projectId: 'c2' },
    { ...legacyAsset('l1', '公共资产1'), scope: 'library' },
    legacyAsset('l2', '存量无scope资产'),
    { ...legacyAsset('s1', '公共剧本'), kind: 'script', scope: 'library' }, // 不计入公共徽标
  ] as unknown as Asset[];

  it('有项目上下文：library=四类白名单公共数，project=当前项目数（他项目不计）', () => {
    expect(countAssetsByScope(mixed, 'c1')).toEqual({ library: 2, project: 1 });
    expect(countAssetsByScope(mixed, 'c2')).toEqual({ library: 2, project: 1 });
    expect(countAssetsByScope(mixed, 'c3')).toEqual({ library: 2, project: 0 });
  });

  it('无项目上下文：project=null（「本项目」段置灰），library 正常计数', () => {
    expect(countAssetsByScope(mixed, null)).toEqual({ library: 2, project: null });
  });

  it('数量随数据实时变化：追加资产后计数同步增长', () => {
    const before = countAssetsByScope(mixed, 'c1');
    const after = countAssetsByScope(
      [...mixed, { ...legacyAsset('p3', '新项目资产'), scope: 'project', projectId: 'c1' } as unknown as Asset],
      'c1',
    );
    expect(after.project).toBe((before.project ?? 0) + 1);
    expect(after.library).toBe(before.library);
  });
});

describe('resolveUploadScope 上传归属跟随当前 Tab', () => {
  it('公共段上传 → library（不写 projectId）', () => {
    expect(resolveUploadScope('library', 'c1')).toEqual({ scope: 'library' });
    expect(resolveUploadScope('library', null)).toEqual({ scope: 'library' });
  });

  it('本项目段上传 → project + 当前 projectId（不依赖 getCurrentCanvasId 残留值）', () => {
    expect(resolveUploadScope('project', 'c1')).toEqual({ scope: 'project', projectId: 'c1' });
  });

  it('本项目段但无项目上下文 → 兜底 library（防场外误建项目资产）', () => {
    expect(resolveUploadScope('project', null)).toEqual({ scope: 'library' });
  });

  it('上传分流落库断言：公共段产物进公共段、本项目段产物进本项目段，两段互不串', async () => {
    const libScope = resolveUploadScope('library', 'c1');
    const projScope = resolveUploadScope('project', 'c1');
    const libAsset = await addAsset({
      title: '公共上传', kind: 'text', bytes: 1,
      data: { kind: 'text', content: 'lib' }, ...libScope,
    });
    const projAsset = await addAsset({
      title: '项目上传', kind: 'text', bytes: 1,
      data: { kind: 'text', content: 'proj' }, ...projScope,
    });
    const libList = filterAssetsStrictScope([libAsset, projAsset], { scopeTab: 'library', projectId: 'c1' });
    const projList = filterAssetsStrictScope([libAsset, projAsset], { scopeTab: 'project', projectId: 'c1' });
    expect(libList.map((a) => a.id)).toEqual([libAsset.id]);
    expect(projList.map((a) => a.id)).toEqual([projAsset.id]);
  });
});
