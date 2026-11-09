/**
 * use-director-run 引导槽参数单测（2026-11-07 需求 6/7）
 *
 * - 片段有显式引导槽（shot.guide）→ 提交 params.guide_id，且 use_prev_guide=false；
 * - 片段无引导槽 → 沿用段间引导开关（use_prev_guide = continuityEnabled && i>0）；
 * - 引导 id 只接受插件生成的 gd_xxx（前端不传非法格式）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const jobsMock = vi.hoisted(() => ({
  submitZeroexoJob: vi.fn(async (_base: string, _body: { params: Record<string, unknown> }) => ({
    jobId: `job-${jobsMock.submitZeroexoJob.mock.calls.length}`,
    state: 'queued' as const,
  })),
  fetchZeroexoJob: vi.fn(async () => ({ ok: true, jobId: 'j', state: 'running' as const, outputs: [] })),
  cancelZeroexoJob: vi.fn(async () => undefined),
  uploadZeroexoReference: vi.fn(async () => 'ref.png'),
  zeroexoOutputViewUrl: vi.fn(() => 'http://x/view?f=1'),
}));

vi.mock('./zeroexo-jobs-client.js', () => ({
  ...jobsMock,
  LOCAL_VIDEO_MODEL_KEY: 'zeroexo:minimax-h3',
  LOCAL_VIDEO_MODEL_LABEL: 'H3ZeroExo',
}));
vi.mock('@/platform/media.js', () => ({
  newMediaKey: vi.fn(() => ({ storageKey: 'video:test' })),
  putMedia: vi.fn(async () => undefined),
  resolveMediaUrl: vi.fn(async () => 'blob:test'),
}));
vi.mock('@/platform/fs.js', () => ({ isAuthorized: vi.fn(() => true) }));
vi.mock('@/features/canvas-assets/history-autoland.js', () => ({
  autoLandGenerationBlob: vi.fn(async () => ({ storageKey: 'cas:v' })),
}));
vi.mock('./comfyui-ws-client.js', () => ({
  createPreviewClientId: () => 'client-1',
  DirectorPreviewSocket: class {
    connect(): void {}
    close(): void {}
  },
}));

import { useDirectorRun, type DirectorRunCallbacks } from './use-director-run.js';
import type { RunShotLike } from '@/entities/director-params.js';

function cbs(): DirectorRunCallbacks {
  return {
    onSegmentState: vi.fn(),
    onSegmentDone: vi.fn(),
    onFollowSegment: vi.fn(),
    onNotice: vi.fn(),
  };
}

const SHOTS: RunShotLike[] = [
  { id: 's1', number: 1, duration: 5, status: 'done', imagePrompt: 'a' },
  { id: 's2', number: 2, duration: 5, status: 'pending', imagePrompt: 'b', guide: { id: 'gd_abc12345', frames: 22 } },
  { id: 's3', number: 3, duration: 5, status: 'pending', imagePrompt: 'c' },
];

beforeEach(() => {
  vi.useFakeTimers();
  jobsMock.submitZeroexoJob.mockClear();
  jobsMock.fetchZeroexoJob.mockClear();
  jobsMock.cancelZeroexoJob.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('导演台引导槽 → 运行参数', () => {
  it('有引导槽的片段传 guide_id 并强制 use_prev_guide=false；无引导槽沿用段间引导', async () => {
    const hook = renderHook(() => useDirectorRun({
      getBridgeConfig: () => ({ mode: 'zeroexo', baseUrl: 'http://127.0.0.1:8188' }),
      callbacks: cbs(),
      pollIntervalMs: 50,
    }));

    await act(async () => {
      await hook.result.current.startRun({
        selectedIds: ['s1', 's2', 's3'],
        shots: SHOTS,
        shared: {
          enabled: false,
          assets: [],
          presetId: 'h3',
          params: { continuityEnabled: true, continuityOverlapFrames: 22 },
        },
        tier: 'h3',
        width: 864,
        height: 480,
        projectId: 'p1',
        episode: 'e1',
      });
    });

    expect(jobsMock.submitZeroexoJob).toHaveBeenCalledTimes(3);
    const params = jobsMock.submitZeroexoJob.mock.calls.map(([, body]) => body.params);
    // 段 1：首段，永远不 prev
    expect(params[0]?.use_prev_guide).toBe(false);
    expect(params[0]?.guide_id).toBeUndefined();
    // 段 2：显式引导槽 → guide_id 且关闭 use_prev_guide（不得回退上一段）
    expect(params[1]?.guide_id).toBe('gd_abc12345');
    expect(params[1]?.use_prev_guide).toBe(false);
    // 段 3：无引导槽 + 段间引导开 → 使用上一段
    expect(params[2]?.guide_id).toBeUndefined();
    expect(params[2]?.use_prev_guide).toBe(true);

    await act(async () => { await hook.result.current.cancel(); });
  });

  it('重跑单段：按时间线取上一段产物 guide 传 guide_id，不依赖本次勾选下标', async () => {
    const shots: RunShotLike[] = [
      { id: 's1', number: 1, duration: 5, status: 'done', imagePrompt: 'a', media: { guide: { id: 'gd_seg1' } } },
      { id: 's2', number: 2, duration: 5, status: 'done', imagePrompt: 'b', media: { guide: { id: 'gd_seg2' } } },
      { id: 's3', number: 3, duration: 5, status: 'pending', imagePrompt: 'c', continuation: { enabled: true } },
    ];
    const hook = renderHook(() => useDirectorRun({
      getBridgeConfig: () => ({ mode: 'zeroexo', baseUrl: 'http://127.0.0.1:8188' }),
      callbacks: cbs(),
      pollIntervalMs: 50,
    }));
    await act(async () => {
      await hook.result.current.startRun({
        selectedIds: ['s3'], // 只重跑第 3 段：旧逻辑 i=0 → use_prev_guide=false，拿不到第 2 段引导
        shots,
        shared: { enabled: false, assets: [], presetId: 'h3', params: { continuityEnabled: false, continuityOverlapFrames: 22 } },
        tier: 'h3', width: 864, height: 480, projectId: 'p1', episode: 'e1',
      });
    });
    expect(jobsMock.submitZeroexoJob).toHaveBeenCalledTimes(1);
    const params = jobsMock.submitZeroexoJob.mock.calls[0]![1].params;
    expect(params.guide_frames).toBe(22); // 默认 22 帧（与是否使用引导无关）
    expect(params.guide_id).toBe('gd_seg2');
    expect(params.use_prev_guide).toBe(false); // 有显式 id，服务端不再猜上一段
    await act(async () => { await hook.result.current.cancel(); });
  });

  it('用户在片段上勾「段间引导」即生效（全局主开关关闭也认）；显式槽仍优先', async () => {
    const shots: RunShotLike[] = [
      { id: 's1', number: 1, duration: 5, status: 'done', imagePrompt: 'a', media: { guide: { id: 'gd_seg1' } } },
      { id: 's2', number: 2, duration: 5, status: 'pending', imagePrompt: 'b', continuation: { enabled: true } },
      { id: 's3', number: 3, duration: 5, status: 'pending', imagePrompt: 'c', guide: { id: 'gd_explicit' }, continuation: { enabled: true } },
    ];
    const hook = renderHook(() => useDirectorRun({
      getBridgeConfig: () => ({ mode: 'zeroexo', baseUrl: 'http://127.0.0.1:8188' }),
      callbacks: cbs(),
      pollIntervalMs: 50,
    }));
    await act(async () => {
      await hook.result.current.startRun({
        selectedIds: ['s2', 's3'],
        shots,
        shared: { enabled: false, assets: [], presetId: 'h3', params: { continuityEnabled: false } },
        tier: 'h3', width: 864, height: 480, projectId: 'p1', episode: 'e1',
      });
    });
    const params = jobsMock.submitZeroexoJob.mock.calls.map(([, body]) => body.params);
    expect(params[0]?.guide_id).toBe('gd_seg1'); // 段间引导勾选 → 取上一段产物
    expect(params[0]?.use_prev_guide).toBe(false);
    expect(params[1]?.guide_id).toBe('gd_explicit'); // 显式槽覆盖上一段产物
    expect(params[1]?.use_prev_guide).toBe(false);
    await act(async () => { await hook.result.current.cancel(); });
  });

  it('「本次运行断开衔接」的段级 false 覆盖全局主开关：不传 guide_id、不启用 prev', async () => {
    const shots: RunShotLike[] = [
      { id: 's1', number: 1, duration: 5, status: 'done', imagePrompt: 'a', media: { guide: { id: 'gd_seg1' } } },
      { id: 's2', number: 2, duration: 5, status: 'pending', imagePrompt: 'b', continuation: { enabled: false } },
    ];
    const hook = renderHook(() => useDirectorRun({
      getBridgeConfig: () => ({ mode: 'zeroexo', baseUrl: 'http://127.0.0.1:8188' }),
      callbacks: cbs(),
      pollIntervalMs: 50,
    }));
    await act(async () => {
      await hook.result.current.startRun({
        selectedIds: ['s2'], shots,
        shared: { enabled: false, assets: [], presetId: 'h3', params: { continuityEnabled: true } },
        tier: 'h3', width: 864, height: 480, projectId: 'p1', episode: 'e1',
      });
    });
    const params = jobsMock.submitZeroexoJob.mock.calls[0]![1].params;
    expect(params.guide_id).toBeUndefined();
    expect(params.use_prev_guide).toBe(false);
    await act(async () => { await hook.result.current.cancel(); });
  });
});
