/**
 * use-canvas-commands - 画布命令队列相关操作
 *
 * 提取: 布局操作(排列/对齐/分布/统一尺寸)、堆叠、替换文件等
 * 从 use-editor-interactions.ts 按功能域拆分
 */

import { useCallback } from 'react';
import {
  BatchCommand,
  MoveNodeCommand,
  ResizeNodeCommand,
  resolveNodeSize,
  type Command,
  type NodeRecord,
} from '@zeroexo/core';
import { getChildren, getGroupBounds, MoveGroupCommand } from '@zeroexo/plugin-group';
import {
  arrangeNodes,
  alignNodes,
  distributeNodes,
  unifyNodeSizes,
  type ArrangeMode,
  type AlignMode,
  type DistributeMode,
  type UnifySizeMode,
  type LayoutNode,
} from '@zeroexo/plugin-layout';
import { resolveStackSpawnPosition, stackSelectedNodes, replaceNodeImage, replaceNodeVideo, replaceNodeAudio } from '@zeroexo/plugin-nodes';
import { computeNodesBounds } from './helpers.js';
import type { CanvasCommandHookParams } from './types.js';

/**
 * 画布命令/布局操作相关 hooks
 */
export function useCanvasCommandHooks(params: CanvasCommandHookParams) {
  const {
    refs,
    state,
    containerRef,
    replaceNodeId,
    setReplaceNodeId,
    t,
    message,
  } = params;

  /** 组内成员排列/对齐/分布 */
  const applyLayoutToGroupMembers = useCallback(
    (groupId: string, op: 'arrange' | 'align' | 'distribute' | 'unify', mode: string): void => {
      if (!refs.groupPlugin || !refs.commandQueue || !refs.store) return;
      const scene = refs.store.getGraph().nodes;
      const children = getChildren(scene, groupId);
      if (children.length < 2) return;

      const getNodeSize = (node: NodeRecord): { width: number; height: number } => {
        return resolveNodeSize(node, state.extensions.get(node.type));
      };

      const layoutNodes: LayoutNode[] = children.map((child: any) => {
        const ext = state.extensions.get(child.type);
        const baseMeta = {
          type: child.type,
          defaultSize: ext?.defaultSize,
          lockAspectRatio: ext?.lockAspectRatio,
          resizable: ext?.resizable,
        };
        if (child.type === 'group') {
          const b = getGroupBounds(scene, child.id, getNodeSize);
          return { id: child.id, ...baseMeta, x: b?.x ?? child.position.x, y: b?.y ?? child.position.y, width: b?.width ?? 0, height: b?.height ?? 0 };
        }
        const size = resolveNodeSize(child, ext);
        return { id: child.id, ...baseMeta, x: child.position.x, y: child.position.y, width: size.width, height: size.height };
      });

      if (op === 'unify') {
        const leafChildren = children.filter((c: any) => c.type !== 'group' && !state.extensions.get(c.type)?.specialAppearance);
        if (leafChildren.length < 2) return;
        const leafLayout = layoutNodes.filter((ln) => leafChildren.some((c: any) => c.id === ln.id));
        const sizes = unifyNodeSizes(leafLayout, mode as UnifySizeMode);
        const cmds = leafChildren.filter((c: any) => sizes.has(c.id)).map((c: any) => {
          const newSize = sizes.get(c.id)!;
          const oldSize = c.size ?? { width: 200, height: 80 };
          return new ResizeNodeCommand(c.id, { x: c.position.x, y: c.position.y, width: oldSize.width, height: oldSize.height }, { x: newSize.x, y: newSize.y, width: newSize.width, height: newSize.height });
        });
        if (cmds.length > 0) refs.commandQueue.execute(new BatchCommand(cmds, 'group-unify-size'));
        return;
      }

      let positions: Map<string, { x: number; y: number }>;
      if (op === 'arrange') {
        let edges: { source: string; target: string }[] | undefined;
        if (mode === 'auto' || mode === 'tree' || mode === 'dagre' || mode === 'smart' || mode === 'force' || mode === 'radial') {
          const graph = refs.store.getGraph();
          const childIdSet = new Set(children.map((c: any) => c.id));
          edges = graph.edges.filter((e: any) => childIdSet.has(e.source.nodeId) && childIdSet.has(e.target.nodeId)).map((e: any) => ({ source: e.source.nodeId, target: e.target.nodeId }));
        }
        positions = arrangeNodes(layoutNodes, mode as ArrangeMode, edges);
      } else if (op === 'align') {
        positions = alignNodes(layoutNodes, mode as AlignMode);
      } else {
        positions = distributeNodes(layoutNodes, mode as DistributeMode);
      }
      if (positions.size === 0) return;

      const cmds: Command[] = [];
      for (const child of children) {
        const newPos = positions.get(child.id);
        if (!newPos) continue;
        if (child.type === 'group') {
          const b = getGroupBounds(scene, child.id, getNodeSize);
          if (!b) continue;
          const dx = newPos.x - b.x;
          const dy = newPos.y - b.y;
          if (dx === 0 && dy === 0) continue;
          cmds.push(new MoveGroupCommand(child.id, dx, dy));
        } else {
          const delta = { x: newPos.x - child.position.x, y: newPos.y - child.position.y };
          if (delta.x === 0 && delta.y === 0) continue;
          cmds.push(new MoveNodeCommand(child.id, delta));
        }
      }
      if (cmds.length > 0) refs.commandQueue.execute(new BatchCommand(cmds, `group-${op}`));
    },
    [refs.groupPlugin, refs.commandQueue, refs.store, state.extensions],
  );

  /** 统一排列 */
  const handleArrange = useCallback((mode: ArrangeMode): void => {
    if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
      applyLayoutToGroupMembers(state.selectedNodeId, 'arrange', mode);
    } else {
      refs.layoutController?.arrangeSelection(mode);
    }
  }, [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers]);

  /** 统一对齐 */
  const handleAlign = useCallback((mode: AlignMode): void => {
    if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
      applyLayoutToGroupMembers(state.selectedNodeId, 'align', mode);
    } else {
      refs.layoutController?.alignSelection(mode);
    }
  }, [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers]);

  /** 统一分布 */
  const handleDistribute = useCallback((mode: DistributeMode): void => {
    if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
      applyLayoutToGroupMembers(state.selectedNodeId, 'distribute', mode);
    } else {
      refs.layoutController?.distributeSelection(mode);
    }
  }, [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers]);

  /** 统一尺寸 */
  const handleUnifySizes = useCallback((mode: UnifySizeMode): void => {
    if (state.selectedNodeId && state.selectedHasGroup && !state.isMixedSelection && state.selectedCount === 1) {
      applyLayoutToGroupMembers(state.selectedNodeId, 'unify', mode);
    } else {
      refs.layoutController?.unifySelectionSizes(mode);
    }
  }, [state.selectedNodeId, state.selectedHasGroup, state.isMixedSelection, state.selectedCount, refs.layoutController, applyLayoutToGroupMembers]);

  /** 移出组 */
  const handleMoveOutGroup = useCallback((): void => {
    if (!state.selectedNodeId) return;
    refs.groupPlugin?.getController().moveOutOfGroup([state.selectedNodeId]);
  }, [state.selectedNodeId, refs.groupPlugin]);

  /** 多选堆叠 */
  const handleStackSelected = useCallback(() => {
    const g = refs.store?.getGraph();
    const selectedIds = refs.store?.getSelection().selectedNodeIds;
    if (!g || !selectedIds || selectedIds.size < 2) return;
    const isNodeStackable = (n: NodeRecord): boolean => {
      if (n.type === 'group') return false;
      const ext = state.extensions.get(n.type);
      return Boolean(ext?.capabilities?.stackable);
    };
    const sn = g.nodes.filter((n) => selectedIds.has(n.id));
    const getViewport = () => refs.store?.getViewport() ?? { x: 0, y: 0, k: 1 };
    const getContainerSize = () => {
      const el = containerRef.current;
      return el ? { width: el.clientWidth, height: el.clientHeight } : { width: window.innerWidth, height: window.innerHeight };
    };
    const toolCtx = { commandQueue: refs.commandQueue, getViewport, getContainerSize } as never;
    const spawn = resolveStackSpawnPosition(toolCtx, { ignoreNodeIds: selectedIds });
    const result = stackSelectedNodes(
      spawn ?? { x: computeNodesBounds(sn).maxX + 120, y: computeNodesBounds(sn).minY },
      sn,
      { edges: g.edges },
      isNodeStackable,
    );
    if (!result) return;
    refs.commandQueue?.execute(result.command);
    const container = getContainerSize();
    const mergedNode = refs.store?.getNode(result.stackNodeId);
    if (refs.store?.focusOnNode && container) {
      refs.store.focusOnNode(result.stackNodeId, container, mergedNode?.size?.width, mergedNode?.size?.height, 400, 51, 0.8);
    }
    if (result.skippedCount > 0) {
      const skippedTitles = result.skippedIds.map((id) => g.nodes.find((n) => n.id === id)?.title).filter((t): t is string => !!t);
      const skipDetail = skippedTitles.length > 0 ? `（未收纳：${skippedTitles.slice(0, 3).join('、')}${skippedTitles.length > 3 ? ' 等' : ''}）` : '';
      message.info(t('nodes.stackSelectedResult', { collected: result.collectedCount, skipped: result.skippedCount }) + skipDetail);
    } else {
      message.success(t('nodes.stackSelectedDone', { count: result.collectedCount }));
    }
  }, [refs, state.extensions, containerRef, t, message]);

  /** 替换文件回调 */
  const handleReplaceFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const nodeId = replaceNodeId;
    e.target.value = '';
    setReplaceNodeId(null);
    if (!file || !nodeId || !refs.commandQueue || !refs.store) return;
    try {
      const graph = refs.store.getGraph();
      const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
      if (!node) return;
      if (file.type.startsWith('image/')) {
        await replaceNodeImage(refs.commandQueue, node, file, { ext: state.extensions.get(node.type) });
      } else if (file.type.startsWith('video/')) {
        await replaceNodeVideo(refs.commandQueue, node, file, { ext: state.extensions.get(node.type) });
      } else if (file.type.startsWith('audio/')) {
        await replaceNodeAudio(refs.commandQueue, node, file);
      }
    } catch (err) {
      console.error('replace failed:', err);
    }
  }, [replaceNodeId, refs.commandQueue, refs.store, state.extensions]);

  return {
    applyLayoutToGroupMembers,
    handleArrange,
    handleAlign,
    handleDistribute,
    handleUnifySizes,
    handleMoveOutGroup,
    handleStackSelected,
    handleReplaceFileChange,
  };
}