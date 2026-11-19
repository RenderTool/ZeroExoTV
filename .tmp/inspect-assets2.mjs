import fs from 'node:fs';
const p = 'D:/ZeroExoFinTest/.lf/zeroexo/app_state/zeroexo%3Aassets.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
console.log('top keys', Object.keys(raw).join(','));
const list = raw.assets ?? raw.items ?? [];
console.log('count', list.length);
const dir = list.filter((a) => a.data?.originSource === 'director');
console.log('director assets', dir.length);
for (const a of dir) {
  console.log(a.id, '|', a.kind, '| node', a.data?.originNodeId, '| prompt?', typeof a.data?.prompt, String(a.data?.prompt ?? '').slice(0, 30), '| chain?', !!a.data?.generation?.chain, '| params seed', a.data?.generation?.params?.seed);
}
