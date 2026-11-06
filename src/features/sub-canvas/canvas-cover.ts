/**
 * canvas-cover - 画布副本封面（复用主页项目同一套封面机制，2026-11-06）
 *
 * 用户要求副本列表"卡片形式和主页一致，也可以编辑封面"——所以**不另造一套封面**，
 * 直接复用 `platform/cover.ts`（`setProjectCover` 落盘/回落桶 + `resolveCoverUrl` 出图 +
 * `deleteCoverImage` 清旧），副本只把 key 记在自己的画布元数据里（`CanvasDocument.coverKey`）。
 */
import { deleteCoverImage, setProjectCover } from '@/platform/cover.js';
import { getCanvas, saveCanvas } from '@/entities/canvas-store.js';

/**
 * 换封面：写图 → 更新 coverKey → 删旧封面文件（顺序与主页 handleCoverConfirm 一致，
 * 反了会先把还在用的图删掉）。返回新 key。
 */
export async function replaceCanvasCover(
  projectId: string,
  cid: string,
  file: File,
): Promise<string> {
  const loaded = await getCanvas(projectId, cid);
  if (!loaded) throw new Error(`画布不存在: ${projectId}/${cid}`);
  const nextKey = await setProjectCover(projectId, file);
  await saveCanvas(projectId, cid, { coverKey: nextKey }, loaded.stamp);
  const prev = loaded.doc.coverKey;
  // 自动封面指向的是节点素材本体，删了会把画布里的图一起删掉 → 只删"上传型"封面文件
  if (prev && prev !== nextKey && !isNodeAsset(loaded.graph, prev)) {
    await deleteCoverImage(prev).catch((err) => console.warn('[canvas-cover] 旧封面清理失败（忽略）:', err));
  }
  return nextKey;
}

/** 该 key 是否仍是画布里某个节点的素材本体（是 → 绝不能删） */
function isNodeAsset(graph: { nodes?: unknown[] } | null | undefined, key: string): boolean {
  const nodes = Array.isArray(graph?.nodes) ? graph!.nodes : [];
  return nodes.some((n) => (n as { data?: { storageKey?: unknown } }).data?.storageKey === key);
}
