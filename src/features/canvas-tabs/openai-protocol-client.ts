/**
 * openai-protocol-client — OpenAI 兼容协议 HTTP 客户端（图片/视频两路）
 *
 * 路由与请求字段全部取自 director-protocol-map（唯一参数映射表），本文件只做 HTTP 与鉴权：
 * - 鉴权：`Authorization: Bearer <apiKey>`（标准 OpenAI 协议）；
 * - 测试连接三分类失败（密钥/鉴权错、地址不可达、模型不存在），成功回显 /v1/models 清单；
 * - 视频作业生命周期：POST /v1/videos → GET /v1/videos/{id} 轮询 → DELETE 取消 → content 下载；
 * - 图片：POST /v1/images/generations（data[0].url 或 b64_json）。
 *
 * 地址不可达 vs CORS 拦截：与直连桥接同思路，先 no-cors 探测 TCP 层（probeTcp 复用自
 * comfyui-bridge-client，不另写第二份探测实现）。
 */

import { normalizeBaseUrl, probeTcp, readErrorBody } from './comfyui-bridge-client.js';
import {
  PROTOCOL_ROUTES,
  buildProtocolImageRequest,
  buildProtocolVideoRequest,
  mapProtocolJobToBridgeStatus,
  protocolRoute,
  type BuildProtocolRequestArgs,
  type ProtocolImageRequest,
  type ProtocolVideoJob,
  type ProtocolVideoRequest,
} from './director-protocol-map.js';
import type { BridgeJobStatus } from './comfyui-bridge-client.js';

// ===== 渠道凭据 =====

export interface OpenaiChannelCredentials {
  baseURL: string;
  apiKey: string;
  model: string;
}

function authHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

// ===== 测试连接（三分类失败 + 模型回显） =====

export type OpenaiTestFailureKind = 'unreachable' | 'auth' | 'model-not-found' | 'http-error' | 'bad-json';

export type OpenaiTestResult =
  | { kind: 'ok'; models: string[] }
  | { kind: 'fail'; failure: OpenaiTestFailureKind; message: string; models?: string[] };

/**
 * 测试连接（只读，不触发任何生成）：
 * 1) no-cors 探测 TCP 层 → 失败 = 地址不可达（unreachable）；
 * 2) GET /v1/models：401/403 = 密钥/鉴权错（auth）；
 * 3) 模型标识不在清单内 = 模型不存在（model-not-found，附清单便于重选）；
 * 4) 成功 → 回显可用模型清单（ok.models）。
 */
