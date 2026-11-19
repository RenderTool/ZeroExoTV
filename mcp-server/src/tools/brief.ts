/**
 * get_project_brief（2026-11-19 用户口径）：
 * LLM 接入第一件事不是问用户「做到哪了」，而是读这份简报——它把项目记忆（project-log）
 * 与任务队列（claims / 编排任务）压成一屏，Agent 看完就知道：做到哪个阶段、哪些产物等审核、卡在哪。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { readProjectLog } from "../store/project-log.js";
import { readStoryboard } from "../store/storyboard.js";
import { readWorkbench } from "../store/workbench.js";
import { readScript } from "../store/script.js";
import { listClaims } from "../store/claims.js";
import { defTool, type Ctx } from "./_register.js";

export function registerBriefTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "get_project_brief",
    description:
      "项目简报（只读，一屏）：阶段进度 + 各阶段产物数量与缺口 + 待审核批次 + 未完成待办 + 生成任务状态 + 建议下一步。"
      + "任何接入方开工前先调这个，不要凭聊天记忆复述项目状态，也不要拿旧结论当现状。",
    bits: ["project.read"],
    schema: { projectId: z.string() },
    handler: async (args) => {
      const root = dataRoot();
      const [log, sb, wb, script, claims] = await Promise.all([
        readProjectLog(root, args.projectId),
        readStoryboard(root, args.projectId),
        readWorkbench(root, args.projectId),
        readScript(root, args.projectId),
        listClaims(args.projectId),
      ]);

      // 概念设计（场景概念图）：主体树里 state 名含「概念图」的图
      const trees = (sb?.subjectTree as Array<{ name?: string; itemId?: string; states?: Array<{ id?: string; name?: string; media?: Array<{ key?: string }> }> }>) ?? [];
      let conceptCount = 0;
      let subjectsTotal = 0;
      let subjectsMissing: string[] = [];
      for (const t of trees) {
        const images = (sb?.entities ?? []).find((e) => e.id === t.itemId)?.images ?? [];
        subjectsTotal += 1;
        if (!images.length) subjectsMissing.push(t.name ?? t.itemId ?? '未命名');
        for (const st of t.states ?? []) {
          if (/概念/.test(st.name ?? '') && (st.media ?? []).some((m) => m.key)) conceptCount += 1;
        }
      }

      const shots = (wb?.shots ?? []) as Array<{
        id: string;
        number?: number;
        references?: unknown[];
        imagePrompt?: string;
        clipState?: string;
        versions?: Array<{ kind?: string; storageKey?: string }>;
      }>;
      const shotsWithRefs = shots.filter((s) => (s.references ?? []).length > 0).length;
      const shotsWithVideo = shots.filter((s) => {
        if (s.clipState === 'completed') return true;
        return (s.versions ?? []).some((v) => v.kind === 'video');
      }).length;

      const pendingReviews = log.entries
        .filter((e) => e.kind === 'artifact' && e.status === 'review' && e.review)
        .map((e) => ({
          entryId: e.id,
          stage: e.review!.stage,
          pending: e.review!.items.filter((i) => i.verdict === 'pending').length,
          titles: e.review!.items.filter((i) => i.verdict === 'pending').slice(0, 8).map((i) => i.title),
        }));

      const openTodos = log.entries.filter((e) => e.kind === 'todo' && e.status === 'open').map((e) => e.text);

      const claimCounts = {
        total: claims.length,
        landed: claims.filter((c) => c.status === 'landed').length,
        failed: claims.filter((c) => c.status === 'failed').length,
        pending: claims.filter((c) => c.status !== 'landed' && c.status !== 'failed').length,
      };

      const stages = [
        { key: 'concept', label: '概念设计（场景概念图）', count: conceptCount, note: conceptCount ? '已有概念图' : '未开始' },
        { key: 'subjects', label: '主体生成', count: subjectsTotal, note: subjectsMissing.length ? `缺图：${subjectsMissing.join('、')}` : '全部已挂图' },
        { key: 'script', label: '剧本', count: script?.episodes?.length ?? 0, note: script?.episodes?.length ? '已入库' : '未导入' },
        { key: 'shots', label: '剧本→分镜处理', count: shots.length, note: `${shotsWithRefs}/${shots.length} 段带引用` },
        { key: 'video', label: '视频出片', count: shotsWithVideo, note: `${shotsWithVideo}/${shots.length} 段有成片` },
      ];

      const nextStep =
        pendingReviews.length ? `先请用户审核：${pendingReviews.map((r) => `${r.stage} 还有 ${r.pending} 项`).join('；')}`
          : subjectsMissing.length ? `先补主体图：${subjectsMissing.join('、')}`
            : shots.length && shotsWithRefs < shots.length ? '分镜还没配齐引用，先补槽位'
              : shotsWithVideo < shots.length && shots.length ? `可以出片：${shots.length - shotsWithVideo} 段还没视频`
                : '当前无阻塞，按用户新指令推进';

      return {
        projectId: args.projectId,
        pipeline: { active: log.pipeline?.active ?? false, phase: log.pipeline?.phase, note: log.pipeline?.note, phases: log.pipeline?.phases ?? [] },
        stages,
        pendingReviews,
        openTodos,
        generationTasks: claimCounts,
        recentProgress: log.entries.filter((e) => e.kind === 'progress').slice(-5).map((e) => e.text),
        nextStep,
        memoryVersion: log.version,
      };
    },
  });
}
