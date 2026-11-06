/**
 * 内置命令
 * Phase 2 将完整实现具体逻辑
 */

import type { Command, CommandContext } from './command-queue.js';
import type { NodeRecord, EdgeRecord, GraphModel } from '../model/types.js';

/** BatchCommand 内子命令上下文(空实现: 批量执行不冒泡事件避免风暴) */
const batchCtx: CommandContext = { eventBus: { emit: () => {} } as never };

export class AddNodeCommand implements Command {
  id = 'add-node';
  constructor(private node: NodeRecord) {}
  execute(state: GraphModel): GraphModel {
    // 防止重复添加相同 ID 的节点（避免 React duplicate key 错误）
    if (state.nodes.some((n) => n.id === this.node.id)) {
      return state;
    }
    return { ...state, nodes: [...state.nodes, this.node] };
  }
  undo(state: GraphModel): GraphModel {
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.node.id) };
  }
}

export class RemoveNodeCommand implements Command {
  id = 'remove-node';
  constructor(private nodeId: string) {}
  execute(state: GraphModel): GraphModel {
    // 墓碑机制：map 标记 _deleted 而非 filter 移除，undo 可翻转标记「复活」节点
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, _deleted: true, deletedAt: Date.now() } : n,
      ),
    };
  }
  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, _deleted: false, deletedAt: undefined } : n,
      ),
    };
  }
}

export class MoveNodeCommand implements Command {
  id = 'move-node';
  constructor(private nodeId: string, private delta: { x: number; y: number }) {}
  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, position: { x: n.position.x + this.delta.x, y: n.position.y + this.delta.y } } : n,
      ),
    };
  }
  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId ? { ...n, position: { x: n.position.x - this.delta.x, y: n.position.y - this.delta.y } } : n,
      ),
    };
  }
}

export class AddEdgeCommand implements Command {
  id = 'add-edge';
  constructor(private edge: EdgeRecord) {}
  execute(state: GraphModel): GraphModel {
    if (state.edges.some((e) => e.id === this.edge.id)) {
      return state;
    }
    return { ...state, edges: [...state.edges, this.edge] };
  }
  undo(state: GraphModel): GraphModel {
    return { ...state, edges: state.edges.filter((e) => e.id !== this.edge.id) };
  }
}

export class RemoveEdgeCommand implements Command {
  id = 'remove-edge';
  private removed?: EdgeRecord;
  constructor(private edgeId: string) {}
  execute(state: GraphModel): GraphModel {
    this.removed = state.edges.find((e) => e.id === this.edgeId);
    return { ...state, edges: state.edges.filter((e) => e.id !== this.edgeId) };
  }
  undo(state: GraphModel): GraphModel {
    if (this.removed) {
      return { ...state, edges: [...state.edges, this.removed] };
    }
    return state;
  }
}

export class UpdateNodeDataCommand implements Command {
  id = 'update-node-data';
  constructor(
    private nodeId: string,
    private patch: Record<string, unknown>,
    private prev?: Record<string, unknown>,
  ) {}
  execute(state: GraphModel): GraphModel {
    // 自动捕获 prev 供 undo 恢复（无论构造时是否传入 prev）
    const target = state.nodes.find((n) => n.id === this.nodeId);
    if (target && this.prev === undefined) {
      this.prev = { ...(target.data as Record<string, unknown>) };
    }
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        if (n.id !== this.nodeId) return n;
        // data 非对象(null/undefined/primitive)时直接替换为 patch，避免 spread 原始值
        const base = typeof n.data === 'object' && n.data !== null ? (n.data as Record<string, unknown>) : {};
        return { ...n, data: { ...base, ...this.patch } };
      }),
    };
  }
  undo(state: GraphModel): GraphModel {
    if (this.prev) {
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === this.nodeId ? { ...n, data: this.prev } : n)),
      };
    }
    // 没有 prev 作为 fallback: 移除 patch 键
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? {
              ...n,
              data: Object.fromEntries(Object.entries(n.data as Record<string, unknown>).filter(([k]) => !this.patch[k])),
            }
          : n,
      ),
    };
  }
}

// 入口移除(防 plugin 宿主复用 node 时重复添加)
export class RemoveEntryNodeCommand implements Command {
  id = 'remove-entry-node';
  private removed?: NodeRecord;
  constructor(private newNode: NodeRecord) {}
  execute(state: GraphModel): GraphModel {
    this.removed = state.nodes.find((n) => n.id === this.newNode.id);
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.newNode.id) };
  }
  undo(state: GraphModel): GraphModel {
    if (this.removed) {
      return { ...state, nodes: [...state.nodes, this.removed] };
    }
    return state;
  }
}

