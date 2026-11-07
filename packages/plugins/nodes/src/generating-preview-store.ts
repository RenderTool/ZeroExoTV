/**
 * generating-preview-store —— 画布节点「生成中实时预览帧」的临时态（不进撤销栈、不落盘）。
 *
 * 为什么放插件包：视频/图片节点视图在 @zeroexo/plugin-nodes 里渲染，app 侧生成链路
 * 只负责按帧写入；两者共用同一 zustand store，避免把预览图塞进 node.data 触发历史记录。
 */
import { create } from 'zustand';

interface GeneratingPreviewState {
  byNode: Record<string, string>;
}

export const useGeneratingPreviewStore = create<GeneratingPreviewState>(() => ({ byNode: {} }));

export function setGeneratingPreview(nodeId: string, image: string): void {
  useGeneratingPreviewStore.setState((s) => ({ byNode: { ...s.byNode, [nodeId]: image } }));
}

export function clearGeneratingPreview(nodeId: string): void {
  useGeneratingPreviewStore.setState((s) => {
    if (!(nodeId in s.byNode)) return s;
    const next = { ...s.byNode };
    delete next[nodeId];
    return { byNode: next };
  });
}
