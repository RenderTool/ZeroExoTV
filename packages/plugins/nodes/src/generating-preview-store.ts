/**
 * generating-preview-store —— 画布节点「生成中实时预览帧」的临时态（不进撤销栈、不落盘）。
 *
 * 为什么放插件包：视频/图片节点视图在 @zeroexo/plugin-nodes 里渲染，app 侧生成链路
 * 只负责按帧写入；两者共用同一 zustand store，避免把预览图塞进 node.data 触发历史记录。
 *
 * 2026-11-07 文档作用域：画布副本与主画布复用节点 id，预览键必须是 `canvasDocId:nodeId`，
 * 否则在副本里生成时预览帧会显示到主画布同 id 节点上。app 在切画布文档时调用
 * `setGeneratingPreviewCanvas` 更新当前文档并清空旧帧；写入方可显式传 docId（生成开始时捕获）。
 */
import { create } from 'zustand';

/** 主画布文档 id（与 app 侧 MAIN_CANVAS_DOC_ID 同值；插件包不反向 import src） */
export const DEFAULT_CANVAS_DOC_ID = 'main';

/** 采样进度（由 /ws 的 preview/progress 事件写入，不进 node.data） */
export interface GeneratingProgress {
  step: number | null;
  totalSteps: number | null;
  phaseLabel?: string;
  overallValue?: number;
  overallMax?: number;
}

interface GeneratingPreviewState {
  /** key = `${canvasDocId}:${nodeId}` */
  byNode: Record<string, string>;
  /** 同键的采样进度 */
  progressByNode: Record<string, GeneratingProgress>;
  /** 当前编辑器装载的画布文档 id（main / sc…） */
  canvasDocId: string;
}

/** 预览键（node 视图与 app 写入共用同一拼法） */
export function generatingPreviewKey(canvasDocId: string, nodeId: string): string {
  return `${canvasDocId}:${nodeId}`;
}

export const useGeneratingPreviewStore = create<GeneratingPreviewState>(() => ({
  byNode: {},
  progressByNode: {},
  canvasDocId: DEFAULT_CANVAS_DOC_ID,
}));

/** 切换画布文档：更新当前文档并清空旧文档的预览帧（不跨文档复显） */
export function setGeneratingPreviewCanvas(canvasDocId: string): void {
  useGeneratingPreviewStore.setState((s) => {
    if (s.canvasDocId === canvasDocId && Object.keys(s.byNode).length === 0
      && Object.keys(s.progressByNode).length === 0) return s;
    return { byNode: {}, progressByNode: {}, canvasDocId: canvasDocId || DEFAULT_CANVAS_DOC_ID };
  });
}

export function setGeneratingPreview(nodeId: string, image: string, canvasDocId?: string): void {
  useGeneratingPreviewStore.setState((s) => {
    const key = generatingPreviewKey(canvasDocId ?? s.canvasDocId, nodeId);
    return { byNode: { ...s.byNode, [key]: image } };
  });
}

export function clearGeneratingPreview(nodeId: string, canvasDocId?: string): void {
  useGeneratingPreviewStore.setState((s) => {
    const key = generatingPreviewKey(canvasDocId ?? s.canvasDocId, nodeId);
    if (!(key in s.byNode)) return s;
    const next = { ...s.byNode };
    delete next[key];
    return { byNode: next };
  });
}

/** 写入采样进度（值未变时不触发重渲染） */
export function setGeneratingProgress(nodeId: string, patch: Partial<GeneratingProgress>, canvasDocId?: string): void {
  useGeneratingPreviewStore.setState((s) => {
    const key = generatingPreviewKey(canvasDocId ?? s.canvasDocId, nodeId);
    const prev = s.progressByNode[key];
    // 帧事件带 step、progress 事件带 phase/总进度，两者合并而不是互相覆盖
    const next: GeneratingProgress = { step: null, totalSteps: null, ...prev, ...patch };
    if (prev && prev.step === next.step && prev.totalSteps === next.totalSteps
      && prev.phaseLabel === next.phaseLabel && prev.overallValue === next.overallValue
      && prev.overallMax === next.overallMax) return s;
    return { progressByNode: { ...s.progressByNode, [key]: next } };
  });
}

export function clearGeneratingProgress(nodeId: string, canvasDocId?: string): void {
  useGeneratingPreviewStore.setState((s) => {
    const key = generatingPreviewKey(canvasDocId ?? s.canvasDocId, nodeId);
    if (!(key in s.progressByNode)) return s;
    const next = { ...s.progressByNode };
    delete next[key];
    return { progressByNode: next };
  });
}
