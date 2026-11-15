/**
 * MCP 图片任务结果应用器（2026-11-15）。
 *
 * 生成在 MCP 完成（任务表持久化）；网页只订阅任务，把成功产物幂等地写成画布节点：
 * - 节点 id 由 MCP 给（`mcp_<taskId>_<i>`），同一任务在任何页面/刷新后都落到同一个节点；
 * - 节点已存在（已有 storageKey）就跳过 —— 多开不会重复建节点，用户删掉的不会被同一页面重建；
 * - 只应用最近 12 小时内的任务，避免重新打开旧项目时把历史产物全量灌进画布。
 */
import { useEffect } from 'react';
import { AddEdgeCommand, AddNodeCommand, UpdateNodeDataCommand, ResizeNodeCommand, type CommandQueue } from '@zeroexo/core';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { fitImageNodeSize } from '@/pages/editor/editor-canvas/use-editor-interactions/helpers.js';
import { resolveMediaUrl } from '@/platform/media.js';
import {
  KREA2_MODEL_KEY,
  LOCAL_IMAGE_MODEL_KEY,
  MOSS_MODEL_KEY,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import {
  subscribeBrokerTasks,
  type BrokerImageRequest,
  type BrokerSegment,
  type BrokerTask,
} from '@/features/task-center/task-broker-client.js';

/** 只回灌最近 12 小时内的任务（更早的产物已由历史抽屉管理，避免把旧图重新塞回画布） */
const APPLY_WINDOW_MS = 12 * 60 * 60 * 1000;

const MODEL_KEYS = { moss: MOSS_MODEL_KEY, krea2: KREA2_MODEL_KEY, qwen: LOCAL_IMAGE_MODEL_KEY } as const;

function requestOf(task: BrokerTask, segmentIndex: number): BrokerImageRequest | null {
  if (task.request?.kind !== 'canvas_image') return null;
  return task.request.requests[segmentIndex - 1] ?? null;
}

function nodeTitle(req: BrokerImageRequest | null, index: number): string {
  return req?.title?.trim()
    || (req?.sourceNodeId || req?.sourceStorageKey ? `MCP 改图 ${index}` : `MCP 图片 ${index}`);
}

export function useMcpImageJobs(opts: {
  projectId: string | null | undefined;
  commandQueue: CommandQueue | null | undefined;
  /** 画布 store：判断节点是否已落过（幂等） */
  store?: { getGraph(): { nodes: Array<{ id: string; data?: unknown }> } } | null;
  enabled?: boolean;
}): void {
  const { projectId, commandQueue, store, enabled = true } = opts;

  useEffect(() => {
    if (!enabled || !projectId || !commandQueue) return;
    const cq = commandQueue;
    const applying = new Set<string>();

    const hasApplied = (nodeId: string): boolean => {
      const nodes = store?.getGraph().nodes ?? [];
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return false;
      const data = (node.data ?? {}) as Record<string, unknown>;
      return typeof data.storageKey === 'string' && Boolean(data.storageKey);
    };

    const applySegment = async (task: BrokerTask, seg: BrokerSegment): Promise<void> => {
      const output = seg.output;
      if (!output) return;
      const nodeId = output.nodeId ?? `mcp_${task.taskId}_${seg.index - 1}`;
      if (hasApplied(nodeId)) return;
      const req = requestOf(task, seg.index);
      const modelKey = req?.model ? MODEL_KEYS[req.model] : MODEL_KEYS.moss;
      const isEdit = Boolean(req?.sourceNodeId || req?.sourceStorageKey);
      const title = nodeTitle(req, req ? seg.index : seg.index);
      const url = await resolveMediaUrl(output.storageKey).catch(() => '');
      if (!url) return;
      const col = (seg.index - 1) % 5;
      const row = Math.floor((seg.index - 1) / 5);
      const position = { x: 120 + col * 300, y: 120 + row * 320 };
      const width = output.width ?? 1024;
      const height = output.height ?? 1024;
      cq.execute(new AddNodeCommand({
        id: nodeId,
        type: 'image',
        position,
        size: { width: 300, height: 300 },
        title,
        data: {
          content: '',
          status: 'loading',
          prompt: req?.prompt ?? seg.prompt ?? '',
          model: isEdit ? LOCAL_IMAGE_MODEL_KEY : modelKey,
          paramValues: {
            aspect: req?.aspect ?? '1:1',
            megapixels: req?.megapixels ?? 4,
            ...(output.width && output.height ? { width: output.width, height: output.height, sizeMode: 'custom' } : {}),
            steps: req?.steps,
            seed: req?.seed ?? -1,
            cfg: req?.model === 'moss' ? 2.5 : undefined,
            negative_prompt: req?.negative_prompt ?? '',
          },
        },
      } as never));
      if (isEdit && req?.sourceNodeId) {
        cq.execute(new AddEdgeCommand({
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-mcp`,
          source: { nodeId: req.sourceNodeId, pinId: 'image' },
          target: { nodeId, pinId: 'prompt' },
        }));
      }
      cq.execute(new UpdateNodeDataCommand(nodeId, {
        content: url,
        status: 'success',
        naturalWidth: width,
        naturalHeight: height,
        mimeType: output.mime,
        storageKey: output.storageKey,
        generationId: task.taskId,
        model: isEdit ? LOCAL_IMAGE_MODEL_KEY : modelKey,
        prompt: req?.prompt ?? seg.prompt ?? '',
        ...(req?.sourceNodeId
          ? { generation: { prompt: req.prompt, model: isEdit ? LOCAL_IMAGE_MODEL_KEY : modelKey, sourceNodeId: req.sourceNodeId, sourceStorageKey: req.sourceStorageKey } }
          : {}),
      } as Record<string, unknown>));
      const fitted = fitImageNodeSize(300, width, height);
      cq.execute(new ResizeNodeCommand(nodeId, { ...position, width: 300, height: 300 }, { ...position, width: fitted.width, height: fitted.height }));
      nodeActionBus.emit('canvas:history:created', {
        kind: 'image',
        title,
        generationId: task.taskId,
        prompt: req?.prompt ?? seg.prompt ?? '',
        nodeId,
      });
    };

    const unsubscribe = subscribeBrokerTasks(projectId, (tasks) => {
      const now = Date.now();
      for (const task of tasks) {
        if (task.kind !== 'canvas_image') continue;
        const updated = Date.parse(task.updatedAt) || 0;
        if (updated && now - updated > APPLY_WINDOW_MS) continue;
        for (const seg of task.segments) {
          if (seg.state !== 'success' || !seg.output) continue;
          const key = `${task.taskId}:${seg.index}:${seg.output.storageKey}`;
          if (applying.has(key)) continue;
          applying.add(key);
          void applySegment(task, seg).catch(() => {
            applying.delete(key); // 失败允许下次快照重试
          });
        }
      }
    });

    return unsubscribe;
  }, [enabled, projectId, commandQueue, store]);
}
