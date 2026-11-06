/**
 * new-node - 「新建节点」的自增标题与默认数据（单一来源，2026-11-06）
 *
 * 主画布创建菜单（`pages/editor/editor-canvas/use-editor-interactions/use-node-actions.ts`）
 * 与子画布工作区的「新建」按钮必须产出**同样的**节点数据形状，否则同一个 image 节点在两块
 * 画布里字段不一致（历史对比、MCP 直读、生成 dock 都会踩）。故抽到此处，两边只调用不各写一份。
 *
 * 行为与原 `handleNodeCreateMenuSelect` 内的三元链**逐项等价**（含色卡默认色逐条拷贝）。
 */
import { COLOR_CARD_DEFAULT_COLORS } from './color-card/color-card-types.js';

/** 类型 → 标题基名 i18n key（与节点类型扩展 displayName 同词，菜单与画布口径一致） */
const NEW_NODE_BASE_KEY: Record<string, string> = {
  novel: 'canvasNodes.stage.novel',
  generator: 'nodes.generatorTitle',
  'stacked-media': 'nodes.stackedMediaTitle',
  text: 'nodeTypes.text',
  'color-card': 'nodes.colorCardTitle',
  image: 'nodeTypes.ai.image',
  video: 'nodeTypes.ai.video',
  audio: 'nodeTypes.ai.audio',
};

type Translate = (key: string) => string;

/** 自增编号标题：`图片3`（sameTypeCount = 同类型现有可见节点数） */
export function newNodeTitle(type: string, sameTypeCount: number, t: Translate): string {
  const key = NEW_NODE_BASE_KEY[type] ?? 'nodes.generatorTitle';
  return `${t(key)}${sameTypeCount + 1}`;
}

/** 默认 data（浅对象，调用方塞进 AddNodeCommand 的 node.data） */
export function buildNewNodeData(type: string, nodeTitle: string, t: Translate): Record<string, unknown> {
  if (type === 'novel') return { title: nodeTitle, status: 'idle' };
  if (type === 'stacked-media') return { cards: [], activeIndex: 0, title: nodeTitle };
  if (type === 'generator') {
    return {
      prompt: '', status: 'idle', generationMode: 'image',
      referenceImages: [], channelId: '', model: '', title: nodeTitle,
    };
  }
  if (type === 'text') {
    return { content: t('editor.newTextNode'), prompt: '', status: 'idle', title: nodeTitle };
  }
  if (type === 'color-card') {
    return { title: nodeTitle, status: 'idle', colors: COLOR_CARD_DEFAULT_COLORS.map((c) => ({ ...c })) };
  }
  return { prompt: '', content: '', status: 'idle', title: nodeTitle };
}
