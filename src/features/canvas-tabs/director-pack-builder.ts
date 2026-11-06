/**
 * director-pack-builder — 导演台面板数据 → MiniMaxH3 导演包 zip（pack.json + timeline.json + 槽位媒体）
 *
 * 结构双源验证：
 * - timeline/pack.json 骨架：zx_e2e.py build_timeline()/build_pack()（已实测跑通：3 段、56 帧/段、段间引导）；
 * - 媒体文件布局与 refs 形态：scripts/tools/h3pack/export_h3_pack.py（与上游节点源码 round-trip 验证）——
 *   公共槽位文件 shared_params/Picture{N}.{ext}，段槽位文件 asset_groups/{NN}/Picture{S}.{ext}，
 *   refs[] = {index, imageFile/audioFile/videoFile, fileName, type:'input', subfolder}。
 * - taskType 精确串：上游 combo 全集未导出（参考工作流只存当前值），t2v/r2v 为实测值，
 *   其余 4 项按同一命名模式推断（提交被拒时 400 会透传上游错误，用户可在参数区改任务类型）。
 *
 * 帧数学（17k+5）与宽高（比例×系数 32 对齐）全部复用 entities/director-params 的唯一实现，
 * 本模块不重算。媒体读取经 MediaResolver 注入（默认走 platform/media + subject 封面回落链）。
 */

import JSZip from 'jszip';
import {
  DIRECTOR_PRESETS,
  assignAssetSlots,
  durationToFrames,
  segmentContinuityEnabled,
  type DirectorAssetRef,
  type DirectorModelTier,
  type RunShotLike,
  type SharedParamsLike,
  type SubjectCoverOf,
} from '@/entities/director-params.js';
import { getMediaBlob } from '@/platform/media.js';
import type { BridgeRunOverrides } from './comfyui-bridge-client.js';

export const PACK_FORMAT = 'minimax-h3-director-pack';
export const PACK_FORMAT_VERSION = 1;

/**
 * taskType 精确串映射（面板 value → 上游 combo 精确串）：
 * - t2v / r2v：实测值（zx_e2e.py 跑通串 / 参考工作流 global.taskType）；
 * - 其余：按 `<code> — <中文>(<English>)` 模式推断（未实测，标注 verified:false）。
 */
export const TASK_TYPE_PRECISE: Record<string, { value: string; verified: boolean }> = {
  t2v: { value: 't2v — 文生视频(Text to Video)', verified: true },
  r2v: { value: 'r2v — 参考主体生视频(Reference to Video)', verified: true },
  i2v: { value: 'i2v — 图生视频(Image to Video)', verified: false },
  fl2v: { value: 'fl2v — 首尾帧生视频(First-Last to Video)', verified: false },
  v2v: { value: 'v2v — 视频生视频(Video to Video)', verified: false },
  rv2v: { value: 'rv2v — 参考视频生视频(Reference Video to Video)', verified: false },
};

/** 短码（面板 params.task_type 的值）→ 精确串；未知值回落 t2v */
export function preciseTaskType(shortCode: unknown): string {
  const key = typeof shortCode === 'string' && shortCode in TASK_TYPE_PRECISE ? shortCode : 't2v';
  return TASK_TYPE_PRECISE[key]!.value;
}

// ===== timeline 类型（对齐上游节点 timeline_data 键集的运行子集） =====

export interface TimelineRefEntry {
  index: number;
  imageFile?: string;
  audioFile?: string;
  videoFile?: string;
  fileName: string;
  type: 'input';
  subfolder: string;
}

export interface DirectorTimelineSegment {
  id: string;
  start: number;
  length: number;
  frameCount: number;
  durationSec: number;
  prompt: string;
  negativePrompt: string;
  taskType: string;
  refs: TimelineRefEntry[];
  refAudios: TimelineRefEntry[];
  refVideos: TimelineRefEntry[];
  genImage: { imageFile: string; fileName?: string };
  startImage: null;
  endImage: null;
  useGlobal: boolean;
  continuityFromPrev: boolean;
  refImageSize: string;
  loras: unknown[];
}

