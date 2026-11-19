/**
 * 项目档案（需求 / 决策 / 进度 / 待办）——2026-11-19 用户口径：
 * 换会话、换 LLM、关机重启后，任何接入方先读这份，不要靠会话记忆重复描述需求。
 * 落点：projects/<pid>/entities/project-log.json（随项目一起备份/迁移）。
 */

import path from "node:path";
import { paths } from "../config.js";
import { updateVersionedJson } from "./fs-node.js";

export type LogKind = "requirement" | "decision" | "progress" | "todo" | "artifact";

/** 产物审核（2026-11-19 用户口径）：审核发生在 Agent 对话里，网页「需求」页只是这份记录的记忆体。 */
export type ReviewVerdict = "pending" | "approved" | "rejected";
export interface ReviewItem {
  id: string;
  title: string;
  kind: "text" | "image" | "video";
  subjectId?: string;
  storageKey?: string;
  summary?: string;
  verdict: ReviewVerdict;
  score?: number;
  note?: string;
}
export interface ReviewBatch {
  stage: "concept" | "script" | "subjects" | "shots" | "video";
  items: ReviewItem[];
  decidedAt?: string;
}

export interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  status: "open" | "review" | "done" | "dropped";
  at: string;
  by?: string;
  refs?: string[];
  /** 结构化审核批次（kind=artifact 时）。网页只渲染，不接受在网页里点采纳/打回。 */
  review?: ReviewBatch;
}

export type PhaseStatus = "pending" | "working" | "review" | "done" | "blocked";
export interface PipelinePhase {
  key: string;
  label: string;
  status: PhaseStatus;
  note?: string;
  updatedAt?: string;
}
export interface PipelineState {
  active: boolean;
  agent?: string;
  phase?: string;
  note?: string;
  updatedAt?: string;
  phases: PipelinePhase[];
}

const DEFAULT_PHASES: PipelinePhase[] = [
  { key: "script", label: "剧本", status: "pending" },
  { key: "subjects", label: "主体", status: "pending" },
  { key: "shots", label: "分镜", status: "pending" },
  { key: "generate", label: "生成", status: "pending" },
  { key: "review", label: "审核", status: "pending" },
];

export interface ProjectLog {
  title: string;
  version: number;
  updatedAt: string;
  entries: LogEntry[];
  pipeline: PipelineState;
}

const EMPTY: ProjectLog = { title: "项目档案", version: 0, updatedAt: "", entries: [], pipeline: { active: false, phases: DEFAULT_PHASES } };

function logPath(projectId: string, root: string) {
  return path.join(paths.entitiesDir(projectId, root), "project-log.json");
}

export async function readProjectLog(root: string, projectId: string): Promise<ProjectLog> {
  const p = logPath(projectId, root);
  const { readJsonIfExists } = await import("./fs-node.js");
  const data = await readJsonIfExists<ProjectLog>(p);
  if (!data) return { ...EMPTY, entries: [], pipeline: { ...EMPTY.pipeline, phases: DEFAULT_PHASES } };
  return {
    ...EMPTY,
    ...data,
    entries: Array.isArray(data.entries) ? data.entries : [],
    pipeline: {
      ...EMPTY.pipeline,
      ...(data.pipeline ?? {}),
      phases: data.pipeline?.phases?.length ? data.pipeline.phases : DEFAULT_PHASES,
    },
  };
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
        review: opts.entry.review,
      });
    },
  });
}

const VERDICT_LABEL: Record<ReviewVerdict, string> = { pending: "待审核", approved: "已采纳", rejected: "已打回" };
const STAGE_LABEL: Record<ReviewBatch["stage"], string> = {
  concept: "概念设计（场景概念图）",
  script: "剧本",
  subjects: "主体生成（角色/场景/道具）",
  shots: "剧本→分镜处理",
  video: "视频出片",
};

/** 把审核批次摊成人类可读文本（网页需求页直接显示这段，不显示操作按钮） */
export function formatReviewText(batch: ReviewBatch): string {
  const lines = batch.items.map((it, i) => {
    const meta = [it.kind === "image" ? "图片" : it.kind === "video" ? "视频" : "文本"];
    if (it.storageKey) meta.push(it.storageKey.slice(0, 26));
    if (it.score) meta.push(`评分 ${it.score}/5`);
    const tail = it.verdict === "pending" ? "" : ` → ${VERDICT_LABEL[it.verdict]}${it.note ? `（${it.note}）` : ""}`;
    return `${i + 1}. ${it.title}［${meta.join(" · ")}］${tail}`;
  });
  const counts = {
    approved: batch.items.filter((i) => i.verdict === "approved").length,
    rejected: batch.items.filter((i) => i.verdict === "rejected").length,
    pending: batch.items.filter((i) => i.verdict === "pending").length,
  };
  return `【待审核·${STAGE_LABEL[batch.stage]}】${batch.items.length} 项（已采纳 ${counts.approved} / 已打回 ${counts.rejected} / 待审核 ${counts.pending}）\n${lines.join("\n")}`;
}

