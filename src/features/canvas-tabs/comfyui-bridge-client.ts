/**
 * comfyui-bridge-client — ComfyUI ⇄ 导演台桥接 HTTP 客户端（契约：docs 侧 h3-bridge-contract.md，bridge 0.1.0）
 *
 * 纯 fetch 封装，无 React 依赖；所有路由按契约拼 comfyuiBaseUrl：
 * - 连通探测：GET {base}/system_stats（ComfyUI 原生端点；测试连接用）
 * - 桥接健康：GET {base}/zeroexo/h3/health
 * - 模型清单：GET {base}/zeroexo/h3/models
 * - 上传导演包：POST {base}/zeroexo/h3/pack（multipart 字段 pack = zip）
 * - 发起运行：POST {base}/zeroexo/h3/run
 * - 轮询状态：GET {base}/zeroexo/h3/status?jobId=
 * - 取消：POST {base}/zeroexo/h3/cancel {jobId}
 * - 引导帧：GET {base}/zeroexo/h3/guidance?jobId=&segment=N（404 = 未就绪，返回 null 不抛）
 * - 下载段视频：GET {base}{downloadUrl}（downloadUrl 为契约返回的相对路径）
 *
 * 可选 bridgeToken：所有桥接请求带 X-ZeroExo-Token 头。
 *
 * 测试连接三分类（浏览器侧 CORS 拦截与连接拒绝同为 TypeError: Failed to fetch，
 * 无法从异常本身区分——先用 no-cors 探测 TCP 层再发真实请求，见 testConnection）：
 * - 'refused'  服务未启动（TCP 连不上）
 * - 'cors'     服务在但跨域被拦（需 --enable-cors-header）
 * - 'not-comfyui' 地址通但 /system_stats 404（不是 ComfyUI）
 */

// ===== 配置与工具 =====

export const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188';

