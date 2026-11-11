/** 画布域：list_canvases / get_canvas / patch_canvas_nodes（Spec v2 / 征集#184，2026-11-06） */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { getCanvas, listCanvases, MAIN_CANVAS_ID, patchCanvasNodes } from "../store/canvases.js";
import { defTool, diffSummary, type Ctx } from "./_register.js";

const nodePatchSchema = z.object({
  nodeId: z.string().min(1),
  data: z.record(z.unknown()).optional(),
  title: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export function registerCanvasTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "list_canvases",
    description:
      "列出项目下的全部画布（1 号主画布 + N 份副本；均归属本项目，不在首页项目列表里）。返回标题、节点/连线数、更新时间、是否可写。数据源 = projects/<pid>/canvases/*.json 与 .lf 主 graph，与前端画布同源。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const items = await listCanvases(dataRoot(), args.projectId);
      return { count: items.length, canvases: items };
    },
  });

  defTool(server, ctx, {
    name: "get_canvas",
    description:
      "读取一份画布（canvasId 缺省 = 'main' 即 1 号主画布）。includeGraph=false 只返回标题与统计摘要。1 号也可读。",
    bits: ["project.read"],
    schema: {
      projectId: z.string(),
      canvasId: z.string().optional(),
      includeGraph: z.boolean().optional(),
    },
    handler: async (args) => {
      const canvasId = args.canvasId ?? MAIN_CANVAS_ID;
      const doc = await getCanvas(dataRoot(), args.projectId, canvasId);
      if (!doc) {
        throw new McpError("NOT_FOUND", `画布不存在: ${args.projectId}/${canvasId}`, {
          projectId: args.projectId,
          canvasId,
        });
      }
      if (args.includeGraph === false) {
        const { graph, ...rest } = doc;
        return {
          ...rest,
          nodeCount: Array.isArray(graph?.nodes) ? graph!.nodes!.length : 0,
          edgeCount: Array.isArray(graph?.edges) ? graph!.edges!.length : 0,
        };
      }
      return doc;
    },
  });

  defTool(server, ctx, {
    name: "patch_canvas_nodes",
    description:
      "给**副本画布**的既有节点打补丁（data 浅合并 / title 覆盖 / position 覆盖）。写纪律：size+mtime 双因子乐观锁 + version+1，与前端并发时后写者拿 VERSION_CONFLICT。任一 nodeId 不存在则整体不写并回 missingNodeIds。dryRun:true 只返回字段级 diff。**1 号主画布只读**（前端防抖自动保存，外部写会互相覆盖）；**不做结构性增删节点或连线**。要在画布上新增图/改图，用 generate_canvas_images / edit_canvas_image（网页在线时由网页在实时画布建下游节点），不要试图用本工具造节点。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      canvasId: z.string(),
      patches: z.array(nodePatchSchema).min(1),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await patchCanvasNodes(dataRoot(), args.projectId, args.canvasId, {
        patches: args.patches as Parameters<typeof patchCanvasNodes>[3]["patches"],
        dryRun: args.dryRun,
      });
      return {
        written: res.written,
        dryRun: !!args.dryRun,
        canvasId: res.canvasId,
        patchedNodeIds: res.patchedNodeIds,
        nodeCount: res.nodeCount,
        edgeCount: res.edgeCount,
        version: res.after.version,
        updatedAt: res.after.updatedAt,
        // 字段级 diff（before → after）：dryRun 时是预览，真实写入时用于核对落盘结果
        changed: diffSummary(res.before, res.after),
      };
    },
  });
}
