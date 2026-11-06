/**
 * subject-tree-diff - 主体树双份数据（Task 2）对比与幂等工具
 *
 * 双份数据设计（约定）：
 * - A 份（AI 幂等关联表）：key = rootId + state + type。AI 在上一轮占位生成时已建立强关联
 *   （该主体及状态 → 连入出片的链路）。重跑应幂等：同名同类型状态不重复建。
 * - B 份（用户当前主体树）：用户可改名 / 增删状态 / 改类型。用户的改动会破坏 A/B 的幂等对应关系。
 *
 * Diff 语义：以 A 份为「上一轮 AI 已拍板」基线，B 份为用户当前。二者错位即标记 broken，
 * 供「出片连入时做 3 层比较」（Task 3）与「下次询问 Agent 时校验」使用。
 */

import type { SubjectTree, SubjectTreeNode, SubjectNodeMedia } from './subject-tree-types';

/** 幂等键：rootId + state + type（注入 type 避免同名不同媒体类型误判幂等） */
export function subjectNodeStableKey(rootId: string, state: string, type: SubjectNodeMedia): string {
  return `${rootId}::${state.trim()}::${type}`;
}

/** 幂等键 → 关联项（A 份 AI 关联表条目） */
export interface SubjectAiIndexEntry {
  key: string;
  rootId: string;
  state: string;
  type: SubjectNodeMedia;
  /** AI 已建立的强关联（出片目标，用于连入时配对旧出片资产） */
  linkedTarget?: string;
  fullPrompt: string;
}

/** 从主体树 A/B 两份生成当前 AI 关联表 */
export function buildAiIndex(trees: SubjectTree[]): SubjectAiIndexEntry[] {
  const out: SubjectAiIndexEntry[] = [];
  for (const tree of trees) {
    for (const node of tree.states) {
      out.push({
        key: node.aiStableKey ?? subjectNodeStableKey(tree.rootId, node.state, node.type),
        rootId: tree.rootId,
        state: node.state,
        type: node.type,
        linkedTarget: node.linked?.detail,
        fullPrompt: node.fullPrompt,
      });
    }
  }
  return out;
}

/** 单个节点与 AI 索引的整体 diff 结果分类 */
export type NodeDiffKind = 'unchanged' | 'renamed' | 'typeChanged' | 'added' | 'removed' | 'promptChanged';

export interface NodeDiffLine {
  kind: NodeDiffKind;
  /** 幂等键（changed/added/removed 共用，按此对齐） */
  key: string;
  state: string;
  type: SubjectNodeMedia;
  /** 旧值（AI 份） */
  old?: Partial<{ state: string; type: SubjectNodeMedia; fullPrompt: string }>;
  /** 新值（用户份） */
  next?: Partial<{ state: string; type: SubjectNodeMedia; fullPrompt: string }>;
  /** AI 曾建立的目标（出片旧资产提示） */
  linkedTarget?: string;
}

/**
 * 三层比较（核心约定）：
 * 1) 以 A 份旧树（上一轮 AI 关联）为基线
 * 2) 以 B 份新树（用户当前）为当前
 * 3) 逐节点对齐，产出 NodeDiffLine[]：
 *    - 同 state+type → unchanged；prompt 变化 → promptChanged
 *    - 同 state 但 type 变 → typeChanged
 *    - state 名变（用旧索引定位不到）→ renamed / removed + added
 *    - 用户新增 → added；用户删除 → removed
 */
