import { describe, expect, it } from 'vitest';
import { clampQwenEdge, clampQwenSize, QWEN_MAX_EDGE } from './qwen-limits.js';

describe('Qwen 2K 尺寸限制', () => {
  it('单边夹到 64..2048 并按 16 对齐', () => {
    expect(clampQwenEdge(4096)).toBe(QWEN_MAX_EDGE);
    expect(clampQwenEdge(10)).toBe(64);
    expect(clampQwenEdge(1345)).toBe(1344);
    expect(clampQwenSize(340, 240)).toEqual({ width: 352, height: 256 });
  });

  it('总像素超过 4MP 时按比例缩小', () => {
    const size = clampQwenSize(4096, 4096);
    expect(size).toEqual({ width: 2048, height: 2048 });
    expect(clampQwenSize(2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });

  it('常用比例保持 2K 以内', () => {
    expect(clampQwenSize(1536, 864)).toEqual({ width: 1536, height: 864 });
    expect(clampQwenSize(864, 1536)).toEqual({ width: 864, height: 1536 });
  });

  it('超长边的源图按比例缩放，不能把 16:9 拉成 4:3', () => {
    expect(clampQwenSize(2730, 1536)).toEqual({ width: 2048, height: 1152 });
  });
});
