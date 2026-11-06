/**
 * api-client —— 本地版（Plan#83 剥离改造 + 2026-11-02 全量本地化）
 *
 * 原实现是 NestJS REST 客户端（JWT + 429 退避 + presign）。本版本**没有任何后端**，
 * 但**保留完全相同的导出面**（调用点零改动），每个端点都有本地实现：
 * 1) 渠道/模板/文件夹 → 本地数据目录（settings.json / templates.json）
 * 2) 剧本/文本资源 → 直接写本地素材库与数据目录
 * 3) 项目 → 本地 project-store（localforage）
 * 4) 真正无本地等价物的（内置 LLM 思考链路等）→ 抛 LocalUnsupportedError，
 *    错误信息里带 path，便于定位。
 */

import { loadChannels } from '@/platform/settings.js';
import { readJson, writeFile, writeJson } from '@/platform/fs.js';
import { listProjects, getProject, createProject, updateProject, deleteProject } from '@zeroexo/plugin-persistence';
import { uploadImage, uploadMediaFile } from '@zeroexo/plugin-persistence';
import { nanoid } from 'nanoid';

export function getApiBaseUrl(): string {
  return '';
}

/** 本地版无鉴权：token 恒为 null（调用点用它拼 Authorization，这里直接短路） */
export function getToken(): string | null {
  return null;
}

export function setAccessToken(_token: string | null): void {
  /* no-op */
}

