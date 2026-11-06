/**
 * useEditorCollab —— 本地版停用实现（Plan#83：无后端 / 无 Y.Doc / 无多人协作）
 *
 * 保留原返回形状，让上层装配在 Phase 3 物理清理前仍可编译；
 * 所有协作字段恒为「未激活」，awarenessStates 恒为空表 → 远端光标层自然不渲染。
 */
import { useRef } from 'react';
import type { CanvasSyncResult } from '@/shared/hooks/use-doc-sync.js';

/** 本地版停用协作对象（调用点在 Phase 3 一并删除，这里只做类型兼容） */
export type CollaborationLocal = Record<string, any>;

export function useEditorCollab(
  _canvasId: string,
  canvasSync: CanvasSyncResult,
): {
  collaboration: CollaborationLocal;
  awarenessStates: Map<number, unknown>;
  collaborationActive: boolean;
  collaborationRef: React.MutableRefObject<CollaborationLocal>;
  canvasSyncStatusRef: React.MutableRefObject<string>;
} {
  // 连接状态引用仍需保留：存盘/离线提示读它（本地版由 platform/fs 的授权状态替代，Phase 3 收敛）
  const canvasSyncStatusRef = useRef<string>(canvasSync.status);
  canvasSyncStatusRef.current = canvasSync.status;

  const collaborationRef = useRef<CollaborationLocal>({ active: false, awarenessStates: new Map(), roomId: null, members: [] });

  return {
    collaboration: collaborationRef.current,
    awarenessStates: new Map<number, unknown>(),
    collaborationActive: false,
    collaborationRef,
    canvasSyncStatusRef,
  };
}
