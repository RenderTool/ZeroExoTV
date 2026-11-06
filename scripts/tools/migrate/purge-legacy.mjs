/**
 * purge-legacy.mjs — 旧业务载体节点/剧本资产物理清除（用户拍板 2026-11-04：旧数据按测试数据处理，直接删除）
 *
 * 清除对象：
 *  ① 前端数据根 .lf 信封：
 *     - graph_data/zeroexo:graph:<projectId> 图信封内 type ∈ {script, storyboard, workbench} 的节点及相关边；
 *     - graph_data/zeroexo:graph:<projectId>:data:<nodeId> 被删节点的 data 分块文件（物理删除）；
 *     - 任何 *:assets 信封内 kind === 'script' 的剧本资产记录；
 *  ② 后端 storage/resources/front/canvases/<owner>/<projectId>/scene-v*.json 快照内同类节点及连接；
 *  ③ 后端 DB 的 Project.script/storyboard/generations 字段：本脚本不连库、不动，仅报告（见输出末尾）。
 *
 * 用法：
 *   node scripts/tools/migrate/purge-legacy.mjs                  # dry-run，只在控制台打印将删清单
 *   node scripts/tools/migrate/purge-legacy.mjs --apply          # 实际删除（请先确认备份 zip 已生成）
 *   可选：--data-root D:\Test   --storage D:\AICode\zeroexo\zeroexo-platform\zeroexo_backend\storage
 *
 * 安全性：apply 后再次运行 dry-run 应输出全 0；脚本本身即复扫证据。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
function argOf(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const DATA_ROOT = argOf('data-root', 'D:\\Test');
const STORAGE = argOf('storage', 'D:\\AICode\\zeroexo\\zeroexo-platform\\zeroexo_backend\\storage');

const BIZ_TYPES = new Set(['script', 'storyboard', 'workbench']);
const mode = APPLY ? 'APPLY' : 'DRY-RUN';
const summary = {
  frontend: { projects: 0, nodesRemoved: 0, byType: {}, edgesRemoved: 0, chunkFilesDeleted: 0, scriptAssetsRemoved: 0, graphTouched: [] },
  backend: { projects: 0, snapshotsTouched: 0, nodesRemoved: 0, byType: {}, connectionsRemoved: 0 },
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');

/** 从一条边/连接对象里取出两端节点 id（兼容 from/to、source/target、fromNode/toNode） */
function edgeEnds(e) {
  const a = e?.from ?? e?.source ?? e?.fromNode ?? e?.sourceNode ?? null;
  const b = e?.to ?? e?.target ?? e?.toNode ?? e?.targetNode ?? null;
  return [typeof a === 'object' ? a?.nodeId ?? a?.id : a, typeof b === 'object' ? b?.nodeId ?? b?.id : b];
}

/** 清理一个「nodes + edges/connections」容器对象；返回统计 */
function purgeGraphContainer(container, edgesKey) {
  const nodes = Array.isArray(container?.nodes) ? container.nodes : [];
  const removedIds = new Set(nodes.filter((n) => BIZ_TYPES.has(n?.type)).map((n) => n.id));
  if (removedIds.size === 0) return { removedIds, removedByType: {}, edgesRemoved: 0 };
  const removedByType = {};
  for (const n of nodes) if (removedIds.has(n.id)) removedByType[n.type] = (removedByType[n.type] ?? 0) + 1;
  container.nodes = nodes.filter((n) => !removedIds.has(n.id));
  let edgesRemoved = 0;
  const edges = Array.isArray(container?.[edgesKey]) ? container[edgesKey] : null;
  if (edges) {
    container[edgesKey] = edges.filter((e) => {
      const [a, b] = edgeEnds(e);
      const drop = (a && removedIds.has(a)) || (b && removedIds.has(b));
      if (drop) edgesRemoved += 1;
      return !drop;
    });
  }
  return { removedIds, removedByType, edgesRemoved };
}

