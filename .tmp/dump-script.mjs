import fs from 'node:fs';
const root = 'D:/ZeroExoFinTest';
const pid = '7QhO8_hi9PcV';
const sc = JSON.parse(fs.readFileSync(`${root}/projects/${pid}/entities/script.json`, 'utf8'));
console.log('keys', Object.keys(sc).join(','));
for (const ep of sc.episodes ?? []) {
  console.log('\n#### EP', ep.id, ep.title);
  const text = (ep.content ?? '')
    .replace(/<[^>]+>/g, '\n')
    .split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
  console.log(text);
}
