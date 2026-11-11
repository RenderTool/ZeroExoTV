/**
 * guide-store —— 引导数据的本地缓存（2026-11-11 用户要求）
 *
 * 云端 ComfyUI 不会长期保存产物：生成完必须立刻把 guidedata 下到本地数据目录，
 * 否则云端一清盘，历史里的「含引导」就只剩一个取不到的 id。
 *
 * 落点：<数据根>/media/guides/gd_xxx.safetensors
 * 资产记录用 `guide:<id>.safetensors` 作为 localKey（与 cas: 键同一套「键不是物理路径」约定）。
 */
import { readFileHandle, stat, writeFile } from '@/platform/fs';

export const GUIDE_DIR = 'media/guides';

const GUIDE_ID_PATTERN = /^gd_[A-Za-z0-9_-]{4,64}$/;
const GUIDE_KEY_PATTERN = /^guide:(gd_[A-Za-z0-9_-]{4,64})\.safetensors$/;

export function isGuideFileName(id: unknown): id is string {
  return typeof id === 'string' && GUIDE_ID_PATTERN.test(id);
}

/** 本地缓存键（渲染/下载层用它判断「已缓存」） */
export function guideStorageKey(id: string): string {
  return `guide:${id}.safetensors`;
}

export function isGuideStorageKey(key: unknown): key is string {
  return typeof key === 'string' && GUIDE_KEY_PATTERN.test(key);
}

/** localKey → 磁盘相对路径 */
export function guidePathFromKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const m = GUIDE_KEY_PATTERN.exec(key);
  return m ? `${GUIDE_DIR}/${m[1]}.safetensors` : null;
}

/** 读取已缓存的引导字节（没有缓存 / 文件缺失 → null） */
export async function readCachedGuideBlob(guide: { id?: string; localKey?: string } | null | undefined): Promise<Blob | null> {
  const key = guide?.localKey ?? (isGuideFileName(guide?.id) ? guideStorageKey(guide!.id) : null);
  const path = guidePathFromKey(key);
  if (!path) return null;
  const s = await stat(path).catch(() => null);
  if (!s?.size) return null;
  return readFileHandle(path).catch(() => null);
}

/** 写入本地缓存（幂等：已存在直接复用） */
export async function writeGuideBlob(id: string, blob: Blob): Promise<{ localKey: string; bytes: number } | null> {
  if (!isGuideFileName(id) || !blob.size) return null;
  const path = `${GUIDE_DIR}/${id}.safetensors`;
  const existing = await stat(path).catch(() => null);
  if (existing?.size) return { localKey: guideStorageKey(id), bytes: existing.size };
  await writeFile(path, blob);
  return { localKey: guideStorageKey(id), bytes: blob.size };
}
