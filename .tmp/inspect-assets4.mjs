import fs from 'node:fs';
const p = 'D:/ZeroExoFinTest/.lf/zeroexo/app_state/zeroexo%3Aassets.json';
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
const v = raw.value ?? raw;
console.log('type', typeof v, 'keys', Object.keys(v).slice(0, 40));
const k0 = Object.keys(v)[0];
console.log('sample entry key', k0, 'type', typeof v[k0], String(JSON.stringify(v[k0]).slice(0, 300)));
