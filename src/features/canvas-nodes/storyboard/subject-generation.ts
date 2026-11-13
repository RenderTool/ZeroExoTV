/**
 * subject-generation — 主体状态页直接出图（2026-11-13 P0）
 *
 * 为什么单独一层：
 * - 画布图片节点每次生成都绑一个节点；主体状态的结果要回挂到「某个主体的某个状态」，
 *   且关掉页面/切页签后任务还在跑 → 任务身份（jobId/clientId）必须落在主体树里，
 *   页面重新挂载时按它续接，而不是把同一张图重新提交一次。
 * - 任务执行不绑组件生命周期：轮询/预览在模块级运行，完成时按「最新容器」读改写回，
 *   避免组件卸载后用过期树覆盖别的字段。
 *
 * 写入纪律：
 * - 进度只节流落盘（每 ≥10% 一次），预览帧只进内存，绝不把 dataURL 写进树；
 * - 完成时走 linkSubjectStateMedia（CAS 记账 + 首槽替换 + 历史），再清 genJob；
 * - 失败保留 genJob.error 供状态卡展示/重试，不覆盖已有图片。
 */
import { create } from 'zustand';
import {
  SUBJECT_BASE_STATE_ID,
  firstCoverMediaKeyOfState,
  migrateSubjectTrees,
  type SubjectGenJob,
  type SubjectGenParams,
  type SubjectTree,
  type SubjectTreeNode,
} from './subject-tree-types';
import { linkSubjectStateMedia, useSubjectMediaLinkEventStore } from './subject-state-media';
import { readStoryboardContainer, updateStoryboardContainer } from '@/entities/slot-containers.js';
import { stageCasUpload } from '@/features/asset-picker/services/cas-upload.js';
import { resolveMediaBlob } from '@/shared/media/resolve-media-blob.js';
import {
  generateLocalQwenImage,
  type LocalImageResult,
} from '@/pages/editor/editor-canvas/interactions/local-qwen-image.js';
import { generateMossImage } from '@/pages/editor/editor-canvas/interactions/local-moss-image.js';
import { generateKrea2Image } from '@/pages/editor/editor-canvas/interactions/local-krea2-image.js';
import {
  KREA2_MODEL_KEY,
  LOCAL_IMAGE_MODEL_KEY,
  MOSS_MODEL_KEY,
} from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { clampQwenSize } from '@/features/canvas-tabs/qwen-limits.js';

export const SUBJECT_GEN_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;

export type SubjectGenQuality = '1k' | '2k' | 'custom';

export interface ResolvedSubjectGenParams {
  aspect: string;
  quality: SubjectGenQuality;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  useBaseRef: boolean;
  referenceKeys: string[];
}

/** 1K/2K = 最长边 1024/2048，另一边按比例换算，再按 Qwen 的 32 对齐夹取 */
export function subjectGenSize(aspect: string, quality: '1k' | '2k'): { width: number; height: number } {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(aspect);
  const rw = m ? Number(m[1]) : 16;
  const rh = m ? Number(m[2]) : 9;
  const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
  const long = quality === '2k' ? 2048 : 1024;
  const width = ratio >= 1 ? long : Math.round((long * ratio) / 32) * 32;
  const height = ratio >= 1 ? Math.round(long / ratio / 32) * 32 : long;
  return clampQwenSize(width, height);
}

/** 模型默认步数/贴合度（与画布图片节点同一套默认值） */
function modelDefaults(model: string): { steps: number; cfg: number } {
  if (model === MOSS_MODEL_KEY) return { steps: 25, cfg: 2.5 };
  if (model === KREA2_MODEL_KEY) return { steps: 10, cfg: 1 };
  return { steps: 25, cfg: 1 };
}

