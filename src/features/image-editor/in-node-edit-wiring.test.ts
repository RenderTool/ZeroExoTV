/**
 * 图片编辑「节点内编辑」接线守卫（2026-11-06 用户定稿）
 *
 * 验收四条：
 * 1) 裁剪/分割/局部遮罩不再弹居中窗口：宿主把这三个入口交给节点内编辑（锚点=节点屏幕矩形）；
 * 2) 居中渲染器不再保留这三个 case —— 不允许「节点内 + 弹窗」两条路径并存；
 * 3) 编辑器内容体只有一份：三个对话框都支持 inline，节点内编辑直接复用；
 * 4) 落图（子节点 + 连线）只有一份实现：image-edit-actions。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('图片编辑改为节点内编辑', () => {
  it('编辑入口路由到节点内编辑，锚点取节点屏幕矩形', () => {
    const host = read('src/pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain("type === 'crop' || type === 'split' || type === 'maskEdit'");
    expect(host).toContain('setImageNodeEdit({');
    // 视口变换：世界坐标 → 屏幕坐标（容器偏移 + 平移 + 缩放）
    expect(host).toContain('node.position.x * vp.k + vp.x');
    expect(host).toContain('size.width * vp.k');
    // 页面真实挂载节点内编辑面板
    const page = read('src/pages/editor/editor-canvas/editor-page.tsx');
    expect(page).toContain('<NodeImageEditor');
    expect(page).toContain('dialogs.imageNodeEdit');
  });

  it('居中渲染器不再保留编辑类 case（不允许两条路径并存）', () => {
    const renderer = read('src/features/image-editor/image-dialog-renderer.tsx');
    expect(renderer).not.toContain("case 'crop'");
    expect(renderer).not.toContain("case 'split'");
    expect(renderer).not.toContain("case 'maskEdit'");
    // 只读/参数型浮层仍保留
    expect(renderer).toContain("case 'view'");
    expect(renderer).toContain("case 'info'");
  });

  it('编辑器内容体只有一份：三个对话框支持 inline 复用', () => {
    for (const file of ['crop-dialog', 'split-dialog', 'mask-edit-dialog']) {
      const src = read(`packages/plugins/image-editor/src/dialogs/${file}.tsx`);
      expect(src).toContain('inline?: boolean');
      expect(src).toContain('if (inline)');
    }
    const node = read('src/features/image-editor/node-image-editor.tsx');
    expect(node).toContain('inline');
    expect(node).toContain('<CropDialog');
    expect(node).toContain('<SplitDialog');
    expect(node).toContain('<MaskEditDialog');
  });

  it('落图只有一份实现：裁剪/分割写回 image-edit-actions', () => {
    const actions = read('src/features/image-editor/image-edit-actions.ts');
    expect(actions).toContain('export async function applyCrop');
    expect(actions).toContain('export async function applySplit');
    expect(actions).toContain('new AddNodeCommand');
    expect(actions).toContain('new AddEdgeCommand');
    const renderer = read('src/features/image-editor/image-dialog-renderer.tsx');
    expect(renderer).not.toContain('AddNodeCommand');
  });
});
