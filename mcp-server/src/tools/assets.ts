/** 资产域：list_assets / upload_asset / attach_asset_to_slot / read_asset / import_media_to_cas */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError, imageResult } from "../errors.js";
import { markImageReviewed } from "../lib/image-review.js";
import { listAssets, uploadToCas } from "../store/cas.js";
import { attachAssetToSlot } from "../store/workbench.js";
import { defTool, type Ctx } from "./_register.js";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4",
};

/** storageKey → 候选磁盘路径（image:/video:/audio: 相对数据根；cas: → media/cas；纯 id → .lf blob） */
function resolveAssetCandidates(root: string, storageKey: string): Array<{ abs: string; mime: string }> {
  const i = storageKey.indexOf(":");
  if (i < 0) throw new McpError("VALIDATION", "storageKey 必须是 image:/video:/audio:/cas: 前缀");
  const kind = storageKey.slice(0, i);
  const rest = storageKey.slice(i + 1);
  const rootAbs = path.resolve(root);

  if (kind === "cas") {
    if (!/^[0-9a-f]{64}\.[a-z0-9]+$/i.test(rest)) throw new McpError("VALIDATION", `非法 CAS 键: ${storageKey}`);
    const abs = path.join(rootAbs, "media", "cas", rest);
    const ext = path.extname(rest).slice(1).toLowerCase();
    return [{ abs, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" }];
  }
  if (kind !== "image" && kind !== "video" && kind !== "audio") {
    throw new McpError("VALIDATION", `不支持的 storageKey 前缀: ${kind}`);
  }
  if (rest.includes("/") || rest.includes("\\")) {
    if (rest.includes("..") || path.isAbsolute(rest)) throw new McpError("VALIDATION", `非法路径: ${storageKey}`);
    const abs = path.resolve(rootAbs, rest);
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) throw new McpError("VALIDATION", `路径越界: ${storageKey}`);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return [{ abs, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" }];
  }
  // 纯 id（如 image:Cy9tzXuWodVlovTTOPRXP）：前端存在 .lf 的 blob 缓存里
  const enc = encodeURIComponent(storageKey);
  return [
    { abs: path.join(rootAbs, ".lf", "zeroexo", "image_files", `${enc}.blob`), mime: "image/png" },
    { abs: path.join(rootAbs, ".lf", "zeroexo", "media_files", `${enc}.blob`), mime: "application/octet-stream" },
  ];
}

/** 按文件头纠正 mime（blob 文件没有扩展名） */
function sniffImageMime(buf: Buffer, fallback: string): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return fallback;
}

/** 依次尝试候选路径读文件，返回第一个命中的内容与 mime */
async function readFirstCandidate(
  root: string,
  storageKey: string,
): Promise<{ buf: Buffer; mime: string; abs: string }> {
  const candidates = resolveAssetCandidates(root, storageKey);
  for (const candidate of candidates) {
    try {
      const buf = await fs.readFile(candidate.abs);
      const mime = candidate.mime.startsWith("image/") ? sniffImageMime(buf, candidate.mime) : candidate.mime;
      return { buf, mime, abs: candidate.abs };
    } catch {
      // 继续下一个候选
    }
  }
  throw new McpError("NOT_FOUND", `文件不存在: ${storageKey}`);
}

export function registerAssetTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_assets",
    description: "列出 CAS 资产。scope=project：refs 含本项目的条目；scope=library：全局去重视图。",
    bits: ["asset.read"],
    schema: {
      projectId: z.string(),
      scope: z.enum(["project", "library"]).default("project"),
    },
    handler: async (args) => ({
      scope: args.scope,
      assets: await listAssets(dataRoot(), args.scope, args.projectId),
    }),
  });

  defTool(server, ctx, {
    name: "upload_asset",
    description:
      "上传资产（base64）到 CAS：SHA-256 去重（已存在仅 refCount+1），维护 cas_index 不变量，返回 storageKey='cas:<hash>.<ext>'。",
    bits: ["asset.write"],
    schema: {
      projectId: z.string(),
      filename: z.string().min(1),
      dataBase64: z.string().min(1),
      mime: z.string().min(1),
      /** 素材显示名（缺省用文件名去扩展名） */
      title: z.string().optional(),
      /** 进素材库（素材页可见）。默认 false：主体状态图只落 CAS，由主体库引用 */
      toLibrary: z.boolean().optional(),
      /** CAS 记账身份（主体图传 subject-state:<subjectId>/<state>，与前端同口径） */
      refId: z.string().optional(),
    },
    handler: async (args) => uploadToCas(dataRoot(), args),
  });

  defTool(server, ctx, {
    name: "attach_asset_to_slot",
    description:
      "把 CAS 资产挂到导演台槽位：给 shotId → 片段槽（K+1 续排）；不给 → 公共槽（1..K）。超限返回 SLOT_OVERFLOW。baseVersion = workbench version。",
    bits: ["asset.write", "workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      storageKey: z.string().regex(/^cas:[0-9a-f]{64}\.\w+$/),
      name: z.string().optional(),
      shotId: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await attachAssetToSlot(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        storageKey: args.storageKey,
        title: args.name,
        shotId: args.shotId,
        dryRun: args.dryRun,
      });
      return { written: res.written, version: res.after.version, ref: res.ref };
    },
  });

  defTool(server, ctx, {
    name: "read_asset",
    description:
      "读取画布/资产文件内容：图片直接返回 MCP image 内容块（模型可见）；视频/音频返回元数据（大小、mime），不塞 base64。storageKey 来自 get_canvas 节点 data.storageKey / list_assets（image:/video:/audio:/cas:）。" +
      "**给主体挂状态图之前必须先调用本工具真正看图**（set_subject_image 只认本次会话读过的图）。",
    bits: ["asset.read"],
    schema: {
      projectId: z.string(),
      storageKey: z.string().min(1),
    },
    handler: async (args, token) => {
      const { buf, mime } = await readFirstCandidate(dataRoot(), args.storageKey);
      if (mime.startsWith("image/")) {
        markImageReviewed(token.id, args.storageKey);
        return imageResult(buf.toString("base64"), mime);
      }
      return {
        storageKey: args.storageKey,
        mimeType: mime,
        bytes: buf.length,
        note: mime.startsWith("video/") || mime.startsWith("audio/") ? "媒体文件只读元数据（不返回 base64）" : undefined,
      };
    },
  });

  defTool(server, ctx, {
    name: "import_media_to_cas",
    description:
      "把画布里的文件（storageKey=image:/video:/audio:）导入 CAS，返回 cas:<hash>.<ext>；得到 CAS 键后即可 set_subject_image 挂成主体状态图。默认不进素材库。",
    bits: ["asset.write"],
    schema: {
      projectId: z.string(),
      storageKey: z.string().min(1),
      title: z.string().optional(),
      toLibrary: z.boolean().optional(),
      refId: z.string().optional(),
    },
    handler: async (args) => {
      const { buf, mime } = await readFirstCandidate(dataRoot(), args.storageKey);
      const res = await uploadToCas(dataRoot(), {
        projectId: args.projectId,
        filename: path.basename(args.storageKey.replace(/^[a-z]+:/, "")),
        dataBase64: buf.toString("base64"),
        mime,
        title: args.title,
        toLibrary: args.toLibrary,
        refId: args.refId,
      });
      return { ...res, sourceStorageKey: args.storageKey };
    },
  });
}
