/**
 * use-node-actions - 节点基本操作
 *
 * 提取: 节点创建、删除、右键菜单构建等功能
 * 从 use-editor-interactions.ts 按功能域拆分
 */

import { useCallback, createElement } from 'react';
import { App, Input } from 'antd';
import {
  AddNodeCommand,
  RemoveEdgeCommand,
  RemoveNodeCommand,
  DuplicateNodeCommand,
  type NodeRecord,
  type ToolDefinition,
  type ToolContext,
} from '@zeroexo/core';
import { EDITOR_ICONS } from '../icons.js';
import { getGroupBoundsWithEmptyFallback } from '@zeroexo/plugin-group';
// 本地版（2026-11-02）：无内置 Agent（仅外部 MCP 控制项目）→ 节点菜单不再有「发送到 Agent」入口
// 2026-11-10 用户要求：发送统一成「发送」二级菜单（本项目资产 / 全局资产 / 另存为资产 / 发送到主体）
import { canSendNode, sendNodeToAssets } from '@/features/canvas-assets/node-send.js';
// 2026-11-06：新建节点的自增标题与默认 data 上提为单一来源（主画布与子画布共用）
import { buildNewNodeData, newNodeTitle } from '@/features/canvas-nodes/new-node.js';
// 2026-11-04 资产→主体状态关联：画布右键「发送到主体」弹层（写入统一走 linkSubjectStateMedia）
import { openSubjectLinkDialog } from '@/features/canvas-nodes/storyboard/subject-link-dialog.js';
import type { NodeActionHookParams } from './types.js';

/**
 * 节点创建/右键菜单等相关 hooks
 */
