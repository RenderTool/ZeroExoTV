/**
 * ComfyUI 插件任务客户端（网页直连插件，不经过 MCP）。
 *
 * 插件是任务事实源：提交后即使关网页/关 MCP，插件仍继续执行；
 * 网页重开按 projectId 拉任务列表，把已完成段补落库。
 */
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';
import type { PluginBatchPayload } from '@/features/canvas-tabs/director-plugin-payload.js';
import { readCachedGuideBlob } from '@/entities/guide-store.js';
import { sha256Hex } from '@/entities/cas-store.js';

export type PluginTaskState = 'queued' | 'running' | 'success' | 'error' | 'cancelled' | 'interrupted';

export interface PluginTaskSegment {
  index: number;
  shotId?: string;
  state: PluginTaskState;
  prompt?: string;
  params?: Record<string, unknown>;
  guide?: { mode: 'initial' | 'chain' | 'none'; id?: string; path?: string; frames?: number; sha256?: string };
  progress?: { step: number; totalSteps: number };
  previewPath?: string;
  outputs?: Array<{ kind?: string; path?: string }>;
  error?: string | null;
}

export interface PluginTask {
  taskId: string;
  jobId?: string;
  projectId?: string;
  kind?: string;
  state: PluginTaskState;
  title?: string;
  currentSegment?: number | null;
  doneCount?: number;
  totalCount?: number;
  createdAt?: string;
  updatedAt?: string;
  error?: string | null;
  /** 插件子任务的 /ws clientId（重开网页时重连预览用） */
  clientId?: string;
  segments: PluginTaskSegment[];
}

