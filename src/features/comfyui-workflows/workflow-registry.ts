/**
 * workflow-registry — 约定工作流的登记、校验与试跑（纯逻辑，无 React 依赖）
 *
 * 数据落地：唯一 localStorage 键 `zeroexo.comfyuiWorkflows`（envelope { schemaVersion, data }），
 * 地址不在此处保存——一律从 comfyui-endpoint 的 `zeroexo.comfyuiEndpoint` 读。
 *
 * 工作流格式：只接受 ComfyUI「API 格式」导出（顶层 = 节点 id → { class_type, inputs }）。
 * UI 格式（{ nodes: [], links: [] }）在 parseWorkflowApiJson 处明确拒绝并给出导出方法。
 *
 * 校验（validateAgainstObjectInfo）：
 * - 节点 class_type 必须存在于 /object_info；
 * - 节点里出现的每个字段，若 /object_info 声明为下拉清单（input.required/optional 的首项是字符串数组），
 *   取值必须在清单内（模型文件名即走这条规则）；
 * - 必填字段缺失逐条报出。
 *
 * 试跑（testRunWorkflow）：真实的 POST /prompt → GET /history/{promptId} → GET /view 拼产物地址，
 * 失败时原样回传上游错误（不做二次包装猜测）。
 */

import { create } from 'zustand';
import { readErrorBody } from '@/features/canvas-tabs/comfyui-bridge-client.js';

export const COMFYUI_WORKFLOWS_STORAGE_KEY = 'zeroexo.comfyuiWorkflows';
export const COMFYUI_WORKFLOWS_SCHEMA_VERSION = 1;

export type WorkflowPurpose = 'text2image' | 'image2image' | 'video' | 'other';
export type WorkflowOutputKind = 'image' | 'video' | 'gif';

export const WORKFLOW_PURPOSE_LABELS: Record<WorkflowPurpose, string> = {
  text2image: '文生图',
  image2image: '图生图',
  video: '视频',
  other: '其他',
};

export interface WorkflowFieldRef {
  nodeId: string;
  input: string;
}

export interface WorkflowInputMapping {
  positivePrompt?: WorkflowFieldRef;
  negativePrompt?: WorkflowFieldRef;
  seed?: WorkflowFieldRef;
  width?: WorkflowFieldRef;
  height?: WorkflowFieldRef;
  /** 图生图输入图像：取值是 ComfyUI input 目录下的图片文件名 */
  image?: WorkflowFieldRef;
  steps?: WorkflowFieldRef;
  cfg?: WorkflowFieldRef;
}

export interface WorkflowOutputMapping {
  nodeId: string;
  kind: WorkflowOutputKind;
}

export interface WorkflowApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type WorkflowApiJson = Record<string, WorkflowApiNode>;

export interface ComfyuiWorkflowEntry {
  id: string;
  name: string;
  purpose: WorkflowPurpose;
  workflow: WorkflowApiJson;
  inputMapping: WorkflowInputMapping;
  outputMapping: WorkflowOutputMapping;
  updatedAt: string;
}

// ===== 解析 =====

export type ParseWorkflowResult =
  | { ok: true; workflow: WorkflowApiJson }
  | { ok: false; error: string };

export function parseWorkflowApiJson(text: string): ParseWorkflowResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '顶层必须是 { 节点id: { class_type, inputs } } 对象' };
  }
  const root = parsed as Record<string, unknown>;
  if (Array.isArray(root['nodes']) || Array.isArray(root['links'])) {
    return {
      ok: false,
      error: '这是 ComfyUI 的 UI 格式（nodes/links），请用 ComfyUI 菜单「Save (API Format)」导出后再粘贴',
    };
  }
  const workflow: WorkflowApiJson = {};
  for (const [nodeId, node] of Object.entries(root)) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return { ok: false, error: `节点 ${nodeId} 不是对象` };
    }
    const n = node as Record<string, unknown>;
    if (typeof n['class_type'] !== 'string' || !n['class_type']) {
      return { ok: false, error: `节点 ${nodeId} 缺少 class_type` };
    }
    if (typeof n['inputs'] !== 'object' || n['inputs'] === null || Array.isArray(n['inputs'])) {
      return { ok: false, error: `节点 ${nodeId}（${n['class_type']}）缺少 inputs 对象` };
    }
    workflow[nodeId] = { class_type: n['class_type'], inputs: n['inputs'] as Record<string, unknown> };
  }
  if (Object.keys(workflow).length === 0) return { ok: false, error: '工作流为空（没有任何节点）' };
  return { ok: true, workflow };
}

