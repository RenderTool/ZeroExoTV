/**
 * 刷新续接（2026-11-10 用户要求）：带 resume 的生成必须「跳过提交 + 接回原作业」，
 * 这样刷新后既不重复排队，又能拿回预览/进度并把产物写回节点。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import { generateLocalQwenImage } from './local-qwen-image.js';
import { generateLocalMiniMaxVideo } from './local-minimax-video.js';

const BASE = 'http://127.0.0.1:8188';

function stubFetchWithJob(kind: 'image' | 'video'): ReturnType<typeof vi.fn> {
  const output = kind === 'image'
    ? 'D:\\ComfyUI\\output\\zeroexo\\p\\ep\\img_00001_.png'
    : 'D:\\ComfyUI\\output\\zeroexo\\p\\ep\\seg_00001.mp4';
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    // 续接不允许再提交作业（会重复排队）
    if (method === 'POST' && url.includes('/zeroexo/v1/jobs')) throw new Error(`resume 不该提交作业：${url}`);
    if (url.includes('/zeroexo/v1/health')) return new Response('{}', { status: 200 });
    if (url.includes('/zeroexo/v1/jobs/')) {
      return new Response(JSON.stringify({
        ok: true, jobId: 'zx_job_1', state: 'success', outputs: [{ kind, path: output }],
      }), { status: 200 });
    }
    if (url.includes('/view?')) return new Response(new Blob(['media']), { status: 200 });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useComfyuiEndpointStore.setState({ address: BASE, connected: true } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('刷新续接', () => {
  it('Qwen 图片：resume 跳过提交，直接取回已完成作业的产物', async () => {
    stubFetchWithJob('image');
    const onJobSubmitted = vi.fn();
    const result = await generateLocalQwenImage({
      prompt: '测试',
      params: {},
      nodeId: 'n1',
      resume: { jobId: 'zx_job_1', clientId: 'cid-1' },
      onJobSubmitted,
    });
    expect(result.generationId).toBe('zx_job_1');
    expect(result.bytes).toBeGreaterThan(0);
    expect(onJobSubmitted).not.toHaveBeenCalled();
  });

  it('视频：resume 跳过提交，直接取回已完成作业的产物', async () => {
    stubFetchWithJob('video');
    const result = await generateLocalMiniMaxVideo({
      prompt: '测试',
      seconds: 5,
      params: {},
      nodeId: 'n2',
      resume: { jobId: 'zx_job_1', clientId: 'cid-2' },
    });
    expect(result.generationId).toBe('zx_job_1');
    expect(result.durationMs).toBe(5000);
  });
});
