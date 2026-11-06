/**
 * 项目封面（Plan#83 本地版）
 *
 * 契约：
 * - 封面是**项目的一部分**，不是云端资源：key 形态固定为 `image:projects/<projectId>/cover.<ext>`
 * - 双落点：已授权数据目录 → 落磁盘（可拷走、可版本管理）；未授权 → 落 persistence 媒体桶（不阻塞使用，并在 UI 提示去授权）
 * - 导出 zip 时按同一 key 从两个落点取 blob（见 pages/home/services/export-projects.ts）
 */

import localforage from 'localforage';
import { deleteStoredImages, getImageBlob, setImageBlob } from '@zeroexo/plugin-persistence';
import { getMediaBlob, mediaRelPath, newMediaKey, putMedia } from './media.js';
import { isAuthorized, removeFile } from './fs.js';
import type { CoverViewRecord } from '../shared/utils/cover-viewport.js';

export const COVER_PREFIX = 'image:projects/';

function extOf(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * 保存项目封面，返回 storageKey（失败抛错，由调用方提示）
 */
export async function setProjectCover(projectId: string, file: File): Promise<string> {
  const mime = file.type || 'image/jpeg';
  const ext = extOf(mime);

  if (await isAuthorized()) {
    // 磁盘落点：assets/<projectId>/images/cover-<ts>.<ext>
    const { storageKey, relPath } = newMediaKey('image', projectId, mime);
    await putMedia(storageKey, new Uint8Array(await file.arrayBuffer()), mime);
    // relPath 仅用于调试可见性；key 已含相对路径，调用方存 key
    void relPath;
    return storageKey;
  }

  // 回落 persistence 桶（浏览器本地，仍随项目导出；但未落磁盘，UI 应提示授权数据目录）
  return setImageBlob(`${COVER_PREFIX}${projectId}/cover-${Date.now()}.${ext}`, file);
}

/**
 * 解析封面 key → 可显示 URL；取不到返回 null（调用方回退占位图）
 */
export async function resolveCoverUrl(storageKey?: string | null): Promise<string | null> {
  if (!storageKey) return null;
  if (!storageKey.startsWith('image:')) return storageKey; // http/data 等原样返回
  // 1) 磁盘
  if (mediaRelPath(storageKey) && (await getMediaBlob(storageKey))) {
    const blob = await getMediaBlob(storageKey);
    return blob ? URL.createObjectURL(blob) : null;
  }
  // 2) persistence 桶
  const fromStore = await getImageBlob(storageKey);
  return fromStore ? URL.createObjectURL(fromStore) : null;
}

/** 是否为本地封面 key（导出 zip 时用于筛选） */
export function isLocalCoverKey(storageKey: unknown): storageKey is string {
  return typeof storageKey === 'string' && storageKey.startsWith('image:');
}

/**
 * 删除封面图（覆盖封面后清理旧裁剪产物/孤儿文件；双落点都尝试,单点失败静默）。
 * - 磁盘落点: mediaRelPath → removeFile(不存在静默);
 * - persistence 桶: deleteStoredImages(内部按引用计数/缩略图规则处理)。
 * 调用方负责确保 key 已不被任何项目引用。
 */
export async function deleteCoverImage(storageKey?: string | null): Promise<void> {
  if (!storageKey || !isLocalCoverKey(storageKey)) return;
  try {
    const rel = mediaRelPath(storageKey);
    if (rel) await removeFile(rel);
  } catch (err) {
    console.warn('[cover] delete disk cover failed:', storageKey, err);
  }
  try {
    await deleteStoredImages([storageKey]);
  } catch (err) {
    console.warn('[cover] delete stored cover failed:', storageKey, err);
  }
}

// ===== 封面取景(view)侧车持久化 =====
// 封面 storageKey 指向的是「已裁剪好的 16:9 封面图」本体;
// 侧车按封面 key 存 { sourceKey, scale, tx, ty }: sourceKey = 原图(供再次调整),scale/tx/ty = 取景参数。
// 渲染端不需要读侧车 —— 裁剪结果本身就是最终封面,objectFit:cover 直接显示。

const viewStore = localforage.createInstance({ name: 'zeroexo', storeName: 'cover_view' });

/** 保存封面取景记录(按封面 storageKey 索引;确认裁剪成功后才写盘) */
export async function setCoverView(storageKey: string, record: CoverViewRecord): Promise<void> {
  await viewStore.setItem(storageKey, record);
}

/** 读取封面取景记录;无记录(旧封面)或数据损坏返回 null → 调用方按居中铺满处理 */
export async function getCoverView(storageKey?: string | null): Promise<CoverViewRecord | null> {
  if (!storageKey) return null;
  try {
    const raw = await viewStore.getItem<CoverViewRecord>(storageKey);
    if (!raw || typeof raw !== 'object') return null;
    const { sourceKey, scale, tx, ty } = raw as CoverViewRecord;
    if (typeof sourceKey !== 'string' || !sourceKey) return null;
    if (![scale, tx, ty].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { sourceKey, scale, tx, ty };
  } catch {
    return null;
  }
}

/** 清除封面取景记录 */
export async function clearCoverView(storageKey: string): Promise<void> {
  await viewStore.removeItem(storageKey);
}
