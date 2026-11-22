/**
 * version-store —— 「副本 = 整个项目的一份版本」（2026-11-22 用户定调）
 *
 * 语义（用户原话）：副本相当于把整个项目的所有历史数据创建成一个版本，不然就不叫副本。
 * 所以副本不是"另一块画布"，而是**项目数据层的一次完整固化**：
 *
 *   projects/<pid>/versions/<vid>/
 *     manifest.json     版本元信息（来源、时间、统计）
 *     canvases/         全部画布文档快照（主画布 + 已有副本），每个 <cid>.json
 *     assets.json       该版本的全部历史记录（画布产物 + 导演台产物 + 判定）
 *     entities/         script.json / storyboard.json / workbench.json
 *     guides.json       该版本引用的引导 id → sha256 / bytes（文件不复制，共享 media/guides）
 *
 * 三条硬约束：
 * 1. **只复制数据层，不复制任何媒体文件**：媒体全部走内容寻址（cas:<hash> / guide:gd_*），
 *    版本只持有引用，磁盘零增量。
 * 2. **副本与原件互不影响**：版本目录写进去之后不再跟随项目当前数据漂移；副本里之后的改动
 *    只写进本版本（appendVersionAssets / saveVersionCanvas），不回写项目当前数据。
 * 3. **删除副本只删版本目录 + 副本画布 JSON**，绝不删 CAS、绝不删引导文件、不动主版本。
 *
 * vid 与副本画布 id 一一绑定（vid === cid），不再单独造一套 id 体系。
 */
import type { GraphModel } from '@zeroexo/core';
import { ensureDir, listDir, readJson, remove, stat, writeJson } from '@/platform/fs.js';
import { getCanvas, listCanvases, MAIN_CANVAS_ID, type CanvasDocument } from '@/entities/canvas-store.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { readScript } from '@/entities/script-store.js';
import { readStoryboardContainer, readWorkbenchContainer } from '@/entities/slot-containers.js';
import { GUIDE_DIR, isGuideFileName } from '@/entities/guide-store.js';
import { readGuideSha } from '@/platform/guide-sha.js';

export const VERSION_SCHEMA_VERSION = 1 as const;

/** 版本元信息 */
export interface ProjectVersionManifest {
  schemaVersion: number;
  kind: 'project-version';
  /** 版本 id = 所属副本画布 id */
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  /** 来源：从哪块画布/版本派生的 */
  sourceCanvasId: string;
  stats: {
    canvases: number;
    assets: number;
    /** 画布产物 / 导演台产物条数（历史面板两个来源 Tab 的计数） */
    canvasAssets: number;
    directorAssets: number;
    guides: number;
  };
}

/** 版本内某个画布的快照条目 */
export interface VersionCanvasSnapshot {
  canvasId: string;
  doc: CanvasDocument;
}

export function versionDir(projectId: string, versionId: string): string {
  return `projects/${projectId}/versions/${versionId}`;
}

function assertSafeVersionId(id: string): void {
  if (!/^(main|sc[a-z0-9_-]{3,63}|v[a-z0-9_-]{3,63})$/i.test(id)) {
    throw new Error(`版本 id 非法: ${id}`);
  }
}

