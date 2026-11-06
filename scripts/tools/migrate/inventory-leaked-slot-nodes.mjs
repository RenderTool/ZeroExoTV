/**
 * inventory-leaked-slot-nodes.mjs — 画布业务节点（storyboard/workbench/空 script）清点与清理
 *
 * 2026-11-04 v2 用户硬约束："画布中不得出现任何分镜、出片节点"，并明确授权直接删除。
 *
 * 数据根两处图存储：
 *  A. <root>/projects/<pid>/project.json（File System Access 目录契约，src/platform/fs.ts）
 *  B. <root>/.lf/zeroexo/graph_data/zeroexo%3Agraph%3A<pid>.json（localforage 磁盘驱动镜像，
 *     信封 {__lf:1, value}；大节点 data 拆分为 ...%3Adata%3A<nodeId>.json）
 *
 * 删除范围（--apply）：
 *  - 类型 storyboard / workbench 的节点：无条件删（含墓碑），并删其 :data: 拆分文件与关联边；
 *  - 类型 script 的节点：仅「为空且无内容」（data.content 与 episodes 皆空）才删；
 *  - 孤儿 :data: 文件（主图缺失或节点已不在图中）：按载荷特征归类，
 *    storyboard 特征（shotsByEpisode/subjectTree/shots+entities）与 workbench 特征
 *    （tracks/totalDuration+sourceStoryboardId）→ 删；script 特征（content/episodes 有内容）→ 保留；
 *  - text/image/novel 等其他节点一律不动。
 *
 * 备份：--apply 前把每个被改写的图文件复制到 --backup-dir/<pid>/ 下（已存在不覆盖）。
 *
 * 运行（仓库根目录）：
 *   node scripts/tools/migrate/inventory-leaked-slot-nodes.mjs --root D:\Test [--apply] [--backup-dir D:\Test\projects\_backup]
 *
 * ⚠️ 应用正在运行且持有图内存态时，删除后需刷新页面/重开项目，否则应用回存会复活节点。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function argOf(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const ROOT = argOf('root', null);
const APPLY = args.includes('--apply');
const BACKUP_DIR = argOf('backup-dir', null);

const SLOT_NODE_TYPES = ['script', 'storyboard', 'workbench'];

if (!ROOT) {
  console.error('用法: node scripts/tools/migrate/inventory-leaked-slot-nodes.mjs --root <数据根> [--apply] [--backup-dir <目录>]');
  process.exit(2);
}

/** script 节点只在「为空且无内容」时才删除（storyboard/workbench 无条件删） */
function isRemovable(node) {
  const t = node?.type;
  if (t === 'storyboard' || t === 'workbench') return true;
  if (t !== 'script') return false;
  const d = node?.data ?? {};
  const content = typeof d.content === 'string' ? d.content.trim() : '';
  const episodes = Array.isArray(d.episodes) ? d.episodes : [];
  const hasEpisodeContent = episodes.some((e) => typeof e?.content === 'string' && e.content.trim().length > 0);
  return content.length === 0 && !hasEpisodeContent;
}

/** 孤儿 :data: 文件按载荷特征归类：storyboard / workbench / script / unknown */
function classifyDataPayload(j) {
  if (j && typeof j === 'object') {
    if (Array.isArray(j.tracks) || ('totalDuration' in j && 'sourceStoryboardId' in j)) return 'workbench';
    if ('shotsByEpisode' in j || 'subjectTree' in j || (Array.isArray(j.shots) && Array.isArray(j.entities))) return 'storyboard';
    if ('content' in j || Array.isArray(j.episodes)) return 'script';
  }
  return 'unknown';
}

function createdHint(node) {
  const d = node?.data ?? {};
  if (typeof d.createdAt === 'number') return new Date(d.createdAt).toISOString();
  if (typeof node?.createdAt === 'number') return new Date(node.createdAt).toISOString();
  const m = /^node[-_](\d{10,})[-_]/.exec(String(node?.id ?? ''));
  if (m) return `${new Date(Number(m[1])).toISOString()} (来自 id 时间戳)`;
  return '未知';
}

function backup(srcFile, pid, name) {
  if (!BACKUP_DIR) return;
  const dst = path.join(BACKUP_DIR, pid, name);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(srcFile, dst);
  }
}

const inventory = [];
const orphans = [];
let removedNodes = 0;
let removedDataFiles = 0;
let rewrittenGraphs = 0;

/** 处理一份图：source 标签、项目 id、信封包装、图对象、节点/边数组 */
function processGraph({ source, pid, file, envelope, graph, root }) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : (Array.isArray(graph?.scene) ? graph.scene : []);
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const hits = nodes.filter((n) => SLOT_NODE_TYPES.includes(n?.type));
  for (const n of hits) {
    inventory.push({
      source, pid,
      nodeId: n.id, type: n.type,
      title: n.title ?? n.data?.title ?? null,
      deleted: Boolean(n._deleted),
      removable: isRemovable(n),
      createdAt: createdHint(n),
    });
  }
  const doomed = hits.filter((n) => isRemovable(n));
  if (APPLY && doomed.length > 0) {
    backup(file, pid, path.basename(file));
    const removeIds = new Set(doomed.map((n) => n.id));
    const keptNodes = nodes.filter((n) => !removeIds.has(n.id));
    const keptEdges = edges.filter((e) => !removeIds.has(e?.source) && !removeIds.has(e?.target)
      && !removeIds.has(e?.sourceNodeId) && !removeIds.has(e?.targetNodeId));
    if (Array.isArray(graph.nodes)) graph.nodes = keptNodes;
    else if (Array.isArray(graph.scene)) graph.scene = keptNodes;
    if (Array.isArray(graph.edges)) graph.edges = keptEdges;
    const out = envelope ? { __lf: 1, value: envelope.value } : (root ?? graph);
    fs.writeFileSync(file, JSON.stringify(out), 'utf8');
    removedNodes += doomed.length;
    rewrittenGraphs += 1;
    console.log(`[apply] ${source} ${pid}: 删除 ${doomed.length} 个节点（${doomed.map((n) => `${n.type}:${n.id}`).join(', ')}）`);
  } else if (APPLY) {
    // 无需删除也计一次扫描
  }
  return new Set(nodes.map((n) => n.id));
}

