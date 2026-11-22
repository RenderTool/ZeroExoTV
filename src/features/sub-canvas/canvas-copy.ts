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
import { createCanvas, listCanvases, newCanvasId, MAIN_CANVAS_ID, type CanvasDocument } from '@/entities/canvas-store.js';
import { createProjectVersion, deleteProjectVersion } from '@/entities/version-store.js';

export interface CreateCanvasCopyArgs {
  projectId: string;
  /** 主画布当前 graph（只读） */
  graph: GraphModel;
  /** 选区节点 id（组自动展开后代） */
  nodeIds: string[];
  /** 缺省 = 「画布副本 N」 */
  title?: string;
  /** 临时链路画布：不进子画布列表（提示词快照挂载用） */
  ephemeral?: boolean;
  /** 指定文档 id（同一生成资产重复点击时复用同一块临时画布） */
  id?: string;
  /** 只读历史快照（查看提示词链路）：可看不可改，想改走「生成同款」 */
  readOnly?: boolean;
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

/**
 * 副本落点统一到原点：节点按选区最小 x/y 平移，打开时 viewport 0/0 就能看到内容。
 * 不改 id、不改相对布局，只消除「从主画布带过来的世界坐标偏移」。
 */
export function normalizeNodesToOrigin(nodes: NodeRecord[]): void {
  if (nodes.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    const x = n.position?.x;
    const y = n.position?.y;
    if (typeof x === 'number' && x < minX) minX = x;
    if (typeof y === 'number' && y < minY) minY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
  for (const n of nodes) {
    if (!n.position) continue;
    n.position = { ...n.position, x: n.position.x - minX, y: n.position.y - minY };
  }
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
  normalizeNodesToOrigin(nodes);
  // 只读链路快照落盘前清掉会话级媒体地址（2026-11-18 图裂）：
  // blob:/dataURL 只活当次会话，写进盘里下次打开必裂；CAS 键可复现，只留 storageKey。
  for (const n of nodes) {
    const d = n.data as Record<string, unknown> | undefined;
    const key = typeof d?.storageKey === 'string' ? (d.storageKey as string) : '';
    if (!d || !key.startsWith('cas:')) continue;
    delete d.content;
    delete d.dataUrl;
    delete d.url;
    delete d.localJob;
  }
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

  // 2026-11-22 用户定调：副本 = 整个项目所有历史数据的一个版本。
  // 所以先固化版本快照（当时的全部画布 + 全部历史记录 + 实体 + 引导索引），再建副本画布；
  // 版本失败就整件事失败（不许静默降级成"没有历史的空副本"）。
  // 临时链路画布（ephemeral，提示词快照查看用）不是副本，不做版本化。
  const canvasId = args.id ?? newCanvasId();
  const versionId = args.ephemeral || args.readOnly ? undefined : canvasId;

  try {
    if (versionId) {
      try {
        await createProjectVersion(projectId, { id: versionId, title, sourceCanvasId: MAIN_CANVAS_ID });
      } catch (error) {
        return {
          ok: false,
          reason: 'write-failed',
          message: `副本版本快照写入失败：${error instanceof Error ? error.message : '未知原因'}（数据目录未授权或被占用）`,
          error,
        };
      }
    }
    const doc = await createCanvas(projectId, {
      id: canvasId,
      ...(versionId ? { versionId } : {}),
      title,
      coverKey: pickAutoCoverKey(nodes),
      order: existingCount + 1,
      ephemeral: args.ephemeral,
      graph: {
        nodes,
        edges,
        // 副本内容已平移到原点：打开即 0/0，不再继承主画布当前视口造成偏移
        viewport: { x: 0, y: 0, k: 1 },
        metadata: args.readOnly
          ? { savedFrom: 'generation-chain', readOnly: true }
          : { savedFrom: 'selection' },
      } as GraphModel,
    });
    return { ok: true, doc, copiedNodes: nodes.length, copiedEdges: edges.length };
  } catch (error) {
    // 画布写入失败时把刚建的版本目录清掉，不留孤儿版本（只删自己刚写的目录，不碰媒体）
    if (versionId) await deleteProjectVersion(projectId, versionId).catch(() => undefined);
    return {
      ok: false,
      reason: 'write-failed',
      message: `副本写入失败：${error instanceof Error ? error.message : '未知原因'}（数据目录未授权或被占用）`,
      error,
    };
  }
}
