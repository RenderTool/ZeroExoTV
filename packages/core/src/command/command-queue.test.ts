import { describe, it, expect, vi } from 'vitest';
import { CommandQueue } from './command-queue.js';
import type { Command } from './command-queue.js';
import { EventBus } from '../bus/event-bus.js';
import { CommandEvents } from '../bus/events.js';
import type { GraphModel } from '../model/types.js';

function makeGraph(): GraphModel {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

/** 自增命令: execute +1, undo -1 */
function makeIncCommand(): Command {
  return {
    id: 'inc',
    execute: (s) => ({ ...s, metadata: { count: (s.metadata.count as number ?? 0) + 1 } }),
    undo: (s) => ({ ...s, metadata: { count: (s.metadata.count as number ?? 0) - 1 } }),
  };
}

describe('CommandQueue', () => {
  describe('execute', () => {
    it('执行命令并更新 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      expect(cq.getState().metadata.count).toBe(1);
    });

    it('执行后 future 清空', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      cq.undo();
      expect(cq.canRedo()).toBe(true);
      cq.execute(makeIncCommand());
      expect(cq.canRedo()).toBe(false);
    });

    it('发布 command:executed 事件', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const handler = vi.fn();
      bus.on(CommandEvents.EXECUTED, handler);
      cq.execute(makeIncCommand());
      expect(handler).toHaveBeenCalledWith(
        { commandId: 'inc' },
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });
  });

  describe('undo / redo', () => {
    it('undo 回滚 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      cq.undo();
      expect(cq.getState().metadata.count).toBe(0);
    });

    it('redo 重做 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      cq.undo();
      cq.redo();
      expect(cq.getState().metadata.count).toBe(1);
    });

    it('undo 发布 command:undone 事件', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const handler = vi.fn();
      bus.on(CommandEvents.UNDONE, handler);
      cq.execute(makeIncCommand());
      cq.undo();
      expect(handler).toHaveBeenCalledWith({ commandId: 'inc' }, expect.any(Object));
    });

    it('redo 发布 command:redone 事件', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const handler = vi.fn();
      bus.on(CommandEvents.REDONE, handler);
      cq.execute(makeIncCommand());
      cq.undo();
      cq.redo();
      expect(handler).toHaveBeenCalledWith({ commandId: 'inc' }, expect.any(Object));
    });

    it('空栈 undo 不报错且不变更 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const before = cq.getState();
      expect(() => cq.undo()).not.toThrow();
      expect(cq.getState()).toBe(before);
    });

    it('空 future redo 不报错且不变更 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const before = cq.getState();
      expect(() => cq.redo()).not.toThrow();
      expect(cq.getState()).toBe(before);
    });
  });

  describe('canUndo / canRedo', () => {
    it('初始状态都为 false', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      expect(cq.canUndo()).toBe(false);
      expect(cq.canRedo()).toBe(false);
    });

    it('execute 后 canUndo=true', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      expect(cq.canUndo()).toBe(true);
    });

    it('undo 后 canRedo=true', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.execute(makeIncCommand());
      cq.undo();
      expect(cq.canRedo()).toBe(true);
    });
  });

  describe('capacity', () => {
    it('超过容量时丢弃最旧命令', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus, 2);
      cq.execute(makeIncCommand());
      cq.execute(makeIncCommand());
      cq.execute(makeIncCommand());
      // 容量 2,只能 undo 2 次
      expect(cq.getState().metadata.count).toBe(3);
      cq.undo();
      expect(cq.getState().metadata.count).toBe(2);
      cq.undo();
      expect(cq.getState().metadata.count).toBe(1);
      // 第 3 次 undo 应无效(已被丢弃)
      cq.undo();
      expect(cq.getState().metadata.count).toBe(1);
    });
  });

  describe('mergeStrategy', () => {
    it('合并策略返回新命令时替换栈顶', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const merge = vi.fn((_prev: Command, next: Command) => next);
      cq.setMergeStrategy(merge);
      cq.execute(makeIncCommand());
      cq.execute(makeIncCommand());
      expect(merge).toHaveBeenCalledTimes(1);
      // 合并后栈深度仍为 1
      cq.undo();
      expect(cq.canUndo()).toBe(false);
    });

    it('合并策略返回 null 时不合并', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      cq.setMergeStrategy(() => null);
      cq.execute(makeIncCommand());
      cq.execute(makeIncCommand());
      // 不合并,栈深度为 2
      cq.undo();
      expect(cq.canUndo()).toBe(true);
      cq.undo();
      expect(cq.canUndo()).toBe(false);
    });

    it('合并命令发布 executed 事件携带合并后命令 id', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      const handler = vi.fn();
      bus.on(CommandEvents.EXECUTED, handler);
      cq.setMergeStrategy((_prev, next) => next);
      cq.execute(makeIncCommand());
      cq.execute(makeIncCommand());
      // 第二次 execute 触发合并,事件应被发布
      expect(handler).toHaveBeenLastCalledWith({ commandId: 'inc' }, expect.any(Object));
    });
  });

  describe('getState', () => {
    it('返回当前状态', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(makeGraph(), bus);
      expect(cq.getState().metadata).toEqual({});
    });
  });

  describe('purgeTombstones (Plan#80 Phase C)', () => {
    function makeNode(id: string, type = 'script', opts: { _deleted?: boolean } = {}): any {
      return { id, type, position: { x: 0, y: 0 }, data: {}, ...opts };
    }
    function makeEdge(sourceId: string, targetId: string): any {
      return { id: `${sourceId}->${targetId}`, source: { nodeId: sourceId }, target: { nodeId: targetId } };
    }

    it('TC-C1: 无墓碑节点时返回空数组且不修改 state', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(
        { nodes: [makeNode('a'), makeNode('b')], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} },
        bus,
      );
      const removed = cq.purgeTombstones();
      expect(removed).toEqual([]);
      expect(cq.getState().nodes).toHaveLength(2);
    });

    it('TC-C2: 墓碑节点被清除 + 关联悬挂边也被清除', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(
        {
          nodes: [makeNode('a'), makeNode('b', 'script', { _deleted: true }), makeNode('c')],
          edges: [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('a', 'c')],
          viewport: { x: 0, y: 0, k: 1 },
          metadata: {},
        },
        bus,
      );
      const removed = cq.purgeTombstones();
      expect(removed).toHaveLength(1);
      expect(removed[0]!.id).toBe('b');
      expect(cq.getState().nodes).toHaveLength(2);
      // 涉及 b 的边被清除，a->c 保留
      expect(cq.getState().edges).toHaveLength(1);
      expect(cq.getState().edges[0]!.id).toBe('a->c');
    });

    it('TC-C3: purge 后发出 EXECUTED 事件携带 removedCount', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(
        {
          nodes: [makeNode('d1', 'script', { _deleted: true }), makeNode('d2', 'novel', { _deleted: true })],
          edges: [],
          viewport: { x: 0, y: 0, k: 1 },
          metadata: {},
        },
        bus,
      );
      const handler = vi.fn();
      bus.on(CommandEvents.EXECUTED, handler);
      const removed = cq.purgeTombstones();
      expect(removed).toHaveLength(2);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: 'purge-tombstones', removedCount: 2 }),
        expect.any(Object),
      );
    });

    it('TC-C4: 再次 purge 无副作用 + 节点彻底清除', () => {
      const bus = new EventBus();
      const cq = new CommandQueue(
        {
          nodes: [makeNode('x', 'script', { _deleted: true })],
          edges: [],
          viewport: { x: 0, y: 0, k: 1 },
          metadata: {},
        },
        bus,
      );
      cq.purgeTombstones();
      // 再次调用应无副作用
      const removed2 = cq.purgeTombstones();
      expect(removed2).toEqual([]);
      expect(cq.getState().nodes).toHaveLength(0);
    });
  });
});
