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
import { uploadToCas, parseCasStorageKey } from "../store/cas.js";
import { appendAssetRecord, assetsLibraryFile, type LibraryAsset } from "../store/asset-library.js";
import { mutateWorkbench, readWorkbench } from "../store/workbench.js";
import { defTool, guardDryRunConfirm, type Ctx } from "./_register.js";
import { hasContinuityPlan } from "../lib/continuity.js";
import { GUIDE_FRAME_OPTIONS, VIDEO_ASPECT, resolveVideoSize, snapGuide } from "../broker/params.js";
import { durationToFrames } from "../lib/shot-prompt.js";
import { resolveGuide } from "../broker/shot-cache.js";
import { readStoryboard } from "../store/storyboard.js";
import { readScript } from "../store/script.js";
import { reviewProject, reviewSummaryText } from "../lib/shot-review.js";
import { checkScriptReadiness, checkSubjectReadiness } from "../lib/readiness.js";
import { submitPluginTask } from "../broker/plugin-client.js";
import { mirrorPluginTask } from "./tasks.js";
import { cacheGuideFile, resolveComfyBase } from "../broker/comfy.js";
import type { WorkbenchShot } from "../store/workbench.js";
import { readBroadcastComfyModels, type ComfyModels } from "../lib/comfy-models.js";
import { resolveRefStorageKey, type RefLike } from "../lib/subject-refs.js";
import { templatePassthrough } from "../lib/template-params.js";

const GUIDE_ID_RE = /^gd_[A-Za-z0-9_-]{4,64}$/;

