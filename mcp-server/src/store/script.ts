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
import { toScriptHtml, splitScriptMeta } from "../lib/script-html.js";
import { readJsonIfExists, updateVersionedJson, type UpdateResult } from "./fs-node.js";

export interface EpisodeMeta {
  /** 一句话介绍（logline） */
  logline?: string;
  /** 推荐标签 */
  tags?: string[];
  /** 发布建议 */
  publishNote?: string;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  content: string;
  status: "draft" | "ready" | "done";
  segments?: unknown[];
  /** 本集信息卡（剧本页右侧抽屉展示） */
  meta?: EpisodeMeta;
}

export interface ScriptVisualStyle {
  presetId: string;
  name: string;
  /** 风格片段（已去掉 [主体], 前缀） */
  prompt: string;
  image?: string;
}

export interface ScriptMeta {
  /** 整部剧的一句话概述 */
  logline?: string;
  /** 推荐标签 */
  tags?: string[];
  /** 全剧视觉风格（2026-11-13）：所有主体提示词继承 */
  visualStyle?: ScriptVisualStyle;
}

export interface ScriptEntity {
  schemaVersion: 1;
  version: number;
  updatedAt: string;
  title: string;
  activeEpisodeId: string | null;
  episodes: Episode[];
  /** 本剧信息（整部剧一句话概述 + 标签），剧本页资产抽屉「本剧信息」分组展示 */
  meta?: ScriptMeta;
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

/**
 * 编辑已有剧集（标题 / 正文 / 状态）。不改变 number 与顺序；content 是整体替换，
 * 追加请用 import_script(strategy:"append")。
 */
export async function updateEpisode(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    episodeId: string;
    title?: string;
    content?: string;
    status?: Episode["status"];
    dryRun?: boolean;
  },
): Promise<UpdateResult<ScriptEntity> & { episode: Episode }> {
  let updated!: Episode;
  const res = await updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const ep = s.episodes.find((e) => e.id === opts.episodeId);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${opts.episodeId}`);
      if (opts.title !== undefined) ep.title = opts.title;
      if (opts.content !== undefined) ep.content = opts.content;
      if (opts.status !== undefined) ep.status = opts.status;
      updated = ep;
    },
  });
  return { ...res, episode: updated };
}

/**
 * 合并到上一集（与前端「合并到上一集」同一语义）：正文按顺序拼接 → 删除当前集 →
 * 其余集 number 重排为 1..N（与删除集的编号规则一致）；activeEpisodeId 指向上一集。
 */
export async function mergeEpisodeIntoPrev(
  root: string,
  projectId: string,
  opts: { baseVersion: number; episodeId: string; dryRun?: boolean },
): Promise<UpdateResult<ScriptEntity> & { mergedInto: Episode }> {
  let mergedInto!: Episode;
  const res = await updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const idx = s.episodes.findIndex((e) => e.id === opts.episodeId);
      if (idx < 0) throw new McpError("NOT_FOUND", `episode 不存在: ${opts.episodeId}`);
      if (idx === 0) throw new McpError("VALIDATION", "第一集没有上一集可合并");
      const cur = s.episodes[idx]!;
      const prev = s.episodes[idx - 1]!;
      prev.content = `${prev.content}${cur.content}`;
      // 状态取更「完成」的一侧：任一集 done 视为 done，否则保留上一集状态
      if (cur.status === "done") prev.status = "done";
      s.episodes.splice(idx, 1);
      s.episodes.forEach((e, i) => { e.number = i + 1; });
      s.activeEpisodeId = prev.id;
      mergedInto = prev;
    },
  });
  return { ...res, mergedInto };
}

export async function deleteEpisode(
  root: string,
  projectId: string,
  opts: { baseVersion: number; episodeId: string; dryRun?: boolean },
): Promise<UpdateResult<ScriptEntity>> {
  return updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const idx = s.episodes.findIndex((e) => e.id === opts.episodeId);
      if (idx < 0) throw new McpError("NOT_FOUND", `episode 不存在: ${opts.episodeId}`);
      if (s.episodes.length <= 1) throw new McpError("VALIDATION", "至少保留一集；不能删除最后一集");
      s.episodes.splice(idx, 1);
      s.episodes.forEach((e, i) => { e.number = i + 1; });
      if (s.activeEpisodeId === opts.episodeId) s.activeEpisodeId = s.episodes[Math.max(0, idx - 1)]!.id;
    },
  });
}

// ===== 剧集正文块级编辑（局部修改，不要求调用方回传整篇 HTML） =====

/** 可编辑的剧本块类型（编辑器只认这六种 + 手动分页） */
export const SCRIPT_BLOCK_KINDS = [
  "scene-heading", "action", "character", "dialogue", "parenthetical", "transition",
] as const;
export type ScriptBlockKind = (typeof SCRIPT_BLOCK_KINDS)[number];

export interface ScriptBlock {
  /** 从 0 开始的块下标（只数 <p class="script-*"> 块，get_script 返回同一下标） */
  index: number;
  kind: ScriptBlockKind | "page-break";
  text: string;
}

function htmlUnescape(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 正文 → 块序列（保留每块原始 HTML；非 <p> 内容不参与下标） */
function splitScriptBlocks(html: string): { prefix: string; blocks: Array<{ kind: string; text: string; raw: string }>; suffix: string } {
  const blocks: Array<{ kind: string; text: string; raw: string }> = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let firstStart = -1;
  let lastEnd = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (firstStart < 0) firstStart = m.index;
    lastEnd = m.index + m[0].length;
    const attrs = m[1] ?? "";
    const kind = /script-(scene-heading|action|character|dialogue|parenthetical|transition)/i.exec(attrs)?.[1]?.toLowerCase() ?? "action";
    const text = htmlUnescape((m[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    blocks.push({ kind, text, raw: m[0] });
  }
  if (firstStart < 0) return { prefix: "", blocks, suffix: html };
  return { prefix: html.slice(0, firstStart), blocks, suffix: html.slice(lastEnd) };
}

/** 正文 → 块列表（get_script 用；只读、不落盘） */
export function listScriptBlocks(html: string): ScriptBlock[] {
  return splitScriptBlocks(html).blocks.map((b, index) => ({
    index,
    kind: b.kind as ScriptBlockKind,
    text: b.text,
  }));
}

export type ScriptBlockOp =
  | { op: "append"; blocks: Array<{ kind: ScriptBlockKind; text: string }> }
  | { op: "insert"; index: number; blocks: Array<{ kind: ScriptBlockKind; text: string }> }
  | { op: "replace"; index: number; blocks: Array<{ kind: ScriptBlockKind; text: string }> }
  | { op: "delete"; index: number; count?: number };

function renderBlocks(blocks: Array<{ kind: ScriptBlockKind; text: string }>): string[] {
  return blocks.map((b) => `<p class="script-${b.kind}">${htmlEscape(b.text)}</p>`);
}

/**
 * 剧集正文块级编辑：只传要改的块，不要求回传整篇 HTML。
 * - 下标 = get_script 返回的 blocks[].index（只数 <p class="script-*"> 块）；
 * - append 追加到正文末尾；insert 在 index 前插入（index = 块数即末尾）；
 * - 多个 op 按数组顺序依次执行（后一个的 index 基于前一个执行后的块列表）；
 * - 一次调用只写一次盘（单个乐观锁事务），不会「读整篇 → 改一个字 → 全量写回」多轮往返。
 */
export async function patchEpisodeBlocks(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    episodeId: string;
    ops: ScriptBlockOp[];
    dryRun?: boolean;
  },
): Promise<UpdateResult<ScriptEntity> & { episode: Episode; blocks: ScriptBlock[] }> {
  let updated!: Episode;
  const res = await updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const ep = s.episodes.find((e) => e.id === opts.episodeId);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${opts.episodeId}`);
      const { prefix, blocks, suffix } = splitScriptBlocks(ep.content ?? "");
      const raw = blocks.map((b) => b.raw);
      for (const op of opts.ops) {
        if (op.op === "append") {
          raw.push(...renderBlocks(op.blocks));
          continue;
        }
        if (op.op === "delete") {
          const count = op.count ?? 1;
          if (op.index < 0 || op.index >= raw.length) {
            throw new McpError("VALIDATION", `块下标越界: ${op.index}（当前 ${raw.length} 块）`);
          }
          raw.splice(op.index, Math.min(count, raw.length - op.index));
          continue;
        }
        if (op.index < 0 || op.index > raw.length || (op.op === "replace" && op.index === raw.length)) {
          throw new McpError("VALIDATION", `块下标越界: ${op.index}（当前 ${raw.length} 块）`);
        }
        const rendered = renderBlocks(op.blocks);
        if (op.op === "insert") raw.splice(op.index, 0, ...rendered);
        else raw.splice(op.index, 1, ...rendered);
      }
      ep.content = `${prefix}${raw.join("")}${suffix}`;
      updated = ep;
    },
  });
  return { ...res, episode: updated, blocks: listScriptBlocks(updated.content ?? "") };
}

