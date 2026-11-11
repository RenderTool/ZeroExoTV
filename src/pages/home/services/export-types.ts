/**
 * 导出/导入共享类型
 *
 * ZIP 结构:
 * - projects.json: CanvasExportFile 序列化
 * - files/{storageKey}.{ext}: 二进制素材文件
 *
 * 每个项目含 meta(元数据)+ graph(图数据)+ files(素材清单)
 */

import type { CanvasProjectMeta } from '@zeroexo/plugin-persistence';
import type { GraphModel } from '@zeroexo/core';
import type { CanvasDocument } from '@/entities/canvas-store.js';

/** 导出文件根结构 */
export interface CanvasExportFile {
  app: 'zeroexo-canvas';
  /** v1 = 画布 + 素材；v2 = 追加剧本 / 主体 / 导演台 / 资产记录与阅读用 MD */
  version: 1 | 2;
  exportedAt: string;
  projects: CanvasProjectExportItem[];
}

/**
 * v2 项目文档清单（ZIP 内路径）。
 * MD 是阅读视图，导入一律以同名无损 JSON 为准；全部可选以兼容 v1 旧包。
 */
export interface CanvasProjectDocuments {
  scriptJson?: string;
  scriptMarkdown: string[];
  subjectsJson?: string;
  subjectsMarkdown: string[];
  workbenchJson?: string;
  assetsJson?: string;
}

/** 单个项目的导出项 */
export interface CanvasProjectExportItem {
  meta: CanvasProjectMeta;
  graph: GraphModel | null;
  files: CanvasExportAsset[];
  /** v2：剧本 / 主体 / 导演台 / 资产的文档路径索引 */
  documents?: CanvasProjectDocuments;
  /**
   * Spec（征集#184）：项目内的**副本画布**文档（权威数据 = projects/<pid>/canvases/*.json）。
   * 1 号主画布不在此列——它就是上面的 `graph`。旧文件无此字段 = 无副本。
   */
  canvases?: CanvasDocument[];
}

/** 素材文件清单项(storageKey → ZIP 内路径映射) */
export interface CanvasExportAsset {
  storageKey: string;
  path: string;
  mimeType: string;
  bytes: number;
}
