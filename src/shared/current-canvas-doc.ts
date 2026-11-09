/**
 * current-canvas-doc —— 当前编辑器装载的**画布文档** id（单一来源）
 *
 * 为什么需要：画布副本与主画布复用同一批节点 id（复制画布时不换 id），
 * 任何按 `nodeId` 做全局键的状态（本机生成任务、生成中预览帧、运行续接记录）
 * 在切换文档/刷新后都会串台。这里提供文档级作用域，键统一用 `docId:nodeId`。
 *
 * 与 `current-canvas-id` 的区别：那个是**项目 id**（产物归属/历史分组用），
 * 本项目内所有画布副本共享；本模块是**画布文档 id**（main / sc…），切文档时变。
 *
 * 写入点只有 `use-canvas-document-switch`（同一编辑器换文档的唯一入口）；
 * 页面离开时复位为 main，避免残留值把下一次进入的写入带到旧文档。
 */

/** 主画布文档 id（与 entities/canvas-store 的 MAIN_CANVAS_ID 同值；此处不 import 以免插件包循环依赖） */
export const MAIN_CANVAS_DOC_ID = 'main';

let currentCanvasDocId: string = MAIN_CANVAS_DOC_ID;

export function setCurrentCanvasDocId(id: string | null | undefined): void {
  currentCanvasDocId = id || MAIN_CANVAS_DOC_ID;
}

export function getCurrentCanvasDocId(): string {
  return currentCanvasDocId;
}

/**
 * 文档作用域键：`docId:nodeId`。
 * docId 缺省取当前文档（生成链路调用时已捕获开始时的文档 id，不要依赖调用时值）。
 */
export function canvasDocNodeKey(nodeId: string, docId: string = getCurrentCanvasDocId()): string {
  return `${docId}:${nodeId}`;
}
