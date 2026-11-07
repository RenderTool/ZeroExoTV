/**
 * use-editor-interactions 类型定义拆分
 *
 * 导出 types 供各子模块使用，避免循环依赖。
 */

import type { EditorRefs } from '../use-editor-state.js';
import type { NodeRecord, NodeTypeExtension, ToolDefinition, ToolContext } from '@zeroexo/core';
import type { GenerationMode } from '@/features/tools-dock/node-generate-dock';
import type { AiConfig } from '@/features/ai-config/use-ai-config-store.js';
import type { CanvasConfig } from '@/features/top-bar/index.js';
import type { StoryboardNodeData } from '@/features/canvas-nodes/storyboard/storyboard-types.js';
import type { Asset } from '@/features/asset-picker/index.js';

import type { ContextMenuItem } from '@zeroexo/plugin-render-react';

export interface UseEditorInteractionsParams {
  refs: EditorRefs;
  state: {
    editor: any;
    extensions: Map<string, NodeTypeExtension>;
    selectedNodeId: string | null;
    selectedNodeType: string | null;
    selectedNodeData: Record<string, unknown> | null;
    selectedCount: number;
    selectedHasGroup: boolean;
    isMixedSelection: boolean;
    isGroupPreviewing: boolean;
    containerSize: { width: number; height: number };
    interactionMode: string;
    contextMenuItems?: ContextMenuItem[] | null;
  };
  actions: { deleteSelected: () => void };
  t: (key: string, opts?: any) => string;
  aiConfig: AiConfig;
  addAssetToStore: (input: any) => Promise<Asset | null>;
  canvasConfig: CanvasConfig;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setRenamingNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setNodeCreateMenuPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  nodeCreateMenuPos: { x: number; y: number } | null;
  setContextMenuItems: React.Dispatch<React.SetStateAction<ContextMenuItem[] | null | undefined>>;
  setConnectionDrop: React.Dispatch<React.SetStateAction<any>>;
  setDetailNode: React.Dispatch<React.SetStateAction<NodeRecord | null>>;
  setAssetPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReplaceNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  replaceNodeId: string | null;
  setReplaceAccept: React.Dispatch<React.SetStateAction<string>>;
  replaceInputRef: React.RefObject<HTMLInputElement | null>;
  setGroupStyleDialog: React.Dispatch<React.SetStateAction<any>>;
  onRenameGroup: (groupId: string) => void;
  getGroupTools: (node: NodeRecord, ctx: ToolContext) => ToolDefinition[];
  message: {
    info: (msg: string) => void;
    warning: (msg: string) => void;
    success: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface NodeAbortControllers {
  get: (nodeId: string) => any;
  set: (nodeId: string, ctl: any) => void;
  delete: (nodeId: string) => void;
}

/**
 * 各拆分 hook 的**实际依赖面**（收窄 Pick）。
 *
 * 铁律：子 hook 的参数类型必须用它真实解构的字段收窄声明，调用方**禁止 `as any` 兜底**。
 * 起因：useNodeActionHooks 需要 addAssetToStore/setAssetPickerOpen/message，但调用方漏传且
 * 用 `as any` 抹掉类型检查 → 右键「保存到素材库」运行时抛 `addAssetToStore is not a function`。
 * 收窄后少传任一字段直接编译报错，同类回归无法再溜进来。
 */
export type NodeActionHookParams = Pick<
  UseEditorInteractionsParams,
  | 'refs'
  | 'state'
  | 'containerRef'
  | 'nodeCreateMenuPos'
  | 'setNodeCreateMenuPos'
  | 'setContextMenuItems'
  | 't'
  | 'getGroupTools'
  | 'addAssetToStore'
  | 'setAssetPickerOpen'
  | 'message'
> & {
  /**
   * 把选区另存为项目内画布副本（父级唯一执行器）。
   * 右键多选入口与组磁贴/多选聚合共用同一执行器，禁止第二份实现。
   */
  onCreateCanvasCopy: (ids?: string[]) => void;
};

export type CanvasCommandHookParams = Pick<
  UseEditorInteractionsParams,
  'refs' | 'state' | 'containerRef' | 'replaceNodeId' | 'setReplaceNodeId' | 't' | 'message'
>;

export type AgentBridgeHookParams = Pick<
  UseEditorInteractionsParams,
  'refs' | 'aiConfig' | 'addAssetToStore' | 'setAssetPickerOpen' | 't'
>;

export type StoryboardHookParams = Pick<UseEditorInteractionsParams, 'refs' | 't' | 'message'>;

export type { NodeRecord, EditorRefs, GenerationMode, StoryboardNodeData };
