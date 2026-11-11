/**
 * director-params 单测（对齐 ComfyUI_MiniMaxH3_Director 节点源码语义）
 * 覆盖：槽位分配 / 帧数学 / 预设切换 / schema 完整性 / 容器 sharedParams 往返 / 运行校验 / dry-run 摘要
 */
import { describe, expect, it } from 'vitest';
import {
  DIRECTOR_ASSET_CAPS,
  DIRECTOR_PARAM_SCHEMA,
  DIRECTOR_PRESETS,
  DirectorSlotOverflowError,
  DIRECTOR_ASPECT_OPTIONS,
  DIRECTOR_SCALE_OPTIONS,
  DIRECTOR_UI_PARAMS,
  MAX_GEN_FRAMES,
  alignFrames,
  clampScaleFactor,
  applyPreset,
  assignAssetSlots,
  buildPackSummary,
  durationToFrames,
  generationFrameBudget,
  resolveVideoSize,
  snapContinuityOverlap,
  validateRunSelection,
  type DirectorAssetRef,
  type RunShotLike,
  type SharedParamsLike,
} from '../director-params.js';
import {
  ensureWorkbenchContainer,
  migrateSharedPromptIntoShots,
  updateWorkbenchContainer,
  type ContainersIO,
} from '../slot-containers.js';

const img = (id: string): DirectorAssetRef => ({ id, kind: 'image' });
const aud = (id: string): DirectorAssetRef => ({ id, kind: 'audio' });
const vid = (id: string): DirectorAssetRef => ({ id, kind: 'video' });

describe('assignAssetSlots（唯一槽位分配函数）', () => {
  it('空公共 → 片段从 1 起', () => {
    const r = assignAssetSlots({ shared: [], segment: [img('a'), img('b')], tier: 'h3' });
    expect(r.segmentStartSlot).toEqual({ image: 1, audio: 1, video: 1 });
    expect(r.byAssetId['a']).toMatchObject({ slot: 1, label: 'Picture1', scope: 'segment' });
    expect(r.byAssetId['b']).toMatchObject({ slot: 2, label: 'Picture2' });
  });

  it('公共 2 图 1 音 → 片段图从 3、音从 2 续排（三类各自编号）', () => {
    const r = assignAssetSlots({
      shared: [img('s1'), img('s2'), aud('sa')],
      segment: [img('g1'), aud('ga'), vid('gv')],
      tier: 'h3',
    });
    expect(r.byAssetId['s1']).toMatchObject({ slot: 1, label: 'Picture1', scope: 'shared' });
    expect(r.byAssetId['s2']).toMatchObject({ slot: 2, label: 'Picture2', scope: 'shared' });
    expect(r.byAssetId['sa']).toMatchObject({ slot: 1, label: 'Audio1', scope: 'shared' });
    expect(r.byAssetId['g1']).toMatchObject({ slot: 3, label: 'Picture3', scope: 'segment' });
    expect(r.byAssetId['ga']).toMatchObject({ slot: 2, label: 'Audio2', scope: 'segment' });
    expect(r.byAssetId['gv']).toMatchObject({ slot: 1, label: 'Video1', scope: 'segment' });
    expect(r.segmentStartSlot).toEqual({ image: 3, audio: 2, video: 1 });
  });

  it('公共素材变动即时影响片段起始槽号', () => {
    const before = assignAssetSlots({ shared: [img('s1')], segment: [], tier: 'h3' });
    const after = assignAssetSlots({ shared: [img('s1'), img('s2'), img('s3')], segment: [], tier: 'h3' });
    expect(before.segmentStartSlot.image).toBe(2);
    expect(after.segmentStartSlot.image).toBe(4);
  });

  it('h3 第 10 图抛 DirectorSlotOverflowError（信息含上限 9）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => img(`g${i}`));
    expect(() => assignAssetSlots({ shared: [], segment: ten, tier: 'h3' }))
      .toThrowError(DirectorSlotOverflowError);
    expect(() => assignAssetSlots({ shared: [], segment: ten, tier: 'h3' })).toThrowError(/9/);
  });

  it('公共+片段合计超限同样拒绝（公共 5 + 片段 5 > 9）', () => {
    const shared = Array.from({ length: 5 }, (_, i) => img(`s${i}`));
    const segment = Array.from({ length: 5 }, (_, i) => img(`g${i}`));
    expect(() => assignAssetSlots({ shared, segment, tier: 'h3' })).toThrowError(DirectorSlotOverflowError);
  });

  it('sd2.5 第 10 图不抛、第 51 图抛（上限 50）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => img(`g${i}`));
    expect(() => assignAssetSlots({ shared: [], segment: ten, tier: 'sd2.5' })).not.toThrow();
    const fiftyOne = Array.from({ length: 51 }, (_, i) => img(`g${i}`));
    expect(() => assignAssetSlots({ shared: [], segment: fiftyOne, tier: 'sd2.5' })).toThrowError(/50/);
  });

  it('音/视第 4 个抛（两档上限均 3）', () => {
    const audios = Array.from({ length: 4 }, (_, i) => aud(`a${i}`));
    const videos = Array.from({ length: 4 }, (_, i) => vid(`v${i}`));
    expect(() => assignAssetSlots({ shared: [], segment: audios, tier: 'h3' })).toThrowError(/3/);
    expect(() => assignAssetSlots({ shared: [], segment: videos, tier: 'sd2.5' })).toThrowError(/3/);
  });
});

