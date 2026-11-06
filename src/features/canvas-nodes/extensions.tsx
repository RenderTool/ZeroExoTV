/**
 * 剧创节点扩展(剧本/分镜/出片)
 *
 * 在 app 层注册到 nodes 插件(阶段页位于 app `src/`,不能在插件包内引用)。
 * 使用 PluginNodesPlugin.registerAll 一次性注册三类型。
 */

import type { NodeTypeExtension, NodeRendererProps, ToolDefinition, NodeRuntimeContract, NodeCapabilities } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import i18next from 'i18next';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { CANVAS_NODE_ICONS } from './icons.js';
import {
  CREATION_DEFAULT_SIZE,
  CREATION_MIN_SIZE,
  CREATION_PINS,
  WORKBENCH_FIXED_SIZE,
} from './creation-node-types.js';
import type { CreationNodeType } from './creation-node-types.js';
import { CreationNodeView } from './creation-node-view.js';

/** 各剧创节点展示名 i18n key */
export const CREATION_NAME_KEY: Record<CreationNodeType, string> = {
  script: 'canvasNodes.stage.script',
  storyboard: 'canvasNodes.stage.storyboard',
  workbench: 'canvasNodes.stage.workbench',
  novel: 'canvasNodes.stage.novel',
};

/** 各剧创节点主题色 */
const CREATION_COLOR: Record<CreationNodeType, string> = {
  script: '#f59e0b',
  storyboard: '#8b5cf6',
  workbench: '#06b6d4',
  novel: '#10b981',
};

/** 各剧创节点能力声明(不参与堆叠,不参与媒体计算) */
const CREATION_CAPABILITIES: Record<CreationNodeType, NodeCapabilities> = {
  script: { stackable: false, capabilities: ['script'] },
  storyboard: { stackable: false, capabilities: ['storyboard'] },
  workbench: { stackable: false, capabilities: ['workbench'] },
  novel: { stackable: false, capabilities: ['novel'] },
};

/** 构建剧创节点 runtime contract(uniform 契约 + 标准 NodeShell 外观)
 * Plan#1 T3(验收修正): free→uniform 契约迁移,但**不声明 lockAspectRatio**——
 * 需求：script/storyboard 保持自由宽高 resize(内部列表重排不变形);
 * 非等比尺寸 isUniformScale=false 自动回退真实尺寸渲染
 *
 * 2026-08-31:出片(workbench)与音频气泡同款 → appearance:'custom' + specialAppearance,
 * 尺寸固定 280×240,不参与全局外观配置与尺寸计算 */
function createCreationRuntime(
  defaultSize: { width: number; height: number },
  options: { appearance?: 'shell' | 'custom' } = {},
): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...defaultSize },
        mode: 'uniform',
        preserveAspectRatio: false,
      },
      visual: {
        appearance: options.appearance ?? 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}

// ===== 剧本/分镜/出片节点胶囊工具 =====
// 2026-11-04 单例槽位改造：这三类节点在画布上只读保留（可看、可拖动、可删除），
// 不再提供任何节点级编辑入口（编辑统一走顶部固定槽位页签），故胶囊工具全部移除。

// ===== novel 长文本素材节点工具(Plan#74 Phase C：只读壳，点击查看全屏阅读) =====

function getNovelTools(): ToolDefinition[] {
  return [
    {
      id: 'read',
      label: '查看',
      title: '全屏阅读长文本',
      icon: <CANVAS_NODE_ICONS.read size={14} />,
      group: 'basic',
      run: (node) => { nodeActionBus.emit('novel:read', { nodeId: node.id }); },
    },
  ];
}

