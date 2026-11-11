/** 复制项目必须连实体三件套 / 副本画布 / 剧本资产 / 本项目资产一起复制（S-22） */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => ({
  readJson: vi.fn(),
  writeJson: vi.fn(),
  listCanvases: vi.fn(),
  getCanvas: vi.fn(),
  createCanvas: vi.fn(),
  copyCanvasScript: vi.fn(),
  duplicateProjectAssets: vi.fn(),
}));

vi.mock('@/platform/fs.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readJson: M.readJson,
  writeJson: M.writeJson,
}));
vi.mock('@/entities/canvas-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listCanvases: M.listCanvases,
  getCanvas: M.getCanvas,
  createCanvas: M.createCanvas,
}));
vi.mock('@/services/canvas-script.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyCanvasScript: M.copyCanvasScript,
}));
vi.mock('@/features/asset-picker/asset-store.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  duplicateProjectAssets: M.duplicateProjectAssets,
}));

import { cloneProjectData } from './clone-project-data.js';

beforeEach(() => {
  vi.clearAllMocks();
  M.readJson.mockImplementation(async (path: string) => path.endsWith('workbench.json') ? null : { title: '源数据' });
  M.writeJson.mockResolvedValue(undefined);
  M.listCanvases.mockResolvedValue([{ id: 'main' }, { id: 'copy-1' }]);
  M.getCanvas.mockResolvedValue({ doc: { id: 'copy-1', title: '分镜画布', graphRef: 'inline', graph: { nodes: [], edges: [] }, coverKey: null, order: 1 } });
  M.createCanvas.mockResolvedValue(undefined);
  M.copyCanvasScript.mockResolvedValue(null);
  M.duplicateProjectAssets.mockResolvedValue(2);
});

describe('cloneProjectData', () => {
  it('实体三件套写到新项目目录，缺文件的实体跳过', async () => {
    await cloneProjectData('src-id', 'new-id', '副本');
    const paths = M.writeJson.mock.calls.map((c) => c[0] as string);
    expect(paths).toEqual([
      'projects/new-id/entities/script.json',
      'projects/new-id/entities/storyboard.json',
    ]);
    expect(M.writeJson.mock.calls[0]![1]).toEqual({ title: '源数据' });
  });

  it('副本画布（跳过 1 号主画布）、剧本资产、本项目资产记录一并复制', async () => {
    await cloneProjectData('src-id', 'new-id', '副本');
    expect(M.getCanvas).toHaveBeenCalledTimes(1);
    expect(M.getCanvas).toHaveBeenCalledWith('src-id', 'copy-1');
    expect(M.createCanvas).toHaveBeenCalledWith('new-id', expect.objectContaining({ id: 'copy-1', title: '分镜画布' }));
    expect(M.copyCanvasScript).toHaveBeenCalledWith('src-id', 'new-id', '副本 剧本');
    expect(M.duplicateProjectAssets).toHaveBeenCalledWith('src-id', 'new-id');
  });

  it('同一 id / 空 id 时不复制，避免把源项目覆盖掉', async () => {
    await cloneProjectData('same', 'same', 'x');
    await cloneProjectData('', 'new-id', 'x');
    expect(M.writeJson).not.toHaveBeenCalled();
    expect(M.createCanvas).not.toHaveBeenCalled();
  });

  it('单项失败不阻断其余复制', async () => {
    M.readJson.mockRejectedValueOnce(new Error('读盘失败'));
    await cloneProjectData('src-id', 'new-id', '副本');
    expect(M.copyCanvasScript).toHaveBeenCalled();
    expect(M.duplicateProjectAssets).toHaveBeenCalled();
    expect(M.createCanvas).toHaveBeenCalled();
  });
});