export function useNodeActionHooks(params: NodeActionHookParams) {
  const {
    refs,
    state,
    containerRef,
    nodeCreateMenuPos,
    setNodeCreateMenuPos,
    setContextMenuItems,
    t,
    getGroupTools,
    addAssetToStore,
    onCreateCanvasCopy,
    message,
  } = params;
  /** 「另存为资产」需要弹命名框（hook 内取一次，不能在 onClick 里调） */
  const { modal } = App.useApp();

  /** 节点创建菜单选择 */
  const handleNodeCreateMenuSelect = useCallback(
    (type: 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard' | 'workbench' | 'color-card' | 'novel') => {
      setNodeCreateMenuPos(null);
      // 2026-11-04 单例槽位改造（兜底守卫）：剧本/分镜/出片为项目单例槽位，禁止任何菜单路径新建
      if (type === 'script' || type === 'storyboard' || type === 'workbench') return;
      if (!nodeCreateMenuPos || !containerRef.current || !refs.store) return;
      const rect = containerRef.current.getBoundingClientRect();
      const vp = refs.store.getViewport();
      const worldX = rect && vp ? (nodeCreateMenuPos.x - rect.left - vp.x) / vp.k : 0;
      const worldY = rect && vp ? (nodeCreateMenuPos.y - rect.top - vp.y) / vp.k : 0;
      const offsetX = (Math.random() - 0.5) * 80;
      const offsetY = (Math.random() - 0.5) * 80;
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sameTypeCount = refs.store?.getGraph().nodes.filter((n: any) => n.type === type).length ?? 0;
      // 标题与默认 data 走 new-node.ts 单一来源：子画布工作区“新建”产出完全同形状的节点
      const nodeTitle = newNodeTitle(type, sameTypeCount, t);

      refs.commandQueue?.execute(
        new AddNodeCommand({
          id,
          type,
          position: { x: worldX + offsetX, y: worldY + offsetY },
          title: nodeTitle,
          data: buildNewNodeData(type, nodeTitle, t),
        }),
      );
    },
    [refs, containerRef, nodeCreateMenuPos, t, state.extensions],
  );

  /** 画布右键菜单 */
  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, getNodeSize: (node: NodeRecord) => { width: number; height: number }) => {
      e.preventDefault();
      e.stopPropagation();
      // 告诉 Viewport 跳过内置菜单渲染，由我们处理
      (e as unknown as { skipBuiltinMenu: boolean }).skipBuiltinMenu = true;
      refs.connectionController?.cancel();
      const target = e.target as Element;

      const edgeEl = target.closest('[data-edge-id]');
      if (edgeEl) {
        const edgeId = edgeEl.getAttribute('data-edge-id');
        if (edgeId) {
          setNodeCreateMenuPos(null);
          // 每次重新构建，从干净的列表开始，避免重复累加
          const items: any[] = [
            { key: 'delete-edge', label: t('editor.deleteEdge'), shortcut: 'Delete', icon: createElement(EDITOR_ICONS.delete, { size: 14 }), danger: true, onClick: () => {
              refs.commandQueue?.execute(new RemoveEdgeCommand(edgeId));
            }},
          ];
          setContextMenuItems(items);
          return;
        }
      }

      const nodeEl = target.closest('[data-node-id]');
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute('data-node-id');
        if (nodeId) {
          setNodeCreateMenuPos(null);
          const graph = refs.store?.getGraph();
          const node = graph?.nodes.find((n: any) => n.id === nodeId);
          if (!node) {
            setContextMenuItems(null);
            return;
          }

          const nodeType = node.type;
          const isAssetNode = nodeType === 'text' || nodeType === 'image' || nodeType === 'video' || nodeType === 'audio' || nodeType === 'script' || nodeType === 'novel';
          const nodeData = (node.data ?? {}) as Record<string, unknown>;
          const hasContent = !!((nodeData['content'] as string)?.trim());
          const hasStorageKey = !!((nodeData['storageKey'] as string)?.trim());
          const hasEpisodes = !!((nodeData['episodes'] as unknown[])?.length);
          const canDownload = isAssetNode && (hasContent || hasStorageKey || (nodeType === 'script' && hasEpisodes));
          const canSaveAsset = isAssetNode && (hasContent || hasStorageKey || (nodeType === 'script' && hasEpisodes));

          // 每次从干净的列表开始
          const items: any[] = [
            { key: 'focus', label: t('editor.focusNode'), icon: createElement(EDITOR_ICONS.focus, { size: 14 }), onClick: () => {
              const store = refs.store;
              if (!store) return;
              const g = store.getGraph();
              const n = g.nodes.find((nn) => nn.id === nodeId);
              if (!n) return;
              if (n.type === 'group') {
                const bounds = getGroupBoundsWithEmptyFallback(g.nodes, nodeId, getNodeSize);
                if (bounds) { store.focusOnBounds(bounds, state.containerSize, 400, 51); }
              } else {
                store.focusOnNode(nodeId, state.containerSize, n.size?.width, n.size?.height, 400, 51);
              }
            }},
            { key: 'duplicate', label: t('toolbar.duplicate'), shortcut: 'Ctrl+D', icon: createElement(EDITOR_ICONS.copy, { size: 14 }), onClick: () => {
              if (!refs.commandQueue || !refs.store) return;
              refs.commandQueue.execute(new DuplicateNodeCommand(nodeId));
              }
            },
            { key: 'delete', label: t('toolbar.delete'), shortcut: 'Delete', icon: createElement(EDITOR_ICONS.delete, { size: 14 }), danger: true, onClick: () => {
              if (!refs.commandQueue || !refs.store) return;
              // 2026-11-04 修复「删除后残留」: 与键盘 Delete / 层级面板删除统一为物理移除
              // (ReplaceSceneCommand 从文档中移除节点), 不再留 _deleted 墓碑;
              // 无 group 插件时回退 RemoveNodeCommand(画布/层级面板均已过滤墓碑节点)
              const groupCtrl = refs.groupPlugin?.getController();
              if (groupCtrl) {
                groupCtrl.deleteSceneNode(nodeId);
              } else {
                refs.commandQueue.execute(new RemoveNodeCommand(nodeId));
              }
            }},
          ];

          // 「发送到…」统一入口（2026-11-10 用户要求）：一个父项 + 二级菜单，目的地细分
          if (node && canSendNode(node)) {
            const sendChildren: any[] = [];
            if (canSaveAsset) {
              sendChildren.push({
                key: 'send-to-project',
                label: t('send.toProjectAssets', '本项目资产'),
                icon: createElement(EDITOR_ICONS.saveAsset, { size: 14 }),
                onClick: () => {
                  void sendNodeToAssets(node, 'project')
                    .then((created) => message.success(created.length > 0
                      ? t('send.doneProject', '已发送到本项目资产')
                      : t('send.nothing', '没有可发送的内容')))
                    .catch((err) => console.error('send-to-project failed:', err));
                },
              });
              sendChildren.push({
                key: 'send-to-library',
                label: t('send.toGlobalAssets', '全局资产'),
                icon: createElement(EDITOR_ICONS.saveAsset, { size: 14 }),
                onClick: () => {
                  void sendNodeToAssets(node, 'library')
                    .then((created) => message.success(created.length > 0
                      ? t('send.doneGlobal', '已发送到全局资产')
                      : t('send.nothing', '没有可发送的内容')))
                    .catch((err) => console.error('send-to-library failed:', err));
                },
              });
              sendChildren.push({
                key: 'send-as-asset',
                label: t('send.saveAsAsset', '另存为资产…'),
                icon: createElement(EDITOR_ICONS.saveAsset, { size: 14 }),
                onClick: () => {
                  let title = String(node.title ?? '');
                  modal.confirm({
                    centered: true,
                    title: t('send.saveAsTitle', '另存为资产'),
                    content: createElement(Input, {
                      defaultValue: title,
                      placeholder: t('send.namePlaceholder', '资产名称'),
                      onChange: (e: { target: { value: string } }) => { title = e.target.value; },
                    }),
                    okText: t('common.confirm', '确定'),
                    cancelText: t('common.cancel', '取消'),
                    onOk: async () => {
                      const created = await sendNodeToAssets(node, 'project', { title });
                      if (created.length > 0) message.success(t('send.savedAs', '已另存为资产'));
                    },
                  });
                },
              });
            }
            if ((nodeType === 'image' || nodeType === 'audio' || nodeType === 'video') && hasStorageKey) {
              const subjectDisabled = nodeType === 'video';
              sendChildren.push({
                key: 'send-to-subject',
                label: t('send.toSubject', '发送到主体'),
                icon: createElement(EDITOR_ICONS.sendToSubject, { size: 14 }),
                disabled: subjectDisabled,
                title: subjectDisabled ? t('subject.videoNotSupported', '视频不再支持，请选择图片或语音') : undefined,
                onClick: () => {
                  if (subjectDisabled) return;
                  openSubjectLinkDialog({
                    storageKey: (node.data as { storageKey?: string }).storageKey ?? '',
                    kind: nodeType === 'image' ? 'image' : 'audio',
                    fromNodeId: nodeId,
                    sourceLabel: node.title,
                  });
                },
              });
            }
            if (sendChildren.length > 0) {
              items.push({
                key: 'send',
                label: t('send.menu', '发送'),
                icon: createElement(EDITOR_ICONS.saveAsset, { size: 14 }),
                children: sendChildren,
                onClick: () => {},
              });
            }
          }

          // 选区 → 右键「保存为画布副本」：与组磁贴 / 多选聚合同一执行器（复制成项目内另一块画布，
          // 主画布节点原样不动）。组节点由 getGroupTools 提供同一项，这里不重复。
          if (nodeType !== 'group') {
            const selectionIds = refs.store ? [...refs.store.getSelection().selectedNodeIds] : [];
            const copyIds = selectionIds.includes(nodeId) ? selectionIds : [nodeId];
            items.push({
              key: 'toCanvasCopy',
              label: t('canvasCopy.create', '另存为画布'),
              title: t('canvasCopy.createTitle', '把选中内容另存为画布副本'),
              icon: createElement(EDITOR_ICONS.canvasCopy, { size: 14 }),
              onClick: () => { onCreateCanvasCopy(copyIds); },
            });
          }

          // 分隔线：基础操作 → 资产操作 / 组工具 / 下载（仅当有后续内容时添加）
          const hasAssetOrGroup = (canSaveAsset && !!node) || (node.type === 'group' && refs.commandQueue && refs.store);
          const hasDownload = canDownload && !!node;
          if (hasAssetOrGroup || hasDownload) {
            items.push({ key: 'divider-base', divider: true, label: '', onClick: () => {} });
          }

          // 构建 ToolContext（组工具和扩展工具共用）
          const toolContext: ToolContext = {
            commandQueue: refs.commandQueue!,
            eventBus: state.editor?.core?.eventBus as any,
            // 组右键「保存为画布副本」取真实选区（多选含组时复制整个选区，而不是只复制那张组壳）
            getSelectedNodeIds: () => new Set(refs.store?.getSelection().selectedNodeIds ?? [nodeId]),
            getViewport: () => refs.store?.getViewport() ?? { x: 0, y: 0, k: 1 },
            getContainerSize: () => {
              const el = containerRef.current;
              return el
                ? { width: el.clientWidth, height: el.clientHeight }
                : { width: window.innerWidth, height: window.innerHeight };
            },
            openEditor: (nodeToOpen: NodeRecord) => {
              if (nodeToOpen.type !== 'image') {
                state.editor?.store.updateNodeData(nodeToOpen.id, { __editing: true });
              }
            },
            openImageDialog: (_nodeToOpen: NodeRecord, mode: string) => {
              if (mode === 'saveAsset') {
                // handled by handleSaveNodeAsset in parent
              }
            },
          };

          // 如果是 group 节点，添加组专用工具（重命名/解组/样式）
          if (node.type === 'group' && refs.commandQueue && refs.store) {
            const groupTools = getGroupTools(node, toolContext);
            groupTools.forEach((tool: ToolDefinition) => {
              // 解析 label
              let label = '';
              if (typeof tool.label === 'function') {
                try { label = tool.label(node, toolContext); } catch {}
              } else if (tool.label) {
                label = tool.label;
              } else if (typeof tool.title === 'function') {
                try { label = tool.title(node, toolContext); } catch {}
              } else if (tool.title) {
                label = tool.title;
              }

              // 解析 icon
              let icon = undefined;
              if (typeof tool.icon === 'function') {
                try { icon = tool.icon(node, toolContext); } catch {}
              } else if (tool.icon) {
                icon = tool.icon as any;
              }

              items.push({
                key: `group-${tool.id}`,
                label: label,
                icon: icon,
                danger: tool.danger || false,
                onClick: () => {
                  if (tool.run) {
                    tool.run(node, toolContext);
                  }
                },
              });
            });

            // 组工具 → 下载分隔线
            if (groupTools.length > 0) {
              items.push({ key: 'divider-group', divider: true, label: '', onClick: () => {} });
            }
          }

          // 移除扩展工具菜单（右键菜单只保留基础操作）

          // 下载总是放在最后（分隔线由 divider-base / divider-group 已覆盖，不再重复添加）
          if (canDownload && node) {
            items.push({
              key: 'download', label: t('editor.downloadNode'), icon: createElement(EDITOR_ICONS.download, { size: 14 }), onClick: () => {
                void import('./helpers.js').then(async (m) => {
                  const res = await m.downloadNodeAsFile(node);
                  if (!res.ok) message.error(t('editor.downloadNodeFailed', '下载失败：文件不存在或已被清理'));
                });
              },
            });
            // 带引导的生成视频：额外提供「视频+引导」导出（2026-11-07 需求 1）
            if ((node.data as { guide?: { id?: string } } | null)?.guide?.id) {
              items.push({
                key: 'download-with-guide',
                label: t('editor.downloadNodeWithGuide', '下载视频+引导'),
                icon: createElement(EDITOR_ICONS.download, { size: 14 }),
                onClick: () => {
                  void import('./helpers.js').then(async (m) => {
                    const res = await m.downloadNodeAsFile(node, { withGuide: true });
                    if (!res.ok) message.error(t('editor.downloadNodeFailed', '下载失败：文件不存在或已被清理'));
                    else if (!res.guideOk) message.error(t('assetLibrary.guideDownloadFailed', '引导数据下载失败：文件不存在或 ComfyUI 未连接'));
                  });
                },
              });
            }
          }

          setContextMenuItems(items);
          return;
        }
      }

      // 空白区域，显示节点创建菜单
      setNodeCreateMenuPos({ x: e.clientX, y: e.clientY });
      setContextMenuItems(null);
    },
    [refs, state.containerSize, state.extensions, t, containerRef, setNodeCreateMenuPos, setContextMenuItems, addAssetToStore, message, onCreateCanvasCopy],
  );

  /** 剪切连线 */
  const handleCutEdge = useCallback(
    (edgeId: string): void => {
      refs.commandQueue?.execute(new RemoveEdgeCommand(edgeId));
    },
    [refs.commandQueue],
  );

  return {
    handleNodeCreateMenuSelect,
    handleCanvasContextMenu,
    handleCutEdge,
  };
}