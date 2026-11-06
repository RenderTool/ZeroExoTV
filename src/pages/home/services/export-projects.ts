/**
 * ZIP 导出
 *
 * 流程:
 * 1. 遍历选中项目,加载 graph + 收集 storageKey
 * 2. 从 image_files / media_files 桶获取 blob
 * 3. 构造 projects.json + files/ 目录
 * 4. fflate.zipSync 打包 → 浏览器下载
 */

import type { GraphModel } from '@zeroexo/core';
import {
  getImageBlob,
  getMediaBlob,
  listProjects,
  collectImageStorageKeys,
  collectMediaStorageKeys,
  loadProjectGraph,
} from '@zeroexo/plugin-persistence';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import { createZip } from './zip.js';
import { getMediaBlob as getDiskBlob } from '@/platform/media.js';
import { verifySnapshotForExport } from '@/entities/snapshot-store.js';
import { readStoryboardContainer, readWorkbenchContainer } from '@/entities/slot-containers.js';
// Spec（征集#184）：副本画布必须随项目导出（否则 zip 恢复后标签指向不存在的画布）
import { getCanvas, listCanvases, MAIN_CANVAS_ID, type CanvasDocument } from '@/entities/canvas-store.js';
import type { CanvasExportAsset, CanvasExportFile, CanvasProjectExportItem } from './export-types.js';

/** 导出前快照只读校验（storyboard/workbench）：最近一份快照存在且 hash 可比对（只 log） */
async function verifyContainersSnapshotsForExport(projectId: string): Promise<void> {
  try {
    const storyboard = await readStoryboardContainer(projectId);
    if (storyboard) await verifySnapshotForExport(projectId, 'storyboard', storyboard);
    const workbench = await readWorkbenchContainer(projectId);
    if (workbench) await verifySnapshotForExport(projectId, 'workbench', workbench);
  } catch (err) {
    console.error('[export-projects] snapshot export check failed (continue export):', err);
  }
}

/**
 * 导出选中项目为 ZIP 并触发下载
 * @param projectIds 要导出的项目 id 数组
 * @param fileName 下载文件名(不含扩展名)
 */
export async function exportProjects(
  projectIds: string[],
  fileName = 'zeroexo-canvas',
): Promise<void> {
  if (projectIds.length === 0) return;

  // 获取项目元数据(按传入顺序)
  const allProjects = await listProjects();
  const projectMap = new Map(allProjects.map((p) => [p.id, p]));
  const projects = projectIds
    .map((id) => projectMap.get(id))
    .filter((p): p is CanvasProjectMeta => p !== undefined);

  if (projects.length === 0) return;

  // 导出前只读校验（2026-11-04 快照库）：导演台实体（storyboard/workbench）最近一份快照
  // 存在且 hash 可比对——只打 log 不阻断导出（本轮无 UI 恢复入口，防误触）。
  for (const project of projects) {
    void verifyContainersSnapshotsForExport(project.id);
  }

  const zipFiles: { name: string; data: BlobPart }[] = [];
  const exportItems = await Promise.all(
    projects.map(async (project) => {
      const graph = await loadProjectGraph(project.id);
      const files = await collectProjectFiles(project.id, graph, zipFiles, project.thumbnailUrl);
      // Spec：副本画布 + 其内部素材一并收集（1 号已是上面的 graph，不重复）
      const sub = await collectCanvasCopies(project.id, zipFiles);
      const item: CanvasProjectExportItem = {
        meta: project,
        graph,
        files: [...files, ...sub.assets],
        ...(sub.docs.length > 0 ? { canvases: sub.docs } : {}),
      };
      return item;
    }),
  );

  const data: CanvasExportFile = {
    app: 'zeroexo-canvas',
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: exportItems,
  };

  zipFiles.unshift({
    name: 'projects.json',
    data: JSON.stringify(data, null, 2),
  });

  const zip = await createZip(zipFiles);
  triggerDownload(zip, `${safeFileName(fileName)}.zip`);
}

