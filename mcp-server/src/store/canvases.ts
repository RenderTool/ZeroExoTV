/**
 * 画布（canvases）读写 —— 与前端 `src/entities/canvas-store.ts` 同一契约（Spec v2 / 征集#184，2026-11-06）
 *
 * 模型：一个项目下可以有 **N 份画布**（1 号主画布 + 若干副本），它们是项目的一等挂载物，
 * 与剧本/出片同构。磁盘上分两处（这是 Q1 拍的方案 B「虚拟 1 号」）：
 * - 1 号：图仍在 `.lf/zeroexo/graph_data/zeroexo:graph:<pid>.json`（`{__lf:1,value:{graph}}`），
 *   元数据在 `canvases/main.json`（可缺，缺则给虚拟默认）；
 * - 副本：`projects/<pid>/canvases/<cid>.json`（裸 JSON，graphRef='inline'）。
 *
 * **1 号对 MCP 只读**：写它等于和前端 PersistencePlugin 的防抖自动保存抢盘，
 * 外部工具想改 1 号请走 UI；`patchCanvasNodes` 对 main 直接拒绝并说明原因。
 *
 * 写纪律：副本走 `updateUnversionedJson` 的 size+mtime 双因子（与前端乐观锁同语义），
 * 并发时后写者拿 VERSION_CONFLICT，绝不静默覆盖。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { McpError } from "../errors.js";
import { readJsonIfExists, updateUnversionedJson } from "./fs-node.js";

/** 与前端 CANVAS_SCHEMA_VERSION 同步；读取侧只接受 ≤ 本值 */
export const CANVAS_SCHEMA_VERSION = 1;
export const MAIN_CANVAS_ID = "main";

export type CanvasGraph = {
  nodes?: unknown[];
  edges?: unknown[];
  viewport?: { x: number; y: number; k: number };
  metadata?: Record<string, unknown>;
};

export interface CanvasDocument {
  schemaVersion: number;
  kind: "canvas";
  id: string;
  projectId: string;
  title: string;
  order: number;
  locked: boolean;
  coverKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  graphRef: "project" | "inline";
  graph?: CanvasGraph;
}

export interface CanvasSummary {
  id: string;
  title: string;
  locked: boolean;
  graphRef: "project" | "inline";
  coverKey: string | null;
  version: number;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  /** MCP 能否写这份画布（1 号 = false，只读） */
  writable: boolean;
}

/** 文件名安全校验（兼路径穿越防线）；与前端 assertSafeCanvasId 同口径 */
export function assertSafeCanvasId(id: string): string {
  if (!/^(main|sc[a-z0-9_-]{3,63})$/i.test(id)) {
    throw new McpError("VALIDATION", `画布 id 非法（只允许 main 或 sc 前缀 4-64 位安全字符）: ${id}`, { id });
  }
  return id;
}

function asGraph(value: unknown): CanvasGraph {
  return value && typeof value === "object" ? (value as CanvasGraph) : {};
}

function countOf(list: unknown): number {
  return Array.isArray(list) ? list.length : 0;
}

function docOf(raw: unknown): CanvasDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "canvas" || typeof r.id !== "string") return null;
  return r as unknown as CanvasDocument;
}

/** 读 1 号：元数据文件（可缺）+ 主 graph 文件（可缺） */
async function readMainCanvas(root: string, projectId: string): Promise<{ doc: CanvasDocument; graph: CanvasGraph }> {
  const meta = docOf(await readJsonIfExists<unknown>(paths.canvas(projectId, MAIN_CANVAS_ID, root)));
  const now = new Date(0).toISOString();
  const doc: CanvasDocument = meta ?? {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    kind: "canvas",
    id: MAIN_CANVAS_ID,
    projectId,
    title: "1号画布",
    order: 0,
    locked: true,
    coverKey: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    graphRef: "project",
  };
  const envelope = await readJsonIfExists<{ value?: { graph?: unknown } }>(paths.mainGraphFile(projectId, root));
  return { doc: { ...doc, id: MAIN_CANVAS_ID, locked: true, graphRef: "project" }, graph: asGraph(envelope?.value?.graph) };
}

export async function getCanvas(root: string, projectId: string, canvasId: string): Promise<CanvasDocument | null> {
  assertSafeCanvasId(canvasId);
  if (canvasId === MAIN_CANVAS_ID) {
    const { doc, graph } = await readMainCanvas(root, projectId);
    return { ...doc, graph };
  }
  return docOf(await readJsonIfExists<unknown>(paths.canvas(projectId, canvasId, root)));
}

