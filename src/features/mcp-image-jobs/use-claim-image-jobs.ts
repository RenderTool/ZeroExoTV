/**
 * 认领台账结果应用器（2026-11-17）。
 *
 * 口径：生成在 ComfyUI 端跑，MCP 只代理发起 + 记认领台账 + 归档结果到 CAS。
 * 网页打开或刷新项目时读台账：
 *   - 已归档（status=landed 且有 result.storageKey）→ 按 claim.nodeId 建节点；
 *   - 图生图/参考生图 → 先保证上游参考图节点在画布上，再连 image → prompt 的边；
 *   - 只认最近 12 小时，避免重开旧项目把历史产物全量灌进画布；
 *   - 节点已存在（已落过 storageKey）就跳过，多开与刷新都不会重复建。
 */
import { useEffect } from 'react';
import { AddEdgeCommand, AddNodeCommand, UpdateNodeDataCommand, ResizeNodeCommand, type CommandQueue } from '@zeroexo/core';
import { fitImageNodeSize } from '@/pages/editor/editor-canvas/use-editor-interactions/helpers.js';
import { resolveMediaUrl } from '@/platform/media.js';
import { listDir, readFile } from '@/platform/fs.js';
import { autoLandGenerationBlob } from '@/features/canvas-assets/history-autoland.js';
import { buildGenerationChain } from '@/features/sub-canvas/generation-chain.js';
import {
  KREA2_MODEL_KEY,
  LOCAL_IMAGE_MODEL_KEY,
  MOSS_MODEL_KEY,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';

const CLAIM_DIR = '.lf/zeroexo/app_meta/claims';
const APPLY_WINDOW_MS = 12 * 60 * 60 * 1000;
const POLL_MS = 5_000;

const MODEL_KEYS = { moss: MOSS_MODEL_KEY, krea2: KREA2_MODEL_KEY, qwen: LOCAL_IMAGE_MODEL_KEY } as const;

interface ClaimRecord {
  claimId: string;
  jobId: string;
  projectId: string;
  kind: 'canvas_image' | 'subject_image' | 'canvas_video';
  nodeId: string;
  sourceNodeId?: string;
  sourceStorageKey?: string;
  prompt: string;
  model: 'qwen' | 'krea2' | 'moss';
  params: Record<string, unknown>;
  status: 'pending' | 'landed' | 'failed';
  result?: { storageKey: string; width?: number; height?: number; mimeType?: string };
  createdAt: string;
  updatedAt: string;
}

async function readClaims(projectId: string): Promise<ClaimRecord[]> {
  const entries = await listDir(CLAIM_DIR).catch(() => null);
  if (!entries) return [];
  const out: ClaimRecord[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const raw = await readFile(`${CLAIM_DIR}/${entry.name}`).catch(() => null);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as ClaimRecord;
      if (rec?.claimId && rec.projectId === projectId) out.push(rec);
    } catch {
      /* 单个坏文件跳过 */
    }
  }
  return out;
}

