/**
 * 数据目录激活流程（首启门与顶栏按钮共用，避免两处行为分叉）
 *
 * 顺序：选目录 → （可选）把浏览器旧数据迁入目录 → 整页刷新。
 * 必须刷新：localforage 的驱动在实例 ready 时选定，运行中不换驱动；
 * 不刷新就会出现"目录已授权但新数据仍写浏览器"的静默双轨，这正是要消灭的状态。
 */

import { pickRoot } from './fs.js';
import { migrateBrowserToDisk, type MigrateResult } from './migrate.js';
import { reloadWithDisk } from './boot.js';

export type ActivateOutcome = { status: 'cancelled' } | { status: 'error'; message: string } | { status: 'ok'; name: string; migrated: MigrateResult | null };

/** 用户取消原生目录弹窗时抛 AbortError，视为 cancelled 而非错误 */
export async function activateRoot(options: { migrate: boolean }): Promise<ActivateOutcome> {
  let name: string;
  try {
    name = await pickRoot();
  } catch (err) {
    const text = String(err);
    if (text.includes('AbortError')) return { status: 'cancelled' };
    return { status: 'error', message: text };
  }

  let migrated: MigrateResult | null = null;
  if (options.migrate) {
    try {
      migrated = await migrateBrowserToDisk();
    } catch (err) {
      // 迁移失败不阻断：目录已授权，新数据会正常落盘；旧数据留在浏览器可稍后再迁
      console.error('[root] 迁移失败（可稍后在设置里重试）:', err);
    }
  }

  // 稍等一下刷新，保证迁移写入已 close
  await new Promise((r) => setTimeout(r, 120));
  reloadWithDisk();
  return { status: 'ok', name, migrated };
}
