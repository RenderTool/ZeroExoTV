#!/usr/bin/env node
/**
 * fix-episode-titles.cjs — 存量脏集标题一次性幂等修复（2026-11-04 抽屉集标题错乱）
 *
 * 修什么：
 *  - 拼接型脏值（「第1集2集」）→ autoEpisodeTitle(number)
 *  - 重复编号型（「第2集第2集」）→ autoEpisodeTitle(number)
 *  - 默认标题空格变体（「第 1 集」）→ 规范「第1集」
 *  - 默认模式但数字与 number 不符（编号错乱，title='第3集' 而 number=1）→ autoEpisodeTitle(number)
 *  不动什么：空 title（显示层兜底）、正常自定义标题（如「第5集·大结局」）。
 *
 * 契约（与 writeScript 一致）：
 *  - 只写 projects/<pid>/entities/script.json，不碰 graph / node.data / 画布；
 *  - 乐观锁：读到写之间文件 size/mtime 变了 → abort 该项目（等价 writeJsonIfUnchanged）；
 *  - version+1、updatedAt 刷新（等价 writeScript 的 ScriptPatch baseVersion 语义）；
 *  - 落盘前整份快照备份到 entities/backups/script-repair-<timestamp>.json
 *    （同 script-import-service 备份惯例）；
 *  - 幂等：修复后的实体再次运行 plan 为空 → 0 改动 0 写入。
 *
 * 用法：
 *  - dry-run（默认）：node scripts/fix-episode-titles.cjs [--root D:\Test]
 *  - 落盘一次：      node scripts/fix-episode-titles.cjs --apply [--root D:\Test]
 *
 * 规则镜像声明：repairPlan 镜像 src/entities/script-store.ts 的 planEpisodeTitleRepair，
 * 两侧一致性由 src/entities/__tests__/script-store.test.ts 对照断言保证（防漂移）。
 */
const fs = require('node:fs');
const path = require('node:path');

// ---- 规则镜像（勿在此改逻辑；改规则请同步 script-store.planEpisodeTitleRepair 并更新对照单测） ----
function autoEpisodeTitle(number) {
  return `第${number}集`;
}

function isDefaultEpisodeTitle(title, number) {
  if (!title) return false;
  return title.replace(/\s+/g, '') === `第${number}集`;
}

function isDirtyEpisodeTitle(title, number) {
  if (!title) return false;
  const t = title.replace(/\s+/g, '');
  if (isDefaultEpisodeTitle(t, number)) return false;
  if (/^第\d+集/.test(t) && /\d集$/.test(t) && t !== `第${number}集`) return true; // 拼接型
  if ((t.match(/第\d+集/g) ?? []).length >= 2) return true; // 重复编号型
  return false;
}

/** 与 script-store.planEpisodeTitleRepair 逐字同义：返回 [{episodeId, from, to}]，无改动 = [] */
function repairPlan(episodes) {
  const plan = [];
  for (const ep of episodes) {
    const t = (ep.title ?? '').trim();
    if (!t) continue;
    const canonical = autoEpisodeTitle(ep.number);
    const squeezed = t.replace(/\s+/g, '');
    const isWrongDefault = isDefaultEpisodeTitle(t, ep.number) === false
      && /^第\d+集$/.test(squeezed); // 默认模式但数字与 number 不符
    if (isDirtyEpisodeTitle(t, ep.number) || isWrongDefault || (isDefaultEpisodeTitle(t, ep.number) && t !== canonical)) {
      plan.push({ episodeId: ep.id, from: t, to: canonical });
    }
  }
  return plan;
}

// ---- IO ----
function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : 'D:\\Test';
  return { apply, root };
}

function backupTimestamp(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fmtStat(st) {
  return `size=${st.size} mtime=${st.mtimeMs.toFixed(3)}`;
}

function main() {
  const { apply, root } = parseArgs();
  const projectsDir = path.join(root, 'projects');
  if (!fs.existsSync(projectsDir)) {
    console.error(`[fix-episode-titles] 数据根不存在：${projectsDir}`);
    process.exit(1);
  }
  const projectIds = fs.readdirSync(projectsDir)
    .filter((name) => fs.statSync(path.join(projectsDir, name)).isDirectory());
  let totalChanges = 0;
  let touchedProjects = 0;
  for (const pid of projectIds) {
    const scriptPath = path.join(projectsDir, pid, 'entities', 'script.json');
    if (!fs.existsSync(scriptPath)) {
      console.log(`[${pid}] 无 entities/script.json，跳过`);
      continue;
    }
    const raw = fs.readFileSync(scriptPath, 'utf8');
    const before = fs.statSync(scriptPath);
    let entity;
    try {
      entity = JSON.parse(raw);
    } catch (e) {
      console.error(`[${pid}] script.json 解析失败，跳过：${e.message}`);
      continue;
    }
    if (!entity || !Array.isArray(entity.episodes)) {
      console.log(`[${pid}] 非剧本实体结构，跳过`);
      continue;
    }
    const plan = repairPlan(entity.episodes);
    if (plan.length === 0) {
      console.log(`[${pid}] 集标题干净，0 改动`);
      continue;
    }
    console.log(`[${pid}] 待修复 ${plan.length} 条：`);
    for (const item of plan) {
      console.log(`  - ep=${item.episodeId}  "${item.from}"  →  "${item.to}"`);
    }
    if (!apply) {
      console.log(`[${pid}] dry-run：未写入（加 --apply 落盘一次）`);
      totalChanges += plan.length;
      continue;
    }
    // 乐观锁：读→写之间文件被外部改动则中止（等价 writeJsonIfUnchanged 的 size+mtime 校验）
    const now = fs.statSync(scriptPath);
    if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
      console.error(`[${pid}] 乐观锁冲突：文件在读取后被外部改动（${fmtStat(before)} → ${fmtStat(now)}），跳过`);
      continue;
    }
    // 备份整份快照（同 script-import-service 惯例：entities/backups/）
    const backupsDir = path.join(projectsDir, pid, 'entities', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const backupPath = path.join(backupsDir, `script-repair-${backupTimestamp(new Date())}.json`);
    fs.writeFileSync(backupPath, raw, 'utf8');
    // 落盘：title 按 plan 替换，version+1，updatedAt 刷新（等价 writeScript patch 语义）
    const byId = new Map(plan.map((p) => [p.episodeId, p.to]));
    const next = {
      ...entity,
      episodes: entity.episodes.map((ep) => (byId.has(ep.id) ? { ...ep, title: byId.get(ep.id) } : ep)),
      version: (typeof entity.version === 'number' ? entity.version : 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(scriptPath, JSON.stringify(next, null, 2), 'utf8');
    console.log(`[${pid}] 已写入 ${plan.length} 条（version ${entity.version} → ${next.version}），备份：${backupPath}`);
    totalChanges += plan.length;
    touchedProjects += 1;
  }
  console.log(apply
    ? `完成：落盘 ${touchedProjects} 个项目 / ${totalChanges} 条集标题`
    : `dry-run 完成：共 ${totalChanges} 条待修复（未写入）`);
}

// vitest 可导入本文件复用规则做对照/幂等测试；直接执行时才跑 main
module.exports = { autoEpisodeTitle, isDefaultEpisodeTitle, isDirtyEpisodeTitle, repairPlan };

if (require.main === module) {
  main();
}
