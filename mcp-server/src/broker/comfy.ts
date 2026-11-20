/**
 * Broker → ComfyUI（ComfyUI_ZeroExoNodes 插件协议）。
 *
 * 与前端 zeroexo-jobs-client 同一份契约：
 * - POST /zeroexo/v1/jobs   {kind, clientJobId, clientId, project, episode, models?, params}
 * - GET  /zeroexo/v1/jobs/{id}  状态 + outputs[].path（服务端绝对路径）+ guide
 * - POST /zeroexo/v1/jobs/{id}/cancel
 * - POST /upload/image（参考图先传 ComfyUI input）
 * - GET  /view?filename=&subfolder=&type=output（产物下载；云端同样可用）
 * - WS   /ws?clientId=  实时预览：minimax_director_preview（JSON base64）与二进制 PREVIEW_IMAGE
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";

export interface ComfyBatchSegmentStatus {
  index?: number;
  shotId?: string;
  state?: "queued" | "running" | "success" | "error" | "cancelled";
  outputs?: Array<{ kind?: string; path?: string }>;
  guide?: { id?: string; path?: string; frames?: number; sha256?: string } | null;
  error?: string | null;
  prompt?: string;
  guideInPath?: string;
  /** 插件从成品视频抽的最后一帧（高清封面）；没有则回退 WS 预览 */
  previewPath?: string;
}

export interface ComfyJobStatus {
  ok?: boolean;
  jobId?: string;
  state?: "queued" | "running" | "success" | "error" | "cancelled";
  outputs?: Array<{ kind?: string; path?: string }>;
  guide?: { id?: string; path?: string; frames?: number; sha256?: string } | null;
  guideSource?: string | null;
  error?: string | null;
  /** reference_video_batch：逐段状态与产物（每段完成即可见） */
  segments?: ComfyBatchSegmentStatus[];
  currentSegment?: number | null;
  currentJobId?: string | null;
}

export interface PreviewFrame {
  /** dataURL；progress-only 事件无图时为 null */
  image: string | null;
  step: number | null;
  totalSteps: number | null;
  segmentIndex: number | null;
}

const trim = (s: string): string => s.replace(/\/+$/, "");

