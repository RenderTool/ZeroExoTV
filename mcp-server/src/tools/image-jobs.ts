/**
 * 画布图片生成（代理口径，2026-11-17 定稿）。
 *
 * MCP 只做代理发起 + 认领台账 + 查询/取消：
 *   - 提交到 ComfyUI 插件 /zeroexo/v1/jobs，生成与采样预览都在插件端，网页可见；
 *   - 写一条认领记录（jobId ↔ 项目 / 目标节点 / 上游参考图 / 主体），网页打开或刷新项目时据此接回；
 *   - 网页关掉不影响作业继续跑，重开网页按 jobId 认领进度、预览与成品。
 */

import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { submitProxyImage, type ProxyImageRequest, type ProxyImageResult } from "../broker/image-proxy.js";
import { cancelImageJob, getImageJob } from "../broker/plugin-client.js";
import { findClaimByJob, listClaims } from "../store/claims.js";
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
  /** 参考生图：参考图 storageKey（cas: 或 image:）。只做引导，不决定出图尺寸 */
  sourceStorageKey: z.string().optional(),
  /** 参考生图：也可以直接给画布节点 id，由 MCP 读取该节点的 storageKey/content */
  sourceNodeId: z.string().optional(),
  /** 改图遮罩 storageKey（白=重绘区）；给了就按原图尺寸 */
  maskStorageKey: z.string().optional(),
});

async function assertProject(projectId: string): Promise<void> {
  const exists = await fs.stat(path.join(dataRoot(), "projects", projectId))
    .then((s) => s.isDirectory(), () => false);
  if (!exists) throw new McpError("NOT_FOUND", `项目不存在: ${projectId}`);
}

function summarize(results: ProxyImageResult[]) {
  return {
    jobs: results.map((r) => ({
      jobId: r.jobId,
      claimId: r.claimId,
      nodeId: r.nodeId,
      model: r.model,
      state: r.state,
      width: r.width,
      height: r.height,
    })),
    jobId: results[0]?.jobId,
    taskId: results[0]?.jobId,
    queued: results.length,
    hint:
      "作业已代理提交到 ComfyUI 插件：生成与采样预览在插件端运行，网页打开或刷新同一项目会按认领记录接回进度与成品；" +
      "用 get_generation_task 查询进度，网关切网页不需要重新提交。",
  };
}

export function registerImageJobTools(server: McpServer, ctx: Ctx): void {
  const queueJob = async (projectId: string, requests: unknown[]) => {
    await assertProject(projectId);
    const list = requests as ProxyImageRequest[];
    // 同一批不能复用同一个显式 seed：ComfyUI 会命中缓存/输出同一张图
    const seeds = list
      .map((r) => r.seed)
      .filter((s): s is number => typeof s === "number" && Number.isInteger(s) && s >= 0);
    if (new Set(seeds).size !== seeds.length) {
      throw new McpError(
        "VALIDATION",
        "同一批 requests 不能复用同一个 seed：需要多张不同结果时用 seed:-1（随机）或给每张不同 seed；同一个 seed 只用于复现同一张图",
      );
    }
    const results: ProxyImageResult[] = [];
    for (const req of list) {
      results.push(await submitProxyImage(projectId, req));
    }
    return summarize(results);
  };

  defTool(server, ctx, {
    name: "generate_canvas_images",
    description:
      "在**当前打开的画布**上批量生成/参考生图：MCP 只代理提交到 ComfyUI 插件，生成与采样预览在插件端运行、网页可见，" +
      "网页关掉任务照常跑完，重开网页按认领记录接回进度与成品。" +
      "纯文生图 model=moss/krea2/qwen；**带参考图传 sourceStorageKey 或 sourceNodeId**（参考图只做引导，不决定出图尺寸）。" +
      "改图（原图重绘）走 maskStorageKey，出图尺寸跟随原图。提交后用 get_generation_task 轮询。" +
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
      "修改画布上已有的一张图（改图/图生图）：传 sourceNodeId（画布节点 id）或 sourceStorageKey（cas:/image: 键）+ 编辑指令，" +
      "MCP 代理提交到插件，**在画布上新建下游节点并连到原图**，原图不动。" +
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
      aspect: z.string().optional().describe("输出比例（参考生图时与 megapixels 一起决定尺寸）"),
      megapixels: z.number().min(0.5).max(4).optional(),
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
    name: "wait_generation_tasks",
    description:
      "阻塞等待本项目一批生成作业推进（最多 45 秒一轮，避免 MCP 请求超时），返回当前状态与剩余数量。" +
      "Agent 发起生成后必须反复调用本工具直到 pending=0，不得提交完就结束回合；" +
      "超时只代表本轮等待结束，作业仍会在云端继续跑，可再次调用。",
    bits: ["project.read"],
    schema: {
      projectId: z.string(),
      taskIds: z.array(z.string()).optional().describe("只等这些 jobId；不传则等本项目所有 pending 作业"),
      timeoutSeconds: z.number().int().min(5).max(50).default(45),
    },
    handler: async (args) => {
      const deadline = Date.now() + args.timeoutSeconds * 1000;
      const wanted = args.taskIds?.length ? new Set(args.taskIds) : null;
      let last: Array<{ jobId: string; state: string; storageKey?: string; error?: string }> = [];
      while (true) {
        const claims = (await listClaims()).filter(
          (c) => c.projectId === args.projectId && (!wanted || wanted.has(c.jobId)),
        );
        last = claims.map((c) => ({
          jobId: c.jobId,
          state: c.status,
          storageKey: c.result?.storageKey,
          error: c.error,
        }));
        const pending = last.filter((x) => x.state === "pending").length;
        if (pending === 0) return { done: true, pending: 0, tasks: last };
        if (Date.now() >= deadline) return { done: false, pending, tasks: last };
        await new Promise((r) => setTimeout(r, 4000));
      }
    },
  });

  defTool(server, ctx, {
    name: "get_canvas_image_job",
    description: "查询画布图片作业进度（读插件状态 + 认领记录；刷新/换浏览器都不丢），可取消。",
    bits: ["project.read"],
    schema: {
      projectId: z.string(),
      jobId: z.string(),
      cancel: z.boolean().optional().describe("true 时取消该作业"),
    },
    handler: async (args) => {
      const claim = await findClaimByJob(args.jobId);
      if (!claim) throw new McpError("NOT_FOUND", `没有该作业的认领记录: ${args.jobId}`);
      if (args.cancel) {
        await cancelImageJob(args.jobId);
      }
      const job = await getImageJob(args.jobId);
      return {
        jobId: args.jobId,
        claimId: claim.claimId,
        nodeId: claim.nodeId,
        kind: claim.kind,
        model: claim.model,
        prompt: claim.prompt,
        params: claim.params,
        subject: claim.subject,
        claimStatus: claim.status,
        plugin: job
          ? { state: job.state, outputs: job.outputs ?? [], error: job.error ?? null }
          : { state: "unknown", outputs: [], error: "插件查不到该作业（可能已被清理）" },
      };
    },
  });
}
