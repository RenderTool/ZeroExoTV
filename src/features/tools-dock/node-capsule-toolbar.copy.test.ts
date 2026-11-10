/**
 * 胶囊工具栏「另存画布」必须是纯图标（2026-11-07 用户纠正）：
 * 胶囊所有工具都只有 icon，语义在 title/aria-label；按钮里加「另存画布」文字属于破坏规范。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/features/tools-dock/node-capsule-toolbar.tsx', 'utf8');

describe('节点胶囊：另存画布入口', () => {
  it('按钮只有图标，不渲染可见文字；title 保留语义', () => {
    const start = src.indexOf('data-capsule-action="canvas-copy"');
    const end = src.indexOf('</button>', start);
    const block = src.slice(start, end);
    expect(block).toContain('<PictureInPicture2 size={16} />');
    expect(block).not.toContain("<span>{t('canvasCopy.createShort'");
    expect(block).toContain("title={t('canvasCopy.createShort', '另存为画布')}");
  });

  it('固定在导航按钮左侧（导航始终最右），不再夹在排列/对齐中间', () => {
    expect(src.indexOf('data-capsule-action="canvas-copy"')).toBeLessThan(src.indexOf('<Compass size={16} />'));
  });
});
