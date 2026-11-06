/**
 * director-protocol-map — OpenAI 兼容协议的【唯一参数映射表】
 *
 * 「配置一下 ComfyUI 接口（标准 OpenAI 协议）就可以连上配套工作流开始生产视频/图片」——
 * 本模块是导演台 H3 工作流参数 ⇄ OpenAI 协议请求体的唯一一份定义：
 * - 前端（渠道面板展示、模型回显）与桥接（openai-protocol-client 发请求）都从这里取，
 *   【禁止在任何其他文件出现第二份字段映射】；
 * - 直连 ComfyUI 桥接（/zeroexo/h3/*）不经过本表（那是 zip 包契约，见 director-pack-builder）。
 *
 * 协议约定（OpenAI 官方形状 + zeroexo_h3 工作流扩展字段）：
 * - GET    {base}/v1/models                     → { data: [{ id }] }
 * - POST   {base}/v1/videos                     → { id, status }（Sora 形状）
 * - GET    {base}/v1/videos/{id}                → { id, status, progress, error, zeroexo_h3? }
 * - DELETE {base}/v1/videos/{id}                → 取消
 * - GET    {base}/v1/videos/{id}/content        → 视频二进制（mp4）
 * - POST   {base}/v1/images/generations         → { data: [{ url? | b64_json? }] }
 * 鉴权统一 `Authorization: Bearer <apiKey>`；扩展对象统一挂在请求体根字段 `zeroexo_h3`。
 */

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
import { createDefaultRefMediaResolver, preciseTaskType, type RefMediaResolver } from './director-pack-builder.js';
import type { BridgeJobSegment, BridgeJobStatus } from './comfyui-bridge-client.js';

// ===== 协议路由（唯一一份；openai-protocol-client 按此拼接，禁止散落字符串） =====

export const PROTOCOL_ROUTES = {
  models: '/v1/models',
  imageGenerations: '/v1/images/generations',
  videoCreate: '/v1/videos',
  /** 含 {id} 占位：videoStatus / videoCancel / videoContent 按 jobId 替换 */
  videoStatus: '/v1/videos/{id}',
  videoCancel: '/v1/videos/{id}',
  videoContent: '/v1/videos/{id}/content',
} as const;

export function protocolRoute(route: string, jobId?: string): string {
  return jobId === undefined ? route : route.replace('{id}', encodeURIComponent(jobId));
}

// ===== 参数映射表（导演台参数 → 协议请求字段；唯一一份，UI 与客户端共用） =====

/**
 * H3 导演工作流参数 → OpenAI 协议字段映射：
 * | 导演台参数                     | 视频路请求字段                            | 图片路请求字段            |
 * |------------------------------|------------------------------------------|--------------------------|
 * | 提示词（公共 prompt+段 imagePrompt） | prompt                                   | prompt                   |
 * | 资产引用·公共槽位               | zeroexo_h3.refs[]                        | zeroexo_h3.refs[]        |
 * | 资产引用·段内槽位               | zeroexo_h3.timeline[].refs[]             | —（单图无时间线）          |
 * | 比例 params.aspect            | size（resolveVideoSize 合成宽×高）        | size                     |
 * | 系数 params.scale_factor       | size（与比例合成，同上）                   | size（同上）              |
 * | 帧数（段时长→durationToFrames）| zeroexo_h3.timeline[].frames + seconds    | —                        |
 * | seed params.seed              | zeroexo_h3.seed                          | zeroexo_h3.seed          |
 * | steps params.steps            | zeroexo_h3.steps                         | zeroexo_h3.steps         |
 * | 段间引导开关 continuityEnabled | zeroexo_h3.continuity_enabled            | —                        |
 * | 时间线（选中段顺序）            | zeroexo_h3.timeline[]                     | —                        |
 * 帧数学与宽高（比例×系数 32 对齐）复用 entities/director-params 唯一实现，本模块不重算。
 */
