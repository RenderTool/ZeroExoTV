/**
 * project-purge —— 删除项目时的目录级联清理（2026-11-16 用户要求）
 *
 * 规则（AGENTS.md「数据根目录职责与缓存纪律」）：
 * - `projects/<pid>/` 项目正文、`assets/<pid>/` 项目资产文件，删除项目必须一起删；
 * - `media/guides/` 里属于该项目的引导缓存随之级联（引导只在导演台 workbench 存 key）；
 * - CAS 内容（`media/cas/`）不在这里删：引用归零后由 orphan-media 统一回收。
 *
 * 只处理用户显式删除的项目，不做任何「按列表差集」的后台清理——
 * 项目列表读取不完整时，差集清理会把真实项目当垃圾删掉（2026-11-16 事故教训）。
 */
import { listDir, readFile, remove, removeFile } from '@/platform/fs.js';
import { guidePathFromKey, isGuideStorageKey } from '@/entities/guide-store.js';

/** 递归删除相对路径（文件/目录都可，目录逐层删完再删自己） */
async function removeTree(relPath: string): Promise<void> {
  const entries = await listDir(relPath).catch(() => []);
  for (const entry of entries) {
    const child = `${relPath}/${entry.name}`;
    if (entry.kind === 'dir') await removeTree(child);
    else await removeFile(child).catch(() => undefined);
  }
  await remove(relPath).catch(() => undefined);
}

/** 从任意 JSON 结构里收集 guide 缓存键（`guide:gd_xxx.safetensors`） */
function collectGuideKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectGuideKeys(item, out);
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v === 'string') {
      if (isGuideStorageKey(v)) out.add(v);
    } else collectGuideKeys(v, out);
  }
  return out;
}

const GUIDE_ID_RE = /gd_[A-Za-z0-9_-]{4,64}/g;

/**
 * 收集一个项目目录里出现的全部引导 id：workbench 只是其中一处，
 * 分镜 / 剧本 / 快照里也可能存着 `guide:gd_xxx` 或裸 id，所以整棵目录扫，别只读 workbench。
 */
async function collectGuideIds(relDir: string, out = new Set<string>()): Promise<Set<string>> {
  const entries = await listDir(relDir).catch(() => []);
  for (const entry of entries) {
    const child = `${relDir}/${entry.name}`;
    if (entry.kind === 'dir') {
      await collectGuideIds(child, out);
      continue;
    }
    if (!/\.(json|jsonc|txt|md)$/i.test(entry.name)) continue;
    const raw = await readFile(child).catch(() => null);
    if (!raw) continue;
    for (const m of raw.matchAll(GUIDE_ID_RE)) out.add(m[0]);
    try {
      for (const key of collectGuideKeys(JSON.parse(raw))) {
        const path = guidePathFromKey(key);
        if (path) out.add(path.split('/').pop()!.replace(/\.safetensors$/, ''));
      }
    } catch {
      /* 非 JSON 或半截内容：上面正则已经抓到 id */
    }
  }
  return out;
}

/** 删除该项目名下的引导缓存文件 */
async function purgeProjectGuides(projectId: string): Promise<void> {
  const ids = await collectGuideIds(`projects/${projectId}`);
  for (const id of ids) {
    await removeFile(`media/guides/${id}.safetensors`).catch(() => undefined);
  }
}

/**
 * 删除一个项目在数据根里的全部产物：引导缓存 → `assets/<pid>` → `projects/<pid>`。
 * 幂等：目录不存在时静默通过。
 */
export async function purgeProjectData(projectId: string): Promise<void> {
  const pid = projectId.trim();
  if (!pid || pid.includes('/') || pid.includes('\\') || pid.includes('..')) return;
  await purgeProjectGuides(pid);
  await removeTree(`assets/${pid}`);
  await removeTree(`projects/${pid}`);
}
