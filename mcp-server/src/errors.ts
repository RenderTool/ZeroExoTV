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

/** MCP 原生图片内容块（模型可直接看到图片，而不是一串 base64 文本）。 */
export interface McpImageResult {
  __mcpContent: true;
  content: Array<{ type: "image"; data: string; mimeType: string }>;
}

export function imageResult(data: string, mimeType: string): McpImageResult {
  return { __mcpContent: true, content: [{ type: "image", data, mimeType }] };
}
