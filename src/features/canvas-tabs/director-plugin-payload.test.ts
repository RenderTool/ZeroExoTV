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

  /**
   * 2026-11-20 报障回归：sampler/scheduler/位移/LoRA 等模板级参数以前一个都没下发，
   * 插件退回模板默认（LoRA 恒 8 步 turbo、文本编码器挑到 48G bf16）。这里锁住三件事：
   * 1) 共享参数里的模板键必须出现在每段 params；2) 段级 paramValues 覆盖共享；
   * 3) 计算值（width/height/frames/steps）不能被 UI 旧值冲掉。
   */
  it('模板级参数真下发，且段级 paramValues 优先、计算值不被冲掉', () => {
    const sharedWithTpl = {
      params: {
        aspect: '21:9', scaleFactor: 1.5, steps: 12, cfg: 1, seed: -1,
        sampler: 'res_multistep', scheduler: 'simple', shift_video: 12, shift_audio: 3,
        clear_vram_between_segments: true, lora_name: 'shared_lora.safetensors', lora_strength: 0.8,
        width: 1728, height: 736, frames: 999,
        continuityOverlapFrames: 22,
      },
    } as unknown as WorkbenchSharedParams;
    const perShot = shot(1) as unknown as Record<string, unknown>;
    perShot.paramValues = { sampler: 'euler', lora_strength: 0.6 };
    const payload = buildDirectorBatchPayload({
      projectId: 'p', taskId: 't', shots: [perShot as unknown as WorkbenchShot], selectedIds: ['s1'],
      shared: sharedWithTpl,
    });
    const params = payload.segments[0]!.params;
    expect(params.sampler).toBe('euler');
    expect(params.scheduler).toBe('simple');
    expect(params.shift_video).toBe(12);
    expect(params.shift_audio).toBe(3);
    expect(params.clear_vram_between_segments).toBe(true);
    expect(params.lora_name).toBe('shared_lora.safetensors');
    expect(params.lora_strength).toBe(0.6);
    expect(params.steps).toBe(12);
    expect(params.width).toBe(1920);
    expect(params.height).toBe(832);
    expect(params.frames).toBe(124);
  });

  /** 2026-11-20：多 LoRA 串联 — 有序列表原样下发，首条回填旧字段（旧插件兼容）。 */
  it('多 LoRA 按顺序下发，并回填 lora_name/lora_strength', () => {
    const sharedLora = {
      params: {
        aspect: '21:9', scaleFactor: 1.5, steps: 12, cfg: 1, seed: -1, continuityOverlapFrames: 22,
        loras: [
          { name: 'a.safetensors', strength: 0.8 },
          { name: 'b.safetensors', strength: 0.5 },
        ],
      },
    } as unknown as WorkbenchSharedParams;
    const payload = buildDirectorBatchPayload({
      projectId: 'p', taskId: 't', shots: [shot(1)], selectedIds: ['s1'], shared: sharedLora,
    });
    const params = payload.segments[0]!.params;
    expect(params.loras).toEqual([
      { name: 'a.safetensors', strength: 0.8 },
      { name: 'b.safetensors', strength: 0.5 },
    ]);
    expect(params.lora_name).toBe('a.safetensors');
    expect(params.lora_strength).toBe(0.8);
  });
});