/** 从提示词里取一句「有意义」的中文短语（去掉 @引用 / 尖括号标签 / 技术尾串） */
function semanticName(prompt: string | undefined, fallback: string): string {
  const raw = (prompt ?? '').replace(/\r/g, '').replace(/<[^>]*>/g, ' ');
  const first = raw.split(/\n|。|！|；|;/)[0] ?? '';
  const cleaned = first
    .replace(/@\S+(\s*·\s*\S+)?/g, ' ')
    .replace(/[“”"'（）()【】\[\]]/g, ' ')
    .replace(/无字幕|无水印|无文字|8K|4K|超清|高清|竖版|横版|16:9|9:16|1:1/g, ' ')
    .replace(/[,，、:：]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 18 ? cleaned.slice(0, 18) : cleaned;
}

/** 简单时间戳：MM-DD HH:mm（资产/节点标题用，别塞 claimId 这种无意义尾号） */
function shortStamp(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

function nodeTitle(claim: ClaimRecord): string {
  const fallback = claim.kind === 'subject_image' ? '主体图片' : claim.sourceStorageKey ? '参考生图' : '图片';
  return `${semanticName(claim.prompt, fallback)} · ${shortStamp(claim.createdAt)}`;
}

export function useClaimImageJobs(opts: {
  projectId: string | null | undefined;
  commandQueue: CommandQueue | null | undefined;
  store?: { getGraph(): { nodes: Array<{ id: string; position?: { x: number; y: number }; size?: { width?: number; height?: number }; data?: unknown }> } } | null;
  enabled?: boolean;
}): void {
  const { projectId, commandQueue, store, enabled = true } = opts;

  useEffect(() => {
    if (!enabled || !projectId || !commandQueue) return;
    const cq = commandQueue;
    const applying = new Set<string>();
    let disposed = false;

    const hasNode = (nodeId: string): boolean => (store?.getGraph().nodes ?? []).some((n) => n.id === nodeId);
    const hasMedia = (nodeId: string): boolean => {
      const node = (store?.getGraph().nodes ?? []).find((n) => n.id === nodeId);
      const data = (node?.data ?? {}) as Record<string, unknown>;
      return typeof data.storageKey === 'string' && Boolean(data.storageKey);
    };

    const ensureSourceNode = async (claim: ClaimRecord): Promise<string | null> => {
      if (claim.sourceNodeId && hasNode(claim.sourceNodeId)) return claim.sourceNodeId;
      if (!claim.sourceStorageKey) return null;
      const refId = `mcp_ref_${claim.claimId}`;
      if (!hasNode(refId) || !hasMedia(refId)) {
        const url = await resolveMediaUrl(claim.sourceStorageKey).catch(() => '');
        if (!url) return null;
        const position = { x: 120 + 0, y: 60 };
        if (!hasNode(refId)) {
          cq.execute(new AddNodeCommand({
            id: refId,
            type: 'image',
            position,
            size: { width: 300, height: 300 },
            title: '参考图',
            data: { kind: 'image', content: url, status: 'success', storageKey: claim.sourceStorageKey, mimeType: 'image/png' },
          } as never));
        } else {
          cq.execute(new UpdateNodeDataCommand(refId, { content: url, status: 'success', storageKey: claim.sourceStorageKey }));
        }
      }
      return refId;
    };

    const applyClaim = async (claim: ClaimRecord): Promise<void> => {
      const result = claim.result;
      if (!result?.storageKey) return;
      if (hasMedia(claim.nodeId)) return;
      const url = await resolveMediaUrl(result.storageKey).catch(() => '');
      if (!url) return;

      const modelKey = MODEL_KEYS[claim.model] ?? MODEL_KEYS.moss;
      const params = claim.params ?? {};
      const width = result.width ?? Number(params.width) ?? 1024;
      const height = result.height ?? Number(params.height) ?? 1024;
      const fitted0 = fitImageNodeSize(300, width, height);

      // 参考节点先建好，产物节点再按「源节点下游 + 竖向顺排」定位；
      // 原来写死 {x:480,y:60}，落点会压在已有节点上，用户看到就是「节点自己固定到某个地方」。
      const sourceId = await ensureSourceNode(claim);
      const nodesNow = (store?.getGraph().nodes ?? []) as Array<{ id: string; position?: { x: number; y: number }; size?: { width?: number; height?: number }; _deleted?: boolean }>;
      const src = sourceId ? nodesNow.find((n) => n.id === sourceId) : undefined;
      let position = {
        x: src?.position ? src.position.x + (src.size?.width ?? 300) + 48 : 480,
        y: src?.position?.y ?? 60,
      };
      const occupied = nodesNow.filter((n) => n.id !== claim.nodeId && !n._deleted && n.position).map((n) => ({
        x: n.position!.x, y: n.position!.y, width: n.size?.width ?? 300, height: n.size?.height ?? 200,
      }));
      const collides = (x: number, y: number): boolean => occupied.some((o) =>
        x < o.x + o.width + 24 && x + fitted0.width + 24 > o.x
        && y < o.y + o.height + 24 && y + fitted0.height + 24 > o.y);
      for (let i = 0; i < 12 && collides(position.x, position.y); i += 1) {
        position = { x: position.x, y: position.y + fitted0.height + 48 };
      }

      if (!hasNode(claim.nodeId)) {
        cq.execute(new AddNodeCommand({
          id: claim.nodeId,
          type: 'image',
          position,
          size: { width: fitted0.width, height: fitted0.height },
          title: nodeTitle(claim),
          data: {
            content: '',
            status: 'loading',
            prompt: claim.prompt,
            model: modelKey,
            paramValues: {
              aspect: params.aspect ?? '1:1',
              megapixels: params.megapixels ?? 4,
              width,
              height,
              sizeMode: 'custom',
              steps: params.steps,
              seed: params.seed ?? -1,
              negative_prompt: params.negative_prompt ?? '',
            },
          },
        } as never));
      }

      if (sourceId) {
        cq.execute(new AddEdgeCommand({
          id: `edge-${claim.claimId}-mcp`,
          source: { nodeId: sourceId, pinId: 'image' },
          target: { nodeId: claim.nodeId, pinId: 'prompt' },
        }));
      }

      // 生成引用链：链既写节点，也写进资产记录（「查看提示词」读的是资产记录里的链，
      // 只写节点就会表现为「MCP 生成的图没有上游参考图节点」，2026-11-18 用户报障）。
      const chainForRecord = (() => {
        // 以当前画布真实图为准序列化：上游参考图（含本地生成的图）连同连线一起入链，
        // 不再只记录 claim.sourceStorageKey（那种记录会丢上游，历史视图只剩产物）。
        const live = store?.getGraph() as unknown as {
          nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>>;
        } | undefined;
        const built = live?.nodes?.length
          ? buildGenerationChain(live, claim.nodeId, { prompt: claim.prompt, model: modelKey, params })
          : null;
        if (built && built.nodes.length > 1) {
          return {
            ...built,
            nodes: built.nodes.map((n) => (
              n.id === claim.nodeId ? { ...n, data: { ...n.data, storageKey: result.storageKey } } : n
            )),
          };
        }
        return {
          nodes: [
            ...(sourceId ? [{ id: sourceId, type: 'image', title: '参考图', data: { storageKey: claim.sourceStorageKey } }] : []),
            { id: claim.nodeId, type: 'image', title: nodeTitle(claim), data: { storageKey: result.storageKey, prompt: claim.prompt, params } },
          ],
          edges: sourceId ? [{ source: { nodeId: sourceId }, target: { nodeId: claim.nodeId } }] : [],
          // inputs 必须留：它让历史视图在没有连线时也能按 storageKey 补出参考图节点
          inputs: claim.sourceStorageKey
            ? [{ slot: 1, nodeId: sourceId ?? undefined, storageKey: claim.sourceStorageKey }]
            : [],
          prompt: claim.prompt,
          model: modelKey,
          params,
          createdAt: new Date().toISOString(),
        };
      })();

      cq.execute(new UpdateNodeDataCommand(claim.nodeId, {
        content: url,
        status: 'success',
        naturalWidth: width,
        naturalHeight: height,
        mimeType: result.mimeType ?? 'image/png',
        storageKey: result.storageKey,
        generationId: claim.claimId,
        model: modelKey,
        prompt: claim.prompt,
        generation: {
          prompt: claim.prompt,
          model: modelKey,
          sourceNodeId: sourceId ?? undefined,
          sourceStorageKey: claim.sourceStorageKey,
          params,
          chain: chainForRecord,
        },
      } as Record<string, unknown>));

      const fitted = fitImageNodeSize(300, width, height);
      cq.execute(new ResizeNodeCommand(claim.nodeId, { ...position, width: fitted0.width, height: fitted0.height }, { ...position, width: fitted.width, height: fitted.height }));

      // 历史自动落库：按 CAS 内容建/复用资产记录（origin='generation' + originNodeId + generation），
      // 卡片上的「查看提示词」才有数据可读。
      try {
        const blob = await fetch(url).then((r) => r.blob());
        if (blob.size) {
          await autoLandGenerationBlob({
            nodeId: claim.nodeId,
            kind: 'image',
            title: nodeTitle(claim),
            blob,
            width,
            height,
            mimeType: result.mimeType ?? 'image/png',
            jobId: claim.claimId,
            provider: 'mcp-proxy',
            model: claim.model,
            prompt: claim.prompt,
            params,
            sourceNodeId: sourceId ?? undefined,
            sourceStorageKey: claim.sourceStorageKey,
            projectId,
            originSource: 'canvas',
            chain: chainForRecord,
          });
        }
      } catch (err) {
        console.warn('[claim-image-jobs] 历史落库失败:', err);
      }
    };

    const sweep = async (): Promise<void> => {
      if (disposed) return;
      const claims = await readClaims(projectId);
      const now = Date.now();
      for (const claim of claims) {
        if (claim.status !== 'landed' || !claim.result?.storageKey) continue;
        const updated = Date.parse(claim.updatedAt) || 0;
        if (updated && now - updated > APPLY_WINDOW_MS) continue;
        if (applying.has(claim.claimId)) continue;
        applying.add(claim.claimId);
        void applyClaim(claim).catch(() => applying.delete(claim.claimId));
      }
    };

    void sweep();
    const timer = window.setInterval(() => void sweep(), POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, projectId, commandQueue, store]);
}