/** 把状态上零散的 genParams 补成完整参数；基础状态没有「引用基础图」语义 */
export function resolveSubjectGenParams(
  node: Pick<SubjectTreeNode, 'id' | 'imageModel' | 'genParams'>,
): ResolvedSubjectGenParams {
  const isBase = node.id === SUBJECT_BASE_STATE_ID;
  const p: SubjectGenParams = node.genParams ?? {};
  const model = node.imageModel ?? LOCAL_IMAGE_MODEL_KEY;
  const defaults = modelDefaults(model);
  const aspect = p.aspect ?? '16:9';
  const quality: SubjectGenQuality = p.quality ?? '2k';
  const size = quality === 'custom' && p.width && p.height
    ? clampQwenSize(p.width, p.height)
    : subjectGenSize(aspect, quality === '1k' ? '1k' : '2k');
  return {
    aspect,
    quality,
    width: size.width,
    height: size.height,
    steps: p.steps ?? defaults.steps,
    cfg: p.cfg ?? defaults.cfg,
    seed: p.seed ?? -1,
    useBaseRef: isBase ? false : (p.useBaseRef ?? true),
    referenceKeys: Array.isArray(p.referenceKeys) ? p.referenceKeys.filter(Boolean) : [],
  };
}

// ===== 运行时状态（预览只进内存；页面重挂载后由树里的 genJob 兜底展示）=====

export interface SubjectJobRuntime {
  state: SubjectGenJob['state'];
  progress: number;
  preview?: string;
  error?: string;
}

interface SubjectGenerationStore {
  jobs: Record<string, SubjectJobRuntime>;
  patch: (key: string, value: SubjectJobRuntime) => void;
  clear: (key: string) => void;
}

export const useSubjectGenerationStore = create<SubjectGenerationStore>((set) => ({
  jobs: {},
  patch: (key, value) => set((s) => ({ jobs: { ...s.jobs, [key]: value } })),
  clear: (key) => set((s) => {
    if (!s.jobs[key]) return s;
    const next = { ...s.jobs };
    delete next[key];
    return { jobs: next };
  }),
}));

export function subjectJobKey(projectId: string, rootId: string, stateId: string): string {
  return `${projectId}:${rootId}:${stateId}`;
}

/** 正在跑的任务（按 key 去重：页面两处实例不会重复烧一张图） */
const running = new Map<string, AbortController>();

export function isSubjectJobRunning(key: string): boolean {
  return running.has(key);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取基础状态图失败'));
    reader.readAsDataURL(blob);
  });
}

async function readBaseStateDataUrl(tree: SubjectTree): Promise<string | null> {
  const base = (tree.states ?? []).find((n) => n.id === SUBJECT_BASE_STATE_ID);
  const key = firstCoverMediaKeyOfState(base?.media);
  if (!key) return null;
  const blob = await resolveMediaBlob(key, 'image', 'orig').catch(() => null);
  if (!blob) return null;
  return blobToDataUrl(blob).catch(() => null);
}

async function readMediaDataUrl(storageKey: string): Promise<string | null> {
  const blob = await resolveMediaBlob(storageKey, 'image', 'orig').catch(() => null);
  if (!blob) return null;
  return blobToDataUrl(blob).catch(() => null);
}

/** 只改目标状态的一格；基于最新容器读改写，避免覆盖并行的提示词/集数编辑 */
async function patchNode(
  projectId: string,
  rootId: string,
  stateId: string,
  patch: (node: SubjectTreeNode) => SubjectTreeNode,
): Promise<void> {
  await updateStoryboardContainer(projectId, (container) => {
    const trees = migrateSubjectTrees(container.subjectTree);
    return {
      subjectTree: trees.map((tr) => (tr.rootId === rootId
        ? { ...tr, states: tr.states.map((n) => (n.id === stateId ? patch(n) : n)) }
        : tr)),
    };
  }).catch(() => undefined);
}

async function persistJob(
  projectId: string,
  rootId: string,
  stateId: string,
  job: SubjectGenJob | null,
): Promise<void> {
  await patchNode(projectId, rootId, stateId, (node) => ({ ...node, genJob: job }));
  // 让已打开的主体页/画布页同步到树里的任务状态（进度只按 10% 粒度，不会高频刷新）
  useSubjectMediaLinkEventStore.getState().emit({ rootId, stateId });
}