export const DIRECTOR_PARAM_TO_PROTOCOL: ReadonlyArray<{
  director: string;
  video: string;
  image: string;
}> = [
  { director: 'prompt（公共 + 段 imagePrompt）', video: 'prompt', image: 'prompt' },
  { director: 'refs（公共槽位素材）', video: 'zeroexo_h3.refs[]', image: 'zeroexo_h3.refs[]' },
  { director: 'refs（段内槽位素材）', video: 'zeroexo_h3.timeline[].refs[]', image: '—' },
  { director: 'aspect（比例）', video: 'size（宽×高）', image: 'size' },
  { director: 'scale_factor（系数）', video: 'size（宽×高）', image: 'size' },
  { director: 'frames（段时长→帧数）', video: 'zeroexo_h3.timeline[].frames / seconds', image: '—' },
  { director: 'seed', video: 'zeroexo_h3.seed', image: 'zeroexo_h3.seed' },
  { director: 'steps', video: 'zeroexo_h3.steps', image: 'zeroexo_h3.steps' },
  { director: 'continuity_enabled（段间引导开关）', video: 'zeroexo_h3.continuity_enabled', image: '—' },
  { director: 'timeline（选中段顺序）', video: 'zeroexo_h3.timeline[]', image: '—' },
];

// ===== 请求体类型 =====

/** 资产引用：槽位号 + 类型 + media（dataURL 或 http(s) url，由桥接端转交给工作流槽位） */
export interface ProtocolMediaRef {
  slot: number;
  kind: 'image' | 'audio' | 'video';
  media: string;
}

export interface ProtocolSegment {
  index: number;
  prompt: string;
  frames: number;
  taskType: string;
  /** 段间引导开关（沿用上游 semantics：与直接前段衔接） */
  continuityFromPrev: boolean;
  refs: ProtocolMediaRef[];
}

/** H3 工作流扩展字段（挂在视频/图片请求体根字段，字段名与映射表一致） */
export interface ProtocolH3Extension {
  taskType: string;
  steps: number;
  seed: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  frameRate: number;
  /** 段间引导总开关 */
  continuityEnabled: boolean;
  overlapFrames: number;
  refs: ProtocolMediaRef[];
  timeline: ProtocolSegment[];
}

/** POST /v1/videos 请求体（OpenAI videos 形状 + zeroexo_h3 扩展） */
export interface ProtocolVideoRequest {
  model: string;
  prompt: string;
  seconds: number;
  /** "宽x高"（比例×系数合成，32 对齐） */
  size: string;
  zeroexo_h3: ProtocolH3Extension;
}

/** POST /v1/images/generations 请求体（OpenAI images 形状 + zeroexo_h3 扩展） */
export interface ProtocolImageRequest {
  model: string;
  prompt: string;
  n: number;
  size: string;
  zeroexo_h3: Pick<ProtocolH3Extension, 'refs' | 'steps' | 'seed' | 'cfg' | 'sampler' | 'scheduler' | 'taskType'>;
}

// ===== 构建器（唯一实现；字段名与上方映射表一一对应） =====

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('媒体读取失败'));
    fr.readAsDataURL(blob);
  });
}

export interface BuildProtocolRequestArgs {
  shots: RunShotLike[];
  shared: SharedParamsLike;
  tier: DirectorModelTier;
  selectedIds: string[];
  width: number;
  height: number;
  subjectCoverOf?: SubjectCoverOf;
  resolveMedia?: RefMediaResolver;
}

export interface BuiltProtocolRequest {
  request: ProtocolVideoRequest;
  /** 选中段顺序（协议 timeline 1 基段号 ↔ 该数组 0 基下标） */
  segmentShotIds: string[];
  totalFrames: number;
  warnings: string[];
}