/**
 * 收集单个项目的所有素材文件
 * @param projectId 项目 id(用于 ZIP 内路径隔离)
 * @param graph 图数据(从中提取 storageKey)
 * @param zipFiles 累积写入的 ZIP 文件列表
 * @returns 素材文件清单
 */
async function collectProjectFiles(
  projectId: string,
  graph: GraphModel | null,
  zipFiles: { name: string; data: BlobPart }[],
  coverKey?: string | null,
): Promise<CanvasExportAsset[]> {
  // 本地版（Plan#83）：封面存在 graph.metadata.coverUrl 与 meta.thumbnailUrl，
  // 键名不是 storageKey、递归扫描抓不到 → 显式并入，保证 zip 里封面跟随项目
  const keys = new Set<string>();
  const metaCover = (graph?.metadata as { coverUrl?: string } | undefined)?.coverUrl;
  if (metaCover && metaCover.startsWith('image:')) keys.add(metaCover);
  if (coverKey && coverKey.startsWith('image:')) keys.add(coverKey);

  if (graph) {
    collectImageStorageKeys(graph, keys);
    collectMediaStorageKeys(graph, keys);
  }
  if (keys.size === 0) return [];

  const files: CanvasExportAsset[] = [];
  await Promise.all(
    [...keys].map(async (storageKey) => {
      const blob = await blobForStorageKey(storageKey);
      if (!blob) return;
      const path = `files/${projectId}/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
      files.push({
        storageKey,
        path,
        mimeType: blob.type || 'application/octet-stream',
        bytes: blob.size,
      });
      zipFiles.push({ name: path, data: blob });
    }),
  );
  return files;
}

/**
 * 素材取用链（单一入口）：图片桶 → 媒体桶 → 磁盘 blob 兜底。
 * collectProjectFiles 与 collectSubCanvasAssets 共用，避免主/子两套取用逻辑分叉。
 */
async function blobForStorageKey(storageKey: string): Promise<Blob | null> {
  return (storageKey.startsWith('image:')
    ? await getImageBlob(storageKey)
    : await getMediaBlob(storageKey)) ?? await getDiskBlob(storageKey);
}

/**
 * Spec：收集项目的**副本画布**文档及其内部素材。
 * 未授权目录/读取失败 → 返回空集并记日志，**不阻断整个导出**（1 号画布仍能导出）。
 */
async function collectCanvasCopies(
  projectId: string,
  zipFiles: { name: string; data: BlobPart }[],
): Promise<{ docs: CanvasDocument[]; assets: CanvasExportAsset[] }> {
  const docs: CanvasDocument[] = [];
  const assets: CanvasExportAsset[] = [];
  try {
    const metas = await listCanvases(projectId);
    for (const meta of metas) {
      // 1 号不内嵌：它的图就是项目 graph（内嵌会造成两份图存同一项目）
      if (meta.id === MAIN_CANVAS_ID) continue;
      const got = await getCanvas(projectId, meta.id);
      if (!got || got.doc.graphRef !== 'inline' || !got.doc.graph) continue;
      docs.push(got.doc);
      const keys = new Set<string>();
      collectImageStorageKeys(got.graph, keys);
      collectMediaStorageKeys(got.graph, keys);
      for (const storageKey of keys) {
        const blob = await blobForStorageKey(storageKey);
        if (!blob) continue;
        const path = `files/${projectId}/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`;
        // 同一素材可能同时被 1 号与副本引用：路径相同 → 不重复写入 zip
        if (!zipFiles.some((f) => f.name === path)) {
          zipFiles.push({ name: path, data: blob });
          assets.push({ storageKey, path, mimeType: blob.type || 'application/octet-stream', bytes: blob.size });
        }
      }
    }
  } catch (err) {
    console.error('[export-projects] 副本画布收集失败（继续导出 1 号画布）:', err);
  }
  return { docs, assets };
}

/** 触发浏览器下载 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟 revoke,确保下载已启动
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化(移除非法字符) */
function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_');
}

/** 根据 mimeType 推断文件扩展名 */
function fileExtension(mimeType: string, storageKey: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('audio')) return 'm4a';
  return storageKey.startsWith('image:') ? 'png' : 'bin';
}
