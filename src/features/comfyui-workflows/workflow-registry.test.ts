/**
 * workflow-registry 单测：解析（拒绝 UI 格式）、参数注入、/object_info 校验、试跑回调。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMFYUI_WORKFLOWS_STORAGE_KEY,
  applyWorkflowInputs,
  findMappingIssues,
  loadWorkflows,
  parseWorkflowApiJson,
  saveWorkflows,
  testRunWorkflow,
  validateAgainstObjectInfo,
  type ComfyuiWorkflowEntry,
} from './workflow-registry.js';

const BASE = 'http://127.0.0.1:8188';

const API_JSON = {
  '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, positive: ['6', 0], negative: ['7', 0], model: ['4', 0] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry', clip: ['4', 1] } },
  '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'zeroexo' } },
};

const OBJECT_INFO = {
  KSampler: {
    input: {
      required: {
        seed: ['INT', { default: 0 }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 7 }],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        model: ['MODEL'],
      },
    },
  },
  CLIPTextEncode: { input: { required: { text: ['STRING'], clip: ['CLIP'] } } },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } } },
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['sdxl.safetensors', 'flux.safetensors'], {}] } },
  },
};

describe('parseWorkflowApiJson', () => {
  it('接受 API 格式', () => {
    const r = parseWorkflowApiJson(JSON.stringify(API_JSON));
    expect(r.ok).toBe(true);
  });

  it('明确拒绝 UI 格式并给出导出方法', () => {
    const r = parseWorkflowApiJson(JSON.stringify({ nodes: [], links: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Save (API Format)');
  });

  it('缺少 class_type / inputs 逐项报错', () => {
    expect(parseWorkflowApiJson('{"3":{"inputs":{}}}').ok).toBe(false);
    expect(parseWorkflowApiJson('{"3":{"class_type":"X"}}').ok).toBe(false);
  });
});

describe('applyWorkflowInputs', () => {
  it('按映射写入节点字段，不修改原工作流', () => {
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    expect(workflow.ok).toBe(true);
    if (!workflow.ok) return;
    const r = applyWorkflowInputs(
      workflow.workflow,
      { positivePrompt: { nodeId: '6', input: 'text' }, seed: { nodeId: '3', input: 'seed' } },
      { positivePrompt: '一只猫', seed: 42 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prompt['6']!.inputs['text']).toBe('一只猫');
    expect(r.prompt['3']!.inputs['seed']).toBe(42);
    expect(workflow.workflow['6']!.inputs['text']).toBe('');
  });

  it('映射指向不存在的节点 → 报错', () => {
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    if (!workflow.ok) return;
    const r = applyWorkflowInputs(workflow.workflow, { seed: { nodeId: '99', input: 'seed' } }, { seed: 1 });
    expect(r.ok).toBe(false);
  });
});

describe('validateAgainstObjectInfo', () => {
  it('class_type 缺失 / 必填缺失 / 下拉值不存在（模型文件名）逐条指出', () => {
    const workflow = {
      '1': { class_type: 'NotInstalled', inputs: {} },
      '2': { class_type: 'KSampler', inputs: { seed: 1 } },
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'missing.safetensors' } },
    };
    const errors = validateAgainstObjectInfo(workflow, OBJECT_INFO);
    expect(errors.some((e) => e.includes('NotInstalled'))).toBe(true);
    expect(errors.some((e) => e.includes('节点 2') && e.includes('缺少必填字段「steps」'))).toBe(true);
    expect(errors.some((e) => e.includes('missing.safetensors') && e.includes('模型文件不存在'))).toBe(true);
  });

  it('合法工作流零错误', () => {
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    if (!workflow.ok) return;
    expect(validateAgainstObjectInfo(workflow.workflow, OBJECT_INFO)).toEqual([]);
  });
});

describe('findMappingIssues', () => {
  it('正向提示词与输出映射必填', () => {
    const entry = {
      workflow: {},
      inputMapping: {},
      outputMapping: { nodeId: '', kind: 'image' as const },
    };
    expect(findMappingIssues(entry).join('；')).toContain('正向提示词');
    expect(findMappingIssues(entry).join('；')).toContain('输出节点');
  });
});

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('testRunWorkflow', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('提交 → 历史完成 → 按输出映射拼 /view 地址', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/prompt') && init?.method === 'POST') return fakeResponse(200, { prompt_id: 'p1' });
      if (url.endsWith('/history/p1')) {
        return fakeResponse(200, {
          p1: {
            status: { status_str: 'success' },
            outputs: { '9': { images: [{ filename: 'zeroexo_0001.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      return fakeResponse(404, {});
    });
    vi.stubGlobal('fetch', fn);
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    if (!workflow.ok) return;
    const outcome = await testRunWorkflow(
      BASE,
      workflow.workflow,
      { positivePrompt: { nodeId: '6', input: 'text' } },
      { nodeId: '9', kind: 'image' },
      { positivePrompt: 'probe' },
      { pollMs: 1, timeoutMs: 1000, sleep: async () => {} },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.files[0]!.url).toContain('/view?filename=zeroexo_0001.png');
  });

  it('上游报错 → 原样带回 status.messages', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/prompt') && init?.method === 'POST') return fakeResponse(200, { prompt_id: 'p2' });
      if (url.endsWith('/history/p2')) {
        return fakeResponse(200, {
          p2: { status: { status_str: 'error', messages: [['execution_error', { node_id: '3', exception_message: 'CUDA OOM' }]] } },
        });
      }
      return fakeResponse(404, {});
    });
    vi.stubGlobal('fetch', fn);
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    if (!workflow.ok) return;
    const outcome = await testRunWorkflow(
      BASE,
      workflow.workflow,
      { positivePrompt: { nodeId: '6', input: 'text' } },
      { nodeId: '9', kind: 'image' },
      { positivePrompt: 'probe' },
      { pollMs: 1, timeoutMs: 1000, sleep: async () => {} },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(JSON.stringify(outcome.raw)).toContain('CUDA OOM');
  });

  it('提交 HTTP 错误 → 报出原始状态与 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(400, { error: 'invalid prompt' })),
    );
    const workflow = parseWorkflowApiJson(JSON.stringify(API_JSON));
    if (!workflow.ok) return;
    const outcome = await testRunWorkflow(BASE, workflow.workflow, { positivePrompt: { nodeId: '6', input: 'text' } }, { nodeId: '9', kind: 'image' }, { positivePrompt: 'probe' });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain('HTTP 400');
  });
});

describe('持久化', () => {
  it('保存后可按 id 读回；损坏数据不抛', () => {
    const entry: ComfyuiWorkflowEntry = {
      id: 'wf-1',
      name: 'Flux 文生图',
      purpose: 'text2image',
      workflow: API_JSON as ComfyuiWorkflowEntry['workflow'],
      inputMapping: { positivePrompt: { nodeId: '6', input: 'text' } },
      outputMapping: { nodeId: '9', kind: 'image' },
      updatedAt: '2026-11-05T00:00:00.000Z',
    };
    saveWorkflows([entry]);
    expect(loadWorkflows()).toHaveLength(1);
    localStorage.setItem(COMFYUI_WORKFLOWS_STORAGE_KEY, '{broken');
    expect(loadWorkflows()).toEqual([]);
  });
});
