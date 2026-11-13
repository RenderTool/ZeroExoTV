/**
 * zeroexo-jobs-client — 直连本机 ComfyUI 插件（ComfyUI_ZeroExoNodes）的作业协议。
 *
 * 协议（插件 __init__.py）：
 * - POST /zeroexo/v1/jobs            {kind:"reference_video", clientJobId, project, episode, params}
 * - GET  /zeroexo/v1/jobs/{jobId}     状态 + 产物（outputs[].path 为服务端绝对路径）+ guide
 * - POST /zeroexo/v1/jobs/{jobId}/cancel
 * - GET  /zeroexo/v1/health           在线探测（插件自带）
 *
 * 参考图：插件节点只收一个 ComfyUI input 文件名 → 先 POST /upload/image（ComfyUI 原生）拿 name。
 * 产物：服务端返回的是磁盘路径，浏览器不能直读 → 换算成 ComfyUI 的 /view?filename=&subfolder=&type=output。
 */

export interface ZeroexoJobParams {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  frames: number;
  steps: number;
  cfg: number;
  seed: number;
  frame_rate: number;
  guide_frames: number;
  use_prev_guide: boolean;
  /** ComfyUI input 目录下的文件名（第一张，兼容单参考） */
  reference_image: string;
  /** 多参考图（最多 9 张；分镜图/站位锁定图等） */
  reference_images?: string[];
  /**
   * 片段引导槽（2026-11-07）：显式指定本段使用的 guide id（gd_xxx）。
   * 传了它 → 服务端不得再使用「上一段生成的引导」；前端同时发 use_prev_guide=false。
   */
  guide_id?: string;
  /** 显存策略（服务层自动决定；true=低显存链，false=原模型） */
  use_low_vram?: boolean;
}

/** Krea2 文生图作业参数（无参考图；仅线上 ComfyUI） */
export interface Krea2JobParams {
  prompt: string;
  negative_prompt?: string;
  seed: number;
  steps: number;
  cfg: number;
  eta: number;
  width: number;
  height: number;
}

export type ZeroexoJobState = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

/** 图像编辑（Qwen Image 2.1）作业参数（2026-11-07） */
export interface QwenImageJobParams {
  /** 编辑指令（同时写工作流的 raw prompt 与 LLM 改写输入） */
  edit_prompt: string;
  negative_prompt?: string;
  /** ComfyUI input 文件名（先经 /upload/image）；t2i 时为空 */
  input_image?: string;
  /** 遮罩文件名（可选；有值时服务端走遮罩模板） */
  mask_image?: string;
  seed: number;
  steps: number;
  cfg: number;
  denoise: number;
  /** false=图生图编辑（用 input_image），true=文生图 */
  edit_mode: boolean;
  /** true=先用 LLM（TextGenerate）改写指令 */
  use_llm_enhance: boolean;
  width: number;
  height: number;
}

/** 画布图像节点的「本机 Qwen 图像编辑」伪模型 key */
export const LOCAL_IMAGE_MODEL_KEY = 'zeroexo:qwen-image-2.1';
export const LOCAL_IMAGE_MODEL_LABEL = 'QwenImage2.1';

/** Krea2 文生图伪模型 key（仅线上 ComfyUI：需要 krea2 底模 + RES4LYF 采样器） */
export const KREA2_MODEL_KEY = 'zeroexo:krea2';
export const KREA2_MODEL_LABEL = 'Krea2';

/** Moss Image 文生图伪模型 key（moss_image_sft + qwen3.5_9b 文本编码 + flux2 VAE） */
export const MOSS_MODEL_KEY = 'zeroexo:moss';
export const MOSS_MODEL_LABEL = 'MossImage';

/** 画布视频节点的「本机」伪模型 key（node.data.model 存它即走 /zeroexo/v1/jobs） */
export const LOCAL_VIDEO_MODEL_KEY = 'zeroexo:minimax-h3';
export const LOCAL_VIDEO_MODEL_LABEL = 'H3ZeroExo';