/** 规范化地址：补协议、去尾斜杠 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return DEFAULT_COMFYUI_BASE_URL;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

function bridgeHeaders(token?: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers['X-ZeroExo-Token'] = token;
  return headers;
}

export async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    // 契约：400/500 的 body 是 {ok:false, error / upstream} JSON；透传可读字段
    try {
      const parsed = JSON.parse(text) as { error?: unknown; upstream?: unknown };
      if (parsed.upstream !== undefined) return `HTTP ${res.status}: ${JSON.stringify(parsed.upstream)}`;
      if (typeof parsed.error === 'string') return `HTTP ${res.status}: ${parsed.error}`;
    } catch { /* 非 JSON 原样截断 */ }
    return `HTTP ${res.status}: ${text.slice(0, 500)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// ===== 契约类型 =====

export interface ComfySystemStats {
  ok: boolean;
  /** ComfyUI 版本（system.comfyui_version） */
  version?: string;
  /** 设备摘要（如 "NVIDIA GeForce RTX 4090 · 24.0GB VRAM"） */
  deviceLabel?: string;
  /** 原始响应（调试/UI 透出用） */
  raw?: unknown;
}

export interface BridgeHealth {
  ok: boolean;
  version?: string;
  queue?: { running?: number; pending?: number };
  upstream?: { importPackRoute?: string };
}

/** GET /zeroexo/h3/models 返回（契约 §1） */
export interface BridgeModelsResponse {
  ok: boolean;
  unet: string[];
  vae: string[];
  clip: string[];
  clipTypes: string[];
}

/** POST /run 的 models 块（契约 §2.2） */
export interface BridgeRunModels {
  unet: string;
  videoVae: string;
  audioVae: string;
  clip: string;
  clipType: string;
  weightDtype: string;
}

export interface BridgeRunOverrides {
  taskType: string;
  steps: number;
  seed: number;
  cfg: number;
  width: number;
  height: number;
  totalFrames: number;
  frameRate: number;
  sampler: string;
  scheduler: string;
  /** 0 基段索引数组（续跑开关；缺省 = 全部采样） */
  runSelection?: number[];
}

export interface BridgeRunRequest {
  packId: string;
  projectId: string;
  episode: string;
  models: BridgeRunModels;
  overrides: BridgeRunOverrides;
  /** 前端 /ws clientId：桥接透传给 POST /prompt 的 client_id，H3 节点实时预览帧定向发回本端 */
  clientId?: string;
}

export interface BridgeRunStartResult {
  ok: boolean;
  jobId: string;
  number?: number;
  state?: string;
  segments?: { total: number; frames: number[] };
  outputDir?: string;
  cacheDir?: string;
}

export interface BridgeJobSegment {
  index: number;
  state: 'pending' | 'writing' | 'done';
  frames: number;
  outputPath: string | null;
  downloadUrl: string | null;
}

export interface BridgeJobStatus {
  ok: boolean;
  jobId: string;
  state: 'queued' | 'running' | 'success' | 'error' | 'canceled';
  currentSegment: number | null;
  progress: { done: number; total: number };
  segments: BridgeJobSegment[];
  error?: string;
}

export interface BridgeCancelResult {
  ok: boolean;
  jobId: string;
  interrupted?: boolean;
  dequeued?: boolean;
}

export interface BridgeGuidance {
  ok: boolean;
  segment: number;
  sourceSegment: number;
  frames: number;
  totalFrames: number;
  width: number;
  height: number;
  format: string;
  /** data:image/webp;base64,… 动画（直接 <img src>） */
  image: string;
}

export interface BridgePackUploadResult {
  ok: boolean;
  packId: string;
  segmentCount?: number;
  missing?: string[];
}

// ===== 连接探测（三分类） =====

export type ConnectionFailureKind = 'refused' | 'cors' | 'not-comfyui' | 'http-error' | 'bad-json';

export type ConnectionTestResult =
  | { kind: 'ok'; stats: ComfySystemStats; health: BridgeHealth | null }
  | { kind: 'fail'; failure: ConnectionFailureKind; message: string };

/** no-cors TCP 探测：能连上 → resolve；连不上/超时 → reject（用于区分 连接拒绝 vs CORS；openai-protocol-client 复用） */
export async function probeTcp(baseUrl: string, timeoutMs = 6000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // no-cors 拿 opaque 响应：只要 TCP+HTTP 层可达就 resolve（无论状态码）
    await fetch(`${baseUrl}/favicon.ico`, { mode: 'no-cors', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试连接（只读，不触发任何生成）：
 * 1) no-cors 探测 TCP 层 → 失败 = 服务未启动（refused）；
 * 2) GET /system_stats → TypeError = CORS 被拦（cors）；404 = 不是 ComfyUI（not-comfyui）；
 * 3) 200 → 解析版本/设备；顺带探测桥接 /health（失败不致命，health 为 null）。
 */
export async function testConnection(baseUrl: string, token?: string): Promise<ConnectionTestResult> {
  const base = normalizeBaseUrl(baseUrl);
  try {
    await probeTcp(base);
  } catch {
    return {
      kind: 'fail',
      failure: 'refused',
      message: `无法连接 ${base}：服务未启动或地址不可达（ERR_CONNECTION_REFUSED）`,
    };
  }
  let res: Response;
  try {
    res = await fetch(`${base}/system_stats`, { headers: bridgeHeaders(token) });
  } catch {
    return {
      kind: 'fail',
      failure: 'cors',
      message: `跨域被拒：已连上 ${base}，但 ComfyUI 未启用 CORS，带 Origin 的请求被 origin-only 中间件返回 403（浏览器 fetch 因此失败）。请在启动参数加 --enable-cors-header '*' 后重启；桥接插件 CORS 仅覆盖 /zeroexo/h3/*`,
    };
  }
  if (res.status === 404) {
    return {
      kind: 'fail',
      failure: 'not-comfyui',
      message: `${base} 有响应但 /system_stats 返回 404：该地址不是 ComfyUI 服务`,
    };
  }
  if (!res.ok) {
    return { kind: 'fail', failure: 'http-error', message: `连接失败：HTTP ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'fail', failure: 'bad-json', message: `${base}/system_stats 返回了无法解析的内容` };
  }
  const raw = body as {
    system?: { comfyui_version?: string };
    devices?: Array<{ name?: string; type?: string; vram_total?: number }>;
  };
  const dev = raw.devices?.find((d) => d.type === 'cuda') ?? raw.devices?.[0];
  const vramGb = dev && typeof dev.vram_total === 'number' ? (dev.vram_total / 1024 ** 3).toFixed(1) : null;
  const stats: ComfySystemStats = {
    ok: true,
    version: raw.system?.comfyui_version,
    deviceLabel: dev?.name ? `${dev.name}${vramGb ? ` · ${vramGb}GB VRAM` : ''}` : undefined,
    raw: body,
  };
  let health: BridgeHealth | null = null;
  try {
    const hRes = await fetch(`${base}/zeroexo/h3/health`, { headers: bridgeHeaders(token) });
    if (hRes.ok) health = (await hRes.json()) as BridgeHealth;
  } catch { /* 桥接未装/未开 CORS：不阻塞连接判定（以 /pack 实际调用为准，契约 §1） */ }
  return { kind: 'ok', stats, health };
}

// ===== 桥接 API =====