// ============ ① 前端数据根 .lf 信封 =========
const lfDir = path.join(DATA_ROOT, '.lf');
if (fs.existsSync(lfDir)) {
  const graphDir = path.join(lfDir, 'zeroexo', 'graph_data');
  // 1) 顶层图信封（文件名不含 %3Adata%3A）
  if (fs.existsSync(graphDir)) {
    for (const f of fs.readdirSync(graphDir)) {
      if (!f.endsWith('.json')) continue;
      const decoded = decodeURIComponent(f.replace(/\.json$/, ''));
      if (decoded.includes(':data:')) continue; // 分块文件稍后处理
      const fp = path.join(graphDir, f);
      const env = readJson(fp);
      const graph = env?.value?.graph;
      if (!graph) continue;
      const { removedIds, removedByType, edgesRemoved } = purgeGraphContainer(graph, 'edges');
      if (removedIds.size === 0) continue;
      summary.frontend.projects += 1;
      summary.frontend.nodesRemoved += removedIds.size;
      summary.frontend.edgesRemoved += edgesRemoved;
      for (const [t, c] of Object.entries(removedByType)) summary.frontend.byType[t] = (summary.frontend.byType[t] ?? 0) + c;
      const projectId = decoded.split(':')[2];
      summary.frontend.graphTouched.push({ projectId, removed: Object.entries(removedByType).map(([t, c]) => `${t}×${c}`).join(','), edgesRemoved });
      if (APPLY) {
        writeJson(fp, env);
        // 2) 删除被删节点的 data 分块文件
        for (const nodeId of removedIds) {
          const chunk = path.join(graphDir, encodeURIComponent(`zeroexo:graph:${projectId}:data:${nodeId}`) + '.json');
          if (fs.existsSync(chunk)) {
            fs.unlinkSync(chunk);
            summary.frontend.chunkFilesDeleted += 1;
          }
        }
      } else {
        // dry-run 也统计分块文件数
        for (const nodeId of removedIds) {
          const chunk = path.join(graphDir, encodeURIComponent(`zeroexo:graph:${projectId}:data:${nodeId}`) + '.json');
          if (fs.existsSync(chunk)) summary.frontend.chunkFilesDeleted += 1;
        }
      }
    }
  }
  // 3) 所有 *:assets 信封里的剧本资产记录
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fp); continue; }
      if (!entry.name.endsWith('.json')) continue;
      const decoded = decodeURIComponent(entry.name.replace(/\.json$/, ''));
      if (!decoded.endsWith(':assets')) continue;
      const env = readJson(fp);
      const arr = env?.value;
      if (!Array.isArray(arr)) continue;
      const scripts = arr.filter((a) => a?.kind === 'script');
      if (scripts.length === 0) continue;
      summary.frontend.scriptAssetsRemoved += scripts.length;
      if (APPLY) {
        env.value = arr.filter((a) => a?.kind !== 'script');
        writeJson(fp, env);
      }
    }
  };
  walk(lfDir);
}

// ============ ② 后端 scene-v*.json 快照 =========
const canvasesRoot = path.join(STORAGE, 'resources', 'front', 'canvases');
if (fs.existsSync(canvasesRoot)) {
  for (const owner of fs.readdirSync(canvasesRoot)) {
    const ownerDir = path.join(canvasesRoot, owner);
    if (!fs.statSync(ownerDir).isDirectory()) continue;
    for (const projectId of fs.readdirSync(ownerDir)) {
      const projDir = path.join(ownerDir, projectId);
      if (!fs.statSync(projDir).isDirectory()) continue;
      let projectTouched = false;
      for (const f of fs.readdirSync(projDir)) {
        if (!/^scene-v\d+\.json$/.test(f)) continue;
        const fp = path.join(projDir, f);
        const snap = readJson(fp);
        if (!Array.isArray(snap?.scene)) continue;
        const container = { nodes: snap.scene, connections: snap.connections };
        const { removedIds, removedByType, edgesRemoved } = purgeGraphContainer(container, 'connections');
        if (removedIds.size === 0) continue;
        snap.scene = container.nodes;
        snap.connections = container.connections;
        projectTouched = true;
        summary.backend.snapshotsTouched += 1;
        summary.backend.nodesRemoved += removedIds.size;
        summary.backend.connectionsRemoved += edgesRemoved;
        for (const [t, c] of Object.entries(removedByType)) summary.backend.byType[t] = (summary.backend.byType[t] ?? 0) + c;
        if (APPLY) writeJson(fp, snap);
      }
      if (projectTouched) summary.backend.projects += 1;
    }
  }
}

// ============ 输出 =========
console.log(`[${mode}] purge-legacy 结果${APPLY ? '（已写盘）' : '（未写盘）'}`);
console.log('— 前端数据根 .lf —');
console.log(`  项目数: ${summary.frontend.projects}`);
console.log(`  节点清除: ${summary.frontend.nodesRemoved}  (${JSON.stringify(summary.frontend.byType)})`);
console.log(`  关联边清除: ${summary.frontend.edgesRemoved}`);
console.log(`  data 分块文件删除: ${summary.frontend.chunkFilesDeleted}`);
console.log(`  .lf 剧本资产记录清除: ${summary.frontend.scriptAssetsRemoved}`);
for (const g of summary.frontend.graphTouched) console.log(`    · ${g.projectId}: ${g.removed}, edges -${g.edgesRemoved}`);
console.log('— 后端 scene-vN 快照 —');
console.log(`  项目数: ${summary.backend.projects}, 快照文件: ${summary.backend.snapshotsTouched}`);
console.log(`  节点清除: ${summary.backend.nodesRemoved}  (${JSON.stringify(summary.backend.byType)})`);
console.log(`  连接清除: ${summary.backend.connectionsRemoved}`);
console.log('— 后端 DB（Project.script/storyboard/generations）—');
console.log('  未动：本脚本不连数据库。如需清空请另行执行 SQL/Prisma，本脚本仅报告。');
if (!APPLY) console.log('\n以上为 dry-run。确认备份 zip 已生成后，加 --apply 执行。');
