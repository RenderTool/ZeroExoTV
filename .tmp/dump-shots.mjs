import fs from 'node:fs';

const root = 'D:/ZeroExoFinTest';
const pid = '7QhO8_hi9PcV';
const wb = JSON.parse(fs.readFileSync(`${root}/projects/${pid}/entities/workbench.json`, 'utf8'));
const shots = wb.shots ?? [];
console.log('shots:', shots.length, 'version', wb.version);
for (const s of shots) {
  const ip = s.imagePrompt ?? '';
  console.log('\n=====', s.id, '| ep:', s.episodeId, '| dlg:', JSON.stringify(s.dialogue ?? null), '| spk:', JSON.stringify(s.speaker ?? null));
  console.log('--- imagePrompt ---\n' + ip);
  console.log('--- videoPrompt ---\n' + (s.videoPrompt ?? ''));
}
