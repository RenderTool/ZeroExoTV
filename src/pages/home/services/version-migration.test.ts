/** 项目包版本迁移回归（C-05）：v1 旧包必须仍能导入 */
import { describe, expect, it } from 'vitest';
import { CURRENT_ZIP_VERSION, getSupportedVersions, migrateExportFile } from './version-migration.js';
import type { CanvasExportFile } from './export-types.js';

function v1Project(overrides: Record<string, unknown> = {}): CanvasExportFile {
  return {
    app: 'zeroexo-canvas',
    version: 1,
    exportedAt: '2026-11-10T00:00:00.000Z',
    projects: [{ meta: { id: 'p1', title: '旧项目' }, graph: null, files: [], ...overrides }],
  } as unknown as CanvasExportFile;
}

describe('migrateExportFile', () => {
  it('当前版本为 2，支持 v1 迁移', () => {
    expect(CURRENT_ZIP_VERSION).toBe(2);
    expect(getSupportedVersions()).toContain(1);
  });

  it('v1 → v2：补空文档清单，旧 meta/graph/files 原样保留', () => {
    const out = migrateExportFile(v1Project());
    expect(out.version).toBe(2);
    expect(out.projects[0]!.documents).toEqual({ scriptMarkdown: [], subjectsMarkdown: [] });
    expect((out.projects[0]!.meta as { title: string }).title).toBe('旧项目');
  });

  it('v1 缺 files 字段时兜底成空数组，不抛 TypeError', () => {
    const raw = v1Project();
    delete (raw.projects[0] as { files?: unknown }).files;
    expect(migrateExportFile(raw).projects[0]!.files).toEqual([]);
  });

  it('无 version 字段视为 v1 并迁移（修前 while 判 undefined 会直接跳过）', () => {
    const raw = v1Project() as unknown as Record<string, unknown>;
    delete raw.version;
    expect(migrateExportFile(raw as unknown as CanvasExportFile).version).toBe(2);
  });

  it('已是 v2 时原样返回，不重复补字段', () => {
    const current = {
      ...v1Project(),
      version: 2,
      projects: [{
        meta: { id: 'p1', title: '新项目' }, graph: null, files: [],
        documents: { scriptJson: 'script/p1/script.json', scriptMarkdown: [], subjectsMarkdown: [] },
      }],
    } as unknown as CanvasExportFile;
    expect(migrateExportFile(current)).toEqual(current);
  });
});
