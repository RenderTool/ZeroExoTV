/**
 * guide-store —— 引导数据的本地缓存（2026-11-11 用户要求）
 *
 * 云端 ComfyUI 不会长期保存产物：生成完必须立刻把 guidedata 下到本地数据目录，
 * 否则云端一清盘，历史里的「含引导」就只剩一个取不到的 id。
 *
 * 落点：<数据根>/media/guides/gd_xxx.safetensors
 * 资产记录用 `guide:<id>.safetensors` 作为 localKey（与 cas: 键同一套「键不是物理路径」约定）。
 */
import { readFileHandle, stat, writeFileBlob } from '@/platform/fs';

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

/** 校验磁盘上的 safetensors 自洽：头部声明的字节数必须等于文件长度。
 *  历史 bug 留下的「文本化」损坏文件（声明 421MB / 实际 696MB）会被判为无效，从而触发重新下载。 */
async function isValidSafetensorsFile(file: Blob): Promise<boolean> {
  if (file.size < 16) return false;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const view = new DataView(head.buffer, head.byteOffset, 8);
  const headerLen = Number(view.getBigUint64(0, true));
  if (!Number.isFinite(headerLen) || headerLen <= 0 || headerLen > 16 * 1024 * 1024) return false;
  if (8 + headerLen > file.size) return false;
  const raw = await file.slice(8, 8 + headerLen).text();
  try {
    const header = JSON.parse(raw) as Record<string, { data_offsets?: [number, number] }>;
    let maxEnd = 0;
    for (const entry of Object.values(header)) {
      const end = entry?.data_offsets?.[1];
      if (typeof end === 'number' && end > maxEnd) maxEnd = end;
    }
    return 8 + headerLen + maxEnd === file.size;
  } catch {
    return false;
  }
}

/** 读取已缓存的引导字节（没有缓存 / 文件缺失 / 文件已损坏 → null） */
export async function readCachedGuideBlob(guide: { id?: string; localKey?: string } | null | undefined): Promise<Blob | null> {
  const key = guide?.localKey ?? (isGuideFileName(guide?.id) ? guideStorageKey(guide!.id) : null);
  const path = guidePathFromKey(key);
  if (!path) return null;
  const s = await stat(path).catch(() => null);
  if (!s?.size) return null;
  const file = await readFileHandle(path).catch(() => null);
  if (!file) return null;
  if (!(await isValidSafetensorsFile(file))) return null;
  return file;
}

/** 写入本地缓存（幂等：已存在直接复用）
 *
 * 2026-11-20 事故：这里原来用 `writeFile(path, blob)`，而 writeFile 会先把 Blob 转成
 * **文本**再写 → safetensors 二进制被 UTF-8 解码（非法字节变成 U+FFFD）后体积膨胀约 1.65 倍，
 * 本地缓存全部损坏（如 gd_a931 声明 421MB、实际落 696MB）。必须走二进制写入。
 */
export async function writeGuideBlob(id: string, blob: Blob): Promise<{ localKey: string; bytes: number } | null> {
  if (!isGuideFileName(id) || !blob.size) return null;
  const path = `${GUIDE_DIR}/${id}.safetensors`;
  const existing = await readFileHandle(path).catch(() => null);
  if (existing && (await isValidSafetensorsFile(existing))) {
    return { localKey: guideStorageKey(id), bytes: existing.size };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFileBlob(path, bytes);
  return { localKey: guideStorageKey(id), bytes: bytes.byteLength };
}