/** 完成：CAS 落库 + 挂到状态首槽（带替换历史与封面跟随） */
async function attachResult(
  projectId: string,
  rootId: string,
  stateId: string,
  oldMediaKey: string | null,
  result: LocalImageResult,
): Promise<void> {
  const staged = await stageCasUpload(result.blob, 'image', { projectId });
  const storageKey = staged.storageKey;
  const container = await readStoryboardContainer(projectId);
  const freshTrees = migrateSubjectTrees(container?.subjectTree);
  const { trees: linked } = await linkSubjectStateMedia({
    trees: freshTrees,
    projectId,
    rootId,
    stateId,
    asset: { storageKey, kind: 'image', origin: { type: 'upload', label: '状态生成' } },
  });
  const linkedTree = linked.find((tr) => tr.rootId === rootId);
  const linkedNode = linkedTree?.states.find((n) => n.id === stateId);
  if (!linkedTree || !linkedNode) throw new Error('主体状态已被删除，结果未挂载');
  await updateStoryboardContainer(projectId, (current) => {
    const latest = migrateSubjectTrees(current.subjectTree);
    return {
      subjectTree: latest.map((tr) => {
        if (tr.rootId !== rootId) return tr;
        return {
          ...tr,
          // 旧图正好是封面 → 封面跟随新图（与 linkSubjectStateMedia 同口径）
          coverKey: oldMediaKey && tr.coverKey === oldMediaKey ? linkedTree.coverKey : tr.coverKey,
          states: tr.states.map((n) => (n.id === stateId
            ? { ...n, type: linkedNode.type, media: linkedNode.media, mediaHistory: linkedNode.mediaHistory, genJob: null }
            : n)),
        };
      }),
    };
  });
}

interface RunInput {
  projectId: string;
  tree: SubjectTree;
  node: SubjectTreeNode;
  prompt: string;
  resume?: { jobId: string; clientId: string };
}

