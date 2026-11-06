/**
 * 项目列表与项目概览。
 * 事实源：.lf/zeroexo/app_meta/projects.json，信封格式 {__lf:1, value: CanvasProjectMeta[]}
 * （对齐 packages/plugins/persistence-localforage/src/project-store.ts:63-77
 *   与 src/platform/disk-driver.ts:73-84 的信封约定）。
 * create_project 只追加 meta + 建目录骨架，不写 graph 信封（留前端首开自建）。
 */

import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { paths } from "../config.js";
import { readJsonIfExists, updateUnversionedJson, fileStat } from "./fs-node.js";

export interface CanvasProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl?: string | null;
  tags: string[];
  nodeCount: number;
  version: number;
  cloudId?: string | null;
  lastSyncedAt?: string | null;
}

interface ProjectsEnvelope {
  __lf: 1;
  value: CanvasProjectMeta[];
}

export async function readProjectsMeta(root: string): Promise<CanvasProjectMeta[]> {
  const env = await readJsonIfExists<ProjectsEnvelope>(paths.projectsMeta(root));
  return env?.value ?? [];
}

export interface ProjectOverview extends CanvasProjectMeta {
  entitiesReady: { script: boolean; storyboard: boolean; workbench: boolean };
  casFileCount: number;
}

export async function getProjectOverview(root: string, projectId: string): Promise<ProjectOverview> {
  const metas = await readProjectsMeta(root);
  const meta = metas.find((m) => m.id === projectId);
  if (!meta) throw new McpError("NOT_FOUND", `项目不存在: ${projectId}`, { projectId });

  const [script, storyboard, workbench] = await Promise.all([
    fileStat(paths.script(projectId, root)),
    fileStat(paths.storyboard(projectId, root)),
    fileStat(paths.workbench(projectId, root)),
  ]);
  let casFileCount = 0;
  try {
    casFileCount = (await fs.readdir(paths.casDir(root))).length;
  } catch {
    /* cas 目录可能不存在 */
  }
  return {
    ...meta,
    entitiesReady: { script: script !== null, storyboard: storyboard !== null, workbench: workbench !== null },
    casFileCount,
    assetPaths: {
      entitiesDir: paths.entitiesDir(projectId, root),
      casDir: paths.casDir(root),
      casIndex: paths.casIndex(root),
    },
  } as ProjectOverview;
}

export async function createProject(
  root: string,
  input: { title: string; tags?: string[] },
): Promise<CanvasProjectMeta> {
  const now = new Date().toISOString();
  const meta: CanvasProjectMeta = {
    id: crypto.randomBytes(9).toString("base64url"),
    title: input.title,
    createdAt: now,
    updatedAt: now,
    thumbnailUrl: null,
    tags: input.tags ?? [],
    nodeCount: 0,
    version: 1,
    cloudId: null,
    lastSyncedAt: null,
  };
  await updateUnversionedJson<ProjectsEnvelope>(paths.projectsMeta(root), {
    mutate: (env) => ({ __lf: 1, value: [...(env?.value ?? []), meta] }),
  });
  await fs.mkdir(paths.entitiesDir(meta.id, root), { recursive: true });
  return meta;
}