/** 视频路：导演台选中段 → ProtocolVideoRequest（媒体内联 dataURL，无 zip 上传环节） */
export async function buildProtocolVideoRequest(args: BuildProtocolRequestArgs): Promise<BuiltProtocolRequest> {
  const resolveMedia = args.resolveMedia ?? createDefaultRefMediaResolver(args.subjectCoverOf);
  const sharedAssets = args.shared.enabled ? args.shared.assets : [];
  const selected = args.shots.filter((s) => args.selectedIds.includes(s.id));
  const warnings: string[] = [];

  const toRef = async (
    ref: DirectorAssetRef,
    slot: number,
    kind: DirectorAssetRef['kind'],
  ): Promise<ProtocolMediaRef | null> => {
    const media = await resolveMedia(ref).catch(() => null);
    if (!media) {
      warnings.push(`素材『${ref.title ?? ref.id}』无法读取媒体文件，槽位 ${slot} 为空`);
      return null;
    }
    try {
      return { slot, kind, media: await blobToDataURL(media.blob) };
    } catch {
      warnings.push(`素材『${ref.title ?? ref.id}』读取失败，槽位 ${slot} 为空`);
      return null;
    }
  };

  // 公共槽位（map: refs[]）
  const globalRefs: ProtocolMediaRef[] = [];
  for (const entry of assignAssetSlots({ shared: sharedAssets, segment: [], tier: args.tier }).entries) {
    const ref = sharedAssets.find((a) => a.id === entry.assetId);
    if (!ref) continue;
    const r = await toRef(ref, entry.slot, entry.kind);
    if (r) globalRefs.push(r);
  }

  // 段槽位（map: timeline[].refs[]）+ 时间线
  const overlapRaw = Number(args.shared.params['continuityOverlapFrames'] ?? 22);
  const overlap = Number.isFinite(overlapRaw) ? overlapRaw : 22;
  const globalContinuity = args.shared.params['continuityEnabled'] === true;
  const frameRate = 24; // DIRECTOR_FPS（节点内部恒 24）
  const timeline: ProtocolSegment[] = [];
  const segmentShotIds: string[] = [];
  let totalFrames = 0;
  for (let i = 0; i < selected.length; i++) {
    const shot = selected[i]!;
    const segSlots = assignAssetSlots({
      shared: sharedAssets,
      segment: shot.references ?? [],
      tier: args.tier,
    });
    const refs: ProtocolMediaRef[] = [];
    for (const entry of segSlots.entries) {
      if (entry.scope !== 'segment') continue; // 公共已落 global refs
      const ref = (shot.references ?? []).find((r) => r.id === entry.assetId);
      if (!ref) continue;
      const r = await toRef(ref, entry.slot, entry.kind);
      if (r) refs.push(r);
    }
    const idx = args.shots.findIndex((s) => s.id === shot.id);
    const frames = durationToFrames(shot.duration);
    timeline.push({
      index: i,
      // 公共提示词层已下线（2026-11-05）：只按每段提示词，不再拼接公共提示词
      prompt: (shot.imagePrompt ?? '').trim(),
      frames,
      taskType: '',
      continuityFromPrev: globalContinuity && segmentContinuityEnabled(shot, idx),
      refs,
    });
    segmentShotIds.push(shot.id);
    totalFrames += frames;
  }

  const p = args.shared.params;
  const d = DIRECTOR_PRESETS[args.tier].params;
  const taskType = preciseTaskType(p['task_type']);
  const request: ProtocolVideoRequest = {
    model: '', // 由调用方（openai-protocol-client）注入渠道 model
    // 公共提示词层已下线（2026-11-05）：上游格式键保留但恒为空串
    prompt: '',
    seconds: Math.max(1, Math.round((totalFrames / frameRate) * 10) / 10),
    size: `${args.width}x${args.height}`,
    zeroexo_h3: {
      taskType,
      steps: Number(p['steps'] ?? d['steps'] ?? 25),
      seed: Number(p['seed'] ?? d['seed'] ?? 0),
      cfg: Number(p['cfg'] ?? 1),
      sampler: String(p['sampler'] ?? 'res_multistep'),
      scheduler: String(p['scheduler'] ?? 'simple'),
      frameRate,
      continuityEnabled: globalContinuity,
      overlapFrames: overlap,
      refs: globalRefs,
      timeline,
    },
  };
  return { request, segmentShotIds, totalFrames, warnings };
}

