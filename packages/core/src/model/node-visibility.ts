/**
 * 节点可见性统一判定（2026-11-04 幽灵节点治理）
 *
 * 背景：墓碑节点(_deleted=true)曾被各渲染方各自过滤，口径不一导致
 * 空间索引/框选/吸附/LOD 色块层遗漏过滤，产生"幽灵节点"（不可见但可被
 * 框选、吸附、点中）。本模块是唯一判定入口，所有读取 graph.nodes 的
 * 渲染方/交互方/计数方必须经此过滤，禁止各处各写一套。
 *
 * 语义决策：
 * - tombstone / invalid → 不可见（墓碑已删除；无 id 无法渲染）
 * - unknown-type / empty-data → **仍可见**，由渲染层降级为占位卡
 *   （可选中、可删除）。若直接判不可见，孤儿节点会从画布/层级/框选
 *   同时消失且无法再删除，变成更深的幽灵。
 */
import type { NodeRecord } from './types.js';

/** 节点可见性五态分类 */
export type NodeVisibility =
  | 'visible'       // 正常渲染
  | 'unknown-type'  // 类型未注册 → 渲染"未知节点"占位（可选中/可删除）
  | 'empty-data'    // data 损坏（非对象） → 渲染占位（可选中/可删除）
  | 'tombstone'     // _deleted=true 墓碑 → 不可见、不参与任何计算
  | 'invalid';      // 无合法 id → 不可见

export interface NodeVisibilityOptions {
  /** 类型注册表查询（可选）。提供时未注册类型归为 unknown-type。 */
  isTypeRegistered?: (type: string) => boolean;
}

/** 分类节点可见性（五态）。 */
export function classifyNode(
  node: NodeRecord,
  opts?: NodeVisibilityOptions,
): NodeVisibility {
  if (!node || typeof node.id !== 'string' || node.id.length === 0) return 'invalid';
  if (node._deleted === true) return 'tombstone';
  if (opts?.isTypeRegistered && !opts.isTypeRegistered(node.type)) return 'unknown-type';
  // data 缺失(undefined)是合法的（类型定义 data? 可选）；仅当存在但损坏
  // （null / 非对象）时判 empty-data。
  const data = node.data;
  if (data !== undefined && (data === null || typeof data !== 'object')) return 'empty-data';
  return 'visible';
}

/**
 * 统一可见性判定：墓碑与无效 id 不可见；孤儿/空数据保持可见（占位渲染）。
 * 所有渲染方/交互方/计数方的唯一入口。
 */
export function isVisibleNode(node: NodeRecord, opts?: NodeVisibilityOptions): boolean {
  const v = classifyNode(node, opts);
  return v === 'visible' || v === 'unknown-type' || v === 'empty-data';
}

/** filter(isVisibleNode) 的便捷形式，供各渲染方直接替换分散过滤。 */
export function filterVisibleNodes<T extends NodeRecord>(
  nodes: readonly T[],
  opts?: NodeVisibilityOptions,
): T[] {
  return nodes.filter((n) => isVisibleNode(n, opts));
}
