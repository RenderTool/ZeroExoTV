/**
 * MCP 图片作业消费者（2026-11-11）：
 * MCP 把「生成什么图」写到 <数据根>/.lf/zeroexo/app_meta/image-jobs/<jobId>.json；
 * 网页画布打开着同一项目时，本 hook 每 2 秒轮询，建图片节点 → 调本机/云端 ComfyUI 生成 →
 * 写回节点与历史 → 把进度写到 <jobId>.status.json 供 MCP 查询。
 *
 * 这样 MCP 触发的图会出现在**用户正在看的实时画布**上（主画布由浏览器持有，外部不直接写 JSON）。
 */
import { useEffect, useRef } from 'react';
import { AddNodeCommand, UpdateNodeDataCommand, type CommandQueue } from '@zeroexo/core';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { listDir, readJson, writeJson, removeFile } from '@/platform/fs.js';
import { autoLandGenerationBlob } from '@/features/canvas-assets/history-autoland.js';
import { generateMossImage } from '@/pages/editor/editor-canvas/interactions/local-moss-image.js';
import { generateKrea2Image } from '@/pages/editor/editor-canvas/interactions/local-krea2-image.js';
import { generateLocalQwenImage } from '@/pages/editor/editor-canvas/interactions/local-qwen-image.js';
import { MOSS_MODEL_KEY, KREA2_MODEL_KEY, LOCAL_IMAGE_MODEL_KEY } from '@/features/canvas-tabs/zeroexo-jobs-client.js';

export const MCP_IMAGE_JOB_DIR = '.lf/zeroexo/app_meta/image-jobs';

interface McpImageRequest {
  index?: number;
  prompt: string;
  model?: 'moss' | 'krea2' | 'qwen';
  title?: string;
  aspect?: string;
  megapixels?: number;
  steps?: number;
  seed?: number;
  width?: number;
  height?: number;
  negative_prompt?: string;
}

interface McpImageJob {
  schemaVersion?: number;
  jobId: string;
  projectId: string;
  requests: McpImageRequest[];
}

interface JobItemStatus {
  index: number;
  nodeId: string;
  state: 'pending' | 'running' | 'done' | 'error';
  model: string;
  prompt: string;
  storageKey?: string;
  width?: number;
  height?: number;
  error?: string;
}

interface JobStatus {
  jobId: string;
  projectId: string;
  state: 'running' | 'done' | 'error';
  total: number;
  completed: number;
  items: JobItemStatus[];
  updatedAt: string;
}

const MODEL_KEYS = { moss: MOSS_MODEL_KEY, krea2: KREA2_MODEL_KEY, qwen: LOCAL_IMAGE_MODEL_KEY } as const;

async function generateOne(req: McpImageRequest, nodeId: string): Promise<{
  blob: Blob; width: number; height: number; mimeType: string; bytes: number; generationId: string;
}> {
  const model = req.model ?? 'moss';
  const params = {
    prompt: req.prompt,
    negative_prompt: req.negative_prompt ?? '',
    steps: req.steps,
    seed: req.seed,
    megapixels: req.megapixels,
    width: req.width,
    height: req.height,
  };
  if (model === 'moss') {
    return generateMossImage({ prompt: req.prompt, aspect: req.aspect, params, nodeId });
  }
  if (model === 'krea2') {
    return generateKrea2Image({ prompt: req.prompt, aspect: req.aspect, params, nodeId });
  }
  return generateLocalQwenImage({
    prompt: req.prompt,
    width: req.width,
    height: req.height,
    params: { ...params, edit_mode: false },
    nodeId,
  });
}