describe('帧数学（17k+5 吸附）', () => {
  it('8s=192 / 10s=243 / 12s=294 / 15s=362', () => {
    expect(alignFrames(192)).toBe(192);
    expect(alignFrames(240)).toBe(243);
    expect(alignFrames(288)).toBe(294);
    expect(alignFrames(360)).toBe(362);
    expect(durationToFrames(8)).toBe(192);
    expect(durationToFrames(10)).toBe(243);
    expect(durationToFrames(12)).toBe(294);
    expect(durationToFrames(15)).toBe(362);
  });

  it('MAX_GEN_FRAMES=736 在网格上；30.67s ≈ 736', () => {
    expect(MAX_GEN_FRAMES).toBe(736);
    expect(alignFrames(736)).toBe(736);
    expect(durationToFrames(30.67)).toBeLessThanOrEqual(736);
    expect(durationToFrames(31)).toBeGreaterThan(736);
  });

  it('延续法预算：visible=362 ctx=22 → align(384)=396', () => {
    expect(generationFrameBudget(362, 22)).toBe(396);
    expect(generationFrameBudget(362, 0)).toBe(362);
  });

  it('上下文帧数吸附：仅 5/22/39/56', () => {
    expect(snapContinuityOverlap(22)).toBe(22);
    expect(snapContinuityOverlap(20)).toBe(22);
    expect(snapContinuityOverlap(4)).toBe(5);
    expect(snapContinuityOverlap(60)).toBe(56);
  });
});

describe('clampScaleFactor（0.1–2 夹取，非法回退 1）', () => {
  it('七用例：0.1 / 2 / 0 / 3 / -1 / NaN / 空串', () => {
    expect(clampScaleFactor(0.1)).toBe(0.1);
    expect(clampScaleFactor(2)).toBe(2);
    expect(clampScaleFactor(0)).toBe(0.1);      // 夹回下界
    expect(clampScaleFactor(3)).toBe(2);         // 夹回上界
    expect(clampScaleFactor(-1)).toBe(0.1);      // 负数夹回下界
    expect(clampScaleFactor(NaN)).toBe(1);       // 非法回退默认
    expect(clampScaleFactor('')).toBe(1);        // 空串回退默认
  });

  it('历史枚举值自然兼容；换算实时跟随（×0.5 → 960×544，×1.5 → 1664×928）', () => {
    expect(clampScaleFactor(0.5)).toBe(0.5);
    expect(clampScaleFactor(1.25)).toBe(1.25);
    expect(resolveVideoSize('16:9', 0.5)).toEqual({ width: 960, height: 544 });
    expect(resolveVideoSize('16:9', 1.5)).toEqual({ width: 1664, height: 928 });
    // 超限输入也先夹取再换算：×3 → 按 ×2 算
    expect(resolveVideoSize('16:9', 3)).toEqual(resolveVideoSize('16:9', 2));
  });
});

