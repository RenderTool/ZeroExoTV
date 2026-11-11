/** S-22 结构回归：回收站尺寸、资产选择态按钮位置、双复制路径收敛 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('回收站弹窗固定尺寸', () => {
  it('正文有高度上限与内置滚动，分页单页行数收敛', () => {
    const source = read('src/features/storage/media-recycle-bin-dialog.tsx');
    expect(source).toMatch(/maxHeight:\s*'min\(60vh, 520px\)'/);
    expect(source).toContain("overflowY: 'auto'");
    expect(source).toContain('pageSize: 10');
  });
});

describe('资产选择态与项目模式对齐', () => {
  it('批量按钮在页头工具栏，内容区批量条仅抽屉保留', () => {
    const page = read('src/features/asset-library/asset-library-page.tsx');
    const toolbar = read('src/features/asset-library/components/asset-library-toolbar.tsx');
    expect(page).toContain('batch={!props.embeddedInCanvas');
    expect(page).toContain('props.embeddedInCanvas && ctx.multiSelectEnabled');
    expect(toolbar).toContain('data-asset-batch-download');
    expect(toolbar).toContain('data-asset-batch-delete');
    expect(toolbar).toContain('data-asset-batch-select-all');
  });
});

describe('复制项目双路径收敛', () => {
  it('首页与编辑器都调用 cloneProjectData', () => {
    expect(read('src/pages/home/use-projects.ts')).toContain('cloneProjectData(');
    expect(read('src/pages/editor/editor-canvas/use-editor-dialogs.ts')).toContain('cloneProjectData(');
  });
});
