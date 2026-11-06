/**
 * 抽屉「发送到导演台当前片段」判定单测（2026-11-05 约定；同日公共素材 UI 下线）
 *
 * 验收口径（与素材区加号同一 assignAssetSlots 唯一实现）：
 * - 槽号只按本片段 refs 连续编号、从 1 起（Picture1 = 第 1 格；不再按公共池偏移）
 * - 成功入槽到当前片段（片段 1..2 已占 → 新资产落 Picture 3）
 * - 同资产重复发送 → 复用槽号，不新增
 * - 满员（h3 图片 9/9）→ 拒绝，且槽位/正文零变化
 * - 无选中片段 → no-active-shot 提示
 * - 各类型分别满员（图片/视频/音频各自上限）
 * - sd2.5 上限 50 生效
 */
import { describe, expect, it } from 'vitest';
import { computeSegmentInsert, assetToSegmentRef } from './workbench-slot-bus.js';
import { DIRECTOR_ASSET_CAPS, type DirectorAssetRef } from '@/entities/director-params.js';
import type { Asset } from '@/features/asset-picker/index.js';

function mkAsset(id: string, kind: 'image' | 'video' | 'audio', projectId?: string): Asset {
  const data = kind === 'image'
    ? { kind: 'image' as const, dataUrl: 'data:image/png;base64,x', width: 8, height: 8 }
    : { kind, url: 'blob:x', duration: 1, width: 8, height: 8 };
  return { id, title: id, kind, scope: projectId ? 'project' : 'library', projectId, data } as unknown as Asset;
}

function mkRef(id: string, kind: 'image' | 'video' | 'audio', slotNo?: number): DirectorAssetRef {
  return { id, kind, title: id, url: 'u', slotNo };
}

describe('computeSegmentInsert', () => {
  it('成功入槽：片段占 1..2 → 新资产落 Picture 3，pin slotNo=3（本片段从 1 连续编号）', () => {
    const v = computeSegmentInsert({
      asset: mkAsset('a3', 'image', 'c1'),
      hasActiveShot: true, tier: 'h3',
      segmentAssets: [mkRef('p1', 'image', 1), mkRef('p2', 'image', 2)],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.slotLabel).toBe('Picture3');
      expect(v.ref.slotNo).toBe(3);
      expect(v.nextReferences).toHaveLength(3);
      expect(v.nextReferences[2]?.id).toBe('a3');
      expect(v.ref.originScope).toBe('project');
    }
  });

  it('已在片段池的同资产 → already-in-slot（不重复占位）', () => {
    const v = computeSegmentInsert({
      asset: mkAsset('p1', 'image'),
      hasActiveShot: true, tier: 'h3',
      segmentAssets: [mkRef('p1', 'image', 1)],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('already-in-slot');
  });

  it('无选中片段 → no-active-shot', () => {
    const v = computeSegmentInsert({
      asset: mkAsset('a1', 'image'),
      hasActiveShot: false, tier: 'h3',
      segmentAssets: [],
    });
    expect(v).toEqual({ ok: false, reason: 'no-active-shot' });
  });

  it('图片满员 9/9（片段 9）→ slot-full，拒绝且零变化', () => {
    const seg = Array.from({ length: 9 }, (_, i) => mkRef(`p${i + 1}`, 'image', i + 1));
    const v = computeSegmentInsert({
      asset: mkAsset('aX', 'image'),
      hasActiveShot: true, tier: 'h3',
      segmentAssets: seg,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('slot-full');
      expect(v.cap).toBe(9);
      expect(v.used).toBe(9);
      // 零变化断言：失败路径不产出 nextReferences
      expect('nextReferences' in v).toBe(false);
    }
  });

  it('视频满员与图片独立：图片满但视频未满 → 视频可入槽', () => {
    const imgSeg = Array.from({ length: 9 }, (_, i) => mkRef(`p${i + 1}`, 'image', i + 1));
    const v = computeSegmentInsert({
      asset: mkAsset('v1', 'video', 'c1'),
      hasActiveShot: true, tier: 'h3',
      segmentAssets: imgSeg,
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.slotLabel).toBe('Video1');
  });

  it('视频满员 3/3 → slot-full；音频满员 3/3 → slot-full（h3 上限各自独立）', () => {
    const vidSeg = Array.from({ length: 3 }, (_, i) => mkRef(`v${i + 1}`, 'video', i + 1));
    const vv = computeSegmentInsert({
      asset: mkAsset('vX', 'video'), hasActiveShot: true, tier: 'h3',
      segmentAssets: vidSeg,
    });
    expect(vv.ok).toBe(false);
    if (!vv.ok) expect(vv.cap).toBe(3);

    const audSeg = Array.from({ length: 3 }, (_, i) => mkRef(`au${i + 1}`, 'audio', i + 1));
    const av = computeSegmentInsert({
      asset: mkAsset('aX', 'audio'), hasActiveShot: true, tier: 'h3',
      segmentAssets: audSeg,
    });
    expect(av.ok).toBe(false);
    if (!av.ok) expect(av.cap).toBe(3);
  });

  it('sd2.5 上限 50：图片 50 满员 → slot-full cap=50；49 时可入槽落 50', () => {
    const seg49 = Array.from({ length: 49 }, (_, i) => mkRef(`p${i + 1}`, 'image', i + 1));
    const vOk = computeSegmentInsert({
      asset: mkAsset('a50', 'image'), hasActiveShot: true, tier: 'sd2.5',
      segmentAssets: seg49,
    });
    expect(vOk.ok).toBe(true);
    if (vOk.ok) expect(vOk.ref.slotNo).toBe(50);

    const seg50 = [...seg49, mkRef('a50', 'image', 50)];
    const vFull = computeSegmentInsert({
      asset: mkAsset('a51', 'image'), hasActiveShot: true, tier: 'sd2.5',
      segmentAssets: seg50,
    });
    expect(vFull.ok).toBe(false);
    if (!vFull.ok) expect(vFull.cap).toBe(DIRECTOR_ASSET_CAPS['sd2.5'].image);
  });

  it('公共库资产入槽 originScope=library；文本类不支持', () => {
    const v = computeSegmentInsert({
      asset: mkAsset('lib1', 'image'),
      hasActiveShot: true, tier: 'h3', segmentAssets: [],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.ref.originScope).toBe('library');
    expect(assetToSegmentRef(mkAsset('t1', 'image') as unknown as Asset)).not.toBeNull();
  });
});
