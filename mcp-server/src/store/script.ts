/**
 * 剧本实体。Schema 对齐 src/entities/script-store.ts:43-56（ScriptEntity）：
 * schemaVersion:1, version(乐观锁), title, activeEpisodeId, episodes[], sourceInfo, updatedAt。
 * 写纪律：baseVersion 必填，0=仅创建；nextEpisodeNumber=max+1；autoEpisodeTitle='第N集'；
 * sourceInfo.createdBy='mcp'；overwrite 前备份到 entities/backups/。
 */

import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { McpError } from "../errors.js";
import { paths } from "../config.js";
import { readJsonIfExists, updateVersionedJson, type UpdateResult } from "./fs-node.js";

export interface Episode {
  id: string;
  number: number;
  title: string;
  content: string;
  status: "draft" | "ready" | "done";
  segments?: unknown[];
}

export interface ScriptEntity {
  schemaVersion: 1;
  version: number;
  updatedAt: string;
  title: string;
  activeEpisodeId: string | null;
  episodes: Episode[];
  sourceInfo: { origin: string; createdBy: "editor-page" | "mcp" | "migration" };
}

function emptyScript(title = "剧本"): Omit<ScriptEntity, "version" | "updatedAt"> {
  return {
    schemaVersion: 1,
    title,
    activeEpisodeId: null,
    episodes: [],
    sourceInfo: { origin: "mcp", createdBy: "mcp" },
  };
}

export async function readScript(root: string, projectId: string): Promise<ScriptEntity | null> {
  return readJsonIfExists<ScriptEntity>(paths.script(projectId, root));
}

export function nextEpisodeNumber(script: ScriptEntity): number {
  return script.episodes.reduce((m, e) => Math.max(m, e.number), 0) + 1;
}

export function autoEpisodeTitle(n: number): string {
  return `第${n}集`;
}

export async function createEpisode(
  root: string,
  projectId: string,
  opts: { baseVersion: number; title?: string; content?: string; dryRun?: boolean },
): Promise<UpdateResult<ScriptEntity> & { episode: Episode }> {
  let created!: Episode;
  const res = await updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => emptyScript(),
    dryRun: opts.dryRun,
    mutate: (s) => {
      const n = nextEpisodeNumber(s);
      created = {
        id: `ep-${crypto.randomBytes(6).toString("hex")}`,
        number: n,
        title: opts.title ?? autoEpisodeTitle(n),
        content: opts.content ?? "",
        status: "draft",
      };
      s.episodes.push(created);
      s.activeEpisodeId = created.id;
    },
  });
  return { ...res, episode: created };
}

export type ImportStrategy = "new_episode" | "append" | "overwrite";

export async function importScript(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    content: string;
    strategy: ImportStrategy;
    episodeId?: string;
    title?: string;
    dryRun?: boolean;
  },
): Promise<UpdateResult<ScriptEntity> & { backupPath?: string }> {
  const scriptFile = paths.script(projectId, root);
  let backupPath: string | undefined;

  // overwrite：真实写入前先备份（dryRun 不需要备份）
  if (opts.strategy === "overwrite" && !opts.dryRun) {
    const existing = await readJsonIfExists<ScriptEntity>(scriptFile);
    if (existing) {
      const dir = paths.backupsDir(projectId, root);
      await fs.mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      backupPath = path.join(dir, `script-${ts}.json`);
      await fs.writeFile(backupPath, JSON.stringify(existing, null, 2), "utf8");
    }
  }

  const res = await updateVersionedJson<ScriptEntity>(scriptFile, {
    baseVersion: opts.baseVersion,
    // new_episode/overwrite 均允许首次导入时创建剧本实体（baseVersion=0）；append 必须已存在目标
    createIfMissing: opts.strategy === "append" ? undefined : () => emptyScript(opts.title),
    dryRun: opts.dryRun,
    mutate: (s) => {
      if (opts.strategy === "overwrite") {
        s.episodes = [];
        s.episodes.push({
          id: `ep-${crypto.randomBytes(6).toString("hex")}`,
          number: 1,
          title: opts.title ?? autoEpisodeTitle(1),
          content: opts.content,
          status: "draft",
        });
        s.activeEpisodeId = s.episodes[0].id;
      } else if (opts.strategy === "new_episode") {
        const n = nextEpisodeNumber(s);
        s.episodes.push({
          id: `ep-${crypto.randomBytes(6).toString("hex")}`,
          number: n,
          title: opts.title ?? autoEpisodeTitle(n),
          content: opts.content,
          status: "draft",
        });
        s.activeEpisodeId = s.episodes[s.episodes.length - 1].id;
      } else {
        // append：追加到指定 episode 或 activeEpisode
        const targetId = opts.episodeId ?? s.activeEpisodeId;
        const ep = s.episodes.find((e) => e.id === targetId);
        if (!ep) throw new McpError("NOT_FOUND", `append 目标 episode 不存在: ${targetId}`);
        ep.content = ep.content ? `${ep.content}\n${opts.content}` : opts.content;
      }
    },
  });
  return { ...res, backupPath };
}

/** HTML → 纯文本（剧本 content 是 HTML）。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export interface SegmentDraft {
  number: number;
  description: string;
  duration: number;
}

/**
 * 剧本 → 片段草案：按场景标记（"场景X"/"第X场"/"SCENE"）切分；
 * 无场景标记时按空行/段落分组，每 3 行归并为 1 个片段。时长默认 5s。
 */
export function splitToSegmentDrafts(htmlContent: string): SegmentDraft[] {
  const text = htmlToText(htmlContent);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const sceneRe = /^(场景|第.{1,4}场|SCENE|镜头|shot)\b/i;
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (sceneRe.test(line) && current.length > 0) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
    // 无场景标记时的兜底：每 3 行切段
    if (current.length >= 3 && !sceneRe.test(current[0])) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((c, i) => ({
    number: i + 1,
    description: c.join("；"),
    duration: 5,
  }));
}