function createCreationExtension(
  kind: CreationNodeType,
  controller: ConnectionController | null,
  nameKey: string,
  getStore: () => ReactGraphStore | null,
): NodeTypeExtension {
  // 分镜节点允许剧本 + 生成器节点连入 input pin(Plan#33 A7: 剧本不强制,生成器可直连分镜)
  // 出片节点仅允许分镜/统筹/主体节点连入 input pin
  const canConnect: NodeTypeExtension['canConnect'] =
    kind === 'storyboard'
      ? (source, target) => {
          // 2026-08-31 修复「分镜 output 拖线连不进出片」：
          // controller 会【双向调用】本钩子（source 端 + target 端各一次）。原实现判断
          // `source.nodeId` 的类型 —— 分镜作为 source 时 source 是自己（type=storyboard），
          // 被误判为「非剧本连入」拒绝，导致 storyboard→workbench 永远失败。
          // 正确语义：只有【分镜作为 target（input 接收方）】时才限制来源必须是剧本。
          if (target.direction !== 'input') return;
          const store = getStore();
          if (!store) return;
          const graph = store.getGraph();
          const tgtNode = graph.nodes.find((n) => n.id === target.nodeId);
          // 目标不是分镜（例如分镜 output → 出片 input）→ 放行，让出片端钩子裁决
          if (!tgtNode || tgtNode.type !== 'storyboard') return;
          const sourceNode = graph.nodes.find((n) => n.id === source.nodeId);
          if (sourceNode && sourceNode.type !== 'script') {
            return { valid: false, reason: '分镜节点支持关联剧本节点' };
          }
        }
      : kind === 'workbench'
        ? (source, target) => {
            if (target.direction !== 'input') return;
            const store = getStore();
            if (!store) return;
            const graph = store.getGraph();
            const sourceNode = graph.nodes.find((n) => n.id === source.nodeId);
            // Q2: 除 storyboard 外，亦允许 video 节点连入（视频素材作为出片上游输入）
            if (sourceNode && !['storyboard', 'video'].includes(sourceNode.type)) {
              return { valid: false, reason: '出片节点仅支持关联分镜或视频节点' };
            }
            // Task3（2026-08-31 约定）：出片仅允许连入单个分镜节点（故事时间轴唯一），
            // 已连 1 个分镜时阻止第 2 个（source 也是 storyboard 且并非已连的那一个）。
            // 注：video 节点独立于该限制——视频以 clip 形态附于已有 track，不占分镜唯一槽。
            if (sourceNode && sourceNode.type === 'storyboard') {
              const existing = graph.edges.find(
                (e) => e.target?.nodeId === target.nodeId
                  && e.source?.nodeId !== source.nodeId
                  && graph.nodes.find((n) => n.id === e.source?.nodeId && n.type === 'storyboard'),
              );
              if (existing) {
                return { valid: false, reason: '出片节点已关联一个分镜节点，时间轴唯一，不能连入第二个分镜' };
              }
            }
          }
        : undefined;

  return {
    type: kind,
    displayName: i18next.t(nameKey),
    category: '创作',
    color: CREATION_COLOR[kind],
    defaultSize: CREATION_DEFAULT_SIZE[kind],
    minSize: CREATION_MIN_SIZE[kind],
    // 2026-08-31:出片节点固定尺寸(与音频气泡同款)——不可缩放、不参与尺寸计算
    // 2026-09-06:novel(小说)同样固定 3:4、永不可缩放;仅 script/storyboard 可缩放
    // (空态由 CreationNodeView 尺寸自愈锁定,变具体态后可自由缩放)
    resizable: kind === 'script' || kind === 'storyboard',
    specialAppearance: kind === 'workbench',
    // 2026-08-22 布局契约: 创建新节点的默认排序参数(统一走 resolvePlacement, 禁硬编码偏移)
    placement: {
      direction: 'right',
      gap: 96,
      avoidOverlap: true,
    },
    // P5 契约接入:声明领域能力(不参与堆叠)与运行时缩放/外观契约
    capabilities: CREATION_CAPABILITIES[kind],
    runtime: kind === 'workbench'
      ? createCreationRuntime(WORKBENCH_FIXED_SIZE, { appearance: 'custom' })
      : createCreationRuntime(CREATION_DEFAULT_SIZE[kind]),
    // 标准 NodeShell 状态渲染,排布边界即 node.size
    viewContract: {
      selectionEffect: 'default',
      focusEffect: 'default',
      hoverEffect: 'default',
      connectionHoverEffect: 'default',
      useShellChrome: true,
    },
    getPins: () => CREATION_PINS[kind],
    canConnect,
    // 2026-11-04 单例槽位改造：剧本/分镜/出片画布上只读保留，无任何胶囊工具（编辑走固定槽位页签）；
    // 仅 novel 保留「查看」工具。
    getTools: kind === 'novel' ? () => getNovelTools() : undefined,
    createDefaultData: () => ({
      title: '',
      status: 'idle',
      content: kind === 'script' ? '' : undefined,
      shots: kind === 'storyboard' ? [] : undefined,
      entities: kind === 'storyboard' ? [] : undefined,
    }),
    renderNode: (props: NodeRendererProps) => (
      <CreationNodeView
        {...props}
        connectionController={controller}
        kind={kind}
      />
    ),
  };
}

/** 构建剧创节点扩展列表(供 nodesPlugin.registerAll 注册)
 * 2026-11-04 单例槽位改造：script/storyboard/workbench 仍注册（旧图渲染必需），
 * 但不再提供任何新建路径（创建菜单/工具栏/连线拖放/粘贴均已封堵），
 * 画布上只读保留；内容由顶部固定槽位页签承载。 */
export function createCreationExtensions(
  controller: ConnectionController | null,
  getStore?: () => ReactGraphStore | null,
): NodeTypeExtension[] {
  return (['script', 'storyboard', 'workbench', 'novel'] as CreationNodeType[]).map((kind) =>
    createCreationExtension(kind, controller, CREATION_NAME_KEY[kind], getStore ?? (() => null)),
  );
}