/** 开一批审核：只写记忆（project-log），审核动作仍然由 Agent 在对话里向用户收集。 */
export async function openReviewBatch(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    stage: ReviewBatch["stage"];
    items: Array<Omit<ReviewItem, "verdict"> & { verdict?: ReviewVerdict }>;
    note?: string;
    dryRun?: boolean;
  },
) {
  const batch: ReviewBatch = {
    stage: opts.stage,
    items: opts.items.map((i) => ({ ...i, verdict: i.verdict ?? "pending" })),
  };
  const res = await updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => ({ ...EMPTY, entries: [] }),
    dryRun: opts.dryRun,
    mutate: (log) => {
      const now = new Date().toISOString();
      log.entries.push({
        id: `log-${Date.now().toString(36)}-review`,
        at: now,
        kind: "artifact",
        status: "review",
        text: `${opts.note ? `${opts.note}\n` : ""}${formatReviewText(batch)}`,
        refs: batch.items.map((i) => i.id),
        review: batch,
      });
      log.updatedAt = now;
    },
  });
  const log = await readProjectLog(root, projectId);
  return { ...res, entry: log.entries[log.entries.length - 1], batch };
}

/** 落库用户评分：approve = 正式入库；reject = 打回（由调用方负责真删产物）。 */
export async function applyReviewDecisions(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    entryId: string;
    decisions: Array<{ itemId: string; verdict: "approved" | "rejected"; score?: number; note?: string }>;
    dryRun?: boolean;
  },
) {
  let result: { approved: string[]; rejected: string[] } = { approved: [], rejected: [] };
  const res = await updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    dryRun: opts.dryRun,
    mutate: (log) => {
      const entry = log.entries.find((e) => e.id === opts.entryId);
      if (!entry) throw new Error(`审核条目不存在: ${opts.entryId}`);
      const batch = entry.review;
      if (!batch) throw new Error(`条目不是审核批次: ${opts.entryId}`);
      for (const d of opts.decisions) {
        const item = batch.items.find((i) => i.id === d.itemId);
        if (!item) throw new Error(`审核项不存在: ${d.itemId}`);
        item.verdict = d.verdict;
        if (d.score !== undefined) item.score = d.score;
        if (d.note) item.note = d.note;
        (d.verdict === "approved" ? result.approved : result.rejected).push(item.id);
      }
      const pending = batch.items.filter((i) => i.verdict === "pending").length;
      batch.decidedAt = new Date().toISOString();
      entry.status = pending === 0 ? "done" : "review";
      entry.text = formatReviewText(batch);
      log.updatedAt = new Date().toISOString();
    },
  });
  return { ...res, ...result };
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

/** 更新流水线阶段状态，并标记 MCP 是否正在代理工作（网页据此自动切到「需求」并提示） */
export async function setPipelineState(
  root: string,
  projectId: string,
  opts: {
    baseVersion: number;
    phase?: string;
    status?: PhaseStatus;
    active?: boolean;
    note?: string;
    agent?: string;
    dryRun?: boolean;
  },
) {
  return updateVersionedJson<ProjectLog>(logPath(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => ({ ...EMPTY, entries: [], pipeline: { ...EMPTY.pipeline, phases: DEFAULT_PHASES } }),
    dryRun: opts.dryRun,
    mutate: (log) => {
      const now = new Date().toISOString();
      const phases = log.pipeline?.phases?.length ? log.pipeline.phases : DEFAULT_PHASES;
      if (opts.phase) {
        const idx = phases.findIndex((p) => p.key === opts.phase);
        if (idx >= 0) {
          phases[idx] = {
            ...phases[idx],
            status: opts.status ?? phases[idx].status,
            note: opts.note ?? phases[idx].note,
            updatedAt: now,
          };
        }
      }
      log.pipeline = {
        ...(log.pipeline ?? { active: false, phases }),
        active: opts.active ?? log.pipeline?.active ?? false,
        phase: opts.phase ?? log.pipeline?.phase,
        note: opts.note ?? log.pipeline?.note,
        agent: opts.agent ?? log.pipeline?.agent,
        updatedAt: now,
        phases,
      };
      log.updatedAt = now;
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
