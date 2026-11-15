import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  submit: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  base: vi.fn(() => 'http://127.0.0.1:8188'),
}));
const landing = vi.hoisted(() => ({
  land: vi.fn(async () => ({ storageKey: 'cas:test.mp4', guide: { id: 'gd_1', frames: 22 } })),
  url: vi.fn(() => 'http://127.0.0.1:8188/view?filename=preview.png'),
}));

vi.mock('@/features/task-center/plugin-task-client.js', () => ({
  submitPluginTask: client.submit,
  getPluginTask: client.get,
  listPluginTasks: client.list,
  cancelPluginTask: client.cancel,
  pluginTaskBase: client.base,
}));
vi.mock('./plugin-task-landing.js', () => ({
  landPluginSegment: landing.land,
  pluginViewUrl: landing.url,
}));

import { usePluginDirectorTask } from './use-plugin-director-task.js';

const successTask = {
  taskId: 'tsk_web_1',
  projectId: 'p1',
  state: 'success',
  doneCount: 1,
  totalCount: 1,
  currentSegment: null,
  segments: [
    {
      index: 1,
      shotId: 's1',
      state: 'success',
      prompt: 'p',
      outputs: [{ kind: 'video', path: 'D:\\ComfyUI\\output\\zeroexo\\ep\\seg.mp4' }],
      previewPath: 'D:\\ComfyUI\\output\\zeroexo\\previews\\seg.png',
    },
  ],
};

beforeEach(() => {
  client.submit.mockReset();
  client.get.mockReset();
  client.list.mockReset();
  client.list.mockResolvedValue([]);
  client.cancel.mockReset();
  landing.land.mockClear();
});

describe('usePluginDirectorTask', () => {
  it('提交后轮询成功段：落库并回调 onSegmentDone（带 storageKey/version）', async () => {
    client.submit.mockResolvedValue(successTask);
    client.get.mockResolvedValue(successTask);
    const onDone = vi.fn();
    const onState = vi.fn();
    const { result } = renderHook(() => usePluginDirectorTask({
      projectId: 'p1',
      callbacks: {
        onSegmentDone: onDone,
        onSegmentState: onState,
        onFollowSegment: vi.fn(),
        onNotice: vi.fn(),
      },
    }));

    await act(async () => {
      await result.current.startRun({
        projectId: 'p1',
        selectedIds: ['s1'],
        payload: { projectId: 'p1', clientJobId: 'tsk_web_1', clientId: 'tsk_web_1', kind: 'director_run', segments: [{ shotId: 's1', guide: { mode: 'none' }, params: {} }] },
      });
    });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0]![1].videoStorageKey).toBe('cas:test.mp4');
    expect(onDone.mock.calls[0]![1].version.storageKey).toBe('cas:test.mp4');
    expect(onDone.mock.calls[0]![1].version.guide.id).toBe('gd_1');
  });

  it('网页重开：从插件任务列表恢复已完成段并补落库', async () => {
    client.list.mockResolvedValue([successTask]);
    client.get.mockResolvedValue(successTask);
    const onDone = vi.fn();
    renderHook(() => usePluginDirectorTask({
      projectId: 'p1',
      callbacks: {
        onSegmentDone: onDone,
        onSegmentState: vi.fn(),
        onFollowSegment: vi.fn(),
        onNotice: vi.fn(),
      },
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(landing.land).toHaveBeenCalled();
  });
});