export function pluginTaskBase(): string | null {
  const address = useComfyuiEndpointStore.getState().address;
  if (!address) return null;
  return address.replace(/\/+$/, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = pluginTaskBase();
  if (!base) throw new Error('未配置 ComfyUI 地址');
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as T & { ok?: boolean; error?: string };
  if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

/**
 * 双重兜底（2026-11-19 用户拍板）：云端输出是账户制存储，机器换了只要没删引导就还在。
 * 提交前先查 ComfyUI 自己的 output/zeroexo/guides/<id>.safetensors；确证缺失才补传。
 *
 * 2026-11-20 修正（云端实测）：waas 上插件常常只有读、没有写（POST 405），
 * 且云端 output 里的文件是用户手动上传的，接口探不到不代表文件不存在。
 * 因此探不到一律按「云端可能已有」放行，绝不因探针失败卡住整批提交；
 * 只有「接口明确回 exists:false 且补传失败」才提示用户手动放置。
 */
export interface PluginSubmitResult {
  task: PluginTask;
  /** 需要用户知道的引导问题（明确缺失且没能补传时才产生） */
  warnings: string[];
}

const GUIDE_ROUTE_MISSING = new Set([404, 405, 501]);

function withTimeout(ms: number): AbortSignal {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(ms)
    : new AbortController().signal;
}

/** 结果分两类：conflict 必须中止提交（绝不允许拿错内容送进去），其余只提示 */
type GuideCheck = { level: 'ok' } | { level: 'warn'; reason: string } | { level: 'conflict'; message: string };

const localShaCache = new Map<string, { size: number; sha: string }>();

async function localGuideSha(id: string, blob: Blob): Promise<string> {
  const cached = localShaCache.get(id);
  if (cached && cached.size === blob.size) return cached.sha;
  const sha = await sha256Hex(blob);
  localShaCache.set(id, { size: blob.size, sha });
  return sha;
}

async function ensureGuideOnComfy(base: string, id: string, wantSha?: string): Promise<GuideCheck> {
  const url = `${base}/zeroexo/v1/guides/${encodeURIComponent(id)}`;
  const blob = await readCachedGuideBlob({ id }).catch(() => null);
  // 老记录没存 sha 时不能「按 id 就认」：拿本地这份的哈希当基准去核云端，
  // 两边不一致同样按冲突中止（宁可停，也不让错引导进链）。
  let expected = wantSha ?? null;
  let legacyDerived = false;
  if (!expected && blob?.size) {
    expected = await localGuideSha(id, blob);
    legacyDerived = true;
  }

  let cloudSha: string | null = null;
  try {
    const qs = expected ? `?sha256=${encodeURIComponent(expected)}` : '';
    const head = await fetch(`${url}${qs}`, { method: 'GET', signal: withTimeout(expected ? 60_000 : 8_000) });
    if (head.ok) {
      const body = await head.json().catch(() => null) as
        | { exists?: boolean; match?: boolean; sha256?: string; bytes?: number }
        | null;
      cloudSha = body?.sha256 ?? null;
      if (body?.exists !== false && (expected ? body?.match === true : true)) return { level: 'ok' };
      if (legacyDerived && expected) {
        return {
          level: 'conflict',
          message: `引导 ${id} 云端与本地同名但内容不同（云端 ${cloudSha ? `${cloudSha.slice(0, 12)}…` : '无哈希'}/${body?.bytes ?? '?'}B，本地 ${expected.slice(0, 12)}…/${blob!.size}B）；`
            + '记录里没有该引导的 sha256，无法判定哪份正确，已阻止提交。请重新生成该段，或人工确认后用正确的那份覆盖',
        };
      }
      // 记录有 sha：云端同 id 内容不符（或明确没有）→ 落到下面用记录那份覆盖
    } else if (head.status === 404) {
      const body = await head.json().catch(() => null) as { ok?: boolean; exists?: boolean } | null;
      // 只有 0.1.1+ 的 {ok:true, exists:false} 才算「确证缺失」；其它 404 视为探针不可用 → 交给执行校验
      if (!(body?.ok === true && body?.exists === false)) return { level: 'ok' };
    } else {
      return { level: 'ok' }; // 探针异常（代理/旧插件/500）→ 交给插件执行时校验
    }
  } catch {
    return { level: 'ok' }; // 超时/网络问题不阻塞生成
  }

  if (!blob || !blob.size) {
    if (!expected) return { level: 'warn', reason: 'local-missing' };
    // 记录里有 sha 但本地没有副本：云端又对不上，无法自证 → 中止
    return {
      level: 'conflict',
      message: `引导 ${id} 云端内容与记录不一致（期望 ${expected.slice(0, 12)}…，云端 ${cloudSha ? `${cloudSha.slice(0, 12)}…` : '无哈希'}），本地也没有副本可校验；已阻止提交，请重新生成该段或换回正确引导`,
    };
  }

  if (expected) {
    const localSha = await localGuideSha(id, blob);
    if (localSha !== expected) {
      // 本地缓存本身就不是记录里那份 → 上传只会污染云端，直接中止
      return {
        level: 'conflict',
        message: `引导 ${id} 内容与记录不符（记录 ${expected.slice(0, 12)}… / 本地 ${localSha.slice(0, 12)}… / 云端 ${cloudSha ? (cloudSha === expected ? '一致' : `${cloudSha.slice(0, 12)}…`) : '无'}），已阻止提交；请确认哪一份正确后再生成`,
      };
    }
  }

  try {
    const form = new FormData();
    form.append('file', blob, `${id}.safetensors`);
    const res = await fetch(url, { method: 'POST', body: form, signal: withTimeout(90_000) });
    if (!res.ok) {
      if (GUIDE_ROUTE_MISSING.has(res.status)) return { level: 'warn', reason: `route:${res.status}` };
      if (res.status === 413) return { level: 'warn', reason: `large:${Math.round(blob.size / 1024 / 1024)}` };
      return { level: 'warn', reason: `http:${res.status}` };
    }
    if (expected) {
      const body = await res.json().catch(() => null) as { sha256?: string } | null;
      if (body?.sha256 && body.sha256 !== expected) {
        return {
          level: 'conflict',
          message: `引导 ${id} 上传后云端内容仍与记录不一致（云端 ${body.sha256.slice(0, 12)}… / 记录 ${expected.slice(0, 12)}…），已阻止提交`,
        };
      }
    }
    return { level: 'ok' };
  } catch {
    return { level: 'warn', reason: 'unreachable' };
  }
}

function guideWarning(id: string, reason: string): string {
  const manual = `本地 <数据根>/media/guides/${id}.safetensors 需放到云端 ComfyUI/output/zeroexo/guides`;
  if (reason.startsWith('route:')) {
    return `云端插件没有引导写入接口（HTTP ${reason.slice(6)}），且查询确认云端没有 ${id}；${manual}（或升级 ComfyUI_ZeroExoNodes 0.1.2）`;
  }
  if (reason.startsWith('large:')) {
    return `网关拒收引导体积 ${reason.slice(6)}MB，且云端没有 ${id}；${manual}`;
  }
  if (reason === 'local-missing') {
    return `云端与本地都没有引导 ${id}；先在项目侧重新生成该引导，或把该段改成无引导`;
  }
  if (reason === 'unreachable') {
    return `引导 ${id} 补传时 ComfyUI 无响应；${manual}`;
  }
  return `引导 ${id} 补传失败（${reason}）；${manual}`;
}

async function ensureGuidesOnComfy(base: string, payload: PluginBatchPayload): Promise<string[]> {
  // 同一 id 若出现多个 sha（历史脏数据）→ 直接判冲突，绝不挑一个用
  const wanted = new Map<string, string | undefined>();
  const conflictIds = new Set<string>();
  for (const seg of payload.segments ?? []) {
    if (seg.guide?.mode !== 'initial' || !seg.guide.id) continue;
    const id = seg.guide.id;
    const sha = seg.guide.sha256;
    if (!wanted.has(id)) wanted.set(id, sha);
    else if (wanted.get(id) !== sha) conflictIds.add(id);
  }
  if (conflictIds.size) {
    throw new Error(
      `同一引导 id 在批次里对应了不同内容（${[...conflictIds].join('、')}），已阻止提交；请刷新分镜后重试`,
    );
  }
  if (wanted.size === 0) return [];

  const results = await Promise.all(
    [...wanted.entries()].map(async ([id, sha]) => ({ id, check: await ensureGuideOnComfy(base, id, sha) })),
  );
  const conflicts = results.filter((r) => r.check.level === 'conflict');
  if (conflicts.length) {
    throw new Error(
      (conflicts[0]!.check as { message: string }).message
      + (conflicts.length > 1 ? `（另有 ${conflicts.length - 1} 条同类冲突）` : ''),
    );
  }
  return results.filter((r) => r.check.level === 'warn').map((r) => guideWarning(r.id, (r.check as { reason: string }).reason));
}

export async function submitPluginTask(payload: PluginBatchPayload): Promise<PluginSubmitResult> {
  const base = pluginTaskBase();
  if (!base) throw new Error('未配置 ComfyUI 地址');
  const warnings = await ensureGuidesOnComfy(base, payload);
  const created = await request<{ jobId: string }>('/zeroexo/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { task: await getPluginTask(created.jobId), warnings };
}

export async function getPluginTask(taskId: string): Promise<PluginTask> {
  const res = await request<{ task: PluginTask }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}`);
  return res.task;
}

export async function listPluginTasks(projectId: string): Promise<PluginTask[]> {
  const res = await request<{ tasks: PluginTask[] }>(`/zeroexo/v1/tasks?projectId=${encodeURIComponent(projectId)}`);
  return Array.isArray(res.tasks) ? res.tasks : [];
}

export async function cancelPluginTask(taskId: string): Promise<PluginTask> {
  const res = await request<{ task: PluginTask }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
  return res.task;
}

/** 真删插件任务事实源（清空已完成用）：只删展示层刷新必复活，必须连插件侧 JSON 一起删 */
export async function deletePluginTask(taskId: string): Promise<void> {
  await request<{ deleted: boolean }>(`/zeroexo/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}
