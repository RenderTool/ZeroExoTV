/**
 * canvas-store — 「画布」作为项目的一等挂载物（Plan#84 地基，2026-11-06）
 *
 * 用户定稿的模型：**一个项目 = N 个画布（1 号主画布不可删）+ 1 剧本 + 1 主体库 + 1 出片**，
 * 数据结构上是**同一套挂载契约的不同 kind**（不是"主画布 + 它肚子里的子项"）。
 *
 * 现状对齐（实测）：剧本/主体库/出片走 `entities/slot-containers.ts` 的
 * `{schemaVersion, version, title, …payload, updatedAt}` + `ensureProjectMounts()` 幂等自愈挂载。
 * 本模块把 **canvas** 补成第 4 个 kind，同一契约、同一乐观并发语义（MCP 与 UI 共写会冲突报错，不静默覆盖）。
 *
 * Q1 已拍 = 方案 B「虚拟 1 号」：
 * - 1 号画布的 graph **仍留在 `.lf/zeroexo/graph_data/zeroexo:graph:<pid>.json`**（引擎 PersistencePlugin
 *   的自动保存/防抖/分片一行不动，风险为零）；本模块用 `graphRef:"project"` 表明"图不在这个文件里"；
 * - 副本 `graphRef:"inline"`，graph 直接存在 `projects/<pid>/canvases/<cid>.json` 里（裸 JSON，MCP 可直读）。
 * - 上层（标签/抽屉/工作区/MCP）**只看到 listCanvases/getCanvas/saveCanvas 一套 API**，
 *   将来要切"彻底同构"（A 方案）只换本模块里的两个适配器，上层零改动。
 */
import type { GraphModel } from '@zeroexo/core';
import { loadProjectGraph, saveProjectGraph } from '@zeroexo/plugin-persistence';
import { ConflictError, ensureDir, listDir, readJson, remove, stat, writeJson, writeJsonIfUnchanged } from '@/platform/fs.js';

export const CANVAS_SCHEMA_VERSION = 1 as const;
/** 1 号主画布的固定 id（与 app_meta 里的项目 id 一一对应，不可删不可关） */
export const MAIN_CANVAS_ID = 'main';
export const MAIN_CANVAS_TITLE = '主画布';
/** 旧默认标题：读到就归一成「主画布」，不影响用户自定义名 */
export const LEGACY_MAIN_CANVAS_TITLE = '1号画布';

export type CanvasGraphRef = 'project' | 'inline';

export interface CanvasDocument {
  schemaVersion: number;
  kind: 'canvas';
  id: string;
  projectId: string;
  title: string;
  /** 标签顺序（1 号恒为 0） */
  order: number;
  /** true = 不可删除、不可关闭标签（只有 1 号） */
  locked: boolean;
  coverKey: string | null;
  /** 乐观并发版本号（与 script/workbench 同语义；每次成功写入 +1） */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** 'project' = graph 在项目主 graph（1 号）；'inline' = graph 在本文件里（副本） */
  graphRef: CanvasGraphRef;
  graph?: GraphModel;
}

/** 列表项（不读图也能渲染卡片与标签） */
export interface CanvasSummary extends Omit<CanvasDocument, 'graph'> {
  nodeCount: number;
}

export interface CanvasStamp {
  size: number;
  lastModified: number;
}

export interface LoadedCanvas {
  doc: CanvasDocument;
  graph: GraphModel;
  /** 副本文件的指纹（1 号为 null，它走 graph-store 全量写） */
  stamp: CanvasStamp | null;
}

/** 唯一拼路径处（上层不许自己拼，避免第二套定位逻辑） */
export function canvasesDir(projectId: string): string {
  return `projects/${projectId}/canvases`;
}
export function canvasPath(projectId: string, canvasId: string): string {
  return `${canvasesDir(projectId)}/${canvasId}.json`;
}

function assertSafeCanvasId(id: string): void {
  // 路径穿越防线：id 只允许 main 或 sc+base36（与 MCP 侧 assertSafeCanvasId 同口径）
  if (!/^(main|sc[a-z0-9_-]{3,63})$/i.test(id)) {
    throw new Error(`画布 id 非法（只允许 main 或 sc 前缀的 4-64 位安全字符）: ${id}`);
  }
}

