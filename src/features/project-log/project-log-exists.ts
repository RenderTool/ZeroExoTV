/**
 * project-log 存在性探测（2026-11-21 用户口径：控制台别被 404 刷屏）。
 *
 * 背景：项目没有 `entities/project-log.json` 时，工作台横幅 / 需求记录页 / 记忆区块
 * 每隔 4~5 秒直接 `readJson` 这个文件 → 每次都是 404，Chrome 控制台就被
 * "Failed to load resource: 404" 刷满。
 *
 * 做法：先用 `listDir` 列一次 entities 目录（200，静默），存在才允许读文件；
 * 结果缓存 30 秒，MCP 后来写入的话最迟 30 秒后能看到。文件确实不存在就完全不发那个 404 请求。
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; exists: boolean }>();

export async function projectLogExists(projectId: string): Promise<boolean> {
  if (!projectId) return false;
  const hit = cache.get(projectId);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.exists;
  let exists = false;
  try {
    const entries = await listEntities(projectId);
    exists = entries.some((name) => name === 'project-log.json');
  } catch {
    exists = false;
  }
  cache.set(projectId, { at: now, exists });
  return exists;
}

async function listEntities(projectId: string): Promise<string[]> {
  const { listDir } = await import('@/platform/fs.js');
  const entries = await listDir(`projects/${projectId}/entities`);
  return entries.map((e) => e.name);
}

/** 自己刚写入 project-log 时调用，免得还按旧缓存当不存在 */
export function markProjectLogExists(projectId: string): void {
  cache.set(projectId, { at: Date.now(), exists: true });
}
