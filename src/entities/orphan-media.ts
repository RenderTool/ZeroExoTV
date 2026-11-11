/**
 * orphan-media —— 孤立媒体即时清理（2026-11-11 用户要求：不要回收站）
 *
 * 用户口径：明确删除的东西不该再缓存；孤儿文件也不该长期存在，定时主动清理即可。
 * 这里只处理「确认没有任何引用」的文件：
 * - CAS 索引里 refs 为空 / refCount=0 的条目 → 删文件 + 摘条目；
 * - media/cas 下索引里根本没有的文件（崩溃残留）→ 直接删。
 * 有存活引用的条目一律不动。
 */
import { listDir, removeFile } from '@/platform/fs';
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

  // 1) 索引里零引用的条目：先删文件，成功后再摘条目（失败则保留条目，避免断链索引）
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

  // 2) media/cas 下索引里没有的残留文件
  try {
    const entries = await listDir('media/cas');
    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      const dot = entry.name.lastIndexOf('.');
      const hash = dot > 0 ? entry.name.slice(0, dot) : entry.name;
      if (index.entries[hash]) continue;
      try {
        await removeFile(`media/cas/${entry.name}`);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    // media/cas 不存在 = 没有残留
  }

  // 3) 旧版本留下的「回收站」目录（2026-11-11 起不再使用）：一并清掉
  try {
    const legacy = await listDir('media/recycle');
    for (const entry of legacy) {
      if (entry.kind !== 'file') continue;
      try {
        await removeFile(`media/recycle/${entry.name}`);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    // 没有旧回收站
  }

  return { removed, failed };
}
