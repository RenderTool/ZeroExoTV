/**
 * 媒体 Blob 解析表（2026-11-05 媒体 URL 提供者配套）
 *
 * 提供者统一创建/回收 object URL，本模块只负责「按变体读 Blob」：
 * - thumb / preview / videothumb：image_files 桶的派生键（'{storageKey}:thumb' 等）；
 * - orig：先读 image_files 桶本体键（cas: 键经 disk-driver 穿透读 media/cas 实际文件），
 *   video:/audio: 键再回退 media_files 桶（视频/音频真身所在，旧解析链漏读导致
 *   「视频源未就绪」占位）。
 * 与旧字符串解析链（resolveThumbnailUrl 等）的存储查找路径逐一对齐，
 * 区别仅是不创建 URL、不触碰内存缓存——所有权归 media-url-provider。
 *
 * 2026-11-06（征集 #186）：cas: 键新增按档读取 media/cas/<hash>.<variant>.jpg；
 * 档位尺寸/路径全部取自 image-variants.ts 单一事实源，文件缺失返回 null 让链回退原图。
 */
import { getMediaBlob, getImageVariantBlob, getVideoThumbBlob, casVariantPath, CAS_KEY_PATTERN } from '@zeroexo/plugin-persistence';
import { readFileHandle } from '@/platform/fs.js';

export type MediaKind = 'image' | 'video' | 'audio';
export type MediaVariant = 'thumb' | 'preview' | 'orig' | 'videothumb';

/** 单变体解析：返回 Blob 或 null（存储无此档） */
export async function resolveMediaBlob(
  storageKey: string,
  kind: MediaKind,
  variant: MediaVariant,
): Promise<Blob | null> {
  if (!storageKey) return null;
  try {
    // 只有「CAS 音视频物理文件」本身没有图片派生档（视频首帧走 videothumb）时跳过，
    // 避免误标 kind 的调用方打穿 image_files 桶与 media/cas 两条链、各发 404。
    // 注意不能按 kind 一刀切：video:/image: 键的持久化 poster 派生档是合法数据源。
    const isNonImageMedia = /\.(mp4|webm|mov|mkv|mp3|wav|aac|ogg|flac|opus|m4a)$/i.test(storageKey);
    if ((variant === 'thumb' || variant === 'preview') && isNonImageMedia) return null;
    // CAS 派生档（图片入库时自动生成）：命中即返回，缺失返回 null 让变体链继续回退
    if (variant === 'thumb' || variant === 'preview') {
      const casMatch = CAS_KEY_PATTERN.exec(storageKey);
      if (casMatch?.[1]) return await readFileHandle(casVariantPath(casMatch[1], variant));
    }
    if (variant === 'thumb' || variant === 'preview' || variant === 'orig') {
      const blob = await getImageVariantBlob(storageKey, variant);
      // 视频置顶「派生档缺失 → 原视频」链：orig 在 image 桶未命中时回退 media 桶
      if (blob) return blob;
      if (variant === 'orig' && kind !== 'image') return await getMediaBlob(storageKey);
      return null;
    }
    if (variant === 'videothumb') return await getVideoThumbBlob(storageKey);
    return null;
  } catch {
    return null;
  }
}

/** 变体链解析：按优先级逐个尝试，返回首个命中的 { blob, origin }（origin = 命中变体名） */
export async function resolveMediaBlobChain(
  storageKey: string,
  kind: MediaKind,
  variants: readonly MediaVariant[],
): Promise<{ blob: Blob; origin: MediaVariant } | null> {
  // CAS 键指向 media/cas/<hash>.<ext> 物理文件，没有 :thumb / :preview 派生档。
  // 层级缩略图等消费方只给 ['preview','thumb']，若不补 orig 会 100% 解析失败 → 空白卡。
  const chain: readonly MediaVariant[] =
    storageKey.startsWith('cas:') && !variants.includes('orig') ? [...variants, 'orig'] : variants;
  for (const variant of chain) {
    const blob = await resolveMediaBlob(storageKey, kind, variant);
    if (blob) return { blob, origin: variant };
  }
  return null;
}
