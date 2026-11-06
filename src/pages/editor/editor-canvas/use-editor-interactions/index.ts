/**
 * use-editor-interactions - 入口
 *
 * 聚合导出各子模块，兼容原 use-editor-interactions.ts 调用方。
 * 拆分目标：每个文件控制在 400 行以内，保持接口不变。
 */

// === 工具函数 ===
export {
  IMAGE_PROMPT_REVERSE_PRESET,
  NODE_INPUT_PIN,
  NODE_OUTPUT_PIN,
  isNodeDownloadable,
  triggerAnchorDownload,
  downloadNodeAsFile,
  storyboardColumnAnchor,
  contentToDataUrl,
  htmlToPlainText,
  computeNodesBounds,
} from './helpers.js';

// === AI 生成通用逻辑 ===
export {
  promptTitleSummary,
  buildTemplateParams,
  handleReplayGeneration,
  collectInputReferences,
  formatInputRefs,
} from './use-ai-generation.js';

// === 类型 ===
export type {
  UseEditorInteractionsParams,
  NodeAbortControllers,
} from './types.js';

// === 节点基本操作 ===
export { useNodeActionHooks } from './use-node-actions.js';

// === 画布命令/布局操作 ===
export { useCanvasCommandHooks } from './use-canvas-commands.js';

// === 分镜生成 ===
export { useStoryboardHooks } from './use-storyboard.js';

// === AI 生成/Agent 桥接 ===
export { useAgentBridgeHooks } from './use-agent-bridge.js';

// === 剪贴板 ===
export { useClipboardHooks } from './use-clipboard.js';