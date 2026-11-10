/**
 * 当前打开项目广播（给 MCP 用）。
 *
 * 为什么：用户装好 MCP 后通常已经打开了某个项目页面，Agent 不该再反问「你要操作哪个项目」。
 * 画布每次切换项目都把 projectId 写到数据根的这个文件，MCP 的 get_current_project 读同一文件，
 * 先报出「你正在看的是 X」，由用户确认后再动手。
 */
import { ensureDir, writeJson } from './fs.js';

export const CURRENT_PROJECT_PATH = '.lf/zeroexo/app_meta/current-project.json';

export interface CurrentProjectBroadcast {
  schemaVersion: 1;
  /** 当前画布项目 id；列表页/资产页为 null */
  projectId: string | null;
  openedAt: string;
}

export async function publishCurrentProject(projectId: string | null): Promise<void> {
  try {
    await ensureDir('.lf/zeroexo/app_meta');
    await writeJson(CURRENT_PROJECT_PATH, {
      schemaVersion: 1,
      projectId: projectId || null,
      openedAt: new Date().toISOString(),
    } satisfies CurrentProjectBroadcast);
  } catch {
    // 数据目录未授权 / fs-server 离线：静默。MCP 侧会回退到「最近修改的项目」并在返回里标明。
  }
}
