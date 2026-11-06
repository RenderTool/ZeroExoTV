/**
 * 图片编辑「节点内编辑」接线守卫（2026-11-06 用户纠偏后重写）
 *
 * 要求：裁剪 / 分割 / 局部遮罩**在图片节点卡片内部**完成 —— 节点临时放大、图片区直接变成编辑器，
 * 不弹居中窗口、也不额外浮一层面板（旧的 NodeImageEditor 覆盖层已删除）。
 *
 * 验收五条：
 * 1) 宿主把三个入口交给 `openImageNodeEdit`，不再走浮层 state；
 * 2) 节点视图订阅编辑态，并内联渲染三个编辑器（inline 模式）；
 * 3) 进入/退出编辑用 `ResizeNodeCommand` 放大/还原节点（可撤销）；
 * 4) 确认后通过 `nodeActionBus` 冒泡给宿主，落图仍只有 image-edit-actions 一份实现；
 * 5) 覆盖层组件已删除，不允许两种实现并存。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const exists = (rel: string): boolean => existsSync(resolve(process.cwd(), rel));

describe('图片编辑在节点卡片内部', () => {
  it('宿主路由到节点内编辑（不再走浮层 state）', () => {
    const host = read('src/pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain("type === 'crop' || type === 'split' || type === 'maskEdit'");
    expect(host).toContain('openImageNodeEdit(node.id, type)');
    expect(host).not.toContain('setImageNodeEdit');
    // 产物落图仍只有一份实现
    expect(host).toContain("nodeActionBus.on('imageEditApply'");
    expect(host).toContain('applyCrop(');
    expect(host).toContain('applySplit(');
    expect(host).toContain('closeImageNodeEdit(');
  });

  it('节点视图内联渲染三个编辑器并负责放大/还原节点', () => {
    const view = read('packages/plugins/nodes/src/nodes/image-node-view.tsx');
    expect(view).toContain('useImageNodeEditMode');
    expect(view).toContain('<CropDialog');
    expect(view).toContain('<SplitDialog');
    expect(view).toContain('<MaskEditDialog');
    expect(view).toContain('ResizeNodeCommand');
    // 编辑内容替换图片区（节点卡片内部），不是第二个浮层
    expect(view).toContain('editContent ??');
    // 确认后冒泡给宿主
    expect(view).toContain("nodeActionBus.emit('imageEditApply'");
    // Esc 退出
    expect(view).toContain("e.key === 'Escape'");
  });

  it('编辑器内容体只有一份：三个对话框都支持 inline', () => {
    for (const file of ['crop-dialog', 'split-dialog', 'mask-edit-dialog']) {
      const src = read(`packages/plugins/image-editor/src/dialogs/${file}.tsx`);
      expect(src).toContain('inline?: boolean');
      expect(src).toContain('if (inline)');
    }
  });

  it('覆盖层组件已删除（不允许两套实现并存）', () => {
    expect(exists('src/features/image-editor/node-image-editor.tsx')).toBe(false);
    const page = read('src/pages/editor/editor-canvas/editor-page.tsx');
    expect(page).not.toContain('NodeImageEditor');
    expect(page).not.toContain('imageNodeEdit');
  });

  it('居中渲染器不再保留编辑类 case（只留只读/参数型）', () => {
    const renderer = read('src/features/image-editor/image-dialog-renderer.tsx');
    expect(renderer).not.toContain("case 'crop'");
    expect(renderer).not.toContain("case 'split'");
    expect(renderer).not.toContain("case 'maskEdit'");
  });
});