// ===== 参数注入 =====

export interface WorkflowInputValues {
  positivePrompt?: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  image?: string;
  steps?: number;
  cfg?: number;
}

export type ApplyInputsResult =
  | { ok: true; prompt: WorkflowApiJson }
  | { ok: false; error: string };

/** 按映射把参数写进节点 inputs；映射指向不存在的节点 → 明确报错（不改原工作流） */
export function applyWorkflowInputs(
  workflow: WorkflowApiJson,
  mapping: WorkflowInputMapping,
  values: WorkflowInputValues,
): ApplyInputsResult {
  const prompt = JSON.parse(JSON.stringify(workflow)) as WorkflowApiJson;
  for (const key of Object.keys(mapping) as Array<keyof WorkflowInputMapping>) {
    const ref = mapping[key];
    if (!ref || !ref.nodeId || !ref.input) continue;
    const value = values[key];
    if (value === undefined) continue;
    const node = prompt[ref.nodeId];
    if (!node) return { ok: false, error: `${key} 映射指向不存在的节点 id「${ref.nodeId}」` };
    node.inputs[ref.input] = value;
  }
  return { ok: true, prompt };
}

/** 必填映射（规格要求）：正向提示词与输出映射 */
export function findMappingIssues(entry: Pick<ComfyuiWorkflowEntry, 'inputMapping' | 'outputMapping' | 'workflow'>): string[] {
  const issues: string[] = [];
  if (!entry.inputMapping.positivePrompt) issues.push('缺少「正向提示词」映射');
  if (!entry.outputMapping.nodeId) issues.push('缺少「输出节点 id」');
  for (const [key, ref] of Object.entries(entry.inputMapping)) {
    if (!ref) continue;
    if (!ref.nodeId || !ref.input) {
      issues.push(`映射「${key}」的节点 id 或字段为空`);
    } else if (!entry.workflow[ref.nodeId]) {
      issues.push(`映射「${key}」指向不存在的节点 id「${ref.nodeId}」`);
    }
  }
  if (entry.outputMapping.nodeId && !entry.workflow[entry.outputMapping.nodeId]) {
    issues.push(`输出映射指向不存在的节点 id「${entry.outputMapping.nodeId}」`);
  }
  return issues;
}

// ===== /object_info 校验 =====

export interface ObjectInfoNode {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export type ObjectInfoJson = Record<string, ObjectInfoNode>;

const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|pth|bin|onnx|gguf)$/i;

/** 下拉清单：spec 形如 [ [ 'a', 'b' ], {...} ]；返回 null = 不是下拉 */
function comboOptions(spec: unknown): string[] | null {
  if (!Array.isArray(spec)) return null;
  const first = spec[0];
  if (!Array.isArray(first) || first.length === 0) return null;
  if (!first.every((v) => typeof v === 'string')) return null;
  return first as string[];
}

function isLinkValue(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number';
}

export function validateAgainstObjectInfo(workflow: WorkflowApiJson, objectInfo: ObjectInfoJson): string[] {
  const errors: string[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const info = objectInfo[node.class_type];
    if (!info) {
      errors.push(`节点 ${nodeId} 的 class_type「${node.class_type}」在 /object_info 中不存在（插件未安装或未启用）`);
      continue;
    }
    const required = info.input?.required ?? {};
    const optional = info.input?.optional ?? {};
    for (const key of Object.keys(required)) {
      if (!(key in node.inputs)) {
        errors.push(`节点 ${nodeId}（${node.class_type}）缺少必填字段「${key}」`);
      }
    }
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLinkValue(value)) continue; // 连线输入由工作流图负责，不校验取值
      const spec = required[key] ?? optional[key];
      const options = comboOptions(spec);
      if (!options) continue;
      const str = typeof value === 'string' ? value : String(value);
      if (!options.includes(str)) {
        const kind = MODEL_FILE_PATTERN.test(str) ? '模型文件不存在' : '取值不在可选清单';
        errors.push(`节点 ${nodeId}（${node.class_type}）字段「${key}」：${kind}「${str}」`);
      }
    }
  }
  return errors;
}

