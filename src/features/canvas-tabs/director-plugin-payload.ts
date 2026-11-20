/**
 * 导演台 → ComfyUI 插件任务 payload（网页直连插件用）。
 *
 * 只做纯数据组装：选段 → 连续 run → 每个 run 起始 guide / 段内 chain → 每段参数。
 * 不读写项目文件、不提交、不执行；便于单测。
 */
import { durationToFrames, resolveVideoSize } from '@/entities/director-params.js';
import type { WorkbenchSharedParams } from '@/entities/slot-containers.js';
import type { WorkbenchShot } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import type { ProductionItem } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { resolveRefVisual } from './director-prompt-panel.js'
import { selectedShotVersion } from './shot-cache.js';
import { pluginTaskBase } from '@/features/task-center/plugin-task-client.js';
import { uploadZeroexoReference } from './zeroexo-jobs-client.js';
import { fetchComfyuiMachineInfo } from './comfyui-endpoint.js';
import { resolveMediaBlob } from '@/shared/media/resolve-media-blob.js';

export interface PluginSegmentPayload {
  shotId: string;
  /** sha256 = 该引导内容指纹；提交前/执行时都必须校验，禁止「同 id 不同内容」被当成同一份 */
  guide: { mode: 'initial' | 'chain' | 'none'; id?: string; sha256?: string };
  params: Record<string, unknown>;
}

