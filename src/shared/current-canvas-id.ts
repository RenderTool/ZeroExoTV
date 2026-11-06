/**
 * current-canvas-id - 当前画布/项目 ID 模块级单一来源（Plan#69）
 *
 * 供绕过 ProxyProvider 直连 POST /api/ai/generate 的模块（出片工作台帧/视频生成等）
 * 读取当前 projectId，使产物归属画布 → 抽屉「画布资产」历史按项目可查。
 * 由 use-editor-state 在编辑器初始化/画布切换时注入，卸载时清空。
 */

let currentCanvasId: string | null = null;

export function setCurrentCanvasId(id: string | null): void {
  currentCanvasId = id;
}

export function getCurrentCanvasId(): string | null {
  return currentCanvasId;
}
