/**
 * ZV-005_xszpm 真实导入（一次性脚本，全程走 MCP 工具调用，不绕过 MCP 直接写文件）：
 * 以 stdio 客户端拉起 dist/index.js，依次真实调用：
 *   create_project → import_script → upsert_subject×16 → upload_asset×18
 *   → set_subject_image×18 → set_shared_params → set_shot_prompt/add_segment×35
 *   → link_subject_to_shot（按每段「图片来源」行绑定主体）
 * 公共提示词层已于 2026-11-05 下线：原公共提示词改为逐段并入每段 videoPrompt（已含不重复追加）。
 * 源数据只读：D:\AICode\zerovideoAgent\projects\ZV-005_xszpm
 *
 * 运行（PowerShell，数据根硬性默认 D:\Test，与前端 http-fs / MCP 同源）：
 *   $env:ZEROEXO_FRONTEND_URL='http://localhost:4173'
 *   node import-zv005.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SRC = 'D:\\AICode\\zerovideoAgent\\projects\\ZV-005_xszpm';
const TOKEN = 'zxp_zv005_import';

const meta = JSON.parse(fs.readFileSync(path.join(SRC, 'metadata.json'), 'utf8'));
const scriptMd = fs.readFileSync(path.join(SRC, 'EP01_剧本.md'), 'utf8');
const archiveMd = fs.readFileSync(path.join(SRC, 'EP01_旁白存档_含旁白分镜.md'), 'utf8');

// ===== 主体表（人物表/场景表/道具表 + 资产映射，源=EP01_剧本.md 与 assets/）=====
const SUBJECTS = [
  { name: '张秀才', kind: 'character', aliases: ['C1', '秀才'], note: '主角；明代莱州书生，二十余岁，青布直裰、束发戴儒巾', images: [{ file: 'assets/characters/张秀才_定妆.png', stateTag: '定妆' }] },
  { name: '老僧', kind: 'character', aliases: ['C2', '和尚'], note: '破庙坐禅僧（实为善鬼）；剃度光头、僧衣破旧', images: [{ file: 'assets/characters/老僧_定妆.png', stateTag: '定妆' }] },
  { name: '女鬼', kind: 'character', aliases: ['C3'], note: '妖娆女子，两态：美艳妇人态／血盆大口恶鬼态（同一张脸）', images: [
    { file: 'assets/characters/女鬼_美艳_定妆.png', stateTag: '美艳态' },
    { file: 'assets/characters/女鬼_恶鬼_定妆.png', stateTag: '恶鬼态' },
  ] },
  { name: '男鬼甲', kind: 'character', aliases: ['C4', '递馒头者'], note: '布衣男子，用馒头设套', images: [{ file: 'assets/characters/男鬼甲_定妆.png', stateTag: '定妆' }] },
  { name: '男鬼乙', kind: 'character', aliases: ['C5', '劝酒者'], note: '布衣男子，用酒设套', images: [{ file: 'assets/characters/男鬼乙_定妆.png', stateTag: '定妆' }] },
  { name: '莱州官道', kind: 'scene', aliases: ['S1'], note: '荒僻官道，四野无人；夜·风雪将至', images: [{ file: 'assets/scenes/S1_莱州官道_宫格.png', stateTag: '宫格基准' }] },
  { name: '破庙后院', kind: 'scene', aliases: ['S2'], note: '庙门破败、杂草塞径', images: [{ file: 'assets/scenes/S2_破庙后院_宫格.png', stateTag: '宫格基准' }] },
  { name: '破庙大殿', kind: 'scene', aliases: ['S3'], note: '主场景：供案油灯、蒲团老僧、蛛网佛像、殿角铺草', images: [
    { file: 'assets/scenes/S3_破庙大殿_宫格.png', stateTag: '宫格基准' },
    { file: 'assets/scenes/S3_破庙大殿_宫格_备选.png', stateTag: '宫格·备选' },
  ] },
  { name: '荒野夜路', kind: 'scene', aliases: ['S4'], note: '逃出后的狂奔与止步', images: [{ file: 'assets/scenes/S4_荒野夜路_宫格.png', stateTag: '宫格基准' }] },
  { name: '沧州僧舍', kind: 'scene', aliases: ['S5'], note: '日景收尾：为老僧超度、感悟收束', images: [{ file: 'assets/scenes/S5_沧州僧舍_宫格.png', stateTag: '宫格基准' }] },
  { name: '蛛网佛像', kind: 'prop', aliases: [], note: '被蜘蛛网遮蔽的残破佛像，辨不出面目', images: [{ file: 'assets/props/蛛网佛像_定妆.png', stateTag: '定妆' }] },
  { name: '油灯', kind: 'prop', aliases: ['陶油灯'], note: '供案上昏暗油灯，殿内主光源', images: [{ file: 'assets/props/油灯_定妆.png', stateTag: '定妆' }] },
  { name: '蒲团', kind: 'prop', aliases: [], note: '老僧打坐用蒲团', images: [{ file: 'assets/props/蒲团_定妆.png', stateTag: '定妆' }] },
  { name: '木条', kind: 'prop', aliases: [], note: '老僧击落馒头/打醒秀才用的木条', images: [{ file: 'assets/props/木条_定妆.png', stateTag: '定妆' }] },
  { name: '酒壶', kind: 'prop', aliases: [], note: '男鬼乙的「上等好酒」（实为雪水）', images: [{ file: 'assets/props/酒壶_定妆.png', stateTag: '定妆' }] },
  { name: '馒头布袋', kind: 'prop', aliases: ['布袋'], note: '男鬼甲装白面馒头的布袋', images: [{ file: 'assets/props/馒头布袋_定妆.png', stateTag: '定妆' }] },
  { name: '项目色卡', kind: 'prop', aliases: ['色卡', 'C1-C10'], note: '项目色卡 C1-C10（仅存档参考，不投喂视频提示词）', images: [{ file: 'assets/color_card/color_card_ZV005.jpg', stateTag: '色卡' }] },
];

// 文件名（不含扩展名）→ 主体名：段头「图片来源」行按路径反查主体
const FILE_TO_SUBJECT = {};
for (const s of SUBJECTS) {
  for (const img of s.images) FILE_TO_SUBJECT[path.basename(img.file).replace(/\.[^.]+$/, '')] = s.name;
}

// ===== 解析旁白存档：35 段（编号/标题/时长/中文块/图片来源）=====
function parseSegments(md) {
  const out = [];
  const re = /^## ([A-C]-\d{2}) 段：(.+?)（约([\d.]+)秒）V\d+$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(md)) !== null) heads.push({ code: m[1], title: m[2], secs: Number(m[3]), start: m.index, after: re.lastIndex });
  for (let i = 0; i < heads.length; i++) {
    const body = md.slice(heads[i].after, i + 1 < heads.length ? heads[i + 1].start : md.length);
    const blockMatch = body.match(/```text\r?\n([\s\S]*?)```/);
    const imgLine = body.match(/\*\*图片来源：\*\*\s*(.+)/);
    const refFiles = [];
    if (imgLine) {
      // 源格式：`@图片1`＝assets/...（@图片N 可能有反引号包裹，＝为全角）
      const re2 = /@图片\d+`?＝\s*([^\s(（,，、]+)/g;
      let mm;
      while ((mm = re2.exec(imgLine[1])) !== null) refFiles.push(mm[1]);
    }
    out.push({
      code: heads[i].code,
      title: heads[i].title,
      duration: heads[i].secs,
      prompt: blockMatch ? blockMatch[1].trim() : '',
      refFiles,
    });
  }
  return out;
}

// ===== 剧本 md → HTML（逐行转换，全文口径不变）=====
function mdToHtml(md) {
  return md.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return '';
    if (t.startsWith('#### ')) return `<h4>${t.slice(5)}</h4>`;
    if (t.startsWith('### ')) return `<h3>${t.slice(4)}</h3>`;
    if (t.startsWith('## ')) return `<h2>${t.slice(3)}</h2>`;
    if (t.startsWith('# ')) return `<h1>${t.slice(2)}</h1>`;
    if (t.startsWith('> ')) return `<blockquote>${t.slice(2)}</blockquote>`;
    if (t === '---' || t === '***') return '<hr>';
    return `<p>${t}</p>`;
  }).filter(Boolean).join('\n');
}

// ===== MCP 客户端 =====
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, ZEROEXO_MCP_TOKEN: TOKEN },
});
const client = new Client({ name: 'zv005-import', version: '1.0.0' });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`${name} 返回非 JSON：${text.slice(0, 300)}`); }
  if (parsed.error) throw new Error(`${name} 失败：${JSON.stringify(parsed.error).slice(0, 400)}`);
  return parsed;
}

// ===== --rebind <projectId>：只对已导入项目补「段→主体」绑定 =====
if (process.argv.includes('--rebind')) {
  const pid = process.argv[process.argv.indexOf('--rebind') + 1];
  const segs = parseSegments(archiveMd);
  let wb = await call('get_workbench', { projectId: pid });
  const subjects = await call('list_subjects', { projectId: pid });
  const idByName = Object.fromEntries(subjects.subjects.map((s) => [s.name, s.id]));
  let wbVersion = wb.version;
  let linkCount = 0;
  let missing = [];
  for (const seg of segs) {
    const shot = wb.shots.find((s) => (s.description ?? '').startsWith(seg.code));
    if (!shot) { missing.push(seg.code); continue; }
    const names = [...new Set(seg.refFiles.map((f) => FILE_TO_SUBJECT[path.basename(f).replace(/\.[^.]+$/, '')]).filter(Boolean))];
    for (const name of names) {
      if (!idByName[name]) { missing.push(`${seg.code}:${name}`); continue; }
      const r = await call('link_subject_to_shot', { projectId: pid, baseVersion: wbVersion, shotId: shot.id, subjectId: idByName[name] });
      wbVersion = r.version;
      linkCount += 1;
    }
  }
  console.log(`✓ 补绑定 ${linkCount} 次（未命中：${missing.length ? missing.join(', ') : '无'}）`);
  await client.close();
  process.exit(0);
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg' };
const segments = parseSegments(archiveMd);
console.log(`解析旁白存档：${segments.length} 段`);

// 1. 项目
const project = await call('create_project', { title: 'ZV-005_xszpm', tags: ['民间故事', '古装志怪', meta.genre.split('（')[0]] });
const pid = project.projectId;
console.log(`✓ 项目 ${project.title} (${pid})`);

// 2. 剧本（1 集，全文）
const html = mdToHtml(scriptMd);
const imp = await call('import_script', {
  projectId: pid, baseVersion: 0, content: html, mode: 'raw', strategy: 'overwrite',
  title: 'EP01 秀才住破庙', confirm: true,
});
console.log(`✓ 剧本导入：${imp.episodeCount} 集，version=${imp.version}`);

// 3. 主体 + 状态图
let sbVersion = 0;
const subjectIdByName = {};
for (const s of SUBJECTS) {
  const r = await call('upsert_subject', {
    projectId: pid, baseVersion: sbVersion, name: s.name, kind: s.kind,
    aliases: s.aliases, note: s.note, episodeIds: [],
  });
  sbVersion = r.version;
  subjectIdByName[s.name] = r.subject.id;
}
console.log(`✓ 主体 ${SUBJECTS.length} 个（storyboard v${sbVersion}）`);

let imgCount = 0;
const storageKeyByFile = {};
for (const s of SUBJECTS) {
  for (const img of s.images) {
    const abs = path.join(SRC, img.file);
    const buf = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const up = await call('upload_asset', {
      projectId: pid, filename: path.basename(abs),
      dataBase64: buf.toString('base64'), mime: MIME[ext] ?? 'application/octet-stream',
    });
    storageKeyByFile[img.file] = up.storageKey;
    const r = await call('set_subject_image', {
      projectId: pid, baseVersion: sbVersion, subjectId: subjectIdByName[s.name],
      storageKey: up.storageKey, stateTag: img.stateTag, note: `源文件 ${img.file}`,
    });
    sbVersion = r.version;
    imgCount += 1;
  }
}
console.log(`✓ 状态图 ${imgCount} 张挂载完成`);

// 4. 导演台公共参数（2026-11-05 公共提示词层下线：不再写 prompt，公共内容改为逐段并入）
const sharedPrompt = [
  `${meta.visual_style.style_name}；${meta.visual_style.camera}，${meta.visual_style.film_stock}；色调：${meta.visual_style.palette}。`,
  `朝代纪律：明代制式（男子束发挽髻、僧人剃度光头）；古代夜戏光源只用油灯、灯笼、火塘余烬与月色。`,
  `风格后缀：${meta.visual_style.prompt_suffix}`,
  '去字幕四件套：无字幕、无字卡、无屏显文字、无水印。全片无背景音乐，仅环境声、动作音效与人声。',
].join('\n');
/** 公共提示词并入每段提示词（已包含则不重复追加；空段直接置为公共提示词） */
const mergeShared = (segPrompt) => {
  const cur = (segPrompt ?? '').trim();
  if (cur.includes(sharedPrompt)) return cur;
  return cur ? `${sharedPrompt}\n\n${cur}` : sharedPrompt;
};
let wb = await call('set_shared_params', { projectId: pid, baseVersion: 0, presetId: 'h3' });
let wbVersion = wb.version;
console.log(`✓ 公共参数（presetId=h3，workbench v${wbVersion}；公共提示词将逐段并入 videoPrompt）`);

