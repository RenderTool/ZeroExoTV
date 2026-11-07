/** 工具注册公共封装：鉴权 → 执行 → 审计 → 统一错误格式。 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { authorize, type TokenRecord } from "../auth.js";
import { audit, summarizeArgs } from "../audit.js";
import { dataRoot } from "../config.js";
import { McpError, okResult, toErrorResult } from "../errors.js";

export interface Ctx {
  /** stdio 模式返回 env token；HTTP 模式返回当前请求的 Authorization Bearer。 */
  getToken(): string | undefined;
}

export const TOOL_REGISTRY: string[] = [];

export interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  description: string;
  bits: string[];
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, token: TokenRecord) => Promise<unknown>;
}

export function defTool<S extends z.ZodRawShape>(server: McpServer, ctx: Ctx, def: ToolDef<S>): void {
  TOOL_REGISTRY.push(def.name);
  // zod v3 的 ZodRawShape 与 SDK ZodRawShapeCompat（Record<string, AnySchema>）结构兼容，做一次性断言
  const inputSchema = def.schema as unknown as ZodRawShapeCompat;
  server.registerTool(
    def.name,
    { description: def.description, inputSchema },
    async (rawArgs: unknown) => {
      const args = rawArgs as z.infer<z.ZodObject<S>>;
      const started = Date.now();
      const root = dataRoot();
      const raw = args as Record<string, unknown>;
      const projectId = typeof raw.projectId === "string" ? raw.projectId : undefined;
      let tokenId: string | undefined;
      try {
        const token = await authorize(root, ctx.getToken(), def.bits, projectId);
        tokenId = token.id;
        const out = await def.handler(args, token);
        audit(root, {
          tool: def.name, tokenId, projectId,
          argsSummary: summarizeArgs(raw), result: "ok", durationMs: Date.now() - started,
        });
        // 原生 image 内容块（read_asset 等）：直接透传，不包成文本 JSON
        if (out && typeof out === "object" && (out as { __mcpContent?: unknown }).__mcpContent === true) {
          return { content: (out as { content: unknown }).content as never };
        }
        return okResult(out);
      } catch (err) {
        const code = err instanceof McpError ? err.code : "IO_ERROR";
        audit(root, {
          tool: def.name, tokenId, projectId,
          argsSummary: summarizeArgs(raw), result: "error", code, durationMs: Date.now() - started,
        });
        return toErrorResult(err);
      }
    },
  );
}

/** dryRun 与 confirm 互斥；requireOne 时二者必须显式给其一（批量写入纪律）。 */
export function guardDryRunConfirm(
  args: { dryRun?: boolean; confirm?: boolean },
  opts?: { requireOne?: boolean },
): void {
  if (args.dryRun && args.confirm) throw new McpError("VALIDATION", "dryRun 与 confirm 互斥，只能二选一");
  if (opts?.requireOne && !args.dryRun && !args.confirm) {
    throw new McpError("CONFIRM_REQUIRED", "批量写入必须显式指定 dryRun:true（返回变更预览）或 confirm:true（真实落盘）");
  }
}

/** 简单字段级 diff（before/after 预览用），最多返回 50 条。 */
export function diffSummary(before: unknown, after: unknown, prefix = "", out: string[] = []): string[] {
  if (out.length >= 50) return out;
  if (JSON.stringify(before) === JSON.stringify(after)) return out;
  if (
    before && after && typeof before === "object" && typeof after === "object" &&
    !Array.isArray(before) && !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      diffSummary(
        (before as Record<string, unknown>)[k],
        (after as Record<string, unknown>)[k],
        prefix ? `${prefix}.${k}` : k,
        out,
      );
    }
    return out;
  }
  const fmt = (v: unknown) => {
    const s = JSON.stringify(v);
    return s && s.length > 80 ? `${s.slice(0, 77)}...` : s;
  };
  out.push(`${prefix}: ${fmt(before)} -> ${fmt(after)}`);
  return out;
}
