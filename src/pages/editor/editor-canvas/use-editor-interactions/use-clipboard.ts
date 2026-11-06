/**
 * use-clipboard - 剪贴板操作
 *
 * 提取: 复制/粘贴等剪贴板相关功能
 * 从 use-editor-interactions.ts 按功能域拆分
 */

import { useCallback } from 'react';
import type { UseEditorInteractionsParams } from './types.js';

/**
 * 剪贴板操作 hooks
 */
export function useClipboardHooks(params: UseEditorInteractionsParams) {
  const { refs, state } = params;

  /** 复制节点内容到剪贴板 */
  const handleCopyToClipboard = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fallback: 兼容旧浏览器
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      }
    },
    [],
  );

  /** 获取选中节点的文本内容 (用于复制) */
  const getSelectedNodeText = useCallback((): string | null => {
    if (!state.selectedNodeId || !refs.store) return null;
    const graph = refs.store.getGraph();
    const node = graph.nodes.find((n: any) => n.id === state.selectedNodeId);
    if (!node) return null;
    const data = (node.data ?? {}) as Record<string, unknown>;
    return (data.content as string) || (data.text as string) || (data.prompt as string) || null;
  }, [state.selectedNodeId, refs.store]);

  return {
    handleCopyToClipboard,
    getSelectedNodeText,
  };
}