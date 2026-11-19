/**
 * orphan-media —— 孤立媒体即时清理（2026-11-11 用户要求：不要回收站）
 *
 * 用户口径：明确删除的东西不该再缓存；孤儿文件也不该长期存在，定时主动清理即可。
 * 这里只处理「确认没有任何引用」的条目：CAS 索引里 refs 为空 / refCount=0 → 删文件 + 摘条目。
 * 有存活引用的条目一律不动。
 *
 * 2026-11-16 事故后收紧：**不再删「索引里没有的残留文件」**——索引与文件短暂不一致
 * （写入中间态、跨标签页并发）时，按「索引外残留」删文件会把刚落盘的内容直接抹掉。
 * 零引用条目已是唯一合法回收对象。
 */
import { removeFile } from '@/platform/fs';
import { detachEmptyCasEntry, readCasIndex } from './cas-store';

export interface PurgeResult {
  removed: number;
  failed: number;
}

export async function purgeOrphanMedia(): Promise<PurgeResult> {
  let removed = 0;
  let failed = 0;
  let index: Awaited<ReturnType<typeof readCasIndex>>;
  try {
    index = await readCasIndex();
  } catch {
    return { removed: 0, failed: 0 };
  }

  // 索引里零引用的条目：先删文件，成功后再摘条目（失败则保留条目，避免断链索引）
  for (const [hash, entry] of Object.entries(index.entries)) {
    if (entry.refs.length > 0 || entry.refCount > 0) continue;
    try {
      await removeFile(entry.path);
      await detachEmptyCasEntry(hash);
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  return { removed, failed };
}
