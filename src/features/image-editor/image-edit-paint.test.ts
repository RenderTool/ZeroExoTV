/**
 * 手动局部涂抹（2026-11-10 / 2026-11-12 用户要求）：
 * 局部编辑器要有「画笔 + 颜色（取色器/吸色）+ 缩放 + 保存到画布」，不是只有 AI 蒙版。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

describe('手动涂抹编辑器', () => {
  const dialog = read('packages/plugins/image-editor/src/dialogs/paint-dialog.tsx');

  it('有可涂抹画布、原生取色器与吸色器', () => {
    expect(dialog).toContain('data-paint-canvas');
    expect(dialog).toContain('type="color"');
    expect(dialog).toContain('data-paint-tool="picker"');
    expect(dialog).toContain('Pipette');
  });

  it('涂抹支持缩放（Ctrl/⌘+滚轮与按钮），便于精细涂抹', () => {
    expect(dialog).toContain('data-paint-zoom-in');
    expect(dialog).toContain('data-paint-zoom-reset');
    expect(dialog).toContain('Ctrl / ⌘ + 滚轮也可缩放');
    expect(dialog).toContain('zoom');
  });

  it('有笔刷大小、撤销、清空与保存到画布', () => {
    expect(dialog).toContain('Slider');
    expect(dialog).toContain('撤销');
    expect(dialog).toContain('清空');
    expect(dialog).toContain('保存到画布');
    expect(dialog).toContain("toBlob(resolve, 'image/png')");
  });

  it('工作区注册了「涂抹」工具，产物走 applyPaint 落成新节点', () => {
    const workspace = read('src/features/image-editor/image-edit-workspace.tsx');
    expect(workspace).toContain("id: 'paint'");
    expect(workspace).toContain('<PaintDialog');
    expect(workspace).toContain('applyPaint');
    const actions = read('src/features/image-editor/image-edit-actions.ts');
    expect(actions).toContain('export async function applyPaint');
  });
});
