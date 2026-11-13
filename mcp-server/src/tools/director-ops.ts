/**
 * 导演台运行 / 引导数据 / 历史验收工具（2026-11-09）。
 *
 * 目标：部署后用户只有「网页 + 打包 MCP」，所有操作必须能经 MCP 完成。
 * 本文件补齐原先完全缺失的一段：批量改时长、触发生成、查作业、读历史 guide、
 * 写入片段引导槽、验收产物。能力位全部复用现有 bit，不新增（否则旧 token 会失效）。
 */

import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { uploadToCas } from "../store/cas.js";
import { appendAssetRecord, assetsLibraryFile, type LibraryAsset } from "../store/asset-library.js";
import { mutateWorkbench, readWorkbench } from "../store/workbench.js";
import { defTool, guardDryRunConfirm, type Ctx } from "./_register.js";
import { hasContinuityPlan } from "../lib/continuity.js";

const COMFY_BASE = (): string => process.env.ZEROEXO_COMFY_BASE ?? "http://127.0.0.1:8188";
const GUIDE_ID_RE = /^gd_[A-Za-z0-9_-]{4,64}$/;
const GUIDE_FRAME_OPTIONS = [5, 22, 39, 56];
const PIXELS_PER_MEGAPIXEL = 1024 * 1024;
const ASPECT: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "21:9": 21 / 9 };

const round32 = (n: number): number => Math.max(32, Math.round(n / 32) * 32);
const clampScale = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(2, Math.max(0.1, v)) : 1;
};
/** 与前端 entities/director-params.ts 同口径：官方 Size Settings Reference（面积 = 0.4MP×系数×1024²，×32 对齐） */
function resolveVideoSize(aspect: string, scaleFactor: number): { width: number; height: number } {
  const r = ASPECT[aspect] ?? 16 / 9;
  const f = clampScale(scaleFactor);
  // 系数 = 目标 MP（官方 Size Settings Reference，2026-11-11 纠正）：2.0 → 2.0MP → 16:9 = 1920×1088
  const total = f * PIXELS_PER_MEGAPIXEL;
  // 插件 ZeroExoRefVideo 的 width/height 都是 min=64（ref_video.py:88-89），顺手钳到插件合法下限。
  return {
    width: Math.max(64, round32(Math.sqrt(total * r))),
    height: Math.max(64, round32(Math.sqrt(total / r))),
  };
}
/** 把片段第一张项目参考图上传到 ComfyUI input，返回节点可用文件名 */
async function uploadShotReference(base: string, storageKey: string): Promise<string> {
  if (!storageKey.startsWith("cas:")) return "";
  const file = path.join(dataRoot(), "media", "cas", storageKey.slice(4));
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return "";
  }
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)]), path.basename(file));
  form.append("overwrite", "true");
  try {
    const res = await fetch(`${base}/upload/image`, { method: "POST", body: form });
    if (!res.ok) return "";
    const body = (await res.json()) as { name?: string; subfolder?: string };
    if (!body.name) return "";
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  } catch {
    return "";
  }
}

/** 与前端 director-params.ts:285-293 同口径（17k+5 吸附） */
function durationToFrames(sec: number): number {
  const f = Math.max(1, Math.round(sec * 24));
  return f + ((((5 - f) % 17) + 17) % 17);
}
function snapGuide(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 22;
  return GUIDE_FRAME_OPTIONS.reduce((best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best), GUIDE_FRAME_OPTIONS[0]!);
}

interface GuideInfo { id?: string; path?: string; frames?: number; sha256?: string; localKey?: string }
interface HistoryRecord {
  id: string;
  title: string;
  kind: string;
  createdAt: string;
  projectId?: string;
  scope?: string;
  data: {
    kind?: string;
    storageKey?: string;
    origin?: string;
    originSource?: string;
    guide?: GuideInfo;
    generation?: { jobId?: string; provider?: string; prompt?: string; model?: string };
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    prompt?: string;
    model?: string;
    originNodeId?: string;
  };
}

async function readHistory(root: string): Promise<HistoryRecord[]> {
  try {
    const env = JSON.parse(await fs.readFile(assetsLibraryFile(root), "utf8")) as { value?: HistoryRecord[] };
    return env.value ?? [];
  } catch {
    return [];
  }
}