export async function fetchObjectInfo(baseUrl: string, token?: string): Promise<ObjectInfoJson> {
  const headers: Record<string, string> = {};
  if (token) headers['X-ZeroExo-Token'] = token;
  const res = await fetch(`${baseUrl}/object_info`, { headers });
  if (!res.ok) throw new Error(`/object_info ${await readErrorBody(res)}`);
  return (await res.json()) as ObjectInfoJson;
}

// ===== 试跑 =====

export interface WorkflowOutputFile {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
}

export type WorkflowTestOutcome =
  | { ok: true; promptId: string; files: WorkflowOutputFile[]; rawHistory: unknown }
  | { ok: false; stage: 'parse' | 'submit' | 'poll' | 'output'; message: string; raw?: unknown };

interface ComfyHistoryOutput {
  images?: Array<{ filename?: string; subfolder?: string; type?: string }>;
  gifs?: Array<{ filename?: string; subfolder?: string; type?: string }>;
  videos?: Array<{ filename?: string; subfolder?: string; type?: string }>;
}

function outputFiles(
  baseUrl: string,
  output: ComfyHistoryOutput | undefined,
  kind: WorkflowOutputKind,
): WorkflowOutputFile[] {
  const buckets = kind === 'image'
    ? [output?.images]
    : kind === 'gif'
      ? [output?.gifs, output?.images]
      : [output?.gifs, output?.videos, output?.images];
  const files: WorkflowOutputFile[] = [];
  for (const bucket of buckets) {
    for (const f of bucket ?? []) {
      if (!f.filename) continue;
      const subfolder = f.subfolder ?? '';
      const type = f.type ?? 'output';
      const qs = new URLSearchParams({ filename: f.filename, subfolder, type }).toString();
      files.push({ filename: f.filename, subfolder, type, url: `${baseUrl}/view?${qs}` });
    }
    if (files.length > 0) break;
  }
  return files;
}