// ---------- 源 A：projects/<pid>/project.json ----------
const projectsDir = path.join(ROOT, 'projects');
if (fs.existsSync(projectsDir)) {
  for (const pid of fs.readdirSync(projectsDir)) {
    if (pid.startsWith('_')) continue; // _backup 等内部目录
    const file = path.join(projectsDir, pid, 'project.json');
    if (!fs.existsSync(file)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.warn(`[跳过] projects/${pid}: project.json 解析失败 (${e.message})`);
      continue;
    }
    const graph = json?.graph ?? json;
    const root = json?.graph ? json : graph; // 无外层包装时 graph 本身就是根（原地改写即可）
    processGraph({ source: 'project.json', pid, file, envelope: null, graph, root });
  }
}

// ---------- 源 B：.lf/zeroexo/graph_data/zeroexo%3Agraph%3A<pid>.json ----------
const lfDir = path.join(ROOT, '.lf', 'zeroexo', 'graph_data');
if (fs.existsSync(lfDir)) {
  const files = fs.readdirSync(lfDir).filter((f) => f.endsWith('.json'));
  const mainFiles = files.filter((f) => !f.includes('%3Adata%3A'));
  const dataFiles = files.filter((f) => f.includes('%3Adata%3A'));
  const nodeIdsByPid = new Map();

  for (const f of mainFiles) {
    const pid = decodeURIComponent(f.replace(/^zeroexo%3Agraph%3A/, '').replace(/\.json$/, ''));
    const file = path.join(lfDir, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.warn(`[跳过] lf-graph ${pid}: 解析失败 (${e.message})`);
      continue;
    }
    const envelope = raw && raw.__lf === 1 && 'value' in raw ? raw : null;
    const val = envelope ? raw.value : raw;
    const graph = val?.graph ?? val;
    const ids = processGraph({ source: 'lf-graph', pid, file, envelope, graph });
    nodeIdsByPid.set(pid, ids);
  }

  // 孤儿 :data: 文件：主图缺失，或节点已不在主图中
  for (const f of dataFiles) {
    const m = /^zeroexo%3Agraph%3A(.+?)%3Adata%3A(.+)\.json$/.exec(f);
    if (!m) continue;
    const pid = decodeURIComponent(m[1]);
    const nodeId = decodeURIComponent(m[2]);
    const ids = nodeIdsByPid.get(pid);
    const orphaned = !ids || !ids.has(nodeId);
    if (!orphaned) continue;
    let payload = null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(lfDir, f), 'utf8').replace(/^﻿/, ''));
      payload = raw && raw.__lf === 1 && 'value' in raw ? raw.value : raw;
    } catch { /* 读不出也按 unknown 处理 */ }
    const kind = classifyDataPayload(payload);
    orphans.push({ pid, nodeId, file: f, kind });
    if (APPLY && (kind === 'storyboard' || kind === 'workbench')) {
      backup(path.join(lfDir, f), pid, f);
      fs.unlinkSync(path.join(lfDir, f));
      removedDataFiles += 1;
      console.log(`[apply] orphan :data: ${pid}/${nodeId} (${kind}) 已删除`);
    }
  }
}

console.log(`\nmode: ${APPLY ? 'apply（已写回）' : 'dry-run（只读，未写任何文件）'}`);
console.log(`slot nodes found: ${inventory.length}（storyboard=${inventory.filter((n) => n.type === 'storyboard').length}, workbench=${inventory.filter((n) => n.type === 'workbench').length}, script=${inventory.filter((n) => n.type === 'script').length}）`);
console.log(`orphan :data: files: ${orphans.length}（storyboard 特征=${orphans.filter((o) => o.kind === 'storyboard').length}, workbench 特征=${orphans.filter((o) => o.kind === 'workbench').length}, script 特征=${orphans.filter((o) => o.kind === 'script').length}, unknown=${orphans.filter((o) => o.kind === 'unknown').length}）`);
if (APPLY) {
  console.log(`removed nodes: ${removedNodes}, removed orphan data files: ${removedDataFiles}, graphs rewritten: ${rewrittenGraphs}`);
  console.log(`backup dir: ${BACKUP_DIR ?? '(未指定，未备份!)'}`);
}
console.log('\n== 节点清单 ==\nsource | projectId | nodeId | type | deleted | removable | createdAt | title');
for (const n of inventory) {
  console.log(`${n.source} | ${n.pid} | ${n.nodeId} | ${n.type} | ${n.deleted} | ${n.removable} | ${n.createdAt} | ${n.title ?? ''}`);
}
console.log('\n== 孤儿 :data: 清单 ==\nprojectId | nodeId | kind | file');
for (const o of orphans) {
  console.log(`${o.pid} | ${o.nodeId} | ${o.kind} | ${o.file}`);
}