function historyItem(a: HistoryRecord): Record<string, unknown> {
  return {
    id: a.id, title: a.title, kind: a.kind, createdAt: a.createdAt,
    projectId: a.projectId, scope: a.scope, storageKey: a.data?.storageKey,
    origin: a.data?.origin, originSource: a.data?.originSource,
    jobId: a.data?.generation?.jobId,
    // 画布生成资产：给 Agent 足够信息直接挑图（尺寸/提示词/来源节点/模型）
    width: a.data?.width ?? a.data?.naturalWidth ?? null,
    height: a.data?.height ?? a.data?.naturalHeight ?? null,
    prompt: a.data?.prompt ?? a.data?.generation?.prompt ?? null,
    originNodeId: a.data?.originNodeId ?? null,
    model: a.data?.generation?.model ?? a.data?.model ?? null,
    guide: a.data?.guide ?? null,
  };
}

interface JobStatus {
  ok?: boolean;
  jobId?: string;
  state?: string;
  outputs?: Array<{ kind?: string; path?: string }>;
  guide?: GuideInfo | null;
  guideSource?: string | null;
  guideInPath?: string | null;
  error?: string | null;
  params?: Record<string, unknown>;
}

async function fetchJob(jobId: string, base = COMFY_BASE()): Promise<JobStatus> {
  const res = await fetch(`${base}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new McpError("IO_ERROR", `作业查询失败 HTTP ${res.status}: ${jobId}`);
  return (await res.json()) as JobStatus;
}

/**
 * 延续法串行生成：等上一段真正成功拿到 guide 再提交下一段（每段吃上一段尾帧）。
 * 超时/失败都返回终态，由调用方决定是否继续——绝不并行提交。
 */
async function waitForJobTerminal(
  jobId: string,
  base: string,
  timeoutMs = 20 * 60 * 1000,
  intervalMs = 3000,
): Promise<JobStatus> {
  const started = Date.now();
  for (;;) {
    let job: JobStatus;
    try {
      job = await fetchJob(jobId, base);
    } catch (err) {
      job = { state: "error", error: err instanceof Error ? err.message : String(err), jobId };
    }
    if (job.state && ["success", "error", "cancelled"].includes(job.state)) return job;
    if (Date.now() - started > timeoutMs) {
      return { ...job, state: "error", error: `等待作业超时（${Math.round(timeoutMs / 60000)} 分钟）: ${jobId}` };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 云端不会长期保存产物：同步作业结果时立刻把引导 .safetensors 拉到本地 media/guides。
 * 返回本地键（`guide:<id>.safetensors`），失败返回 null（不阻断视频落库）。
 */
async function cacheGuideFromCloud(root: string, base: string, guide: GuideInfo | null | undefined): Promise<string | null> {
  if (!guide?.id || !/^gd_[A-Za-z0-9_-]{4,64}$/.test(guide.id)) return null;
  const dir = path.join(root, "media", "guides");
  const file = path.join(dir, `${guide.id}.safetensors`);
  try {
    const s = await fs.stat(file);
    if (s.size > 0) return `guide:${guide.id}.safetensors`;
  } catch {
    // 还没缓存，继续下载
  }
  try {
    const qs = new URLSearchParams({
      filename: `${guide.id}.safetensors`,
      subfolder: "zeroexo/guides",
      type: "output",
    }).toString();
    const res = await fetch(`${base}/view?${qs}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, buf);
    return `guide:${guide.id}.safetensors`;
  } catch {
    return null;
  }
}

async function exists(p: string | undefined): Promise<boolean> {
  if (!p) return false;
  try { await fs.stat(p); return true; } catch { return false; }
}