/**
 * 写「本剧信息」（整部剧一句话概述 / 推荐标签），剧本页资产抽屉「本剧信息」分组展示。
 * 合并语义：只覆盖传入字段；baseVersion = script.json 当前 version。
 */
export async function setScriptMeta(
  root: string,
  projectId: string,
  opts: { baseVersion: number; meta: ScriptMeta; dryRun?: boolean },
): Promise<UpdateResult<ScriptEntity>> {
  return updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      s.meta = { ...(s.meta ?? {}), ...opts.meta };
    },
  });
}

/**
 * 写本集信息卡（一句话介绍 / 推荐标签 / 发布建议）。
 * 合并语义：只覆盖传入的字段（不传的保持原值；tags 整体替换）。
 * 目标集缺省 = activeEpisodeId；baseVersion = script.json 当前 version。
 */
export async function setEpisodeMeta(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    episodeId?: string;
    meta: EpisodeMeta;
    dryRun?: boolean;
  },
): Promise<UpdateResult<ScriptEntity> & { episode: Episode }> {
  let updated!: Episode;
  const res = await updateVersionedJson<ScriptEntity>(paths.script(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (s) => {
      const id = opts.episodeId ?? s.activeEpisodeId;
      const ep = s.episodes.find((e) => e.id === id);
      if (!ep) throw new McpError("NOT_FOUND", `episode 不存在: ${id}`);
      ep.meta = { ...(ep.meta ?? {}), ...opts.meta };
      updated = ep;
    },
  });
  return { ...res, episode: updated };
}

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
      // 编辑器只认 <p class="script-*"> 段落：纯文本/Markdown 必须先转 HTML，否则整段塌成一行
      const meta = splitScriptMeta(opts.content);
      const html = toScriptHtml(meta.body);
      if (meta.title && (!s.title || s.title === "剧本" || s.title === opts.title)) s.title = meta.title;
      if (opts.strategy === "overwrite") {
        s.episodes = [];
        s.episodes.push({
          id: `ep-${crypto.randomBytes(6).toString("hex")}`,
          number: 1,
          title: opts.title ?? meta.episodeTitle ?? autoEpisodeTitle(1),
          content: html,
          status: "draft",
        });
        s.activeEpisodeId = s.episodes[0].id;
      } else if (opts.strategy === "new_episode") {
        const n = nextEpisodeNumber(s);
        s.episodes.push({
          id: `ep-${crypto.randomBytes(6).toString("hex")}`,
          number: n,
          title: opts.title ?? meta.episodeTitle ?? autoEpisodeTitle(n),
          content: html,
          status: "draft",
        });
        s.activeEpisodeId = s.episodes[s.episodes.length - 1].id;
      } else {
        // append：追加到指定 episode 或 activeEpisode
        const targetId = opts.episodeId ?? s.activeEpisodeId;
        const ep = s.episodes.find((e) => e.id === targetId);
        if (!ep) throw new McpError("NOT_FOUND", `append 目标 episode 不存在: ${targetId}`);
        ep.content = ep.content ? `${ep.content}\n${html}` : html;
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
 * 剧本 → 片段草案。
 * - 前端格式（content 是 <p class="script-scene-heading">…</p>）：按场次标题切，一场一段；
 * - 纯文本：按场景标记（"场 A-1 …"/"场景X"/"第X场"/"SCENE"）切分，无标记时每 3 行归并。
 */
export function splitToSegmentDrafts(content: string): SegmentDraft[] {
  if (/<p[^>]*script-scene-heading/i.test(content)) return splitScriptHtmlByScene(content);

  const text = htmlToText(content);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // 场次标题可能是 Markdown 标题（"#### 场 A-1 …"）
  const sceneRe = /^(?:#{1,6}\s*)?(?:场景|场\s*[0-9A-Za-z一二三四五六七八九十]|第\s*.{1,4}\s*场|SCENE|镜头|shot)\b/i;
  // 有场次标记时从第一场开始，前面的大纲/人物表不参与切段
  const sceneStart = lines.findIndex((line) => sceneRe.test(line));
  const body = sceneStart > 0 ? lines.slice(sceneStart) : lines;
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const line of body) {
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
    // 场次标题即片段描述（正文由导演在提示词里补全）
    description: sceneRe.test(c[0]) ? c[0].replace(/^#{1,6}\s*/, "").trim() : c.join("；"),
    duration: 5,
  }));
}

/** HTML 剧本按 script-scene-heading 切场；一场一段，描述 = 场次标题 */
function splitScriptHtmlByScene(html: string): SegmentDraft[] {
  const textOf = (s: string): string =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  const drafts: SegmentDraft[] = [];
  for (const m of html.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const cls = m[1] ?? "";
    if (!/script-scene-heading/i.test(cls)) continue;
    const title = textOf(m[2] ?? "");
    if (!title) continue;
    drafts.push({ number: drafts.length + 1, description: title, duration: 5 });
  }
  return drafts;
}