export function setRefreshFn(_fn: (() => Promise<string | null>) | null): void {
  /* no-op */
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 仍指向后端的调用会撞上这个错：错误信息里的 path 就是待迁移清单 */
export class LocalUnsupportedError extends ApiError {
  constructor(public readonly path: string) {
    super(501, 'LOCAL_UNSUPPORTED', `本地版无此接口，请迁移：${path}`);
    this.name = 'LocalUnsupportedError';
  }
}

/** 解析请求体（本地实现：请求体一律 JSON） */
function parseBody<T>(init?: RequestInit): T | undefined {
  const raw = init?.body;
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * 已本地化的读路径。key 用「去 query 后的前缀」匹配。
 * 新增覆盖时务必同步改 Plan#83 的迁移清单。
 */
async function serveLocal<T>(path: string, init?: RequestInit): Promise<T> {
  const clean = path.split('?')[0] ?? path;
  const method = (init?.method ?? 'GET').toUpperCase();

  // 渠道列表（生成 dock / 参数面板）→ <dataRoot>/settings.json
  if (clean.startsWith('/api-providers') || clean.endsWith('/channels')) {
    const channels = await loadChannels();
    // 本地版：后端 /ai/channels 的返回形状（items）+ 直连渠道（channels）
    const items = channels.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider ?? '',
      baseUrl: c.baseUrl,
      enabled: true,
      isDefault: false,
      apiFormat: c.apiFormat,
      apiKey: c.apiKey ?? '',
      modelIcons: c.modelIcons ?? {},
      models: c.modelConfigs ?? [],
    }));
    return { channels, items } as unknown as T;
  }

  // 模型参数模板 → <dataRoot>/templates.json（缺失即空数组，UI 自然降级为手填参数）
  if (clean.startsWith('/ai/templates')) {
    return ((await readJson<T[]>('templates.json')) ?? ([] as unknown as T[])) as T;
  }

  // 资产文件夹（本地版=目录约定，不再需要云端文件夹表）
  if (clean.startsWith('/folders')) {
    return [] as unknown as T;
  }

  // 公共提示词 / 提示词库：模块已整体卸载 → 返回空列表
  if (clean.startsWith('/public/prompts')) {
    return { items: [], total: 0, nextCursor: null } as unknown as T;
  }

  // 剧本资源：本地直接建素材库资产（kind='script'）
  if (clean === '/resources/scripts') {
    const body = parseBody<{ filename?: string; text?: string; tags?: string[] }>(init);
    const filename = body?.filename?.trim() || '剧本';
    const content = body?.text ?? '';
    const episodes = (() => {
      try {
        const parsed = JSON.parse(content);
        const list = Array.isArray(parsed) ? parsed : (parsed?.episodes ?? []);
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    })();
    // 注意：这里只「分配 id + 返回元信息」，落库由调用方 upsertAsset 完成（避免重复建资产）
    return {
      id: `script_${nanoid(8)}`,
      kind: 'script',
      filename,
      version: 1,
      lastSyncedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      episodes,
    } as unknown as T;
  }

  // 文本资源（章节检测管线用）：本地直接写数据目录
  if (clean === '/resources/zeroexo') {
    const body = parseBody<{ filename?: string; text?: string; kind?: string; tags?: string[] }>(init);
    const filename = body?.filename?.trim() || `text_${nanoid(8)}.txt`;
    await writeFile(`scripts/${filename}`, body?.text ?? '');
    return { id: filename, kind: body?.kind ?? 'text', filename, version: 1, lastSyncedAt: new Date().toISOString(), createdAt: new Date().toISOString() } as unknown as T;
  }

  // presign：本地版无预签名 —— 直接给一个**本地** storageKey，调用方用 apiPutBinary 落到本地存储桶
  if (clean === '/resources/presign') {
    const body = parseBody<{ filename?: string; mimeType?: string; size?: number }>(init);
    const filename = body?.filename?.trim() || `file_${nanoid(8)}`;
    const mime = body?.mimeType ?? '';
    // 本地键前缀与 persistence 桶一致：image: / video: / audio: / file:
    const prefix = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(filename)
      ? 'image'
      : mime.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(filename)
        ? 'video'
        : mime.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/i.test(filename)
          ? 'audio'
          : 'file';
    const storageKey = `${prefix}:${nanoid(12)}`;
    return { uploadUrl: storageKey, storageKey } as unknown as T;
  }

  // 素材记录（云端 Asset 表）：本地版直接建本地资产记录（不再建云端记录）
  if (clean === '/resources' && method === 'POST') {
    const body = parseBody<{
      kind?: string; filename?: string; storageKey?: string; mimeType?: string;
      size?: number; tags?: string[]; width?: number; height?: number; duration?: number;
    }>(init);
    const now = new Date().toISOString();
    return {
      id: `res_${nanoid(12)}`,
      kind: body?.kind ?? 'image',
      filename: body?.filename ?? '未命名',
      storageKey: body?.storageKey ?? '',
      mimeType: body?.mimeType ?? '',
      size: body?.size ?? 0,
      tags: body?.tags ?? [],
      width: body?.width ?? 0,
      height: body?.height ?? 0,
      duration: body?.duration ?? 0,
      version: 1,
      lastSyncedAt: now,
      createdAt: now,
    } as unknown as T;
  }

  // 生成记录：本地版无云端生成历史 → 返回空
  if (clean.startsWith('/ai/generations')) {
    if (method === 'GET') {
      return (clean === '/ai/generations' ? { items: [], nextCursor: null } : null) as unknown as T;
    }
    return null as unknown as T;
  }

  // 项目 → 本地 project-store
  if (clean === '/projects') {
    if (method === 'GET') {
      const items = await listProjects();
      return { items, nextCursor: null } as unknown as T;
    }
    if (method === 'POST') {
      const body = parseBody<{ title?: string }>(init);
      return (await createProject({ title: body?.title })) as unknown as T;
    }
  }
  if (clean.startsWith('/projects/')) {
    const rest = clean.slice('/projects/'.length);
    // 版本历史 / 回滚：本地版无云端版本表 → 空列表 + 空操作
    // （注意：DELETE /projects/:id/versions/:version 不能落到下面的"删项目"分支！）
    if (rest.includes('/versions')) {
      return (method === 'GET' ? [] : null) as unknown as T;
    }
    if (rest.endsWith('/rollback')) {
      return { restored: false, warnings: [] } as unknown as T;
    }
    const id = decodeURIComponent(rest);
    if (method === 'GET') {
      const p = await getProject(id);
      if (!p) throw new ApiError(404, 'NOT_FOUND', `项目不存在：${id}`);
      return p as unknown as T;
    }
    if (method === 'PATCH') {
      const body = parseBody<{ title?: string; nodeCount?: number }>(init);
      return (await updateProject(id, body ?? {})) as unknown as T;
    }
    if (method === 'DELETE') {
      await deleteProject(id);
      return { message: '已删除' } as unknown as T;
    }
  }

  // 内置 LLM 思考链路 / 创作向导：本地版无内置 LLM 与云端向导
  if (clean.startsWith('/ai/') || clean.startsWith('/creative-wizard/')) {
    throw new LocalUnsupportedError(`${method} ${path}`);
  }

  throw new LocalUnsupportedError(`${method} ${path}`);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return serveLocal<T>(path, init);
}

export function apiGet<T>(path: string): Promise<T> {
  return serveLocal<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return serveLocal<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return serveLocal<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return serveLocal<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return serveLocal<T>(path, { method: 'DELETE' });
}

/** 上传：本地版直接写数据目录（presign 已本地化，uploadUrl 为 null 时无需再传） */
export async function apiUploadFile<T>(_file: File | Blob, _path?: string): Promise<T> {
  throw new LocalUnsupportedError('POST /resources(presign) —— 请改走 platform/fs.writeFile + assets/ 目录约定');
}

/** 二进制写入：本地版落到 persistence 存储桶（image:/video:/audio:/file: 前缀） */
export async function apiPutBinary(storageKey: string, data: Blob): Promise<void> {
  const key = storageKey.startsWith('resources/') ? storageKey.slice('resources/'.length) : storageKey;
  if (key.startsWith('image:')) {
    await uploadImage(data);
    return;
  }
  const prefix = key.startsWith('video:') ? 'video' : key.startsWith('audio:') ? 'audio' : 'file';
  await uploadMediaFile(data, prefix);
}

/** 本地版：把任意 JSON 写进数据目录（供同步层/导入导出复用） */
export async function writeLocalJson(path: string, value: unknown): Promise<void> {
  await writeJson(path, value);
}
