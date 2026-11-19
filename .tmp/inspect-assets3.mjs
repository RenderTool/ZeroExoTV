import fs from 'node:fs';
const p = 'D:/ZeroExoFinTest/.lf/zeroexo/app_state/zeroexo%3Aassets.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const v = raw.value ?? raw;
console.log('value keys', Object.keys(v).join(','));
const list = v.assets ?? v.items ?? [];
console.log('count', list.length);
const dir = list.filter((a) => a.data?.originSource === 'director');
console.log('director assets', dir.length);
for (const a of dir) {
  console.log('\n', a.id, '|', a.kind, '| node', a.data?.originNodeId, '| chain?', !!a.data?.generation?.chain, '| promptLen', String(a.data?.prompt ?? '').length);
}
console.log('\nlast 3 any:');
for (const a of list.slice(-3)) console.log(a.id, a.kind, a.data?.storageKey, Object.keys(a.data ?? {}).join(','));
