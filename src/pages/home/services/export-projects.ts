/**
 * ZIP 导出（v2：画布 + 剧本 + 主体 + 导演台 + 资产/产出 + 阅读用 MD）
 *
 * 流程:
 * 1. 遍历选中项目，加载 graph + 实体三件套 + 本项目资产记录
 * 2. 生成阅读用 Markdown 与无损 JSON，写进 ZIP；收集所有 storageKey 的二进制
 * 3. 构造 projects.json（含文档路径索引）+ files/ 目录
 * 4. fflate.zipSync 打包 → 浏览器下载
 *
 * v2 之前只导 graph 与它引用的素材，剧本/主体/导演台/产出记录全丢，无法迁移。
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
import type { StoryboardContainer } from '@/entities/slot-containers.js';
import { readScript } from '@/entities/script-store.js';
import type { ScriptEntity } from '@/entities/script-store.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { getCanvas, listCanvases, MAIN_CANVAS_ID, type CanvasDocument } from '@/entities/canvas-store.js';
import { collectStorageKeys, scriptEntityToMarkdown, storyboardToSubjectMarkdown } from './project-documents.js';
import type {
  CanvasExportAsset, CanvasExportFile, CanvasProjectDocuments, CanvasProjectExportItem,
} from './export-types.js';

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

interface ProjectEntities {
  script: ScriptEntity | null;
  storyboard: StoryboardContainer | null;
  workbench: unknown;
  assets: Asset[];
}

type ZipFiles = { name: string; data: BlobPart }[];

function pushJson(zipFiles: ZipFiles, path: string, value: unknown): void {
  zipFiles.push({ name: path, data: JSON.stringify(value, null, 2) });
}

/**
 * v2 项目文档：阅读用 MD + 无损 JSON。
 * MD 供人阅读/比对，导入一律读 JSON；两者按项目 id 分目录，避免多项目同名覆盖。
 */
function collectProjectDocuments(
  projectId: string,
  entities: ProjectEntities,
  zipFiles: ZipFiles,
): CanvasProjectDocuments {
  const docs: CanvasProjectDocuments = { scriptMarkdown: [], subjectsMarkdown: [] };
  if (entities.script) {
    const jsonPath = `script/${projectId}/script.json`;
    pushJson(zipFiles, jsonPath, entities.script);
    docs.scriptJson = jsonPath;
    for (const doc of scriptEntityToMarkdown(entities.script)) {
      const path = `script/${projectId}/${doc.path}`;
      zipFiles.push({ name: path, data: doc.content });
      docs.scriptMarkdown.push(path);
    }
  }
  if (entities.storyboard) {
    const jsonPath = `subjects/${projectId}/subjects.json`;
    pushJson(zipFiles, jsonPath, entities.storyboard);
    docs.subjectsJson = jsonPath;
    for (const doc of storyboardToSubjectMarkdown(entities.storyboard)) {
      const path = `subjects/${projectId}/${doc.path}`;
      zipFiles.push({ name: path, data: doc.content });
      docs.subjectsMarkdown.push(path);
    }
  }
  if (entities.workbench) {
    const path = `entities/${projectId}/workbench.json`;
    pushJson(zipFiles, path, entities.workbench);
    docs.workbenchJson = path;
  }
  if (entities.assets.length > 0) {
    const path = `assets/${projectId}/assets.json`;
    pushJson(zipFiles, path, entities.assets);
    docs.assetsJson = path;
  }
  return docs;
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

  for (const project of projects) {
    void verifyContainersSnapshotsForExport(project.id);
  }

  const zipFiles: ZipFiles = [];
  const exportItems = await Promise.all(
    projects.map(async (project) => {
      const graph = await loadProjectGraph(project.id);
      // 单个实体读失败不阻断整个导出（目录未授权/文件缺失时仍导出画布）
      const [script, storyboard, workbench, allAssets] = await Promise.all([
        readScript(project.id).catch(() => null),
        readStoryboardContainer(project.id).catch(() => null),
        readWorkbenchContainer(project.id).catch(() => null),
        listAssets().catch((): Asset[] => []),
      ]);
      const entities: ProjectEntities = {
        script,
        storyboard,
        workbench,
        assets: allAssets.filter((a) => a.projectId === project.id),
      };
      const documents = collectProjectDocuments(project.id, entities, zipFiles);
      // 主体图 / 产出 CAS 不在 graph 里，必须单独并入二进制清单
      const extraKeys = collectStorageKeys([storyboard, workbench, entities.assets]);
      const files = await collectProjectFiles(project.id, graph, zipFiles, project.thumbnailUrl, extraKeys);
      const sub = await collectCanvasCopies(project.id, zipFiles);
      const item: CanvasProjectExportItem = {
        meta: project,
        graph,
        files: [...files, ...sub.assets],
        ...(sub.docs.length > 0 ? { canvases: sub.docs } : {}),
        documents,
      };
      return item;
    }),
  );

  const data: CanvasExportFile = {
    app: 'zeroexo-canvas',
    version: 2,
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
 * @param extraKeys v2：实体（主体树/导演台/资产记录）里引用的 storageKey
 */
async function collectProjectFiles(
  projectId: string,
  graph: GraphModel | null,
  zipFiles: ZipFiles,
  coverKey?: string | null,
  extraKeys: Set<string> = new Set(),
): Promise<CanvasExportAsset[]> {
  const keys = new Set<string>(extraKeys);
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
 * 素材取用链（单一入口）：图片桶 → 媒体桶 → 磁盘 blob 兜底（cas: 走这里读 media/cas/）。
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
  zipFiles: ZipFiles,
): Promise<{ docs: CanvasDocument[]; assets: CanvasExportAsset[] }> {
  const docs: CanvasDocument[] = [];
  const assets: CanvasExportAsset[] = [];
  try {
    const metas = await listCanvases(projectId);
    for (const meta of metas) {
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名安全化(移除非法字符) */
function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_');
}

/** 根据 mimeType 推断文件扩展名；cas: 键自带扩展名时优先用它 */
function fileExtension(mimeType: string, storageKey: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('audio')) return 'm4a';
  const fromKey = /\.([a-z0-9]+)$/i.exec(storageKey)?.[1];
  return fromKey ?? (storageKey.startsWith('image:') ? 'png' : 'bin');
}
