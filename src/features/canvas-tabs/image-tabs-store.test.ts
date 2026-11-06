/**
 * 图片编辑页签 store 单测（2026-11-06 Photoshop 式独立页签）
 *
 * 覆盖：打开幂等（同 nodeId 只更新工具/标题）、只能激活已打开项、关闭当前项回画布、
 * 关闭非当前项不影响激活页、key 工具函数。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_TAB_KEY,
  imageAssetTabKeyFor,
  imageTabAssetId,
  imageTabKeyFor,
  imageTabNodeId,
  isImageTabKey,
  useCanvasTabStore,
} from './canvas-tab-store.js';

const reset = (): void => {
  useCanvasTabStore.setState({ activeTabKey: CANVAS_TAB_KEY, openImageTabs: [], openCanvasTabs: [] });
};

beforeEach(reset);

describe('图片编辑页签', () => {
  it('打开即激活，同一 nodeId 幂等（只更新工具与标题）', () => {
    const store = useCanvasTabStore.getState();
    store.openImageTab({ nodeId: 'n1', title: '图一', mode: 'crop' });
    expect(useCanvasTabStore.getState().activeTabKey).toBe(imageTabKeyFor('n1'));
    expect(useCanvasTabStore.getState().openImageTabs).toHaveLength(1);

    store.openImageTab({ nodeId: 'n1', title: '图一改名', mode: 'split' });
    const tabs = useCanvasTabStore.getState().openImageTabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.mode).toBe('split');
    expect(tabs[0]?.title).toBe('图一改名');
  });

  it('只能激活已打开的图片页签（关掉后不自动重开）', () => {
    const store = useCanvasTabStore.getState();
    store.openImageTab({ nodeId: 'n1', title: '图一' });
    store.activateTab(CANVAS_TAB_KEY);
    expect(useCanvasTabStore.getState().activeTabKey).toBe(CANVAS_TAB_KEY);

    // 已关掉（不在集合里）→ 激活无效
    store.activateTab(imageTabKeyFor('n2'));
    expect(useCanvasTabStore.getState().activeTabKey).toBe(CANVAS_TAB_KEY);

    // 打开集合里的项 → 正常激活
    store.activateTab(imageTabKeyFor('n1'));
    expect(useCanvasTabStore.getState().activeTabKey).toBe(imageTabKeyFor('n1'));
  });

  it('关闭当前图片页签回画布；关闭非当前项不影响激活页', () => {
    const store = useCanvasTabStore.getState();
    store.openImageTab({ nodeId: 'n1', title: '图一' });
    store.openImageTab({ nodeId: 'n2', title: '图二' });
    expect(useCanvasTabStore.getState().activeTabKey).toBe(imageTabKeyFor('n2'));

    store.closeImageTab(imageTabKeyFor('n1'));
    expect(useCanvasTabStore.getState().activeTabKey).toBe(imageTabKeyFor('n2'));

    store.closeImageTab(imageTabKeyFor('n2'));
    expect(useCanvasTabStore.getState().activeTabKey).toBe(CANVAS_TAB_KEY);
    expect(useCanvasTabStore.getState().openImageTabs).toHaveLength(0);
  });

  it('资产来源：key = image:asset:<id>，节点/资产解析互不串', () => {
    const store = useCanvasTabStore.getState();
    store.openImageTab({ asset: { assetId: 'a1', storageKey: 'k1' }, title: '素材图', mode: 'crop' });
    const key = imageAssetTabKeyFor('a1');
    expect(useCanvasTabStore.getState().activeTabKey).toBe(key);
    expect(imageTabNodeId(key)).toBeNull();
    expect(imageTabAssetId(key)).toBe('a1');
    expect(useCanvasTabStore.getState().openImageTabs[0]?.asset?.storageKey).toBe('k1');

    // 关闭回画布
    store.closeImageTab(key);
    expect(useCanvasTabStore.getState().activeTabKey).toBe(CANVAS_TAB_KEY);
  });

  it('key 工具函数口径一致', () => {
    expect(imageTabKeyFor('n1')).toBe('image:n1');
    expect(isImageTabKey('image:n1')).toBe(true);
    expect(isImageTabKey('canvas:sc1')).toBe(false);
    expect(imageTabNodeId('image:n1')).toBe('n1');
    expect(imageTabNodeId('canvas')).toBeNull();
    expect(imageTabAssetId('image:asset:a1')).toBe('a1');
    expect(imageTabAssetId('image:n1')).toBeNull();
  });
});
