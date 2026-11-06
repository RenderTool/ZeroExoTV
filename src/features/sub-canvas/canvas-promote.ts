/**
 * canvas-promote - 「副本独立成新项目」（Plan#84，2026-11-06）
 *
 * 用户原话：“也可以随时独立成新项目变成 1 号画布”。
 *
 * 做法：`createProject` 拿新 meta → `saveProjectGraph(newId, 副本 graph)` → 封面写进
 * `graph.metadata.coverUrl` + `meta.thumbnailUrl`（与主页项目同一对字段，不另造一套封面来源）。
 *
 * **素材 key 不重写**（Q3 已拍：不物理复制，用户原话“现在都是测试数据，直接全部清理”）：
 * 副本里的 `image:assets/<原pid>/...` 在新项目里照样解析（同一数据根），但物理上仍属原项目目录；
 * 要真搬走请走已测的导出/导入链路（`import-projects.ts` 会 remap storageKey 并搬 blob），
 * 本模块不重复实现第二套搬家逻辑。**UI 必须在确认弹窗里把这点写明白。**
 */
import { createProject, saveProjectGraph, updateProject } from '@zeroexo/plugin-persistence';
import { getCanvas } from '@/entities/canvas-store.js';

export interface PromoteCanvasResult {
  newProjectId: string;
  title: string;
  nodeCount: number;
  edgeCount: number;
}

/** 副本 → 新项目（成为该新项目的 1 号画布）；副本本身仍留在原项目里，删不删由用户决定 */
export async function promoteCanvasToProject(
  projectId: string,
  cid: string,
): Promise<PromoteCanvasResult> {
  const loaded = await getCanvas(projectId, cid);
  if (!loaded) throw new Error(`画布副本不存在或文件缺失: ${projectId}/${cid}`);
  if (loaded.doc.graphRef === 'project') {
    throw new Error('1 号主画布已经是一个独立项目，无需再独立');
  }
  const nodes = Array.isArray(loaded.graph.nodes) ? loaded.graph.nodes : [];
  const edges = Array.isArray(loaded.graph.edges) ? loaded.graph.edges : [];

  const meta = await createProject({ title: loaded.doc.title });
  await saveProjectGraph(meta.id, {
    ...loaded.graph,
    nodes,
    edges,
    metadata: {
      ...(loaded.graph.metadata ?? {}),
      ...(loaded.doc.coverKey ? { coverUrl: loaded.doc.coverKey } : {}),
    },
  });
  await updateProject(meta.id, {
    ...(loaded.doc.coverKey ? { thumbnailUrl: loaded.doc.coverKey } : {}),
    nodeCount: nodes.length,
  });

  return {
    newProjectId: meta.id,
    title: meta.title ?? loaded.doc.title,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}
