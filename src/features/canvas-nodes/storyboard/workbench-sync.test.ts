/**
 * workbench-sync 纯函数测试（Plan#74 E2/E3）
 *
 * 覆盖：
 * - fingerprintSourceShots：稳定确定性 hash，同内容入参与出同指纹
 * - buildWorkbenchSync 连入建 active 轨 / 重连无差异沿用 / 重连有差异建 candidate 轨
 * - resolveShotsForTrack：池优先 + clip.instanceData 兜底
 * - resolveSuperimpose：上优先 + 空档回填裁决矩阵
 *
 * 测试风格仿 storyboard-drop-point.test.ts（vitest，纯函数，无 React 依赖）。
 */
import { describe, expect, it, vi } from 'vitest';
// storyboard-utils → @zeroexo/plugin-nodes 引 chain 到 antd/fluent-emoji（jsdom 无法解析 ESM 目录导入）。
// 单测只需纯函数，这里 mock 掉 plugin-nodes 暴露的运行时符号（resolveContentUrl 纯文本透传即可）。
vi.mock('@zeroexo/plugin-nodes', () => ({
  resolveContentUrl: (url: string) => url,
  nodeActionBus: { emit: () => {}, on: () => () => {} },
}));
import {
  fingerprintSourceShots,
  buildWorkbenchSync,
  resolveShotsForTrack,
  resolveSuperimpose,
  ensureDefaultShot,
  canDeleteShots,
  DEFAULT_CLIP_DURATION_SEC,
} from './workbench-sync';
import type { WorkbenchNodeData } from './workbench-types';

const SOURCE_A = [
  { id: 'a1', description: '日出', shotType: 'wide', duration: 3 },
  { id: 'a2', description: '奔跑', shotType: 'mid', duration: 2 },
];

function emptyData(): WorkbenchNodeData {
  return {
    status: 'idle' as const,
    shots: [],
    totalDuration: 0,
    completedCount: 0,
  };
}

describe('fingerprintSourceShots', () => {
  it('同内容返回同指纹', () => {
    expect(fingerprintSourceShots(SOURCE_A)).toBe(fingerprintSourceShots(SOURCE_A));
  });
  it('内容变化指纹变化', () => {
    const changed = [{ ...SOURCE_A[0]!!, description: '日落' }, SOURCE_A[1]!!];
    expect(fingerprintSourceShots(changed)).not.toBe(fingerprintSourceShots(SOURCE_A));
  });
  it('顺序变化指纹变化', () => {
    const swapped = [SOURCE_A[1]!!, SOURCE_A[0]!!];
    expect(fingerprintSourceShots(swapped)).not.toBe(fingerprintSourceShots(SOURCE_A));
  });
});

