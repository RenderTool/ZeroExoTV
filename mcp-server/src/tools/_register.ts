/** 工具注册公共封装：鉴权 → 执行 → 审计 → 统一错误格式。 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { authorize, type TokenRecord } from "../auth.js";
import { audit, summarizeArgs } from "../audit.js";
import { dataRoot } from "../config.js";
import { McpError, okResult, toErrorResult } from "../errors.js";
import { buildUpdateStatus, type UpdateStatus } from "../lib/update-check.js";

/** 本进程启动时刻（判断磁盘 dist 是否比进程新） */
export const PROCESS_STARTED_AT = Date.now();
let statusCache: { at: number; value: UpdateStatus } | null = null;

/**
 * MCP 自我更新感知（2026-11-11）：读网页写的 mcp-required.json，比对工具清单 / dist / 仓库落后。
 * 30 秒缓存，避免每个工具调用都读盘；失败一律不阻断工具主流程。
 */
export async function getUpdateStatus(root: string): Promise<UpdateStatus | null> {
  if (statusCache && Date.now() - statusCache.at < 30_000) return statusCache.value;
  try {
    const value = await buildUpdateStatus({
      root,
      tools: TOOL_REGISTRY,
      serverEntry: process.argv[1] ?? "",
      startedAtMs: PROCESS_STARTED_AT,
    });
    statusCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

export interface Ctx {
  /** stdio 模式返回 env token；HTTP 模式返回当前请求的 Authorization Bearer。 */
  getToken(): string | undefined;
}

export const TOOL_REGISTRY: string[] = [];
/** 真实读写分类（2026-11-09）：由 def.bits 派生，供 --selfcheck 输出，不再硬编码 9/12。 */
export const TOOL_ACCESS: Record<string, "read" | "write"> = {};

export interface ToolDef<S extends z.ZodRawShape> {
  name: string;
  description: string;
  bits: string[];
  schema: S;
  handler: (args: z.infer<z.ZodObject<S>>, token: TokenRecord) => Promise<unknown>;
}

export function defTool<S extends z.ZodRawShape>(server: McpServer, ctx: Ctx, def: ToolDef<S>): void {
  TOOL_REGISTRY.push(def.name);
  TOOL_ACCESS[def.name] = def.bits.some((b) => b.endsWith(".write")) ? "write" : "read";
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
        // 旧版 MCP 连上新网页：把「你该更新了」直接塞进工具返回，Agent 第一次调用就能感知
        let payload: unknown = out;
        const status = await getUpdateStatus(root);
        if (
          status?.hint
          && out && typeof out === "object" && !Array.isArray(out)
        ) {
          payload = {
            ...(out as Record<string, unknown>),
            _mcpOutdated: {
              missing: status.missing,
              distOutdated: status.distOutdated,
              gitBehind: status.gitBehind,
              hint: status.hint,
            },
          };
        }
        return okResult(payload);
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

/**
 * 用户确认闸门（2026-11-10 弱模型事故后加）：
 * confirm:true 只代表「Agent 决定落盘」，不代表「用户回答过关键问题」。
 * 批量导入类写工具额外要求 userConfirmed:true，缺了直接拒绝，并把该问的问题列给 Agent。
 */
export function guardUserConfirmed(
  args: { userConfirmed?: boolean },
  detail: string,
): void {
  if (args.userConfirmed === true) return;
  throw new McpError(
    "CONFIRM_REQUIRED",
    `${detail}：这是批量写操作，必须先调 preflight_import 拿到问题清单，逐条问用户并得到答复后，`
      + "再带 userConfirmed:true 重试。禁止替用户决定集数、来源格式或主体处理方式。",
  );
}

/**
 * 外部/英文源数据闸门：判定为英文原文时，Agent 还必须显式说明「用户已确认按 ZeroExo 规范重排」。
 * 只有 userConfirmed 不够——弱模型会拿别人的格式直接覆盖。
 */
export function guardForeignSource(
  analysis: { foreignLikely: boolean; language: string },
  args: { sourceFormatConfirmed?: boolean },
): void {
  if (!analysis.foreignLikely) return;
  if (args.sourceFormatConfirmed === true) return;
  throw new McpError(
    "CONFIRM_REQUIRED",
    "源文本判定为英文/外部平台格式（中文占比极低）。必须先问用户：按 ZeroExo 的「场次+动作+台词」重排，还是保持原文？"
      + "用户确认后带 sourceFormatConfirmed:true 重试。",
  );
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
