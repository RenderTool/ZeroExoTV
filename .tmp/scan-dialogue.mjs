import fs from 'node:fs';

const root = 'D:/ZeroExoFinTest';
const pid = '7QhO8_hi9PcV';
const wbPath = `${root}/projects/${pid}/entities/workbench.json`;
const wb = JSON.parse(fs.readFileSync(wbPath, 'utf8'));
console.log('workbench version:', wb.version, 'keys:', Object.keys(wb).join(','));

const shots = [];
for (const ep of wb.episodes ?? []) {
  for (const seg of ep.segments ?? []) {
    for (const shot of seg.shots ?? []) shots.push({ epId: ep.id, segId: seg.id, shot });
  }
}
console.log('episodes:', (wb.episodes ?? []).length, 'shots:', shots.length);
for (const { shot } of shots) {
  const ip = shot.imagePrompt ?? '';
  const hasQuote = /说[：:]/.test(ip);
  console.log('\n==', shot.id, '| dialogueField:', JSON.stringify(shot.dialogue ?? null), '| speaker:', JSON.stringify(shot.speaker ?? null), '| hasSay:', hasQuote);
}