describe('视频尺寸换算（比例 × 系数 → 宽高，32 对齐）', () => {
  it('16:9 × 1 → 1376×768（官方表 1.0MP）', () => {
    expect(resolveVideoSize('16:9', 1)).toEqual({ width: 1376, height: 768 });
  });

  it('9:16 × 1 → 768×1376；1:1 × 1 → 1024×1024', () => {
    expect(resolveVideoSize('9:16', 1)).toEqual({ width: 768, height: 1376 });
    expect(resolveVideoSize('1:1', 1)).toEqual({ width: 1024, height: 1024 });
  });

  it('各比例 × 各系数恒 32 对齐且 ≥32（缩放档也验，修前只验了 ×1）', () => {
    for (const a of DIRECTOR_ASPECT_OPTIONS) {
      for (const f of DIRECTOR_SCALE_OPTIONS) {
        const { width, height } = resolveVideoSize(a, f);
        expect(width % 32).toBe(0);
        expect(height % 32).toBe(0);
        expect(width).toBeGreaterThanOrEqual(32);
        expect(height).toBeGreaterThanOrEqual(32);
      }
    }
    const min = resolveVideoSize('16:9', 0.1);
    expect(min.width % 32).toBe(0);
    expect(min.height % 32).toBe(0);
  });

  it('官方 16:9 Size Settings Reference 逐行命中（系数 = 目标 MP）', () => {
    // 官方表（节点 Note: Size Settings Reference）：2.0 → 1920×1088
    const rows: Array<[number, number, number]> = [
      [0.2, 608, 352], [0.3, 736, 416], [0.4, 864, 480], [0.5, 960, 544],
      [0.6, 1056, 608], [0.7, 1152, 640], [0.8, 1216, 672], [0.9, 1280, 736],
      [0.98, 1344, 768], [1.0, 1376, 768], [1.2, 1504, 832], [1.5, 1664, 928],
      [1.8, 1824, 1024], [2.0, 1920, 1088],
    ];
    for (const [mp, w, h] of rows) {
      expect(resolveVideoSize('16:9', mp), `mp=${mp}`).toEqual({ width: w, height: h });
    }
  });

  it('×2（上限）= 2.0MP：16:9 → 1920×1088（1080 不是 32 倍数，取最近合法值）', () => {
    expect(resolveVideoSize('16:9', 2)).toEqual({ width: 1920, height: 1088 });
    expect(resolveVideoSize('9:16', 2)).toEqual({ width: 1088, height: 1920 });
    expect(resolveVideoSize('21:9', 2)).toEqual({ width: 2208, height: 960 });
    // 32 对齐是硬约束
    for (const aspect of DIRECTOR_ASPECT_OPTIONS) {
      const { width, height } = resolveVideoSize(aspect, 2);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
    }
  });

  it('系数放大单调：16:9 × 1.5 大于 × 1', () => {
    const s1 = resolveVideoSize('16:9', 1);
    const s15 = resolveVideoSize('16:9', 1.5);
    expect(s15.width).toBeGreaterThan(s1.width);
    expect(s15.height).toBeGreaterThan(s1.height);
  });

  it('UI 可见参数白名单：公共 2（无公共提示词）/ 片段 2（无负面提示词）/ 引导 4', () => {
    expect(DIRECTOR_UI_PARAMS.shared).toHaveLength(2);
    expect(DIRECTOR_UI_PARAMS.shared).not.toContain('global_prompt');
    expect(DIRECTOR_UI_PARAMS.segment).toHaveLength(2);
    expect(DIRECTOR_UI_PARAMS.segment).not.toContain('negativePrompt');
    expect(DIRECTOR_UI_PARAMS.continuity).toHaveLength(4);
  });
});

