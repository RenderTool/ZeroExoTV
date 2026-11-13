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
  const queueJob = async (projectId: string, requests: unknown[], jobIdArg?: string) => {
    const root = dataRoot();
    const projectDir = path.join(root, "projects", projectId);
    const exists = await fs.stat(projectDir).then(() => true).catch(() => false);
    if (!exists) throw new McpError("NOT_FOUND", `项目不存在: ${projectId}`);
    // 同一批不能复用同一个显式 seed：ComfyUI 会命中缓存/输出同一张图（编辑时看起来像原图）
    const seeds = requests
      .map((r) => (r as { seed?: unknown }).seed)
      .filter((s): s is number => typeof s === "number" && Number.isInteger(s) && s >= 0);
    if (new Set(seeds).size !== seeds.length) {
      throw new McpError(
        "VALIDATION",
        "同一批 requests 不能复用同一个 seed：需要多张不同结果时用 seed:-1（随机）或给每张不同 seed；同一个 seed 只用于复现同一张图",
      );
    }
    const jobId = jobIdArg?.trim() || `zxjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    // 复用 jobId 会命中旧 status 里的 done 条目，网页直接跳过生成 → 看起来永远返回旧图/原图
    if (jobIdArg?.trim()) {
      const jobExists = await fs.stat(jobPath(root, jobId)).then(() => true).catch(() => false);
      const statusExists = await fs.stat(statusPath(root, jobId)).then(() => true).catch(() => false);
      if (jobExists || statusExists) {
        throw new McpError("JOB_ID_CONFLICT", `jobId 已存在（作业或状态未清理）: ${jobId}；每次批量必须用新的 jobId`);
      }
    }
    const payload = {
      schemaVersion: 1,
      jobId,
      projectId,
      createdAt: new Date().toISOString(),
      requests: requests.map((r, i) => ({ ...(r as object), index: i })),
    };
    await fs.mkdir(path.join(root, JOBS_DIR), { recursive: true });
    await fs.writeFile(jobPath(root, jobId), JSON.stringify(payload, null, 2), "utf8");
    return {
      jobId,
      queued: payload.requests.length,
      jobFile: path.join(JOBS_DIR, `${jobId}.json`),
      hint: "网页画布需打开同一项目且在线；每 2 秒轮询一次，用 get_canvas_image_job({ projectId, jobId }) 看进度",
    };
  };

  defTool(server, ctx, {
    name: "generate_canvas_images",
    description:
      "在**当前打开的画布**上批量生成/改图：写作业到共享目录，网页画布在线时自动在画布上**新建下游节点**、调用 ComfyUI 生成并把结果写进实时画布与历史（不是只进资产库）。" +
      "纯文生图 model=moss/krea2/qwen；**改图传 sourceStorageKey 或 sourceNodeId**（走 Qwen 图片编辑）。绝不覆盖原图/原节点。" +
      "每张图可独立指定 prompt、比例、百万像素、步数、种子。投递后用 get_canvas_image_job 轮询。" +
      "**同一批 requests 的 seed 必须互不相同**（要多张不同结果用 seed:-1 或每张不同 seed）；**jobId 不得复用**，否则会命中旧状态直接返回旧图/原图。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      requests: z.array(requestSchema).min(1).max(24),
      jobId: z.string().optional(),
    },
    handler: async (args) => queueJob(args.projectId, args.requests, args.jobId),
  });

  defTool(server, ctx, {
    name: "edit_canvas_image",
    description:
      "修改画布上已有的一张图（图生图）：传 sourceNodeId（画布节点 id）或 sourceStorageKey（cas:/image: 键）+ 编辑指令，" +
      "网页会把原图作为输入交给 Qwen 图片编辑，**在画布上新建「MCP 改图」节点**，原图不动。" +
      "编辑指令必须写成「只改什么 + 其余保持不变 + 原图关键元素复述」，不要重新描述整张新图。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      sourceNodeId: z.string().optional(),
      sourceStorageKey: z.string().optional(),
      prompt: z.string().min(1).describe("只描述要改的部分与必须保持的内容"),
      title: z.string().optional(),
      maskStorageKey: z.string().optional(),
      steps: z.number().int().min(1).max(100).optional(),
      seed: z.number().int().optional(),
      aspect: z.string().optional().describe("输出比例（与 megapixels 一起决定最终尺寸）"),
      megapixels: z.number().min(0.5).max(4).optional().describe("百万像素（与 aspect 一起决定最终尺寸）"),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    },
    handler: async (args) => {
      if (!args.sourceNodeId && !args.sourceStorageKey) {
        throw new McpError("VALIDATION", "改图必须给 sourceNodeId 或 sourceStorageKey（先 get_canvas/list_assets 取原图）");
      }
      return queueJob(args.projectId, [{
        model: "qwen",
        prompt: args.prompt,
        title: args.title,
        sourceNodeId: args.sourceNodeId,
        sourceStorageKey: args.sourceStorageKey,
        maskStorageKey: args.maskStorageKey,
        steps: args.steps,
        seed: args.seed,
        aspect: args.aspect,
        megapixels: args.megapixels,
        width: args.width,
        height: args.height,
      }]);
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
