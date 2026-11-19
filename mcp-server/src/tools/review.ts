/**
 * 产物审核工具（2026-11-19 用户口径，方向纠正后重写）：
 *
 * 审核动作发生在 **Agent 对话** 里——LLM 主动列出产物清单、请用户逐项评分（采纳/打回）。
 * 网页「需求」页只是这份记忆的陈列（只读），不提供采纳/打回按钮。
 *
 * 本工具只做两件事：把清单记进 project-log（open_artifact_review），
 * 把用户的答复落盘（decide_artifact_review），打回的产物真删，不留库里误导后续环节。
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { openReviewBatch, applyReviewDecisions, readProjectLog, appendProjectLog } from "../store/project-log.js";
import { readStoryboard, deleteSubjectImage } from "../store/storyboard.js";
import { removeAssetRecords } from "../store/asset-library.js";
import { defTool, type Ctx } from "./_register.js";

const reviewItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["text", "image", "video"]),
  subjectId: z.string().optional(),
  storageKey: z.string().optional(),
  summary: z.string().optional(),
});

export function registerReviewTools(server: McpServer, ctx: Ctx): void {
  defTool(server, ctx, {
    name: "open_artifact_review",
    description:
      "把某一阶段的产物清单记进项目档案（记忆体），供 Agent 在对话里逐项请用户评分。"
      + "用法：产出后先调本工具登记 items，然后**在聊天里把清单原样列给用户**，问「采纳还是打回（可给 1-5 分）」，"
      + "等用户答复后再调 decide_artifact_review。注意：网页「需求」页只是这份记录的记忆体，不要让用户去网页点按钮。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      stage: z.enum(["concept", "script", "subjects", "shots", "video"]),
      note: z.string().optional(),
      items: z.array(reviewItemSchema).min(1).max(80),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const res = await openReviewBatch(dataRoot(), args.projectId, {
        baseVersion: args.baseVersion,
        stage: args.stage,
        note: args.note,
        items: args.items,
        dryRun: args.dryRun,
      });
      return {
        written: !args.dryRun,
        version: res.after.version,
        entryId: res.entry.id,
        itemCount: args.items.length,
        /** 原样打印给用户看的清单（Agent 直接复用，不必自己重排版） */
        askUser: res.entry.text,
      };
    },
  });

  defTool(server, ctx, {
    name: "decide_artifact_review",
    description:
      "把用户对产物的评分落盘：approve = 正式入库；reject = 打回并真删（图片会同时从主体库与资产库移除，并登记待重做）。"
      + "只允许在用户**明确回答**之后调用；禁止 Agent 自己替用户评分，也禁止把「已生成」当「已采纳」。",
    bits: ["project.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      entryId: z.string(),
      decisions: z.array(z.object({
        itemId: z.string().min(1),
        verdict: z.enum(["approved", "rejected"]),
        score: z.number().int().min(1).max(5).optional(),
        note: z.string().optional(),
      })).min(1).max(80),
      confirm: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const root = dataRoot();
      const log = await readProjectLog(root, args.projectId);
      const entry = log.entries.find((e) => e.id === args.entryId);
      if (!entry?.review) throw new Error(`审核条目不存在或不是审核批次: ${args.entryId}`);

      const rejected = args.decisions.filter((d) => d.verdict === "rejected");
      const rejectDetail: Array<{ itemId: string; title: string; deletedImages: number; removedAssets: number }> = [];

      // 打回：图片真删（主体状态图 + 资产记录），避免留在库里误导后续生成
      if (!args.dryRun) {
        for (const d of rejected) {
          const item = entry.review.items.find((i) => i.id === d.itemId);
          if (!item) continue;
          let deletedImages = 0;
          if (item.kind === "image" && item.subjectId && item.storageKey) {
            const sb = await readStoryboard(root, args.projectId);
            if (sb) {
              const res = await deleteSubjectImage(root, args.projectId, {
                baseVersion: sb.version,
                subjectId: item.subjectId,
                storageKey: item.storageKey,
              });
              deletedImages = res.deleted ? 1 : 0;
            }
            const removed = await removeAssetRecords(root, [item.storageKey]);
            rejectDetail.push({ itemId: item.id, title: item.title, deletedImages, removedAssets: removed.removed });
            await appendProjectLog(root, args.projectId, {
              baseVersion: res2Version(await readProjectLog(root, args.projectId)),
              entry: { kind: "todo", status: "open", text: `打回待重做：${item.title}（${item.storageKey.slice(0, 20)}）`, refs: [item.id] },
            });
          } else {
            rejectDetail.push({ itemId: item.id, title: item.title, deletedImages: 0, removedAssets: 0 });
            await appendProjectLog(root, args.projectId, {
              baseVersion: res2Version(await readProjectLog(root, args.projectId)),
              entry: { kind: "todo", status: "open", text: `打回待重做：${item.title}（${entry.review.stage}）`, refs: [item.id] },
            });
          }
        }
      }

      const res = await applyReviewDecisions(root, args.projectId, {
        baseVersion: args.baseVersion,
        entryId: args.entryId,
        decisions: args.decisions,
        dryRun: args.dryRun,
      });

      return {
        written: !args.dryRun,
        version: res.after.version,
        approved: res.approved,
        rejected: res.rejected,
        deleted: rejectDetail,
        /** 给用户看的一句话回执 */
        receipt: `已采纳 ${res.approved.length} 项 / 打回 ${res.rejected.length} 项`
          + (rejectDetail.length ? `；已删除 ${rejectDetail.reduce((n, r) => n + r.deletedImages, 0)} 张图、清理 ${rejectDetail.reduce((n, r) => n + r.removedAssets, 0)} 条资产记录` : ""),
      };
    },
  });
}

function res2Version(log: { version: number }): number {
  return log.version;
}
