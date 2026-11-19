/**
 * 插件产物 → 项目落库（网页侧）。
 *
 * 插件只持有 output/zeroexo 下的成品/引导；网页重开或段完成时把成品下载回项目：
 * CAS 文件 + 资产记录（originSource=director, originNodeId=shotId）+ 版本。
 *
 * 2026-11-19 用户报障「分镜生成的视频仍没有正确的链路子画布」：
 * 这里原来只传 prompt/params、从不传 chain，资产记录里没有 generation.chain，
 * 历史视图就只能按「产物单节点」打开（还得回退到 live 画布，节点一删就彻底空链）。
 * 插件任务只回传 ComfyUI input 里的参考图文件名，拿不到 CAS 键，所以链要在落库时
 * 从导演台片段的 references 现场重建：参考槽位（storageKey）+ 产物节点，不合成连线。
 */
import { IMAGE_FIT_BOX, fitMediaSize } from '@zeroexo/plugin-nodes';
import { autoLandGenerationBlob } from '@/features/canvas-assets/history-autoland.js';
import type { GenerationChain, GenerationChainInput, GenerationChainNode } from '@/features/sub-canvas/generation-chain.js';
import { readWorkbenchContainer } from '@/entities/slot-containers.js';
import type { GuideMeta } from '@/features/asset-picker/index.js';
import type { PluginTaskSegment } from '@/features/task-center/plugin-task-client.js';

/** ComfyUI 输出绝对路径 → /view URL（type=output） */
export function pluginViewUrl(base: string, absPath: string): string | null {
  const clean = String(absPath || '').replace(/\\/g, '/');
  if (!clean) return null;
  const marker = '/output/';
  const idx = clean.lastIndexOf(marker);
  if (idx < 0) return null;
  const rel = clean.slice(idx + marker.length);
  const slash = rel.lastIndexOf('/');
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const subfolder = slash >= 0 ? rel.slice(0, slash) : '';
  const root = base.replace(/\/+$/, '');
  return `${root}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`;
}

export interface LandedSegment {
  storageKey: string;
  guide?: GuideMeta;
}

/** 片段引用槽位（只取落库需要的字段，不引 UI 类型） */
interface ShotRefLike {
  id?: string;
  title?: string;
  storageKey?: string;
  kind?: string;
  slotNo?: number;
}

/**
 * 按导演台片段重建本次生成链：参考槽位 → 产物。
 * 没有可读 reference（@ 引用都来自主体/素材库）时也要给出产物节点，
 * 让历史至少能打开「产物 + 当时的提示词与参数」，不再退化成 live 画布回退。
 */
export function buildDirectorChain(args: {
  shotId: string;
  title: string;
  refs: ShotRefLike[];
  prompt?: string;
  params?: Record<string, unknown>;
  model?: string;
}): GenerationChain {
  const nodes: GenerationChainNode[] = [];
  const inputs: GenerationChainInput[] = [];
  let slot = 0;
  for (const ref of args.refs) {
    const key = typeof ref.storageKey === 'string' ? ref.storageKey : '';
    if (!key) continue;
    slot += 1;
    const id = `chain_input_${slot}`;
    nodes.push({
      id,
      type: ref.kind === 'video' ? 'video' : 'image',
      title: ref.title || `参考图${slot}`,
      position: { x: 60, y: 60 + (slot - 1) * 380 },
      size: { ...IMAGE_FIT_BOX },
      data: {
        kind: ref.kind === 'video' ? 'video' : 'image',
        storageKey: key,
        status: 'success',
        __readonly: true,
      },
    });
    inputs.push({ slot, nodeId: id, storageKey: key });
  }
  nodes.push({
    id: args.shotId,
    type: 'video',
    title: args.title,
    position: { x: 760, y: 60 },
    size: fitMediaSize(16 * 86, 9 * 86, IMAGE_FIT_BOX),
    data: { kind: 'video', storageKey: '', status: 'success', prompt: args.prompt ?? '' },
  });
  return {
    nodes,
    edges: [],
    ...(inputs.length ? { inputs } : {}),
    prompt: args.prompt,
    ...(args.model ? { model: args.model } : {}),
    params: args.params,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 段完成落库：按 output.storageKey 幂等由 autoLand 的 CAS 去重保证。
 * 不在这里改 shot.cache/media；宿主通过 onSegmentDone 合并版本并落盘。
 */
export async function landPluginSegment(args: {
  base: string;
  projectId: string;
  shotId: string;
  segment: PluginTaskSegment;
  title: string;
}): Promise<LandedSegment | null> {
  const out = (args.segment.outputs ?? []).find((o) => o.kind === 'video') ?? args.segment.outputs?.[0];
  if (!out?.path) return null;
  const url = pluginViewUrl(args.base, out.path);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载插件成品失败 HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.size) return null;

  const guide: GuideMeta | undefined = args.segment.guide?.id
    ? {
        id: args.segment.guide.id,
        ...(args.segment.guide.path ? { path: args.segment.guide.path } : {}),
        ...(args.segment.guide.frames ? { frames: args.segment.guide.frames } : {}),
      }
    : undefined;

  // 片段引用 + 提示词都取自导演台容器：插件回传的 params 里只有参考图文件名，没有 CAS 键。
  const shot = await readWorkbenchContainer(args.projectId)
    .then((c) => (c?.shots ?? []).find((s) => String((s as { id?: string }).id) === args.shotId))
    .catch(() => undefined);
  const refs = ((shot as { references?: ShotRefLike[] } | undefined)?.references ?? []) as ShotRefLike[];
  const shotPrompt = String(
    (shot as { imagePrompt?: string; videoPrompt?: string } | undefined)?.imagePrompt
      ?? (shot as { videoPrompt?: string } | undefined)?.videoPrompt
      ?? '',
  ).trim();
  const prompt = (args.segment.prompt ?? '').trim() || shotPrompt;
  const segParams = (args.segment.params ?? {}) as Record<string, unknown>;
  const model = typeof segParams.model === 'string' ? (segParams.model as string) : undefined;
  const chain = buildDirectorChain({
    shotId: args.shotId,
    title: args.title,
    refs,
    prompt,
    params: segParams,
    model,
  });

  const landed = await autoLandGenerationBlob({
    projectId: args.projectId,
    nodeId: args.shotId,
    kind: 'video',
    title: args.title,
    blob,
    prompt,
    params: segParams,
    model,
    chain,
    originSource: 'director',
    ...(guide ? { guide } : {}),
  });
  if (!landed) return null;
  return { storageKey: landed.storageKey, ...(landed.guide ? { guide: landed.guide } : {}) };
}