export interface ZeroexoJobStatus {
  ok: boolean;
  jobId: string;
  promptId?: string | null;
  state: ZeroexoJobState;
  params?: Partial<ZeroexoJobParams>;
  outputs?: Array<{ kind: string; path: string }>;
  guide?: { id?: string; path?: string; frames?: number; sha256?: string } | null;
  /** 插件回传：本段引导来源（explicit=显式 guide_id / prev=上一段 / none=未使用） */
  guideSource?: 'explicit' | 'prev' | 'none' | null;
  error?: string | null;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const msg = body?.error ?? body?.message;
    if (typeof msg === 'string' && msg) return msg;
  } catch { /* 非 JSON */ }
  return `HTTP ${res.status}`;
}

/** 插件在线（/zeroexo/v1/health） */
export async function probeZeroexoPlugin(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${trimBase(baseUrl)}/zeroexo/v1/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 提交单段作业（一个片段 = 一个 ComfyUI prompt） */
async function submitJob(
  baseUrl: string,
  kind: 'reference_video' | 'qwen_image_edit' | 'krea2_t2i' | 'moss_image_t2i',
  body: { clientJobId?: string; clientId?: string; project: string; episode: string; models?: Record<string, string>; params: object },
): Promise<{ jobId: string; state: ZeroexoJobState; error?: string | null }> {
  const url = `${trimBase(baseUrl)}/zeroexo/v1/jobs`;
  const payload = JSON.stringify({ kind, ...body });
  // 2026-11-11 用户反馈「第一次点生成必 Failed to fetch，重试才好」：
  // 云端网关冷启动 / 旧 keep-alive 被关时，浏览器对 POST 不自动重试。这里对网络层失败自动重试
  // （POST 用同一 clientJobId，HTTP 错误/业务拒绝不重试，避免把真正的参数错误也重发）。
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        // 网关偶发不回包：不能无限停在「提交中」
        signal: AbortSignal.timeout(90_000),
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 2000));
    }
  }
  if (!res) {
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`请求 ${url} 失败：${detail}（已自动重试 2 次；云端网关可能正在唤醒，请再试一次）`);
  }
  if (!res.ok) throw new Error(`/zeroexo/v1/jobs ${await readError(res)}`);
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; jobId?: string; state?: ZeroexoJobState; error?: string | null }
    | null;
  if (!data?.jobId) throw new Error('/zeroexo/v1/jobs 未返回 jobId');
  if (data.ok === false) throw new Error(data.error || '插件拒绝作业（模型/模板未就绪）');
  return { jobId: data.jobId, state: (data.state ?? 'queued') as ZeroexoJobState, error: data.error ?? null };
}

/** 提交参考生视频作业 */
export async function submitZeroexoJob(
  baseUrl: string,
  body: { clientJobId?: string; clientId?: string; project: string; episode: string; models?: Record<string, string>; params: ZeroexoJobParams },
): Promise<{ jobId: string; state: ZeroexoJobState; error?: string | null }> {
  return submitJob(baseUrl, 'reference_video', body);
}

/** 提交图像编辑作业（Qwen Image 2.1） */
export async function submitQwenImageJob(
  baseUrl: string,
  body: { clientJobId?: string; clientId?: string; project: string; episode: string; params: QwenImageJobParams },
): Promise<{ jobId: string; state: ZeroexoJobState; error?: string | null }> {
  return submitJob(baseUrl, 'qwen_image_edit', body);
}

/** 提交 Krea2 文生图作业（仅线上 ComfyUI） */
export async function submitKrea2Job(
  baseUrl: string,
  body: { clientJobId?: string; clientId?: string; project: string; episode: string; params: Krea2JobParams },
): Promise<{ jobId: string; state: ZeroexoJobState; error?: string | null }> {
  return submitJob(baseUrl, 'krea2_t2i', body);
}

export interface MossJobParams {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
}

/** 提交 Moss Image 文生图作业 */
export async function submitMossJob(
  baseUrl: string,
  body: { clientJobId?: string; clientId?: string; project: string; episode: string; params: MossJobParams },
): Promise<{ jobId: string; state: ZeroexoJobState; error?: string | null }> {
  return submitJob(baseUrl, 'moss_image_t2i', body);
}

