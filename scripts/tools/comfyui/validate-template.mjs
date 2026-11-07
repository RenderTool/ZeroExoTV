// 只读校验：模板替换后每个节点输入都在 object_info 里、下拉值合法、连线指向存在且槽位有效
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8188';
const file = 'D:/ComfyUI/ComfyUI_windows_portable/ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes/templates/reference_video.json';
const defaults = {
  prompt: '', negative_prompt: '', width: 432, height: 240, frames: 49, frame_rate: 24,
  steps: 1, cfg: 1.0, seed: 1, guide_frames: 22, use_prev_guide: false,
  use_low_vram: false,
  lora_name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
  lora_strength: 1.0,
  sampler: 'res_multistep', scheduler: 'simple', shift_video: 12, shift_audio: 3,
  clear_vram_between_segments: true, cache_frames_codec: 'raw', cache_name: '',
  reference_image: '', guide_path: '', project: 'project', episode: 'ep01',
};
const sub = (v) => {
  if (typeof v !== 'string') return v;
  const whole = v.match(/^__zx:(\w+)__$/);
  if (whole) return defaults[whole[1]] ?? '';
  return v.replace(/__zx:(\w+)__/g, (_m, k) => String(defaults[k] ?? ''));
};
const t = JSON.parse(readFileSync(file, 'utf8'));
const info = await (await fetch(`${BASE}/object_info`)).json();
const errors = [];
for (const [id, node] of Object.entries(t)) {
  const spec = info[node.class_type];
  if (!spec) { errors.push(`节点 ${id}: 未知 class_type ${node.class_type}`); continue; }
  const allowed = { ...(spec.input?.required ?? {}), ...(spec.input?.optional ?? {}) };
  for (const [name, raw] of Object.entries(node.inputs ?? {})) {
    const value = sub(raw);
    // 点号 = 动态组合框的子 widget（如 format.codec / selection.tau），object_info 不单列
    if (name.includes('.')) continue;
    if (!(name in allowed)) { errors.push(`${node.class_type}.${name}: object_info 无此输入`); continue; }
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
      const src = t[value[0]];
      if (!src) { errors.push(`${node.class_type}.${name}: 连线源 ${value[0]} 不存在`); continue; }
      const srcSpec = info[src.class_type];
      if (!srcSpec?.output || value[1] >= srcSpec.output.length) {
        errors.push(`${node.class_type}.${name}: 源槽位 ${value[0]}:${value[1]} 越界`);
      }
      continue;
    }
    const def = allowed[name];
    if (Array.isArray(def?.[0])) {
      // combo（老格式）或 options
      const opts = def[0];
      const ok = opts.includes(value) || (def[1]?.options ?? []).includes(value);
      if (!ok) errors.push(`${node.class_type}.${name}: 值 ${JSON.stringify(value)} 不在下拉 ${JSON.stringify(opts).slice(0, 80)}`);
    }
  }
}
if (errors.length) {
  console.log('FAIL');
  for (const e of errors) console.log(' -', e);
  process.exit(1);
}
console.log('OK: 模板替换后节点/下拉/连线全部合法');
