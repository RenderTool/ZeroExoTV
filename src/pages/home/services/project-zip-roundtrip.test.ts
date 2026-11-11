/**
 * 项目包 round-trip（C-05）：导出的 ZIP 必须含剧本 MD / 主体 MD / 无损 JSON / CAS 二进制，
 * 导入后剧本、主体、导演台、资产记录都挂到新项目 id 下，CAS 键不被 nanoid 改坏。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => ({
  writeJson: vi.fn(),
  addAssets: vi.fn(),
  putCas: vi.fn(),
  ensureProjectMounts: vi.fn(),
  importProjects: vi.fn(),
  saveProjectGraph: vi.fn(),
  setImageBlob: vi.fn(),
  setMediaBlob: vi.fn(),
  createCanvas: vi.fn(),
  getDiskBlob: vi.fn(),
  listAssets: vi.fn(),
  readScript: vi.fn(),
  readStoryboard: vi.fn(),
  readWorkbench: vi.fn(),
  listProjects: vi.fn(),
  loadProjectGraph: vi.fn(),
  getImageBlob: vi.fn(async () => null),
  getMediaBlob: vi.fn(async () => null),
  listCanvases: vi.fn(async () => []),
  verifySnapshot: vi.fn(),
}));

vi.mock('@/platform/fs.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), writeJson: M.writeJson,
}));
vi.mock('@/platform/media.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), getMediaBlob: M.getDiskBlob,
}));
vi.mock('@/entities/snapshot-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), verifySnapshotForExport: M.verifySnapshot,
}));
vi.mock('@/entities/script-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), readScript: M.readScript,
}));
vi.mock('@/entities/slot-containers.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readStoryboardContainer: M.readStoryboard,
  readWorkbenchContainer: M.readWorkbench,
  ensureProjectMounts: M.ensureProjectMounts,
}));
vi.mock('@/entities/canvas-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listCanvases: M.listCanvases,
  createCanvas: M.createCanvas,
}));
vi.mock('@/entities/cas-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), putCas: M.putCas,
}));
vi.mock('@/features/asset-picker/asset-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAssets: M.listAssets,
  addAssets: M.addAssets,
}));
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listProjects: M.listProjects,
  loadProjectGraph: M.loadProjectGraph,
  getImageBlob: M.getImageBlob,
  getMediaBlob: M.getMediaBlob,
  saveProjectGraph: M.saveProjectGraph,
  setImageBlob: M.setImageBlob,
  setMediaBlob: M.setMediaBlob,
  importProjects: M.importProjects,
}));

import { readZip } from './zip.js';
import { exportProjects } from './export-projects.js';
import { importProjectsFromZip } from './import-projects.js';

/** jsdom 的 Blob 没有 arrayBuffer/text；用 FileReader 补齐，保证真实 fflate round-trip 可跑 */
function polyfillBlobMethods(): void {
  const proto = Blob.prototype as unknown as Record<string, unknown>;
  if (typeof proto.arrayBuffer !== 'function') {
    proto.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof proto.text !== 'function') {
    proto.text = function (this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
}
polyfillBlobMethods();

const SCRIPT = {
  schemaVersion: 1, version: 2, title: '迁移测试剧', activeEpisodeId: 'ep1',
  episodes: [{ id: 'ep1', number: 1, title: '第一集', status: 'active', content: '<p class="script-scene-heading">INT. 客厅 - 日</p><p class="script-action">他走进来。</p>' }],
  meta: { logline: '测试' }, sourceInfo: { origin: 'created', createdBy: 'editor-page' },
  updatedAt: '2026-11-11T00:00:00.000Z',
};
const STORYBOARD = {
  schemaVersion: 1, version: 1, title: '主体库', shots: [],
  entities: [{ id: 'item-1', name: '阿青', kind: '角色' }],
  subjectTree: [{
    rootId: 'root-1', itemId: 'item-1', name: '阿青', kind: '角色',
    states: [{ id: '__base__', state: '基础形态', fullPrompt: '绿发少女', media: [{ key: 'cas:aaa.png', type: 'image' }] }],
  }],
  updatedAt: '2026-11-11T00:00:00.000Z',
};
const WORKBENCH = { schemaVersion: 1, version: 1, title: '导演台', shots: [], tracks: [], updatedAt: 'x' };
const ASSETS = [{ id: 'a1', title: '产出视频', kind: 'video', projectId: 'p1', scope: 'project', createdAt: 'x', bytes: 10, data: { kind: 'video', storageKey: 'cas:aaa.png' } }];

let capturedBlob: Blob | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  M.listProjects.mockResolvedValue([{ id: 'p1', title: '迁移测试', nodeCount: 0 }]);
  M.loadProjectGraph.mockResolvedValue({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, metadata: {} });
  M.readScript.mockResolvedValue(SCRIPT);
  M.readStoryboard.mockResolvedValue(STORYBOARD);
  M.readWorkbench.mockResolvedValue(WORKBENCH);
  M.listAssets.mockResolvedValue(ASSETS);
  M.getDiskBlob.mockImplementation(async (key: string) => key === 'cas:aaa.png' ? new Blob(['cas-bytes'], { type: 'image/png' }) : null);
  M.putCas.mockResolvedValue({ storageKey: 'cas:aaa.png' });
  M.ensureProjectMounts.mockResolvedValue({});
  M.importProjects.mockImplementation(async (metas: Array<{ id: string }>) => metas.map((m) => ({ ...m, id: `${m.id}-new` })));
  M.addAssets.mockResolvedValue([]);

  // 捕获 exportProjects 触发下载的 ZIP blob
  capturedBlob = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
    if (obj instanceof Blob) capturedBlob = obj;
    return 'blob:export-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

async function exportOnce(): Promise<Blob> {
  await exportProjects(['p1'], 'roundtrip');
  expect(capturedBlob).toBeTruthy();
  return capturedBlob!;
}

describe('导出 ZIP 内容', () => {
  it('含剧本 MD/JSON、主体 MD/JSON、导演台、资产记录、CAS 二进制，manifest 为 v2', async () => {
    const zip = await readZip(await exportOnce());
    const names = [...zip.keys()];
    expect(names).toContain('projects.json');
    expect(names).toContain('script/p1/script.json');
    expect(names).toContain('script/p1/EP01_第一集.md');
    expect(names).toContain('subjects/p1/subjects.json');
    expect(names).toContain('subjects/p1/01_阿青.md');
    expect(names).toContain('entities/p1/workbench.json');
    expect(names).toContain('assets/p1/assets.json');
    expect(names.some((n) => n.startsWith('files/p1/') && n.includes('cas_aaa'))).toBe(true);

    const manifest = JSON.parse(await zip.get('projects.json')!.text());
    expect(manifest.version).toBe(2);
    expect(manifest.projects[0].documents.scriptMarkdown).toHaveLength(1);
    expect(manifest.projects[0].documents.subjectsMarkdown).toHaveLength(1);
    expect(manifest.projects[0].files.some((f: { storageKey: string }) => f.storageKey === 'cas:aaa.png')).toBe(true);
    expect(await zip.get('script/p1/EP01_第一集.md')!.text()).toContain('### INT. 客厅 - 日');
    expect(await zip.get('subjects/p1/01_阿青.md')!.text()).toContain('绿发少女');
  });
});

describe('导入还原', () => {
  it('剧本/主体/导演台写进新项目目录，资产 projectId 重映射，CAS 按内容写回', async () => {
    const zipBlob = await exportOnce();
    await importProjectsFromZip(zipBlob);

    const paths = M.writeJson.mock.calls.map((c) => c[0] as string);
    expect(paths).toContain('projects/p1-new/entities/script.json');
    expect(paths).toContain('projects/p1-new/entities/storyboard.json');
    expect(paths).toContain('projects/p1-new/entities/workbench.json');

    const storyboardArg = M.writeJson.mock.calls.find((c) => (c[0] as string).endsWith('storyboard.json'))?.[1] as typeof STORYBOARD;
    // cas: 是内容寻址，不能被 nanoid 改成死链
    expect(storyboardArg.subjectTree[0]!.states[0]!.media[0]!.key).toBe('cas:aaa.png');

    expect(M.addAssets).toHaveBeenCalledTimes(1);
    const importedAssets = M.addAssets.mock.calls[0]![0] as Array<{ projectId: string }>;
    expect(importedAssets[0]!.projectId).toBe('p1-new');
    expect(M.putCas).toHaveBeenCalled();
    expect(M.ensureProjectMounts).toHaveBeenCalledWith('p1-new');
  });
});
