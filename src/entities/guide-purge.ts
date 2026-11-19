/**
 * guide-purge —— 引导缓存回收（2026-11-17 用户报障：删了项目，`media/guides` 还留着 2GB）
 *
 * 规则：
 * - 引导缓存（`media/guides/gd_*.safetensors`）只在导演台片段里被引用；片段/项目没了就是垃圾；
 * - 回收前必须把**每个项目**整棵目录扫一遍收集引用，任何项目读失败 → 本轮完全跳过，宁可漏删；
 * - 只删「一个项目都没提到」的缓存文件，不按时间、不按大小猜。
 */
import { listDir, readFile, removeFile } from '@/platform/fs.js';
import { GUIDE_DIR } from '@/entities/guide-store.js';

const GUIDE_ID_RE = /gd_[A-Za-z0-9_-]{4,64}/g;

/** 读一个文件里出现的全部引导 id；读失败返回 null（调用方据此放弃本轮回收） */
async function idsInFile(relPath: string): Promise<Set<string> | null> {
  try {
    const text = await readFile(relPath);
    if (!text) return new Set();
    const ids = new Set<string>();
    for (const m of text.matchAll(GUIDE_ID_RE)) ids.add(m[0]);
    return ids;
  } catch {
    return null;
  }
}

/** 递归扫一棵目录，收集所有 JSON/文本里引用的引导 id；任一文件读失败返回 null */
async function idsInTree(relDir: string): Promise<Set<string> | null> {
  const entries = await listDir(relDir).catch(() => null);
  if (!entries) return null;
  const ids = new Set<string>();
  for (const entry of entries) {
    const child = `${relDir}/${entry.name}`;
    if (entry.kind === 'dir') {
      const sub = await idsInTree(child);
      if (!sub) return null;
      for (const id of sub) ids.add(id);
      continue;
    }
    if (!/\.(json|jsonc|txt|md)$/i.test(entry.name)) continue;
    const found = await idsInFile(child);
    if (!found) return null;
    for (const id of found) ids.add(id);
  }
  return ids;
}

/**
 * 删掉没有任何项目引用的引导缓存。
 * 安全阀：引导目录不可读、项目列表读不到、任一项目目录里读文件失败 → 一个都不删。
 */
export async function purgeOrphanGuides(): Promise<{ removed: number; skipped: string | null }> {
  const guideEntries = await listDir(GUIDE_DIR).catch(() => null);
  if (!guideEntries) return { removed: 0, skipped: '引导缓存目录不可读' };
  const guideFiles = guideEntries
    .filter((e) => e.kind === 'file' && e.name.endsWith('.safetensors'))
    .map((e) => e.name);
  if (guideFiles.length === 0) return { removed: 0, skipped: null };

  const projectEntries = await listDir('projects').catch(() => null);
  if (!projectEntries) return { removed: 0, skipped: '项目列表读取失败' };

  const referenced = new Set<string>();
  for (const project of projectEntries) {
    if (project.kind !== 'dir') continue;
    const ids = await idsInTree(`projects/${project.name}`);
    if (!ids) return { removed: 0, skipped: `项目 ${project.name} 读取失败` };
    for (const id of ids) referenced.add(id);
  }

  let removed = 0;
  for (const name of guideFiles) {
    const id = name.replace(/\.safetensors$/, '');
    if (referenced.has(id)) continue;
    await removeFile(`${GUIDE_DIR}/${name}`).catch(() => undefined);
    removed += 1;
  }
  return { removed, skipped: null };
}