export interface TestRunOptions {
  timeoutMs?: number;
  pollMs?: number;
  token?: string;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 最小参数：调用方传什么就注什么；未传的可选字段保持工作流原值 */
export async function testRunWorkflow(
  baseUrl: string,
  workflow: WorkflowApiJson,
  mapping: WorkflowInputMapping,
  outputMapping: WorkflowOutputMapping,
  values: WorkflowInputValues,
  options: TestRunOptions = {},
): Promise<WorkflowTestOutcome> {
  const applied = applyWorkflowInputs(workflow, mapping, values);
  if (!applied.ok) return { ok: false, stage: 'parse', message: applied.error };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['X-ZeroExo-Token'] = options.token;
  const clientId = `zeroexo-probe-${Date.now()}`;
  let promptId = '';
  try {
    const res = await fetch(`${baseUrl}/prompt`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: applied.prompt, client_id: clientId }),
    });
    if (!res.ok) {
      return { ok: false, stage: 'submit', message: `/prompt ${await readErrorBody(res)}` };
    }
    const body = (await res.json().catch(() => null)) as { prompt_id?: string } | null;
    promptId = body?.prompt_id ?? '';
    if (!promptId) return { ok: false, stage: 'submit', message: '/prompt 未返回 prompt_id', raw: body };
  } catch (err) {
    return { ok: false, stage: 'submit', message: `提交失败：${err instanceof Error ? err.message : String(err)}` };
  }

  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollMs = options.pollMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;
  let lastHistory: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { headers });
      if (!res.ok) {
        return { ok: false, stage: 'poll', message: `/history ${await readErrorBody(res)}` };
      }
      const history = (await res.json()) as Record<string, unknown>;
      const entry = history[promptId] as
        | { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, ComfyHistoryOutput> }
        | undefined;
      if (!entry) {
        await sleep(pollMs);
        continue;
      }
      lastHistory = entry;
      if (entry.status?.status_str === 'error') {
        return {
          ok: false,
          stage: 'poll',
          message: '上游执行失败（原始 error 见下方）',
          raw: entry.status.messages ?? entry,
        };
      }
      const files = outputFiles(baseUrl, entry.outputs?.[outputMapping.nodeId], outputMapping.kind);
      if (files.length === 0) {
        const outputs = entry.outputs?.[outputMapping.nodeId];
        if (!outputs) {
          return {
            ok: false,
            stage: 'output',
            message: `输出节点 ${outputMapping.nodeId} 没有产物；实际产出节点：${Object.keys(entry.outputs ?? {}).join('、') || '无'}`,
            raw: entry,
          };
        }
        return { ok: false, stage: 'output', message: `输出节点 ${outputMapping.nodeId} 没有 ${outputMapping.kind} 产物`, raw: outputs };
      }
      return { ok: true, promptId, files, rawHistory: entry };
    } catch (err) {
      return { ok: false, stage: 'poll', message: `轮询失败：${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { ok: false, stage: 'poll', message: `试跑超时（${Math.round(timeoutMs / 1000)}s）`, raw: lastHistory };
}

// ===== 持久化 =====

function sanitizeFieldRef(raw: unknown): WorkflowFieldRef | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const nodeId = typeof r.nodeId === 'string' ? r.nodeId.trim() : '';
  const input = typeof r.input === 'string' ? r.input.trim() : '';
  return nodeId && input ? { nodeId, input } : undefined;
}

function sanitizeMapping(raw: unknown): WorkflowInputMapping {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: WorkflowInputMapping = {};
  for (const key of ['positivePrompt', 'negativePrompt', 'seed', 'width', 'height', 'image', 'steps', 'cfg'] as const) {
    const ref = sanitizeFieldRef(r[key]);
    if (ref) out[key] = ref;
  }
  return out;
}

function sanitizeEntry(raw: unknown): ComfyuiWorkflowEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) return null;
  if (typeof r.workflow !== 'object' || r.workflow === null) return null;
  const purpose = (['text2image', 'image2image', 'video', 'other'] as const).includes(r.purpose as WorkflowPurpose)
    ? (r.purpose as WorkflowPurpose)
    : 'other';
  const output = (typeof r.outputMapping === 'object' && r.outputMapping !== null ? r.outputMapping : {}) as Record<string, unknown>;
  const kind = (['image', 'video', 'gif'] as const).includes(output.kind as WorkflowOutputKind)
    ? (output.kind as WorkflowOutputKind)
    : 'image';
  return {
    id: r.id,
    name: r.name,
    purpose,
    workflow: r.workflow as WorkflowApiJson,
    inputMapping: sanitizeMapping(r.inputMapping),
    outputMapping: { nodeId: typeof output.nodeId === 'string' ? output.nodeId : '', kind },
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  };
}

export function loadWorkflows(): ComfyuiWorkflowEntry[] {
  try {
    const rawText = localStorage.getItem(COMFYUI_WORKFLOWS_STORAGE_KEY);
    if (!rawText) return [];
    const parsed = JSON.parse(rawText) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const envelope = parsed as Record<string, unknown>;
    if (envelope.schemaVersion !== COMFYUI_WORKFLOWS_SCHEMA_VERSION) return [];
    const data = envelope.data;
    const list = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).workflows : null;
    if (!Array.isArray(list)) return [];
    return list.map(sanitizeEntry).filter((e): e is ComfyuiWorkflowEntry => e !== null);
  } catch {
    return [];
  }
}

export function saveWorkflows(workflows: ComfyuiWorkflowEntry[]): void {
  try {
    localStorage.setItem(
      COMFYUI_WORKFLOWS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: COMFYUI_WORKFLOWS_SCHEMA_VERSION, data: { workflows } }),
    );
  } catch { /* 隐私模式 / QuotaExceeded 忽略 */ }
}

export interface WorkflowRegistryState {
  workflows: ComfyuiWorkflowEntry[];
  upsert: (entry: ComfyuiWorkflowEntry) => void;
  remove: (id: string) => void;
  reload: () => void;
}

export const useWorkflowRegistryStore = create<WorkflowRegistryState>()((set, get) => {
  const commit = (workflows: ComfyuiWorkflowEntry[]): void => {
    set({ workflows });
    saveWorkflows(workflows);
  };
  return {
    workflows: loadWorkflows(),
    upsert: (entry) => {
      const exists = get().workflows.some((w) => w.id === entry.id);
      commit(
        exists
          ? get().workflows.map((w) => (w.id === entry.id ? entry : w))
          : [...get().workflows, entry],
      );
    },
    remove: (id) => commit(get().workflows.filter((w) => w.id !== id)),
    reload: () => set({ workflows: loadWorkflows() }),
  };
});

export function createWorkflowId(): string {
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