export function useMcpImageJobs(opts: {
  projectId: string | null | undefined;
  commandQueue: CommandQueue | null | undefined;
  enabled?: boolean;
}): void {
  const { projectId, commandQueue, enabled = true } = opts;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled || !projectId || !commandQueue) return;
    const cq = commandQueue;
    let disposed = false;
    const timer = window.setInterval(() => { void tick(); }, 2000);
    void tick();

    async function tick(): Promise<void> {
      if (disposed || busyRef.current) return;
      busyRef.current = true;
      try {
        const entries = await listDir(MCP_IMAGE_JOB_DIR).catch(() => []);
        for (const entry of entries) {
          if (disposed) return;
          if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name.endsWith('.status.json')) continue;
          const rel = `${MCP_IMAGE_JOB_DIR}/${entry.name}`;
          const job = await readJson<McpImageJob>(rel).catch(() => null);
          if (!job?.jobId || job.projectId !== projectId || !Array.isArray(job.requests)) continue;
          await runJob(job, rel);
        }
      } finally {
        busyRef.current = false;
      }
    }

    async function runJob(job: McpImageJob, jobRel: string): Promise<void> {
      const statusRel = `${MCP_IMAGE_JOB_DIR}/${job.jobId}.status.json`;
      const status: JobStatus = {
        jobId: job.jobId,
        projectId: job.projectId,
        state: 'running',
        total: job.requests.length,
        completed: 0,
        items: job.requests.map((req, i) => ({
          index: i, nodeId: `mcp_${job.jobId}_${i}`, state: 'pending',
          model: req.model ?? 'moss', prompt: req.prompt,
        })),
        updatedAt: new Date().toISOString(),
      };
      await writeJson(statusRel, status).catch(() => undefined);

      for (let i = 0; i < job.requests.length; i += 1) {
        if (disposed) return;
        const req = job.requests[i]!;
        const item = status.items[i]!;
        const nodeId = item.nodeId;
        const modelKey = MODEL_KEYS[req.model ?? 'moss'];
        const col = i % 5;
        const row = Math.floor(i / 5);
        cq.execute(new AddNodeCommand({
          id: nodeId,
          type: 'image',
          position: { x: 120 + col * 300, y: 120 + row * 320 },
          size: { width: 300, height: 300 },
          title: req.title || `MCP 图片 ${i + 1}`,
          data: {
            content: '',
            status: 'loading',
            prompt: req.prompt,
            model: modelKey,
            paramValues: {
              aspect: req.aspect ?? '1:1',
              megapixels: req.megapixels ?? 1,
              steps: req.steps,
              seed: req.seed ?? -1,
              cfg: req.model === 'moss' ? 2.5 : undefined,
              negative_prompt: req.negative_prompt ?? '',
            },
          },
        } as never));
        item.state = 'running';
        await writeJson(statusRel, { ...status, updatedAt: new Date().toISOString() }).catch(() => undefined);
        try {
          const result = await generateOne(req, nodeId);
          const url = URL.createObjectURL(result.blob);
          const landed = await autoLandGenerationBlob({
            nodeId,
            kind: 'image',
            title: req.title || `MCP 图片 ${i + 1}`,
            blob: result.blob,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            mimeType: result.mimeType,
            jobId: result.generationId,
            model: modelKey,
            prompt: req.prompt,
          }).catch(() => null);
          cq.execute(new UpdateNodeDataCommand(nodeId, {
            content: url,
            status: 'success',
            naturalWidth: result.width,
            naturalHeight: result.height,
            mimeType: result.mimeType,
            bytes: result.bytes,
            generationId: result.generationId,
            model: modelKey,
            prompt: req.prompt,
            ...(landed?.storageKey ? { storageKey: landed.storageKey } : {}),
          } as Record<string, unknown>));
          item.state = 'done';
          item.storageKey = landed?.storageKey;
          item.width = result.width;
          item.height = result.height;
          status.completed += 1;
          nodeActionBus.emit('canvas:history:created', {
            kind: 'image',
            title: req.title || `MCP 图片 ${i + 1}`,
            generationId: result.generationId,
            prompt: req.prompt,
            nodeId,
          });
        } catch (err) {
          item.state = 'error';
          item.error = err instanceof Error ? err.message : String(err);
          cq.execute(new UpdateNodeDataCommand(nodeId, {
            status: 'error',
            errorDetails: item.error,
          } as Record<string, unknown>));
        }
        status.state = status.completed === status.total ? 'done' : 'running';
        status.updatedAt = new Date().toISOString();
        await writeJson(statusRel, status).catch(() => undefined);
      }
      status.state = status.items.every((it) => it.state === 'error') ? 'error' : 'done';
      status.updatedAt = new Date().toISOString();
      await writeJson(statusRel, status).catch(() => undefined);
      await removeFile(jobRel).catch(() => undefined);
    }

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, projectId, commandQueue]);
}