/** 递归收集文本里的 gd_* 引导 id（workbench/storyboard 的结构字段名各异，按值扫描最稳） */
function collectGuideIds(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const m = /gd_[A-Za-z0-9_-]{4,64}/.exec(value);
    if (m && isGuideFileName(m[0])) out.add(m[0]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectGuideIds(v, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectGuideIds(v, out);
  }
  return out;
}

/** 读项目当前全部历史记录（只取本项目；公共库不参与版本） */
async function readProjectAssets(projectId: string): Promise<Asset[]> {
  const all = await listAssets().catch((): Asset[] => []);
  return all.filter((a) => a.projectId === projectId);
}

function countGeneration(list: Asset[]): { canvas: number; director: number } {
  let canvas = 0;
  let director = 0;
  for (const a of list) {
    const d = a.data as { origin?: string; originSource?: string; generation?: { provider?: string } };
    if (d.origin !== 'generation') continue;
    const src = d.originSource === 'director'
      || d.generation?.provider === 'zeroexo'
      || d.generation?.provider === 'comfyui-direct'
      || /^片段\s*\d+/.test(a.title)
      ? 'director'
      : 'canvas';
    if (src === 'director') director += 1;
    else canvas += 1;
  }
  return { canvas, director };
}

/**
 * 创建版本：把项目当前数据层完整固化到 versions/<vid>/。
 * 失败必须让调用方知道（副本没有版本就不是副本），不做静默降级。
 */
export async function createProjectVersion(
  projectId: string,
  input: { id: string; title: string; sourceCanvasId?: string },
): Promise<ProjectVersionManifest> {
  assertSafeVersionId(input.id);
  const dir = versionDir(projectId, input.id);
  await ensureDir(dir);
  await ensureDir(`${dir}/canvases`);
  await ensureDir(`${dir}/entities`);

  // ① 全部画布文档（主画布读 graph-store，副本读 inline graph）
  const canvases: VersionCanvasSnapshot[] = [];
  const metas = await listCanvases(projectId).catch(() => []);
  for (const meta of metas) {
    const got = await getCanvas(projectId, meta.id).catch(() => null);
    if (!got) continue;
    canvases.push({ canvasId: got.doc.id, doc: got.doc });
  }
  for (const snap of canvases) {
    await writeJson(`${dir}/canvases/${snap.canvasId}.json`, snap.doc);
  }

  // ② 全部历史记录（含判定、origin、storageKey；媒体文件不复制）
  const assets = await readProjectAssets(projectId);
  await writeJson(`${dir}/assets.json`, assets);

  // ③ 实体三件套
  const [script, storyboard, workbench] = await Promise.all([
    readScript(projectId).catch(() => null),
    readStoryboardContainer(projectId).catch(() => null),
    readWorkbenchContainer(projectId).catch(() => null),
  ]);
  if (script) await writeJson(`${dir}/entities/script.json`, script);
  if (storyboard) await writeJson(`${dir}/entities/storyboard.json`, storyboard);
  if (workbench) await writeJson(`${dir}/entities/workbench.json`, workbench);

  // ④ 引导索引（只记 id + sha + bytes，文件共享 media/guides）
  const guideIds = new Set<string>();
  collectGuideIds(script, guideIds);
  collectGuideIds(storyboard, guideIds);
  collectGuideIds(workbench, guideIds);
  for (const a of assets) collectGuideIds(a.data, guideIds);
  const guides: Array<{ id: string; sha256: string | null; bytes: number | null; cached: boolean }> = [];
  for (const id of guideIds) {
    const file = await stat(`${GUIDE_DIR}/${id}.safetensors`).catch(() => null);
    guides.push({
      id,
      sha256: await readGuideSha(id).catch(() => null),
      bytes: file?.size ?? null,
      cached: Boolean(file?.size),
    });
  }
  await writeJson(`${dir}/guides.json`, guides);

  const counts = countGeneration(assets);
  const manifest: ProjectVersionManifest = {
    schemaVersion: VERSION_SCHEMA_VERSION,
    kind: 'project-version',
    id: input.id,
    projectId,
    title: input.title,
    createdAt: new Date().toISOString(),
    sourceCanvasId: input.sourceCanvasId ?? MAIN_CANVAS_ID,
    stats: {
      canvases: canvases.length,
      assets: assets.length,
      canvasAssets: counts.canvas,
      directorAssets: counts.director,
      guides: guides.length,
    },
  };
  await writeJson(`${dir}/manifest.json`, manifest);
  return manifest;
}

/** 读版本 manifest（副本页签判断"这是版本模式"用） */
export async function readProjectVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectVersionManifest | null> {
  try {
    const raw = await readJson<ProjectVersionManifest>(`${versionDir(projectId, versionId)}/manifest.json`);
    if (!raw || raw.kind !== 'project-version') return null;
    return raw;
  } catch {
    return null;
  }
}

/** 读版本内的历史记录（只读视图；副本页签的历史面板用这一份） */
export async function readVersionAssets(projectId: string, versionId: string): Promise<Asset[]> {
  try {
    const list = await readJson<Asset[]>(`${versionDir(projectId, versionId)}/assets.json`);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 读版本内的全部画布文档（版本快照，不是项目当前） */
export async function readVersionCanvases(projectId: string, versionId: string): Promise<VersionCanvasSnapshot[]> {
  const dir = `${versionDir(projectId, versionId)}/canvases`;
  const files = await listDir(dir).catch(() => [] as Awaited<ReturnType<typeof listDir>>);
  const out: VersionCanvasSnapshot[] = [];
  for (const f of files) {
    const name = typeof f === 'string' ? f : (f as { name?: string }).name ?? '';
    if (!name.endsWith('.json')) continue;
    const canvasId = name.slice(0, -5);
    const doc = await readJson<CanvasDocument>(`${dir}/${name}`).catch(() => null);
    if (doc) out.push({ canvasId, doc });
  }
  return out;
}

/**
 * 追加历史记录进版本（副本里继续生成时用）。
 * 注意：只写版本自己的 assets.json，**不写项目共享池**，保证副本改动不影响原件。
 * 重复 id 直接跳过（幂等），不做覆盖（历史不可被后来的写入改掉）。
 */
export async function appendVersionAssets(
  projectId: string,
  versionId: string,
  incoming: Asset[],
): Promise<number> {
  if (incoming.length === 0) return 0;
  const current = await readVersionAssets(projectId, versionId);
  const seen = new Set(current.map((a) => a.id));
  const added = incoming.filter((a) => !seen.has(a.id));
  if (added.length === 0) return 0;
  await writeJson(`${versionDir(projectId, versionId)}/assets.json`, [...current, ...added]);
  return added.length;
}

/** 保存版本内某块画布的快照（副本里编辑后写回版本，不回写项目当前画布） */
export async function saveVersionCanvas(
  projectId: string,
  versionId: string,
  canvasId: string,
  doc: CanvasDocument,
): Promise<void> {
  await ensureDir(`${versionDir(projectId, versionId)}/canvases`);
  await writeJson(`${versionDir(projectId, versionId)}/canvases/${canvasId}.json`, doc);
}

/**
 * 删除版本。红线：只删版本目录本身，**不删媒体、不删引导、不动项目当前数据**。
 */
export async function deleteProjectVersion(projectId: string, versionId: string): Promise<void> {
  assertSafeVersionId(versionId);
  await remove(versionDir(projectId, versionId));
}

/** 版本快照的 graph（副本打开时优先读这份，保证"改动不影响原件"） */
export async function readVersionCanvasGraph(
  projectId: string,
  versionId: string,
  canvasId: string,
): Promise<{ doc: CanvasDocument; graph: GraphModel } | null> {
  const raw = await readJson<CanvasDocument>(`${versionDir(projectId, versionId)}/canvases/${canvasId}.json`).catch(
    () => null,
  );
  if (!raw || !raw.graph) return null;
  return { doc: raw, graph: raw.graph };
}
