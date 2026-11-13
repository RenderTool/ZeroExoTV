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
  | "NOT_IMPLEMENTED"
  /** 延续法：片段没有 plan_continuity_edit 计划就生成（2026-11-11） */
  | "CONTINUITY_NOT_PLANNED"
  /** 延续法：跳段 / 从中间开始，接不上上一段尾帧 */
  | "CONTINUITY_ORDER"
  /** 挂主体图前没读过这张图（2026-11-13：禁瞎配图） */
  | "IMAGE_REVIEW_REQUIRED"
  /** 挂主体图没带「从图反推的提示词」 */
  | "IMAGE_PROMPT_REQUIRED"
  /** 角色已有多张图，挂新图前必须确认同一演员（2026-11-13） */
  | "IDENTITY_CONFIRM_REQUIRED"
  /** 主体人设/场景/道具模板字段不全（2026-11-13） */
  | "SUBJECT_PROFILE_INCOMPLETE"
  /** 主体还没写人设模板（基础提示词为空）就想挂图（2026-11-13） */
  | "SUBJECT_PROFILE_REQUIRED";

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
