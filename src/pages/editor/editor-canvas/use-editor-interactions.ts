/**
 * useEditorInteractions - 画布编辑页交互回调逻辑
 *
 * 正在逐步拆分到 use-editor-interactions/ 目录。导入路径从该目录获取工具函数。
 */

import { useCallback, createElement, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { App } from 'antd';
import { EDITOR_ICONS } from './icons.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { AddNodeCommand, AddEdgeCommand, RemoveEdgeCommand, UpdateNodeDataCommand, BatchCommand, resolveNodeSize, resolvePlacement } from '@zeroexo/core';
import type { Command, NodeRecord, NodeTypeExtension, ToolContext, ToolDefinition } from '@zeroexo/core';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
// Plan#84（征集#184）：选区→**另存为项目内画布副本**（复制，主画布不动），与 1 号平级并排
import { createCanvasCopyFromSelection } from '@/features/sub-canvas/canvas-copy.js';
import { nodeActionBus, createAssetNode } from '@zeroexo/plugin-nodes';
import type { AssetNodePayload } from '@zeroexo/plugin-nodes';
import { PREVIEW_GROUP_ID, getGroupBoundsWithEmptyFallback } from '@zeroexo/plugin-group';
import { configToPinDefaults, configToNodeDefaults, configToGroupDefaults } from '@/features/top-bar/index.js';
import type { CanvasConfig } from '@/features/top-bar/index.js';
import type { GenerationMode } from '@/features/tools-dock/node-generate-dock';
import { requestNodeDockPrompt } from '@/features/tools-dock/node-generate-dock.js';
import type { AiConfig } from '@/features/ai-config/use-ai-config-store.js';
import type { EditorRefs } from './use-editor-state.js';
import type { ContextMenuItem } from '@/shared/components/index.js';
import type { ImageDialogState } from '@/features/image-editor/image-dialog-renderer.js';
import type { AgentTaskHandlers } from './agent-client-types.js';
// 本地版（Plan#83）：Agent 会话/任务调度不在前端；下列局部 stub 仅使模块可加载，调用即报错
const agentClient = {
  send: async (_task: string, _payload?: unknown, _ctx?: unknown): Promise<{ taskId: string }> => {
    throw new Error('本地版无内置 LLM 链路：分镜/剧本生成请走外部工具（MCP）');
  },
  cancelTask: async (_taskId: string): Promise<void> => {},
  subscribe: (_taskId: string, _handlers: AgentTaskHandlers): void => {},
  unsubscribe: (): void => {},
};
import { handleReplayGeneration } from './use-editor-interactions/use-ai-generation.js';
import { subscribeNavigateFocusNode } from './navigate-focus-receiver.js';
import { useNodeActionHooks } from './use-editor-interactions/use-node-actions.js';
import { useCanvasCommandHooks } from './use-editor-interactions/use-canvas-commands.js';
import { useStoryboardHooks } from './use-editor-interactions/use-storyboard.js';
import { useAgentBridgeHooks } from './use-editor-interactions/use-agent-bridge.js';
// use-agent-bridge 已重写为本地版（无 Agent 投递）
const collectAgentNodeSnapshots = (..._args: unknown[]): unknown[] => [];
const notifyAgentNodesDeleted = (..._args: unknown[]): void => {};
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { uploadTextResource } from '@zeroexo/plugin-persistence';
import { detectChapters } from '@/shared/utils/episode-marker-detector.js';
import { normalizeScriptText } from '@/shared/utils/script-count.js';
import type { ChapterAnchor } from '@/shared/utils/episode-marker-detector.js';
import { useUploadQueueStore } from '@/features/upload-queue/upload-queue-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { runNovelMigration } from './use-editor-interactions/use-novel-migration.js';
const useCanvasAgentStore = { getState: (): Record<string, any> => ({ setThinking: () => {}, setIsGenerating: () => {}, setDockOpen: () => {}, setDockTab: () => {}, clearAgentUnread: () => {}, setCurrentPlan: () => {}, setTodoSnapshot: () => {}, setCurrentTaskId: () => {}, setPhase: () => {}, addMessage: () => {} }) };
const appendThinkDelta = (..._args: unknown[]): void => {};
const ensureConversation = async (..._args: unknown[]): Promise<string> => '';
const getSessionProjectId = (): string | null => null;
import i18n from '@/i18n/config';
import {
  NODE_INPUT_PIN,
  NODE_OUTPUT_PIN,
  storyboardColumnAnchor,
} from './use-editor-interactions/helpers.js';
import type { StoryboardNodeData } from '@/features/canvas-nodes/storyboard/storyboard-types.js';

/** Plan#79 T5：标记模式择优的扫描上限（字符）——超出部分走长度块兜底，防主线程秒级卡顿 */
const NOVEL_MARKER_SCAN_LIMIT = 2_000_000;
/** Plan#79 T5：超大文尾部长度块大小 */
const NOVEL_TAIL_CHUNK = 10_000;

/** 统计换行数（行号换算用；indexOf 迭代避免生成临时数组） */
function countLineBreaks(text: string): number {
  let n = 0;
  let idx = text.indexOf('\n');
  while (idx !== -1) {
    n += 1;
    idx = text.indexOf('\n', idx + 1);
  }
  return n;
}

/** 按字符区间构造章节锚点（尾部长度块用；wordCount 为字符数近似，detector 的词规则偏差不影响导航） */
function buildRangeAnchor(content: string, start: number, end: number, number: number, title: string): ChapterAnchor {
  const startLine = countLineBreaks(content.slice(0, start)) + 1;
  return {
    number,
    title,
    startIndex: start,
    endIndex: end,
    startLine,
    endLine: startLine + countLineBreaks(content.slice(start, end)),
    wordCount: end - start,
  };
}

/**
 * Plan#79 T5：长文本章节索引构建（去卡顿）
 *
 * - ≤ NOVEL_MARKER_SCAN_LIMIT：原样走统一检测器（Plan#75 D4 语义不变）
 * - 超大文：只对前 LIMIT 字符跑 11 模式全扫，尾部按长度块补齐锚点
 *   —— 11 个正则 × 数百万字符 = 主线程秒级卡顿，用户感知为「导入卡死」
 * - 「切索引 ≠ 拆正文」原则不变：产物只是锚点数组，正文始终一整坨
 */
function buildNovelChapters(content: string): ChapterAnchor[] {
  if (content.length <= NOVEL_MARKER_SCAN_LIMIT) return detectChapters(content).chapters;
  const head = detectChapters(content.slice(0, NOVEL_MARKER_SCAN_LIMIT)).chapters;
  const out: ChapterAnchor[] = [...head];
  let start = NOVEL_MARKER_SCAN_LIMIT;
  let number = head.length > 0 ? (head[head.length - 1] as ChapterAnchor).number + 1 : 1;
  while (start < content.length) {
    const end = Math.min(start + NOVEL_TAIL_CHUNK, content.length);
    out.push(buildRangeAnchor(content, start, end, number, `第 ${number} 部分`));
    start = end;
    number += 1;
  }
  return out;
}

/** Plan#79 T5：让出一帧——保证上传队列覆盖层能在长任务之间刷新，不假死 */
function yieldFrame(): Promise<void> {
  return new Promise<void>((resolve) => { setTimeout(resolve, 16); });
}

export function useEditorInteractions({
  refs,
  state,
  actions,
  t,
  aiConfig,
  addAssetToStore,
  canvasConfig,
  containerRef,
  setRenamingNodeId,
  setNodeCreateMenuPos,
  nodeCreateMenuPos,
  setContextMenuItems,
  setConnectionDrop,
  setImageDialog,
  setDetailNode,
  setAssetPickerOpen,
  setReplaceNodeId,
  replaceNodeId,
  setReplaceAccept,
  replaceInputRef,
  setGroupStyleDialog,
  onRenameGroup,
}: {
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
  setImageDialog: React.Dispatch<React.SetStateAction<ImageDialogState | null>>;
  setDetailNode: React.Dispatch<React.SetStateAction<NodeRecord | null>>;
  setAssetPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReplaceNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  replaceNodeId: string | null;
  setReplaceAccept: React.Dispatch<React.SetStateAction<string>>;
  replaceInputRef: React.RefObject<HTMLInputElement | null>;
  setGroupStyleDialog: React.Dispatch<React.SetStateAction<{
    groupId: string;
    currentBgColor: string | undefined;
    currentOpacity: number | undefined;
    currentRadius: number | undefined;
  } | null>>;
  onRenameGroup: (groupId: string) => void;
}) {
  const { theme } = useTheme();
  const { message, modal } = App.useApp();

  // P3.5 失败机制: 每个节点的 AbortController 映射(用户点停止时 abort)
  // 同时跟踪每个节点连续失败次数(用于达 3 次时建议检查 API KEY)
  const nodeAbortControllersRef = useRef<Map<string, any>>(new Map());
  // 已取消生成的分镜节点集合(防取消后 SSE 尾马事件把状态写成 error)
  const cancelledStoryboardsRef = useRef<Set<string>>(new Set());
  const nodeFailureCountRef = useRef<Map<string, number>>(new Map());

  // ===== useSyncExternalStore 状态(订阅 connectionController) =====

  // 连线拖拽期间强制显示所有节点 Pin(订阅 connectionController 的 pending 状态)
  const forceShowPins = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      // subscribePending 返回 unsubscribe 函数
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl ? ctrl.getPending() !== null : false;
    }, [refs.connectionController]),
  );

  // 连线拖拽时高亮鼠标下方的节点(提示可自动连接)
  // 仅 pending 期间返回 hoverNodeId:普通节点悬停(handleNodePointerEnter)也会写
  // hoverNodeId 供 Pin 可见性使用,若不判 pending,普通 hover 会误触发 NodeShell
  // 的蓝色 connectionHover 描边(验收反馈：Hover 变蓝)
  const connectionHoverNodeId = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl && ctrl.getPending() !== null ? ctrl.getHoverNodeId() : null;
    }, [refs.connectionController]),
  );

  // 悬停节点 id(用于 Pin 可见性控制)
  const hoveredNodeId = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const ctrl = refs.connectionController;
      if (!ctrl) return () => {};
      return ctrl.subscribePending(cb);
    }, [refs.connectionController]),
    useCallback(() => {
      const ctrl = refs.connectionController;
      return ctrl ? ctrl.getHoverNodeId() : null;
    }, [refs.connectionController]),
  );

  // ===== useMemo 计算值 =====

  // 依赖字段化拆分(确认制):改节点参数不触发 group/pin memo 重算,
  // 确认生效时重渲染面按字段域收敛,千节点场景避免连锁全量
  const pinDefaults = useMemo(() => ({
    ...configToPinDefaults(canvasConfig),
    color: theme.node.pinDefaultColor,
  }), [
    canvasConfig.pinColor, canvasConfig.pinShape, canvasConfig.pinSize, canvasConfig.pinOpacity,
    theme.node.pinDefaultColor,
  ]);

  // GroupDefaultsProvider 的 value:从 canvasConfig 构建(Group 样式默认,由 GroupLayer 消费作为回退)
  // 映射函数与配置面板预览同源(config-dialog.tsx),保证预览与画布真实节点一致
  const groupDefaultsValue = useMemo(
    () => configToGroupDefaults(canvasConfig, theme),
    [
      canvasConfig.groupBackground, canvasConfig.groupBorderRadius,
      canvasConfig.groupOutlineWidth, canvasConfig.groupOutlineColor,
      canvasConfig.groupOutlineType, canvasConfig.groupOutlineOffset,
      canvasConfig.groupOpacity,
      theme,
    ],
  );

  // NodeDefaultsProvider 的 value:圆角/轮廓宽度来自 canvasConfig,颜色来自 theme.node
  const nodeDefaultsValue = useMemo(
    () => configToNodeDefaults(canvasConfig, theme),
    [canvasConfig.nodeBorderRadius, canvasConfig.nodeOutlineWidth, theme],
  );

  // selectedNodeData 由 useEditorState 在 onChanged 中直接计算并缓存
  const selectedNodeData = state.selectedNodeData;

  const isPromptRunning = selectedNodeData?.status === 'loading';

  // 配置节点专用 — 当前生成模式(仅 generator 节点:堆叠节点不再作为生成目标)
  const selectedConfigMode = useMemo<GenerationMode | undefined>(() => {
    if (state.selectedNodeType !== 'generator') return undefined;
    const m = selectedNodeData?.generationMode as string | undefined;
    if (m === 'text' || m === 'image' || m === 'video' || m === 'audio') return m;
    return 'image';
  }, [state.selectedNodeType, selectedNodeData]);

  // 节点尺寸访问器(统一走 resolveNodeSize: node.size > 扩展契约 > 兜底)
  const getNodeSize = useMemo(
    () => (node: NodeRecord): { width: number; height: number } => {
      return resolveNodeSize(node, state.extensions.get(node.type));
    },
    [state.extensions],
  );

  // 节点扩展访问器（提前定义，避免被 useNodeActionHooks 在 TDZ 中引用）
  const getExtension = useCallback(
    (nodeId: string): NodeTypeExtension | undefined => {
      if (!state.editor) return undefined;
      const graph = state.editor.store.getGraph();
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      if (!node) return undefined;
      if (nodeId === PREVIEW_GROUP_ID) return undefined;
      return state.extensions.get(node.type);
    },
    [state.editor, state.extensions],
  );

  // 组节点专用工具访问器（提前定义，避免被 useNodeActionHooks 在 TDZ 中引用）
  /**
   * Plan#84：把当前选区（或传入 ids）**另存为一份项目内画布副本**。
   * 语义是复制：主画布节点原样不动（用户定稿），所以不进命令队列、不可撤销——
   * 不想要就在抽屉里删掉那份副本。失败一律可读提示，禁止静默。
   */
  const handleCreateCanvasCopy = useCallback(
    async (ids?: string[]): Promise<void> => {
      const store = refs.store;
      if (!store) {
        message.error(t('canvasCopy.notReady', '保存副本失败：画布尚未就绪'));
        return;
      }
      // 项目 id = 剧本槽位绑定（与 WorkbenchTabContent 同一路径）
      const projectId = useCanvasTabStore.getState().slotBindings.script;
      if (!projectId) {
        message.error(t('canvasCopy.noProject', '保存副本失败：未识别到当前项目'));
        return;
      }
      const targetIds = ids && ids.length > 0 ? ids : [...store.getSelection().selectedNodeIds];
      const res = await createCanvasCopyFromSelection({
        projectId, graph: store.getGraph(), nodeIds: targetIds,
      });
      if (!res.ok) {
        const reasonText: Record<string, string> = {
          'empty-selection': t('canvasCopy.emptySelection', '请先框选至少一个节点'),
          'no-project': t('canvasCopy.noProject', '保存副本失败：未识别到当前项目'),
          'write-failed': res.message ?? t('canvasCopy.writeFailed', '画布副本写入失败，请重试'),
        };
        message.warning(reasonText[res.reason] ?? t('canvasCopy.failed', '保存画布副本失败'));
        return;
      }
      // 生成即打开：顶层标签行里多一块与 1 号并排的画布
      useCanvasTabStore.getState().openCanvasTab({ cid: res.doc.id, title: res.doc.title });
      message.success(t('canvasCopy.created', {
        n: res.copiedNodes,
        defaultValue: `已保存为画布副本「${res.doc.title}」（${res.copiedNodes} 个节点）`,
      }));
    },
    [refs.store, message, t],
  );

  const getGroupTools = useCallback(
    (node: NodeRecord, _ctx: ToolContext): ToolDefinition[] => {
      if (!refs.groupPlugin) return [];
      const ctrl = refs.groupPlugin.getController();
      const isPreview = node.id === PREVIEW_GROUP_ID || ctrl.isPreviewing();

      if (isPreview) {
        const mode = ctrl.getPreviewGroupMode();
        return [
          {
            id: 'confirm',
            label: mode === 'version-folder' ? t('groupTools.versionFolderTitle') : t('toolbar.group'),
            title: mode === 'version-folder' ? t('groupTools.versionFolderTitle') : t('groupTools.confirmTitle'),
            icon: createElement(EDITOR_ICONS.group, { size: 14 }),
            group: '预览',
            run: () => ctrl.confirmPreview(t('groupTools.defaultGroupName')),
          },
        ];
      }

      const bgColor = node.backgroundColor ?? '';
      const radius = node.borderRadius;
      const opacity = node.opacity;

      return [
        {
          id: 'rename',
          label: t('groupTools.renameLabel'),
          title: t('groupTools.renameTitle'),
          icon: createElement(EDITOR_ICONS.edit, { size: 14 }),
          group: '组操作',
          run: (n: any) => {
            const store = refs.store;
            if (store) {
              const bounds = getGroupBoundsWithEmptyFallback(store.getGraph().nodes, n.id, getNodeSize);
              if (bounds) store.focusOnBounds(bounds, state.containerSize, 400, 51);
            }
            onRenameGroup(n.id);
          },
        },
        {
          id: 'ungroup',
          label: t('groupTools.ungroupLabel'),
          title: t('groupTools.ungroupTitle'),
          icon: createElement(EDITOR_ICONS.ungroup, { size: 14 }),
          group: '组操作',
          run: (n: any) => ctrl.ungroup([n.id]),
        },
        {
          id: 'style',
          label: t('groupTools.styleLabel'),
          title: t('groupTools.styleTitle'),
          icon: createElement(EDITOR_ICONS.style, { size: 14 }),
          group: '组操作',
          run: (n: any) => {
            setGroupStyleDialog({ groupId: n.id, currentBgColor: bgColor || undefined, currentOpacity: opacity, currentRadius: radius });
          },
        },
        // 选中组 → 磁贴与组右键（同一份 getGroupTools）都出现「保存为画布副本」；
        // 多选含组时复制整个选区，而不是只复制那张组壳
        {
          id: 'toCanvasCopy',
          label: t('canvasCopy.create', '保存为画布副本'),
          title: t('canvasCopy.createTitle', '把选中的节点另存为项目里的另一块画布（主画布不动）'),
          icon: createElement(EDITOR_ICONS.canvasCopy, { size: 14 }),
          group: '组操作',
          run: (n: any, ctx: ToolContext) => {
            const ids = [...(ctx?.getSelectedNodeIds?.() ?? [])];
            void handleCreateCanvasCopy(ids.length > 0 ? ids : [n.id]);
          },
        },
      ];
    },
    [refs.groupPlugin, onRenameGroup, t, refs.store, state.containerSize, getNodeSize, handleCreateCanvasCopy],
  );

  // 胶囊工具栏锚点（提前定义，避免被 useNodeActionHooks 在 TDZ 中引用）
  const getAnchorBounds = useCallback(
    (): { x: number; y: number; width: number; height: number } | null => {
      if (!refs.store) return null;
      const scene = refs.store.getGraph().nodes;
      const ids = [...refs.store.getSelection().selectedNodeIds];
      if (ids.length === 0) return null;
      let dragDx = 0;
      let dragDy = 0;
      const offsets = refs.store.getDragOffsets();
      if (offsets.size > 0) {
        for (const id of ids) {
          const off = offsets.get(id);
          if (off) {
            dragDx = off.dx;
            dragDy = off.dy;
            break;
          }
        }
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const id of ids) {
        const node = scene.find((n: any) => n.id === id);
        if (!node) continue;
        if (node.type === 'group') {
          const b = getGroupBoundsWithEmptyFallback(scene, id, getNodeSize);
          if (!b) continue;
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
        } else {
          const size = getNodeSize(node);
          const px = node.position.x ?? 0;
          const py = node.position.y ?? 0;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px + size.width);
          maxY = Math.max(maxY, py + size.height);
        }
      }
      if (!Number.isFinite(minX)) return null;
      return { x: minX + dragDx, y: minY + dragDy, width: maxX - minX, height: maxY - minY };
    },
    [refs.store, refs.groupPlugin, getNodeSize],
  );

  // ===== 从拆分模块获取 hooks =====
  // 铁律：按各 hook 的 Pick 参数类型精确传递，禁止 `as any` 兜底。
  // 曾因 `as any` 掩盖 useNodeActionHooks 漏传 addAssetToStore/setAssetPickerOpen/message，
  // 右键「存入我的资产」运行时抛 addAssetToStore is not a function。
  const { handleNodeCreateMenuSelect, handleCanvasContextMenu, handleCutEdge } = useNodeActionHooks({
    refs, state, containerRef, t,
    nodeCreateMenuPos, setNodeCreateMenuPos,
    setContextMenuItems,
    getGroupTools,
    addAssetToStore, setAssetPickerOpen, message,
    onCreateCanvasCopy: handleCreateCanvasCopy,
  });
  const { applyLayoutToGroupMembers, handleArrange, handleAlign, handleDistribute, handleUnifySizes, handleMoveOutGroup, handleStackSelected, handleReplaceFileChange } = useCanvasCommandHooks({
    refs, state, containerRef, t, message,
    replaceNodeId, setReplaceNodeId,
  });
  const { handleSaveNodeAsset, handleReversePrompt, handlePromptGenerate, handlePromptStop } = useAgentBridgeHooks(
    { refs, aiConfig, addAssetToStore, setAssetPickerOpen, t },
    nodeAbortControllersRef,
    nodeFailureCountRef,
  );
  const { runAiStoryboard } = useStoryboardHooks(
    { refs, t, message },
    nodeAbortControllersRef as any,
    cancelledStoryboardsRef,
  );

  // 包装 handleCanvasContextMenu 以匹配 canvas-view 期望的签名(避免 getNodeSize 在 TDZ 中)
  const handleCanvasContextMenuWrapper = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleCanvasContextMenu(e, getNodeSize);
    },
    [handleCanvasContextMenu, getNodeSize],
  );

  // 预览组虚拟节点(不在 graph 中,作为 ToolsDock 的 node prop 传入)
  const previewGroupNode = useMemo<NodeRecord>(
    () => ({
      id: PREVIEW_GROUP_ID,
      type: 'group',
      position: { x: 0, y: 0 },
      data: { title: t('group.previewTitle') },
    }),
    [t],
  );

  // ===== useEffect 事件监听 =====

  // 节点重命名/删除/详情事件监听
  useEffect(() => {
    if (!state.editor) return;
    const editor = state.editor;
    const handleNodeRename = ({ nodeId }: { nodeId: string }) => {
      setRenamingNodeId(nodeId);
      const graph = editor.store.getGraph();
      const node = graph.nodes.find((n: any) => n.id === nodeId);
      if (node) {
        // 重命名前聚焦节点(平滑动画,统一走 focusOnNode 几何公式,节点可能在视口外)
        editor.store.focusOnNode(nodeId, state.containerSize, node.size?.width, node.size?.height, 400, 51);
      }
    };
    const handleNodeDelete = () => {
      // R3-D3: 删除前收集 Agent 节点快照（调皮回应）；用户自己的节点（无烙印）不触发
      const store = refs.store;
      const snaps = store
        ? collectAgentNodeSnapshots(
            [...store.getSelection().selectedNodeIds]
              .map((id) => store.getNode(id))
              .filter((n): n is NodeRecord => !!n),
          )
        : [];
      actions.deleteSelected();
      notifyAgentNodesDeleted(snaps);
    };
    const handleNodeDetail = ({ node }: { node: NodeRecord }) => {
      setDetailNode(node);
    };
    editor.core.eventBus.on('node:rename', handleNodeRename);
    editor.core.eventBus.on('node:delete', handleNodeDelete);
    editor.core.eventBus.on('node:detail', handleNodeDetail);

    return () => {
      editor.core.eventBus.off('node:rename', handleNodeRename);
      editor.core.eventBus.off('node:delete', handleNodeDelete);
      editor.core.eventBus.off('node:detail', handleNodeDetail);
    };
  }, [state.editor, state.containerSize, actions, t, addAssetToStore]);

  // 2026-11-05 统一导航入口接收端（navigate-to-view）：「发送到画布」成功后
  // insert-asset-to-canvas 调 navigateToView('canvas', { nodeId }) 切画布页签并送达聚焦目标——
  // 画布已挂载 → NAVIGATE_FOCUS_NODE_EVENT 事件直达；整页未挂载 → 挂载时取 pendingFocus。
  // （页签切换不卸载画布，Plan#50；事件直达时接收端同步清暂存，防 remount 重复聚焦）
  useEffect(() => {
    const store = refs.store;
    if (!store) return;
    return subscribeNavigateFocusNode(store, state.containerSize);
  }, [refs.store, state.containerSize]);

  // 注册连线释放回调(拖拽到空白区域时弹出节点创建菜单)
  useEffect(() => {
    const ctrl = refs.connectionController;
    if (!ctrl) return;
    ctrl.setDropCallback((source: any, screenX: number, screenY: number, worldX: number, worldY: number) => {
      setConnectionDrop({ source, screenX, screenY, worldX, worldY });
    });
    return () => { ctrl.setDropCallback(null); };
  }, [refs.connectionController]);

  // 2026-11-04 单例槽位改造（替代 2026-08-29 "节点删除后移除页签"）：
  // 图变更 → 重新解析 分镜/出片 槽位绑定（= 图中第一个对应类型节点，即流水线单例）；
  // 若当前激活页签的载体节点已不在图中（如槽位节点被删），回退到新绑定或画布槽位。
  useEffect(() => {
    const store = refs.store;
    if (!store) return;
    const onGraphChanged = () => {
      const graph = store.getGraph();
      // 2026-11-04 修复「出片页签点击没反应」：墓碑节点（_deleted）不得再充当槽位绑定载体，
      // 否则绑定指向已删节点 → activateTab 命中但节点不渲染 → portal 永不挂载。
      const storyboardNode = graph.nodes.find((n: any) => n.type === 'storyboard' && !n._deleted);
      const workbenchNode = graph.nodes.find((n: any) => n.type === 'workbench' && !n._deleted);
      const tabStore = useCanvasTabStore.getState();
      tabStore.setSlotBindings({
        storyboard: storyboardNode?.id ?? null,
        workbench: workbenchNode?.id ?? null,
      });
      // 2026-11-04 供应下线后的 key 同步（纯读指针，绝不写图）：
      // 激活的 主体库/导演台 key 必须跟随当前图指针——
      // 有载体节点 → kind:id（节点 portal 供内容）；无载体 → 裸 kind（页级组件空态）。
      // 节点被删除时不再踢回画布页签，而是落到裸 kind 空态（页签始终可打开）。
      const active = tabStore.activeTabKey;
      const m = /^(storyboard|workbench)(:.*)?$/.exec(active);
      if (m) {
        const kind = m[1] as 'storyboard' | 'workbench';
        const bound = kind === 'storyboard' ? storyboardNode?.id : workbenchNode?.id;
        const desired = bound ? `${kind}:${bound}` : kind;
        if (active !== desired) {
          tabStore.activateTab(desired);
        }
      }
    };
    onGraphChanged(); // 挂载即解析一次（打开旧图时立即建立槽位绑定）
    const unsub = store.subscribeGraph(onGraphChanged);
    return () => unsub?.();
  }, [refs.store]);

  const handlePromptChange = useCallback(
    (nodeId: string, prompt: string): void => {
      if (!refs.commandQueue) return;
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, { prompt }));
    },
    [refs.commandQueue],
  );

  // 节点配置变更(模型/尺寸/质量等)
  // paramValues 增量合并基于 graph 最新值:一次点击可能连发多个 patch(如分辨率联动尺寸),
  // 若在组件层用旧闭包合并会互相覆盖(曾导致「点 1k 不高亮」「AUTO 切 4K 尺寸变 4096x4096」)
  const handleNodeConfigChange = useCallback(
    (nodeId: string, patch: Record<string, unknown>): void => {
      if (!refs.commandQueue) return;
      let finalPatch = patch;
      const pv = patch.paramValues;
      if (pv && typeof pv === 'object') {
        const node = refs.store?.getGraph().nodes.find((n: any) => n.id === nodeId);
        const cur = (node?.data as Record<string, any> | undefined)?.paramValues;
        finalPatch = {
          ...patch,
          paramValues: { ...(cur && typeof cur === 'object' ? cur : {}), ...(pv as Record<string, any>) },
        };
      }
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, finalPatch));
    },
    [refs.commandQueue, refs.store],
  );

  // handlePromptGenerate / handlePromptStop (从 useAgentBridgeHooks 获取)

  // nodeActionBus 事件:监听节点内重试/取消按钮,对接生成/停止逻辑
  useEffect(() => {
    const unsubRetry = nodeActionBus.on('retry', (event: { nodeId: string }) => {
      const node = refs.store?.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!node) return;
      const prompt = (node.data as { prompt?: string } | null)?.prompt;
      if (!prompt) return;
      const mode = (node.type === 'text' || node.type === 'image' || node.type === 'video' || node.type === 'audio'
        ? node.type
        : 'image') as GenerationMode;
      void handlePromptGenerate(node.id, mode, prompt);
    });
    // 一键同款(征集#43):胶囊工具栏/右键菜单 emit → 复原完整生成链路
    const unsubReplay = nodeActionBus.on('replayGeneration', (event: { nodeId: string }) => {
      void handleReplayGeneration(event.nodeId, refs, state, t, message);
    });
    const unsubCancel = nodeActionBus.on('cancel', (event: { nodeId: string }) => {
      // 分镜节点: 嵌套 Map(epKey → { taskId }), 断开 SSE + 取消后端任务
      const ctlMap = nodeAbortControllersRef.current.get(event.nodeId);
      if (ctlMap instanceof Map) {
        for (const ctl of ctlMap.values()) {
          if (ctl?.taskId) void agentClient.cancelTask(ctl.taskId);
        }
        agentClient.unsubscribe();
        return;
      }
      handlePromptStop(event.nodeId);
    });
    // ==== AI 生成分镜(真实剧本)的复用逻辑:支持进度条与按集生成,供初次生成/重试/切换集共用 ====
    // Plan#9: 直连 provider 改为后端 storyboard_generate 任务(后端 storyboard_assistant 分块编排 + SSE)
    /* ===== 2026-08-29 剧管自动创建已移除(主体并入分镜主体清单页签),旧逻辑注释保留 =====
    // Plan#29 T6 + 2026-08-21 架构修正: 剧管 = 分镜后置工序(剧本→分镜→剧管)
    // 剧管节点锚定分镜节点(右侧 + storyboard→pm 连线 + 双向关联), 一个分镜节点对应一个剧管,
    // 生成新分镜节点 → 新建对应剧管, 不再按 scriptId 复用导致旧分镜引用被覆盖(幂等)
    const ensureProductionManager = (store: any, q: any, storyboardNode: any): string => {
      const graph = store.getGraph();
      const storyboardId = storyboardNode.id;
      // 已关联本分镜节点的剧管直接复用
      const existing = graph.nodes.find((n: any) => n.type === 'production-manager' && n.data?.storyboardId === storyboardId);
      if (existing) return existing.id;
      const pmId = `node-pm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sbData = (storyboardNode.data ?? {}) as Record<string, unknown>;
      // 2026-08-22: 剧管=分镜后置, 位置走布局契约(右侧 + 垂直整理避让)
      const pmPos = resolvePlacement({
        anchor: storyboardNode,
        ext: state.extensions.get('production-manager'),
        existingNodes: graph.nodes,
      });
      q.execute(new BatchCommand([
        new AddNodeCommand({
          id: pmId,
          type: 'production-manager',
          position: pmPos,
          title: i18n.t('productionManager.editorTitle'),
          data: {
            title: (sbData.title as string) || i18n.t('productionManager.editorTitle'),
            storyboardId,
            scriptId: (sbData.sourceScriptId as string) ?? undefined,
            items: [],
          },
        }),
        new AddEdgeCommand({
          id: `edge-pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: { nodeId: storyboardId, pinId: 'output' },
          target: { nodeId: pmId, pinId: 'input' },
        }),
      ], 'create-production-manager'));
      // 分镜节点记录关联剧管(双向关联)
      q.execute(new UpdateNodeDataCommand(storyboardId, { productionManagerId: pmId }));
      return pmId;
    };

    // Plan#29 T5 + 2026-08-21: AI 识别主体幂等登记进剧管条目(名字/别名命中 → 合并别名+出场集;新名字 → 新建条目)
    // 锚定分镜节点(剧管=分镜后置); 跳过用户已删除的 deletedNames(已删条目不复活); 手动重建同名条目时清除删除标记
    const registerAiSubjectsToProduction = (store: any, q: any, storyboardNode: any, aiSubjects: Array<{ name: string; kind: string; aliases: string[]; description: string }>, episodeId?: string) => {
      if (!aiSubjects || aiSubjects.length === 0) return;
      const pmId = ensureProductionManager(store, q, storyboardNode);
      const pm = store.getGraph().nodes.find((n: any) => n.id === pmId);
      const data = (pm?.data ?? {}) as { items?: ProductionItem[]; deletedNames?: string[] };
      const items: ProductionItem[] = Array.isArray(data.items)
        ? (data.items as ProductionItem[]).map((it) => ({ ...it }))
        : [];
      const deletedNames = Array.isArray(data.deletedNames) ? [...data.deletedNames] : [];
      const removedDeleted = new Set<string>();
      let added = 0;
      for (const subj of aiSubjects) {
        if (!subj.name) continue;
        const subjKeys = productionItemKeys({ name: subj.name, aliases: Array.isArray(subj.aliases) ? subj.aliases : [] });
        const hit = items.find((it) => [...productionItemKeys(it)].some((k) => subjKeys.has(k)));
        if (hit) {
          // 用户手动重建同名条目 → 从删除记录中移除该名(允许后续 AI 识别再次合并)
          if (deletedNames.includes(subj.name)) {
            removedDeleted.add(subj.name);
          }
          hit.aliases = [...new Set([...hit.aliases, ...(Array.isArray(subj.aliases) ? subj.aliases : [])])];
          if (episodeId && !hit.episodeIds.includes(episodeId)) hit.episodeIds = [...hit.episodeIds, episodeId];
          // 2026-08-22 BUG 修复: 历史条目 kind 可能为旧版误判(场景色吞噬角色/道具), AI 语义识别更可靠, 命中时以 AI kind 收敛
          const aiKind = subj.kind === 'scene' || subj.kind === 'prop' ? subj.kind : 'character';
          if (hit.kind !== aiKind) hit.kind = aiKind;
        } else if (!deletedNames.includes(subj.name)) {
          const kind = (subj.kind === 'scene' || subj.kind === 'prop' ? subj.kind : 'character') as ProductionItemKind;
          items.push({
            ...createProductionItem(kind, subj.name),
            aliases: Array.isArray(subj.aliases) ? subj.aliases : [],
            consistency: subj.description ?? '',
            episodeIds: episodeId ? [episodeId] : [],
          });
          added += 1;
        }
      }
      const nextDeleted = deletedNames.filter((n) => !removedDeleted.has(n));
      q.execute(new UpdateNodeDataCommand(pmId, nextDeleted.length !== deletedNames.length ? { items, deletedNames: nextDeleted } : { items }));
      if (added > 0) message.success(i18n.t('productionManager.registered', { count: added }));
    };
    ===== 剧管自动创建旧逻辑注释结束 ===== */

    // runAiStoryboard (从 useStoryboardHooks 获取)

    // FIX-6: 剧本加入资产库成功 → 打开资产库展示结果（数据刷新由 Modal 每次打开时强制重挂载完成）
    const unsubAssetSaved = nodeActionBus.on('script:assetSaved', () => {
      setAssetPickerOpen(true);
    });

    // 剧本 → 生成分镜（P3 §6.1/§6.4 入口收敛 + 去空骨架）
    // 征集 #148/#150：范文态已整体废弃（新节点不再预填范文、存量已清洗），
    // mode=template 直写分支删除——旧文档残留节点也统一走真实任务链路。
    const unsubGenStory = nodeActionBus.on('script:generateStoryboard', (event: { nodeId: string; mode?: 'new' | 'reuse' | 'ai' }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!scriptNode) return;

      // AI 模式（P3 §6.1/§6.4）：不建空骨架节点，直接发任务消息走分块编排链路。
      // 征集 #149 修正：编排器只消费 scriptText 且父任务必须携带 projectId/conversationId——
      // 由前端从画布剧本节点提取纯文本随任务提交（后端并无"主管 read_script_segment"环节）。
      const scriptData = (scriptNode.data ?? {}) as { title?: string; episodes?: Array<{ content?: string }> };
      const scriptTitle = (scriptData.title as string) ?? '';
      const scriptText = Array.isArray(scriptData.episodes)
        ? scriptData.episodes
            // 2026-11-04：统一 normalizeScriptText（修前不解 HTML 实体，&amp; 等会漏进 AI 提示词）
            .map((ep) => normalizeScriptText(ep.content ?? ''))
            .filter(Boolean)
            .join('\n\n')
            .trim()
        : '';
      const agentStore = useCanvasAgentStore.getState();
      // #151：不清空消息流/思考树（否则中断与历史消息被抹掉，刷新无法忠实还原）
      agentStore.setThinking({ active: true });
      agentStore.setIsGenerating(true);
      agentStore.setDockOpen(true);
      agentStore.setDockTab('chat');
      agentStore.clearAgentUnread();
      agentStore.setCurrentPlan(null);
      agentStore.setTodoSnapshot(null);

      // 发送任务消息：taskType=storyboard_generate, scope=all, 携带剧本全文与节点溯源
      void (async () => {
        const projectId = getSessionProjectId() ?? undefined;
        const conversationId = await ensureConversation(projectId);
        return agentClient.send('storyboard_generate', {
          ...(scriptText ? { scriptText } : {}),
          scriptNodeId: scriptNode.id,
          scriptTitle,
          scope: 'all',
        }, { conversationId, projectId });
      })().then(({ taskId }: { taskId: string }) => {
        agentStore.setCurrentTaskId(taskId);
        agentClient.subscribe(taskId, {
          onThinkingDelta: (delta, scope) => {
            appendThinkDelta(delta, scope);
          },
          onPhase: (phase, label) => {
            agentStore.setPhase(phase, label);
          },
          onDone: (output) => {
            const result = (output as { output?: { shots?: unknown[] } } | null)?.output ?? output;
            const shotCount = Array.isArray((result as { shots?: unknown[] } | null)?.shots)
              ? ((result as { shots: unknown[] }).shots.length)
              : 0;
            agentStore.setThinking({ active: false });
            agentStore.setIsGenerating(false);
            agentStore.setCurrentTaskId(null);
            agentStore.setPhase(null);
            if (shotCount > 0) {
              agentStore.addMessage({
                id: `msg_sb_done_${Date.now()}`,
                role: 'agent',
                type: 'text',
                text: `✅ 分镜生成完成：${shotCount} 个镜头。请将分镜节点连到本剧本节点查看（或让我把镜头落到画布分镜节点）。`,
                timestamp: Date.now(),
              });
            }
          },
          onError: (error) => {
            console.error('storyboard_generate 任务失败:', error);
            agentStore.setThinking({ active: false });
            agentStore.setIsGenerating(false);
            agentStore.setCurrentTaskId(null);
            agentStore.setPhase(null);
            agentStore.addMessage({
              id: `msg_sb_err_${Date.now()}`,
              role: 'agent',
              type: 'text',
              text: `⚠️ 分镜生成失败：${error}`,
              timestamp: Date.now(),
            });
          },
          onClose: () => {
            // 清理
          },
        });
      }).catch((err: any) => {
        console.error('提交 storyboard_generate 任务失败:', err);
        agentStore.setThinking({ active: false });
        agentStore.setIsGenerating(false);
        agentStore.setCurrentTaskId(null);
        agentStore.setPhase(null);
      });
    });

    // Plan#33 B3/A4: 生成器(分镜模式)生成 → 复用 runAiStoryboard 链路
    // 参数: params.episodes(集数多选,默认全选) / autoExtractProductionManager(剧管提取,默认开) / useSubjectDictionary(主体字典,默认开)
    const unsubGenSb = nodeActionBus.on('generator:generateStoryboard', (event: { nodeId: string; params?: Record<string, unknown>; scriptEpisodes?: Array<{ id: string }> }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const genNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!genNode) return;

      // 1. 定位生成器连入的剧本节点(剧本→生成器)
      const genInEdge = graph.edges.find((e: any) => {
        const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
        return tgt === event.nodeId && (typeof e.target === 'object' ? e.target?.pinId : undefined) === 'input';
      });
      const scriptNode = genInEdge
        ? graph.nodes.find((n: any) => n.id === (typeof genInEdge.source === 'object' ? genInEdge.source?.nodeId : genInEdge.source) && n.type === 'script')
        : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const scriptData = (scriptNode.data ?? {}) as { episodes?: Array<{ id: string; content?: string; title?: string }> };
      const episodes = scriptData.episodes ?? [];

      // 2. 定位生成器 output 连的目标分镜节点
      const genOutEdge = graph.edges.find((e: any) => {
        const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
        return src === event.nodeId && (typeof e.source === 'object' ? e.source?.pinId : undefined) === 'output';
      });
      const sbNode = genOutEdge
        ? graph.nodes.find((n: any) => n.id === (typeof genOutEdge.target === 'object' ? genOutEdge.target?.nodeId : genOutEdge.target) && n.type === 'storyboard')
        : undefined;
      if (!sbNode) {
        message.warning('请先连接分镜节点到生成器');
        return;
      }

      // 3. 解析参数: 集数多选(默认全选) / 剧管提取(默认开) / 主体字典(默认开)
      const params = event.params ?? {};
      const autoExtract = params.autoExtractProductionManager !== false;
      const epIds = Array.isArray(params.episodes) && (params.episodes as unknown[]).length > 0
        ? (params.episodes as string[])
        : episodes.map((e) => e.id);
      if (epIds.length === 0) {
        message.warning('剧本暂无剧集内容，请先导入或编辑剧本');
        return;
      }

      // 4. 逐集生成(串行避免打爆)
      q.execute(new UpdateNodeDataCommand(sbNode.id, { sourceScriptId: scriptNode.id, activeEpisodeId: epIds[0]! }));
      epIds.forEach((epId) => {
        runAiStoryboard(store, q, scriptNode, sbNode.id, epId, true, autoExtract);
      });
    });

    // F1 重定向:原"关联弹窗"事件删除后,本监听更名为 storyboard:generateMultiple 承接
    // 统一"关联+批量生成分镜":剧本侧批量生成 / 分镜侧 Regen「新对比节点」共用。
    // payload: { scriptNodeId, targetNodeId?, episodeIds, autoGenerate }
    // - 无 targetNodeId（2026-11-04 单例槽位改造）：重定向到分镜槽位单例节点（无则系统级供应一个）
    // - 有 targetNodeId:连到现有分镜节点
    // - autoGenerate=true:对每个选集跑跑 runAiStoryboard;false:仅关联(写 sourceScriptId)
    const unsubGenMultiple = nodeActionBus.on('storyboard:generateMultiple', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.scriptNodeId && n.type === 'script');
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const epIds = Array.isArray(event.episodeIds) ? event.episodeIds : [];
      // 征集 #78: 原位正下方逐集向下堆叠(锚点链式下移), 不避让周围节点;
      // 起始锚点 = 剧本下游分镜列最底节点(无则剧本自身)
      const sbExt = state.extensions.get('storyboard');
      const sbSize = sbExt?.defaultSize ?? { width: 200, height: 100 };
      let batchAnchor: { position: { x: number; y: number }; size?: { width: number; height: number } } = storyboardColumnAnchor(graph, scriptNode);
      const nextBatchPos = (): { x: number; y: number } => {
        const pos = resolvePlacement({
          anchor: batchAnchor,
          ext: sbExt,
          overrides: { direction: 'down', avoidOverlap: false },
        });
        batchAnchor = { position: pos, size: sbSize };
        return pos;
      };

      if (event.targetNodeId) {
        // 已有分镜节点:断开旧的剧本连线 → 建立新连线 + 写 sourceScriptId
        const sbNode = graph.nodes.find((n: any) => n.id === event.targetNodeId && n.type === 'storyboard');
        if (!sbNode) return;
        const sbData = (sbNode?.data ?? {}) as StoryboardNodeData;
        const hasExistingShots =
          (Array.isArray(sbData.shots) && sbData.shots.length > 0) ||
          (sbData.shotsByEpisode && Object.values(sbData.shotsByEpisode).some((arr: unknown) => Array.isArray(arr) && arr.length > 0));
        const switchingScript = (sbData.sourceScriptId ?? null) !== event.scriptNodeId;

        const tgtNodeId = event.targetNodeId!;
        const doAssociate = () => {
          // 断开当前分镜连到其他剧本的旧连线(切换关联时避免残留错误连接)
          const oldEdges = graph.edges.filter((e: any) =>
            e.target?.nodeId === tgtNodeId && e.source?.pinId === 'output' && e.source?.nodeId !== event.scriptNodeId);
          for (const oe of oldEdges) {
            q.execute(new RemoveEdgeCommand(oe.id));
          }
          const existing = graph.edges.some((e: any) =>
            e.target?.nodeId === tgtNodeId && e.source?.nodeId === event.scriptNodeId && e.source?.pinId === 'output');
          if (!existing) {
            q.execute(new AddEdgeCommand({
              id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              source: { nodeId: event.scriptNodeId, pinId: 'output' },
              target: { nodeId: tgtNodeId, pinId: 'input' },
            }));
          }
          q.execute(new UpdateNodeDataCommand(tgtNodeId, { sourceScriptId: event.scriptNodeId, activeEpisodeId: (epIds[0] ?? ((sbNode?.data as any)?.activeEpisodeId as string | undefined) ?? '') }));
          if (event.autoGenerate && epIds.length > 0) {
            // 批量立即生成:为每个选集生成(限流交给调用侧,这里串行避免打爆)
            const first = epIds[0]!;
            q.execute(new UpdateNodeDataCommand(tgtNodeId, { activeEpisodeId: first }));
            runAiStoryboard(store, q, scriptNode, tgtNodeId, first);
            for (let i = 1; i < epIds.length; i++) {
              runAiStoryboard(store, q, scriptNode, tgtNodeId, epIds[i]!);
            }
          }
          message.success('已关联剧本');
        };

        // 已有编辑数据且切换到新剧本,且为"立即生成":询问是否覆盖原有内容
        if (hasExistingShots && switchingScript && event.autoGenerate) {
          modal.confirm({
            title: '关联新剧本',
            content: '当前分镜已有镜头数据，关联新剧本并立即生成会覆盖原有内容，是否继续？',
            okText: '覆盖并关联',
            cancelText: '取消',
            centered: true,
            onOk: doAssociate,
          });
          return;
        }
        doAssociate();
        return;
      }

      // 2026-11-04 单例槽位改造（替代原"剧本侧批量：每个选集新建一个分镜节点"，征集 #78 的多实例语义废弃）：
      // 完全放弃多实例——无 targetNodeId 时重定向到分镜槽位单例节点；
      // 项目还没有分镜节点时，此处做系统级单例供应（画布 UI 新建入口已全部封堵）。
      {
        const slotNode = graph.nodes.find((n: any) => n.type === 'storyboard');
        let tgtNodeId: string;
        if (slotNode) {
          tgtNodeId = slotNode.id as string;
        } else {
          tgtNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const title = i18n.t('canvasNodes.stage.storyboard');
          q.execute(new AddNodeCommand({
            id: tgtNodeId,
            type: 'storyboard',
            position: nextBatchPos(),
            title,
            data: { title, status: 'idle', sourceScriptId: event.scriptNodeId },
          }));
        }
        // 关联剧本连线（幂等：已有同向连线则跳过）
        const linked = graph.edges.some((e: any) =>
          e.target?.nodeId === tgtNodeId && e.source?.nodeId === event.scriptNodeId && e.source?.pinId === 'output');
        if (!linked) {
          q.execute(new AddEdgeCommand({
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            source: { nodeId: event.scriptNodeId, pinId: 'output' },
            target: { nodeId: tgtNodeId, pinId: 'input' },
          }));
        }
        q.execute(new UpdateNodeDataCommand(tgtNodeId, { sourceScriptId: event.scriptNodeId, activeEpisodeId: epIds[0] ?? '' }));
        if (event.autoGenerate) {
          // 逐集生成全部落到同一个分镜槽位节点（shotsByEpisode 按集隔离）
          for (const epId of epIds) {
            runAiStoryboard(store, q, scriptNode, tgtNodeId, epId);
          }
        }
        store.setSelection({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() });
      }
    });

    // 分镜"重试":校验剧本连线后重新生成当前集(若连线已断开则提示无剧本关联)
    const unsubRetryStory = nodeActionBus.on('storyboard:retryGenerate', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const edge = graph.edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.pinId === 'output');
      const scriptNode = edge ? graph.nodes.find((n: any) => n.id === edge.source?.nodeId && n.type === 'script') : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.NOT_FOUND'));
        return;
      }
      const sb = graph.nodes.find((n: any) => n.id === event.nodeId);
      const activeEp = ((sb?.data as any)?.activeEpisodeId as string | undefined);
      runAiStoryboard(store, q, scriptNode, event.nodeId, activeEp, true); // Plan#20 BUG修复: 重试默认创建主体
    });

    // 分镜"切换集/重新生成指定集":校验剧本连线后生成指定集(未生成集切换时触发)
    const unsubRegenEp = nodeActionBus.on('storyboard:regenerateEpisode', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const edge = graph.edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.pinId === 'output');
      const scriptNode = edge ? graph.nodes.find((n: any) => n.id === edge.source?.nodeId && n.type === 'script') : undefined;
      if (!scriptNode) {
        message.warning(i18n.t('errors.NOT_FOUND'));
        return;
      }
      runAiStoryboard(store, q, scriptNode, event.nodeId, event.episodeId, true); // Plan#20 BUG修复: 切集重生成默认创建主体
    });

    // 空分镜节点"关联剧本":建立 剧本.output → 分镜.input 连线(不触发生成)
    const unsubLinkStory = nodeActionBus.on('storyboard:linkScript', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const scriptNode = graph.nodes.find((n: any) => n.id === event.scriptNodeId && n.type === 'script');
      if (!scriptNode) {
        message.warning(i18n.t('errors.SCRIPT_NOT_FOUND'));
        return;
      }
      const sbNode = graph.nodes.find((n: any) => n.id === event.nodeId && n.type === 'storyboard');
      if (!sbNode) return;
      // 已存在同源连线则跳过
      const existing = graph.edges.some((e: any) =>
        e.target?.nodeId === event.nodeId && e.source?.nodeId === event.scriptNodeId && e.source?.pinId === 'output');
      if (existing) {
        message.info(i18n.t('editor.scriptAlreadyLinked'));
        return;
      }
      q.execute(new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: event.scriptNodeId, pinId: 'output' },
        target: { nodeId: event.nodeId, pinId: 'input' },
      }));
      message.success(i18n.t('editor.scriptLinked'));
    });

    // 分镜"放弃生成":清除当前集 error 状态,恢复为可手动编辑的空态
    const unsubAbandonStory = nodeActionBus.on('storyboard:abandon', (event: { nodeId: string }) => {
      const q = refs.commandQueue;
      if (!q) return;
      const graph = q.getState();
      const sb = graph.nodes.find((n: any) => n.id === event.nodeId);
      const stEp = ((sb?.data as any)?.statusByEpisode as Record<string, unknown> | undefined) ?? {};
      const activeEp = ((sb?.data as any)?.activeEpisodeId as string | undefined);
      if (activeEp && activeEp in stEp) {
        q.execute(new UpdateNodeDataCommand(event.nodeId, { statusByEpisode: { ...stEp, [activeEp]: 'ready' } }));
      } else {
        q.execute(new UpdateNodeDataCommand(event.nodeId, { status: 'ready' }));
      }
    });

    // 2026-08-29 收敛:剧管节点已移除——分镜胶囊「剧管」入口改为提示(主体并入分镜「主体清单」页签)
    const unsubManageProduction = nodeActionBus.on('storyboard:manageProduction', () => {
      message.info(i18n.t('storyboard.noSubjectsToManage', '主体已并入分镜「主体清单」页签，请在分镜页签中查看'));
    });

    // Plan#20 T9: 删集级联清理——主体卡 episodeIds 过滤 + 分镜按集映射(shots/status/progress)删除 + activeEpisodeId 回退
    const unsubEpisodesDeleted = nodeActionBus.on('script:episodesDeleted', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const deleted = Array.isArray(event?.deletedIds) ? event.deletedIds : [];
      if (deleted.length === 0) return;
      const graph = store.getGraph();
      const cmds: Command[] = [];
      const deletedSet = new Set(deleted);
      for (const n of graph.nodes) {
        if (n.type === 'storyboard') {
          const d = (n.data ?? {}) as { shotsByEpisode?: Record<string, unknown>; statusByEpisode?: Record<string, unknown>; progressByEpisode?: Record<string, unknown>; activeEpisodeId?: string };
          const patch: Record<string, unknown> = {};
          const drop = <T,>(map: Record<string, T> | undefined): Record<string, T> => {
            const next: Record<string, T> = {};
            for (const [k, v] of Object.entries(map ?? {})) if (!deletedSet.has(k)) next[k] = v;
            return next;
          };
          if (d.shotsByEpisode) patch.shotsByEpisode = drop(d.shotsByEpisode);
          if (d.statusByEpisode) patch.statusByEpisode = drop(d.statusByEpisode);
          if (d.progressByEpisode) patch.progressByEpisode = drop(d.progressByEpisode);
          if (d.activeEpisodeId && deletedSet.has(d.activeEpisodeId)) {
            const remaining = Object.keys(patch.shotsByEpisode as Record<string, unknown>);
            patch.activeEpisodeId = remaining[0] ?? undefined;
          }
          if (Object.keys(patch).length > 0) cmds.push(new UpdateNodeDataCommand(n.id, patch));
        }
      }
      if (cmds.length > 0) q.execute(new BatchCommand(cmds, 'cascade-episode-delete'));
    });

    // ==== NodeGenerateDock 参考素材落地(吸附面板上传/断线 → 画布节点连线) ====
    // nodeDock:addReferenceNode: 面板上传素材 → 创建资源节点(宿主左侧) + 资源.output → 宿主.input 连线
    const unsubAddRef = nodeActionBus.on('nodeDock:addReferenceNode', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const host = store.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!host) return;
      const payload: AssetNodePayload = event.kind === 'text'
        ? { kind: 'text', content: event.content ?? '', title: event.title }
        : event.kind === 'image'
          ? { kind: 'image', dataUrl: event.content ?? '', title: event.title, storageKey: event.storageKey, width: event.width, height: event.height }
          : event.kind === 'video'
            ? { kind: 'video', url: event.content ?? '', title: event.title, storageKey: event.storageKey, width: event.width, height: event.height }
            : { kind: 'audio', url: event.content ?? '', title: event.title, storageKey: event.storageKey };
      void createAssetNode(payload, { x: host.position.x - 100, y: host.position.y }).then((node) => {
        if (!node) return;
        q.execute(new AddNodeCommand(node));
        const sourcePin = NODE_OUTPUT_PIN[node.type] ?? 'output';
        const targetPin = NODE_INPUT_PIN[host.type] ?? 'input';
        q.execute(new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: { nodeId: node.id, pinId: sourcePin },
          target: { nodeId: event.nodeId, pinId: targetPin },
        }));
      });
    });

    // nodeDock:removeConnection: 面板删除参考素材 → 移除对应连线
    const unsubRemoveRef = nodeActionBus.on('nodeDock:removeConnection', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const edge = store.getGraph().edges.find((e: any) => e.target?.nodeId === event.nodeId && e.source?.nodeId === event.sourceNodeId);
      if (edge) q.execute(new RemoveEdgeCommand(edge.id));
    });

    // Plan#74 Phase D1：导入小说 → 弹窗落库 + 建 novel 节点（不走 Agent 解析）。
    // novel 作为上游素材源连入剧本；用户明确「转剧本」时才由 Agent 解析（避免无谓 token）。
    // Plan#75 D3：小说导入双入口·单链路——汇流核心 persistNovelContent（唯一落库建节点实现）：
    // 入口A 节点内「导入文本」/剧本「导入小说」走 picker；入口B Agent request_upload 经
    // 'novel:import-content' 事件汇入同函数，两入口落库产物字段一致（title/wordCount/storageKey）。
    const persistNovelContent = async (content: string, title: string, opts: { intoNodeId?: string; fromScriptNodeId?: string; assetId?: string }): Promise<void> => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      // 纯文本无 storageKey（文本是元数据资产），故用 uploadTextResource 建 text: 工作区资源
      const { storageKey } = await uploadTextResource(content);
      // Plan#79 T5：为上传/索引/写入三步之间让帧，超大文本不再整体阻塞主线程
      await yieldFrame();
      const wordCount = content.length;
      const novelTitle = title || '长文本';
      // Plan#75 D5：导入时跑统一章节检测器（纯正则秒级零 LLM），chapters[] 锚点随节点落库；
      // 正文永远一整坨，chapters 仅是索引（编辑保存时经 onSave 重算，偏移漂移自然消除）。
      // Plan#79 T5：超大文只扫前 2M 字符做标记择优（见 buildNovelChapters），防秒级卡顿。
      const chapters = buildNovelChapters(content);
      await yieldFrame();
      const novelData: Record<string, unknown> = { title: novelTitle, status: 'ready', storageKey, wordCount, chapters };
      // @ novel 直读链路：UploadBlock 入口B 双落库时把云端 assetId 一并写入 data，
      // 使 @ 引用 novel 可携带 assetId → Agent 免 read_node 即可 read_asset_content 定位资产
      if (opts.assetId) novelData.assetId = opts.assetId;
      if (opts.intoNodeId) {
        q.execute(new UpdateNodeDataCommand(opts.intoNodeId, novelData));
      } else if (opts.fromScriptNodeId) {
        const scriptNode = store.getGraph().nodes.find((n: any) => n.id === opts.fromScriptNodeId);
        const novelId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        q.execute(new AddNodeCommand({
          id: novelId,
          type: 'novel',
          position: scriptNode ? { x: scriptNode.position.x - 340, y: scriptNode.position.y } : { x: 0, y: 0 },
          title: novelTitle,
          data: novelData,
        } as any));
        if (scriptNode) {
          q.execute(new AddEdgeCommand({
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            source: { nodeId: novelId, pinId: 'output' },
            target: { nodeId: opts.fromScriptNodeId, pinId: 'input' },
          }));
        }
      } else {
        // 入口B（Agent request_upload）无目标剧本：新建独立 novel 节点
        q.execute(new AddNodeCommand({
          id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'novel',
          position: { x: 0, y: 0 },
          title: novelTitle,
          data: novelData,
        } as any));
      }
      message.success(opts.intoNodeId ? '已导入文本到长文本节点' : '已导入小说并创建素材节点');
      // Plan#79 T2：剧本场景导入完成后，把「@小说名 帮我把这个小说转成剧本」预填到节点 dock。
      // 只预填不自动投递——用户还能改提示词，点「生成」才是 @节点投递 Agent（Plan#79 T1）。
      if (opts.fromScriptNodeId) {
        requestNodeDockPrompt(opts.fromScriptNodeId, `@${novelTitle} 帮我把这个小说转成剧本`);
      }
    };

    const runNovelFileImport = (opts: { intoNodeId?: string; fromScriptNodeId?: string }): void => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.txt,.md';
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        // Plan#79 T5：长文本导入接上传队列覆盖层（与资产库/画布拖入同款浮层），
        // 让用户看到「读取 → 章节索引 → 落点」阶段，而不是窗口无响应。
        const qs = useUploadQueueStore;
        qs.getState().addFiles([file]);
        qs.getState().startProcessing();
        const itemId = qs.getState().items.filter((it) => it.status === 'pending' && it.name.startsWith(file.name)).slice(-1)[0]?.id;
        try {
          if (itemId) qs.getState().updateItem(itemId, { status: 'uploading' });
          // Plan#74 Phase D：长文本改为「工作区资源式」，对齐视频/图片——不再落资产库。
          // 正文经 uploadAsset 拿到编码正确的内容后交给 persistNovelContent 落库建节点。
          const assetInput = await uploadAsset(file);
          const content = ((assetInput.data as any)?.content ?? '') as string;
          if (itemId) qs.getState().updateItem(itemId, { name: `${file.name} · 正在构建章节索引` });
          await yieldFrame();
          await persistNovelContent(content, assetInput.title || '', opts);
          if (itemId) {
            qs.getState().updateItem(itemId, { name: file.name });
            qs.getState().completeOne(itemId);
          }
        } catch (err) {
          console.error('导入小说失败:', err);
          message.error('导入小说失败');
          if (itemId) qs.getState().failOne(itemId, err instanceof Error ? err.message : String(err));
        }
      };
      fileInput.click();
    };
    const unsubNovelImport = nodeActionBus.on('novel:import-from-script', (event: any) => {
      runNovelFileImport({ fromScriptNodeId: event.nodeId as string });
    });
    const unsubNovelImportInto = nodeActionBus.on('novel:import-into', (event: any) => {
      runNovelFileImport({ intoNodeId: event.nodeId as string });
    });
    // Plan#75 D3 入口B：Agent 对话内上传的文本素材汇流同一落库建节点链路
    const unsubNovelImportContent = nodeActionBus.on('novel:import-content', (event: any) => {
      void persistNovelContent(
        String(event.content ?? ''),
        String(event.title ?? ''),
        {
          fromScriptNodeId: event.fromScriptNodeId as string | undefined,
          assetId: event.assetId as string | undefined,
        },
      ).catch((err) => {
        console.error('导入小说失败:', err);
        message.error('导入小说失败');
      });
    });

    // 抽屉图片资产「编辑」→ 先在画布建一个图片节点，再打开图片编辑页签（结果落回画布）
    const unsubEditImageAsset = nodeActionBus.on('imageEditAsset', (event) => {
      const payload = event as unknown as {
        assetId?: string;
        title?: string;
        storageKey?: string;
        content?: string;
        naturalWidth?: number;
        naturalHeight?: number;
      };
      const store = refs.store;
      const queue = refs.commandQueue;
      if (!store || !queue) return;
      const vp = store.getViewport();
      const el = containerRef.current;
      const viewW = el?.clientWidth ?? 800;
      const viewH = el?.clientHeight ?? 600;
      const k = vp.k > 0 ? vp.k : 1;
      const worldX = (viewW / 2 - vp.x) / k;
      const worldY = (viewH / 2 - vp.y) / k;
      const nodeW = 360;
      const ratio = payload.naturalWidth && payload.naturalHeight
        ? payload.naturalHeight / payload.naturalWidth
        : 0.6;
      const nodeH = Math.max(160, Math.round(nodeW * ratio));
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const title = payload.title || '图片';
      queue.execute(new AddNodeCommand({
        id,
        type: 'image',
        title,
        position: { x: Math.round(worldX - nodeW / 2), y: Math.round(worldY - nodeH / 2) },
        size: { width: nodeW, height: nodeH },
        data: {
          content: payload.content,
          storageKey: payload.storageKey,
          status: 'success',
          naturalWidth: payload.naturalWidth,
          naturalHeight: payload.naturalHeight,
        },
      } as NodeRecord));
      store.selectNodes([id], false);
      useCanvasTabStore.getState().openImageTab({ nodeId: id, title });
    });

    // Plan#74 Phase D：存量长文本(assetId → text: 本地资源)一次性迁移（幂等，会话级按项目守卫）
    runNovelMigration(refs, getSessionProjectId() ?? 'default');

    return () => {
      unsubRetry();
      unsubReplay();
      unsubCancel();
      unsubEditImageAsset();
      unsubGenStory();
      unsubAssetSaved();
      unsubGenSb();
      unsubGenMultiple();
      unsubRetryStory();
      unsubRegenEp();
      unsubLinkStory();
      unsubAbandonStory();
      unsubManageProduction();
      unsubEpisodesDeleted();
      unsubAddRef();
      unsubRemoveRef();
      unsubNovelImport();
      unsubNovelImportInto();
      unsubNovelImportContent();
    };
  }, [refs.store, handlePromptGenerate, handlePromptStop, handleReplayGeneration, message]);

  // handleSaveNodeAsset / handleReversePrompt / 布局操作(从 useCanvasCommandHooks + useAgentBridgeHooks 获取)

  // ToolContext: 注入给 ToolsDock 的工具集
  const toolContext = useMemo<ToolContext | null>(() => {
    if (!refs.commandQueue || !state.editor) return null;
    return {
      commandQueue: refs.commandQueue,
      eventBus: state.editor.core.eventBus,
      getSelectedNodeIds: () => state.editor?.store.getSelection().selectedNodeIds ?? new Set(),
      // 征集#9 E1:惰性读取视口/容器尺寸,供新建堆叠按用户视觉中心定位(不加入依赖,避免高频重建)
      getViewport: () => refs.store?.getViewport() ?? { x: 0, y: 0, k: 1 },
      getContainerSize: () => {
        const el = containerRef.current;
        return el
          ? { width: el.clientWidth, height: el.clientHeight }
          : { width: window.innerWidth, height: window.innerHeight };
      },
      openEditor: (node: NodeRecord) => {
        // 文本/配置节点编辑器(图片节点由 openImageDialog 处理)
        if (node.type !== 'image') {
          // 文本/配置节点:通过 data.__editing 标记触发节点内编辑模式
          state.editor?.store.updateNodeData(node.id, { __editing: true });
        }
      },
      openImageDialog: (node: NodeRecord, type: string) => {
        if (type === 'saveAsset') {
          // 保存到素材库:将节点图片内容转为素材
          void handleSaveNodeAsset(node);
          return;
        }
        if (type === 'reversePrompt') {
          // 反推提示词:创建文本节点(暂无 AI 反推,用原 prompt 作为占位)
          handleReversePrompt(node);
          return;
        }
        if (type === 'replace') {
          // 替换图片/视频/音频:根据节点类型设置 accept,触发文件选择
          setReplaceNodeId(node.id);
          if (node.type === 'video') {
            setReplaceAccept('video/*');
          } else if (node.type === 'audio') {
            setReplaceAccept('audio/*');
          } else {
            setReplaceAccept('image/*');
          }
          replaceInputRef.current?.click();
          return;
        }
        // 编辑类操作（裁剪/分割/局部遮罩）走**节点卡片内编辑**（2026-11-06 用户纠偏）：
        // 节点临时放大，图片区直接变成裁剪框/切分网格/蒙版画布；不弹窗口、不额外浮面板。
        if (type === 'edit' || type === 'crop' || type === 'split' || type === 'maskEdit') {
          // 图片编辑 = 独立页签（Photoshop 式）：自带工具栏，输出后回画布。
          // 胶囊上只有一个「编辑」，具体用哪个工具进页面后由页面工具栏决定。
          const mode = type === 'edit' ? 'crop' : type;
          useCanvasTabStore.getState().openImageTab({ nodeId: node.id, title: node.title, mode });
          return;
        }
        // 只读/参数型操作：仍走浮层（查看大图 / 详情 / 放大 / 多角度）
        setImageDialog({ node, type });
      },
    };
  }, [refs.commandQueue, refs.store, state.editor, handleSaveNodeAsset, handleReversePrompt, containerRef]);

  const minimapNodeFilter = (n: NodeRecord) => n.type !== 'group';

  return {
    // 计算值
    pinDefaults,
    groupDefaultsValue,
    nodeDefaultsValue,
    selectedConfigMode,
    isPromptRunning,
    forceShowPins,
    connectionHoverNodeId,
    hoveredNodeId,
    getNodeSize,
    previewGroupNode,
    toolContext,
    minimapNodeFilter,
    nodeAbortControllersRef,
    nodeFailureCountRef,

    // Plan#29 T7: 主体散落卡体系已移除(改为统筹节点);保留字段避免 editor-page 挂载点引用报错
    subjectModals: null,

    // 回调函数
    handleCutEdge,
    handleCanvasContextMenu: handleCanvasContextMenuWrapper,
    handleNodeCreateMenuSelect,
    handlePromptChange,
    handleNodeConfigChange,
    handlePromptGenerate,
    handlePromptStop,
    handleSaveNodeAsset,
    handleReversePrompt,
    applyLayoutToGroupMembers,
    handleArrange,
    handleAlign,
    handleDistribute,
    handleUnifySizes,
    handleMoveOutGroup,
    handleStackSelected,
    handleReplaceFileChange,
    getExtension,
    getGroupTools,
    // Plan#84 T3：多选磁贴聚合区与右键菜单共用同一执行器（editor-page 传入胶囊工具栏）
    handleCreateCanvasCopy,
    getAnchorBounds,
  };
}