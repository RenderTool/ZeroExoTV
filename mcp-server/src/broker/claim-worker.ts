/**
 * 认领台账归档 worker（2026-11-17）。
 *
 * 生成在 ComfyUI 插件端跑；MCP 只做结果管理：
 *   - 轮询台账里 pending 的作业，读插件状态；
 *   - 成功 → 下载产物、落 CAS（media/cas/<sha256>.<ext>）、把 storageKey 写回台账；
 *   - 失败 → 记 error 并标 failed。
 * 网页关闭期间这个 worker 照常工作，所以重开网页时台账里已经有可用的 storageKey，
 * 网页只需要「认领」：按 claim.nodeId 建节点、按 sourceNodeId 连边。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../config.js";
import { downloadComfyOutput, resolveComfyBase } from "./comfy.js";
import { getImageJob } from "./plugin-client.js";
import { imageSize } from "./executor.js";
import { listClaims, updateClaim } from "../store/claims.js";

const POLL_MS = 5_000;

function mimeOf(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "image/png";
}

async function archiveOutput(base: string, outputPath: string): Promise<{
  storageKey: string;
  width?: number;
  height?: number;
  mimeType: string;
} | null> {
  const buf = await downloadComfyOutput(base, outputPath).catch(() => null);
  if (!buf || !buf.length) return null;
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const ext = (path.extname(outputPath) || ".png").toLowerCase();
  const rel = path.join("media", "cas", `${hash}${ext}`);
  const abs = path.join(dataRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf).catch(() => undefined);
  const size = imageSize(buf);
  return {
    storageKey: `cas:${hash}${ext}`,
    width: size.width,
    height: size.height,
    mimeType: mimeOf(ext),
  };
}

async function tick(): Promise<void> {
  const base = await resolveComfyBase().catch(() => null);
  if (!base) return;
  const claims = await listClaims().catch(() => []);
  for (const claim of claims) {
    if (claim.status !== "pending") continue;
    const job = await getImageJob(claim.jobId, base).catch(() => null);
    if (!job) continue;
    if (job.state === "error" || job.state === "interrupted") {
      await updateClaim(claim.claimId, { status: "failed", error: job.error || "执行失败" }).catch(() => null);
      continue;
    }
    if (job.state !== "success") continue;
    const first = (job.outputs ?? []).find((o) => o.path);
    if (!first?.path) {
      await updateClaim(claim.claimId, { status: "failed", error: "执行完成但没有产物" }).catch(() => null);
      continue;
    }
    const result = await archiveOutput(base, first.path).catch(() => null);
    if (!result) continue;
    await updateClaim(claim.claimId, { status: "landed", result }).catch(() => null);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startClaimWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch(() => undefined);
  }, POLL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopClaimWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