describe('参数模板（本地预设）', () => {
  it('两档预设默认值一致且全为 verified 字段', () => {
    expect(DIRECTOR_PRESETS.h3.params).toEqual(DIRECTOR_PRESETS['sd2.5'].params);
    const sharedVerified = DIRECTOR_PARAM_SCHEMA.filter((f) => f.scope === 'shared' && f.verified);
    expect(Object.keys(DIRECTOR_PRESETS.h3.params)).toHaveLength(sharedVerified.length);
    expect(DIRECTOR_PRESETS.h3.params['cfg']).toBe(1.0);
    expect(DIRECTOR_PRESETS.h3.params['steps']).toBe(8);
    expect(DIRECTOR_PRESETS.h3.params['width']).toBe(1376);
    expect(DIRECTOR_PRESETS.h3.params['continuityEnabled']).toBe(false);
    expect(DIRECTOR_PRESETS.h3.params['continuityOverlapFrames']).toBe(22);
  });

  it('applyPreset：保留同名已填值、其余取默认、resetKeys 正确', () => {
    const current = { task_type: 'r2v', width: 1728 };
    const { params, keptKeys, resetKeys } = applyPreset(current, 'h3');
    expect(params['task_type']).toBe('r2v');
    expect(params['width']).toBe(1728);
    expect(params['cfg']).toBe(1.0); // 未填 → 默认
    expect(keptKeys).toEqual(expect.arrayContaining(['task_type', 'width']));
    expect(resetKeys).toContain('cfg');
    expect(resetKeys).not.toContain('task_type');
  });

  it('h3 → sd2.5 切换保留同名值', () => {
    const { params } = applyPreset({ seed: 666 }, 'sd2.5');
    expect(params['seed']).toBe(666);
  });
});

describe('Schema 完整性', () => {
  it('39 项 = 公共 30 / 片段 9，每项带源码出处；公共提示词 global_prompt 已移除（2026-11-05 层下线）', () => {
    expect(DIRECTOR_PARAM_SCHEMA).toHaveLength(39);
    expect(DIRECTOR_PARAM_SCHEMA.filter((f) => f.scope === 'shared')).toHaveLength(30);
    expect(DIRECTOR_PARAM_SCHEMA.filter((f) => f.scope === 'segment')).toHaveLength(9);
    expect(DIRECTOR_PARAM_SCHEMA.some((f) => f.key === 'global_prompt')).toBe(false);
    for (const f of DIRECTOR_PARAM_SCHEMA) expect(f.source.length).toBeGreaterThan(0);
  });

  it('素材上限常量：h3 图 9 / sd2.5 图 50，音视均 3', () => {
    expect(DIRECTOR_ASSET_CAPS.h3).toEqual({ image: 9, audio: 3, video: 3 });
    expect(DIRECTOR_ASSET_CAPS['sd2.5']).toEqual({ image: 50, audio: 3, video: 3 });
  });
});