/** 从 ComfyUI 的 /view 下载云端产物（MCP 与云 ComfyUI 不在同一台机器时，不能直接读绝对路径） */
async function downloadComfyOutput(base: string, outputPath: string): Promise<Buffer | null> {
  const m = /[\\/]output[\\/](.+)$/i.exec(outputPath ?? "");
  if (!m) return null;
  const rel = m[1]!.replace(/\\/g, "/");
  const slash = rel.lastIndexOf("/");
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const subfolder = slash >= 0 ? rel.slice(0, slash) : "";
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, subfolder, type: "output" }).toString();
  try {
    const res = await fetch(`${base}/view?${qs}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
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

async function fetchJob(jobId: string, base: string): Promise<JobStatus> {
  const res = await fetch(`${base}/zeroexo/v1/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new McpError("IO_ERROR", `作业查询失败 HTTP ${res.status}: ${jobId}`);
  return (await res.json()) as JobStatus;
}

/**
 * 云端不会长期保存产物：同步作业结果时立刻把引导 .safetensors 拉到本地 media/guides。
 * 返回本地键（`guide:<id>.safetensors`），失败返回 null（不阻断视频落库）。
 */
async function cacheGuideFromCloud(base: string, guide: GuideInfo | null | undefined): Promise<string | null> {
  return cacheGuideFile(base, guide);
}

async function exists(p: string | undefined): Promise<boolean> {
  if (!p) return false;
  try { await fs.stat(p); return true; } catch { return false; }
}

/** 导演台插件批次 payload：与网页 director-plugin-payload.ts 同口径（连续 run + 起始 guide + 段内 chain）。 */
function boundaryEnabled(shots: WorkbenchShot[], index: number): boolean {
  const shot = shots[index];
  if (!shot || index <= 0) return false;
  return shot.continuation ? shot.continuation.enabled === true : true;
}

function contiguousRuns(shots: WorkbenchShot[], selectedIds: readonly string[]): number[][] {
  const selected = new Set(selectedIds);
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i]!;
    if (!selected.has(shot.id)) {
      if (current.length) runs.push(current);
      current = [];
      continue;
    }
    if (current.length === 0) {
      current = [i];
      continue;
    }
    const prev = current[current.length - 1]!;
    if (prev === i - 1 && boundaryEnabled(shots, i) && !shot.guide?.id) {
      current.push(i);
    } else {
      runs.push(current);
      current = [i];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/**
 * 提交提示词只认 imagePrompt（分镜结构化提示词唯一来源）。
 * 2026-11-19：不允许回落 videoPrompt / 「第 N 段」。MCP 一回落，提交的就是
 * 和分镜、参考图都无关的自由文本，成片必然对不上，且与网页点击运行的 payload 不同源。
 */
function shotPrompt(shot: WorkbenchShot): string {
  const p = (shot.imagePrompt ?? "").trim();
  if (!p) throw new McpError("VALIDATION", `片段 ${shot.number ?? shot.id} 没有结构化提示词（imagePrompt 为空），拒绝提交`);
  return p;
}

/** CAS 键 → 本地文件（media/cas/<hash>.<ext>） */
function casFilePath(storageKey: string): string | null {
  if (!storageKey.startsWith("cas:")) return null;
  const parsed = parseCasStorageKey(storageKey);
  if (!parsed) return null;
  return path.join(dataRoot(), "media", "cas", `${parsed.hash}.${parsed.ext}`);
}

async function uploadRefImage(base: string, filePath: string, filename: string): Promise<string | null> {
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.append("image", new Blob([buf]), filename);
  form.append("overwrite", "true");
  const res = await fetch(`${base.replace(/\/+$/, "")}/upload/image`, { method: "POST", body: form });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { name?: string; subfolder?: string } | null;
  if (!data?.name) return null;
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/**
 * 按槽号顺序把插槽参考图上传给插件，返回插件侧文件名数组（= @Picture1..N）。
 * 与网页 attachDirectorReferenceImages 同口径：缺文件 / 上传失败都直接抛错，
 * 不允许「静默退化成纯文本生成」。
 */
async function uploadShotReferences(base: string, shot: WorkbenchShot, subjectTree?: unknown): Promise<string[]> {
  const refs = ((shot.references ?? []) as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.kind === "image")
    .slice()
    .sort((a, b) => {
      const pa = typeof a.slotNo === "number" && a.slotNo >= 1 ? a.slotNo : Number.POSITIVE_INFINITY;
      const pb = typeof b.slotNo === "number" && b.slotNo >= 1 ? b.slotNo : Number.POSITIVE_INFINITY;
      return pa - pb;
    });
  /**
   * H3 参考图硬上限 9 张（插件 `ref_video.py::_build_timeline` 只取 `names[:9]`）。
   * 以前这里 `slice(0,9)` 静默截断，提示词里的 @Picture10+ 就成了空引用；现在超了直接报错。
   */
  if (refs.length > 9) {
    throw new McpError(
      "VALIDATION",
      `片段 ${shot.number ?? shot.id} 参考图 ${refs.length} 张，超过 H3 上限 9 张：`
        + refs.map((r, i) => `${i + 1}.${String(r.title ?? r.storageKey ?? r.id ?? "")}`).join("、")
        + "。先合并同主体素材或删掉多余槽位，不允许静默丢图（会让 @PictureN 错位）",
    );
  }
  const names: string[] = [];
  for (const [i, ref] of refs.entries()) {
    /**
     * 2026-11-20 报障：这里原来直接用 records 里的 storageKey，主体换图后仍传旧图
     * （实测 Picture5 还是 `cas:23d2e809` 旧版）。改成与网页 resolveRefVisual 同语义，
     * 按主体树解析当前图；解析不到才报错，不静默退化成旧图。
     */
    const resolved = resolveRefStorageKey(
      {
        id: String(ref.id ?? ""),
        title: typeof ref.title === "string" ? ref.title : undefined,
        storageKey: typeof ref.storageKey === "string" ? ref.storageKey : undefined,
        kind: typeof ref.kind === "string" ? ref.kind : undefined,
        origin: (ref.origin && typeof ref.origin === "object" ? ref.origin : undefined) as RefLike["origin"],
      },
      subjectTree,
    );
    const key = resolved.stale ? "" : String(resolved.key ?? ref.storageKey ?? "");
    const filePath = casFilePath(key);
    if (!filePath) {
      throw new McpError(
        "VALIDATION",
        `片段 ${shot.number ?? shot.id} 第 ${i + 1} 张参考图没有可用文件（${key || "空 key"}）：主体/素材已失效或未挂图，先重新放入插槽再生成`,
      );
    }
    const ext = path.extname(filePath) || ".png";
    const name = await uploadRefImage(base, filePath, `director_${shot.id}_${i}${ext}`);
    if (!name) {
      throw new McpError(
        "IO_ERROR",
        `片段 ${shot.number ?? shot.id} 第 ${i + 1} 张参考图上传失败（${key}）：ComfyUI /upload/image 没返回文件名。`
          + `确认实例在线（${base}）、图片没超过输入上限`,
      );
    }
    names.push(name);
  }
  return names;
}

function buildDirectorPluginPayload(args: {
  projectId: string;
  taskId: string;
  shots: WorkbenchShot[];
  selectedIds: readonly string[];
  shared: Record<string, unknown>;
  base: string;
  models?: ComfyModels;
  dryRun?: boolean;
}): Promise<{
  payload: Record<string, unknown>;
  plan: Array<{ shotId: string; guide: { mode: "initial" | "chain" | "none"; id?: string }; frames: number; durationSec: number; refs?: string[]; params?: Record<string, unknown> }>;
}> {
  return buildPayloadAsync(args);
}

async function buildPayloadAsync(args: {
  projectId: string;
  taskId: string;
  shots: WorkbenchShot[];
  selectedIds: readonly string[];
  shared: Record<string, unknown>;
  base: string;
  models?: ComfyModels;
  dryRun?: boolean;
}): Promise<{
  payload: Record<string, unknown>;
  plan: Array<{ shotId: string; guide: { mode: "initial" | "chain" | "none"; id?: string }; frames: number; durationSec: number; refs?: string[]; params?: Record<string, unknown> }>;
}> {
  const { projectId, taskId, shots, selectedIds, shared } = args;
  const subjectTree = await readStoryboard(dataRoot(), projectId).then((sb) => sb?.subjectTree).catch(() => undefined);
  const aspect = String(shared.aspect ?? "16:9");
  const size = resolveVideoSize(aspect, Number(shared.scaleFactor ?? 1));
  const num = (key: string, fallback: number): number => {
    const n = Number(shared[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  const steps = num("steps", 8);
  const cfg = num("cfg", 1);
  const seed = num("seed", 0);
  const guideFrames = snapGuide(shared.continuityOverlapFrames);
  const segments: Array<Record<string, unknown>> = [];
  const plan: Array<{ shotId: string; guide: { mode: "initial" | "chain" | "none"; id?: string }; frames: number; durationSec: number; refs?: string[]; params?: Record<string, unknown> }> = [];

  for (const run of contiguousRuns(shots, selectedIds)) {
    const headIdx = run[0]!;
    const head = shots[headIdx]!;
    const resolved = head.guide?.id
      ? { id: head.guide.id }
      : boundaryEnabled(shots, headIdx)
        ? resolveGuide(shots, headIdx)
        : { id: "" };
    const startGuide: { mode: "initial" | "chain" | "none"; id?: string } = resolved.id
      ? { mode: "initial", id: resolved.id }
      : { mode: "none" };
    for (const [k, idx] of run.entries()) {
      const shot = shots[idx]!;
      const frames = durationToFrames(Number(shot.duration) || 5);
      const guide = k === 0 ? startGuide : { mode: "chain" as const };
      // 参考图必须真上传（2026-11-19 事故）：只发提示词 = 插件按文本自由发挥，
      // 画面会脱离主体定妆/场景概念图，也会出现果冻式漂移。这里与网页
      // attachDirectorReferenceImages 同源：按槽号顺序上传，缺图直接报错。
      /**
       * dryRun 是纯预检：不碰网络、不传图，只把「会传哪几张」列出来给用户核对。
       * （2026-11-20：以前 dryRun 也要连云端上传，实例一停就没法核对参数。）
       */
      const refTitles = ((shot.references ?? []) as unknown as Array<Record<string, unknown>>)
        .filter((r) => r.kind === "image")
        .map((r) => String(r.title ?? r.storageKey ?? ""));
      const refs = args.dryRun ? [] : await uploadShotReferences(args.base, shot, subjectTree);
      const shotParams = (shot as { paramValues?: Record<string, unknown> }).paramValues ?? {};
      segments.push({
        shotId: shot.id,
        guide,
        params: {
          // 模板级参数（sampler/scheduler/位移/LoRA/缓存开关）：共享值打底，本段覆盖优先。
          // 2026-11-20 报障：原来这些键一个都没下发，插件退回模板默认 → LoRA 恒为 8 步 turbo。
          ...templatePassthrough(shared),
          ...templatePassthrough(shotParams),
          prompt: shotPrompt(shot),
          negative_prompt: String((shot as { negativePrompt?: string }).negativePrompt ?? ""),
          width: size.width,
          height: size.height,
          frames,
          steps,
          cfg,
          seed,
          frame_rate: 24,
          guide_frames: guideFrames,
          live_tae_preview: true,
          liveTaePreview: true,
          ...(refs.length ? { reference_image: refs[0] ?? "", reference_images: refs } : {}),
        },
      });
      plan.push({
        shotId: shot.id,
        guide,
        frames,
        durationSec: Number((frames / 24).toFixed(3)),
        ...(args.dryRun ? { refs: refTitles } : {}),
        ...(args.dryRun
          ? {
              params: {
                ...templatePassthrough(shared),
                ...templatePassthrough(shotParams),
                width: size.width,
                height: size.height,
                frames,
                steps,
                cfg,
                seed,
                frame_rate: 24,
                guide_frames: guideFrames,
              },
            }
          : {}),
      });
    }
  }

  return {
    payload: {
      projectId,
      clientJobId: taskId,
      clientId: taskId,
      kind: "director_run",
      ...(args.models ? { models: args.models } : {}),
      segments,
    },
    plan,
  };
}

let directorTaskSeq = 0;
function newDirectorTaskId(): string {
  directorTaskSeq += 1;
  return `tsk_mcp_${Date.now().toString(36)}_${directorTaskSeq.toString(36)}`;
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
    name: "request_director_run",
    description: "提交导演台批次任务到 ComfyUI 插件：MCP 直接创建插件任务（任务表可被网页与 MCP 共同查询），按连续段提交，run 内 chain 续接；dryRun 先出段/帧/秒/guide 表，confirm 才提交。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      selectedIds: z.array(z.string()).optional(),
      baseUrl: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
      userOverride: z.boolean().optional().describe("用户已看过质检结论并明确认可继续（用户权限高于质检门）"),
      models: z
        .object({
          unet: z.string().optional(),
          videoVae: z.string().optional(),
          audioVae: z.string().optional(),
          clip: z.string().optional(),
          clipType: z.string().optional(),
        })
        .optional()
        .describe("模型四件套；不传则读网页模型映射面板广播的当前选择（.lf/zeroexo/app_meta/comfyui-models.json）"),
    },
    handler: async (args) => {
      guardDryRunConfirm(args, { requireOne: true });
      const wb = await readWorkbench(dataRoot(), args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${args.projectId}`);
      const allShots = wb.shots as unknown as WorkbenchShot[];
      const requested = args.selectedIds?.length ? args.selectedIds : allShots.map((s) => s.id);
      const selectedIds = requested.filter((id) => allShots.some((s) => s.id === id));
      if (selectedIds.length === 0) throw new McpError("VALIDATION", "导演台没有可运行的片段");
      /**
       * 模型四件套（2026-11-20 报障：网页/MCP 两条链路都没真正下发给插件，
       * 插件退回模板自选 → 48G bf16 文本编码器把 47.4G 卡打 OOM）。
       * 口径：显式传参优先 → 网页广播的当前选择 → 都没有就明确报错，不静默降档。
       */
      const models = args.models ?? (await readBroadcastComfyModels()) ?? undefined;
      // 质检门（2026-11-19 用户要求）：剧本未入库 / 主体缺图 / 提示词不合格 → 不许提交。
      // 用户权力更高：明确认可后传 userOverride:true 放行，并把结论原样留痕。
      if (!args.dryRun) {
        const sb = await readStoryboard(dataRoot(), args.projectId);
        const script = await readScript(dataRoot(), args.projectId);
        const review = reviewProject(wb, sb, { scriptHasEpisodes: (script?.episodes ?? []).length > 0 });
        const scriptReady = checkScriptReadiness(script);
        const subjectReady = checkSubjectReadiness(sb, (wb?.shots ?? []) as never);
        const readinessErrors = [
          ...scriptReady.issues.filter((i) => i.level === "error"),
          ...subjectReady.issues.filter((i) => i.level === "error"),
        ];
        const scoped = {
          ...review,
          shots: review.shots.filter((s) => selectedIds.includes(s.shotId)),
        };
        if (!args.userOverride && (!scriptReady.ready || !subjectReady.ready)) {
          throw new McpError(
            "PREFLIGHT_GATE_FAILED",
            `前置门未过：\n${readinessErrors.map((i) => `  - ${i.message}（${i.fix ?? ""}）`).join("\n")}\n\n`
            + "先把剧本定稿、把出镜主体补图；用户明确认可后传 userOverride:true。",
          );
        }
        if (!scoped.ok && !args.userOverride) {
          throw new McpError(
            "QUALITY_GATE_FAILED",
            `${reviewSummaryText(scoped)}\n\n先按 fix 修（set_shot_prompt / apply_shot_prompts / 补主体图），再 review_shots；`
            + "若用户已看过并明确认为可以出片，带 userOverride:true 重试（用户权限高于质检门）。",
          );
        }
        if (!scoped.ok && args.userOverride) {
          const failed = scoped.shots.filter((s) => !s.pass);
          console.warn(`[quality-gate] userOverride 放行 ${scoped.shots.length} 段，未过线 ${failed.length} 段（项目 ${args.projectId}）`);
        }
      }
      // 延续法准入（2026-11-11 用户事故；2026-11-15 改为批次模型）：
      // 只要求「做过延续法计划」。起始段没有缓存 guide 不算错误（首次生成第一段本来就没有），
      // 执行器会按 none 生成；run 内续接由插件批次内循环完成，不逐段发送 guide。
      // dryRun 不拦：预检本来就是用来看「这段会按什么参数跑」，被门禁挡住就没法核对参数。
      const continuityOn = wb.sharedParams?.params?.continuityEnabled === true;
      if (!args.dryRun && continuityOn) {
        const selected = allShots.filter((s) => selectedIds.includes(s.id));
        const unplanned = selected.filter((s) => !hasContinuityPlan(s as never));
        if (unplanned.length > 0) {
          throw new McpError(
            "CONTINUITY_NOT_PLANNED",
            `延续法已开启，但 ${unplanned.length} 个片段没有延续法计划（段长没按 17k+5 重排、没有接缝标记）。`
            + "先调 plan_continuity_edit：dryRun 出「段/帧/秒/是否吃上一段尾帧」表 → 用户确认 → confirm:true + userConfirmed:true。",
          );
        }
      }
      const taskId = newDirectorTaskId();
      const comfyBase = await resolveComfyBase(args.baseUrl);
      if (!args.dryRun && !models) {
        throw new McpError(
          "MODELS_NOT_CONFIGURED",
          "没有可用的模型四件套：网页「模型映射」里先选好 unet / 视频VAE / 音频VAE / 文本编码器（保存后会自动广播），"
            + "或本次调用显式传 models。不自动挑模型，避免插件退回模板默认（bf16 文本编码器会打爆 48G 卡）。",
        );
      }
      const built = await buildDirectorPluginPayload({
        projectId: args.projectId,
        taskId,
        shots: allShots,
        selectedIds,
        shared: (wb.sharedParams?.params ?? {}) as Record<string, unknown>,
        base: comfyBase,
        models,
        dryRun: args.dryRun,
      });
      if (args.dryRun) {
        return {
          written: false,
          dryRun: true,
          projectId: args.projectId,
          taskId,
          selectedIds,
          models: models ?? null,
          totalFrames: built.plan.reduce((sum, s) => sum + s.frames, 0),
          segments: built.plan,
        };
      }
      // 插件任务表是唯一事实源：网页刷新、MCP get_generation_task / cancel_generation_task 都读它。
      const task = await submitPluginTask(built.payload, args.baseUrl);
      // 镜像进本地任务表：网页队列先看到 MCP 发起的任务（不依赖云端插件是否可达）
      void mirrorPluginTask(task);
      return {
        written: true,
        projectId: args.projectId,
        taskId: task.taskId,
        state: task.state,
        currentSegment: task.currentSegment ?? null,
        doneCount: task.doneCount ?? 0,
        totalCount: task.totalCount ?? built.plan.length,
        segments: built.plan,
        hint: "任务已提交到 ComfyUI 插件；用 get_generation_task / list_generation_tasks 查进度，用 cancel_generation_task 取消。",
      };
    },
  });

  defTool(server, ctx, {
    name: "run_generation",
    description: "已停用：请改用 request_director_run（MCP 已支持直接提交导演台批次任务），本工具保留仅为兼容旧调用。",
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
      const wb = await readWorkbench(dataRoot(), args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${args.projectId}`);
      throw new McpError(
        "VALIDATION",
        "run_generation 已停用：请改用 request_director_run（MCP 已支持直接提交导演台批次任务）。",
      );
    },
  });

  defTool(server, ctx, {
    name: "get_job",
    description: "查询单个 ComfyUI 作业状态（state/outputs/guide/guideSource/guideInPath/error）。",
    bits: ["workbench.read"],
    schema: { jobId: z.string(), baseUrl: z.string().optional() },
    handler: async (args) => fetchJob(args.jobId, await resolveComfyBase(args.baseUrl)),
  });

  defTool(server, ctx, {
    name: "list_jobs",
    description: "批量查询作业状态，返回每项结果与汇总 doneCount/failedCount/allDone。",
    bits: ["workbench.read"],
    schema: { jobIds: z.array(z.string()), baseUrl: z.string().optional() },
    handler: async (args) => {
      const base = await resolveComfyBase(args.baseUrl);
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
      const base = await resolveComfyBase(args.baseUrl);
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
        const localKey = await cacheGuideFromCloud(base, r.guide);
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
            // 云 ComfyUI 的绝对路径本机读不到：先试本地，失败再走 /view 下载
            const buf = await fs.readFile(r.videoPath).catch(() => downloadComfyOutput(base, r.videoPath!));
            if (!buf) throw new Error(`无法读取视频: ${r.videoPath}`);
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
      const base = await resolveComfyBase(args.baseUrl);
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
        continuityOverlapFrames: { type: "enum", default: 22, options: [...GUIDE_FRAME_OPTIONS] },
        continuityEnabled: { type: "bool", default: false },
        cfg: { type: "float", default: 1 }, seed: { type: "int", default: 0 },
        aspect: { type: "enum", default: "16:9", options: Object.keys(VIDEO_ASPECT) },
      },
      segment: { duration: { type: "float", default: 5, min: 0.2, unit: "s", derives: "17k+5 frames @24fps" } },
      forbiddenKeys: ["resolution", "imageMatch", "prompt"],
    }),
  });
}
