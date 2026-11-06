/**
 * 端到端冒烟(临时脚本,跑完即删):
 * 以 IDE 同款 stdio 方式拉起 mcp-server,真实调用 create_project → create_episode → upsert_subject。
 * token 走 bootstrap:tokens.json 为空时 env 里的 token 自动登记为全权限。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOKEN = 'zxp_e2e_smoke_token';
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, ZEROEXO_MCP_TOKEN: TOKEN },
});
const client = new Client({ name: 'e2e-smoke', version: '0.0.1' });
await client.connect(transport);

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? JSON.stringify(res);
  console.log(`\n== ${name} ==\n${text}`);
  return JSON.parse(text);
}

const project = await call('create_project', { title: 'MCP 链路冒烟测试' });
const pid = project.projectId;

await call('create_episode', {
  projectId: pid,
  baseVersion: 0,
  title: '第一集·夜雨追凶',
  content: '<p>雨夜,码头。一盏灯笼在风里摇晃,更夫敲过三更。</p><p>黑影掠过屋脊,惊起檐下宿鸟。</p>',
});

await call('upsert_subject', {
  projectId: pid,
  baseVersion: 0,
  name: '更夫',
  kind: 'character',
  aliases: ['打更的老头'],
  note: '夜戏穿蓑衣,提灯笼;左腿微跛',
});

await call('list_projects', {});
await call('open_project', { projectId: pid });
await client.close();