async function runJob(key: string, input: RunInput): Promise<void> {
  const { projectId, tree, node, prompt } = input;
  const params = resolveSubjectGenParams(node);
  // 续接时按提交时的模型走（用户中途换模型不能把旧 job 当新模型轮询）
  const model = (input.resume ? node.genJob?.model : undefined) ?? node.imageModel ?? LOCAL_IMAGE_MODEL_KEY;
  const isBase = node.id === SUBJECT_BASE_STATE_ID;
  const controller = new AbortController();
  running.set(key, controller);
  const store = useSubjectGenerationStore.getState();
  const oldMediaKey = firstCoverMediaKeyOfState((node.media ?? []));
  let lastPersistedPct = -10;
  let submitted: { jobId: string; clientId: string } | null = input.resume ?? null;
  const baseJob = (state: SubjectGenJob['state']): SubjectGenJob => ({
    jobId: submitted?.jobId ?? '',
    clientId: submitted?.clientId ?? '',
    model,
    state,
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.patch(key, { state: input.resume ? 'running' : 'queued', progress: 0 });

  const onProgress = (p: { step: number; totalSteps: number }): void => {
    const pct = p.totalSteps > 0 ? Math.max(0, Math.min(100, Math.round((p.step / p.totalSteps) * 100))) : 0;
    const prev = useSubjectGenerationStore.getState().jobs[key];
    useSubjectGenerationStore.getState().patch(key, { state: 'running', progress: pct, preview: prev?.preview });
    if (!submitted || pct < lastPersistedPct + 10) return;
    lastPersistedPct = pct;
    void persistJob(projectId, tree.rootId, node.id, {
      ...baseJob('running'), progress: pct,
    });
  };
  const onPreview = (dataUrl: string): void => {
    const prev = useSubjectGenerationStore.getState().jobs[key];
    useSubjectGenerationStore.getState().patch(key, {
      state: 'running', progress: prev?.progress ?? 0, preview: dataUrl,
    });
  };
  const onJobSubmitted = (job: { jobId: string; clientId: string }): void => {
    submitted = job;
    void persistJob(projectId, tree.rootId, node.id, baseJob('running'));
  };

  try {
    let result: LocalImageResult;
    if (model === MOSS_MODEL_KEY) {
      result = await generateMossImage({
        prompt,
        aspect: params.aspect,
        params: {
          steps: params.steps,
          cfg: params.cfg,
          seed: params.seed,
          megapixels: (params.width * params.height) / (1024 * 1024),
        },
        onPreview, onProgress, onJobSubmitted,
        resume: input.resume,
        signal: controller.signal,
      });
    } else if (model === KREA2_MODEL_KEY) {
      result = await generateKrea2Image({
        prompt,
        aspect: params.aspect,
        params: {
          steps: params.steps,
          cfg: params.cfg,
          seed: params.seed,
          megapixels: (params.width * params.height) / (1024 * 1024),
        },
        onPreview, onProgress, onJobSubmitted,
        resume: input.resume,
        signal: controller.signal,
      });
    } else {
      const explicitRef = params.referenceKeys[0];
      // 显式参考素材对基础状态同样生效；只有「自动拿基础图」这一步排除基础状态自身
      const source = explicitRef
        ? await readMediaDataUrl(explicitRef)
        : (!isBase && params.useBaseRef ? await readBaseStateDataUrl(tree) : null);
      result = await generateLocalQwenImage({
        prompt,
        referenceImages: source ? [source] : undefined,
        width: params.width,
        height: params.height,
        params: {
          width: params.width,
          height: params.height,
          steps: params.steps,
          cfg: params.cfg,
          seed: params.seed,
          // 有参考图时输出必须与输入同尺寸（Qwen latent 要求），否则走用户选的尺寸
          sizeMode: source ? 'source' : 'custom',
        },
        onPreview, onProgress, onJobSubmitted,
        resume: input.resume,
        signal: controller.signal,
      });
    }
    await attachResult(projectId, tree.rootId, node.id, oldMediaKey, result);
    useSubjectMediaLinkEventStore.getState().emit({ rootId: tree.rootId, stateId: node.id });
    useSubjectGenerationStore.getState().patch(key, { state: 'success', progress: 100 });
  } catch (err) {
    const cancelled = err instanceof DOMException && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : String(err);
    useSubjectGenerationStore.getState().patch(key, {
      state: cancelled ? 'cancelled' : 'error',
      progress: 0,
      error: cancelled ? undefined : message,
    });
    if (cancelled) {
      await persistJob(projectId, tree.rootId, node.id, null);
    } else {
      await persistJob(projectId, tree.rootId, node.id, { ...baseJob('error'), error: message });
    }
    useSubjectMediaLinkEventStore.getState().emit({ rootId: tree.rootId, stateId: node.id });
  } finally {
    running.delete(key);
  }
}

/** 开始状态出图（同一状态已有任务在跑 = 直接忽略，防重复提交） */
export function startSubjectGeneration(input: {
  projectId: string;
  tree: SubjectTree;
  node: SubjectTreeNode;
}): void {
  const key = subjectJobKey(input.projectId, input.tree.rootId, input.node.id);
  if (running.has(key)) return;
  const prompt = (input.node.fullPrompt || input.node.deltaPrompt || '').trim();
  if (!prompt) {
    useSubjectGenerationStore.getState().patch(key, { state: 'error', progress: 0, error: '先写提示词再生成' });
    return;
  }
  void runJob(key, { ...input, prompt });
}

/** 撤销进行中的任务（服务端作业同时取消）；只清任务，不动已有图片 */
export function cancelSubjectGeneration(projectId: string, rootId: string, stateId: string): void {
  const key = subjectJobKey(projectId, rootId, stateId);
  running.get(key)?.abort();
}

/** 刷新/重进页面：有进行中的 genJob 就按原 jobId/clientId 续接（不会重新提交一张） */
export function resumeSubjectGeneration(input: {
  projectId: string;
  tree: SubjectTree;
  node: SubjectTreeNode;
}): void {
  const job = input.node.genJob;
  if (!job?.jobId || !job.clientId) return;
  if (job.state !== 'queued' && job.state !== 'running') return;
  const key = subjectJobKey(input.projectId, input.tree.rootId, input.node.id);
  if (running.has(key)) return;
  const prompt = (input.node.fullPrompt || input.node.deltaPrompt || '').trim();
  if (!prompt) return;
  void runJob(key, {
    ...input,
    prompt,
    resume: { jobId: job.jobId, clientId: job.clientId },
  });
}