describe('容器 sharedParams 往返（内存 IO）', () => {
  function memoryIO(): ContainersIO & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
      store,
      readJson: async <T>(path: string) => (store.has(path) ? (store.get(path) as T) : null),
      writeJson: async (path: string, value: unknown) => { store.set(path, value); },
    };
  }

  it('updateWorkbenchContainer patch sharedParams 落盘并 version+1', async () => {
    const io = memoryIO();
    const { container } = await ensureWorkbenchContainer('p1', io);
    expect(container.sharedParams).toBeUndefined();
    const next = await updateWorkbenchContainer('p1', {
      sharedParams: {
        enabled: true,
        assets: [img('s1')],
        presetId: 'h3',
        params: { cfg: 1.0 },
      },
    }, io);
    expect(next.version).toBe(container.version + 1);
    expect(next.sharedParams).toMatchObject({ enabled: true, presetId: 'h3' });
    expect(next.sharedParams?.assets[0]).toMatchObject({ id: 's1', kind: 'image' });
    // 新写入不再产生公共提示词字段（2026-11-05 公共提示词层下线）
    expect(next.sharedParams).not.toHaveProperty('prompt');
    // shots 不受 sharedParams patch 影响（默认片段仍在）
    expect(next.shots).toHaveLength(1);
  });
});

describe('公共提示词一次性迁移（2026-11-05 层下线）', () => {
  function memoryIO(): ContainersIO & { store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
      store,
      readJson: async <T>(path: string) => (store.has(path) ? (store.get(path) as T) : null),
      writeJson: async (path: string, value: unknown) => { store.set(path, value); },
    };
  }

  /** 造一个带历史公共提示词的旧容器（模拟迁移前的 workbench.json） */
  async function seedLegacyContainer(io: ContainersIO, sharedPrompt: string) {
    const { container } = await ensureWorkbenchContainer('p1', io);
    const legacy = {
      ...container,
      shots: [
        { ...(container.shots[0] as Record<string, unknown>), imagePrompt: '段落提示词' },
        { ...(container.shots[0] as Record<string, unknown>), id: 'seg-2', number: 2, imagePrompt: '' },
      ],
      sharedParams: { enabled: true, prompt: sharedPrompt, assets: [img('s1')], presetId: 'h3', params: { cfg: 1.0 } },
    };
    await io.writeJson('projects/p1/entities/workbench.json', legacy);
    return legacy;
  }

  it('migrateSharedPromptIntoShots：非空公共提示词并入每段（含空段），去重不重复追加，字段清空，无关字段不动', () => {
    const legacy = {
      schemaVersion: 1 as const,
      version: 7,
      updatedAt: '2026-11-04T00:00:00.000Z',
      title: '导演台',
      tracks: [],
      shots: [
        { id: 'seg-1', number: 1, duration: 5, imagePrompt: '段落甲' },
        { id: 'seg-2', number: 2, duration: 8, imagePrompt: '' },
        { id: 'seg-3', number: 3, duration: 5, imagePrompt: '公共提示词\n\n段落乙' },
      ],
      totalDuration: 18,
      sharedParams: { enabled: true, prompt: ' 公共提示词 ', assets: [], presetId: 'h3', params: { cfg: 1.5 } },
    } as unknown as Parameters<typeof migrateSharedPromptIntoShots>[0];
    const migrated = migrateSharedPromptIntoShots(legacy);
    expect(migrated).not.toBeNull();
    // 每段都包含公共提示词：普通段前置并入、空段直接置为公共提示词、已包含段不重复追加
    expect(migrated!.shots[0]).toMatchObject({ imagePrompt: '公共提示词\n\n段落甲' });
    expect(migrated!.shots[1]).toMatchObject({ imagePrompt: '公共提示词' });
    expect(migrated!.shots[2]).toMatchObject({ imagePrompt: '公共提示词\n\n段落乙' });
    expect(((migrated!.shots[2] as { imagePrompt?: string }).imagePrompt ?? '').split('公共提示词').length - 1).toBe(1); // 无重复
    // 公共提示词字段清空（删除）
    expect(migrated!.sharedParams).not.toHaveProperty('prompt');
    // 无关字段不动
    expect(migrated!.sharedParams).toMatchObject({ enabled: true, presetId: 'h3', params: { cfg: 1.5 } });
    expect(migrated!.version).toBe(7);
    expect(migrated!.shots.map((s) => (s as { id: string }).id)).toEqual(['seg-1', 'seg-2', 'seg-3']);
  });

  it('migrateSharedPromptIntoShots：prompt 为空/缺失 → 无迁移', () => {
    for (const prompt of ['', '   ', undefined]) {
      const legacy = {
        schemaVersion: 1 as const, version: 3, updatedAt: '', title: '', tracks: [],
        shots: [{ id: 'seg-1', number: 1, duration: 5, imagePrompt: 'x' }],
        totalDuration: 5,
        sharedParams: { enabled: true, prompt, assets: [], presetId: 'h3' },
      } as unknown as Parameters<typeof migrateSharedPromptIntoShots>[0];
      expect(migrateSharedPromptIntoShots(legacy)).toBeNull();
      expect((legacy.shots[0] as { imagePrompt: string }).imagePrompt).toBe('x');
    }
  });

  it('ensureWorkbenchContainer：读取到历史公共提示词 → 一次性迁移落盘（version+1，幂等只做一次）', async () => {
    const io = memoryIO();
    await seedLegacyContainer(io, '公共提示词');
    const { container } = await ensureWorkbenchContainer('p1', io);
    // 每段提示词包含公共提示词且无重复
    expect(container.shots).toHaveLength(2);
    for (const s of container.shots as { imagePrompt?: string }[]) {
      expect(s.imagePrompt).toContain('公共提示词');
      expect(s.imagePrompt!.split('公共提示词').length - 1).toBe(1);
    }
    expect((container.shots[0] as { imagePrompt?: string }).imagePrompt).toBe('公共提示词\n\n段落提示词');
    expect((container.shots[1] as { imagePrompt?: string }).imagePrompt).toBe('公共提示词');
    // 公共提示词字段清空，其它 sharedParams 字段与素材不动
    expect(container.sharedParams).not.toHaveProperty('prompt');
    expect(container.sharedParams).toMatchObject({ enabled: true, presetId: 'h3', params: { cfg: 1.0 } });
    expect(container.sharedParams?.assets[0]).toMatchObject({ id: 's1', kind: 'image' });
    // 落盘 version+1
    expect(container.version).toBe(2);
    const persisted = await io.readJson<Record<string, unknown>>('projects/p1/entities/workbench.json');
    expect((persisted!.sharedParams as Record<string, unknown>)).not.toHaveProperty('prompt');
    // 幂等：再次读取不再迁移、version 不再前进
    const again = await ensureWorkbenchContainer('p1', io);
    expect(again.container.version).toBe(2);
    expect((again.container.shots[0] as { imagePrompt?: string }).imagePrompt).toBe('公共提示词\n\n段落提示词');
  });
});

