/**
 * 磁盘历史版本（2026-11-19 数据安全）
 *
 * 为什么需要：主画布 graph 的唯一权威在浏览器 IndexedDB；一旦某个页面实例用旧/空
 * graph 覆盖，用户的节点就没有任何可回溯版本（这次事故就是这样丢的）。
 * 所以每次写盘成功后都追加一份只读快照到项目目录，按签名去重 + 数量轮转。
 *
 * 落点（与项目正文同一数据根，MCP/人工都能直接看）：
 * - 主画布：projects/<pid>/canvases/history/main-<ts>.json
 * - 实体：  projects/<pid>/entities/history/<name>-<ts>.json
 */
import { ensureDir, listDir, readJson, remove, writeJson } from './fs.js';

const CANVAS_KEEP = 40;
const ENTITY_KEEP = 40;
/** 快照最小间隔：自动保存每秒都在触发，不节流会把 40 份额度几分钟内耗光 */
const MIN_INTERVAL_MS = 20_000;
const lastWriteAt = new Map<string, number>();

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

async function listSnapshots(dir: string, prefix: string): Promise<string[]> {
  const entries = await listDir(dir).catch(() => []);
  return entries
    .filter((e) => e.kind === 'file' && e.name.startsWith(prefix) && e.name.endsWith('.json'))
    .map((e) => e.name)
    .sort()
    .reverse();
}

async function rotate(dir: string, prefix: string, keep: number): Promise<void> {
  const names = await listSnapshots(dir, prefix);
  await Promise.all(names.slice(keep).map((name) => remove(`${dir}/${name}`).catch(() => undefined)));
}

/** 上一次快照的签名（没有快照时为空串） */
async function lastSignature(dir: string, prefix: string): Promise<string> {
  const names = await listSnapshots(dir, prefix);
  if (!names[0]) return '';
  const meta = await readJson<{ sig?: string }>(`${dir}/${names[0]}`).catch(() => null);
  return typeof meta?.sig === 'string' ? meta.sig : '';
}

/**
 * 主画布快照：空图永不落快照（空图本身就是「写丢」的症状，不能污染历史）。
 * 与上一份签名相同则跳过；成功后按数量轮转。
 */
export async function saveCanvasSnapshot(projectId: string, graph: unknown): Promise<void> {
  const nodes = (graph as { nodes?: unknown[] } | null | undefined)?.nodes;
  if (!projectId || !Array.isArray(nodes) || nodes.length === 0) return;
  const dir = `projects/${projectId}/canvases/history`;
  const prefix = 'main-';
  const json = JSON.stringify(graph);
  const sig = `${nodes.length}:${fnv1a(json)}`;
  if (sig === (await lastSignature(dir, prefix))) return;
  const now = Date.now();
  if (now - (lastWriteAt.get(prefix) ?? 0) < MIN_INTERVAL_MS) return;
  lastWriteAt.set(prefix, now);
  await ensureDir(dir);
  await writeJson(`${dir}/${prefix}${stamp()}.json`, {
    at: new Date().toISOString(),
    sig,
    nodeCount: nodes.length,
    graph,
  });
  await rotate(dir, prefix, CANVAS_KEEP);
}

/** 手动存档点：用户主动钉住的一份版本，独立目录前缀，不参与自动轮转挤占 */
export async function saveManualSnapshot(projectId: string, graph: unknown, label?: string): Promise<string> {
  const nodes = (graph as { nodes?: unknown[] } | null | undefined)?.nodes;
  if (!projectId || !Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('画布为空，无法创建存档点');
  }
  const dir = `projects/${projectId}/canvases/history`;
  await ensureDir(dir);
  const name = `manual-${stamp()}.json`;
  await writeJson(`${dir}/${name}`, {
    at: new Date().toISOString(),
    label: label?.trim() || '',
    sig: `${nodes.length}:${fnv1a(JSON.stringify(graph))}`,
    nodeCount: nodes.length,
    manual: true,
    graph,
  });
  await rotate(dir, 'manual-', 20);
  return name;
}

/** 实体快照（导演台 workbench / 剧本 / 分镜）：内容非空才写，签名去重 + 轮转 */
export async function saveEntitySnapshot(projectId: string, name: string, data: unknown): Promise<void> {
  if (!projectId || !data || typeof data !== 'object') return;
  const dir = `projects/${projectId}/entities/history`;
  const prefix = `${name}-`;
  const json = JSON.stringify(data);
  if (json === '{}' || json === '[]') return;
  const sig = fnv1a(json);
  if (sig === (await lastSignature(dir, prefix))) return;
  const now = Date.now();
  if (now - (lastWriteAt.get(prefix) ?? 0) < MIN_INTERVAL_MS) return;
  lastWriteAt.set(prefix, now);
  await ensureDir(dir);
  await writeJson(`${dir}/${prefix}${stamp()}.json`, {
    at: new Date().toISOString(),
    sig,
    data,
  });
  await rotate(dir, prefix, ENTITY_KEEP);
}
