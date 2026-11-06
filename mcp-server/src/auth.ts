/**
 * 鉴权与作用域，落地 project-rules/docs/mcp-auth-scope-contract.md：
 * - zxp_ / zxs_ 前缀；SHA-256 哈希存储于 <dataRoot>/.mcp/tokens.json；
 * - 作用域 = projectIds × 能力位；跨项目越权拒绝（AUTH_PROJECT_DENIED）。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { McpError } from "./errors.js";
import { paths } from "./config.js";

export interface TokenRecord {
  id: string;
  hash: string;
  prefix: "zxp" | "zxs";
  projectIds: string[] | "*";
  bits: string[];
  createdAt: string;
  note?: string;
  /** 撤销时间（由前端 MCP 设置页写入）；存在即失效，校验实时读取本文件 */
  revokedAt?: string;
}

interface TokenFile {
  schemaVersion: 1;
  tokens: TokenRecord[];
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function loadTokens(root: string): Promise<TokenRecord[]> {
  try {
    const raw = await fs.readFile(paths.tokens(root), "utf8");
    return (JSON.parse(raw) as TokenFile).tokens ?? [];
  } catch {
    return [];
  }
}

async function saveTokens(root: string, tokens: TokenRecord[]): Promise<void> {
  const p = paths.tokens(root);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ schemaVersion: 1, tokens } satisfies TokenFile, null, 2), "utf8");
}

/** bootstrap：tokens.json 为空且环境变量 ZEROEXO_MCP_TOKEN 有值时登记为全权限 zxp token。 */
export async function bootstrapToken(root: string): Promise<TokenRecord | null> {
  const raw = process.env.ZEROEXO_MCP_TOKEN;
  if (!raw) return null;
  const existing = await loadTokens(root);
  if (existing.length > 0) return null;
  const rec: TokenRecord = {
    id: `tok-${crypto.randomBytes(6).toString("hex")}`,
    hash: hashToken(raw),
    prefix: raw.startsWith("zxs_") ? "zxs" : "zxp",
    projectIds: "*",
    bits: [
      "project.read", "project.write",
      "script.read", "script.write",
      "split.write",
      "subject.read", "subject.write",
      "asset.read", "asset.write",
      "workbench.read", "workbench.write",
    ],
    createdAt: new Date().toISOString(),
    note: "bootstrap from ZEROEXO_MCP_TOKEN",
  };
  await saveTokens(root, [rec]);
  return rec;
}

/**
 * 校验顺序（契约 §2）：
 * 1. token 哈希命中 → 否则 AUTH_INVALID
 * 2. 所需能力位 ⊆ token.bits → 否则 AUTH_FORBIDDEN
 * 3. projectId ∈ token.projectIds（"*" 通配）→ 否则 AUTH_PROJECT_DENIED
 */
export async function authorize(
  root: string,
  rawToken: string | undefined,
  requiredBits: string[],
  projectId?: string,
): Promise<TokenRecord> {
  if (!rawToken) throw new McpError("AUTH_INVALID", "缺少 token（stdio 模式请设置 ZEROEXO_MCP_TOKEN）");
  const tokens = await loadTokens(root);
  const rec = tokens.find((t) => t.hash === hashToken(rawToken));
  if (!rec) throw new McpError("AUTH_INVALID", "token 无效");
  if (rec.revokedAt) throw new McpError("AUTH_INVALID", "token 已撤销", { revokedAt: rec.revokedAt });

  const missing = requiredBits.filter((b) => !rec.bits.includes(b));
  if (missing.length > 0) {
    throw new McpError("AUTH_FORBIDDEN", `能力位不足：缺少 ${missing.join(", ")}`, { missing });
  }
  if (projectId && rec.projectIds !== "*" && !rec.projectIds.includes(projectId)) {
    throw new McpError("AUTH_PROJECT_DENIED", `token 无权访问项目 ${projectId}`, {
      projectId,
      allowed: rec.projectIds,
    });
  }
  return rec;
}
