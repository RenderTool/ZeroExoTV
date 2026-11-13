/**
 * 主体状态出图参数（2026-11-13 P0）：尺寸换算 / 默认值 / 持久化字段解析。
 */
import { describe, expect, it } from 'vitest';
import { resolveSubjectGenParams, subjectGenSize } from './subject-generation';
import { createSubjectNode, createSubjectTree, SUBJECT_BASE_STATE_ID } from './subject-tree-types';
import { LOCAL_IMAGE_MODEL_KEY, MOSS_MODEL_KEY } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

describe('subjectGenSize：1K / 2K 最长边 + 32 对齐', () => {
  it('16:9 2K = 2048×1152，1K = 1024×576', () => {
    expect(subjectGenSize('16:9', '2k')).toEqual({ width: 2048, height: 1152 });
    expect(subjectGenSize('16:9', '1k')).toEqual({ width: 1024, height: 576 });
  });

  it('竖图走短边为长边的那一侧，且不超过 2048', () => {
    expect(subjectGenSize('9:16', '2k')).toEqual({ width: 1152, height: 2048 });
    expect(subjectGenSize('1:1', '2k')).toEqual({ width: 2048, height: 2048 });
  });
});

describe('resolveSubjectGenParams：状态各自持久化，缺省跟画布一致', () => {
  it('基础状态默认 16:9 / 2K / 25 步 / 随机种子，且没有「引用基础图」', () => {
    const tree = createSubjectTree('character', '素羽');
    const base = tree.states[0]!;
    const p = resolveSubjectGenParams(base);
    expect(p.aspect).toBe('16:9');
    expect(p.quality).toBe('2k');
    expect(p.width).toBe(2048);
    expect(p.height).toBe(1152);
    expect(p.steps).toBe(25);
    expect(p.seed).toBe(-1);
    expect(p.useBaseRef).toBe(false);
    expect(p.referenceKeys).toEqual([]);
  });

  it('派生状态默认引用基础状态图；用户写入的参数原样保留', () => {
    const tree = createSubjectTree('character', '素羽');
    const node = createSubjectNode('铠甲态', 'image', 'user', tree.rootId, { step: 2 });
    node.imageModel = LOCAL_IMAGE_MODEL_KEY;
    node.genParams = {
      aspect: '3:4', quality: '1k', steps: 30, cfg: 1.2, seed: 42,
      useBaseRef: false, referenceKeys: ['cas:abc.png'],
    };
    const p = resolveSubjectGenParams(node);
    expect(p.aspect).toBe('3:4');
    expect(p.width).toBe(768);
    expect(p.height).toBe(1024);
    expect(p.steps).toBe(30);
    expect(p.cfg).toBe(1.2);
    expect(p.seed).toBe(42);
    expect(p.useBaseRef).toBe(false);
    expect(p.referenceKeys).toEqual(['cas:abc.png']);
  });

  it('Moss 默认步数/贴合度跟随模型；基础状态 id 不参与引用开关', () => {
    const tree = createSubjectTree('character', '素羽');
    const node = tree.states[0]!;
    expect(node.id).toBe(SUBJECT_BASE_STATE_ID);
    node.imageModel = MOSS_MODEL_KEY;
    node.genParams = { useBaseRef: true };
    const p = resolveSubjectGenParams(node);
    expect(p.steps).toBe(25);
    expect(p.cfg).toBe(2.5);
    expect(p.useBaseRef).toBe(false);
  });

  it('自定义尺寸按 32 对齐夹取（最长边 ≤2048）', () => {
    const tree = createSubjectTree('character', '素羽');
    const node = createSubjectNode('特写', 'image', 'user', tree.rootId, { step: 2 });
    node.genParams = { quality: 'custom', width: 3000, height: 2000 };
    const p = resolveSubjectGenParams(node);
    expect(p.width * p.height).toBeLessThanOrEqual(2048 * 2048);
    expect(p.width % 32).toBe(0);
    expect(p.height % 32).toBe(0);
  });
});
