/** 资产域：list_assets / upload_asset / attach_asset_to_slot */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { listAssets, uploadToCas } from "../store/cas.js";
import { attachAssetToSlot } from "../store/workbench.js";
import { defTool, type Ctx } from "./_register.js";

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
      const res = await attachAssetToSlot(dataRoot(), args.projectId, args);
      return { written: res.written, version: res.after.version, ref: res.ref };
    },
  });
}
