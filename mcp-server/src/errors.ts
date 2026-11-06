/** 统一错误码与错误类型。所有工具把错误包装成 { error: { code, message, details? } } 返回。 */

export type McpErrorCode =
  | "AUTH_INVALID"
  | "AUTH_FORBIDDEN"
  | "AUTH_PROJECT_DENIED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "VALIDATION"
  | "CONFIRM_REQUIRED"
  | "SLOT_OVERFLOW"
  | "IO_ERROR"
  | "NOT_IMPLEMENTED";

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export function toErrorResult(err: unknown) {
  const e =
    err instanceof McpError
      ? err
      : new McpError("IO_ERROR", err instanceof Error ? err.message : String(err));
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code: e.code, message: e.message, details: e.details ?? null } }, null, 2),
      },
    ],
  };
}

export function okResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
