/**
 * use-director-run 取消路径单测（2026-11-05 修复：取消后片段卡片一直显示生成中）：
 * - 根因：cancel() 只改总状态 phase='canceled'，漏了段条目 —— onSegmentState 从未被调用，
 *   进行中的段停留在启动时标记的 'generating'。
 * - 修复验收：运行中 → 取消 → 未完成段立即回写 'cancelled'（不等轮询）、轮询停止、
 *   已完成段保持 'done' 且产物保留（canceledKept）；取消请求本身失败也落到确定状态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('./openai-protocol-client.js', () => ({
  startProtocolDirectorRun: vi.fn(),
  fetchProtocolVideoStatus: vi.fn(),
  cancelProtocolVideoJob: vi.fn(),
  downloadProtocolVideo: vi.fn(),
}));
vi.mock('@/platform/media.js', () => ({
  newMediaKey: vi.fn(() => ({ storageKey: 'video:test' })),
  putMedia: vi.fn(async () => undefined),
  resolveMediaUrl: vi.fn(async () => 'blob:test'),
}));
vi.mock('@/platform/fs.js', () => ({ isAuthorized: vi.fn(() => true) }));

import {
  cancelProtocolVideoJob,
  fetchProtocolVideoStatus,
  startProtocolDirectorRun,
} from './openai-protocol-client.js';
import { useDirectorRun, type DirectorRunCallbacks } from './use-director-run.js';

const mockedStart = vi.mocked(startProtocolDirectorRun);
const mockedStatus = vi.mocked(fetchProtocolVideoStatus);
const mockedCancel = vi.mocked(cancelProtocolVideoJob);

const CHANNEL = { baseURL: 'https://relay.example.com', apiKey: '', model: 'video-1' };

function makeCallbacks() {
  return {
    onSegmentState: vi.fn(),
    onSegmentDone: vi.fn(),
    onFollowSegment: vi.fn(),
    onNotice: vi.fn(),
  } satisfies DirectorRunCallbacks;
}

const RUN_ARGS = {
  selectedIds: ['s1', 's2', 's3'],
  shots: [],
  shared: {} as never,
  tier: 'fast' as never,
  width: 1280,
  height: 720,
  projectId: 'p1',
  episode: 'e1',
};

/** 运行中作业：段1 done（有产物），段2 running，段3 pending */
const RUNNING_STATUS = {
  ok: true,
  jobId: 'job-1',
  state: 'running' as const,
  currentSegment: 2,
  progress: { done: 1, total: 3 },
  segments: [
    { index: 1, state: 'done' as const, frames: 30, outputPath: 'out/seg1.mp4', downloadUrl: '/v1/contents/seg1.mp4' },
    { index: 2, state: 'writing' as const, frames: 30, outputPath: null, downloadUrl: null },
    { index: 3, state: 'pending' as const, frames: 30, outputPath: null, downloadUrl: null },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  mockedStart.mockResolvedValue({ jobId: 'job-1', segmentShotIds: ['s1', 's2', 's3'], totalFrames: 90, warnings: [] });
  mockedStatus.mockResolvedValue(RUNNING_STATUS);
  mockedCancel.mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function startAndWaitRunning(callbacks: DirectorRunCallbacks) {
  const hook = renderHook(() =>
    useDirectorRun({
      getBridgeConfig: () => ({ mode: 'openai', channel: CHANNEL }),
      callbacks,
      pollIntervalMs: 50,
    }),
  );
  let ok = false;
  await act(async () => {
    ok = await hook.result.current.startRun(RUN_ARGS);
  });
  expect(ok).toBe(true);
  // 至少跑一轮轮询（startRun 内立即首查 + 50ms 间隔）：段1 完成（进入落库队列），段2/3 仍在生成
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(mockedStatus.mock.calls.length).toBeGreaterThanOrEqual(1);
  return hook;
}

describe('取消路径：段状态回写', () => {
  it('运行中 → 取消：未完成段立即置 cancelled，已完成段保持 done（产物保留），轮询停止', async () => {
    const cbs = makeCallbacks();
    const hook = await startAndWaitRunning(cbs);

    // 取消前：三段都标了 generating，段1 已进入完成流程
    expect(cbs.onSegmentState.mock.calls.filter(([, s]) => s === 'generating')).toHaveLength(3);

    await act(async () => {
      await hook.result.current.cancel();
    });

    // 段状态：s2/s3 → cancelled；s1 不被改成 cancelled（保持完成）
    const cancelledCalls = cbs.onSegmentState.mock.calls.filter(([, s]) => s === 'cancelled');
    expect(cancelledCalls.map(([id]) => id).sort()).toEqual(['s2', 's3']);
    expect(cbs.onSegmentState).not.toHaveBeenCalledWith('s1', 'cancelled');

    // 总状态：canceled，保留段数 = 1（只有段1 完成）
    expect(hook.result.current.phase).toBe('canceled');
    expect(hook.result.current.canceledKept).toBe(1);

    // 轮询停止：后续推进时间不再发状态查询
    const callsAfterCancel = mockedStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockedStatus.mock.calls.length).toBe(callsAfterCancel);
    expect(mockedCancel).toHaveBeenCalledWith(CHANNEL, 'job-1');
  });

  it('取消请求本身失败（后端不响应/404）→ UI 仍落到确定状态，段也回写 cancelled', async () => {
    mockedCancel.mockRejectedValue(new Error('HTTP 404'));
    const cbs = makeCallbacks();
    const hook = await startAndWaitRunning(cbs);

    await act(async () => {
      await hook.result.current.cancel();
    });

    expect(hook.result.current.phase).toBe('canceled');
    const cancelledCalls = cbs.onSegmentState.mock.calls.filter(([, s]) => s === 'cancelled');
    expect(cancelledCalls.map(([id]) => id).sort()).toEqual(['s2', 's3']);
    // 提示为「后端未确认」，而不是永远停在生成中
    const notice = cbs.onNotice.mock.calls.find(([level]) => level === 'warning');
    expect(notice && String(notice[1])).toContain('后端未确认');
  });

  it('取消发生在轮询 await 期间：本次轮询结果被丢弃，phase 不会被改回 running', async () => {
    const cbs = makeCallbacks();
    const hook = await startAndWaitRunning(cbs);
    // 状态查询挂起，模拟「请求已发出、结果还没回」时用户点了取消
    let resolveStatus!: (v: unknown) => void;
    mockedStatus.mockImplementation(() => new Promise((r) => { resolveStatus = r; }) as never);

    // 同步推进时间：轮询启动并挂起在 pending 的状态查询上（不 await 微任务队列）
    act(() => {
      vi.advanceTimersByTime(60);
    });
    await act(async () => {
      await hook.result.current.cancel();
    });
    // 挂起的轮询此时才返回 running → 应被 canceled 守卫丢弃
    await act(async () => {
      resolveStatus(RUNNING_STATUS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.phase).toBe('canceled');
  });
});