/** 图片路：单图请求（无时间线/引导；refs/steps/seed 走同一扩展字段） */
export function buildProtocolImageRequest(args: {
  model: string;
  prompt: string;
  width: number;
  height: number;
  refs?: ProtocolMediaRef[];
  shared?: SharedParamsLike;
  tier?: DirectorModelTier;
}): ProtocolImageRequest {
  const p = args.shared?.params ?? {};
  const d = args.tier ? DIRECTOR_PRESETS[args.tier].params : undefined;
  return {
    model: args.model,
    prompt: args.prompt,
    n: 1,
    size: `${args.width}x${args.height}`,
    zeroexo_h3: {
      refs: args.refs ?? [],
      steps: Number(p['steps'] ?? d?.['steps'] ?? 25),
      seed: Number(p['seed'] ?? d?.['seed'] ?? 0),
      cfg: Number(p['cfg'] ?? 1),
      sampler: String(p['sampler'] ?? 'res_multistep'),
      scheduler: String(p['scheduler'] ?? 'simple'),
      taskType: preciseTaskType(p['task_type']),
    },
  };
}

// ===== 作业状态映射（GET /v1/videos/{id} → BridgeJobStatus，供 use-director-run 复用既有状态机） =====

export interface ProtocolVideoJob {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  /** 0-1（可选） */
  progress?: number;
  error?: { message?: string } | string | null;
  /** 我们中转/云渠道返回的分段扩展；缺省 = 单段整体交付 */
  zeroexo_h3?: {
    current_segment?: number | null;
    segments?: Array<{ index: number; state: 'pending' | 'writing' | 'done'; download_url?: string }>;
  };
}

/**
 * 协议作业 → BridgeJobStatus（唯一一份映射；use-director-run 无需感知两种后端）：
 * - 有 zeroexo_h3.segments：逐段 done + downloadUrl（缺省回落 /v1/videos/{id}/content）；
 * - 无扩展：completed 时全部段 done（downloadUrl = content 路由），progress 推算当前段。
 */
export function mapProtocolJobToBridgeStatus(job: ProtocolVideoJob, segmentCount: number): BridgeJobStatus {
  const total = Math.max(1, segmentCount);
  const state: BridgeJobStatus['state'] =
    job.status === 'queued'
      ? 'queued'
      : job.status === 'in_progress'
        ? 'running'
        : job.status === 'completed'
          ? 'success'
          : job.status === 'failed'
            ? 'error'
            : 'canceled';
  const errMsg =
    typeof job.error === 'string' ? job.error : (job.error?.message ?? (state === 'error' ? '上游执行失败' : undefined));

  const contentPath = protocolRoute(PROTOCOL_ROUTES.videoContent, job.id);
  let segments: BridgeJobSegment[];
  let currentSegment: number | null = null;

  const h3Segs = job.zeroexo_h3?.segments;
  if (Array.isArray(h3Segs) && h3Segs.length > 0) {
    segments = h3Segs.map((s) => ({
      index: s.index,
      state: s.state,
      frames: 0,
      outputPath: null,
      downloadUrl: s.download_url ?? contentPath,
    }));
    currentSegment = state === 'running' ? (job.zeroexo_h3?.current_segment ?? null) : null;
  } else {
    const allDone = state === 'success';
    currentSegment =
      state === 'running'
        ? Math.min(total, Math.max(1, Math.ceil((job.progress ?? 0) * total)))
        : null;
    segments = Array.from({ length: total }, (_, i) => ({
      index: i + 1,
      state: allDone ? 'done' : currentSegment !== null && i + 1 <= currentSegment - 1 ? 'done' : 'pending',
      frames: 0,
      outputPath: null,
      downloadUrl: allDone ? contentPath : null,
    }));
  }
  const done = segments.filter((s) => s.state === 'done').length;
  return {
    ok: true,
    jobId: job.id,
    state,
    currentSegment,
    progress: { done, total },
    segments,
    error: errMsg,
  };
}
