/**
 * 导演台 → ComfyUI 插件任务 payload（网页直连插件用）。
 *
 * 只做纯数据组装：选段 → 连续 run → 每个 run 起始 guide / 段内 chain → 每段参数。
 * 不读写项目文件、不提交、不执行；便于单测。
 */
import { durationToFrames, resolveVideoSize } from '@/entities/director-params.js';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import { selectedShotVersion } from './shot-cache.js';

export interface PluginSegmentPayload {
  shotId: string;
  guide: { mode: 'initial' | 'chain' | 'none'; id?: string };
  params: Record<string, unknown>;
}

export interface PluginBatchPayload {
  projectId: string;
  clientJobId: string;
  /** 预览 WS 的 clientId（与插件子任务共用，网页直连 /ws 收采样帧） */
  clientId: string;
  kind: 'director_run';
  segments: PluginSegmentPayload[];
}

function boundaryEnabled(shots: WorkbenchShot[], index: number): boolean {
  const shot = shots[index];
  if (!shot || index <= 0) return false;
  return shot.continuation ? shot.continuation.enabled === true : true;
}

/** 选中段按时间线切成连续 run；断点=未选或该段关闭了“衔接上一段” */
export function contiguousRuns(
  shots: WorkbenchShot[],
  selectedIds: readonly string[],
): number[][] {
  const selected = new Set(selectedIds);
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i]!;
    if (!selected.has(shot.id)) {
      if (current.length) runs.push(current);
      current = [];
      continue;
    }
    if (current.length === 0) {
      current = [i];
      continue;
    }
    const prev = current[current.length - 1]!;
    // 显式引导槽 = 新 run 的起始输入，优先于“接上一段”
    if (prev === i - 1 && boundaryEnabled(shots, i) && !shot.guide?.id) {
      current.push(i);
    } else {
      runs.push(current);
      current = [i];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

function promptOf(shot: WorkbenchShot): string {
  return (shot.imagePrompt || shot.videoPrompt || '').trim() || `第 ${shot.number} 段`;
}

function sharedNum(shared: WorkbenchSharedParams, key: string, fallback: number): number {
  const n = Number(shared.params[key]);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 生成插件批次 payload。
 * 起始段 guide：显式 shot.guide 优先；否则上一段当前缓存版本的 guide（开关开着时）。
 * 起始段没有 guide 时用 none，不拒绝；run 内其余段一律 chain。
 */
export function buildDirectorBatchPayload(args: {
  projectId: string;
  taskId: string;
  shots: WorkbenchShot[];
  selectedIds: readonly string[];
  shared: WorkbenchSharedParams;
}): PluginBatchPayload {
  const { projectId, taskId, shots, selectedIds, shared } = args;
  const aspect = String(shared.params.aspect ?? '16:9');
  const size = resolveVideoSize(aspect, Number(shared.params.scaleFactor ?? 1));
  const steps = sharedNum(shared, 'steps', 8);
  const cfg = sharedNum(shared, 'cfg', 1);
  const seed = sharedNum(shared, 'seed', 1);
  const guideFrames = sharedNum(shared, 'continuityOverlapFrames', 22);
  const segments: PluginSegmentPayload[] = [];

  for (const run of contiguousRuns(shots, selectedIds)) {
    const headIdx = run[0]!;
    const head = shots[headIdx]!;
    const prevVersion = headIdx > 0 && boundaryEnabled(shots, headIdx)
      ? selectedShotVersion(shots[headIdx - 1]!)
      : null;
    const startGuide = head.guide?.id
      ? { mode: 'initial' as const, id: head.guide.id }
      : prevVersion?.guide?.id
        ? { mode: 'initial' as const, id: prevVersion.guide.id }
        : { mode: 'none' as const };

    run.forEach((idx, k) => {
      const shot = shots[idx]!;
      segments.push({
        shotId: shot.id,
        guide: k === 0 ? startGuide : { mode: 'chain' },
        params: {
          prompt: promptOf(shot),
          negative_prompt: String((shot as { negativePrompt?: string }).negativePrompt ?? ''),
          width: size.width,
          height: size.height,
          frames: durationToFrames(Number(shot.duration) || 5),
          steps,
          cfg,
          seed,
          frame_rate: 24,
          guide_frames: guideFrames,
          // 采样中的 TAE 动态预览；插件默认关，网页直连任务显式打开
          live_tae_preview: true,
          liveTaePreview: true,
        },
      });
    });
  }

  return { projectId, clientJobId: taskId, clientId: taskId, kind: 'director_run', segments };
}
