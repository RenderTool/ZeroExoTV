/**
 * 色卡节点扩展定义（Plan#65）
 *
 * 在 app 层注册到 nodes 插件（use-editor-state.ts 与剧创节点同批 registerAll）。
 * 静态展示型节点：无引脚、不可堆叠、可自由 resize。
 * 编辑通过胶囊工具 nodeActionBus 广播 `color-card:edit`，视图订阅后进入编辑态。
 */

import type { NodeTypeExtension, NodeRendererProps, NodeRuntimeContract } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import i18next from 'i18next';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { CANVAS_NODE_ICONS } from '../icons.js';
import {
  COLOR_CARD_DEFAULT_COLORS,
  COLOR_CARD_DEFAULT_SIZE,
  COLOR_CARD_MIN_SIZE,
} from './color-card-types.js';
import type { ColorCardData } from './color-card-types.js';
import { ColorCardNodeView } from './color-card-node-view.js';

/** 色卡节点 runtime contract（uniform 契约 + 标准 NodeShell 外观，参照剧创节点） */
function createColorCardRuntime(): NodeRuntimeContract {
  return {
    definition: {
      schemaVersion: 1,
      size: {
        basis: { ...COLOR_CARD_DEFAULT_SIZE },
        mode: 'uniform',
        preserveAspectRatio: false,
      },
      visual: {
        appearance: 'shell',
        selectionMode: 'runtime',
      },
    },
  };
}

/** 构建色卡节点扩展（供 use-editor-state.ts registerAll 注册） */
export function createColorCardExtension(
  controller: ConnectionController | null,
): NodeTypeExtension {
  return {
    type: 'color-card',
    displayName: i18next.t('nodes.colorCardTitle'),
    category: 'Basic',
    color: '#f59e0b',
    defaultSize: COLOR_CARD_DEFAULT_SIZE,
    minSize: COLOR_CARD_MIN_SIZE,
    resizable: true,
    runtime: createColorCardRuntime(),
    capabilities: { stackable: false, capabilities: ['color-card'] },
    viewContract: {
      selectionEffect: 'default',
      focusEffect: 'default',
      hoverEffect: 'default',
      connectionHoverEffect: 'default',
      useShellChrome: true,
    },
    // 无引脚：静态展示型节点，不参与连线
    getPins: () => [],
    getTools: () => [
      {
        id: 'edit',
        label: i18next.t('colorCard.edit'),
        title: i18next.t('colorCard.editTitle'),
        icon: <CANVAS_NODE_ICONS.palette size={14} />,
        group: 'basic',
        run: (node) => { nodeActionBus.emit('color-card:edit', { nodeId: node.id }); },
      },
    ],
    createDefaultData: (): ColorCardData => ({
      title: '',
      status: 'idle',
      colors: COLOR_CARD_DEFAULT_COLORS.map((c) => ({ ...c })),
    }),
    renderNode: (props: NodeRendererProps) => (
      <ColorCardNodeView {...props} connectionController={controller} />
    ),
  };
}