// 5. 35 段：默认片段 1 复用为 A-01，其余 add_segment
wb = await call('get_workbench', { projectId: pid });
const firstShot = wb.shots?.[0];
const shotIds = [];
if (firstShot) {
  const r = await call('set_shot_prompt', {
    projectId: pid, baseVersion: wbVersion, shotId: firstShot.id,
    description: `${segments[0].code} ${segments[0].title}`,
    duration: segments[0].duration, videoPrompt: mergeShared(segments[0].prompt),
  });
  wbVersion = r.version;
  shotIds.push(firstShot.id);
} else throw new Error('导演台默认片段缺失');
for (let i = 1; i < segments.length; i++) {
  const seg = segments[i];
  const r = await call('add_segment', {
    projectId: pid, baseVersion: wbVersion,
    description: `${seg.code} ${seg.title}`, duration: seg.duration,
  });
  wbVersion = r.version;
  shotIds.push(r.segment.id);
  const pr = await call('set_shot_prompt', {
    projectId: pid, baseVersion: wbVersion, shotId: r.segment.id, videoPrompt: mergeShared(seg.prompt),
  });
  wbVersion = pr.version;
}
console.log(`✓ 导演台 ${shotIds.length} 段（A-01 复用默认片段）`);

// 6. 每段主体绑定（按段头「图片来源」行）
let linkCount = 0;
for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const names = [...new Set(seg.refFiles.map((f) => FILE_TO_SUBJECT[path.basename(f).replace(/\.[^.]+$/, '')]).filter(Boolean))];
  for (const name of names) {
    const r = await call('link_subject_to_shot', {
      projectId: pid, baseVersion: wbVersion, shotId: shotIds[i], subjectId: subjectIdByName[name],
    });
    wbVersion = r.version;
    linkCount += 1;
  }
}
console.log(`✓ 主体绑定 ${linkCount} 次`);

// 7. 汇总校验
const final = await call('get_workbench', { projectId: pid });
const subjects = await call('list_subjects', { projectId: pid });
const assets = await call('list_assets', { projectId: pid, scope: 'project' });
const eps = await call('list_episodes', { projectId: pid });
console.log('\n===== 导入完成汇总 =====');
console.log(`项目: ${project.title} (${pid})`);
console.log(`剧集: ${eps.episodes.length}（${eps.episodes.map((e) => `${e.number}.${e.title}`).join(' / ')}）`);
console.log(`主体: ${subjects.subjects.length} 个 / 状态图 ${imgCount} 张`);
console.log(`资产(CAS): ${assets.assets.length} 条`);
console.log(`片段: ${final.shots.length} 个，总时长 ${final.totalDuration}s，workbench v${final.version}`);
console.log(`打开: http://localhost:4173/#/editor/${pid}`);
await client.close();
