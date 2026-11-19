/**
 * 删除墓碑（2026-11-16）
 *
 * 背景：实测「点删除 → assets.json 记录被删 → 刷新后又出现新 id 的同内容记录」，
 * 说明存在一条「重新落库」路径把同一 storageKey 又建了回来（版本 id 也从 ver-tsk-… 变成 ver-cover-<新id>）。
 * 与其逐个追调用点，先把结果堵死：被删除过的内容键写进墓碑，addAssets 见到墓碑直接跳过；
 * 用户显式「撤销删除」时清除对应墓碑，保证撤销仍可用。
 */
import { readFile, writeFile, ensureDir } from '@/platform/fs.js';

const TOMBSTONE_FILE = '.lf/zeroexo/app_meta/deleted-assets.json';

type TombstoneFile = { __zeroexo: 1; keys: string[] };

async function readTombstones(): Promise<Set<string>> {
  try {
    const text = await readFile(TOMBSTONE_FILE);
    if (!text) return new Set();
    const parsed = JSON.parse(text) as TombstoneFile;
    return new Set(Array.isArray(parsed.keys) ? parsed.keys : []);
  } catch {
    return new Set();
  }
}

async function writeTombstones(keys: Set<string>): Promise<void> {
  await ensureDir('.lf/zeroexo/app_meta').catch(() => undefined);
  const payload: TombstoneFile = { __zeroexo: 1, keys: [...keys] };
  await writeFile(TOMBSTONE_FILE, JSON.stringify(payload, null, 2));
}

/** 记录被删内容键（幂等，失败不阻断删除主流程） */
export async function markDeletedKeys(keys: Array<string | undefined>): Promise<void> {
  const filtered = keys.filter((k): k is string => !!k);
  if (filtered.length === 0) return;
  const set = await readTombstones();
  for (const k of filtered) set.add(k);
  await writeTombstones(set).catch(() => undefined);
}

/** 该内容键是否已被用户删除（命中则禁止自动重建记录） */
export async function isDeletedKey(key: string): Promise<boolean> {
  return (await readTombstones()).has(key);
}

/** 全量墓碑键（列表层过滤用：已删内容即使被异常链重建记录，也不再出现在任何列表里） */
export async function listDeletedKeys(): Promise<Set<string>> {
  return readTombstones();
}

/** 撤销删除时清除墓碑，让恢复的记录能正常存在 */
export async function forgetDeletedKeys(keys: Array<string | undefined>): Promise<void> {
  const filtered = keys.filter((k): k is string => !!k);
  if (filtered.length === 0) return;
  const set = await readTombstones();
  for (const k of filtered) set.delete(k);
  await writeTombstones(set).catch(() => undefined);
}
