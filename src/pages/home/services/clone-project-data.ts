/**
 * 复制项目的完整数据（S-22）
 *
 * `project-store.copyProject` 只写新 meta + 1 号主 graph；其余数据都按 projectId
 * 隔离在别处，不补就是「打开副本是空剧本/空主体/空导演台/空资产」。
 * 这里给首页与编辑器两条复制路径提供同一份克隆实现，消除双路径差异。
 *
 * CAS / image: 等二进制是内容寻址，跨项目共享同一份文件，不重复写盘。
 */
import { readJson, writeJson } from '@/platform/fs.js';
import { createCanvas, getCanvas, listCanvases, MAIN_CANVAS_ID } from '@/entities/canvas-store.js';
import { copyCanvasScript } from '@/services/canvas-script.js';
import { duplicateProjectAssets } from '@/features/asset-picker/asset-store.js';

const ENTITY_FILES = ['script.json', 'storyboard.json', 'workbench.json'] as const;

async function cloneEntities(sourceId: string, targetId: string): Promise<void> {
  await Promise.all(ENTITY_FILES.map(async (name) => {
    const value = await readJson<unknown>(`projects/${sourceId}/entities/${name}`);
    if (value === null || value === undefined) return;
    await writeJson(`projects/${targetId}/entities/${name}`, value);
  }));
}

async function cloneCanvases(sourceId: string, targetId: string): Promise<void> {
  const metas = await listCanvases(sourceId);
  for (const meta of metas) {
    // 1 号主画布就是项目 graph，已由 copyProject / 编辑器路径单独写入
    if (meta.id === MAIN_CANVAS_ID) continue;
    const got = await getCanvas(sourceId, meta.id);
    if (!got?.doc.graph || got.doc.graphRef !== 'inline') continue;
    await createCanvas(targetId, {
      id: got.doc.id,
      title: got.doc.title,
      graph: structuredClone(got.doc.graph),
      coverKey: got.doc.coverKey ?? null,
      order: got.doc.order,
    }).catch((err) => console.warn(`[clone-project] 副本画布 ${meta.id} 写入失败（跳过）:`, err));
  }
}

/** 复制源项目的实体三件套 / 副本画布 / 剧本资产 / 本项目资产记录到新项目 id 下 */
export async function cloneProjectData(sourceId: string, targetId: string, targetTitle: string): Promise<void> {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const results = await Promise.allSettled([
    cloneEntities(sourceId, targetId),
    cloneCanvases(sourceId, targetId),
    copyCanvasScript(sourceId, targetId, `${targetTitle} 剧本`),
    duplicateProjectAssets(sourceId, targetId),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.warn('[clone-project] 部分数据复制失败:', r.reason);
  }
}