/** GET /zeroexo/h3/models（连接后拉清单） */
export async function fetchBridgeModels(baseUrl: string, token?: string): Promise<BridgeModelsResponse> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/zeroexo/h3/models`, { headers: bridgeHeaders(token) });
  if (!res.ok) throw new Error(await readErrorBody(res));
  return (await res.json()) as BridgeModelsResponse;
}

/** POST /zeroexo/h3/pack：上传导演包 zip（multipart 字段 pack），返回 packId */
export async function uploadBridgePack(baseUrl: string, packZip: Blob, token?: string): Promise<BridgePackUploadResult> {
  const form = new FormData();
  form.append('pack', packZip, 'director.mmxpack.zip');
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/zeroexo/h3/pack`, {
    method: 'POST',
    headers: bridgeHeaders(token),
    body: form,
  });
  const body = (await res.json().catch(() => null)) as BridgePackUploadResult | null;
  if (!res.ok || !body) throw new Error(await readErrorBody(res));
  if (!body.ok) {
    const missing = body.missing?.length ? `（缺失媒体：${body.missing.join(', ')}）` : '';
    throw new Error(`导演包被拒绝${missing}`);
  }
  return body;
}

/** POST /zeroexo/h3/run：发起运行，返回 jobId（= ComfyUI prompt_id） */
export async function startBridgeRun(baseUrl: string, req: BridgeRunRequest, token?: string): Promise<BridgeRunStartResult> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/zeroexo/h3/run`, {
    method: 'POST',
    headers: bridgeHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => null)) as BridgeRunStartResult | null;
  if (!res.ok || !body) throw new Error(await readErrorBody(res));
  if (!body.ok) throw new Error(`运行请求被拒绝：HTTP ${res.status}`);
  return body;
}

/** GET /zeroexo/h3/status?jobId=：轮询作业状态 */
export async function fetchBridgeStatus(baseUrl: string, jobId: string, token?: string): Promise<BridgeJobStatus> {
  const res = await fetch(
    `${normalizeBaseUrl(baseUrl)}/zeroexo/h3/status?jobId=${encodeURIComponent(jobId)}`,
    { headers: bridgeHeaders(token) },
  );
  if (!res.ok) throw new Error(await readErrorBody(res));
  return (await res.json()) as BridgeJobStatus;
}

/** POST /zeroexo/h3/cancel {jobId} */
export async function cancelBridgeJob(baseUrl: string, jobId: string, token?: string): Promise<BridgeCancelResult> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/zeroexo/h3/cancel`, {
    method: 'POST',
    headers: bridgeHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ jobId }),
  });
  const body = (await res.json().catch(() => null)) as BridgeCancelResult | null;
  if (!res.ok || !body) throw new Error(await readErrorBody(res));
  return body;
}

/**
 * GET /zeroexo/h3/guidance?jobId=&segment=N（1 基，≥2）：
 * 404（引导缓存未就绪）→ null（UI 标「引导未就绪」，不报错）；其余失败抛错。
 */
export async function fetchBridgeGuidance(
  baseUrl: string,
  jobId: string,
  segment: number,
  token?: string,
): Promise<BridgeGuidance | null> {
  const res = await fetch(
    `${normalizeBaseUrl(baseUrl)}/zeroexo/h3/guidance?jobId=${encodeURIComponent(jobId)}&segment=${segment}`,
    { headers: bridgeHeaders(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readErrorBody(res));
  const body = (await res.json()) as BridgeGuidance;
  return body.ok ? body : null;
}

/** GET /zeroexo/h3/last-prompt：最近一次提交给 ComfyUI 的完整 prompt JSON（可复制/下载） */
export interface BridgeLastPrompt {
  ok: boolean;
  jobId?: string;
  promptId?: string;
  assembledAt?: number;
  assembledAtIso?: string;
  /** 组装该图的源码文件（桥接无外部工作流模板，图由 graph_build.py 代码组装） */
  template?: string;
  nodeSummary?: Array<{ id: string; classType: string }>;
  prompt?: Record<string, unknown>;
}

export async function fetchBridgeLastPrompt(
  baseUrl: string,
  jobId?: string | null,
  token?: string,
): Promise<BridgeLastPrompt> {
  const qs = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/zeroexo/h3/last-prompt${qs}`, {
    headers: bridgeHeaders(token),
  });
  if (!res.ok) throw new Error(await readErrorBody(res));
  return (await res.json()) as BridgeLastPrompt;
}

/** GET {base}{downloadUrl}：下载段视频为 Blob（downloadUrl = status 里的相对路径） */
export async function downloadBridgeSegment(baseUrl: string, downloadUrl: string, token?: string): Promise<Blob> {
  const url = downloadUrl.startsWith('http') ? downloadUrl : `${normalizeBaseUrl(baseUrl)}${downloadUrl}`;
  const res = await fetch(url, { headers: bridgeHeaders(token) });
  if (!res.ok) throw new Error(`段视频下载失败：HTTP ${res.status} ${url}`);
  return res.blob();
}