/** 地址来源：显式入参 > 环境变量 > 网页广播 > 本机默认 */
export async function resolveComfyBase(explicit?: string): Promise<string> {
  if (explicit?.trim()) return trim(explicit.trim());
  const env = process.env.ZEROEXO_COMFY_BASE?.trim();
  if (env) return trim(env);
  try {
    const raw = await fs.readFile(
      path.join(dataRoot(), ".lf", "zeroexo", "app_meta", "comfyui-endpoint.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { address?: string };
    if (parsed.address?.trim()) return trim(parsed.address.trim());
  } catch {
    // 网页还没广播：落到本机默认
  }
  return "http://127.0.0.1:8188";
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const msg = body?.error ?? body?.message;
    if (typeof msg === "string" && msg) return msg;
  } catch { /* 非 JSON */ }
  return `HTTP ${res.status}`;
}

export async function probeComfy(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/zeroexo/v1/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

/** 显存策略属于服务层：读不到显存时保守走低显存链 */
export async function detectLowVram(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return true;
    const body = (await res.json()) as { devices?: Array<{ vram_total?: number }> };
    const vram = body.devices?.[0]?.vram_total;
    if (typeof vram !== "number" || !Number.isFinite(vram) || vram <= 0) return true;
    return vram < 16 * 1024 ** 3;
  } catch {
    return true;
  }
}

interface SubmitResponse { jobId?: string; ok?: boolean; error?: string | null }

/** POST /zeroexo/v1/jobs（带 keep-alive 重试；同一 clientJobId 幂等由插件保证） */
async function postJobPayload(base: string, payload: unknown): Promise<SubmitResponse> {
  const url = `${base}/zeroexo/v1/jobs`;
  const body = JSON.stringify(payload);
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(90_000),
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 800 : 2000));
    }
  }
  if (!res) {
    throw new McpError("IO_ERROR", `提交作业失败（${url}）：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
  if (!res.ok) throw new McpError("IO_ERROR", `提交作业失败：${await readError(res)}`);
  const data = (await res.json().catch(() => null)) as SubmitResponse | null;
  if (!data) throw new McpError("IO_ERROR", "插件返回的不是 JSON");
  if (data.ok === false) throw new McpError("IO_ERROR", data.error || "插件拒绝作业（模型/模板未就绪）");
  if (!data.jobId) throw new McpError("IO_ERROR", "插件未返回 jobId");
  return data;
}

export async function submitComfyJob(
  base: string,
  kind: "reference_video" | "qwen_image_edit" | "krea2_t2i" | "moss_image_t2i",
  body: {
    clientJobId?: string;
    clientId?: string;
    /** 批内取消范围（不涉及项目数据） */
    runId?: string;
    project?: string;
    episode?: string;
    models?: Record<string, string>;
    params: Record<string, unknown>;
  },
): Promise<string> {
  const data = await postJobPayload(base, { kind, ...body });
  return data.jobId!;
}

export interface ComfyBatchSegmentInput {
  shotId?: string;
  guide: { mode: "initial" | "chain" | "none"; id?: string };
  params: Record<string, unknown>;
}

/**
 * 提交连续段批次：一次带全部段的提示词/参数 + 每段 guide 指令。
 * 插件内部串行执行并在段间自链 guide，每段完成即可查询（不需要项目侧逐段触发）。
 */
export async function submitComfyBatch(
  base: string,
  body: {
    clientJobId?: string;
    clientId?: string;
    runId?: string;
    models?: Record<string, string>;
    segments: ComfyBatchSegmentInput[];
  },
): Promise<string> {
  const data = await postJobPayload(base, { kind: "reference_video_batch", ...body });
  return data.jobId!;
}

export async function getComfyJob(base: string, jobId: string): Promise<ComfyJobStatus> {
  const res = await fetch(`${base}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new McpError("IO_ERROR", `作业查询失败 HTTP ${res.status}: ${jobId}`);
  return (await res.json()) as ComfyJobStatus;
}

export async function cancelComfyJob(base: string, jobId: string): Promise<void> {
  await fetch(`${base}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }).catch(() => undefined);
}

export async function uploadComfyImage(base: string, data: Buffer, filename: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(data)]), filename);
    form.append("overwrite", "true");
    const res = await fetch(`${base}/upload/image`, { method: "POST", body: form });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
    if (!body?.name) return null;
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  } catch {
    return null;
  }
}

/** 服务端绝对路径 → /view URL 的查询串（output 根下的相对路径） */
function viewQuery(outputPath: string): { filename: string; subfolder: string } | null {
  const m = /[\\/]output[\\/](.+)$/i.exec(outputPath ?? "");
  if (!m) return null;
  const rel = m[1]!.replace(/\\/g, "/");
  const slash = rel.lastIndexOf("/");
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const subfolder = slash >= 0 ? rel.slice(0, slash) : "";
  if (!filename) return null;
  return { filename, subfolder };
}

/** 下载产物（视频/图片）；云 ComfyUI 的绝对路径本机读不到，统一走 /view */
export async function downloadComfyOutput(base: string, outputPath: string): Promise<Buffer | null> {
  const q = viewQuery(outputPath);
  if (!q) return null;
  const qs = new URLSearchParams({ ...q, type: "output" }).toString();
  try {
    const res = await fetch(`${base}/view?${qs}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** 引导是否已在 ComfyUI 输出缓存里（账户制存储：换机器只要没删就还在）。
 *  给了 expectedSha256 时要求内容一致，避免「同名但被截断/替换」的坏缓存。
 *  返回 null = 探针不可用（旧插件 404/405、代理异常），此时不能断言缺失。 */
export async function comfyGuideExists(base: string, guideId: string, expectedSha256?: string | null): Promise<boolean | null> {
  try {
    const qs = expectedSha256 ? `?sha256=${encodeURIComponent(expectedSha256)}` : "";
    const res = await fetch(`${base}/zeroexo/v1/guides/${encodeURIComponent(guideId)}${qs}`, {
      signal: AbortSignal.timeout(expectedSha256 ? 60_000 : 10_000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; exists?: boolean } | null;
        if (body?.ok === true && body?.exists === false) return false; // 确证缺失
      }
      return null;
    }
    const body = (await res.json().catch(() => null)) as { exists?: boolean } | null;
    return body?.exists === true;
  } catch {
    return null;
  }
}

/** 把本地 media/guides 的引导推到 ComfyUI（双重兜底：缓存里没有才传）
 *  给了 expectedSha256 时：本地不一致直接拒绝上传（避免把错内容污染云端），上传后用云端返回的 sha 复核。 */
export async function pushGuideToComfy(base: string, guideId: string, expectedSha256?: string | null): Promise<boolean> {
  if (!/^gd_[A-Za-z0-9_-]{4,64}$/.test(guideId)) return false;
  const file = path.join(dataRoot(), "media", "guides", `${guideId}.safetensors`);
  let buf: Buffer;
  try {
    const s = await fs.stat(file);
    if (!s.size) return false;
    buf = await fs.readFile(file);
  } catch {
    return false;
  }
  if (expectedSha256) {
    const localSha = createHash("sha256").update(buf).digest("hex");
    if (localSha !== expectedSha256.toLowerCase()) {
      console.warn(`[guide] ${guideId} 本地内容与记录不一致（记录 ${expectedSha256.slice(0, 12)}… / 本地 ${localSha.slice(0, 12)}…），拒绝上传`);
      return false;
    }
  }
  try {
    const res = await fetch(`${base}/zeroexo/v1/guides/${encodeURIComponent(guideId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return false;
    if (expectedSha256) {
      const body = (await res.json().catch(() => null)) as { sha256?: string } | null;
      if (body?.sha256 && body.sha256 !== expectedSha256.toLowerCase()) {
        console.warn(`[guide] ${guideId} 上传后云端 sha 与记录不一致（云端 ${body.sha256.slice(0, 12)}…），视为失败`);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 提交前保证起始段引导在远端可用：先查云端 output 缓存（可用 sha256 校验内容），
 *  缺了/内容不符再从本地 media/guides 传上去；两边都没有返回 false（由调用方报人话）。 */
export async function ensureComfyGuide(base: string, guideId: string, expectedSha256?: string | null): Promise<boolean> {
  const exists = await comfyGuideExists(base, guideId, expectedSha256);
  // 探针不可用（旧插件/代理）时不能断言缺失：云端 output 可能是用户手动上传的，交给插件运行时判断
  if (exists !== false) return true;
  return pushGuideToComfy(base, guideId, expectedSha256);
}

/** guide safetensors 落到本地 media/guides，返回 `guide:<id>.safetensors`（跨重启仍可追溯） */
export async function cacheGuideFile(
  base: string,
  guide: { id?: string } | null | undefined,
): Promise<string | null> {
  if (!guide?.id || !/^gd_[A-Za-z0-9_-]{4,64}$/.test(guide.id)) return null;
  const dir = path.join(dataRoot(), "media", "guides");
  const file = path.join(dir, `${guide.id}.safetensors`);
  try {
    const s = await fs.stat(file);
    if (s.size > 0) return `guide:${guide.id}.safetensors`;
  } catch { /* 未缓存 */ }
  const qs = new URLSearchParams({
    filename: `${guide.id}.safetensors`,
    subfolder: "zeroexo/guides",
    type: "output",
  }).toString();
  try {
    const res = await fetch(`${base}/view?${qs}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, buf);
    return `guide:${guide.id}.safetensors`;
  } catch {
    return null;
  }
}

export function newClientId(): string {
  return `zxb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 数据 URL → { buf, mime }（预览帧落盘用） */
function parseDataUrl(dataUrl: string): { buf: Buffer; mime: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { mime: m[1]!, buf: Buffer.from(m[2]!.replace(/\s+/g, ""), "base64") };
  } catch {
    return null;
  }
}

const EXT_BY_MIME: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/**
 * 预览帧落盘：**按段**保留最后一帧（每段自己的预览，刷新后仍能看到）。
 * 文件名带段号 + 序号：同段旧帧清理，别的段绝不动。
 * 前端 resolveMediaUrl 按 key 缓存 objectURL，所以每帧用新文件名，避免同名覆盖显示旧帧。
 */
export async function savePreviewImage(
  projectId: string,
  taskId: string,
  segmentIndex: number,
  seq: number,
  dataUrl: string,
): Promise<{ storageKey: string; mime: string } | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || parsed.buf.length === 0) return null;
  const ext = EXT_BY_MIME[parsed.mime] ?? "webp";
  const dirRel = `assets/${projectId}/tasks`;
  const dirAbs = path.join(dataRoot(), dirRel);
  await fs.mkdir(dirAbs, { recursive: true });
  const prefix = `${taskId}-s${segmentIndex}-p`;
  const name = `${prefix}${seq}.${ext}`;
  await fs.writeFile(path.join(dirAbs, name), parsed.buf);
  // 保留本段已经发出的帧：前端收到 SSE 后还要异步 resolve 这个 key，
  // 立刻删旧帧会造成「只显示第一帧」（后续帧还没 fetch 就被下一帧删了）。
  return { storageKey: `image:${dirRel}/${name}`, mime: parsed.mime };
}

export interface PreviewHandlers {
  onFrame(frame: PreviewFrame): void;
}

interface RawWs {
  binaryType: string;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/**
 * ComfyUI /ws 预览客户端（Node 22+ 全局 WebSocket）。
 * 只做「拿最后一帧 + 步进」：不重连（作业内短生命周期），连接失败静默降级。
 */
export class ComfyPreviewSocket {
  private ws: RawWs | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly base: string,
    private readonly clientId: string,
    private readonly handlers: PreviewHandlers,
  ) {}

  connect(): void {
    if (this.closed) return;
    const Ctor = (globalThis as unknown as { WebSocket?: new (url: string) => RawWs }).WebSocket;
    if (!Ctor) return; // 运行环境没有 WebSocket：预览不可用但不阻断生成
    try {
      const url = new URL(this.base);
      const proto = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new Ctor(`${proto}//${url.host}/ws?clientId=${encodeURIComponent(this.clientId)}`);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => this.handle(ev.data);
      ws.onclose = () => {
        this.ws = null;
        // 云端/长时间作业的 WS 会被网关掐断；只要任务还在跑就自动重连，
        // 否则采样预览会在前几帧后永远停住。
        if (!this.closed && !this.retry) {
          this.retry = setTimeout(() => {
            this.retry = null;
            this.connect();
          }, 1000);
        }
      };
      ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
    } catch {
      this.ws = null;
    }
  }

  private handle(raw: unknown): void {
    if (this.closed) return;
    if (typeof raw !== "string") {
      this.handleBinary(raw);
      return;
    }
    let msg: { type?: unknown; data?: unknown };
    try { msg = JSON.parse(raw) as { type?: unknown; data?: unknown }; } catch { return; }
    const data = (msg.data ?? {}) as Record<string, unknown>;
    if (msg.type === "minimax_director_preview") {
      const b64 = typeof data.image_b64 === "string" ? data.image_b64 : "";
      const mime = typeof data.mime === "string" ? data.mime : "image/jpeg";
      this.handlers.onFrame({
        image: b64 ? `data:${mime};base64,${b64}` : null,
        step: typeof data.step === "number" ? data.step : null,
        totalSteps: typeof data.total_steps === "number" ? data.total_steps : null,
        segmentIndex: typeof data.segment_index === "number" ? data.segment_index + 1 : null,
      });
      return;
    }
    if (msg.type === "minimax_director_progress") {
      this.handlers.onFrame({
        image: null,
        step: typeof data.phase_value === "number" ? data.phase_value : null,
        totalSteps: typeof data.phase_max === "number" ? data.phase_max : null,
        segmentIndex: typeof data.segment === "number" ? data.segment : null,
      });
      return;
    }
    if (msg.type === "progress") {
      const value = typeof data.value === "number" ? data.value : null;
      const max = typeof data.max === "number" ? data.max : null;
      if (value !== null && max !== null && max > 0) {
        this.handlers.onFrame({ image: null, step: value, totalSteps: max, segmentIndex: null });
      }
    }
  }

  /** 二进制帧：4 字节事件类型（1=PREVIEW_IMAGE）+ 4 字节图片格式（1=jpeg 2=png）+ 图像字节 */
  private handleBinary(raw: unknown): void {
    let buf: ArrayBuffer | null = null;
    if (raw instanceof ArrayBuffer) buf = raw;
    else if (raw instanceof Uint8Array) buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    if (!buf || buf.byteLength <= 8) return;
    const view = new DataView(buf);
    if (view.getUint32(0) !== 1) return;
    const imageType = view.getUint32(4);
    const mime = imageType === 2 ? "image/png" : "image/jpeg";
    const b64 = Buffer.from(new Uint8Array(buf, 8)).toString("base64");
    this.handlers.onFrame({ image: `data:${mime};base64,${b64}`, step: null, totalSteps: null, segmentIndex: null });
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    try { this.ws?.close(); } catch { /* 已关闭 */ }
    this.ws = null;
  }
}
