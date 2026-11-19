/**
 * audit-project — 全流程体检（2026-11-19）
 *
 * 目标：新手不看代码也能知道「这条链路现在卡在哪」。
 * 只读，不改任何文件：剧本 → 主体 → 分镜 → 提示词引用 → 生成任务 → 视频。
 *
 * 用法：node tools/audit-project.mjs <dataRoot> <projectId>
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [root, pid] = process.argv.slice(2);
if (!root || !pid) {
  console.error('用法：node tools/audit-project.mjs <dataRoot> <projectId>');
  process.exit(2);
}
const P = join(root, 'projects', pid);
const readJson = (p, fallback = null) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};
const casFile = (key) => {
  if (!key) return null;
  const hash = String(key).replace(/^cas:/, '').replace(/\.\w+$/, '');
  return join(root, 'media', 'cas', `${hash}.png`);
};

const results = [];
const add = (stage, ok, detail) => results.push({ stage, ok, detail });

const script = readJson(join(P, 'entities/script.json'));
const storyboard = readJson(join(P, 'entities/storyboard.json'));
const workbench = readJson(join(P, 'entities/workbench.json'));
const log = readJson(join(P, 'entities/project-log.json'));

// 1) 剧本
const episodes = script?.episodes ?? script?.chapters ?? [];
add('剧本', Array.isArray(episodes) && episodes.length > 0, `集数 ${Array.isArray(episodes) ? episodes.length : 0}`);

// 2) 主体：每个主体是否有可用图，文件是否真的在盘上
const trees = storyboard?.subjectTree ?? [];
const noMedia = [];
const missingFile = [];
for (const t of trees) {
  const keys = [];
  for (const st of t.states ?? []) for (const m of st.media ?? []) if (m.type !== 'audio' && m.key) keys.push(m.key);
  if (!keys.length) { noMedia.push(t.name); continue; }
  const f = casFile(keys[0]);
  if (!f || !existsSync(f)) missingFile.push(`${t.name}（${keys[0]}）`);
}
add('主体', trees.length > 0 && noMedia.length === 0 && missingFile.length === 0,
  `主体 ${trees.length}，缺图 ${noMedia.length ? noMedia.join('、') : '无'}，文件缺失 ${missingFile.length ? missingFile.join('、') : '无'}`);

// 3) 分镜 + 提示词引用一致性（与 shot-quality-check 同一口径）
const shots = workbench?.shots ?? [];
const shotIssues = [];
for (const [i, shot] of shots.entries()) {
  const seen = new Set();
  const slots = new Map();
  for (const r of shot.references ?? []) {
    const k = `${r.id}|${r.storageKey ?? r.url ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (typeof r.slotNo === 'number') slots.set(`${r.kind}:${r.slotNo}`, r.title ?? '');
  }
  const prompt = shot.imagePrompt ?? '';
  const problems = [];
  if (!prompt.trim()) problems.push('提示词为空');
  for (const m of prompt.matchAll(/@(Picture|Audio|Video)(\d+)/g)) {
    const kind = m[1] === 'Picture' ? 'image' : m[1] === 'Audio' ? 'audio' : 'video';
    if (!slots.has(`${kind}:${Number(m[2])}`)) problems.push(`悬空 @${m[1]}${m[2]}`);
  }
  const used = new Map();
  for (const m of prompt.matchAll(/<Subject (\d+)>[^\n]*?取自 @Picture(\d+)/g)) {
    const slot = Number(m[2]);
    if (used.has(slot)) problems.push(`@Picture${slot} 被两个 Subject 块重复引用`);
    used.set(slot, m[1]);
    const nm = m[0].match(/[>］]\s*是(?:角色|本段场景|本段道具)([^（(]+)/);
    const title = slots.get(`image:${slot}`) ?? '';
    if (nm && title && nm[1].trim() !== title.split('-')[0].trim()) {
      problems.push(`<Subject ${m[1]}>「${nm[1].trim()}」≠ @Picture${slot}「${title.split('-')[0].trim()}」`);
    }
  }
  if (problems.length) shotIssues.push(`第 ${shot.number ?? i + 1} 段：${[...new Set(problems)].join('、')}`);
}
add('分镜引用', shots.length > 0 && shotIssues.length === 0, shotIssues.length ? shotIssues.join(' | ') : `${shots.length} 段引用全部对齐`);

// 4) 生成任务（claims）
const claimsDir = join(root, '.lf', 'zeroexo', 'app_meta', 'claims');
let landed = 0; let failed = 0; let pending = 0; let total = 0;
if (existsSync(claimsDir)) {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(claimsDir)) {
    if (!f.endsWith('.json')) continue;
    const c = readJson(join(claimsDir, f));
    if (!c || c.projectId !== pid) continue;
    total += 1;
    if (c.status === 'landed') landed += 1;
    else if (c.status === 'failed') failed += 1;
    else pending += 1;
  }
}
add('生成任务', total > 0 && failed === 0, `共 ${total}：成功 ${landed}、失败 ${failed}、进行中 ${pending}`);

// 5) 视频：每段是否已有成片
const withVideo = shots.filter((s) => (s.clipState?.versions ?? []).some((v) => v.kind === 'video' || v.storageKey));
add('视频', withVideo.length === shots.length && shots.length > 0, `${withVideo.length}/${shots.length} 段已有视频`);

const failedStages = results.filter((r) => !r.ok);
console.log(JSON.stringify({
  projectId: pid,
  pipeline: log?.pipeline ?? null,
  stages: results,
  pass: failedStages.length === 0,
}, null, 2));
process.exit(failedStages.length === 0 ? 0 : 1);