export interface PluginBatchPayload {
  projectId: string;
  clientJobId: string;
  /** 预览 WS 的 clientId（与插件子任务共用，网页直连 /ws 收采样帧） */
  clientId: string;
  kind: 'director_run';
  /**
   * 模型映射面板选中的四件套（插件写进模板加载器节点的就是它）。
   * 不传时插件按模板 + 自己的规则挑，会挑到 48G 的 bf16 编码器（2026-11-20 显存事故）。
   */
  models?: {
    unet?: string;
    videoVae?: string;
    audioVae?: string;
    clip?: string;
    clipType?: string;
  };
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

/**
 * 提交提示词只认 imagePrompt（分镜结构化提示词唯一来源）。
 * 2026-11-18 事故：imagePrompt 为空时静默回落 videoPrompt / `第 N 段`，
 * 结果提交的是一段和分镜、参考图都没关系的自由文本，成片必然对不上；
 * 现在不回落——空提示词交给 validateRunSelection 的 prompt-not-structured 拒绝。
 */
function promptOf(shot: WorkbenchShot): string {
  return (shot.imagePrompt ?? '').trim();
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
      ? { mode: 'initial' as const, id: head.guide.id, ...(head.guide.sha256 ? { sha256: head.guide.sha256 } : {}) }
      : prevVersion?.guide?.id
        ? {
            mode: 'initial' as const,
            id: prevVersion.guide.id,
            ...(prevVersion.guide.sha256 ? { sha256: prevVersion.guide.sha256 } : {}),
          }
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

/**
 * 补齐每段的参考图：导演台插槽里的图必须作为真实参考上传给插件，
 * 不能只发提示词（2026-11-18 用户实测：概念图与成片构图漂移，根因是 payload 里没有 reference_image）。
 *
 * 顺序 = 插槽顺序（Picture1..N），基础状态首图若在槽位 1 就是第一张参考图。
 * 任一上传失败直接抛错，阻止「无参考生成」把问题掩盖成模型不听话。
 */
export async function attachDirectorReferenceImages(
  payload: PluginBatchPayload,
  shots: WorkbenchShot[],
  subjects?: ProductionItem[],
  subjectTrees?: SubjectTree[],
): Promise<PluginBatchPayload> {
  const base = pluginTaskBase();
  if (!base) throw new Error('ComfyUI 地址未配置，无法上传参考图');
  /**
   * 2026-11-20 报障：云实例停了（连 /system_stats 都 404）时，这里只会抛「参考图上传失败：<标题>」，
   * 用户根本看不出根因。上传前先探活一次：连不上就直接说清楚地址和动作，不让人怀疑图片本身。
   */
  if (!(await fetchComfyuiMachineInfo(base))) {
    throw new Error(
      `ComfyUI 连不上（${base}）：实例可能已停止、地址已失效或本机网络不通。`
      + '先在「连接 ComfyUI」面板测试通过，再发起生成',
    );
  }
  const byId = new Map(shots.map((s) => [s.id, s]));
  for (const segment of payload.segments) {
    const shot = byId.get(segment.shotId);
    /**
     * 分镜质量由 Agent 侧（MCP `review_shots` / `request_director_run`）把关。
     * 网页运行是用户的手动决定，不允许在提交链路上抛错拦截——
     * 提示词问题在面板上用「质量 N」徽标提示（同一份 checkShotPrompt 结果），
     * 用户想直接跑就让他跑。这里不再 throw，也不再静默改写提示词。
     */
    /**
     * 2026-11-19 报障：这里原来按 `r.storageKey` 过滤，主体引用（`subject:<id>`、主体状态引用换图后 key 为空）
     * 会被静默丢掉，上传顺序被压缩 → 提示词里的 @PictureN 与真实上传的第 N 张错位，
     * 表现就是「成片和分镜参考图对不上」。现在按插槽顺序解析：主体引用用当前封面/状态图，解析不到就报错，不静默降级。
     */
    const refs = (shot?.references ?? [])
      .filter((r) => r.kind === 'image')
      /**
       * 按**槽号**上传，而不是按落盘数组顺序：提示词里的 `@PictureN` 指的就是第 N 个槽号，
       * 数组顺序与 pin 顺序一旦不一致（替换/追加历史数据）就会整体错位。
       */
      .slice()
      .sort((a, b) => {
        const pa = typeof a.slotNo === 'number' && a.slotNo >= 1 ? a.slotNo : Number.POSITIVE_INFINITY;
        const pb = typeof b.slotNo === 'number' && b.slotNo >= 1 ? b.slotNo : Number.POSITIVE_INFINITY;
        return pa - pb;
      })
      .slice(0, 9);
    if (refs.length === 0) continue;
    const names: string[] = [];
    for (const [i, ref] of refs.entries()) {
      const visual = resolveRefVisual(
        {
          id: ref.id, kind: 'image', title: ref.title, storageKey: ref.storageKey, url: ref.url,
          // origin 指纹只要主体类（subject-base / subject-state）；色卡、上传类不上抛
          origin: (() => {
            const o = ref.origin;
            if (!o || !o.rootId || o.kind === 'color-card' || o.kind === 'user-upload') return undefined;
            return { kind: o.kind, rootId: o.rootId, state: o.state, mediaKey: o.mediaKey };
          })(),
        },
        subjects,
        subjectTrees,
      );
      const key = visual.stale ? undefined : (visual.storageKey ?? ref.storageKey);
      if (!key) {
        throw new Error(
          `第 ${i + 1} 张参考图（${ref.title || ref.id}）已失效：主体/素材被删除或未挂图，`
          + '请先在插槽里重新放入再生成（不允许跳过该槽位继续跑）',
        );
      }
      const blob = await resolveMediaBlob(key, 'image', 'orig');
      if (!blob) throw new Error(`参考图读取失败：${ref.title || key}`);
      const ext = blob.type.includes('webp') ? '.webp' : blob.type.includes('jpeg') ? '.jpg' : '.png';
      const name = await uploadZeroexoReference(base, blob, `director_${segment.shotId}_${i}${ext}`);
      if (!name) throw new Error(`第 ${i + 1} 张参考图上传失败（${ref.title || key}）：ComfyUI /upload/image 没返回文件名，确认实例正常、图片没超过输入上限`);
      names.push(name);
    }
    segment.params.reference_image = names[0] ?? '';
    segment.params.reference_images = names;
  }
  return payload;
}
