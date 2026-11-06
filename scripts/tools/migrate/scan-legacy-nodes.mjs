/**
 * scan-legacy-nodes.mjs — 旧节点业务数据迁移前扫描（只读，不写任何实体文件）
 *
 * 用途（2026-11-04 实体层重构取证）：
 * - 扫描后端 storage/resources/front/canvases/{ownerId}/{projectId}/scene-v*.json 版本快照；
 * - 每个项目只取最高版本号的一份快照（旧版本仅作历史，不重复计数）；
 * - 统计节点类型分布，重点盘点 script / storyboard / workbench 三类「业务载体节点」，
 *   列出其 node.data 字段路径清单，并评估能否无损映射到新实体层
 *   （script.json / shots.json / outputs.json / assets.json）。
 *
 * 运行（仓库根目录）：
 *   node scripts/tools/migrate/scan-legacy-nodes.mjs [--storage <后端storage目录>] [--out <报告路径>]
 *
 * 默认：
 *   --storage D:\AICode\zeroexo\zeroexo-platform\zeroexo_backend\storage
 *   --out     scripts/tools/migrate/migration-report.json
 *
 * 限制：
 * - 前端本地版（Plan#83）数据在浏览器 IndexedDB（localforage 桶 zeroexo/app_state、
 *   zeroexo:graph:{canvasId}），文件系统不可达，本脚本无法统计，只能以后端快照为准；
 * - 数据库 Project.script / Project.storyboard / Project.generations JSON 字段需另走
 *   prisma 查询，本脚本不连库。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function argOf(name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const STORAGE = argOf('storage', 'D:\\AICode\\zeroexo\\zeroexo-platform\\zeroexo_backend\\storage');
const OUT = argOf('out', path.resolve('scripts/tools/migrate/migration-report.json'));

/** 业务载体节点类型 → 新实体映射目标 */
const BIZ_NODE_TYPES = ['script', 'storyboard', 'workbench'];

/** node.data 字段 → 新实体字段的映射评估（数据类=可迁移；运行态=建议丢弃；布局类=留在 graph.layout） */
const FIELD_MAP = {
  script: {
    'data.content': { to: 'script.json → episodes[0].content（旧单集迁移为首集）', keep: true },
    'data.episodes': { to: 'script.json → episodes[]（集/段落/行）', keep: true },
    'data.activeEpisodeId': { to: 'script.json → meta.activeEpisodeId', keep: true },
    'data.title': { to: 'script.json → title', keep: true },
    'data.status': { to: '丢弃（节点运行态）', keep: false },
    'data.isSample / data.sampleInitialized': { to: '丢弃（示例数据标记）', keep: false },
    'position / size': { to: 'graph.layout（画布只留布局）', keep: true },
  },
  storyboard: {
    'data.shots / data.shotsByEpisode': { to: 'shots/<segId>.json → 分镜段（seq/frameCount/prompt/槽位）', keep: true },
    'data.entities': { to: 'assets.json → 项目内资产关联', keep: true },
    'data.sourceScriptId': { to: 'shots.json → sourceRef（指回 script.json 段落）', keep: true },
    'data.subjectTree / data.subjectAiIndex / data.aiSubjects': { to: 'assets.json → 主体圣经关联', keep: true },
    'data.colorCard': { to: 'project.json → colorCardRef', keep: true },
    'data.status / data.progress / data.steps / data.conflicts': { to: '丢弃（生成运行态）', keep: false },
    'data.productionManagerId / data.productionItems': { to: '待拍板（制作管理模块归属）', keep: null },
    'data.aiMemory': { to: '待拍板（Agent 记忆是否随项目迁移）', keep: null },
  },
  workbench: {
    'data.shots': { to: 'outputs.json → 出片条目（对应段/版本/视频路径/生成参数）', keep: true },
    'data.mediaAssets': { to: 'assets.json → 媒体资产关联', keep: true },
    'data.entities': { to: 'assets.json → 项目内资产关联', keep: true },
    'data.tracks': { to: 'outputs.json → 多轨时间线（若保留多轨）', keep: true },
    'data.sourceStoryboardId': { to: 'outputs.json → sourceRef（指回分镜段）', keep: true },
    'data.scriptSummary / data.report': { to: '丢弃（可再生的派生物）', keep: false },
    'data.status / data.totalDuration / data.completedCount': { to: '派生字段（由 outputs 条目聚合，不落库）', keep: false },
    'data.deletedSourceShotIds': { to: 'outputs.json → 同步墓碑（若保留删改同步语义）', keep: true },
    'data.aiMemory': { to: '待拍板', keep: null },
  },
};

