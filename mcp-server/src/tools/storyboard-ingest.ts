/** 分镜图智能比对（M1 接口预留）：ingest_storyboard_images。M1 只返回待确认清单，不落盘。 */

import crypto from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readCasIndex } from "../store/cas.js";
import { readWorkbench } from "../store/workbench.js";
import { defTool, type Ctx } from "./_register.js";

export function registerStoryboardIngestTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "ingest_storyboard_images",
    description:
      "提交分镜图片做智能比对。matchStrategy=hash：SHA-256 比对 CAS 索引返回候选；perceptual：M2 才支持（返回 NOT_IMPLEMENTED）；manual：仅登记待确认。M1 一律不落盘，返回 status=pending_confirm 清单。",
    bits: ["asset.read", "workbench.read"],
    schema: {
      projectId: z.string(),
      episodeId: z.string().optional(),
      shotIds: z.array(z.string()).optional(),
      images: z.array(z.object({ filename: z.string(), dataBase64: z.string() })).min(1),
      matchStrategy: z.enum(["hash", "perceptual", "manual"]).default("hash"),
    },
    handler: async (args) => {
      if (args.matchStrategy === "perceptual") {
        throw new McpError("NOT_IMPLEMENTED", "perceptual 感知哈希比对规划在 M2，请先用 hash 或 manual");
      }
      const wb = await readWorkbench(dataRoot(), args.projectId);
      const validShotIds = new Set((wb?.shots ?? []).map((s) => s.id));
      if (args.shotIds) {
        const bad = args.shotIds.filter((id) => !validShotIds.has(id));
        if (bad.length > 0) throw new McpError("NOT_FOUND", `导演台片段不存在: ${bad.join(", ")}`);
      }
      const cas = await readCasIndex(dataRoot());
      const items = args.images.map((img, i) => {
        const hash = crypto.createHash("sha256").update(Buffer.from(img.dataBase64, "base64")).digest("hex");
        const entry = cas.entries[hash];
        return {
          index: i,
          filename: img.filename,
          hash,
          shotId: args.shotIds?.[i] ?? null,
          candidates:
            args.matchStrategy === "hash" && entry
              ? [{ storageKey: `cas:${hash}.${entry.ext}`, confidence: 1.0 }]
              : [],
          status: "pending_confirm" as const,
        };
      });
      return {
        written: false,
        matchStrategy: args.matchStrategy,
        pendingCount: items.length,
        items,
        note: "M1 不落盘；确认后请用 upload_asset + attach_asset_to_slot 正式录入",
      };
    },
  });
}
