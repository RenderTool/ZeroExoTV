/**
 * 本机 H3 视频参数 / 一键同款回归：
 * - 面板参数在 node.data.paramValues，模板参数只有 1024×1024 兜底，不合并就恒生成 1:1；
 * - 本机无云端生成历史（generationId 是 ComfyUI jobId），同款必须读节点参数快照。
 */
import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('@/services/api-client.js', () => ({ apiGet: apiMock.apiGet }));
vi.mock('@zeroexo/plugin-nodes', () => ({ resolveStackSpawnPosition: () => ({ x: 0, y: 0 }) }));
vi.mock('@/shared/utils/resource-url.js', () => ({ getResourceUrl: vi.fn(() => '') }));
vi.mock('./helpers.js', () => ({ contentToDataUrl: vi.fn() }));
vi.mock('@zeroexo/core', () => ({
  AddNodeCommand: class { constructor(public node: any) {} },
  AddEdgeCommand: class { constructor(public edge: any) {} },
  BatchCommand: class { constructor(public commands: any[], public label: string) {} },
}));

import { handleReplayGeneration, resolveLocalVideoRequest } from './use-ai-generation.js';

describe('resolveLocalVideoRequest（面板比例必须生效）', () => {
  it('选 9:16 → size 取面板值，aspect/scaleFactor/steps/seconds 全部透传', () => {
    const node = { paramValues: { aspect: '9:16', scaleFactor: 1, size: '480x864', steps: 8, seconds: 6 } };
    const r = resolveLocalVideoRequest(node, { width: 1024, height: 1024 }, { width: 1024, height: 1024 }, 5);
    expect(r.size).toBe('480x864');
    expect(r.seconds).toBe(6);
    expect(r.params).toMatchObject({ aspect: '9:16', scaleFactor: 1, steps: 8 });
  });

  it('无面板参数时退回模板尺寸与时长', () => {
    const r = resolveLocalVideoRequest({}, {}, { width: 864, height: 480 }, 5);
    expect(r.size).toBe('864x480');
    expect(r.seconds).toBe(5);
  });

  it('非法 size 字符串不采纳', () => {
    const r = resolveLocalVideoRequest({ paramValues: { size: 'oops' } }, {}, { width: 864, height: 480 }, 5);
    expect(r.size).toBe('864x480');
  });
});

describe('handleReplayGeneration（本机视频一键同款）', () => {
  it('不查云端历史，新节点带 paramValues、model 与 prompt', async () => {
    apiMock.apiGet.mockReset();
    const srcData = {
      generationId: 'zx_canvas_job_1',
      model: 'zeroexo:minimax-h3',
      prompt: '一只狗',
      paramValues: { aspect: '9:16', scaleFactor: 1, size: '480x864', steps: 8 },
    };
    const cq = { execute: vi.fn() };
    const store = {
      getGraph: () => ({
        nodes: [{ id: 'n1', type: 'video', position: { x: 0, y: 0 }, size: { width: 420, height: 236 }, data: srcData }],
        edges: [],
      }),
      setSelection: vi.fn(),
      focusOnNode: vi.fn(),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    };
    const msg = { info: vi.fn(), warning: vi.fn(), success: vi.fn() };
    await handleReplayGeneration(
      'n1', { store, commandQueue: cq }, { containerSize: { width: 1000, height: 800 } },
      (k: string) => k, msg,
    );
    expect(apiMock.apiGet).not.toHaveBeenCalled();
    expect(cq.execute).toHaveBeenCalledTimes(1);
    const batch = cq.execute.mock.calls[0]![0] as { commands: Array<{ node?: { data: Record<string, unknown> } }> };
    expect(batch.commands[0]?.node?.data.paramValues).toEqual(srcData.paramValues);
    expect(batch.commands[0]?.node?.data.model).toBe('zeroexo:minimax-h3');
    expect(batch.commands[0]?.node?.data.prompt).toBe('一只狗');
    expect(msg.success).toHaveBeenCalled();
  });
});