export interface DirectorTimeline {
  totalFrames: number;
  frameRate: number;
  width: number;
  height: number;
  segments: DirectorTimelineSegment[];
  global: {
    taskType: string;
    prompt: string;
    refs: TimelineRefEntry[];
    refAudios: TimelineRefEntry[];
    refVideos: TimelineRefEntry[];
    commonEnabled: boolean;
    continuousReference: boolean;
  };
  output: {
    mode: 'fixed';
    exportMode: 'segments';
    liveTaePreview: true;
    audioMode: 'generate';
    refImageSize: string;
    continuityEnabled: boolean;
    continuityMode: string;
    continuityOverlapFrames: number;
    continuityRedraw: number;
    continuityKeepTail: boolean;
    width: number;
    height: number;
    frameRate: number;
  };
}

// ===== 媒体解析（注入点；默认实现走磁盘 storageKey / dataUrl / 主体封面回落） =====

export interface ResolvedRefMedia {
  blob: Blob;
  /** 不带点的扩展名（zip 内文件名用；小写） */
  ext: string;
}

export type RefMediaResolver = (ref: DirectorAssetRef) => Promise<ResolvedRefMedia | null>;

function extFromKeyOrUrl(key: string | undefined, mime: string, kind: DirectorAssetRef['kind']): string {
  const fromKey = key?.includes('.') ? key.split('.').pop()!.toLowerCase() : '';
  if (fromKey && /^[a-z0-9]{2,5}$/.test(fromKey)) return fromKey;
  const sub = (mime.split('/')[1] ?? '').toLowerCase();
  if (sub) return sub;
  return kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3';
}

/** 默认媒体解析：storageKey（磁盘）→ dataUrl → http(s) url；`subject:<id>` 由 subjectCoverOf 先行解析 */
export function createDefaultRefMediaResolver(subjectCoverOf?: SubjectCoverOf): RefMediaResolver {
  return async (ref) => {
    let storageKey = ref.storageKey;
    const subjectId = ref.id.startsWith('subject:') && !ref.id.slice(8).includes(':') ? ref.id.slice(8) : null;
    if (subjectId) storageKey = subjectCoverOf?.(subjectId) ?? undefined;
    if (storageKey) {
      const blob = await getMediaBlob(storageKey);
      if (blob) return { blob, ext: extFromKeyOrUrl(storageKey, blob.type, ref.kind) };
    }
    const url = ref.url;
    if (url?.startsWith('data:')) {
      const blob = await (await fetch(url)).blob();
      return { blob, ext: extFromKeyOrUrl(undefined, blob.type, ref.kind) };
    }
    if (url && /^https?:\/\//.test(url) && !url.includes(location?.host ?? '\u0000')) {
      // 纯外链（罕见）：拉一次转存进包
      const blob = await (await fetch(url)).blob();
      return { blob, ext: extFromKeyOrUrl(undefined, blob.type, ref.kind) };
    }
    return null;
  };
}

// ===== 组装 =====

export interface BuildPackArgs {
  shots: RunShotLike[];
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  selectedIds: string[];
  /** 视频输出尺寸（resolveVideoSize 产物，32 对齐后写入 timeline.output） */
  width: number;
  height: number;
  /** 主体封面解析（无图主体 → 该槽缺媒体，记 warning） */
  subjectCoverOf?: SubjectCoverOf;
  /** 媒体解析注入（测试用内存实现） */
  resolveMedia?: RefMediaResolver;
}

export interface BuiltDirectorPack {
  zip: Blob;
  timeline: DirectorTimeline;
  /** 选中段顺序（zip/上游 segment 1 基 index ↔ 该数组的 0 基下标） */
  segmentShotIds: string[];
  totalFrames: number;
  /** 无法解析媒体的引用（不阻塞提交；上游 /pack 的 missing 会再兜一道） */
  warnings: string[];
}

