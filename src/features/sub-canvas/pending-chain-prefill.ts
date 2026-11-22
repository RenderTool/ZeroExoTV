/**
 * 「生成同款」跨文档投递：
 * 只读链路画布点按钮时，把这条链路整理成「参考图 + 空生成节点 + 连线」的 payload，
 * 存到模块单例；切回主画布后由 editor-page 取走并真正建节点。
 * 这里只做数据搬运，不发起任何生成任务。
 */

import { LOCAL_IMAGE_MODEL_KEY, normalizeLocalModelKey } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

export interface ChainPrefillNode {
  id: string;
  type: string;
  title?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: Record<string, unknown>;
}

export interface ChainPrefillEdge {
  id: string;
  source: { nodeId: string; pinId?: string };
  target: { nodeId: string; pinId?: string };
}

export interface ChainPrefillPayload {
  nodes: ChainPrefillNode[];
  edges: ChainPrefillEdge[];
  /** 生成节点（空节点）的 id；落画布后默认选中它 */
  focusNodeId?: string;
}

let pending: ChainPrefillPayload | null = null;

export function setPendingChainPrefill(payload: ChainPrefillPayload): void {
  pending = payload;
}

export function takePendingChainPrefill(): ChainPrefillPayload | null {
  const value = pending;
  pending = null;
  return value;
}

const STRIP_KEYS = [
  'content',
  'storageKey',
  'thumbnailUrl',
  'previewUrl',
  'url',
  'naturalWidth',
  'naturalHeight',
  'generationId',
  'mimeType',
  'status',
  '__readonly',
];

/** 该节点是否带「生成参数」（提示词/模型/参数），是则同款时变回空生成节点 */
function hasGenerationConfig(data: Record<string, unknown>): boolean {
  return Boolean(
    data.prompt
    || data.model
    || data.paramValues
    || data.params
    || data.generationMode
  );
}

/**
 * 从只读链路图构建投递 payload：
 * - 生成节点：清空产物内容/尺寸元数据，只保留提示词 + 模型 + 参数（status=idle）→ 空节点
 * - 参考节点：保留内容（storageKey/content），连线照搬
 * - 所有节点换新 id，避免和主画布已有节点冲突
 */
export function buildChainPrefillPayload(
  graph: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> },
  clickedNodeId?: string,
): ChainPrefillPayload {
  const rawNodes = (graph.nodes ?? []).filter((n) => !n._deleted);
  const idMap = new Map<string, string>();
  const nodes: ChainPrefillNode[] = [];
  let focusNodeId: string | undefined;
  // 只把「用户点开的那一段」变成空生成节点；它上游已经生成好的图片必须保留原内容，
  // 否则同款拿不到参考输入（用户报「同款的参考输入图片呢」就是这个原因）。
  const clicked = rawNodes.find((n) => String(n.id ?? '') === clickedNodeId);
  const clickedGenerates = Boolean(clicked && hasGenerationConfig(
    (clicked.data as Record<string, unknown> | undefined) ?? {},
  ));
  const fallbackTarget = clickedGenerates ? undefined : rawNodes.find((n) => hasGenerationConfig(
    (n.data as Record<string, unknown> | undefined) ?? {},
  ));
  const targetNodeId = clickedGenerates ? clickedNodeId : String(fallbackTarget?.id ?? '');

  rawNodes.forEach((n, index) => {
    const oldId = String(n.id ?? '');
    const newId = `node-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    idMap.set(oldId, newId);
    const data = { ...((n.data as Record<string, unknown> | undefined) ?? {}) };
    // 只读标记只属于历史快照，投递到主画布后必须是普通可编辑节点
    delete data.__readonly;
    // 旧链路把模型写成展示名「qwen」：不是本机 key，生成会落到云端 provider 报请求失败
    if (typeof data.model === 'string' && data.model.trim()) {
      data.model = normalizeLocalModelKey(data.model, String(n.type ?? 'image'));
    }
    const isTarget = oldId === targetNodeId;
    if (isTarget) {
      // 2026-11-22：只读记录的 paramValues 常是模板默认（1024×768），与真实产物尺寸不符。
      // 「生成同款」要沿用这次实际出的尺寸，否则投递回主画布就按默认值重生成。
      const realW = Number((n.data as Record<string, unknown> | undefined)?.naturalWidth ?? 0);
      const realH = Number((n.data as Record<string, unknown> | undefined)?.naturalHeight ?? 0);
      STRIP_KEYS.forEach((key) => { delete data[key]; });
      data.status = 'idle';
      data.content = '';
      if (realW > 0 && realH > 0) {
        const pv = (data.paramValues ?? {}) as Record<string, unknown>;
        data.paramValues = { ...pv, width: realW, height: realH };
      }
      // 同款的生成节点必须是本机 Qwen Image 2.1（图像编辑：文本 + 参考图）。
      // 历史链快照没存 model 时留空会让提示词面板判定成「只吃文字」，生成直接落到 provider 报请求失败。
      if (String(n.type ?? 'image') === 'image' && !data.model) {
        data.model = LOCAL_IMAGE_MODEL_KEY;
      }
      focusNodeId = newId;
    }
    nodes.push({
      id: newId,
      type: String(n.type ?? 'image'),
      title: typeof n.title === 'string' ? n.title : undefined,
      position: {
        x: Number((n.position as { x?: number } | undefined)?.x ?? 0),
        y: Number((n.position as { y?: number } | undefined)?.y ?? 0),
      },
      size: {
        width: Number((n.size as { width?: number } | undefined)?.width ?? 260),
        height: Number((n.size as { height?: number } | undefined)?.height ?? 200),
      },
      data,
    });
  });

  const edges: ChainPrefillEdge[] = [];
  (graph.edges ?? []).forEach((e, index) => {
    if (e._deleted) return;
    const source = (e.source as { nodeId?: string; pinId?: string } | undefined);
    const target = (e.target as { nodeId?: string; pinId?: string } | undefined);
    const sid = source?.nodeId ? idMap.get(source.nodeId) : undefined;
    const tid = target?.nodeId ? idMap.get(target.nodeId) : undefined;
    if (!sid || !tid) return;
    edges.push({
      id: `edge-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      source: { nodeId: sid, pinId: source?.pinId ?? 'output' },
      target: { nodeId: tid, pinId: target?.pinId ?? 'prompt' },
    });
  });

  return { nodes, edges, focusNodeId };
}