/** 列项目内全部画布：1 号恒在首位；脏文件跳过并 warn，不阻断整个列表 */
export async function listCanvases(root: string, projectId: string): Promise<CanvasSummary[]> {
  const out: CanvasSummary[] = [];
  const { doc, graph } = await readMainCanvas(root, projectId);
  out.push({
    id: MAIN_CANVAS_ID,
    title: doc.title,
    locked: true,
    graphRef: "project",
    coverKey: doc.coverKey ?? null,
    version: doc.version,
    updatedAt: doc.updatedAt,
    nodeCount: countOf(graph.nodes),
    edgeCount: countOf(graph.edges),
    writable: false,
  });

  let names: string[] = [];
  try {
    names = await fs.readdir(paths.canvasesDir(projectId, root));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw new McpError("IO_ERROR", `读取画布目录失败: ${projectId}: ${(err as Error).message}`);
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -path.extname(name).length);
    if (id === MAIN_CANVAS_ID) continue; // 1 号已在首位
    if (!/^sc[a-z0-9_-]{3,63}$/i.test(id)) continue;
    let doc: CanvasDocument | null;
    try {
      doc = docOf(await readJsonIfExists<unknown>(paths.canvas(projectId, id, root)));
    } catch (err) {
      console.warn(`[canvases] 跳过无法解析的画布文件 ${name}:`, (err as Error).message);
      continue;
    }
    if (!doc) {
      console.warn(`[canvases] 跳过形状不合法的画布文件: ${name}`);
      continue;
    }
    out.push({
      id: doc.id || id,
      title: doc.title || id,
      locked: !!doc.locked,
      graphRef: "inline",
      coverKey: doc.coverKey ?? null,
      version: doc.version ?? 0,
      updatedAt: doc.updatedAt ?? "",
      nodeCount: countOf(doc.graph?.nodes),
      edgeCount: countOf(doc.graph?.edges),
      writable: true,
    });
  }
  return out;
}

export interface NodePatch {
  nodeId: string;
  /** 浅合并进 node.data（与前端 UpdateNodeDataCommand 同语义） */
  data?: Record<string, unknown>;
  title?: string;
  position?: { x: number; y: number };
}

export interface PatchCanvasResult {
  written: boolean;
  canvasId: string;
  patchedNodeIds: string[];
  nodeCount: number;
  edgeCount: number;
  before: CanvasDocument | null;
  after: CanvasDocument;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 节点级补丁（**只改副本；1 号一律拒绝**）：
 * - 不做结构性增删节点/连线（那是前端命令语义，外部裸写容易造坏图）；
 * - 任一 nodeId 不存在 → 整体不写并回 missingNodeIds（禁止半套补丁落盘）。
 */
export async function patchCanvasNodes(
  root: string,
  projectId: string,
  canvasId: string,
  opts: { patches: NodePatch[]; dryRun?: boolean },
): Promise<PatchCanvasResult> {
  assertSafeCanvasId(canvasId);
  if (canvasId === MAIN_CANVAS_ID) {
    throw new McpError(
      "VALIDATION",
      "1 号主画布对 MCP 只读：它由前端防抖自动保存，外部写入会互相覆盖。请改副本画布或在前端 UI 里编辑 1 号。",
      { canvasId },
    );
  }
  if (opts.patches.length === 0) {
    throw new McpError("VALIDATION", "patches 为空：没有要改的节点就别调用本工具");
  }
  const existing = await getCanvas(root, projectId, canvasId);
  if (!existing) throw new McpError("NOT_FOUND", `画布不存在: ${projectId}/${canvasId}`, { projectId, canvasId });

  const nodes = Array.isArray(existing.graph?.nodes) ? (existing.graph!.nodes as unknown[]) : [];
  const ids = new Set<string>();
  for (const raw of nodes) {
    const r = rec(raw);
    if (r && typeof r.id === "string") ids.add(r.id);
  }
  const missing = opts.patches.map((p) => p.nodeId).filter((nodeId) => !ids.has(nodeId));
  if (missing.length > 0) {
    throw new McpError("VALIDATION", `画布内不存在这些节点，未做任何修改: ${missing.join(", ")}`, {
      missingNodeIds: missing,
      canvasId,
    });
  }

  const res = await updateUnversionedJson<CanvasDocument>(paths.canvas(projectId, canvasId, root), {
    dryRun: opts.dryRun,
    mutate: (current) => {
      const doc = current ?? existing;
      const list = Array.isArray(doc.graph?.nodes) ? (doc.graph!.nodes as unknown[]) : [];
      const nextNodes = list.map((raw) => {
        const r = rec(raw);
        if (!r || typeof r.id !== "string") return raw;
        const patch = opts.patches.find((p) => p.nodeId === r.id);
        if (!patch) return raw;
        const merged: Record<string, unknown> = { ...r };
        if (patch.data) merged.data = { ...(rec(r.data) ?? {}), ...patch.data };
        if (typeof patch.title === "string") merged.title = patch.title;
        if (patch.position) merged.position = patch.position;
        return merged;
      });
      return {
        ...doc,
        version: (doc.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        graph: { ...doc.graph, nodes: nextNodes },
      };
    },
  });

  const afterNodes = Array.isArray(res.after.graph?.nodes) ? res.after.graph!.nodes : [];
  const afterEdges = Array.isArray(res.after.graph?.edges) ? res.after.graph!.edges : [];
  return {
    written: res.written,
    canvasId,
    patchedNodeIds: opts.patches.map((p) => p.nodeId),
    nodeCount: afterNodes.length,
    edgeCount: afterEdges.length,
    before: res.before ?? null,
    after: res.after,
  };
}
