/**
 * 图片编辑「独立页签」接线守卫（2026-11-06 用户定稿）
 *
 * 用户口径：像 Photoshop 一样用独立页签编辑该图 —— 页面自带工具栏（裁剪 / 分割 / 局部遮罩），
 * 输出后回到画布；节点本身永远不因编辑而改变尺寸或状态。
 *
 * 验收：
 * 1) 宿主把三个编辑入口都开成图片页签（key = image:<nodeId>，带初始工具）；
 * 2) 编辑器页签有工具栏与 inline 编辑器；确认后调用 image-edit-actions（单一落图实现）并关闭回画布；
 * 3) 节点视图不再内联编辑器（回退上一版"节点内编辑"），不允许两套实现；
 * 4) 只读/参数型浮层只保留 upscale / angle / view / info。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const exists = (rel: string): boolean => existsSync(resolve(process.cwd(), rel));

describe('图片编辑 = 独立页签（Photoshop 式）', () => {
  it('宿主把裁剪/分割/局部遮罩都开成图片页签', () => {
    const host = read('src/pages/editor/editor-canvas/use-editor-interactions.ts');
    // 胶囊只有一个「编辑」，编辑页签内部再选工具
    expect(host).toContain("type === 'edit' || type === 'crop' || type === 'split' || type === 'maskEdit'");
    expect(host).toContain("const mode = type === 'edit' ? 'crop' : type");
    expect(host).toContain('openImageTab({ nodeId: node.id, title: node.title, mode })');
    expect(host).not.toContain('openImageNodeEdit');
    expect(host).not.toContain('setImageNodeEdit');
  });

  it('胶囊只保留一个「编辑」入口', () => {
    const tools = read('packages/plugins/nodes/src/node-tools.tsx');
    expect(tools).toContain("id: 'edit'");
    expect(tools).not.toContain("id: 'maskEdit'");
    expect(tools).not.toContain("id: 'crop'");
    expect(tools).not.toContain("id: 'split'");
    expect(tools).toContain("openImageDialog?.(node, 'edit')");
  });

  it('抽屉图片资产也有「编辑」：建节点后开图片编辑页签', () => {
    const material = read('src/features/canvas-assets/groups/MaterialGroup.tsx');
    expect(material).toContain("nodeActionBus.emit('imageEditAsset'");
    expect(material).toContain('onEditImage');
    const card = read('src/features/asset-library/cards/asset-card.tsx');
    expect(card).toContain('data-card-action="editImage"');
    const history = read('src/features/canvas-assets/groups/HistoryGroup.tsx');
    expect(history).toContain("nodeActionBus.emit('imageEditAsset'");
    expect(history).toContain('onEdit');
    const host = read('src/pages/editor/editor-canvas/use-editor-interactions.ts');
    expect(host).toContain("nodeActionBus.on('imageEditAsset'");
    // 资产来源：直接开页签，不预先把资产加成画布节点
    expect(host).toContain('useCanvasTabStore.getState().openImageTab({');
    expect(host).toContain('asset: {');
    expect(host).not.toContain('store.selectNodes([id], false)');
  });

  it('页签 store 支持图片页签（打开/关闭/激活校验）', () => {
    const store = read('src/features/canvas-tabs/canvas-tab-store.ts');
    expect(store).toContain('export interface OpenImageTab');
    expect(store).toContain("export const IMAGE_TAB_PREFIX = 'image:'");
    expect(store).toContain('openImageTab:');
    expect(store).toContain('closeImageTab:');
    expect(store).toContain('isImageTabKey(key)');
    expect(store).toContain('openImageTabs: [],');
  });

  it('页面自带工具栏 + inline 编辑器 + 落图走 image-edit-actions', () => {
    const ws = read('src/features/image-editor/image-edit-workspace.tsx');
    expect(ws).toContain('data-image-edit-tool');
    expect(ws).toContain('<CropDialog');
    expect(ws).toContain('<SplitDialog');
    expect(ws).toContain('<MaskEditDialog');
    expect(ws).toContain('applyCrop(');
    expect(ws).toContain('applySplit(');
    // 输出/关闭回画布
    expect(ws).toContain('onClose');
    const actions = read('src/features/image-editor/image-edit-actions.ts');
    expect(actions).toContain('export async function applyCrop');
    expect(actions).toContain('export async function applySplit');
  });

  it('editor-page 挂载编辑页签层，且不与剧本/导演台内容层叠加', () => {
    const page = read('src/pages/editor/editor-canvas/editor-page.tsx');
    expect(page).toContain('<ImageEditWorkspace');
    expect(page).toContain('editingImageTab');
    expect(page).toContain('source={editingImageSource}');
    expect(page).toContain('data-image-edit-host');
    expect(page).toContain('!isImageTabKey(activeTabKey)');
  });

  it('节点视图不再内联编辑器（旧实现彻底删除）', () => {
    const view = read('packages/plugins/nodes/src/nodes/image-node-view.tsx');
    expect(view).not.toContain('useImageNodeEditMode');
    expect(view).not.toContain('CropDialog');
    expect(view).not.toContain('MaskEditDialog');
    expect(exists('packages/plugins/nodes/src/utils/image-edit-state.ts')).toBe(false);
    expect(exists('src/features/image-editor/node-image-editor.tsx')).toBe(false);
  });

  it('编辑器为 Photoshop 式页面布局（画布舞台 + 右侧属性面板）', () => {
    const crop = read('packages/plugins/image-editor/src/dialogs/crop-dialog.tsx');
    expect(crop).toContain("inline ? 'calc(100vh - 230px)'");
    expect(crop).toContain("width: 280");
    const split = read('packages/plugins/image-editor/src/dialogs/split-dialog.tsx');
    expect(split).toContain("inline ? 'calc(100vh - 230px)'");
    const mask = read('packages/plugins/image-editor/src/dialogs/mask-edit-dialog.tsx');
    expect(mask).toContain("inline ? 'calc(100vh - 230px)'");
    // 笔刷反馈：系统光标隐藏 + 跟随指针的大小圆环（随缩放/笔刷大小变化）
    expect(mask).toContain('data-brush-cursor');
    expect(mask).toContain("cursor: 'none'");
    expect(mask).toContain('brushSize * brushCursor.scale');
  });

  it('居中渲染器只保留只读/参数型 case', () => {
    const renderer = read('src/features/image-editor/image-dialog-renderer.tsx');
    for (const gone of ["case 'crop'", "case 'split'", "case 'maskEdit'"]) {
      expect(renderer).not.toContain(gone);
    }
    for (const kept of ["case 'upscale'", "case 'angle'", "case 'view'", "case 'info'"]) {
      expect(renderer).toContain(kept);
    }
  });
});