describe('buildWorkbenchSync', () => {
  const sourceNode = { id: 'sb-1', title: '分镜A' };

  it('首次连入建 active 轨，status 就绪', () => {
    const r = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    expect(r.changed).toBe(true);
    expect(r.status).toBe('ready');
    expect(r.tracks).toHaveLength(1);
    const track = r.tracks[0]!;
    expect(track.status).toBe('active');
    expect(track.sourceChain.origin).toBe('sb-1');
    expect(track.name).toBe('分镜A');
    expect(track.order).toBe(1);
    expect(track.contentFingerprint).toBe(fingerprintSourceShots(SOURCE_A));
    expect(track.clips).toHaveLength(2);
    // 上沿累计摆位
    expect(track.clips[0]!.timeline.startMs).toBe(0);
    expect(track.clips[1]!.timeline.startMs).toBe(3000);
  });

  it('重连且内容无差异：沿用现有轨，不新建（不抖动）', () => {
    const first = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    const current: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: first.shots,
      tracks: first.tracks,
    };
    const r = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current,
      event: 'reconnect',
    });
    expect(r.changed).toBe(false);
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]!.status).toBe('active');
  });

  it('重连且内容有差异：建 candidate 轨，不替换原方案', () => {
    const first = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    const current: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: first.shots,
      tracks: first.tracks,
    };
    const changedShots = [{ ...SOURCE_A[0]!, description: '日出改版' }, SOURCE_A[1]!];
    const r = buildWorkbenchSync({
      sourceNode,
      sourceShots: changedShots,
      sourceData: {},
      current,
      event: 'reconnect',
    });
    expect(r.changed).toBe(true);
    expect(r.tracks).toHaveLength(2);
    const active = r.tracks.find((t) => t.status === 'active');
    const cand = r.tracks.find((t) => t.status === 'candidate');
    expect(active?.name).toBe('分镜A');
    expect(cand?.name).toContain('方案');
    // candidate 下沉：order 大于 active
    expect((cand?.order ?? 0)).toBeGreaterThan((active?.order ?? 0));
  });

  it('多分镜连入 → 多轨并存', () => {
    const first = buildWorkbenchSync({
      sourceNode: { id: 'sb-1', title: '分镜A' },
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    const current: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: first.shots,
      tracks: first.tracks,
    };
    const r = buildWorkbenchSync({
      sourceNode: { id: 'sb-2', title: '分镜B' },
      sourceShots: [{ id: 'b1', description: '特写', shotType: 'close', duration: 1 }],
      sourceData: {},
      current,
      event: 'connect',
    });
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks.map((t) => t.sourceChain.origin)).toEqual(['sb-1', 'sb-2']);
  });

  it('PE3：全归档后重连无差异 → 复活归档轨为 active，不新建', () => {
    const first = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    // 断开归档（PE3 断开处置后的宿主状态）
    const current: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: first.shots,
      tracks: first.tracks.map((t) => ({ ...t, status: 'discarded' as const })),
    };
    const r = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current,
      event: 'reconnect',
    });
    expect(r.changed).toBe(true);
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0]!.status).toBe('active');
    // 复活而非重建：clips 快照保留（用户已排不丢）
    expect(r.tracks[0]!.id).toBe(first.tracks[0]!.id);
    expect(r.tracks[0]!.clips).toHaveLength(2);
  });

  it('PE3：全归档后重连有差异 → 建新 active 轨，原归档轨保留', () => {
    const first = buildWorkbenchSync({
      sourceNode,
      sourceShots: SOURCE_A,
      sourceData: {},
      current: emptyData(),
      event: 'connect',
    });
    const current: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: first.shots,
      tracks: first.tracks.map((t) => ({ ...t, status: 'discarded' as const })),
    };
    const changedShots = [{ ...SOURCE_A[0]!, description: '日出改版' }, SOURCE_A[1]!];
    const r = buildWorkbenchSync({
      sourceNode,
      sourceShots: changedShots,
      sourceData: {},
      current,
      event: 'reconnect',
    });
    expect(r.changed).toBe(true);
    expect(r.tracks).toHaveLength(2);
    const active = r.tracks.find((t) => t.status === 'active');
    const archived = r.tracks.find((t) => t.status === 'discarded');
    expect(active).toBeTruthy();
    expect(active?.sourceChain.origin).toBe('sb-1');
    expect(active?.clips[0]!.instanceData?.description).toBe('日出改版');
    // 原归档轨保留（不丢用户已排快照）
    expect(archived?.id).toBe(first.tracks[0]!.id);
  });
});

describe('resolveShotsForTrack', () => {
  it('池优先；无源 media clip 用 instanceData 兜底', () => {
    const data: WorkbenchNodeData = {
      ...emptyData(),
      status: 'ready',
      shots: [
        { id: 's1', number: 1, description: '池镜', shotType: 'w', duration: 2, status: 'pending', clipState: 'placeholder' },
      ],
    };
    const track = {
      id: 't1',
      name: 'T',
      sourceChain: { origin: 'sb-1' },
      status: 'active' as const,
      order: 1,
      clips: [
        { ref: { sourceShotId: 's1', kind: 'shot' as const }, timeline: { startMs: 0, durationMs: 2000 }, instanceData: { number: 1 } },
        { ref: { sourceShotId: 'sx', kind: 'shot' as const }, timeline: { startMs: 2000, durationMs: 1500 }, instanceData: { id: 'sx', number: 2, description: '兜底', shotType: 'c', duration: 1.5, status: 'pending' as const, clipState: 'placeholder' as const } },
      ],
    };
    const shots = resolveShotsForTrack(track, data);
    expect(shots).toHaveLength(2);
    expect(shots[0]!.description).toBe('池镜');
    expect(shots[1]!.description).toBe('兜底');
    expect(shots[1]!.duration).toBeCloseTo(1.5);
    expect(shots[1]!.sourceShotId).toBe('sx');
  });
});

