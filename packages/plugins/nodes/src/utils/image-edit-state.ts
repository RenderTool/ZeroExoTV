/**
 * image-edit-state - 图片节点「节点内编辑」的运行时状态（2026-11-06 用户纠偏）
 *
 * 编辑发生在**节点卡片内部**：节点临时放大，图片区直接变成裁剪框 / 切分网格 / 蒙版画布，
 * 不弹居中窗口、也不额外浮一层面板。
 *
 * 状态是纯运行时（不进 graph、不落盘）：刷新即退出编辑；节点视图通过
 * `useImageNodeEditMode(nodeId)` 订阅，应用层用 `openImageNodeEdit/closeImageNodeEdit` 控制。
 */

import { useSyncExternalStore } from 'react';

export type ImageEditMode = 'crop' | 'split' | 'maskEdit';

interface ImageEditState {
  nodeId: string;
  mode: ImageEditMode;
}

let state: ImageEditState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

/** 进入某张图片节点的节点内编辑 */
export function openImageNodeEdit(nodeId: string, mode: ImageEditMode): void {
  state = { nodeId, mode };
  emit();
}

/** 退出编辑；传 nodeId 时只关闭该节点（避免误关别的节点） */
export function closeImageNodeEdit(nodeId?: string): void {
  if (!state) return;
  if (nodeId && state.nodeId !== nodeId) return;
  state = null;
  emit();
}

/** 当前是否处于编辑态（非 React 场景用，如事件回调） */
export function getImageNodeEdit(): ImageEditState | null {
  return state;
}

/** 某节点当前编辑模式（订阅） */
export function useImageNodeEditMode(nodeId: string): ImageEditMode | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => (state && state.nodeId === nodeId ? state.mode : null),
  );
}
