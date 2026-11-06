/** 审计：追加写 <dataRoot>/.audit/mcp-<YYYY-MM-DD>.jsonl，一行一条。失败不阻塞主流程。 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { paths } from "./config.js";

export interface AuditEntry {
  tool: string;
  tokenId?: string;
  projectId?: string;
  argsSummary?: Record<string, unknown>;
  result: "ok" | "error";
  code?: string;
  durationMs: number;
}

/** args 摘要白名单：只保留标识类字段，不记录剧本正文 / prompt 全文 / asset base64。 */
const SAFE_KEYS = new Set([
  "projectId", "episodeId", "shotId", "subjectId", "shotIds",
  "strategy", "dryRun", "confirm", "kind", "scope", "matchStrategy",
  "title", "filename", "mime", "storageKey", "presetId",
]);

export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else out[k] = v;
  }
  return out;
}

export function audit(root: string, entry: AuditEntry): void {
  try {
    const dir = paths.auditDir(root);
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    appendFileSync(path.join(dir, `mcp-${day}.jsonl`), line, "utf8");
  } catch (err) {
    process.stderr.write(`[mcp-server] audit write failed: ${(err as Error).message}\n`);
  }
}
