import fs from 'node:fs';
const root = 'D:/ZeroExoFinTest/projects/7QhO8_hi9PcV';
const dir = `${root}/entities`;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const txt = fs.readFileSync(`${dir}/${f}`, 'utf8');
  if (f === 'canvas-assets.json' || f.includes('asset')) console.log(f, 'size', txt.length);
}
const as = JSON.parse(fs.readFileSync(`${dir}/canvas-assets.json`, 'utf8'));
const items = Array.isArray(as) ? as : (as.items ?? as.assets ?? []);
console.log('asset count', items.length, 'keys of first', Object.keys(items[0] ?? {}).join(','));
const vids = items.filter((a) => (a.kind === 'video' || String(a.data?.storageKey || '').endsWith('.mp4')));
console.log('videos', vids.length);
for (const v of vids.slice(0, 4)) {
  const d = v.data ?? {};
  console.log('\n---', v.id, v.title, d.storageKey);
  console.log('data keys:', Object.keys(d).join(','));
  console.log('generation:', JSON.stringify(d.generation)?.slice(0, 300));
  console.log('prompt:', typeof d.prompt === 'string' ? d.prompt.slice(0, 80) : d.prompt);
}
