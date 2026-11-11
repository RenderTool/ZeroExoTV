/**
 * MCP 改图 E2E：对画布上已有生成图调用 edit_canvas_image（图生图），验证新节点落画布、原图不变。
 */
import { Client } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import path from 'node:path';

const client = new Client({ name: 'edit-e2e', version: '0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('mcp-server/dist/index.js')],
  env: { ...process.env, ZEROEXO_DATA_ROOT: process.env.ZEROEXO_DATA_ROOT || 'D:\\Test' },
}));
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  if (res.isError) throw new Error(`${name}: ${text}`);
  return text ? JSON.parse(text) : null;
};

const cur = await call('get_current_project');
const projectId = cur?.project?.projectId;
const canvas = await call('get_canvas', { projectId, canvasId: 'main', includeGraph: true });
const candidates = (canvas.graph?.nodes ?? []).filter((n) => n.data?.storageKey && n.type === 'image' && n.data?.status === 'success');
const source = candidates.find((n) => String(n.data.storageKey).startsWith('cas:')) ?? candidates[0];
if (!source) throw new Error('画布上没有可用于改图的图片节点');
console.log('source', source.id, source.data.storageKey, `${source.data.naturalWidth}x${source.data.naturalHeight}`);

const job = await call('edit_canvas_image', {
  projectId,
  sourceNodeId: source.id,
  prompt: '只把画面中的路灯换成暖黄色老式铁艺路灯（灯罩带雨滴、光线更暖），其余保持不变：人物姿势与服装、构图、雨夜街道、湿地面倒影和整体色调都保持原样。',
  title: '路灯改暖',
});
console.log('job', job.jobId, job.queued);

let last = '';
const started = Date.now();
for (;;) {
  const st = await call('get_canvas_image_job', { projectId, jobId: job.jobId });
  const line = `${st.state} ${st.completed ?? 0}/${st.total ?? 1}`;
  if (line !== last) { last = line; console.log(`[${Math.round((Date.now() - started) / 1000)}s]`, line); }
  if (st.state === 'done' || st.state === 'error') { console.log(JSON.stringify(st, null, 2)); break; }
  if (Date.now() - started > 10 * 60 * 1000) { console.log('timeout'); break; }
  await new Promise((r) => setTimeout(r, 4000));
}

const after = await call('get_canvas', { projectId, canvasId: 'main', includeGraph: true });
const edited = (after.graph?.nodes ?? []).filter((n) => String(n.id).startsWith(`mcp_${job.jobId}`));
console.log('edited nodes', edited.map((n) => ({ id: n.id, key: n.data?.storageKey, size: `${n.data?.naturalWidth}x${n.data?.naturalHeight}` })));
await client.close();
process.exit(0);
