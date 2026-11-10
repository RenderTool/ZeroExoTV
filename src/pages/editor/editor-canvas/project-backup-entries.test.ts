/**
 * 项目备份入口（2026-11-10 用户要求）：任何页面都能导出/导入项目 zip。
 * - 主页项目卡：导出单个项目；工具栏：导入 zip
 * - 画布 LOGO 菜单：导出本项目（只读模式下也提供，导出是只读操作）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const read = (rel: string): string => readFileSync(path.resolve(root, rel), 'utf8');

describe('项目导出 / 导入入口', () => {
  it('画布 LOGO 菜单：有「导出项目」，只读不隐藏', () => {
    const src = read('src/features/top-bar/components/canvas-menu.tsx');
    expect(src).toContain("key: 'export'");
    expect(src).toContain("t('menu.exportProject'");
    // 导出项必须在 readOnly 分支之外（只读用户也要能备份）
    const readOnlyBlock = src.slice(src.indexOf('...(!readOnly'), src.indexOf("t('menu.copyProject')"));
    expect(readOnlyBlock).not.toContain("key: 'export'");
  });

  it('画布页导出当前项目：exportProjects([canvasId])', () => {
    const src = read('src/pages/editor/editor-canvas/editor-page.tsx');
    expect(src).toContain('exportProjects([canvasId]');
  });

  it('主页：项目卡导出 + 工具栏导入 zip', () => {
    const src = read('src/pages/home/canvas-page.tsx');
    expect(src).toContain("t('home.exportProject'");
    expect(src).toContain("t('home.importProject'");
    expect(src).toContain('importProjectsFromZip');
    expect(src).toContain('accept=".zip,application/zip"');
  });
});