/**
 * 提交前预热一次连接（GET，不关心返回体）。
 *
 * 为什么需要：浏览器对同一 origin 复用 keep-alive 连接，云网关 / 反代空闲一段时间后会
 * 静默把它关掉，而浏览器只对 GET 做透明重试、**POST 不重试**。于是「空闲后第一次提交作业」
 * 必然抛 TypeError: Failed to fetch，用户表现为「第一次点生成必失败、第二次才成功」。
 * 提交前先打一个 GET，把连接换成新的，再发 POST。
 *
 * 不放在 submitJob 里：GET 会改变既有单测里 fetch 的调用序列，且上传也要预热（见调用方）。
 */
export async function warmZeroexoConnection(baseUrl: string): Promise<void> {
  const url = `${trimBase(baseUrl)}/zeroexo/v1/health`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fetch(url);
      return; // 有响应即说明连接可用（4xx/5xx 也代表网络通）
    } catch {
      /* 旧连接已被关：重试一次即换新连接 */
    }
  }
}

/** 查询作业状态（GET 天然幂等：keep-alive 被关时换连接重试一次，避免一次抖动打死整次生成） */
export async function fetchZeroexoJob(baseUrl: string, jobId: string): Promise<ZeroexoJobStatus> {
  const url = `${trimBase(baseUrl)}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => fetch(url, { signal: AbortSignal.timeout(15_000) }));
  if (!res.ok) throw new Error(`/zeroexo/v1/jobs/${jobId} ${await readError(res)}`);
  const data = (await res.json().catch(() => null)) as ZeroexoJobStatus | null;
  if (!data) throw new Error('作业状态响应不是 JSON');
  return data;
}

/** 取消作业（排队中 → 出队；运行中 → 中断） */
export async function cancelZeroexoJob(baseUrl: string, jobId: string): Promise<void> {
  await fetch(`${trimBase(baseUrl)}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
}

/**
 * 上传参考图到 ComfyUI input 目录，返回节点可用的文件名（`name` 或 `subfolder/name`）。
 * 失败返回 null（无参考图按纯文字生成，不阻断整次运行）。
 */
/** 同一张参考图在本次会话内只上传一次（内容哈希缓存；ComfyUI 本地 loopback，跨刷新不保留） */
const referenceUploadCache = new Map<string, string>();

async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function uploadZeroexoReference(
  baseUrl: string,
  blob: Blob,
  filename: string,
): Promise<string | null> {
  const hash = await sha256Hex(blob);
  const cacheKey = hash ? `${trimBase(baseUrl)}|${hash}` : '';
  if (cacheKey) {
    const cached = referenceUploadCache.get(cacheKey);
    if (cached) return cached;
  }
  try {
    const form = new FormData();
    form.append('image', new File([blob], filename, { type: blob.type || 'image/png' }));
    form.append('overwrite', 'true');
    const url = `${trimBase(baseUrl)}/upload/image`;
    const post = (): Promise<Response> => fetch(url, { method: 'POST', body: form });
    // 上传是 POST：keep-alive 被网关关掉时浏览器不重试，第一次必然 Failed to fetch；
    // 同一文件 + overwrite=true 天然幂等，所以这里可以安全重试一次（否则参考图会被静默丢掉 → 退化成文生图）
    const res = await post().catch(() => post());
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
    if (!data?.name) return null;
    const name = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
    if (cacheKey) referenceUploadCache.set(cacheKey, name);
    return name;
  } catch {
    return null;
  }
}

/**
 * 服务端输出路径 → ComfyUI /view URL（浏览器可取）。
 * 例：D:\ComfyUI\...\output\zeroexo\p1\ep01\seg_00001.mp4
 *   → {base}/view?filename=seg_00001.mp4&subfolder=zeroexo/p1/ep01&type=output
 */
export function zeroexoOutputViewUrl(baseUrl: string, outputPath: string): string | null {
  const m = /[\\/]output[\\/](.+)$/i.exec(outputPath ?? '');
  if (!m) return null;
  const rel = m[1]!.replace(/\\/g, '/');
  const slash = rel.lastIndexOf('/');
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const subfolder = slash >= 0 ? rel.slice(0, slash) : '';
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, subfolder, type: 'output' }).toString();
  return `${trimBase(baseUrl)}/view?${qs}`;
}