export function newCanvasId(): string {
  return `sc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isCanvasDoc(raw: unknown): raw is CanvasDocument {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return r.kind === 'canvas' && typeof r.id === 'string' && typeof r.projectId === 'string';
}

/** 1 号画布的元数据文件（graph 不在里面）；缺失时给虚拟默认值，不写盘（自愈挂载由 ensureCanvasMounts 负责） */
function mainDocFallback(projectId: string): CanvasDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    kind: 'canvas',
    id: MAIN_CANVAS_ID,
    projectId,
    title: MAIN_CANVAS_TITLE,
    order: 0,
    locked: true,
    coverKey: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    graphRef: 'project',
  };
}

// ===== 读写 =====

/** 幂等自愈挂载：1 号元数据文件缺失就建（与 entities 的 ensureProjectMounts 同一姿态） */
export async function ensureCanvasMounts(projectId: string): Promise<{ created: boolean }> {
  if (!projectId) return { created: false };
  const path = canvasPath(projectId, MAIN_CANVAS_ID);
  const existing = await readJson<CanvasDocument>(path);
  if (isCanvasDoc(existing)) return { created: false };
  await ensureDir(canvasesDir(projectId));
  await writeJson(path, mainDocFallback(projectId));
  return { created: true };
}

/** 列项目内全部画布（1 号排首位，其余按 order/updatedAt）；脏文件跳过不炸列表 */
export async function listCanvases(projectId: string): Promise<CanvasSummary[]> {
  if (!projectId) return [];
  const fallback = mainDocFallback(projectId);
  const out: CanvasSummary[] = [{ ...fallback, nodeCount: 0 }];
  let entries: Array<{ name: string; kind: string }> = [];
  try {
    entries = await listDir(canvasesDir(projectId));
  } catch (err) {
    // 目录还不存在 = 还没有任何副本（不是错误）
    console.warn('[canvas-store] canvases 目录读取失败（按无副本处理）:', err);
    return out;
  }
  for (const e of entries) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const id = e.name.slice(0, -'.json'.length);
    if (id === MAIN_CANVAS_ID) {
      const raw = await readJson<CanvasDocument>(canvasPath(projectId, id));
      // 旧默认标题「1号画布」归一成「主画布」；用户自定义名不动
      if (isCanvasDoc(raw)) {
        const title = raw.title === LEGACY_MAIN_CANVAS_TITLE ? MAIN_CANVAS_TITLE : raw.title;
        out[0] = { ...raw, title, locked: true, order: 0, nodeCount: 0 };
      }
      continue;
    }
    if (!/^(sc[a-z0-9_-]{3,63})$/i.test(id)) continue;
    const raw = await readJson<CanvasDocument>(canvasPath(projectId, id));
    if (!isCanvasDoc(raw) || !raw.graph || !Array.isArray(raw.graph.nodes)) {
      console.warn(`[canvas-store] 跳过形状不合法的画布文件: ${e.name}`);
      continue;
    }
    out.push({ ...raw, nodeCount: raw.graph.nodes.length });
  }
  return out.sort((a, b) => (a.locked ? -1 : b.locked ? 1 : a.order - b.order));
}

/** 读一份画布（graph 统一在这里解析出来，调用方不再分支） */
export async function getCanvas(projectId: string, canvasId: string): Promise<LoadedCanvas | null> {
  assertSafeCanvasId(canvasId);
  const raw = await readJson<CanvasDocument>(canvasPath(projectId, canvasId));
  if (canvasId === MAIN_CANVAS_ID) {
    // 1 号：元数据文件可能还没自愈挂载；graph 永远取项目主 graph（B 方案）
    // 旧默认标题「1号画布」归一成「主画布」；用户自定义名不动
    const doc = isCanvasDoc(raw)
      ? { ...raw, title: raw.title === LEGACY_MAIN_CANVAS_TITLE ? MAIN_CANVAS_TITLE : raw.title, locked: true, graphRef: 'project' as const }
      : mainDocFallback(projectId);
    const graph = await loadProjectGraph(projectId);
    return { doc, graph: graph ?? emptyGraph(), stamp: null };
  }
  if (!isCanvasDoc(raw) || !raw.graph) return null;
  const s = await stat(canvasPath(projectId, canvasId));
  return { doc: raw, graph: raw.graph, stamp: s ? { size: s.size, lastModified: s.lastModified } : null };
}

function emptyGraph(): GraphModel {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} } as unknown as GraphModel;
}

/**
 * 保存画布内容 + 元数据。
 * - 1 号 → 写项目主 graph（沿用引擎落盘口，不动它的自动保存链路），元数据 bump version；
 * - 副本 → 带指纹乐观锁整文件写回；指纹不匹配抛 `ConflictError`（**禁止静默覆盖**）。
 */
export async function saveCanvas(
  projectId: string,
  canvasId: string,
  patch: { graph?: GraphModel; title?: string; coverKey?: string | null; order?: number },
  expectedStamp: CanvasStamp | null = null,
): Promise<CanvasDocument> {
  assertSafeCanvasId(canvasId);
  const loaded = await getCanvas(projectId, canvasId);
  if (!loaded) throw new Error(`画布不存在: ${projectId}/${canvasId}`);
  const next: CanvasDocument = {
    ...loaded.doc,
    title: patch.title ?? loaded.doc.title,
    coverKey: patch.coverKey === undefined ? loaded.doc.coverKey : patch.coverKey,
    order: patch.order ?? loaded.doc.order,
    version: loaded.doc.version + 1,
    updatedAt: new Date().toISOString(),
  };
  if (canvasId === MAIN_CANVAS_ID) {
    if (patch.graph) await saveProjectGraph(projectId, patch.graph);
    await ensureDir(canvasesDir(projectId));
    await writeJson(canvasPath(projectId, MAIN_CANVAS_ID), next);
    return next;
  }
  next.graphRef = 'inline';
  next.graph = patch.graph ?? loaded.graph;
  await ensureDir(canvasesDir(projectId));
  await writeJsonIfUnchanged(canvasPath(projectId, canvasId), next, expectedStamp);
  return next;
}

/** 新建一份副本（graph 由调用方给；生成语义在 sub-canvas 执行器里，本模块只管落盘） */
export async function createCanvas(
  projectId: string,
  input: { title: string; graph: GraphModel; coverKey?: string | null; order?: number; id?: string },
): Promise<CanvasDocument> {
  const now = new Date().toISOString();
  const doc: CanvasDocument = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    kind: 'canvas',
    id: input.id ?? newCanvasId(),
    projectId,
    title: input.title,
    order: input.order ?? 100,
    locked: false,
    coverKey: input.coverKey ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    graphRef: 'inline',
    graph: input.graph,
  };
  assertSafeCanvasId(doc.id);
  await ensureDir(canvasesDir(projectId));
  // 先查存在性再写：`writeJsonIfUnchanged(path, _, null)` 只表示“不做版本比对”，
  // **不代表“文件必须不存在”**（src/platform/fs.ts:246-252）——不拦就会静默覆盖用户已有的画布。
  const path = canvasPath(projectId, doc.id);
  const existing = await stat(path);
  if (existing) throw new ConflictError(path, existing);
  await writeJsonIfUnchanged(path, doc, null);
  return doc;
}

/** 删除副本；1 号一律拒绝（用户口径：默认一个主画布不可删除状态） */
export async function deleteCanvas(projectId: string, canvasId: string): Promise<void> {
  assertSafeCanvasId(canvasId);
  if (canvasId === MAIN_CANVAS_ID) {
    throw new Error('1 号主画布不可删除');
  }
  await remove(canvasPath(projectId, canvasId));
}

/** 冲突判定 helper（UI 侧统一用它区分"外部改过"与其它 IO 错误） */
export function isCanvasConflict(err: unknown): err is ConflictError {
  return err instanceof ConflictError;
}