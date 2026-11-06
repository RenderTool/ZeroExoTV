/**
 * ZV-005 导入完整性只读验证（临时脚本，跑完即删）：
 * 以 stdio 客户端拉起 mcp-server/dist，调用只读 MCP 工具核对
 * 项目/剧集/主体/资产/导演台片段统计，不写任何数据。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, ZEROEXO_MCP_TOKEN: 'zxp_zv005_import' },
});
const client = new Client({ name: 'zv005-verify', version: '0.0.1' });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? '';
  const parsed = JSON.parse(text);
  if (parsed.error) throw new Error(`${name}: ${JSON.stringify(parsed.error)}`);
  return parsed;
}

const projects = await call('list_projects', {});
console.log('项目列表:', JSON.stringify(projects, null, 2));

const list = Array.isArray(projects) ? projects : (projects.projects ?? []);
const target = list.find((p) => p.title === 'ZV-005_xszpm');
if (!target) throw new Error('找不到导入项目');
const pid = target.id;
console.log(`目标项目: ${target.title} (${pid})`);

const eps = await call('list_episodes', { projectId: pid });
console.log(`剧集: ${eps.episodes.length} 个`, eps.episodes.map((e) => `${e.number}.${e.title}(片段${e.segmentCount})`).join(' / '));

const subjects = await call('list_subjects', { projectId: pid });
let imgTotal = 0;
for (const s of subjects.subjects) imgTotal += (s.images?.length ?? 0);
console.log(`主体: ${subjects.subjects.length} 个, 状态图合计 ${imgTotal} 张`);
console.log('  ', subjects.subjects.map((s) => `${s.name}[${s.kind}]x${s.images?.length ?? 0}`).join(', '));

const assets = await call('list_assets', { projectId: pid, scope: 'project' });
console.log(`资产(CAS): ${assets.assets?.length ?? 0} 条`);

const wb = await call('get_workbench', { projectId: pid });
const withPrompt = wb.shots.filter((s) => s.videoPrompt).length;
const withRefs = wb.shots.filter((s) => s.references?.length).length;
const fiveSec = wb.shots.filter((s) => s.duration === 5).length;
console.log(`导演台: ${wb.shots.length} 段, 总时长 ${wb.totalDuration}s, v${wb.version}`);
console.log(`  有videoPrompt: ${withPrompt}, 有references绑定: ${withRefs}, 5s段: ${fiveSec}`);
console.log(`  首段: ${JSON.stringify({ id: wb.shots[0]?.id, desc: wb.shots[0]?.description, dur: wb.shots[0]?.duration, refs: wb.shots[0]?.references?.length, hasPrompt: !!wb.shots[0]?.videoPrompt })}`);
const sharedAssets = wb.sharedParams?.assets?.length ?? 0;
// 2026-11-05 公共提示词层下线：sharedParams 不再有 prompt（历史数据已逐段迁移；如仍出现则为迁移遗漏，应上报）
console.log(`  公共参数: presetId=${wb.sharedParams?.presetId}, 公共资产${sharedAssets}${wb.sharedParams?.prompt ? '（注意：仍残留已下线的 prompt 字段）' : ''}`);

await client.close();
