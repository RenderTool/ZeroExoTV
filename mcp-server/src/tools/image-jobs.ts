/**
 * 画布图片生成作业桥（2026-11-11）：MCP 写作业文件 → 网页画布在线时自动建节点、生成、落历史。
 *
 * 为什么不是 MCP 直接写画布：1 号主画布由浏览器防抖自动保存，外部直接写 JSON 会互相覆盖；
 * 所以 MCP 只把「要生成什么」投递到共享数据目录，由网页端消费并把结果写进**当前实时画布**。
 */
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { defTool, type Ctx } from "./_register.js";

const JOBS_DIR = path.join(".lf", "zeroexo", "app_meta", "image-jobs");

const requestSchema = z.object({
  prompt: z.string().min(1),
  model: z.enum(["moss", "krea2", "qwen"]).default("moss"),
  title: z.string().optional(),
  aspect: z.string().optional().describe("比例：1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9"),
  megapixels: z.number().min(0.5).max(4).optional().describe("百万像素（1MP = 1024×1024）"),
  steps: z.number().int().min(1).max(100).optional(),
  seed: z.number().int().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  negative_prompt: z.string().optional(),
  /** 改图：原图 storageKey（cas: 或 image:）。给了就走向图生图（Qwen 编辑），新建下游节点，不覆盖原图 */
  sourceStorageKey: z.string().optional(),
  /** 改图：也可以直接给画布节点 id，由网页读取该节点的 storageKey/content */
  sourceNodeId: z.string().optional(),
  /** 可选遮罩 storageKey（白=重绘区） */
  maskStorageKey: z.string().optional(),
});

function jobPath(root: string, jobId: string): string {
  return path.join(root, JOBS_DIR, `${jobId}.json`);
}

function statusPath(root: string, jobId: string): string {
  return path.join(root, JOBS_DIR, `${jobId}.status.json`);
}

export function registerImageJobTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "generate_canvas_images",
    description:
      "在**当前打开的画布**上批量生成或改图：写一份作业到共享目录，网页画布在线时自动创建**下游新节点**、调用 ComfyUI 生成并把结果写进实时画布与历史。" +
      "纯文生图 model=moss/krea2/qwen；**改图（图生图）传 sourceStorageKey 或 sourceNodeId**（走 Qwen 图片编辑，必须描述「只改什么、其余保持不变」）。" +
      "绝不覆盖原图/原节点。每张图可独立指定 prompt、比例、百万像素、步数、种子。" +
      "投递后用 get_canvas_image_job 轮询进度。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      requests: z.array(requestSchema).min(1).max(24),
      jobId: z.string().optional(),
    },
    handler: async (args) => {
      const root = dataRoot();
      const projectDir = path.join(root, "projects", args.projectId);
      const exists = await fs.stat(projectDir).then(() => true).catch(() => false);
      if (!exists) throw new McpError("NOT_FOUND", `项目不存在: ${args.projectId}`);
      const jobId = args.jobId?.trim() || `zxjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        schemaVersion: 1,
        jobId,
        projectId: args.projectId,
        createdAt: new Date().toISOString(),
        requests: args.requests.map((r, i) => ({ ...r, index: i })),
      };
      await fs.mkdir(path.join(root, JOBS_DIR), { recursive: true });
      await fs.writeFile(jobPath(root, jobId), JSON.stringify(payload, null, 2), "utf8");
      return {
        jobId,
        queued: payload.requests.length,
        jobFile: path.join(JOBS_DIR, `${jobId}.json`),
        hint: "网页画布需打开同一项目且在线；每 2 秒轮询一次，用 get_canvas_image_job({ projectId, jobId }) 看进度",
      };
    },
  });

  defTool(server, ctx, {
    name: "get_canvas_image_job",
    description: "查询 generate_canvas_images 投递的作业进度（网页端写回的状态文件）。pending 表示网页还没消费。",
    bits: ["project.read"],
    schema: { projectId: z.string(), jobId: z.string() },
    handler: async (args) => {
      const root = dataRoot();
      const raw = await fs.readFile(statusPath(root, args.jobId), "utf8").catch(() => null);
      if (!raw) {
        const queued = await fs.readFile(jobPath(root, args.jobId), "utf8").then(() => true).catch(() => false);
        return {
          jobId: args.jobId,
          state: queued ? "pending" : "unknown",
          hint: queued ? "作业已投递，等待网页画布消费（确认网页打开同一项目）" : "没有这个作业（jobId 错或文件已被清理）",
        };
      }
      return JSON.parse(raw);
    },
  });
}
