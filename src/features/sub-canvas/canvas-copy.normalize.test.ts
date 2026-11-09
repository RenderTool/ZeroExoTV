import { describe, expect, it } from 'vitest';
import type { NodeRecord } from '@zeroexo/core';
import { normalizeNodesToOrigin } from './canvas-copy.js';

const node = (id: string, x: number, y: number): NodeRecord => ({
  id,
  type: 'image',
  position: { x, y },
  data: {},
}) as NodeRecord;

describe('canvas copy 原点归一化', () => {
  it('按选区最小 x/y 平移到原点，保持相对布局', () => {
    const nodes = [node('a', 120, 300), node('b', 260, 340), node('c', 40, 420)];
    normalizeNodesToOrigin(nodes);
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 80, y: 0 },
      { x: 220, y: 40 },
      { x: 0, y: 120 },
    ]);
  });

  it('空数组 / 无坐标节点不抛错', () => {
    expect(() => normalizeNodesToOrigin([])).not.toThrow();
    expect(() => normalizeNodesToOrigin([{ id: 'x', type: 'text', data: {} } as NodeRecord])).not.toThrow();
  });
});
