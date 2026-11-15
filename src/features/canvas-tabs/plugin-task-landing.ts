/**
 * 插件产物 → 项目落库（网页侧）。
 *
 * 插件只持有 output/zeroexo 下的成品/引导；网页重开或段完成时把成品下载回项目：
 * CAS 文件 + 资产记录（originSource=director, originNodeId=shotId）+ 版本。
 */
import { autoLandGenerationBlob } from '@/features/canvas-assets/history-autoland.js';
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

  const landed = await autoLandGenerationBlob({
    projectId: args.projectId,
    nodeId: args.shotId,
    kind: 'video',
    title: args.title,
    blob,
    prompt: args.segment.prompt,
    params: args.segment.params,
    originSource: 'director',
    ...(guide ? { guide } : {}),
  });
  if (!landed) return null;
  return { storageKey: landed.storageKey, ...(landed.guide ? { guide: landed.guide } : {}) };
}
