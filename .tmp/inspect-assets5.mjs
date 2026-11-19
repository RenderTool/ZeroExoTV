import fs from 'node:fs';
const p = 'D:/ZeroExoFinTest/.lf/zeroexo/app_state/zeroexo%3Aassets.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const v = raw.value ?? raw;
const list = Object.values(v).filter((x) => x && typeof x === 'object');
console.log('count', list.length);
const dir = list.filter((a) => a.data?.originSource === 'director');
console.log('director assets', dir.length);
for (const a of dir) {
  console.log(a.id, '|', a.kind, '| node', a.data?.originNodeId, '| chain?', !!a.data?.generation?.chain, '| promptLen', String(a.data?.prompt ?? '').length, '| genPromptLen', String(a.data?.generation?.prompt ?? '').length, '| seed', a.data?.generation?.params?.seed);
}
