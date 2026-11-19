/** 一次性脚本：把 3 个有台词片段改成「台词独立块」格式（2026-11-19 用户口径） */
const TOKEN = 'zxp_local_verify_20261119';
const BASE = 'http://127.0.0.1:8899/mcp';
let sessionId = null;

function parseBody(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const lines = t.split('\n').filter((l) => l.startsWith('data:'));
  const last = lines[lines.length - 1];
  return last ? JSON.parse(last.slice(5).trim()) : null;
}

async function post(payload) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return parseBody(text);
}

async function call(name, args) {
  const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  if (r?.result?.isError) throw new Error(`MCP ${name} error: ${JSON.stringify(r.result).slice(0, 500)}`);
  const content = r?.result?.content?.[0]?.text;
  return content ? JSON.parse(content) : r?.result;
}

const PROJECT = '7QhO8_hi9PcV';

const shots = [
  {
    shotId: 'seg-mwncf2db-1dd7a6',
    speaker: '老钟',
    line: '钟不是坏了，是不肯走。',
    imagePrompt: `subject_definitions:
<Subject 1> 是角色米拉，取自 @Picture1 （定妆图）：只锁身份，不描述外貌；姿势与构图随本段调度。
<Subject 2> 是角色老钟，取自 @Picture2（定妆图）：只锁身份，不描述外貌；姿势与构图随本段调度。
<Subject 3> 是本段场景，取自 @Picture3（概念图）：锁建筑形制、地平线与光位；构图随角色调度。

detailed_description:
画面为干净画面：无字幕、无字卡、无屏显文字、无任何可读文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
本段画面内主体只有 <Subject 1> 米拉、<Subject 2> 老钟；其余角色均不在场。
[Shot 2] 中景，固定机位缓慢推近，轴线固定。空间调度：<Subject 3> 钟表铺（白天·内景）；本段动作：<Subject 2> 老钟摘下圆眼镜擦灰，抬眼看向米拉，动作到终点态即停，不转身离画。声音：环境声与动作音效。

台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 钟不是坏了，是不肯走。</d>

overall_soundscape:
本段仅环境声与动作音效：风声、脚步与器物轻响。全段无人旁白；老钟仅台词处开口、其余时间双唇紧闭；米拉全程双唇紧闭、不做任何说话口型。

non_diegetic_music:
无叙事性音乐。不添加任何背景音乐与旋律乐器；仅保留叙事环境声与物理音效。`,
    videoPrompt: `画面为干净画面：无字幕、无字卡、无屏显文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
[Shot 2] 中景，固定机位缓慢推近。本段画面内主体只有 <Subject 1> 米拉、<Subject 2> 老钟；其余角色均不在场。 动作：<Subject 2> 老钟摘下圆眼镜擦灰，抬眼看向米拉，停住。声音：环境声与脚步。
台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 钟不是坏了，是不肯走。</d>
主体：<Subject 1>（米拉）、<Subject 2>（老钟）、<Subject 3>（钟表铺） 走位沿用首帧。`,
  },
  {
    shotId: 'seg-mwncf30t-0a7240',
    speaker: '老钟',
    line: '它缺的是有人陪着一起转。',
    imagePrompt: `subject_definitions:
<Subject 1> 是角色老钟，取自 @Picture1（定妆图）：只锁身份，不描述外貌；姿势与构图随本段调度。
<Subject 2> 是本段场景，取自 @Picture2（概念图）：锁建筑形制、地平线与光位；构图随角色调度。

detailed_description:
画面为干净画面：无字幕、无字卡、无屏显文字、无任何可读文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
本段画面内主体只有 <Subject 1> 老钟；其余角色均不在场。
[Shot 1] 中近景，固定机位缓慢推近，轴线固定。空间调度：<Subject 2> 地下齿轮室（夜·内景）；本段动作：<Subject 1> 老钟把齿轮放在灯下，手掌按住齿轮外缘，动作到终点态即停，不转身离画。声音：环境声与动作音效。

台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 它缺的是有人陪着一起转。</d>

overall_soundscape:
本段仅环境声与动作音效：风声、脚步与器物轻响。全段无人旁白；老钟仅台词处开口、其余时间双唇紧闭。

non_diegetic_music:
无叙事性音乐。不添加任何背景音乐与旋律乐器；仅保留叙事环境声与物理音效。`,
    videoPrompt: `画面为干净画面：无字幕、无字卡、无屏显文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
[Shot 1] 中近景，固定机位缓慢推近。本段画面内主体只有 <Subject 1> 老钟；其余角色均不在场。 动作：<Subject 1> 老钟把齿轮放在灯下，手掌按住齿轮外缘，停住。声音：环境声与脚步。
台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 它缺的是有人陪着一起转。</d>
主体：<Subject 1>（老钟）、<Subject 2>（地下齿轮室） 走位沿用首帧。`,
  },
  {
    shotId: 'seg-mwncf3o4-7e68e7',
    speaker: '老钟',
    line: '今晚必须让钟重新报时。',
    imagePrompt: `subject_definitions:
<Subject 1> 是角色老钟，取自 @Picture1（定妆图）：只锁身份，不描述外貌；姿势与构图随本段调度。
<Subject 2> 是本段场景，取自 @Picture2（概念图）：锁建筑形制、地平线与光位；构图随角色调度。

detailed_description:
画面为干净画面：无字幕、无字卡、无屏显文字、无任何可读文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
本段画面内主体只有 <Subject 1> 老钟；其余角色均不在场。
[Shot 1] 中近景，固定机位缓慢推近，轴线固定。空间调度：<Subject 2> 山坡灯塔（黄昏·外景）；灯塔的光扫过小镇，<Subject 1> 老钟站在塔下抬眼看向钟楼方向，动作到终点态即停，不转身离画。声音：环境声与动作音效。

台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 今晚必须让钟重新报时。</d>

overall_soundscape:
本段仅环境声与动作音效：风声、脚步与器物轻响。全段无人旁白；老钟仅台词处开口、其余时间双唇紧闭。

non_diegetic_music:
无叙事性音乐。不添加任何背景音乐与旋律乐器；仅保留叙事环境声与物理音效。`,
    videoPrompt: `画面为干净画面：无字幕、无字卡、无屏显文字、无水印、无标志；所有台词仅为声音，绝不渲染为画面文字。
[Shot 1] 中近景，固定机位缓慢推近。本段画面内主体只有 <Subject 1> 老钟；其余角色均不在场。 动作：灯塔的光扫过小镇，<Subject 1> 老钟站在塔下抬眼看向钟楼方向，停住。声音：环境声与脚步。
台词（仅声音，画外念出，绝不渲染成画面文字）：
老钟：<d>[Chinese] 今晚必须让钟重新报时。</d>
主体：<Subject 1>（老钟）、<Subject 2>（山坡灯塔） 走位沿用首帧。`,
  },
];

async function main() {
  await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fix-dialogue', version: '0.0.1' } },
  });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const wb = await call('get_workbench', { projectId: PROJECT });
  let version = wb.version;
  console.log('workbench version', version);
  for (const s of shots) {
    const res = await call('set_shot_prompt', {
      projectId: PROJECT,
      baseVersion: version,
      shotId: s.shotId,
      imagePrompt: s.imagePrompt,
      videoPrompt: s.videoPrompt,
    });
    version = res.version;
    console.log(s.shotId, '-> version', version, 'written', res.written);
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
