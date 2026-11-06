/**
 * canvas-copy - 「把选区另存为项目内画布副本」（Plan#84 生成链，2026-11-06）
 *
 * 用户定稿语义：**复制**，不是搬走。
 * - 主画布原样不动：不删节点、不插代理卡、不重连跨界边、不算外部桩；
 * - 副本 = `projects/<pid>/canvases/<cid>.json` 的一份画布文档（graphRef='inline'），
 *   与 1 号主画布平级，落盘统一走 `entities/canvas-store.ts`（本模块只管"选区 → graph"）；
 * - 节点**保留原 id 与 storageKey**：副本是另一份文档，不跨文档抢 id；换 id 反而会让
 *   「一键同款」这类按 nodeId 溯源的逻辑在副本里全失效。
 */
import { filterVisibleNodes } from '@zeroexo/core';
import type { EdgeRecord, GraphModel, NodeRecord } from '@zeroexo/core';
import { getDescendantIds } from '@zeroexo/plugin-group';
import { createCanvas, listCanvases, type CanvasDocument } from '@/entities/canvas-store.js';

export interface CreateCanvasCopyArgs {
  projectId: string;
  /** 主画布当前 graph（只读） */
  graph: GraphModel;
  /** 选区节点 id（组自动展开后代） */
  nodeIds: string[];
  /** 缺省 = 「画布副本 N」 */
  title?: string;
}

export type CreateCanvasCopyResult =
  | { ok: true; doc: CanvasDocument; copiedNodes: number; copiedEdges: number }
  | { ok: false; reason: 'empty-selection' | 'no-project' | 'write-failed'; message?: string; error?: unknown };

/** 选区展开：组节点 → 连后代一起进副本（只搬组壳会得到一个空组的坏图） */
export function expandSelectionWithGroups(nodes: readonly NodeRecord[], ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const node = nodes.find((n) => n.id === id);
    if (!node || node._deleted) continue;
    out.add(id);
    if (node.type === 'group') {
      for (const did of getDescendantIds(nodes as NodeRecord[], id)) out.add(did);
    }
  }
  return [...out];
}

/** 深拷贝（副本与主画布从此各改各的，绝不共享对象引用） */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 默认封面：副本里第一张已落盘图片的 storageKey（没有就 null，卡片显示占位，不留假封面） */
export function pickAutoCoverKey(nodes: readonly NodeRecord[]): string | null {
  for (const n of nodes) {
    if (n.type !== 'image') continue;
    const key = (n.data as { storageKey?: unknown } | undefined)?.storageKey;
    if (typeof key === 'string' && key.startsWith('image:')) return key;
  }
  return null;
}

export async function createCanvasCopyFromSelection(args: CreateCanvasCopyArgs): Promise<CreateCanvasCopyResult> {
  const { projectId, graph, nodeIds } = args;
  if (!projectId) return { ok: false, reason: 'no-project' };

  const visible = filterVisibleNodes(graph.nodes) as NodeRecord[];
  const picked = new Set(expandSelectionWithGroups(visible, nodeIds));
  if (picked.size === 0) return { ok: false, reason: 'empty-selection' };

  const nodes = visible.filter((n) => picked.has(n.id)).map(deepClone);
  const edges = ((graph.edges ?? []) as EdgeRecord[])
    .filter((e) => picked.has(e.source.nodeId) && picked.has(e.target.nodeId))
    .map(deepClone);

  // 标题自增数的是"已有画布数 - 1"（1 号不算副本）；列目录失败也不阻断生成
  let existingCount = 0;
  try {
    existingCount = Math.max(0, (await listCanvases(projectId)).length - 1);
  } catch (err) {
    console.warn('[canvas-copy] 读取已有画布失败（标题退用时间戳序号）:', err);
  }
  const title = args.title?.trim() || `画布副本 ${existingCount + 1}`;

  try {
    const doc = await createCanvas(projectId, {
      title,
      coverKey: pickAutoCoverKey(nodes),
      order: existingCount + 1,
      graph: {
        nodes,
        edges,
        // 副本保留原世界坐标：观感与选区一致，打开时由工作区 fit 拉中（零坐标改写风险）
        viewport: { ...graph.viewport },
        metadata: { savedFrom: 'selection' },
      } as GraphModel,
    });
    return { ok: true, doc, copiedNodes: nodes.length, copiedEdges: edges.length };
  } catch (error) {
    return {
      ok: false,
      reason: 'write-failed',
      message: `副本写入失败：${error instanceof Error ? error.message : '未知原因'}（数据目录未授权或被占用）`,
      error,
    };
  }
}
