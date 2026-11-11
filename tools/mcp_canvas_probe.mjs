import { Client } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import path from 'node:path';

const client = new Client({ name: 'canvas-probe', version: '0' }, { capabilities: {} });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('mcp-server/dist/index.js')],
  env: { ...process.env, ZEROEXO_DATA_ROOT: process.env.ZEROEXO_DATA_ROOT || 'D:\\Test' },
}));
const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return text ? JSON.parse(text) : null;
};
const cur = await call('get_current_project', {});
const pid = cur?.project?.projectId;
const canvas = await call('get_canvas', { projectId: pid, canvasId: 'main', includeGraph: true });
const nodes = (canvas.graph?.nodes ?? []).filter((n) => String(n.id).startsWith('mcp_'));
console.log('project', pid, 'mcp nodes', nodes.length);
for (const n of nodes) {
  console.log(n.id, n.data?.status, `${n.data?.naturalWidth}x${n.data?.naturalHeight}`, 'size', n.size ? `${Math.round(n.size.width)}x${Math.round(n.size.height)}` : '-');
}
await client.close();
process.exit(0);