describe('ensureDefaultShot（2026-11-04 出片页：空数据默认 1 个片段）', () => {
  it('空 shots → 自动补 1 个占位片段（序号 1）', () => {
    const data = emptyData();
    const next = ensureDefaultShot(data);
    expect(next).not.toBe(data);
    expect(next.shots).toHaveLength(1);
    expect(next.shots[0]!.number).toBe(1);
    expect(next.shots[0]!.clipState).toBe('placeholder');
    expect(next.shots[0]!.duration).toBe(DEFAULT_CLIP_DURATION_SEC);
  });

  it('已有片段 → 原样返回（同引用，不触发写回）', () => {
    const data: WorkbenchNodeData = {
      ...emptyData(),
      shots: [
        { id: 's1', number: 1, description: '', shotType: '中景', duration: 5, status: 'pending', clipState: 'placeholder' },
      ],
    };
    expect(ensureDefaultShot(data)).toBe(data);
    expect(ensureDefaultShot(data).shots).toHaveLength(1);
  });
});

describe('canDeleteShots（2026-11-04 出片页：删除保护，至少保留 1 个片段）', () => {
  it('仅剩 1 个片段时删除被拒', () => {
    expect(canDeleteShots(1, 1)).toBe(false);
  });
  it('批量删除到 0 被拒', () => {
    expect(canDeleteShots(2, 2)).toBe(false);
  });
  it('删除后仍 ≥1 放行', () => {
    expect(canDeleteShots(2, 1)).toBe(true);
    expect(canDeleteShots(3, 2)).toBe(true);
  });
});

describe('resolveSuperimpose', () => {
  const track = (id: string, order: number, status: 'active' | 'candidate', starts: Array<[number, number]>) => ({
    id,
    name: id,
    sourceChain: { origin: id },
    status,
    order,
    clips: starts.map(([t0, t1]) => ({
      ref: { sourceShotId: `${id}-${t0}`, kind: 'shot' as const },
      timeline: { startMs: t0, durationMs: t1 - t0 },
    })),
  });

  it('单轨：全部命中该轨，无空档', () => {
    const slots = resolveSuperimpose([track('act', 1, 'active', [[0, 3000], [3000, 6000]])]);
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.trackId === 'act')).toBe(true);
    expect(slots.every((s) => !s.backfilled)).toBe(true);
  });

  it('上优先：最上 active 轨覆盖共同区间，candidate 只回填空档', () => {
    // 主轨 act 覆盖 [0,6000)；候选轨 cand 覆盖 [0,3000] 完全被占用 → 无回填贡献
    const slots = resolveSuperimpose([
      track('act', 1, 'active', [[0, 6000]]),
      track('cand', 2, 'candidate', [[0, 3000]]),
    ]);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.trackId).toBe('act');
  });

  it('空档回填：主轨中间有空档，下方轨回填', () => {
    // act: [0,2000) + [4000,6000)，中间 [2000,4000) 空档；cand 覆盖 [2000,4000) → 回填
    const slots = resolveSuperimpose([
      track('act', 1, 'active', [[0, 2000], [4000, 6000]]),
      track('cand', 2, 'candidate', [[2000, 4000]]),
    ]);
    expect(slots).toHaveLength(3);
    const fill = slots.find((s) => s.backfilled);
    expect(fill?.trackId).toBe('cand');
    expect(slots.filter((s) => !s.backfilled && s.trackId === 'act')).toHaveLength(2);
  });
});