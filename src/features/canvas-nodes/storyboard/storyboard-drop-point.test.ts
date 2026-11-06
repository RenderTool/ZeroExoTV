/**
 * 落点/占位框纯函数测试（2026-09-02 重构：整段蓝色虚线占位框方案）
 *
 * 核心不变量：渲染占位框的 left == 素材/片段实际落位后的 left（逐像素一致）。
 * 「占位框在哪 = 插到哪」由以下两组用例共同守护。
 */
import { describe, expect, it } from 'vitest';
import {
  computeInsertIndex,
  insertSeamX,
  movedClipLeft,
  clipPlaceholderWidth,
} from './storyboard-drop-point';

const GAP = 2;
/** A(0..100) B(102..202) C(204..304)，gap=2 */
const clips = [
  { left: 0, width: 100 },
  { left: 102, width: 100 },
  { left: 204, width: 100 },
];

/** 参照实现：按真实 reorder 逻辑算被拖元素落位后的 left（与 workbench 插入布局同一口径） */
function realMovedLeft(
  arr: Array<{ left: number; width: number; id: string }>,
  movedId: string,
  insertAt: number,
): { left: number; order: string[] } {
  const currentIdx = arr.findIndex((c) => c.id === movedId);
  const reordered = [...arr];
  const [moved] = reordered.splice(currentIdx, 1);
  reordered.splice(insertAt, 0, moved!);
  // 重新布局：left = 前序累计（模拟 useMemo clips 布局）
  let acc = 0;
  const next = reordered.map((c, i) => {
    const w = c.width;
    const l = acc;
    acc += w + GAP;
    return { ...c, index: i, left: l };
  });
  const m = next.find((c) => c.id === movedId)!;
  return { left: m.left, order: next.map((c) => c.id) };
}

describe('computeInsertIndex —— 中点归属（指针 → 插入下标）', () => {
  it('A 左半 → 0（插 A 前）；A 右半 → 1（插 A 后）', () => {
    expect(computeInsertIndex(30, clips)).toBe(0);
    expect(computeInsertIndex(80, clips)).toBe(1);
  });
  it('A/B gap → 1', () => {
    expect(computeInsertIndex(101.5, clips)).toBe(1);
  });
  it('B 右半 → 2；C 右半/末尾后 → 3', () => {
    expect(computeInsertIndex(160, clips)).toBe(2);
    expect(computeInsertIndex(280, clips)).toBe(3);
    expect(computeInsertIndex(400, clips)).toBe(3);
  });
  it('空轨道 → 0', () => {
    expect(computeInsertIndex(30, [])).toBe(0);
  });
});

describe('insertSeamX —— 外部插入占位框 left', () => {
  it('下标 0/1/2/3 分别落在 A 前 / A 后缝 / B 后缝 / 末尾', () => {
    expect(insertSeamX(0, clips)).toBe(0);
    expect(insertSeamX(1, clips)).toBe(102);
    expect(insertSeamX(2, clips)).toBe(204);
    expect(insertSeamX(3, clips)).toBe(306); // 末尾 = C.right(304) + gap
  });
  it('空轨道 → 0', () => {
    expect(insertSeamX(0, [])).toBe(0);
  });
});

describe('movedClipLeft —— 内部拖拽占位框 left == 松手后真实落位 left', () => {
  const arr = clips.map((c, i) => ({ ...c, id: `s${i}` }));

  // 从 B 出发，把所有最终下标跑一遍（finalIdx 即 up 提交的 insertAt）
  for (let finalIdx = 0; finalIdx < arr.length; finalIdx++) {
    it(`B(s1) → 最终下标 ${finalIdx}`, () => {
      const placeholderLeft = movedClipLeft(1, finalIdx, clips);
      const expected = realMovedLeft(arr, 's1', finalIdx).left;
      expect(placeholderLeft).toBe(expected);
    });
  }

  it('从 A(s0) 右移到 B 之后（最终下标 1）', () => {
    const placeholderLeft = movedClipLeft(0, 1, clips);
    const expected = realMovedLeft(arr, 's0', 1).left;
    expect(placeholderLeft).toBe(expected);
  });
});

describe('clipPlaceholderWidth', () => {
  it('按时长×pps 换算并 clamp', () => {
    expect(clipPlaceholderWidth(5, 20)).toBe(100);
    expect(clipPlaceholderWidth(0.2, 20)).toBe(10); // clamp 到 CLIP_MIN_WIDTH
    expect(clipPlaceholderWidth(0, 20)).toBe(10);
  });
});
