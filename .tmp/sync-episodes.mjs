/** 临时：读最新 storyboard version 后调 sync_subject_episodes（带冲突重试）。 */
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return parseBody(text);
}

async function call(name, args) {
  const r = await post({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name, arguments: args },
  });
  const text = r?.result?.content?.[0]?.text ?? '';
  return JSON.parse(text);
}

async function main() {
  await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tmp', version: '0.0.1' } },
  });
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const projectId = '7QhO8_hi9PcV';
  const apply = process.argv.includes('--apply');
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    const subj = await call('list_subjects', { projectId });
    const baseVersion = subj.version;
    last = await call('sync_subject_episodes', {
      projectId, baseVersion, dryRun: !apply, userConfirmed: apply || undefined,
    });
    if (!last?.error) {
      console.log(JSON.stringify({ attempt, baseVersion, ...last }, null, 2).slice(0, 3000));
      return;
    }
    console.error(`attempt ${attempt}: ${last.error.code} expected=${last.error.details?.expected} actual=${last.error.details?.actual}`);
    await new Promise((r) => setTimeout(r, 800));
  }
  console.error('GAVE UP', JSON.stringify(last));
  process.exit(1);
}

main().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