export async function buildDirectorPack(args: BuildPackArgs): Promise<BuiltDirectorPack> {
  const resolveMedia = args.resolveMedia ?? createDefaultRefMediaResolver(args.subjectCoverOf);
  const sharedAssets = args.shared.enabled ? args.shared.assets : [];
  const selected = args.shots.filter((s) => args.selectedIds.includes(s.id));
  const warnings: string[] = [];
  const zip = new JSZip();

  // ---- 公共槽位媒体（shared_params/）----
  const sharedSlots = assignAssetSlots({ shared: sharedAssets, segment: [], tier: args.tier });
  const globalRefEntries: TimelineRefEntry[] = [];
  const globalAudioEntries: TimelineRefEntry[] = [];
  const globalVideoEntries: TimelineRefEntry[] = [];
  for (const entry of sharedSlots.entries) {
    const ref = sharedAssets.find((a) => a.id === entry.assetId);
    if (!ref) continue;
    const media = await resolveMedia(ref).catch(() => null);
    const prefix = entry.kind === 'image' ? 'Picture' : entry.kind === 'audio' ? 'Audio' : 'Video';
    const subfolder = 'shared_params';
    if (!media) {
      warnings.push(`公共素材『${ref.title ?? ref.id}』（${entry.label}）无法读取媒体文件，槽位为空`);
      continue;
    }
    const fileName = `${prefix}${entry.slot}.${media.ext}`;
    zip.file(`${subfolder}/${fileName}`, media.blob);
    const base: TimelineRefEntry = {
      index: entry.slot - 1,
      fileName: ref.title ?? fileName,
      type: 'input',
      subfolder,
    };
    if (entry.kind === 'image') globalRefEntries.push({ ...base, imageFile: `${subfolder}/${fileName}` });
    else if (entry.kind === 'audio') globalAudioEntries.push({ ...base, audioFile: `${subfolder}/${fileName}` });
    else globalVideoEntries.push({ ...base, videoFile: `${subfolder}/${fileName}` });
  }

  // ---- 段（asset_groups/NN/）----
  const overlapRaw = Number(args.shared.params['continuityOverlapFrames'] ?? 22);
  const overlap = Number.isFinite(overlapRaw) ? overlapRaw : 22;
  const globalContinuity = args.shared.params['continuityEnabled'] === true;
  const frameRate = 24; // DIRECTOR_FPS（节点内部恒 24，frame_rate 仅 UI 展示）
  const segments: DirectorTimelineSegment[] = [];
  const segmentShotIds: string[] = [];
  let start = 0;
  for (let i = 0; i < selected.length; i++) {
    const shot = selected[i]!;
    const nn = String(i + 1).padStart(2, '0');
    const subfolder = `asset_groups/${nn}`;
    const segSlots = assignAssetSlots({ shared: sharedAssets, segment: shot.references ?? [], tier: args.tier });
    const segRefs: TimelineRefEntry[] = [];
    const segAudios: TimelineRefEntry[] = [];
    const segVideos: TimelineRefEntry[] = [];
    for (const entry of segSlots.entries) {
      if (entry.scope !== 'segment') continue; // 公共已在 shared_params 落位
      const ref = (shot.references ?? []).find((r) => r.id === entry.assetId);
      if (!ref) continue;
      const media = await resolveMedia(ref).catch(() => null);
      const prefix = entry.kind === 'image' ? 'Picture' : entry.kind === 'audio' ? 'Audio' : 'Video';
      if (!media) {
        warnings.push(`片段 ${shot.number} 素材『${ref.title ?? ref.id}』（${entry.label}）无法读取媒体文件，槽位为空`);
        continue;
      }
      const fileName = `${prefix}${entry.slot}.${media.ext}`;
      zip.file(`${subfolder}/${fileName}`, media.blob);
      const base: TimelineRefEntry = {
        index: entry.slot - 1,
        fileName: ref.title ?? fileName,
        type: 'input',
        subfolder,
      };
      if (entry.kind === 'image') segRefs.push({ ...base, imageFile: `${subfolder}/${fileName}` });
      else if (entry.kind === 'audio') segAudios.push({ ...base, audioFile: `${subfolder}/${fileName}` });
      else segVideos.push({ ...base, videoFile: `${subfolder}/${fileName}` });
    }

    const idx = args.shots.findIndex((s) => s.id === shot.id);
    const cont = globalContinuity && segmentContinuityEnabled(shot, idx);
    const frameCount = durationToFrames(shot.duration);
    const fullPrompt = (shot.imagePrompt ?? '').trim();
    segments.push({
      id: `seg_${nn}`,
      start,
      length: frameCount,
      frameCount,
      durationSec: Math.round((frameCount / frameRate) * 10000) / 10000,
      prompt: fullPrompt,
      negativePrompt: '',
      taskType: '',
      refs: segRefs,
      refAudios: segAudios,
      refVideos: segVideos,
      genImage: { imageFile: '' },
      startImage: null,
      endImage: null,
      useGlobal: false,
      continuityFromPrev: cont,
      refImageSize: 'match',
      loras: [],
    });
    segmentShotIds.push(shot.id);
    start += frameCount;
  }

  const totalFrames = segments.reduce((sum, s) => sum + s.frameCount, 0);
  const taskType = preciseTaskType(args.shared.params['task_type']);
  const output: DirectorTimeline['output'] = {
    mode: 'fixed',
    exportMode: 'segments',
    liveTaePreview: true,
    audioMode: 'generate',
    refImageSize: 'match',
    continuityEnabled: globalContinuity,
    continuityMode: 'guide',
    continuityOverlapFrames: overlap,
    continuityRedraw: 0.1,
    continuityKeepTail: true,
    width: args.width,
    height: args.height,
    frameRate,
  };

  const timeline: DirectorTimeline = {
    totalFrames,
    frameRate,
    width: args.width,
    height: args.height,
    segments,
    global: {
      taskType,
      // 公共提示词层已下线（2026-11-05）：上游格式键保留但恒为空串，不再拼接公共提示词
      prompt: '',
      refs: globalRefEntries,
      refAudios: globalAudioEntries,
      refVideos: globalVideoEntries,
      commonEnabled: args.shared.enabled,
      continuousReference: false,
    },
    output,
  };

  const widgets = {
    steps: Number(args.shared.params['steps'] ?? DIRECTOR_PRESETS[args.tier].params['steps'] ?? 25),
    sampler: String(args.shared.params['sampler'] ?? 'res_multistep'),
    scheduler: String(args.shared.params['scheduler'] ?? 'simple'),
    cfg: Number(args.shared.params['cfg'] ?? 1),
    shift_video: Number(args.shared.params['shift_video'] ?? 12),
    shift_audio: Number(args.shared.params['shift_audio'] ?? 3),
    seed: Number(args.shared.params['seed'] ?? 0),
    task_type: taskType,
  };

  zip.file('pack.json', JSON.stringify({
    format: PACK_FORMAT,
    formatVersion: PACK_FORMAT_VERSION,
    taskType,
    widgets,
    output,
  }));
  zip.file('timeline.json', JSON.stringify(timeline));

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return { zip: zipBlob, timeline, segmentShotIds, totalFrames, warnings };
}

// ===== /run overrides =====

export function buildRunOverrides(args: {
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  width: number;
  height: number;
  totalFrames: number;
  /** 续跑：仅采样这些 0 基段索引（契约 §5；缺省 = 全部） */
  runSelection?: number[];
}): BridgeRunOverrides {
  const p = args.shared.params;
  const d = DIRECTOR_PRESETS[args.tier].params;
  const frameRate = Number(p['frame_rate'] ?? d['frame_rate'] ?? 24) || 24;
  const overrides: BridgeRunOverrides = {
    taskType: preciseTaskType(p['task_type']),
    steps: Number(p['steps'] ?? d['steps'] ?? 25),
    seed: Number(p['seed'] ?? d['seed'] ?? 0),
    cfg: Number(p['cfg'] ?? d['cfg'] ?? 1),
    width: args.width,
    height: args.height,
    totalFrames: args.totalFrames,
    frameRate,
    sampler: String(p['sampler'] ?? d['sampler'] ?? 'res_multistep'),
    scheduler: String(p['scheduler'] ?? d['scheduler'] ?? 'simple'),
  };
  if (args.runSelection) overrides.runSelection = args.runSelection;
  return overrides;
}
