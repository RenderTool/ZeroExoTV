/** 临时 MCP 客户端（本地验证用，不提交仓库）：node .tmp/mcp.mjs <tool> <jsonArgs> */
const TOKEN = 'zxp_local_verify_20261119';
const BASE = 'http://127.0.0.1:8899/mcp';
const [toolName, argsJson] = process.argv.slice(2);
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

async function main() {
  await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tmp', version: '0.0.1' } },
  });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const r = await post({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: toolName, arguments: JSON.parse(argsJson ?? '{}') },
  });
  console.log(JSON.stringify(r?.result?.content ?? r, null, 2).slice(0, 12000));
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
