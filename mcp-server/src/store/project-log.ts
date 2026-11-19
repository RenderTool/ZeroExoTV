/**
 * 项目档案（需求 / 决策 / 进度 / 待办）——2026-11-19 用户口径：
 * 换会话、换 LLM、关机重启后，任何接入方先读这份，不要靠会话记忆重复描述需求。
 * 落点：projects/<pid>/entities/project-log.json（随项目一起备份/迁移）。
 */

import path from "node:path";
import { paths } from "../config.js";
import { updateVersionedJson } from "./fs-node.js";

export type LogKind = "requirement" | "decision" | "progress" | "todo" | "artifact";

export interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  status: "open" | "done" | "dropped";
  at: string;
  by?: string;
  refs?: string[];
}

export interface ProjectLog {
  title: string;
  version: number;
  updatedAt: string;
  entries: LogEntry[];
}

const EMPTY: ProjectLog = { title: "项目档案", version: 0, updatedAt: "", entries: [] };

function logPath(projectId: string, root: string) {
  return path.join(paths.entitiesDir(projectId, root), "project-log.json");
}

export async function readProjectLog(root: string, projectId: string): Promise<ProjectLog> {
  const p = logPath(projectId, root);
  const { readJsonIfExists } = await import("./fs-node.js");
  const data = await readJsonIfExists<ProjectLog>(p);
  if (!data) return { ...EMPTY, entries: [] };
  return { ...EMPTY, ...data, entries: Array.isArray(data.entries) ? data.entries : [] };
}

export async function appendProjectLog(
  root: string,
  projectId: string,
  opts: { baseVersion: number; entry: Omit<LogEntry, "id" | "at"> & { id?: string; at?: string }; dryRun?: boolean },
) {
  return updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => ({ ...EMPTY, entries: [] }),
    dryRun: opts.dryRun,
    mutate: (log) => {
      const now = new Date().toISOString();
      log.updatedAt = now;
      log.entries.push({
        id: opts.entry.id ?? `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        at: opts.entry.at ?? now,
        kind: opts.entry.kind,
        text: opts.entry.text,
        status: opts.entry.status ?? (opts.entry.kind === "progress" || opts.entry.kind === "decision" ? "done" : "open"),
        by: opts.entry.by,
        refs: opts.entry.refs,
      });
    },
  });
}

export async function updateProjectLogEntry(  root: string,
  projectId: string,
  opts: { baseVersion: number; entryId: string; status: LogEntry["status"]; note?: string },
) {
  return updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    mutate: (log) => {
      const e = log.entries.find((x) => x.id === opts.entryId);
      if (!e) throw new Error(`条目不存在: ${opts.entryId}`);
      e.status = opts.status;
      if (opts.note) e.text = `${e.text}｜${opts.note}`;
      log.updatedAt = new Date().toISOString();
    },
  });
}

/** 压缩：只保留最近 N 条已结束记录（requirement done/dropped、progress、decision），open 条目永不删。 */
export async function compactProjectLog(
  root: string,
  projectId: string,
  opts: { baseVersion: number; keepRecent?: number },
) {
  const keep = Math.max(5, opts.keepRecent ?? 20);
  return updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    mutate: (log) => {
      const open = log.entries.filter((e) => e.status === "open");
      const closed = log.entries.filter((e) => e.status !== "open");
      const keptClosed = closed.slice(-keep);
      const droppedCount = closed.length - keptClosed.length;
      const now = new Date().toISOString();
      log.entries = [...open, ...keptClosed].sort((a, b) => a.at.localeCompare(b.at));
      if (droppedCount > 0) {
        log.entries.push({
          id: `log-${Date.now().toString(36)}-compact`,
          kind: "progress",
          text: `已清理 ${droppedCount} 条已结束记录（保留最近 ${keep} 条）`,
          status: "done",
          at: now,
        });
      }
      log.updatedAt = now;
    },
  });
}
