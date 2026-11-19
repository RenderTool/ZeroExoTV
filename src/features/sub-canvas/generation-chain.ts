/**
 * 生成引用链的序列化（2026-11-18 用户口径）：
 * 每次生成完成，只把「本次生成自己的上游资产 + 本次产物 + 本次参数」序列化，
 * 持久化在资产记录的 generation.chain 里；不复制整张主画布，也不复制无关节点。
 * 展示层（只读子画布）从这份记录重建设节点；同款从这份记录拷贝上游引用与参数。
 */
import { IMAGE_FIT_BOX, fitMediaSize } from '@zeroexo/plugin-nodes';
import { collectUpstreamChainIds } from './chain-graph.js';

export interface GenerationChainNode {
  id: string;
  type: string;
  title?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  data: Record<string, unknown>;
}

export interface GenerationChainEdge {
  id?: string;
  source: { nodeId: string; pinId?: string };
  target: { nodeId: string; pinId?: string };
}

/** 本次真正提交给模型的输入槽位（1 = @图片1），与生成请求里的顺序一一对应 */
export interface GenerationChainInput {
  slot: number;
  nodeId?: string;
  storageKey?: string;
}

export interface GenerationChain {
  nodes: GenerationChainNode[];
  edges: GenerationChainEdge[];
  /** 本次实际用到的输入（按提交顺序）；事后从画布反推的链不可靠，必须在这里定死 */
  inputs?: GenerationChainInput[];
  prompt?: string;
  model?: string;
  params?: Record<string, unknown>;
  createdAt: string;
}

/** 从当前画布抓取「产物节点 + 它的上游引用」这条链；产物 storageKey 由落库方补 */
export function buildGenerationChain(
  graph: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> },
  productNodeId: string,
  meta?: {
    prompt?: string;
    model?: string;
    params?: Record<string, unknown>;
    inputs?: GenerationChainInput[];
  },
): GenerationChain {
  const ids = collectUpstreamChainIds(graph as never, [productNodeId]);
  if (!ids.includes(productNodeId)) ids.push(productNodeId);
  const nodes = (graph.nodes ?? [])
    .filter((n) => !n._deleted && ids.includes(String(n.id)))
    .map((n) => {
      const data = { ...((n.data as Record<string, unknown> | undefined) ?? {}) };
      // 媒体节点只留 CAS storageKey：content/dataUrl 是当次会话的 blob:/dataURL，
      // 写进链后刷新必裂图、还会把资产记录撑到几十 MB。历史按 storageKey 重新解析。
      const key = typeof data.storageKey === 'string' ? data.storageKey : '';
      if (key.startsWith('cas:')) {
        delete data.content;
        delete data.dataUrl;
        delete data.url;
        delete data.localJob;
      }
      // 链快照里的媒体节点统一按真实分辨率装进 620×348 展示框：
      // 主画布上用户可能手动缩过、旧数据也可能停在 260×146，历史视图不能被这些旧尺寸带偏。
      const natW = Number(data.naturalWidth);
      const natH = Number(data.naturalHeight);
      const size = natW > 0 && natH > 0
        ? fitMediaSize(natW, natH, IMAGE_FIT_BOX)
        : (n.size as { width: number; height: number } | undefined);
      return {
        id: String(n.id),
        type: String(n.type ?? 'image'),
        title: typeof n.title === 'string' ? n.title : undefined,
        ...(n.position ? { position: n.position as { x: number; y: number } } : {}),
        ...(size ? { size } : {}),
        data,
      };
    });
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edges = (graph.edges ?? [])
    .filter((e) => !e._deleted)
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id : undefined,
      source: e.source as { nodeId: string; pinId?: string },
      target: e.target as { nodeId: string; pinId?: string },
    }))
    .filter((e) => nodeIdSet.has(e.source?.nodeId) && nodeIdSet.has(e.target?.nodeId));
  return {
    nodes,
    edges,
    ...(meta?.inputs?.length ? { inputs: meta.inputs } : {}),
    prompt: meta?.prompt,
    model: meta?.model,
    params: meta?.params,
    createdAt: new Date().toISOString(),
  };
}