describe('validateRunSelection / buildPackSummary（dry-run）', () => {
  const shot = (n: number, over: Partial<RunShotLike> = {}): RunShotLike => ({
    id: `seg-${n}`, number: n, duration: 5, status: 'pending', imagePrompt: '镜头内容', ...over,
  });
  const shared: SharedParamsLike = {
    enabled: true, assets: [], presetId: 'h3',
    params: { ...DIRECTOR_PRESETS.h3.params, continuityEnabled: true },
  };

  it('素材超限 → asset-overflow issue', () => {
    const ten = Array.from({ length: 10 }, (_, i) => img(`r${i}`));
    const issues = validateRunSelection({
      shots: [shot(1, { references: ten })], shared, tier: 'h3', selectedIds: ['seg-1'],
    });
    expect(issues.some((i) => i.code === 'asset-overflow')).toBe(true);
  });

  it('单段帧数超 736 → frame-overflow issue', () => {
    const issues = validateRunSelection({
      shots: [shot(1, { duration: 31 })], shared, tier: 'h3', selectedIds: ['seg-1'],
    });
    expect(issues.some((i) => i.code === 'frame-overflow')).toBe(true);
  });

  it('延续段前段未完成且不在本次选中 → continuation-blocked；同选前段或前段 done → 无 issue', () => {
    const shots = [shot(1), shot(2)];
    const blocked = validateRunSelection({ shots, shared, tier: 'h3', selectedIds: ['seg-2'] });
    expect(blocked.some((i) => i.code === 'continuation-blocked')).toBe(true);

    const together = validateRunSelection({ shots, shared, tier: 'h3', selectedIds: ['seg-1', 'seg-2'] });
    expect(together.some((i) => i.code === 'continuation-blocked')).toBe(false);

    const prevDone = validateRunSelection({
      shots: [shot(1, { status: 'done' }), shot(2)], shared, tier: 'h3', selectedIds: ['seg-2'],
    });
    expect(prevDone.some((i) => i.code === 'continuation-blocked')).toBe(false);
  });

  it('段 1 恒不延续（continuation 默认不影响段 1）', () => {
    const summary = buildPackSummary({ shots: [shot(1)], shared, tier: 'h3', selectedIds: ['seg-1'] });
    expect(summary.segments[0]?.continuityFromPrev).toBe(false);
    expect(summary.segments[0]?.ctxFrames).toBe(0);
  });

  it('提示词为空 → empty-prompt issue', () => {
    const issues = validateRunSelection({
      shots: [shot(1, { imagePrompt: '' })], shared,
      tier: 'h3', selectedIds: ['seg-1'],
    });
    expect(issues.some((i) => i.code === 'empty-prompt')).toBe(true);
  });

  it('buildPackSummary：槽位表 / 每段帧数 / 延续关系正确', () => {
    const shots = [
      shot(1, { duration: 5, references: [img('g1')] }),
      shot(2, { duration: 10, references: [img('g2')] }),
    ];
    const sh: SharedParamsLike = { ...shared, assets: [img('s1')] };
    const summary = buildPackSummary({ shots, shared: sh, tier: 'h3', selectedIds: ['seg-1', 'seg-2'] });

    expect(summary.format).toBe('minimax-h3-director-pack');
    expect(summary.formatVersion).toBe(1);
    expect(summary.sharedSlots).toEqual([
      expect.objectContaining({ assetId: 's1', label: 'Picture1', scope: 'shared' }),
    ]);
    const [s1, s2] = summary.segments;
    // 段 1：5s → 124 帧（17k+5：120→124），不延续；公共占 Picture1，组内 g1 = Picture2
    expect(s1?.frames).toBe(124);
    expect(s1?.continuityFromPrev).toBe(false);
    expect(s1?.slots.find((e) => e.assetId === 'g1')).toMatchObject({ label: 'Picture2', slot: 2 });
    // 段 2：10s → 243 帧；主开关开 + 段级默认 true → ctx=22，budget=align(243+22)=277
    expect(s2?.frames).toBe(243);
    expect(s2?.continuityFromPrev).toBe(true);
    expect(s2?.ctxFrames).toBe(22);
    expect(s2?.budgetFrames).toBe(277);
    expect(s2?.slots.find((e) => e.assetId === 'g2')).toMatchObject({ label: 'Picture2', slot: 2 });
    expect(summary.totalFrames).toBe(124 + 243);
    expect(summary.issues).toEqual([]);
  });

  it('主开关关（默认）时全段无延续 ctx', () => {
    const off: SharedParamsLike = { ...shared, params: { ...shared.params, continuityEnabled: false } };
    const summary = buildPackSummary({
      shots: [shot(1), shot(2)], shared: off, tier: 'h3', selectedIds: ['seg-1', 'seg-2'],
    });
    expect(summary.segments.every((s) => !s.continuityFromPrev && s.ctxFrames === 0)).toBe(true);
  });

  it('选中子集只含选中段', () => {
    const summary = buildPackSummary({
      shots: [shot(1), shot(2), shot(3)], shared, tier: 'h3', selectedIds: ['seg-2'],
    });
    expect(summary.segments).toHaveLength(1);
    expect(summary.segments[0]?.number).toBe(2);
  });
});
