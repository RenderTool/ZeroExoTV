/**
 * 任务队列 store（2026-11-10 用户要求）：
 * 画布/导演台/图片编辑器的生成任务都登记到这里，右下角面板据此展示排队情况。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { countActiveTasks, useTaskQueueStore } from './task-queue-store.js';

describe('task-queue-store', () => {
  beforeEach(() => {
    useTaskQueueStore.setState({ tasks: [], collapsed: false });
  });

  it('start 幂等：同 id 再 start 只把状态拉回 running，不重复加条目', () => {
    const s = useTaskQueueStore.getState();
    s.start({ id: 'job-1', kind: 'image', title: '图片 1' });
    useTaskQueueStore.getState().finish('job-1', 'success');
    s.start({ id: 'job-1', kind: 'image', title: '图片 1' });
    const { tasks } = useTaskQueueStore.getState();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('running');
  });

  it('新任务排在最前；update 改进度；finish 记录失败原因', () => {
    const s = useTaskQueueStore.getState();
    s.start({ id: 'a', kind: 'video', title: '视频 A' });
    s.start({ id: 'b', kind: 'director', title: '导演台 3 段' });
    expect(useTaskQueueStore.getState().tasks.map((t) => t.id)).toEqual(['b', 'a']);
    useTaskQueueStore.getState().update('a', { progress: { step: 3, totalSteps: 8 } });
    useTaskQueueStore.getState().finish('a', 'error', '显存不足');
    const a = useTaskQueueStore.getState().tasks.find((t) => t.id === 'a')!;
    expect(a.progress).toEqual({ step: 3, totalSteps: 8 });
    expect(a.status).toBe('error');
    expect(a.error).toContain('显存');
    expect(countActiveTasks(useTaskQueueStore.getState().tasks)).toBe(1);
  });

  it('清空已完成，保留进行中', () => {
    const s = useTaskQueueStore.getState();
    s.start({ id: 'run', kind: 'image', title: '跑着的' });
    s.start({ id: 'done', kind: 'image', title: '跑完的' });
    useTaskQueueStore.getState().finish('done', 'success');
    useTaskQueueStore.getState().clearFinished();
    expect(useTaskQueueStore.getState().tasks.map((t) => t.id)).toEqual(['run']);
  });

  it('最多保留 50 条（连跑几十个作业不会无限拉长面板）', () => {
    const s = useTaskQueueStore.getState();
    for (let i = 0; i < 60; i += 1) s.start({ id: `t${i}`, kind: 'image', title: `图 ${i}` });
    expect(useTaskQueueStore.getState().tasks).toHaveLength(50);
    expect(useTaskQueueStore.getState().tasks[0]!.id).toBe('t59');
  });
});
