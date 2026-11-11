/** S-22 结构回归：资产选择态按钮位置、双复制路径收敛 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8');

describe('孤立媒体即时清理（2026-11-11：回收站下线）', () => {
  it('app 启动每日清理，不存在回收站弹窗/入口', () => {
    const app = read('src/app.tsx');
    expect(app).toContain('purgeOrphanMedia');
    expect(app).not.toContain('media-recycle-bin');
    const menu = read('src/features/top-bar/components/canvas-menu.tsx');
    expect(menu).not.toContain('recycleBin');
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
