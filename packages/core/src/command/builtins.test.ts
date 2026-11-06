import { describe, it, expect } from 'vitest';
import {
  AddNodeCommand,
  RemoveNodeCommand,
  MoveNodeCommand,
  AddEdgeCommand,
  RemoveEdgeCommand,
  UpdateNodeDataCommand,
} from './builtins.js';
import type { GraphModel, NodeRecord, EdgeRecord } from '../model/types.js';

function makeGraph(nodes: NodeRecord[] = [], edges: EdgeRecord[] = []): GraphModel {
  return { nodes, edges, viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

function makeNode(id: string, x = 0, y = 0, data?: unknown): NodeRecord {
  return { id, type: 'test', position: { x, y }, data };
}

function makeEdge(id: string): EdgeRecord {
  return { id, source: { nodeId: 'a' }, target: { nodeId: 'b' } };
}

const ctx = { eventBus: { emit: () => undefined } } as never;

describe('RemoveNodeCommand（墓碑机制 Plan#80 Phase A）', () => {
  it('TC-A1: execute 用 map 标记 _deleted 节点仍在数组中', () => {
    const node = makeNode('n1');
    const cmd = new RemoveNodeCommand('n1');
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!._deleted).toBe(true);
    expect(result.nodes[0]!.deletedAt).toBeTypeOf('number');
    const other = makeNode('n2');
    const r2 = cmd.execute(makeGraph([node, other]), ctx);
    expect(r2.nodes).toHaveLength(2);
    expect(r2.nodes.find((n) => n.id === 'n2')!._deleted).toBeUndefined();
  });

  it('TC-A2: undo 翻转 _deleted 标记「复活」节点完整保留原始数据', () => {
    const node = makeNode('n1');
    const cmd = new RemoveNodeCommand('n1');
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes).toHaveLength(1);
    expect(restored.nodes[0]!.id).toBe('n1');
    expect(restored.nodes[0]!._deleted).toBe(false);
    expect(restored.nodes[0]!.deletedAt).toBeUndefined();
    expect(restored.nodes[0]!.type).toBe('test');
  });

  it('节点不存在时 execute 不变（无节点被标记）', () => {
    const cmd = new RemoveNodeCommand('missing');
    const r = cmd.execute(makeGraph([makeNode('other')]), ctx);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]!._deleted).toBeUndefined();
    const u = cmd.undo(r, ctx);
    expect(u.nodes).toHaveLength(1);
    expect(u.nodes[0]!._deleted).toBeUndefined();
  });

  it('A4: 反复 undo 不累积 deletedAt/_deleted 残留', () => {
    const cmd = new RemoveNodeCommand('n1');
    let s = makeGraph([makeNode('n1')]);
    for (let i = 0; i < 3; i++) {
      s = cmd.execute(s, ctx);
      expect(s.nodes[0]!._deleted).toBe(true);
      s = cmd.undo(s, ctx);
      expect(s.nodes[0]!._deleted).toBe(false);
      expect(s.nodes[0]!.deletedAt).toBeUndefined();
    }
  });
});

describe('AddNodeCommand', () => {
  it('execute 添加节点', () => {
    const node = makeNode('n1');
    const cmd = new AddNodeCommand(node);
    const result = cmd.execute(makeGraph(), ctx);
    expect(result.nodes).toHaveLength(1);
  });
  it('undo 移除节点', () => {
    const node = makeNode('n1');
    const cmd = new AddNodeCommand(node);
    const after = cmd.execute(makeGraph(), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes).toHaveLength(0);
  });
});

describe('MoveNodeCommand', () => {
  it('execute 按 delta 移动节点', () => {
    const node = makeNode('n1', 10, 20);
    const cmd = new MoveNodeCommand('n1', { x: 5, y: -3 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.position).toEqual({ x: 15, y: 17 });
  });
  it('undo 反向移动', () => {
    const node = makeNode('n1', 10, 20);
    const cmd = new MoveNodeCommand('n1', { x: 5, y: -3 });
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes[0]!.position).toEqual({ x: 10, y: 20 });
  });
  it('节点不存在时 execute 不变', () => {
    const cmd = new MoveNodeCommand('missing', { x: 5, y: 5 });
    const result = cmd.execute(makeGraph([makeNode('other')]), ctx);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });
});

describe('AddEdgeCommand', () => {
  it('execute 添加边', () => {
    const cmd = new AddEdgeCommand(makeEdge('e1'));
    const result = cmd.execute(makeGraph(), ctx);
    expect(result.edges).toHaveLength(1);
  });
  it('undo 移除边', () => {
    const cmd = new AddEdgeCommand(makeEdge('e1'));
    const after = cmd.execute(makeGraph(), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.edges).toHaveLength(0);
  });
});

describe('RemoveEdgeCommand', () => {
  it('execute 移除边', () => {
    const edge = makeEdge('e1');
    const cmd = new RemoveEdgeCommand('e1');
    const result = cmd.execute(makeGraph([makeNode('a'), makeNode('b')], [edge]), ctx);
    expect(result.edges).toHaveLength(0);
  });
  it('undo 恢复被移除的边', () => {
    const edge = makeEdge('e1');
    const cmd = new RemoveEdgeCommand('e1');
    const after = cmd.execute(makeGraph([makeNode('a'), makeNode('b')], [edge]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.edges).toHaveLength(1);
    expect(restored.edges[0]).toBe(edge);
  });
  it('边不存在时 execute 不变,undo 无恢复', () => {
    const cmd = new RemoveEdgeCommand('missing');
    const result = cmd.execute(makeGraph([], [makeEdge('other')]), ctx);
    expect(result.edges).toHaveLength(1);
    const restored = cmd.undo(result, ctx);
    expect(restored.edges).toHaveLength(1);
  });
});

describe('UpdateNodeDataCommand', () => {
  it('execute 合并 patch 到现有 data', () => {
    const node = makeNode('n1', 0, 0, { foo: 1, bar: 2 });
    const cmd = new UpdateNodeDataCommand('n1', { bar: 3, baz: 4 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ foo: 1, bar: 3, baz: 4 });
  });
  it('undo 恢复原始 data', () => {
    const node = makeNode('n1', 0, 0, { foo: 1, bar: 2 });
    const cmd = new UpdateNodeDataCommand('n1', { bar: 3, baz: 4 });
    const after = cmd.execute(makeGraph([node]), ctx);
    const restored = cmd.undo(after, ctx);
    expect(restored.nodes[0]!.data).toEqual({ foo: 1, bar: 2 });
  });
  it('节点不存在时 execute 不变', () => {
    const cmd = new UpdateNodeDataCommand('missing', { foo: 1 });
    const result = cmd.execute(makeGraph([makeNode('other')]), ctx);
    expect(result.nodes).toHaveLength(1);
  });
  it('data 为非对象时替换为 patch', () => {
    const node = makeNode('n1', 0, 0, 'primitive' as unknown as Record<string, unknown>);
    const cmd = new UpdateNodeDataCommand('n1', { foo: 1 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ foo: 1 });
  });
  it('data 为 null 时替换为 patch', () => {
    const node = makeNode('n1', 0, 0, null as unknown as Record<string, unknown>);
    const cmd = new UpdateNodeDataCommand('n1', { foo: 1 });
    const result = cmd.execute(makeGraph([node]), ctx);
    expect(result.nodes[0]!.data).toEqual({ foo: 1 });
  });
});