export async function testOpenaiConnection(
  channel: Pick<OpenaiChannelCredentials, 'baseURL' | 'apiKey'> & { model?: string },
): Promise<OpenaiTestResult> {
  const base = normalizeBaseUrl(channel.baseURL);
  try {
    await probeTcp(base);
  } catch {
    return {
      kind: 'fail',
      failure: 'unreachable',
      message: `地址不可达：${base}（检查服务是否启动、地址是否正确）`,
    };
  }
  let res: Response;
  try {
    res = await fetch(`${base}${PROTOCOL_ROUTES.models}`, { headers: authHeaders(channel.apiKey) });
  } catch {
    return {
      kind: 'fail',
      failure: 'unreachable',
      message: `已连上 ${base}，但跨域请求被拦截（CORS）。走本机直连需服务端放行跨域；走中转渠道则无此限制`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      kind: 'fail',
      failure: 'auth',
      message: `密钥/鉴权错误：API Key 无效或无权限（HTTP ${res.status}）`,
    };
  }
  if (!res.ok) {
    return { kind: 'fail', failure: 'http-error', message: `连接失败：${await readErrorBody(res)}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'fail', failure: 'bad-json', message: `${base}${PROTOCOL_ROUTES.models} 返回了无法解析的内容` };
  }
  const raw = body as { data?: Array<{ id?: unknown }> };
  const models = Array.isArray(raw.data)
    ? raw.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
    : [];
  if (channel.model && models.length > 0 && !models.includes(channel.model)) {
    return {
      kind: 'fail',
      failure: 'model-not-found',
      message: `模型不存在：${channel.model} 不在可用清单中，请从清单重选`,
      models,
    };
  }
  return { kind: 'ok', models };
}

// ===== 视频作业生命周期 =====

/** POST /v1/videos：发起作业（request.model 由本函数注入渠道 model，映射表不关心渠道） */
export async function startProtocolVideoJob(
  channel: OpenaiChannelCredentials,
  request: ProtocolVideoRequest,
): Promise<{ jobId: string }> {
  const base = normalizeBaseUrl(channel.baseURL);
  const res = await fetch(`${base}${PROTOCOL_ROUTES.videoCreate}`, {
    method: 'POST',
    headers: authHeaders(channel.apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...request, model: channel.model }),
  });
  const body = (await res.json().catch(() => null)) as ({ id?: unknown; error?: unknown } | null);
  if (!res.ok || !body || typeof body.id !== 'string') throw new Error(await readErrorBody(res));
  return { jobId: body.id };
}

/** GET /v1/videos/{id} → BridgeJobStatus（映射唯一实现在 director-protocol-map） */
export async function fetchProtocolVideoStatus(
  channel: OpenaiChannelCredentials,
  jobId: string,
  segmentCount: number,
): Promise<BridgeJobStatus> {
  const base = normalizeBaseUrl(channel.baseURL);
  const res = await fetch(`${base}${protocolRoute(PROTOCOL_ROUTES.videoStatus, jobId)}`, {
    headers: authHeaders(channel.apiKey),
  });
  if (!res.ok) throw new Error(await readErrorBody(res));
  const job = (await res.json()) as ProtocolVideoJob;
  return mapProtocolJobToBridgeStatus(job, segmentCount);
}

/** DELETE /v1/videos/{id}：取消（失败不阻断本地置 canceled，与直连取消同语义） */
export async function cancelProtocolVideoJob(channel: OpenaiChannelCredentials, jobId: string): Promise<void> {
  const base = normalizeBaseUrl(channel.baseURL);
  const res = await fetch(`${base}${protocolRoute(PROTOCOL_ROUTES.videoCancel, jobId)}`, {
    method: 'DELETE',
    headers: authHeaders(channel.apiKey),
  });
  if (!res.ok && res.status !== 404) throw new Error(await readErrorBody(res));
}

/** GET {base}{downloadUrl}：下载段视频为 Blob（downloadUrl 来自状态映射：content 路由或中转 download_url） */
export async function downloadProtocolVideo(channel: OpenaiChannelCredentials, downloadUrl: string): Promise<Blob> {
  const base = normalizeBaseUrl(channel.baseURL);
  const url = downloadUrl.startsWith('http') ? downloadUrl : `${base}${downloadUrl}`;
  const res = await fetch(url, { headers: authHeaders(channel.apiKey) });
  if (!res.ok) throw new Error(`段视频下载失败：HTTP ${res.status} ${url}`);
  return res.blob();
}

// ===== 组装入口（导演台 → 协议请求 → 作业；供 use-director-run 调用） =====

/** 构建协议请求并发起视频作业；返回 jobId + 段映射（媒体内联，无 zip 上传环节） */
export async function startProtocolDirectorRun(
  channel: OpenaiChannelCredentials,
  args: BuildProtocolRequestArgs,
): Promise<{ jobId: string; segmentShotIds: string[]; totalFrames: number; warnings: string[] }> {
  const built = await buildProtocolVideoRequest(args);
  const started = await startProtocolVideoJob(channel, built.request);
  return { jobId: started.jobId, segmentShotIds: built.segmentShotIds, totalFrames: built.totalFrames, warnings: built.warnings };
}

// ===== 图片路 =====

export interface ProtocolImageResult {
  /** base64 dataURL（b64_json 路径）或远程 url（url 路径），均直接可给 <img src> */
  src: string;
}

/** POST /v1/images/generations（data[0].url 优先，回落 b64_json） */
export async function generateProtocolImage(
  channel: OpenaiChannelCredentials,
  imageModel: string,
  args: Omit<Parameters<typeof buildProtocolImageRequest>[0], 'model'>,
): Promise<ProtocolImageResult> {
  const base = normalizeBaseUrl(channel.baseURL);
  const request: ProtocolImageRequest = buildProtocolImageRequest({ ...args, model: imageModel });
  const res = await fetch(`${base}${PROTOCOL_ROUTES.imageGenerations}`, {
    method: 'POST',
    headers: authHeaders(channel.apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await readErrorBody(res));
  const body = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
  const item = body.data?.[0];
  if (item?.url) return { src: item.url };
  if (item?.b64_json) return { src: `data:image/png;base64,${item.b64_json}` };
  throw new Error('图片响应中既无 url 也无 b64_json');
}
