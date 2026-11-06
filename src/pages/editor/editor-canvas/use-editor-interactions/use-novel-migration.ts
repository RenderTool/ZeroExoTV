/**
 * useNovelMigration - 长文本(novel)存量数据迁移（Plan#74 Phase D）
 *
 * 2026-09-06 长文本从"自动落资产库(assetId → asset.data.content)"改为
 * "工作区资源式(storageKey → text: 本地资源)"。存量画布中已存在的 novel 节点仍持
 * assetId 且正文在资产库。本钩子在 editor ready 后执行一次，将这类节点正文搬进
 * 本地 text: 资源并改写节点 data(置 storageKey、清 assetId)。
 *
 * 幂等：
 * - 主守卫：仅迁移 assetId 存在且 storageKey 非 text: 前缀的 novel 节点；迁移后清
 *   assetId → 二次扫描自动跳过。
 * - 会话级守卫：模块级 Set<canvasId> 记录已跑完的画布，避免 effect 依赖变化重复执行。
 * 迁移只复制内容，不删除资产库资产，无数据丢失。
 */

import { useRef } from 'react';
import { UpdateNodeDataCommand } from '@zeroexo/core';
import { uploadTextResource } from '@zeroexo/plugin-persistence';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import type { EditorRefs } from '../use-editor-state.js';

/** 会话级已迁移画布集合（防重复执行） */
const migratedCanvases = new Set<string>();

/** 判断是否为 text: 工作区资源 key（本套正文本地资源前缀） */
function isTextResource(storageKey: unknown): boolean {
  return typeof storageKey === 'string' && storageKey.startsWith('text:');
}

/**
 * 扫描并迁移存量 novel 节点。由 use-editor-interactions 主 effect 在 editor ready 后调用。
 * @param refs editor 引用（提供 store / commandQueue）
 * @param canvasId 用于会话级幂等守卫的画布标识
 */
export function runNovelMigration(refs: EditorRefs, canvasId: string): void {
  const store = refs.store;
  const q = refs.commandQueue;
  if (!store || !q) return;
  if (migratedCanvases.has(canvasId)) return;
  migratedCanvases.add(canvasId);

  const graph = store.getGraph();
  const targets = graph.nodes.filter((n) => n.type === 'novel');
  if (targets.length === 0) return;

  void (async () => {
    try {
      const assets = await listAssets();
      for (const node of targets) {
        const data = (node.data ?? {}) as { assetId?: unknown; storageKey?: unknown };
        // 已迁移(storageKey 为 text: 或无 assetId)跳过
        if (!data.assetId || isTextResource(data.storageKey)) continue;
        const contentCandidate = assets.find((a) => a.id === data.assetId);
        const content = ((contentCandidate?.data as { content?: unknown } | undefined)?.content as string | undefined) ?? '';
        if (content) {
          const { storageKey } = await uploadTextResource(content);
          q.execute(new UpdateNodeDataCommand(node.id, {
            storageKey,
            wordCount: content.length,
            assetId: undefined,
          }));
        } else {
          // 资产已删除/无正文 → 退化空壳，重新导入
          q.execute(new UpdateNodeDataCommand(node.id, { assetId: undefined }));
        }
      }
    } catch (err) {
      console.error('[novel] 存量长文本迁移失败:', err);
    }
  })();
}

/** 返回迁移钩子（供 use-editor-interactions 使用；内部包装 runNovelMigration） */
export function useNovelMigration(refs: EditorRefs, canvasId: string | undefined) {
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const run = () => {
    if (!canvasId) return;
    runNovelMigration(refsRef.current, canvasId);
  };
  return run;
}