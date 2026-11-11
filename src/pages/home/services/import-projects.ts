/**
 * ZIP 导入（v2：还原画布 + 剧本 + 主体 + 导演台 + 资产/产出）
 *
 * 流程:
 * 1. 读取 ZIP → 解析 projects.json → 版本校验/迁移（v1 旧包仍可导入）
 * 2. 逐项目生成新 ID、重映射 storageKey；cas: 按内容 hash 原样写回，不用 nanoid
 * 3. 还原 graph / 副本画布 / 实体三件套 / 本项目资产记录
 * 4. 项目仍是「新建 + 追加」，不覆盖用户既有数据
 */
import { nanoid } from 'nanoid';
import type { GraphModel } from '@zeroexo/core';
import {
  setImageBlob,
  setMediaBlob,
  importProjects,
  saveProjectGraph,
  resolveImageUrl,
  resolveMediaUrl,
} from '@zeroexo/plugin-persistence';
import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import { readZip } from './zip.js';
import type { CanvasExportFile } from './export-types.js';
import { CURRENT_ZIP_VERSION, migrateExportFile } from './version-migration.js';
import { createCanvas, type CanvasDocument } from '@/entities/canvas-store.js';
import { writeJson } from '@/platform/fs.js';
import { putCas, parseCasStorageKey } from '@/entities/cas-store.js';
import { addAssets } from '@/features/asset-picker/asset-store.js';
import { ensureProjectMounts } from '@/entities/slot-containers.js';

interface RestoredEntities {
  /** 导出时的旧项目 id */
  oldId: string;
  keyMap: Map<string, string>;
  script: unknown;
  storyboard: unknown;
  workbench: unknown;
  assets: Array<Record<string, unknown>>;
}

interface CasToWrite {
  oldProjectId: string;
  blob: Blob;
  ext?: string;
  mime?: string;
}

/** 从 ZIP 里按路径读一份无损 JSON；缺失/损坏返回 null，不阻断导入 */
async function readDocument(zip: Map<string, Blob>, path?: string): Promise<unknown> {
  if (!path) return null;
  const file = zip.get(path);
  if (!file) return null;
  try {
    return JSON.parse(await file.text());
  } catch {
    console.warn(`[import-projects] 文档 ${path} 解析失败（跳过）`);
    return null;
  }
}

/**
 * 从 ZIP 文件导入项目
 * @param file 用户选择的 ZIP 文件
 * @returns 导入后的新项目数组(含新 ID)
 * @throws Error ZIP 格式版本不兼容时抛错
 */
