/**
 * asset-node-size 单测（2026-11-05 热修，征集 #174）
 *
 * 用户反馈：「资产或者提示词拖入画布和直接发送到画布行为不一致！表现为节点尺寸没有和内容对齐！」
 * 覆盖：
 * 1. 图片 payload 缺真实宽高 → 用 storageKey 解析链补全，并把 maxLongSide/fallbackSize 传给工厂；
 * 2. 长边按视口收敛（小窗口 40% 占比，下限 80），拿不到尺寸用中性 1:1（不再落 620×348 宽幅容器）；
 * 3. 非图片类型不读尺寸（行为与「发送到画布」一致）；
 * 4. 结构断言：拖拽链四个建节点入口全部走 createSizedAssetNode，源码内不得再出现裸 createAssetNode 调用
 *    （防止以后新增落图入口又漏接同一尺寸契约）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 读仓库源码（结构断言用；vitest cwd = 仓库根） */
const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf-8');

// 工厂函数用假实现：本文件只验「传了什么参数」，真实 fit 计算归 packages 的 media-fit 单测
vi.mock('@zeroexo/plugin-nodes', async () => {
  const contracts = await import('../../../../packages/plugins/nodes/src/utils/node-contracts.js');
  return {
    createAssetNode: vi.fn(async () => ({ id: 'node-x', type: 'image', position: { x: 0, y: 0 } })),
    IMAGE_LONG_SIDE: contracts.IMAGE_LONG_SIDE,
    MEDIA_MIN_SIZE: contracts.MEDIA_MIN_SIZE,
  };
});

vi.mock('@/shared/media/resolve-media-blob.js', () => ({
  resolveMediaBlobChain: vi.fn(),
}));
vi.mock('@/features/asset-picker/services/cas-upload.js', () => ({
  readImageDims: vi.fn(),
}));

import { createAssetNode } from '@zeroexo/plugin-nodes';
import { resolveMediaBlobChain } from '@/shared/media/resolve-media-blob.js';
import { readImageDims } from '@/features/asset-picker/services/cas-upload.js';
import {
  createSizedAssetNode,
  pickImageLongSide,
  withNaturalImageSize,
} from './asset-node-size.js';

const mockedCreate = vi.mocked(createAssetNode);
const mockedResolve = vi.mocked(resolveMediaBlobChain);
const mockedDims = vi.mocked(readImageDims);

/** 典型开源导入 payload：只有 storageKey，无 width/height（正是黑边事故现场） */
const IMAGE_NO_DIMS = { kind: 'image' as const, dataUrl: '', storageKey: 'cas:0123abcd.png', title: '图' };
const VIEWPORT = { width: 1400, height: 900 };

beforeEach(() => {
  mockedCreate.mockClear();
  mockedResolve.mockReset();
  mockedDims.mockReset();
  mockedResolve.mockResolvedValue(null);
  mockedDims.mockResolvedValue({ width: 0, height: 0 });
});

describe('createSizedAssetNode（拖入与发送共用唯一入口）', () => {
  it('图片缺真实宽高 → 先按 storageKey 补全，再带 maxLongSide/fallbackSize 建节点', async () => {
    mockedResolve.mockResolvedValueOnce({ blob: new Blob(['img'], { type: 'image/png' }) } as never);
    mockedDims.mockResolvedValueOnce({ width: 1024, height: 1365 });

    await createSizedAssetNode(IMAGE_NO_DIMS, { x: 10, y: 20 }, VIEWPORT);

    expect(mockedResolve).toHaveBeenCalledWith('cas:0123abcd.png', 'image', ['orig']);
    const [payload, pos, options] = mockedCreate.mock.calls[0]!;
    expect(payload).toMatchObject({ kind: 'image', width: 1024, height: 1365 });
    expect(pos).toEqual({ x: 10, y: 20 });
    expect(options).toEqual({ maxLongSide: 320, fallbackSize: { width: 320, height: 320 } });
  });

  it('已有真实宽高 → 不重复读原图（省一次解码）', async () => {
    await createSizedAssetNode({ ...IMAGE_NO_DIMS, width: 800, height: 600 }, { x: 0, y: 0 }, VIEWPORT);
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedCreate.mock.calls[0]![0]).toMatchObject({ width: 800, height: 600 });
  });

  it('拿不到尺寸 → 中性 1:1 兜底（不再落 620×348 宽幅容器）', async () => {
    await createSizedAssetNode(IMAGE_NO_DIMS, { x: 0, y: 0 }, VIEWPORT);
    expect(mockedCreate.mock.calls[0]![2]).toEqual({ maxLongSide: 320, fallbackSize: { width: 320, height: 320 } });
  });

  it('视频/音频/文本不读尺寸（与「发送到画布」同行为）', async () => {
    await createSizedAssetNode({ kind: 'video', url: 'blob:v', storageKey: 'cas:v.mp4', title: '视频' }, { x: 0, y: 0 }, VIEWPORT);
    expect(mockedResolve).not.toHaveBeenCalled();
  });
});

describe('pickImageLongSide（长边上限按视口收敛）', () => {
  it('常规视口 → 契约值 320', () => {
    expect(pickImageLongSide(VIEWPORT)).toBe(320);
  });

  it('小窗口 → 视口短边 40%，且不低于 80', () => {
    expect(pickImageLongSide({ width: 600, height: 400 })).toBe(160);
    expect(pickImageLongSide({ width: 100, height: 80 })).toBe(80);
  });

  it('容器未测量（0×0）→ 退回契约值，不甩出异常尺寸', () => {
    expect(pickImageLongSide({ width: 0, height: 0 })).toBe(320);
  });
});

describe('withNaturalImageSize 失败不阻断', () => {
  it('解析链抛错 → 原样返回 payload（由节点视图 onload 纠偏兜底）', async () => {
    mockedResolve.mockRejectedValueOnce(new Error('文件缺失'));
    const out = await withNaturalImageSize(IMAGE_NO_DIMS);
    expect(out).toBe(IMAGE_NO_DIMS);
  });
});

describe('结构断言：拖拽链不得再写第二套尺寸', () => {
  it('drop-handler 四个建节点入口全部走 createSizedAssetNode，源码零裸 createAssetNode 调用', () => {
    const src = readSrc('src/features/canvas-interaction/drop-handler.ts');
    expect(src).toContain('createSizedAssetNode');
    expect(src).not.toMatch(/createAssetNode\s*\(/);
    expect(src).not.toContain("from '@zeroexo/plugin-nodes'");
  });

  it('「发送到画布」链路引用同一入口（不再本地重复实现尺寸逻辑）', () => {
    const src = readSrc('src/pages/editor/editor-canvas/insert-asset-to-canvas.ts');
    expect(src).toContain('createSizedAssetNode');
    expect(src).not.toContain('withNaturalImageSize');
    expect(src).not.toContain('const IMAGE_LONG_SIDE');
  });
});