export function registerDirectorOpsTools(server: McpServer, ctx: Ctx): void {
  // ===== T2：批量时长 =====
  defTool(server, ctx, {
    name: "set_segment_duration",
    description: "一次调用批量改导演台片段时长（秒）。all=true 改全部，或给 shotIds 指定子集；一次 mutate、version 只 +1。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      duration: z.number().positive(),
      all: z.boolean().optional(),
      shotIds: z.array(z.string()).optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args);
      if (!args.all && (!args.shotIds || args.shotIds.length === 0)) {
        throw new McpError("VALIDATION", "必须给 all:true 或非空 shotIds");
      }
      const ids = args.all ? null : new Set(args.shotIds!);
      const root = dataRoot();
      const before = await readWorkbench(root, args.projectId);
      const targets = (before?.shots ?? []).filter((s) => !ids || ids.has(s.id));
      if (targets.length === 0) throw new McpError("NOT_FOUND", "没有匹配的片段");
      const res = await mutateWorkbench(root, args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
        mutate: (wb) => {
          for (const s of wb.shots) if (!ids || ids.has(s.id)) s.duration = args.duration;
        },
      });
      return {
        written: res.written, version: res.after.version,
        changed: targets.map((s) => s.id), duration: args.duration,
        totalDuration: res.after.totalDuration,
      };
    },
  });

  // ===== T4：片段引导槽 =====
  defTool(server, ctx, {
    name: "set_shot_guide",
    description: "写入/移除导演台片段的独立引导槽 shot.guide（不占参考图 9 格）。guide 传 null 表示移除。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      shotId: z.string(),
      guide: z.object({
        id: z.string(), title: z.string().optional(), frames: z.number().optional(),
        sha256: z.string().optional(), fromAssetId: z.string().optional(),
      }).nullable(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      if (args.guide && !GUIDE_ID_RE.test(args.guide.id)) {
        throw new McpError("VALIDATION", `guide.id 非法（只接受 gd_ 前缀）: ${args.guide.id}`);
      }
      const root = dataRoot();
      const res = await mutateWorkbench(root, args.projectId, {
        baseVersion: args.baseVersion,
        dryRun: args.dryRun,
        mutate: (wb) => {
          const shot = wb.shots.find((s) => s.id === args.shotId);
          if (!shot) throw new McpError("NOT_FOUND", `导演台片段不存在: ${args.shotId}`);
          if (args.guide === null) delete shot.guide;
          else shot.guide = { ...args.guide, createdAt: new Date().toISOString() };
        },
      });
      const shot = res.after.shots.find((s) => s.id === args.shotId);
      return { written: res.written, version: res.after.version, guide: shot?.guide ?? null, references: shot?.references?.length ?? 0 };
    },
  });

  // ===== T4：历史产出 / 引导数据 =====
  defTool(server, ctx, {
    name: "list_history",
    description: "列出生成产物历史（.lf 资产记录），可按来源 canvas/director 过滤、只看带引导数据的条目。",
    bits: ["asset.read"],
    schema: {
      projectId: z.string().optional(),
      source: z.enum(["canvas", "director", "all"]).optional(),
      withGuideOnly: z.boolean().optional(),
    },
    handler: async (args) => {
      const list = await readHistory(dataRoot());
      const items = list
        .filter((a) => a.data?.origin === "generation")
        .filter((a) => !args.projectId || !a.projectId || a.projectId === args.projectId)
        .filter((a) => !args.withGuideOnly || !!a.data?.guide?.id)
        .filter((a) => {
          if (!args.source || args.source === "all") return true;
          const explicit = a.data?.originSource;
          const inferred = a.data?.generation?.provider === "zeroexo" || a.data?.generation?.provider === "comfyui-direct" || /^片段\s*\d+/.test(a.title) ? "director" : "canvas";
          return (explicit ?? inferred) === args.source;
        })
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map(historyItem);
      return { total: items.length, items };
    },
  });

  defTool(server, ctx, {
    name: "get_guide",
    description: "取单条生成产物的引导元数据，并检查 ComfyUI 磁盘上的 gd_xxx.safetensors 是否存在。",
    bits: ["asset.read"],
    schema: { assetId: z.string().optional(), guideId: z.string().optional() },
    handler: async (args) => {
      if (!args.assetId && !args.guideId) throw new McpError("VALIDATION", "需给 assetId 或 guideId");
      const list = await readHistory(dataRoot());
      const found = list.find((a) => (args.assetId && a.id === args.assetId) || (args.guideId && a.data?.guide?.id === args.guideId));
      if (!found?.data?.guide?.id) throw new McpError("NOT_FOUND", "该资产没有引导数据（存量产物需重新生成）");
      const g = found.data.guide;
      return { ...historyItem(found), guide: g, guideFilePresent: await exists(g.path) };
    },
  });

  // ===== T3：触发生成（核心） =====
  defTool(server, ctx, {
    name: "run_generation",
    description: "经 MCP 直接向 ComfyUI 插件提交导演台生成作业。selectedIds 省略=全部片段；按时间线解析引导（显式槽 > 前一段 media.guide > use_prev_guide）。开启延续法时：必须有 plan_continuity_edit 计划、按时间线连续选段、严格串行（上一段 success 拿到 guide 才提交下一段），否则直接拒绝。低资源测试用 steps/scaleFactor 调小。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      episode: z.string().optional(),
      selectedIds: z.array(z.string()).optional(),
      baseUrl: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args);
      const root = dataRoot();
      const wb = await readWorkbench(root, args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${args.projectId}`);
      const allShots = wb.shots as unknown as Array<{ id: string; duration: number; imagePrompt?: string; videoPrompt?: string; negativePrompt?: string; guide?: { id?: string }; media?: { guide?: { id?: string } }; continuation?: { enabled: boolean }; references?: Array<{ kind?: string; storageKey?: string }>; paramValues?: Record<string, unknown> | null }>;
      const selected = args.selectedIds?.length
        ? allShots.filter((s) => args.selectedIds!.includes(s.id))
        : allShots;
      if (selected.length === 0) throw new McpError("NOT_FOUND", "没有匹配的片段");

      const shared = (wb as unknown as { sharedParams?: { params?: Record<string, unknown> } }).sharedParams;
      const p = shared?.params ?? {};
      const aspect = String(p.aspect ?? "16:9");
      const { width, height } = resolveVideoSize(aspect, clampScale(p.scaleFactor ?? 1));
      const steps = Number(p.steps ?? 8);
      const cfg = Number(p.cfg ?? 1);
      const seed = Number(p.seed ?? 0);
      const guideFrames = snapGuide(p.continuityOverlapFrames);
      const continuityOn = p.continuityEnabled === true;
      const base = args.baseUrl ?? COMFY_BASE();
      const episode = args.episode ?? "1";
      // 显存策略属于服务层：MCP 也按机器自动选；读不到显存时保守走低显存
      const useLowVram = await (async (): Promise<boolean> => {
        try {
          const res = await fetch(`${base}/system_stats`);
          if (!res.ok) return true;
          const body = (await res.json()) as { devices?: Array<{ vram_total?: number }> };
          const vram = body.devices?.[0]?.vram_total;
          if (typeof vram !== "number" || !Number.isFinite(vram) || vram <= 0) return true;
          return vram < 16 * 1024 ** 3;
        } catch {
          return true;
        }
      })();

      const buildSubmission = async (shot: typeof selected[number], overrideGuideId?: string) => {
        const allIdx = allShots.findIndex((s) => s.id === shot.id);
        const explicit = overrideGuideId ?? shot.guide?.id;
        const segEnabled = shot.continuation ? shot.continuation.enabled === true : continuityOn;
        let guideId: string | undefined = explicit;
        let usePrev = false;
        if (!explicit && segEnabled && allIdx > 0) {
          const prevGuideId = allShots[allIdx - 1]?.media?.guide?.id;
          if (prevGuideId) guideId = prevGuideId;
          else usePrev = true;
        }
        const firstImage = (shot.references ?? []).find((r) => r.kind === "image" && r.storageKey);
        const referenceImage = firstImage?.storageKey
          ? await uploadShotReference(base, firstImage.storageKey)
          : "";
        const params: Record<string, unknown> = {
          prompt: (shot.imagePrompt || shot.videoPrompt || `第 ${allIdx + 1} 段`).toString(),
          negative_prompt: String((shot as { negativePrompt?: string }).negativePrompt ?? ""),
          width, height,
          frames: durationToFrames(Number(shot.duration) || 5),
          steps, cfg, seed, frame_rate: 24,
          guide_frames: guideFrames,
          use_prev_guide: usePrev,
          use_low_vram: useLowVram,
          ...(guideId ? { guide_id: guideId } : {}),
          ...(referenceImage ? { reference_images: referenceImage, reference_image: referenceImage } : {}),
        };
        return { shotId: shot.id, clientJobId: `mcp_${args.projectId}_${shot.id}_${Date.now()}`, params };
      };

      // 延续法准入（2026-11-11 用户事故）：没做延续法计划的片段、跳段、从中间开始 —— 一律拒绝，
      // 不允许 Agent「不知道为什么要这么做」就把原稿段长直接搬进去跑。
      if (continuityOn) {
        const unplanned = selected.filter((s) => !hasContinuityPlan(s));
        if (unplanned.length > 0) {
          throw new McpError(
            "CONTINUITY_NOT_PLANNED",
            `延续法已开启，但 ${unplanned.length} 个片段没有延续法计划（段长没按 17k+5 重排、没有接缝标记）。`
            + "先调 plan_continuity_edit：dryRun 出「段/帧/秒/是否吃上一段尾帧」表 → 用户确认 → confirm:true + userConfirmed:true，"
            + "再回来生成。禁止照搬原稿段长直接跑。",
          );
        }
        const idxs = selected
          .map((s) => allShots.findIndex((x) => x.id === s.id))
          .sort((a, b) => a - b);
        if (idxs.some((v, i) => i > 0 && v !== idxs[i - 1]! + 1)) {
          throw new McpError(
            "CONTINUITY_ORDER",
            "开启延续法时必须按时间线连续选段：跳段会让被跳过的片段吃不到上一段尾帧，接缝就断了。",
          );
        }
        const firstIdx = idxs[0] ?? 0;
        if (firstIdx > 0 && !allShots[firstIdx - 1]?.media?.guide?.id) {
          throw new McpError(
            "CONTINUITY_ORDER",
            `第 ${firstIdx + 1} 段之前还没有已生成的引导数据：延续法必须从第 1 段开始按顺序跑，`
            + "不能从中间挑着生成（挑着跑等于放弃衔接）。",
          );
        }
      }

      const submissions: Awaited<ReturnType<typeof buildSubmission>>[] = [];
      for (const shot of selected) submissions.push(await buildSubmission(shot));

      const submit = async (params: Record<string, unknown>, clientJobId: string): Promise<string> => {
        const body = { kind: "reference_video", clientJobId, project: args.projectId, episode, params };
        const res = await fetch(`${base}/zeroexo/v1/jobs`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new McpError("IO_ERROR", `提交作业失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
        const out = JSON.parse(text) as { jobId?: string };
        if (!out.jobId) throw new McpError("IO_ERROR", `插件未返回 jobId: ${text.slice(0, 200)}`);
        return out.jobId;
      };

      if (args.dryRun) {
        return { written: false, dryRun: true, continuity: continuityOn, serial: continuityOn, submissions };
      }

      // 延续法：严格串行，上一段 success 且拿到 guide 才提交下一段
      if (continuityOn) {
        const ordered = [...selected].sort(
          (a, b) => allShots.findIndex((x) => x.id === a.id) - allShots.findIndex((x) => x.id === b.id),
        );
        const jobs: Array<Record<string, unknown>> = [];
        let lastGuideId: string | undefined;
        for (const shot of ordered) {
          const sub = (await buildSubmission(shot, lastGuideId)) as { params: Record<string, unknown>; clientJobId: string };
          const jobId = await submit(sub.params, sub.clientJobId);
          const terminal = await waitForJobTerminal(jobId, base);
          jobs.push({
            jobId, shotId: shot.id, state: terminal.state,
            guideId: terminal.guide?.id ?? null, error: terminal.error ?? null,
            params: sub.params,
          });
          if (terminal.state !== "success") {
            return {
              written: true, continuity: true, serial: true,
              failedShotId: shot.id, jobs,
              error: terminal.error ?? `第 ${jobs.length} 段生成失败（${terminal.state}）`,
              next: "修好这一段后从这一段继续；禁止跳到后面的段",
            };
          }
          lastGuideId = terminal.guide?.id ?? lastGuideId;
        }
        return {
          written: true, continuity: true, serial: true,
          projectId: args.projectId, episode, baseUrl: base, width, height, steps, guideFrames, jobs,
          next: "用 sync_job_results 按同样顺序回写视频与引导（每段的 guide 会自动成为下一段的输入）",
        };
      }

      const jobs: Array<{ jobId: string; shotId: string; params: Record<string, unknown> }> = [];
      for (const sub of submissions) {
        const jobId = await submit(sub.params, sub.clientJobId);
        jobs.push({ jobId, shotId: sub.shotId, params: sub.params });
      }
      return { written: true, projectId: args.projectId, episode, baseUrl: base, width, height, steps, guideFrames, jobs };
    },
  });

  defTool(server, ctx, {
    name: "get_job",
    description: "查询单个 ComfyUI 作业状态（state/outputs/guide/guideSource/guideInPath/error）。",
    bits: ["workbench.read"],
    schema: { jobId: z.string(), baseUrl: z.string().optional() },
    handler: async (args) => fetchJob(args.jobId, args.baseUrl ?? COMFY_BASE()),
  });

  defTool(server, ctx, {
    name: "list_jobs",
    description: "批量查询作业状态，返回每项结果与汇总 doneCount/failedCount/allDone。",
    bits: ["workbench.read"],
    schema: { jobIds: z.array(z.string()), baseUrl: z.string().optional() },
    handler: async (args) => {
      const base = args.baseUrl ?? COMFY_BASE();
      const jobs = await Promise.all(args.jobIds.map(async (jobId) => {
        try { return { jobId, ...(await fetchJob(jobId, base)) }; }
        catch (err) { return { jobId, state: "error", error: err instanceof Error ? err.message : String(err) }; }
      }));
      const doneCount = jobs.filter((j) => j.state === "success").length;
      const failedCount = jobs.filter((j) => j.state === "error" || j.state === "cancelled").length;
      return { jobs, doneCount, failedCount, allDone: doneCount + failedCount === jobs.length };
    },
  });

  // ===== T3→T4 闭环：把作业产物回写导演台 + 落历史资产 =====
  defTool(server, ctx, {
    name: "sync_job_results",
    description: "作业成功后把视频与 guide 回写到 shots[].media.guide，并落一条带 guide 的历史资产记录（等价网页的 onSegmentDone + autoLandGenerationBlob）。部署后只有 MCP 时由本工具完成闭环。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      baseVersion: z.number().int().min(0),
      jobs: z.array(z.object({ jobId: z.string(), shotId: z.string() })),
      baseUrl: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args);
      const root = dataRoot();
      const base = args.baseUrl ?? COMFY_BASE();
      interface SyncRow {
        jobId: string; shotId: string; skipped?: boolean; state?: string;
        error?: string | null; videoPath?: string; storageKey?: string;
        guide?: GuideInfo | null; guideSource?: string | null;
      }
      const rows: SyncRow[] = [];
      for (const { jobId, shotId } of args.jobs) {
        const j = await fetchJob(jobId, base);
        if (j.state !== "success") {
          rows.push({ jobId, shotId, skipped: true, state: j.state, error: j.error ?? null });
          continue;
        }
        const videoPath = (j.outputs ?? []).find((o) => o.kind === "video")?.path ?? j.outputs?.[0]?.path;
        rows.push({ jobId, shotId, videoPath, guide: j.guide ?? null, guideSource: j.guideSource ?? null });
      }
      if (args.dryRun) return { written: false, dryRun: true, rows };

      // 云端不持久化：回写前先把每段引导拉到本地 media/guides（失败不阻断视频落库）
      for (const r of rows) {
        if (r.skipped || !r.guide?.id) continue;
        const localKey = await cacheGuideFromCloud(root, base, r.guide);
        if (localKey) r.guide = { ...r.guide, localKey };
      }

      // 标题与导演台片段同名（「片段 N · Ns」）：引导数据不是独立素材，历史/引导候选必须和来源视频同名
      const wbBefore = await readWorkbench(root, args.projectId).catch(() => null);
      const shotLabel = (shotId: string): string => {
        const shot = wbBefore?.shots.find((s) => s.id === shotId);
        return shot ? `片段 ${shot.number} · ${shot.duration}s` : shotId;
      };

      for (const r of rows) {
        if (r.skipped) continue;
        // 2026-11-09：视频必须进 CAS，storageKey 用 `cas:<hash>.<ext>`。
        // 直接写 ComfyUI 的磁盘绝对路径，前端 resolveMediaUrl 不认 →
        // 「视频素材文件缺失或未获授权」，缩略/播放/发送到插槽全部失效。
        r.storageKey = r.videoPath ?? "";
        let casInfo: { hash: string; ext: string } | undefined;
        if (r.videoPath) {
          try {
            const buf = await fs.readFile(r.videoPath);
            const cas = await uploadToCas(root, {
              projectId: args.projectId,
              filename: path.basename(r.videoPath),
              dataBase64: buf.toString("base64"),
              mime: "video/mp4",
            });
            r.storageKey = cas.storageKey;
            casInfo = { hash: cas.hash, ext: path.extname(r.videoPath).replace(/^\./, "") || "mp4" };
          } catch (err) {
            process.stderr.write(
              `[sync_job_results] CAS 写入失败，回退原路径: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
        const record = {
          id: `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: shotLabel(r.shotId),
          kind: "video", tags: [], bytes: 0, mimeType: "video/mp4",
          createdAt: new Date().toISOString(),
          data: {
            kind: "video", url: "", storageKey: r.storageKey,
            origin: "generation", originSource: "director",
            ...(r.guide?.id ? { guide: r.guide } : {}),
            generation: { jobId: r.jobId, provider: "zeroexo" },
          },
          ...(casInfo ? { cas: casInfo } : {}),
          folderId: null, favorite: false, scope: "project", projectId: args.projectId,
        } as unknown as LibraryAsset;
        await appendAssetRecord(root, record);
      }

      const res = await mutateWorkbench(root, args.projectId, {
        baseVersion: args.baseVersion,
        mutate: (wb) => {
          for (const r of rows) {
            if (r.skipped) continue;
            const shot = wb.shots.find((s) => s.id === r.shotId);
            if (!shot) continue;
            shot.status = "done";
            shot.clipState = "completed";
            shot.media = {
              ...(shot.media ?? {}),
              storageKey: r.storageKey ?? r.videoPath,
              ...(r.guide?.id ? {
                guide: { id: r.guide.id, path: r.guide.path, frames: r.guide.frames, sha256: r.guide.sha256, localKey: r.guide.localKey },
              } : {}),
            };
          }
        },
      });
      return { written: res.written, version: res.after.version, rows, historyWritten: rows.filter((r) => !r.skipped).length };
    },
  });

  // ===== 存量数据修复：绝对路径 storageKey → CAS key（幂等，可重跑） =====
  defTool(server, ctx, {
    name: "repair_asset_storage_keys",
    description: "把历史资产里误写成 ComfyUI 磁盘绝对路径的 storageKey 修成 CAS key（幂等）。修复后前端缩略图、播放、发送到导演台插槽恢复正常。dryRun 只返回待修清单。",
    bits: ["asset.write"],
    schema: {
      projectId: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
    handler: async (args) => {
      const root = dataRoot();
      const file = assetsLibraryFile(root);
      const isAbs = (v: unknown): v is string =>
        typeof v === "string" && (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith("/"));
      /** 同一绝对路径只入 CAS 一次，多个引用共享同一个 cas: key（幂等） */
      interface CasInfo { storageKey: string; hash: string; ext: string }
      const casByPath = new Map<string, CasInfo>();
      const toCasKey = async (abs: string, projectId: string): Promise<CasInfo | null> => {
        const hit = casByPath.get(abs);
        if (hit) return hit;
        if (!(await exists(abs))) return null;
        try {
          const buf = await fs.readFile(abs);
          const ext = path.extname(abs).toLowerCase();
          const mime = ext === ".png" ? "image/png"
            : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
              : ext === ".webm" ? "video/webm" : "video/mp4";
          const cas = await uploadToCas(root, {
            projectId, filename: path.basename(abs),
            dataBase64: buf.toString("base64"), mime,
          });
          const info: CasInfo = {
            storageKey: cas.storageKey,
            hash: cas.hash,
            ext: path.extname(abs).replace(/^\./, "") || "mp4",
          };
          casByPath.set(abs, info);
          return info;
        } catch {
          return null;
        }
      };

      let env: { __lf: 1; value: Array<Record<string, unknown>> } = { __lf: 1, value: [] };
      try { env = JSON.parse(await fs.readFile(file, "utf8")) as typeof env; } catch { /* 文件不存在按空处理 */ }
      const list = env.value ?? [];
      const details: string[] = [];
      let assetFixed = 0;

      // ① 历史资产记录
      for (const a of list) {
        const data = a.data as { storageKey?: string } | undefined;
        const old = data?.storageKey;
        if (!isAbs(old)) continue;
        if (args.projectId && a.projectId !== args.projectId) continue;
        if (args.dryRun) { details.push(`WOULD_FIX_ASSET:${String(a.id)}`); continue; }
        const info = await toCasKey(old, String(a.projectId ?? args.projectId ?? "unknown"));
        if (!info) { details.push(`SKIP_MISSING:${String(a.id)}`); continue; }
        data!.storageKey = info.storageKey;
        (a as Record<string, unknown>).cas = { hash: info.hash, ext: info.ext };
        assetFixed += 1;
        details.push(`ASSET:${String(a.id)}`);
      }

      // ② 已插入导演台的 references[] / media.storageKey（用户截图里那个坏格子）
      const projectsDir = path.join(root, "projects");
      let refsFixed = 0;
      let projectDirs: string[] = [];
      try { projectDirs = await fs.readdir(projectsDir); } catch { /* 无项目目录 */ }
      for (const pid of projectDirs) {
        if (args.projectId && pid !== args.projectId) continue;
        const wbFile = path.join(projectsDir, pid, "entities", "workbench.json");
        let wb: {
          shots?: Array<{
            references?: Array<Record<string, unknown>>;
            media?: Record<string, unknown>;
          }>;
        };
        try { wb = JSON.parse(await fs.readFile(wbFile, "utf8")) as typeof wb; } catch { continue; }
        let changed = false;
        for (const shot of wb.shots ?? []) {
          const slots: Array<Record<string, unknown>> = [
            ...(shot.references ?? []),
            ...(shot.media ? [shot.media] : []),
          ];
          for (const slot of slots) {
            const old = slot.storageKey;
            if (!isAbs(old)) continue;
            if (args.dryRun) { details.push(`WOULD_FIX_REF:${pid}`); continue; }
            const info = await toCasKey(old, pid);
            if (!info) { details.push(`SKIP_MISSING_REF:${pid}`); continue; }
            slot.storageKey = info.storageKey;
            refsFixed += 1;
            changed = true;
          }
        }
        if (changed) {
          details.push(`WORKBENCH:${pid}`);
          if (!args.dryRun) await fs.writeFile(wbFile, JSON.stringify(wb, null, 2), "utf8");
        }
      }

      if (!args.dryRun && assetFixed > 0) {
        await fs.writeFile(file, JSON.stringify(env, null, 2), "utf8");
      }
      return {
        repaired: assetFixed + refsFixed, assetFixed, refsFixed,
        dryRun: !!args.dryRun, details,
      };
    },
  });

  // ===== T4：产物验收 =====
  defTool(server, ctx, {
    name: "verify_output",
    description: "验收生成产物：作业成功、视频文件落盘、guide 元数据与 gd_xxx.safetensors 落盘、导演台 shots[].media.guide 回写、历史资产带 guide。",
    bits: ["workbench.read"],
    schema: {
      projectId: z.string(),
      jobIds: z.array(z.string()),
      baseUrl: z.string().optional(),
    },
    handler: async (args) => {
      const base = args.baseUrl ?? COMFY_BASE();
      const checks: Array<Record<string, unknown>> = [];
      for (const jobId of args.jobIds) {
        let j: JobStatus;
        try { j = await fetchJob(jobId, base); }
        catch (err) { checks.push({ jobId, pass: false, reason: err instanceof Error ? err.message : String(err) }); continue; }
        const videoPath = (j.outputs ?? []).find((o) => o.kind === "video")?.path ?? j.outputs?.[0]?.path;
        const videoPresent = await exists(videoPath);
        const guidePresent = await exists(j.guide?.path);
        const pass = j.state === "success" && videoPresent && !!j.guide?.id && guidePresent;
        checks.push({
          jobId, pass, state: j.state, videoPath, videoPresent,
          guide: j.guide ?? null, guidePresent, guideSource: j.guideSource ?? null,
          guideInPath: j.guideInPath ?? null, error: j.error ?? null,
        });
      }
      const wb = await readWorkbench(dataRoot(), args.projectId);
      const shotsWithGuide = (wb?.shots ?? []).filter((s) => !!s.media?.guide?.id).map((s) => ({ id: s.id, guideId: s.media?.guide?.id }));
      const history = (await readHistory(dataRoot())).filter((a) => a.data?.origin === "generation" && !!a.data?.guide?.id);
      return {
        allPass: checks.every((c) => c.pass === true),
        checks, shotsWithGuide,
        historyWithGuide: history.map(historyItem),
      };
    },
  });

  // ===== 参数契约（避免 Agent 自造键） =====
  defTool(server, ctx, {
    name: "get_param_schema",
    description: "返回导演台真实参数键与约束（steps/scaleFactor/refImageSize/duration 等），供 Agent 配参前核对。",
    bits: ["workbench.read"],
    schema: {},
    handler: async () => ({
      shared: {
        steps: { type: "int", default: 8, min: 1, max: 200 },
        scaleFactor: { type: "float", default: 1, min: 0.1, max: 2, derives: "width/height" },
        refImageSize: { type: "enum", default: "match", options: ["match", "1024", "1280", "1536", "max"] },
        continuityOverlapFrames: { type: "enum", default: 22, options: GUIDE_FRAME_OPTIONS },
        continuityEnabled: { type: "bool", default: false },
        cfg: { type: "float", default: 1 }, seed: { type: "int", default: 0 },
        aspect: { type: "enum", default: "16:9", options: Object.keys(ASPECT) },
      },
      segment: { duration: { type: "float", default: 5, min: 0.2, unit: "s", derives: "17k+5 frames @24fps" } },
      forbiddenKeys: ["resolution", "imageMatch", "prompt"],
    }),
  });
}
