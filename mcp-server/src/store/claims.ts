/**
 * 认领台账（2026-11-17）：MCP 只做代理发起，不执行生成、不维护第二张任务表。
 *
 * 一次提交写给插件一条 job，同时在这里记一条「认领记录」：
 *   jobId ↔ 项目 / 目标节点 / 上游参考图 / 所属主体 / 参数
 * 网页打开或刷新项目时读这份台账，把还没认领的 job 接回节点，恢复进度、采样预览与成品。
 * 台账落数据根 .lf/zeroexo/app_meta/claims/，与插件 output/zeroexo/tasks 分开，不争事实源：
 * 任务状态只认插件，这里只记「这次是谁、要落到哪个节点/主体」。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../config.js";

export type ClaimStatus = "pending" | "landed" | "failed";

export interface ClaimRecord {
  schemaVersion: 1;
  claimId: string;
  jobId: string;
  projectId: string;
  /** canvas_video：图生视频/参考主体生视频，上游参考图节点 → 视频节点，再发起批次任务 */
  kind: "canvas_image" | "subject_image" | "canvas_video";
  /** 网页应创建/复用的下游节点 id（幂等键） */
  nodeId: string;
  /** 图生图上游节点 id：网页认领时按它补 image → prompt 的边 */
  sourceNodeId?: string;
  /** 上游参考图 storageKey（没有节点时用于先落参考图节点） */
  sourceStorageKey?: string;
  prompt: string;
  model: "qwen" | "krea2" | "moss";
  params: Record<string, unknown>;
  /** 主体发起生成时带上，结果回挂该主体状态图 */
  subject?: { subjectId: string; stateTag?: string };
  status: ClaimStatus;
  /** MCP 结果归档：插件产物下载后落 CAS，网页认领时直接用这个键建节点 */
  result?: { storageKey: string; width?: number; height?: number; mimeType?: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

function claimsDir(root = dataRoot()): string {
  return path.join(root, ".lf", "zeroexo", "app_meta", "claims");
}

function claimPath(claimId: string, root = dataRoot()): string {
  return path.join(claimsDir(root), `${claimId}.json`);
}

export function newClaimId(): string {
  return `clm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function writeClaim(rec: ClaimRecord): Promise<ClaimRecord> {
  await writeJsonAtomic(claimPath(rec.claimId), rec);
  return rec;
}

export async function readClaim(claimId: string): Promise<ClaimRecord | null> {
  const raw = await fs.readFile(claimPath(claimId), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClaimRecord;
  } catch {
    return null;
  }
}

/** 按插件 jobId 找认领记录（查询/取消都靠它把 job 翻译回项目与节点） */
export async function findClaimByJob(jobId: string): Promise<ClaimRecord | null> {
  const all = await listClaims();
  return all.find((c) => c.jobId === jobId) ?? null;
}

export async function listClaims(projectId?: string): Promise<ClaimRecord[]> {
  const dir = claimsDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: ClaimRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(dir, name), "utf8").catch(() => null);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as ClaimRecord;
      if (!rec?.claimId || !rec?.jobId) continue;
      if (projectId && rec.projectId !== projectId) continue;
      out.push(rec);
    } catch {
      /* 单个损坏文件跳过，不阻断列表 */
    }
  }
  out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return out;
}

export async function updateClaim(claimId: string, patch: Partial<ClaimRecord>): Promise<ClaimRecord | null> {
  const rec = await readClaim(claimId);
  if (!rec) return null;
  const next: ClaimRecord = { ...rec, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(claimPath(claimId), next);
  return next;
}