/** 收集对象字段路径（一层展开，数组记长度） */
function fieldInventory(obj, prefix) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out.push({ path: p, type: 'array', length: v.length });
    else if (v && typeof v === 'object') out.push({ path: p, type: 'object', keys: Object.keys(v).slice(0, 12) });
    else out.push({ path: p, type: typeof v });
  }
  return out;
}

function* walkSnapshots(root) {
  if (!fs.existsSync(root)) return;
  for (const owner of fs.readdirSync(root)) {
    const ownerDir = path.join(root, owner);
    if (!fs.statSync(ownerDir).isDirectory()) continue;
    for (const projectId of fs.readdirSync(ownerDir)) {
      const projDir = path.join(ownerDir, projectId);
      if (!fs.statSync(projDir).isDirectory()) continue;
      const snaps = fs.readdirSync(projDir)
        .filter((f) => /^scene-v\d+\.json$/.test(f))
        .map((f) => ({ file: f, version: Number(f.match(/\d+/)[0]) }))
        .sort((a, b) => a.version - b.version);
      if (snaps.length === 0) continue;
      yield { owner, projectId, latest: snaps[snaps.length - 1], snapCount: snaps.length, dir: projDir };
    }
  }
}

const projects = [];
const globalTypeCounts = {};
const globalBizNodes = { script: 0, storyboard: 0, workbench: 0 };
const fieldUnion = { script: new Set(), storyboard: new Set(), workbench: new Set() };

for (const p of walkSnapshots(path.join(STORAGE, 'resources', 'front', 'canvases'))) {
  const filePath = path.join(p.dir, p.latest.file);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    projects.push({ ...p, error: `parse failed: ${e.message}` });
    continue;
  }
  const nodes = Array.isArray(json.scene) ? json.scene : [];
  const typeCounts = {};
  const biz = [];
  for (const n of nodes) {
    const t = n?.type ?? '<missing>';
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    globalTypeCounts[t] = (globalTypeCounts[t] ?? 0) + 1;
    if (BIZ_NODE_TYPES.includes(t)) {
      globalBizNodes[t] += 1;
      const inv = fieldInventory(n.data ?? {}, 'data');
      for (const f of inv) fieldUnion[t].add(f.path);
      biz.push({
        nodeId: n.id,
        type: t,
        title: n.title ?? n.data?.title ?? null,
        dataFields: inv,
        // 抽样统计：便于评估迁移工作量
        stats: {
          episodes: Array.isArray(n.data?.episodes) ? n.data.episodes.length : (n.data?.content ? 1 : 0),
          shots: Array.isArray(n.data?.shots) ? n.data.shots.length : 0,
          shotsByEpisode: n.data?.shotsByEpisode && typeof n.data.shotsByEpisode === 'object'
            ? Object.values(n.data.shotsByEpisode).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0) : 0,
        },
      });
    }
  }
  projects.push({
    ownerId: p.owner,
    projectId: p.projectId,
    snapshotFile: p.latest.file,
    snapshotCount: p.snapCount,
    nodeTotal: nodes.length,
    typeCounts,
    bizNodes: biz,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  storageRoot: STORAGE,
  scope: '后端 scene-v*.json 版本快照（每项目取最新一份）；前端 IndexedDB 与数据库 JSON 字段不在本报告内',
  summary: {
    projectCount: projects.length,
    globalTypeCounts,
    bizNodeTotals: globalBizNodes,
    bizFieldUnion: Object.fromEntries(Object.entries(fieldUnion).map(([k, s]) => [k, [...s].sort()])),
  },
  fieldMappingProposal: FIELD_MAP,
  projects,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

console.log(`projects scanned: ${projects.length}`);
console.log(`biz nodes (latest snapshot each): ${JSON.stringify(globalBizNodes)}`);
console.log(`type counts: ${JSON.stringify(globalTypeCounts)}`);
console.log(`report written: ${OUT}`);
