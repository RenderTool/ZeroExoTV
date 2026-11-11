/**
 * 延续法计划工具：plan_continuity_edit（2026-11-11 用户事故后加）
 *
 * 作用：把「按 17k+5 重排段长 + 第 2 段起吃上一段尾帧（22 帧锁定）」变成一次显式、可预览、
 * 要用户确认的写操作；写完给每个片段盖 continuityPlan 标记，run_generation 只认带标记的片段。
 *
 * 用法：先 dryRun:true 给用户看整张「段长/帧数/引导」表，用户确认后带
 * confirm:true + userConfirmed:true 落盘。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { mutateWorkbench, readWorkbench } from "../store/workbench.js";
import { planContinuitySegments, CONTEXT_FRAMES } from "../lib/continuity.js";
import { defTool, guardDryRunConfirm, guardUserConfirmed, type Ctx } from "./_register.js";

export function registerContinuityTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "plan_continuity_edit",
    description:
      "按 H3 延续法重排导演台段长与衔接（只改时长/引导开关，不改提示词正文）：每段时长吸附到 17k+5 帧、"
      + "第 2 段起标记吃上一段尾帧（默认 22 帧）、并打开 sharedParams.continuityEnabled。"
      + "dryRun:true 返回整张计划表给用户确认；confirm:true 需要 userConfirmed:true。"
      + "没做过这一步的片段，run_generation 会直接拒绝（延续法不能靠 Agent 自觉）。",
    bits: ["workbench.read", "workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0).optional()
        .describe("workbench.json 的 version（dryRun 可省略；confirm 建议先 get_workbench 拿最新版本）"),
      segments: z.array(z.object({
        text: z.string().optional(),
        durationSec: z.number().positive().optional(),
      })).optional()
        .describe("源段（可选）。省略 = 用导演台现有片段顺序与时长/描述；给了就必须与现有片段数一致"),
      ctxFrames: z.number().int().positive().optional().describe("引导帧数，默认 22"),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
      userConfirmed: z.boolean().optional()
        .describe("用户已看过计划表并同意；真实写入必须 true"),
    },
    handler: async (args) => {
      guardDryRunConfirm(args);
      const root = dataRoot();
      const wb = await readWorkbench(root, args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${args.projectId}`);
      const shots = wb.shots;
      if (shots.length === 0) throw new McpError("VALIDATION", "导演台还没有片段：先 split_script_to_shots 或 add_segment");

      const sources = args.segments ?? shots.map((s) => ({
        id: s.id,
        text: s.imagePrompt || s.videoPrompt || s.description,
        durationSec: s.duration,
      }));
      if (args.segments && args.segments.length !== shots.length) {
        throw new McpError(
          "VALIDATION",
          `源段数（${args.segments.length}）与现有片段数（${shots.length}）不一致：延续法只重排已有片段，`
          + "请先用 split_script_to_shots / add_segment 对齐段数，避免把整条时间线拆散",
        );
      }

      const plan = planContinuitySegments(sources, { ctxFrames: args.ctxFrames ?? CONTEXT_FRAMES });
      if (args.dryRun || !args.confirm) {
        return {
          written: false,
          dryRun: true,
          projectId: args.projectId,
          planId: null,
          plan,
          note: "把 plan.segments 的「段/帧/秒/是否吃上一段尾帧」逐条给用户确认；确认后带 confirm:true + userConfirmed:true 落盘",
        };
      }

      guardUserConfirmed(args, "延续法重排会改动所有片段的时长与引导开关");
      const planId = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const plannedAt = new Date().toISOString();
      const res = await mutateWorkbench(root, args.projectId, {
        baseVersion: args.baseVersion ?? wb.version,
        mutate: (container) => {
          if (container.shots.length !== plan.segments.length) {
            throw new McpError("VERSION_CONFLICT", "片段数在计划期间发生变化：重新读取后再生成计划");
          }
          plan.segments.forEach((seg, i) => {
            const shot = container.shots[i];
            if (!shot) return;
            shot.duration = Number((seg.frames / 24).toFixed(3));
            shot.continuation = { enabled: seg.guideFromPrev };
            shot.paramValues = {
              ...(shot.paramValues ?? {}),
              continuityPlan: {
                planId,
                plannedAt,
                frames: seg.frames,
                ctxFrames: plan.ctxFrames,
                guideFromPrev: seg.guideFromPrev,
              },
            };
          });
          const shared = container.sharedParams ?? { enabled: true, assets: [], presetId: "h3" as const, params: {} };
          shared.params = {
            ...(shared.params ?? {}),
            continuityEnabled: true,
            continuityOverlapFrames: plan.ctxFrames,
            continuityMode: "guide",
            continuityKeepTail: true,
          };
          container.sharedParams = shared;
        },
      });

      return {
        written: res.written,
        version: res.after.version,
        planId,
        appliedShots: plan.segments.length,
        totalSec: plan.totalSec,
        ctxFrames: plan.ctxFrames,
        plan,
        next: "逐段串行 run_generation（从第 1 段开始），成功后立刻用 sync_job_results 回写；不要跳段并行",
      };
    },
  });
}
