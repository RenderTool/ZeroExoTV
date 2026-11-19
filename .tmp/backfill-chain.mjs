/** 一次性补齐：给已落库的导演台成片补 generation.chain（历史只读子画布用） */
import fs from 'node:fs';

const ROOT = 'D:/ZeroExoFinTest';
const PID = '7QhO8_hi9PcV';
const ASSETS = `${ROOT}/.lf/zeroexo/app_state/zeroexo%3Aassets.json`;

const wb = JSON.parse(fs.readFileSync(`${ROOT}/projects/${PID}/entities/workbench.json`, 'utf8'));
const shots = wb.shots ?? [];
const byId = new Map(shots.map((s) => [s.id, s]));

const raw = JSON.parse(fs.readFileSync(ASSETS, 'utf8'));
const value = raw.value ?? raw;

const FIT = { width: 620, height: 348 };
let patched = 0;
for (const key of Object.keys(value)) {
  const a = value[key];
  if (!a || typeof a !== 'object') continue;
  const d = a.data ?? {};
  const gen = d.generation;
  if (!gen || d.originSource !== 'director') continue;
  if (gen.chain?.nodes?.length) continue;
  const shotId = d.originNodeId;
  const shot = byId.get(shotId);
  if (!shot) { console.log('skip (no shot)', a.id, shotId); continue; }
  const refs = shot.references ?? [];
  const nodes = [];
  const inputs = [];
  let slot = 0;
  for (const ref of refs) {
    const k = typeof ref.storageKey === 'string' ? ref.storageKey : '';
    if (!k) continue;
    slot += 1;
    const id = `chain_input_${slot}`;
    nodes.push({
      id,
      type: ref.kind === 'video' ? 'video' : 'image',
      title: ref.title || `参考图${slot}`,
      position: { x: 60, y: 60 + (slot - 1) * 380 },
      size: { ...FIT },
      data: { kind: ref.kind === 'video' ? 'video' : 'image', storageKey: k, status: 'success', __readonly: true },
    });
    inputs.push({ slot, nodeId: id, storageKey: k });
  }
  nodes.push({
    id: shotId,
    type: 'video',
    title: a.title || '成片',
    position: { x: 760, y: 60 },
    size: { ...FIT },
    data: { kind: 'video', storageKey: d.storageKey, status: 'success', prompt: gen.prompt ?? '', __readonly: true },
  });
  gen.chain = {
    nodes,
    edges: [],
    ...(inputs.length ? { inputs } : {}),
    prompt: gen.prompt,
    model: gen.model,
    params: gen.params,
    createdAt: new Date().toISOString(),
  };
  d.prompt = gen.prompt ?? '';
  patched += 1;
  console.log('patched', a.id, shotId, 'refs', inputs.length);
}

if (patched > 0) {
  fs.copyFileSync(ASSETS, `${ASSETS}.bak-chain-${Date.now()}`);
  fs.writeFileSync(ASSETS, JSON.stringify(raw, null, 2));
}
console.log('total patched', patched);
