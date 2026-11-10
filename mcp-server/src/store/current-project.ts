/**
 * 当前打开项目（Agent 的「第一问」）。
 *
 * 数据来源两级：
 * 1. `.lf/zeroexo/app_meta/current-project.json` —— 前端画布每次切项目写一次，代表「用户此刻正开着它」；
 * 2. 没有广播文件（用户没开编辑器 / 旧版本没写）→ 退回项目列表里 updatedAt 最新的一个，并标记 source=recent。
 *
 * 返回里的 source 必须如实告诉用户：open = 你正开着；recent = 只是最近改过，需要确认。
 */

import { promises as fs } from "node:fs";
import { paths } from "../config.js";
import { readProjectsMeta } from "./projects.js";

export interface CurrentProjectInfo {
  projectId: string;
  title: string;
  updatedAt?: string;
  /** 前端广播的时间（ISO） */
  openedAt?: string;
  /** open = 前端正在打开；recent = 没有广播，退回最近修改 */
  source: "open" | "recent";
}

interface Broadcast {
  projectId?: unknown;
  openedAt?: unknown;
}

export async function readCurrentProject(root: string): Promise<CurrentProjectInfo | null> {
  let openedAt: string | undefined;
  try {
    const raw = JSON.parse(await fs.readFile(paths.currentProject(root), "utf8")) as Broadcast;
    openedAt = typeof raw.openedAt === "string" ? raw.openedAt : undefined;
    const id = typeof raw.projectId === "string" ? raw.projectId : "";
    if (id) {
      const meta = (await readProjectsMeta(root).catch(() => [])).find((m) => m.id === id);
      return meta
        ? { projectId: meta.id, title: meta.title, updatedAt: meta.updatedAt, openedAt, source: "open" }
        : { projectId: id, title: "", openedAt, source: "open" };
    }
  } catch {
    /* 没有广播文件：走 recent 兜底 */
  }
  const metas = await readProjectsMeta(root).catch(() => []);
  const recent = metas.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return recent
    ? { projectId: recent.id, title: recent.title, updatedAt: recent.updatedAt, source: "recent" }
    : null;
}
