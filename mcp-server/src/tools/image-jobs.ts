/**
 * 画布图片生成（MCP Task Broker 执行，2026-11-15）。
 *
 * 变化：网页不再执行生成。MCP 直接把任务写进持久化任务表，由 MCP worker 调 ComfyUI 生成、
 * 下载结果、写 CAS 与资产记录；网页只订阅任务并把产物落到当前实时画布节点（幂等，多开不重复）。
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { readTask, taskSnapshot, type ImageTaskRequest } from "../store/tasks.js";
import { submitImageTask } from "../broker/executor.js";
import { defTool, type Ctx } from "./_register.js";

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
  /** 改图：也可以直接给画布节点 id，由 MCP 读取该节点的 storageKey/content */
  sourceNodeId: z.string().optional(),
  /** 可选遮罩 storageKey（白=重绘区） */
  maskStorageKey: z.string().optional(),
});

async function assertProject(projectId: string): Promise<void> {
  const exists = await fs.stat(path.join(dataRoot(), "projects", projectId))
    .then((s) => s.isDirectory(), () => false);
  if (!exists) throw new McpError("NOT_FOUND", `项目不存在: ${projectId}`);
}

export function registerImageJobTools(server: McpServer, ctx: Ctx): void {
  const queueJob = async (projectId: string, requests: unknown[]) => {
    await assertProject(projectId);
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
    const task = await submitImageTask({ projectId, requests: requests as ImageTaskRequest[] });
    return {
      taskId: task.taskId,
      queued: task.segments.length,
      state: task.state,
      hint: "任务由 MCP 执行；用 get_generation_task({ taskId }) 看进度。网页打开同一项目后会把产物落到画布。",
    };
  };

  defTool(server, ctx, {
    name: "generate_canvas_images",
    description:
      "在**当前打开的画布**上批量生成/改图：MCP 执行器直接调 ComfyUI 生成，网页只订阅任务并把结果写成新的下游画布节点（绝不覆盖原图）。" +
      "纯文生图 model=moss/krea2/qwen；**改图传 sourceStorageKey 或 sourceNodeId**（走 Qwen 图片编辑）。" +
      "每张图可独立指定 prompt、比例、百万像素、步数、种子。提交后用 get_generation_task 轮询。" +
      "**同一批 requests 的 seed 必须互不相同**（要多张不同结果用 seed:-1 或每张不同 seed）。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      requests: z.array(requestSchema).min(1).max(24),
    },
    handler: async (args) => queueJob(args.projectId, args.requests),
  });

  defTool(server, ctx, {
    name: "edit_canvas_image",
    description:
      "修改画布上已有的一张图（图生图）：传 sourceNodeId（画布节点 id）或 sourceStorageKey（cas:/image: 键）+ 编辑指令，" +
      "MCP 把原图作为输入交给 Qwen 图片编辑，**在画布上新建「MCP 改图」节点**，原图不动。" +
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
    description: "查询 generate_canvas_images 的任务进度（旧名保留；底层是持久化任务，刷新/换浏览器都不丢）。",
    bits: ["project.read"],
    schema: { projectId: z.string(), jobId: z.string() },
    handler: async (args) => {
      const task = await readTask(args.jobId, dataRoot());
      if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${args.jobId}（旧 jobId 只存在于旧作业文件）`);
      return taskSnapshot(task);
    },
  });
}