export function diffSubjectTree(
  oldTrees: SubjectTree[] | undefined,
  newTrees: SubjectTree[] | undefined,
): NodeDiffLine[] {
  const oldEntries = new Map<string, SubjectTreeNode & { kind: string; rootId: string }>();
  for (const tree of oldTrees ?? []) {
    for (const node of tree.states) {
      const key = subjectNodeStableKey(tree.rootId, node.state, node.type);
      oldEntries.set(key, { ...node, kind: tree.kind, rootId: tree.rootId });
    }
  }

  const newEntries = new Map<string, SubjectTreeNode>();
  for (const tree of newTrees ?? []) {
    for (const node of tree.states) {
      const key = subjectNodeStableKey(tree.rootId, node.state, node.type);
      newEntries.set(key, node);
    }
  }

  const lines: NodeDiffLine[] = [];
  const oldKeys = new Set(oldEntries.keys());
  const newKeys = new Set(newEntries.keys());

  // 处理共同键：unchanged / promptChanged / typeChanged / renamed
  for (const key of oldKeys) {
    const oldNode = oldEntries.get(key)!;
    if (newKeys.has(key)) {
      const newNode = newEntries.get(key)!;
      const typeChanged = oldNode.type !== newNode.type;
      const promptChanged = (oldNode.fullPrompt ?? '') !== (newNode.fullPrompt ?? '');
      const stateChanged = oldNode.state.trim() !== newNode.state.trim();
      if (stateChanged && !typeChanged) {
        // 仅改名（state 变）但 type 未变：视为 renamed（重建 key 再比提示词）
        const renamedKey = subjectNodeStableKey(oldNode.rootId, newNode.state, newNode.type);
        lines.push({
          kind: 'renamed', key: renamedKey, state: newNode.state, type: newNode.type,
          old: { state: oldNode.state, fullPrompt: oldNode.fullPrompt },
          next: { state: newNode.state, fullPrompt: newNode.fullPrompt },
          linkedTarget: oldNode.linked?.detail,
        });
      } else if (typeChanged) {
        lines.push({
          kind: 'typeChanged', key, state: newNode.state, type: newNode.type,
          old: { type: oldNode.type, fullPrompt: oldNode.fullPrompt },
          next: { type: newNode.type, fullPrompt: newNode.fullPrompt },
          linkedTarget: oldNode.linked?.detail,
        });
      } else if (promptChanged) {
        lines.push({
          kind: 'promptChanged', key, state: newNode.state, type: newNode.type,
          old: { fullPrompt: oldNode.fullPrompt },
          next: { fullPrompt: newNode.fullPrompt },
          linkedTarget: oldNode.linked?.detail,
        });
      } else {
        lines.push({
          kind: 'unchanged', key, state: newNode.state, type: newNode.type,
          linkedTarget: oldNode.linked?.detail,
        });
      }
    } else {
      // 旧有但新无：removed（用户删除；或改名的旧键，由 added 承接）
      lines.push({
        kind: 'removed', key, state: oldNode.state, type: oldNode.type,
        old: { state: oldNode.state, type: oldNode.type, fullPrompt: oldNode.fullPrompt },
        linkedTarget: oldNode.linked?.detail,
      });
    }
  }

  for (const key of newKeys) {
    if (oldKeys.has(key)) continue;
    const node = newEntries.get(key)!;
    lines.push({
      kind: 'added', key, state: node.state, type: node.type,
      next: { state: node.state, type: node.type, fullPrompt: node.fullPrompt },
    });
  }

  return lines;
}

/** 是否有实际差异（忽略 unchanged） */
export function hasRealDiff(lines: NodeDiffLine[]): boolean {
  return lines.some((l) => l.kind !== 'unchanged');
}

/**
 * Task2：为所有状态节点注入稳定幂等键（rootId::state::type）。
 * 返回浅克隆后的树（不改原对象），缺键的 AI/用户节点补全。
 * 用于 A 份快照建立 & 保证 diff 可对齐。
 */
export function ensureStableKeys(trees: SubjectTree[]): SubjectTree[] {
  return trees.map((tree) => {
    const states = tree.states.map((node) => (node.aiStableKey
      ? node
      : { ...node, aiStableKey: subjectNodeStableKey(tree.rootId, node.state, node.type) }));
    return { ...tree, states };
  });
}

/** 深拷贝主体树数组（供 A 份快照与 B 份彻底解耦，避免引用共享） */
export function cloneTrees(trees: SubjectTree[]): SubjectTree[] {
  return trees.map((tree) => ({
    ...tree,
    aliases: [...(tree.aliases ?? [])],
    coverKey: tree.coverKey ?? null,
    deletedStates: tree.deletedStates ? [...tree.deletedStates] : undefined,
    states: tree.states.map((node) => ({
      ...node,
      recognitionTerms: [...(node.recognitionTerms ?? [])],
      media: (node.media ?? []).map((m) => ({ ...m })),
      aiStableKey: node.aiStableKey,
      linked: node.linked ? { ...node.linked } : undefined,
    })),
  }));
}