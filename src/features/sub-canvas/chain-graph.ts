/**
 * 生成链路的节点集合：产物节点 + 它全部上游输入节点（递归）。
 *
 * 为什么不能只靠 generation.sourceNodeId：早期落库没有记录来源节点，
 * 只按记录拼链路会得到「一张结果图、零条边」，用户看不到参考图来自哪里。
 * 这里直接在主画布图上按入边回溯，保证「参考图 → 提示词 → 产物」整条链都在场。
 */
import type { GraphModel } from '@zeroexo/core';

export function collectUpstreamChainIds(
  graph: Pick<GraphModel, 'nodes' | 'edges'>,
  seedIds: readonly string[],
  limit = 40,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...seedIds];
  while (queue.length > 0 && out.length < limit) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const edges = (graph.edges ?? []) as Array<{ source: { nodeId: string }; target: { nodeId: string } }>;
    for (const e of edges) {
      if (e.target?.nodeId === id && e.source?.nodeId && !seen.has(e.source.nodeId)) {
        queue.push(e.source.nodeId);
      }
    }
  }
  return out;
}