export async function importProjectsFromZip(file: Blob): Promise<CanvasProjectMeta[]> {
  const zip = await readZip(file);
  const projectFile = zip.get('projects.json');
  if (!projectFile) throw new Error('ZIP 文件中缺少 projects.json');
  const raw = JSON.parse(await projectFile.text()) as CanvasExportFile;

  if (raw.version > CURRENT_ZIP_VERSION) {
    throw new Error(
      `ZIP 文件版本(v${raw.version})高于当前支持的最高版本(v${CURRENT_ZIP_VERSION})。` +
      `请更新应用程序后再导入此文件。`,
    );
  }
  const data = migrateExportFile(raw);
  if (data.version !== CURRENT_ZIP_VERSION) {
    throw new Error(`ZIP 文件版本迁移失败: 期望 v${CURRENT_ZIP_VERSION}，得到 v${data.version}`);
  }
  if (!data.projects || data.projects.length === 0) return [];

  const metasToImport: CanvasProjectMeta[] = [];
  const graphDataToSave: { projectId: string; graph: GraphModel }[] = [];
  const canvasesToSave: { projectId: string; docs: CanvasDocument[] }[] = [];
  const entitiesToRestore: RestoredEntities[] = [];
  const casToWrite: CasToWrite[] = [];

  for (const item of data.projects) {
    const keyMap = new Map<string, string>();
    for (const asset of item.files ?? []) {
      const blob = zip.get(asset.path);
      if (!blob) continue;
      const typedBlob = blob.type ? blob : blob.slice(0, blob.size, asset.mimeType);
      if (asset.storageKey.startsWith('cas:')) {
        // CAS 是内容寻址：文件名就是 sha256，换成 nanoid 会让主体图/产出全变死链
        keyMap.set(asset.storageKey, asset.storageKey);
        casToWrite.push({
          oldProjectId: item.meta.id,
          blob: typedBlob,
          ext: parseCasStorageKey(asset.storageKey)?.ext,
          mime: asset.mimeType,
        });
        continue;
      }
      const newKey = remapStorageKey(asset.storageKey);
      keyMap.set(asset.storageKey, newKey);
      if (newKey.startsWith('image:')) {
        await setImageBlob(newKey, typedBlob);
      } else {
        await setMediaBlob(newKey, typedBlob);
      }
    }

    const remappedGraph = item.graph ? await remapGraphStorageKeys(item.graph, keyMap) : null;
    const cleanMeta: CanvasProjectMeta = {
      ...item.meta,
      cloudId: null,
      version: 0,
      lastSyncedAt: null,
    };
    metasToImport.push(cleanMeta);
    if (remappedGraph) graphDataToSave.push({ projectId: cleanMeta.id, graph: remappedGraph });

    const zipCanvases = item.canvases ?? (item as { subCanvases?: CanvasDocument[] }).subCanvases;
    if (zipCanvases && zipCanvases.length > 0) {
      const docs: CanvasDocument[] = [];
      for (const doc of zipCanvases) {
        if (!doc.graph) {
          console.warn(`[import-projects] 副本画布 ${doc.id} 缺 graph（跳过）`);
          continue;
        }
        try {
          docs.push({ ...doc, graph: await remapGraphStorageKeys(doc.graph, keyMap) });
        } catch (err) {
          console.error(`[import-projects] 副本画布 ${doc.id} 重映射失败（跳过）:`, err);
        }
      }
      if (docs.length > 0) canvasesToSave.push({ projectId: cleanMeta.id, docs });
    }

    // v2：无损 JSON 是导入唯一依据，阅读用 MD 不参与还原
    if (item.documents) {
      const docs = item.documents;
      const [script, storyboard, workbench, assets] = await Promise.all([
        readDocument(zip, docs.scriptJson),
        readDocument(zip, docs.subjectsJson),
        readDocument(zip, docs.workbenchJson),
        readDocument(zip, docs.assetsJson),
      ]);
      entitiesToRestore.push({
        oldId: cleanMeta.id,
        keyMap,
        script,
        storyboard,
        workbench,
        assets: Array.isArray(assets) ? assets as Array<Record<string, unknown>> : [],
      });
    }
  }

  const importedProjects = await importProjects(metasToImport);
  const idMap = new Map(metasToImport.map((old, i) => [old.id, importedProjects[i]?.id]));

  for (const { projectId: oldId, graph } of graphDataToSave) {
    const newId = idMap.get(oldId);
    if (!newId) continue;
    await saveProjectGraph(newId, graph);
  }

  for (const { projectId: oldId, docs } of canvasesToSave) {
    const newId = idMap.get(oldId);
    if (!newId) continue;
    for (const doc of docs) {
      try {
        await createCanvas(newId, {
          id: doc.id,
          title: doc.title,
          graph: doc.graph as GraphModel,
          coverKey: doc.coverKey ?? null,
          order: doc.order,
        });
      } catch (err) {
        console.error(`[import-projects] 副本画布 ${doc.id} 写入失败（跳过）:`, err);
      }
    }
  }

  // CAS 物理文件与索引：按内容 hash 写回（同 hash 即同内容，重复导入自动去重）
  for (const entry of casToWrite) {
    const newId = idMap.get(entry.oldProjectId) ?? entry.oldProjectId;
    await putCas({
      data: entry.blob,
      ext: entry.ext,
      mime: entry.mime,
      ref: { assetId: `import-${nanoid()}`, projectId: newId, kind: 'project-import' },
    }).catch((err) => console.warn('[import-projects] CAS 写回失败:', err));
  }

  // 剧本 / 主体库 / 导演台 / 资产记录：挂到新项目 id 下
  for (const entity of entitiesToRestore) {
    const newId = idMap.get(entity.oldId);
    if (!newId) continue;
    const remap = <T,>(value: T): T => remapObject(value, entity.keyMap);
    try {
      if (entity.script) await writeJson(`projects/${newId}/entities/script.json`, entity.script);
      if (entity.storyboard) await writeJson(`projects/${newId}/entities/storyboard.json`, remap(entity.storyboard));
      if (entity.workbench) await writeJson(`projects/${newId}/entities/workbench.json`, remap(entity.workbench));
      if (entity.assets.length > 0) {
        const mapped = entity.assets.map((asset) => ({ ...remap(asset), projectId: newId }));
        await addAssets(mapped as unknown as Parameters<typeof addAssets>[0]);
      }
      // 缺省实体兜底：ensure 只在文件不存在时创建，不会覆盖上面刚写入的数据
      await ensureProjectMounts(newId);
    } catch (err) {
      console.error(`[import-projects] 项目 ${newId} 实体还原失败:`, err);
    }
  }

  return importedProjects;
}

/** 重映射 storageKey（保留前缀，生成新 ID 部分；cas: 不走这里） */
function remapStorageKey(oldKey: string): string {
  const prefix = oldKey.split(':')[0];
  return `${prefix}:${nanoid()}`;
}

async function remapGraphStorageKeys(graph: GraphModel, keyMap: Map<string, string>): Promise<GraphModel> {
  const remappedNodes = await Promise.all(graph.nodes.map((node) => remapNode(node, keyMap)));
  return {
    nodes: remappedNodes,
    edges: graph.edges.map((edge) => remapObject(edge, keyMap) as typeof edge),
    viewport: graph.viewport,
    metadata: remapObject(graph.metadata, keyMap) as typeof graph.metadata,
  };
}

async function remapNode(node: GraphModel['nodes'][number], keyMap: Map<string, string>): Promise<GraphModel['nodes'][number]> {
  const remapped = remapObject(node, keyMap) as GraphModel['nodes'][number];
  const data = remapped.data as Record<string, unknown> | undefined;
  if (data?.storageKey && typeof data.storageKey === 'string') {
    const newStorageKey = data.storageKey;
    let content: string | undefined;
    if (newStorageKey.startsWith('image:')) content = await resolveImageUrl(newStorageKey);
    else if (newStorageKey.startsWith('video:') || newStorageKey.startsWith('audio:')) content = await resolveMediaUrl(newStorageKey);
    if (content) data.content = content;
  }
  return remapped;
}

/**
 * 深度遍历替换 storage key。
 * 主体树的 media[].key / coverKey / deriveFrom.mediaKey 与资产记录的字段名各不相同，
 * 按字段名集合 + 值必须在 keyMap 中双重判定，避免误伤普通 key 字段。
 */
const REMAPPED_FIELDS = new Set([
  'storageKey', 'key', 'coverKey', 'mediaKey', 'assetStorageKey', 'coverStorageKey',
]);

function remapObject<T>(obj: T, keyMap: Map<string, string>): T {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => remapObject(item, keyMap)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (REMAPPED_FIELDS.has(key) && typeof value === 'string' && keyMap.has(value)) {
      result[key] = keyMap.get(value);
    } else if (value && typeof value === 'object') {
      result[key] = remapObject(value, keyMap);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
