/**
 * generating-preview-store 画布文档作用域单测（2026-11-07）
 *
 * 画布副本与主画布复用节点 id：预览帧必须先按 `canvasDocId:nodeId` 定位，
 * 否则在副本里生成时预览会出现在主画布同 id 节点上。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGeneratingPreview,
  generatingPreviewKey,
  setGeneratingPreview,
  setGeneratingPreviewCanvas,
  useGeneratingPreviewStore,
} from './generating-preview-store.js';

function state(): { byNode: Record<string, string>; canvasDocId: string } {
  return useGeneratingPreviewStore.getState();
}

beforeEach(() => {
  setGeneratingPreviewCanvas('main');
});

describe('generating-preview-store 文档作用域', () => {
  it('同一 nodeId 在主画布/副本各存一份，互不覆盖', () => {
    setGeneratingPreviewCanvas('main');
    setGeneratingPreview('node-1', 'data:main-frame');
    setGeneratingPreviewCanvas('sc-copy');
    setGeneratingPreview('node-1', 'data:copy-frame');

    // 切文档时清空旧帧：只留副本那份
    expect(state().byNode[generatingPreviewKey('main', 'node-1')]).toBeUndefined();
    expect(state().byNode[generatingPreviewKey('sc-copy', 'node-1')]).toBe('data:copy-frame');
  });

  it('写入方可显式指定发起文档：切走后的预览帧不会落到新文档', () => {
    setGeneratingPreview('node-1', 'data:started-in-main', 'main');
    setGeneratingPreviewCanvas('sc-copy');
    // 生成回调仍带着发起时的 docId → 只写 main 键
    setGeneratingPreview('node-1', 'data:late-frame', 'main');
    expect(state().byNode[generatingPreviewKey('main', 'node-1')]).toBe('data:late-frame');
    expect(state().byNode[generatingPreviewKey('sc-copy', 'node-1')]).toBeUndefined();
  });

  it('clear 只清指定文档的键', () => {
    setGeneratingPreview('n1', 'a', 'main');
    setGeneratingPreview('n1', 'b', 'sc-copy');
    clearGeneratingPreview('n1', 'main');
    expect(state().byNode[generatingPreviewKey('main', 'n1')]).toBeUndefined();
    expect(state().byNode[generatingPreviewKey('sc-copy', 'n1')]).toBe('b');
  });
});
