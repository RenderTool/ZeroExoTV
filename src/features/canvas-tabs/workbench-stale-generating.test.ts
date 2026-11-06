/**
 * 「历史残留的生成中」自愈对账单测（workbench-stale-generating，2026-11-05）：
 * ① 无运行 + 段为 generating → 降级为已中断（宿主按返回 id 落盘）；
 * ② 有运行进行 → 不降级；
 * ③ 后端队列仍有任务 → 不降级；
 * ④ 幂等：降级落盘后再次对账 → 无命中（不重复提示）。
 */

import { describe, expect, it } from 'vitest';
import { reconcileStaleGenerating } from './workbench-stale-generating.js';

const SHOTS = [
  { id: 's1', status: 'done' },
  { id: 's2', status: 'generating' },
  { id: 's3', status: 'generating' },
  { id: 's4', status: 'pending' },
];

describe('reconcileStaleGenerating', () => {
  it('① 无运行 + 段为 generating → 返回待降级段（宿主 updateShot 落盘为 interrupted）', () => {
    const r = reconcileStaleGenerating({ shots: SHOTS, runPhase: 'idle', queueBusy: false });
    expect(r).toEqual({ demotedIds: ['s2', 's3'], skippedForQueue: false });
    // 落盘后（宿主把 status 写成 interrupted）再次对账 → 幂等，无命中
    const after = [
      { id: 's1', status: 'done' },
      { id: 's2', status: 'interrupted' },
      { id: 's3', status: 'interrupted' },
      { id: 's4', status: 'pending' },
    ];
    const r2 = reconcileStaleGenerating({ shots: after, runPhase: 'idle', queueBusy: false });
    expect(r2.demotedIds).toEqual([]);
  });

  it('② 本页有运行在进行（submitting/queued/running）→ 不降级，不误伤段', () => {
    for (const phase of ['submitting', 'queued', 'running']) {
      const r = reconcileStaleGenerating({ shots: SHOTS, runPhase: phase, queueBusy: false });
      expect(r).toEqual({ demotedIds: [], skippedForQueue: false });
    }
    // 防御性：即使 phase 误判，activeSegmentIds 命中的段也不降级
    const r = reconcileStaleGenerating({
      shots: SHOTS,
      runPhase: 'idle',
      activeSegmentIds: new Set(['s2']),
      queueBusy: false,
    });
    expect(r.demotedIds).toEqual(['s3']);
  });

  it('③ 后端队列仍有任务在跑 → 整体跳过（保持生成中），下次进入再对账', () => {
    const r = reconcileStaleGenerating({ shots: SHOTS, runPhase: 'idle', queueBusy: true });
    expect(r).toEqual({ demotedIds: [], skippedForQueue: true });
  });

  it('④ 队列探测不可用（null：未连接/跨域/兼容口）→ 仍降级（后端未确认也落确定状态）', () => {
    const r = reconcileStaleGenerating({ shots: SHOTS, runPhase: 'idle', queueBusy: null });
    expect(r.demotedIds).toEqual(['s2', 's3']);
  });
});
