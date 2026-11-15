import { describe, expect, it } from 'vitest';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';
import { buildDirectorBatchPayload, contiguousRuns } from './director-plugin-payload.js';

function shot(n: number, opts?: { guide?: string; selectedGuide?: string; continuation?: boolean }): WorkbenchShot {
  const s = {
    id: `s${n}`,
    number: n,
    duration: 5.167,
    imagePrompt: `prompt ${n}`,
    status: 'pending',
    clipState: 'placeholder',
    references: [],
    continuation: opts?.continuation === undefined ? undefined : { enabled: opts.continuation },
    guide: opts?.guide ? { id: opts.guide, frames: 22 } : undefined,
    cache: opts?.selectedGuide
      ? {
        selectedVersionId: `v${n}`,
        versions: [{ id: `v${n}`, storageKey: `cas:${n}.mp4`, guide: { id: opts.selectedGuide, frames: 22 }, createdAt: '' }],
      }
      : undefined,
  };
  return s as unknown as WorkbenchShot;
}

const shared = { params: { aspect: '16:9', scaleFactor: 1, steps: 8, cfg: 1, seed: 1, continuityOverlapFrames: 22 } } as unknown as WorkbenchSharedParams;

describe('buildDirectorBatchPayload', () => {
  it('按连续 run 切分：3,4 + 6,7；每个 run 起始段带上一段缓存 guide，段内 chain', () => {
    const shots = [1, 2, 3, 4, 5, 6, 7].map((n) => shot(n, { selectedGuide: `g${n}` }));
    const runs = contiguousRuns(shots, ['s3', 's4', 's6', 's7']);
    expect(runs).toEqual([[2, 3], [5, 6]]);

    const payload = buildDirectorBatchPayload({
      projectId: 'p', taskId: 't', shots, selectedIds: ['s3', 's4', 's6', 's7'], shared,
    });
    expect(payload.segments.map((s) => s.shotId)).toEqual(['s3', 's4', 's6', 's7']);
    expect(payload.segments[0]!.guide).toEqual({ mode: 'initial', id: 'g2' });
    expect(payload.segments[1]!.guide).toEqual({ mode: 'chain' });
    expect(payload.segments[2]!.guide).toEqual({ mode: 'initial', id: 'g5' });
    expect(payload.segments[3]!.guide).toEqual({ mode: 'chain' });
    expect(payload.segments[0]!.params.frames).toBe(124);
  });

  it('起始段没有上一段 guide 用 none，不拒绝；显式 shot.guide 优先', () => {
    const shots = [shot(1), shot(2, { guide: 'manual' })];
    const payload = buildDirectorBatchPayload({
      projectId: 'p', taskId: 't', shots, selectedIds: ['s1', 's2'], shared,
    });
    expect(payload.segments[0]!.guide).toEqual({ mode: 'none' });
    expect(payload.segments[1]!.guide).toEqual({ mode: 'initial', id: 'manual' });
  });

  it('关闭衔接的段切成新 run', () => {
    const shots = [shot(1), shot(2), shot(3, { continuation: false })];
    expect(contiguousRuns(shots, ['s1', 's2', 's3'])).toEqual([[0, 1], [2]]);
  });
});
