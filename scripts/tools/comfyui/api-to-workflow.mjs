/**
 * API 格式 prompt JSON → ComfyUI 可视化 workflow（UI 格式）。
 *
 * 用途：插件内置模板（templates/reference_video.json）是 API 格式，拖进 ComfyUI 画布不能直接看；
 * 本脚本按 /object_info 的 input_order / output 把节点与连线还原成 UI workflow，
 * 输出到 ComfyUI 的 user workflows 目录，画布「工作流 → 打开」即可查看。
 *
 * 用法：node scripts/tools/comfyui/api-to-workflow.mjs <api.json> [out.json]
 * 默认读取本机 custom_nodes/ComfyUI_ZeroExoNodes/templates/reference_video.json，
 * 输出 ComfyUI/user/default/workflows/zeroexo_reference_video.json。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const COMFY = 'D:/ComfyUI/ComfyUI_windows_portable/ComfyUI';
const API_FILE = process.argv[2]
  ?? `${COMFY}/custom_nodes/ComfyUI_ZeroExoNodes/templates/reference_video.json`;
const OUT_FILE = process.argv[3] ?? `${COMFY}/user/default/workflows/zeroexo_reference_video.json`;
const BASE = process.env.COMFYUI_BASE ?? 'http://127.0.0.1:8188';

const WIDGET_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO', 'COMFY_DYNAMICCOMBO_V3']);

/** 模板占位符默认值（与插件 TEMPLATE_DEFAULTS / VISIBLE_PARAMS 对齐；只为可视化，不参与运行） */
const ZX_DEFAULTS = {
  prompt: '', negative_prompt: '', width: 432, height: 240, frames: 49, frame_rate: 24,
  steps: 1, cfg: 1.0, seed: 1, guide_frames: 22, use_prev_guide: false,
  use_low_vram: false,
  lora_name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
  lora_strength: 1.0,
  sampler: 'res_multistep', scheduler: 'simple',
  shift_video: 12.0, shift_audio: 3.0,
  clear_vram_between_segments: true,
  cache_frames_codec: 'raw', cache_name: '',
  reference_image: '', guide_path: '', project: 'project', episode: 'ep01',
};
const substitute = (v) => {
  if (typeof v !== 'string') return v;
  // 整串就是占位符 → 保留默认值原本的类型（数字/布尔不能被转成字符串，否则控件校验失败）
  const whole = v.match(/^__zx:(\w+)__$/);
  if (whole) return ZX_DEFAULTS[whole[1]] ?? '';
  return v.replace(/__zx:(\w+)__/g, (_m, key) => String(ZX_DEFAULTS[key] ?? ''));
};
const isLinkType = (t) => typeof t === 'string' && !WIDGET_TYPES.has(t);
const isWidget = (spec) => Array.isArray(spec?.[0]) || WIDGET_TYPES.has(spec?.[0]);

const objectInfo = await (await fetch(`${BASE}/object_info`)).json();
const api = JSON.parse(readFileSync(API_FILE, 'utf8'));

// API node id（字符串，可能含冒号）→ UI 数字 id
const idMap = new Map(Object.keys(api).map((key, i) => [key, i + 1]));
const numId = (key) => idMap.get(String(key)) ?? Number(key) ?? 0;

const links = [];
let linkSeq = 0;
const nodes = [];

function widgetValue(info, name, fallback, nodeInputs) {
  const raw = nodeInputs[name];
  if (raw !== undefined && !(Array.isArray(raw) && raw.length === 2 && typeof raw[0] === 'string')) {
    return raw;
  }
  const spec = info.input?.required?.[name] ?? info.input?.optional?.[name];
  if (Array.isArray(spec?.[0])) return spec[1]?.default ?? spec[0][0];
  return spec?.[1]?.default ?? fallback;
}

let order = 0;
for (const [apiId, node] of Object.entries(api)) {
  const classType = node.class_type;
  const info = objectInfo[classType];
  if (!info) throw new Error(`object_info 缺少节点类型: ${classType}`);
  const nodeInputs = node.inputs ?? {};
  const orderNames = [
    ...(info.input_order?.required ?? Object.keys(info.input?.required ?? {})),
    ...(info.input_order?.optional ?? Object.keys(info.input?.optional ?? {})),
  ];
  const widgetNames = orderNames.filter((name) => isWidget((info.input?.required?.[name] ?? info.input?.optional?.[name])));
  const linkNames = orderNames.filter((name) => isLinkType((info.input?.required?.[name] ?? info.input?.optional?.[name])?.[0]));

  const inputs = linkNames.map((name) => {
    const spec = info.input?.required?.[name] ?? info.input?.optional?.[name];
    const linkType = Array.isArray(spec?.[0]) ? 'COMBO' : spec?.[0];
    return { name, type: linkType, link: null };
  });

  const outputs = (info.output ?? []).map((type, slot) => ({
    name: (info.output_name ?? [])[slot] ?? type,
    type,
    links: [],
    slot_index: slot,
  }));

  const widgetsValues = widgetNames.map((name) => substitute(widgetValue(info, name, undefined, nodeInputs)));
  const col = nodes.length % 4;
  const row = Math.floor(nodes.length / 4);
  nodes.push({
    id: numId(apiId),
    type: classType,
    pos: [40 + col * 380, 40 + row * 320],
    size: [340, 220],
    flags: {},
    order: order++,
    mode: 0,
    inputs,
    outputs,
    properties: { 'Node name for S&R': classType },
    widgets_values: widgetsValues,
  });
}

// 连线：API inputs 里的 ["源节点id", 槽位]
for (const [apiId, node] of Object.entries(api)) {
  const target = nodes.find((n) => n.id === numId(apiId));
  for (const [name, value] of Object.entries(node.inputs ?? {})) {
    if (!(Array.isArray(value) && value.length === 2 && typeof value[0] === 'string')) continue;
    const [srcApiId, srcSlot] = value;
    const src = nodes.find((n) => n.id === numId(srcApiId));
    if (!src) continue;
    const dstSlot = target.inputs.findIndex((i) => i.name === name);
    if (dstSlot < 0) continue; // 该输入在 object_info 里是 widget（如 KSampler 的 seed 不在连线表）
    const type = src.outputs?.[srcSlot]?.type ?? 'ANY';
    const linkId = ++linkSeq;
    links.push([linkId, src.id, srcSlot, target.id, dstSlot, type]);
    target.inputs[dstSlot].link = linkId;
    if (src.outputs?.[srcSlot]) src.outputs[srcSlot].links.push(linkId);
  }
}

const workflow = {
  last_node_id: Math.max(...nodes.map((n) => n.id)),
  last_link_id: linkSeq,
  nodes,
  links,
  groups: [],
  config: {},
  extra: { ds: { scale: 0.8, offset: [0, 0] } },
  version: 0.4,
};

mkdirSync(dirname(resolve(OUT_FILE)), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(workflow, null, 2), 'utf8');
console.log(`[api-to-workflow] ${Object.keys(api).length} nodes, ${links.length} links`);
console.log(`  in : ${resolve(API_FILE)}`);
console.log(`  out: ${resolve(OUT_FILE)}`);