// ===== Plan#80 墓碑构建前已存在的 sibling 命令（从原 builtins.ts 剥离还原） =====

/** 重命名 UpdateNodeDataCommand(title patch) 的语法糖 */
export class UpdateNodeTitleCommand implements Command {
  id = 'update-node-title';
  private inner: UpdateNodeDataCommand;
  constructor(nodeId: string, title: string) {
    this.inner = new UpdateNodeDataCommand(nodeId, { title });
  }
  execute(state: GraphModel): GraphModel {
    return this.inner.execute(state);
  }
  undo(state: GraphModel): GraphModel {
    return this.inner.undo(state);
  }
}

/** 批量命令容器: 顺序执行 + 逆序撤销(不合并 label, 纯 executor) */
export class BatchCommand implements Command {
  id: string;
  constructor(private commands: Command[], label = 'batch') {
    this.id = label;
  }
  execute(state: GraphModel): GraphModel {
    return this.commands.reduce((s, cmd) => cmd.execute(s, batchCtx), state);
  }
  undo(state: GraphModel): GraphModel {
    return [...this.commands].reduceRight((s, cmd) => cmd.undo(s, batchCtx), state);
  }
}

/** 节点多选位置批量移动(画布拖拽多选场景) */
export class MoveNodesCommand implements Command {
  id = 'move-nodes';
  private startsMap: Map<string, { x: number; y: number }>;
  private endsMap: Map<string, { x: number; y: number }>;
  constructor(
    starts: Map<string, { x: number; y: number }> | Record<string, { x: number; y: number }>,
    ends: Map<string, { x: number; y: number }> | Record<string, { x: number; y: number }>,
  ) {
    this.startsMap = starts instanceof Map ? starts : new Map(Object.entries(starts));
    this.endsMap = ends instanceof Map ? ends : new Map(Object.entries(ends));
  }
  execute(state: GraphModel): GraphModel {
    const ends = this.endsMap;
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        const end = ends.get(n.id);
        if (!end) return n;
        return { ...n, position: { x: end.x, y: end.y } };
      }),
    };
  }
  undo(state: GraphModel): GraphModel {
    const starts = this.startsMap;
    return {
      ...state,
      nodes: state.nodes.map((n) => {
        const start = starts.get(n.id);
        if (!start) return n;
        return { ...n, position: { x: start.x, y: start.y } };
      }),
    };
  }
}

/** 节点尺寸/位置矩形调整(重建/整理/resize handle) */
export class ResizeNodeCommand implements Command {
  id = 'resize-node';
  constructor(
    public readonly nodeId: string,
    public readonly oldRect: { x: number; y: number; width: number; height: number },
    public readonly newRect: { x: number; y: number; width: number; height: number },
  ) {}
  execute(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? {
              ...n,
              position: { x: this.newRect.x, y: this.newRect.y },
              // 2026-11-04 修复:必须同步写 node.size —— 渲染层 resolveNodeSize 优先读
              // node.size,此前只写 data.width/height 导致拖角 resize 视觉完全无效
              size: { width: this.newRect.width, height: this.newRect.height },
              data: { ...(n.data as Record<string, unknown>), width: this.newRect.width, height: this.newRect.height },
            }
          : n,
      ),
    };
  }
  undo(state: GraphModel): GraphModel {
    return {
      ...state,
      nodes: state.nodes.map((n) =>
        n.id === this.nodeId
          ? {
              ...n,
              position: { x: this.oldRect.x, y: this.oldRect.y },
              size: { width: this.oldRect.width, height: this.oldRect.height },
              data: { ...(n.data as Record<string, unknown>), width: this.oldRect.width, height: this.oldRect.height },
            }
          : n,
      ),
    };
  }
}

/** 节点复制(生成副本 + 偏移位置防完全重叠) */
export class DuplicateNodeCommand implements Command {
  id = 'duplicate-node';
  private createdId?: string;
  constructor(private nodeId: string) {}
  execute(state: GraphModel): GraphModel {
    const src = state.nodes.find((n) => n.id === this.nodeId);
    if (!src) return state;
    this.createdId = `${src.id}-copy-${Date.now().toString(36)}`;
    const dup: NodeRecord = {
      ...src,
      id: this.createdId,
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      data: { ...(src.data as Record<string, unknown>) },
    };
    return { ...state, nodes: [...state.nodes, dup] };
  }
  undo(state: GraphModel): GraphModel {
    if (!this.createdId) return state;
    return { ...state, nodes: state.nodes.filter((n) => n.id !== this.createdId) };
  }
}
