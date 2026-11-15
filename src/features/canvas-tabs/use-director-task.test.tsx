/**
 * useDirectorTask — MCP Task Broker 驱动的导演台运行态（2026-11-15）。
 *
 * 验收：刷新/多开时任务、进度、最后一帧预览都从持久化任务恢复；
 * 段完成回调必须带「本段缓存版本 + 引导」，网页合并后本地落盘不会覆盖服务端 cache。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrokerTask } from '@/features/task-center/task-broker-client.js';

const submitBrokerTask = vi.fn<(input: unknown) => Promise<unknown>>();
const cancelBrokerTask = vi.fn<(id: string) => Promise<unknown>>();
const subscribeBrokerTasks = vi.fn<(projectId: string, fn: (tasks: BrokerTask[]) => void) => () => void>();
const resolveMediaUrl = vi.fn<(key: string) => Promise<string>>(async () => 'blob:preview');

vi.mock('@/features/task-center/task-broker-client.js', () => ({
  submitBrokerTask: (input: unknown) => submitBrokerTask(input),
  cancelBrokerTask: (id: string) => cancelBrokerTask(id),
  subscribeBrokerTasks: (projectId: string, fn: (tasks: BrokerTask[]) => void) => subscribeBrokerTasks(projectId, fn),
}));
vi.mock('@/platform/media.js', () => ({
  resolveMediaUrl: (key: string) => resolveMediaUrl(key),
}));

import { useDirectorTask, type DirectorRunCallbacks } from './use-director-task.js';

function task(partial: Partial<BrokerTask> = {}): BrokerTask {
  return {
    taskId: 'tsk_1',
    projectId: 'p1',
    kind: 'director_run',
    state: 'queued',
    title: '导演台出片 · 2 段',
    createdAt: '2026-11-15T01:00:00.000Z',
    updatedAt: '2026-11-15T01:00:01.000Z',
    totalCount: 2,
    doneCount: 0,
    currentSegment: null,
    previewKey: null,
    previewSegment: null,
    error: null,
    cancelRequested: false,
    segments: [
      { index: 1, shotId: 's1', state: 'queued', prompt: 'p1', guide: null, progress: null, previewKey: null, output: null, error: null },
      { index: 2, shotId: 's2', state: 'queued', prompt: 'p2', guide: null, progress: null, previewKey: null, output: null, error: null },
    ],
    outputs: [],
    ...partial,
  };
}

function callbacks(): DirectorRunCallbacks & {
  onSegmentState: ReturnType<typeof vi.fn>;
  onSegmentDone: ReturnType<typeof vi.fn>;
  onFollowSegment: ReturnType<typeof vi.fn>;
  onNotice: ReturnType<typeof vi.fn>;
} {
  return {
    onSegmentState: vi.fn(),
    onSegmentDone: vi.fn(),
    onFollowSegment: vi.fn(),
    onNotice: vi.fn(),
  };
}

beforeEach(() => {
  submitBrokerTask.mockReset();
  cancelBrokerTask.mockReset();
  subscribeBrokerTasks.mockReset();
  resolveMediaUrl.mockClear();
  subscribeBrokerTasks.mockImplementation(() => () => undefined);
});

describe('useDirectorTask', () => {
  it('提交前先落盘容器，提交只带 projectId + selectedIds；完成后回调带缓存版本与 guide', async () => {
    const cb = callbacks();
    submitBrokerTask.mockResolvedValue(task({ state: 'queued' }));
    const beforeSubmit = vi.fn(async () => undefined);
    const { result } = renderHook(() => useDirectorTask({ projectId: 'p1', callbacks: cb }));

    await act(async () => {
      const ok = await result.current.startRun({ projectId: 'p1', selectedIds: ['s1'], beforeSubmit });
      expect(ok).toBe(true);
    });
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(submitBrokerTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'director_run',
      projectId: 'p1',
      request: expect.objectContaining({ selectedIds: ['s1'] }),
    }));
    expect(result.current.taskId).toBe('tsk_1');

    // 订阅回调（模拟 MCP 推来的新快照）：第 1 段完成 + 最后一帧预览
    const onTasks = subscribeBrokerTasks.mock.calls.at(-1)?.[1] as (tasks: BrokerTask[]) => void;
    expect(typeof onTasks).toBe('function');
    act(() => {
      onTasks([task({
        state: 'running',
        currentSegment: 2,
        doneCount: 1,
        previewKey: 'image:assets/p1/tasks/tsk_1-preview-3.webp',
        previewSegment: 2,
        updatedAt: '2026-11-15T01:02:00.000Z',
        segments: [
          {
            index: 1, shotId: 's1', state: 'success', prompt: 'p1', guide: null, progress: null, previewKey: null,
            output: {
              storageKey: 'cas:v1.mp4',
              mime: 'video/mp4',
              previewKey: 'image:assets/p1/tasks/tsk_1-preview-1.webp',
              guide: { id: 'gd_out11111', frames: 22 },
              version: {
                id: 'ver_1', storageKey: 'cas:v1.mp4',
                previewKey: 'image:assets/p1/tasks/tsk_1-preview-1.webp',
                guide: { id: 'gd_out11111', frames: 22 },
                prompt: 'p1', createdAt: '2026-11-15T01:01:00.000Z',
              },
            },
            error: null,
          },
          { index: 2, shotId: 's2', state: 'running', prompt: 'p2', guide: null, progress: null, previewKey: null, output: null, error: null },
        ],
      })]);
    });

    await waitFor(() => expect(cb.onSegmentDone).toHaveBeenCalled());
    const payload = cb.onSegmentDone.mock.calls[0]![1] as {
      videoStorageKey: string; version?: { id: string }; guide?: { id: string };
    };
    expect(payload.videoStorageKey).toBe('cas:v1.mp4');
    expect(payload.version?.id).toBe('ver_1');
    expect(payload.guide?.id).toBe('gd_out11111');
    expect(cb.onFollowSegment).toHaveBeenCalledWith('s1');
    expect(cb.onSegmentState).toHaveBeenCalledWith('s2', 'generating');
    await waitFor(() => expect(result.current.preview?.image).toBe('blob:preview'));
  });

  it('挂载即恢复进行中的任务（刷新/换浏览器不丢进度与最后一帧）', async () => {
    const cb = callbacks();
    let push: ((tasks: BrokerTask[]) => void) | null = null;
    subscribeBrokerTasks.mockImplementation((_pid: string, fn: (tasks: BrokerTask[]) => void) => {
      push = fn;
      return () => undefined;
    });
    const { result } = renderHook(() => useDirectorTask({ projectId: 'p1', callbacks: cb }));
    act(() => {
      push?.([task({
        state: 'running',
        currentSegment: 1,
        previewKey: 'image:assets/p1/tasks/tsk_1-preview-2.webp',
        previewSegment: 1,
        segments: [
          { index: 1, shotId: 's1', state: 'running', prompt: 'p1', guide: null, progress: { step: 4, totalSteps: 8 }, previewKey: null, output: null, error: null },
          { index: 2, shotId: 's2', state: 'queued', prompt: 'p2', guide: null, progress: null, previewKey: null, output: null, error: null },
        ],
      })]);
    });
    await waitFor(() => expect(result.current.phase).toBe('running'));
    expect(result.current.currentSegment).toBe(1);
    expect(result.current.segmentShotIds).toEqual(['s1', 's2']);
    await waitFor(() => expect(result.current.preview?.image).toBe('blob:preview'));
    // 从未发起提交：恢复的是服务端任务
    expect(submitBrokerTask).not.toHaveBeenCalled();
  });

  it('取消走 MCP 任务接口；失败任务把错误抛给宿主提示', async () => {
    const cb = callbacks();
    submitBrokerTask.mockResolvedValue(task({ state: 'queued' }));
    const { result } = renderHook(() => useDirectorTask({ projectId: 'p1', callbacks: cb }));
    await act(async () => { await result.current.startRun({ projectId: 'p1', selectedIds: ['s1'] }); });

    cancelBrokerTask.mockResolvedValue(task({ state: 'canceled', doneCount: 0 }));
    await act(async () => { await result.current.cancel(); });
    expect(cancelBrokerTask).toHaveBeenCalledWith('tsk_1');

    const onTasks = subscribeBrokerTasks.mock.calls.at(-1)?.[1] as (tasks: BrokerTask[]) => void;
    act(() => {
      onTasks([task({ state: 'failed', error: 'ComfyUI 不可达', updatedAt: '2026-11-15T01:05:00.000Z' })]);
    });
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(cb.onNotice).toHaveBeenCalledWith('error', expect.stringContaining('ComfyUI 不可达'));
  });
});
