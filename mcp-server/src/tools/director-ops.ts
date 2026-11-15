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
import { GUIDE_FRAME_OPTIONS, VIDEO_ASPECT } from "../broker/params.js";
import { cacheGuideFile } from "../broker/comfy.js";
import type { WorkbenchShot } from "../store/workbench.js";

const COMFY_BASE = (): string => process.env.ZEROEXO_COMFY_BASE ?? "http://127.0.0.1:8188";
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

async function fetchJob(jobId: string, base = COMFY_BASE()): Promise<JobStatus> {
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
    description: "导演台生成已下沉到 ComfyUI 插件：本工具不再提交/执行生成，只做延续法校验；请在网页发起运行，MCP 只查询插件任务状态。",
    bits: ["workbench.write"],
    schema: {
      projectId: z.string(),
      selectedIds: z.array(z.string()).optional(),
      baseUrl: z.string().optional(),
      dryRun: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (args) => {
      guardDryRunConfirm(args);
      const wb = await readWorkbench(dataRoot(), args.projectId);
      if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${args.projectId}`);
      const selectedIds = args.selectedIds?.length ? args.selectedIds : wb.shots.map((s) => s.id);
      if (selectedIds.length === 0) throw new McpError("VALIDATION", "导演台没有片段");
      if (args.dryRun) return { written: false, dryRun: true, projectId: args.projectId, selectedIds };
      // 延续法准入（2026-11-11 用户事故；2026-11-15 改为批次模型）：
      // 只要求「做过延续法计划」。起始段没有缓存 guide 不算错误（首次生成第一段本来就没有），
      // 执行器会按 none 生成；run 内续接由插件批次内循环完成，不逐段发送 guide。
      const continuityOn = wb.sharedParams?.params?.continuityEnabled === true;
      if (continuityOn) {
        const shots = wb.shots as unknown as WorkbenchShot[];
        const selected = shots.filter((s) => selectedIds.includes(s.id));
        const unplanned = selected.filter((s) => !hasContinuityPlan(s as never));
        if (unplanned.length > 0) {
          throw new McpError(
            "CONTINUITY_NOT_PLANNED",
            `延续法已开启，但 ${unplanned.length} 个片段没有延续法计划（段长没按 17k+5 重排、没有接缝标记）。`
            + "先调 plan_continuity_edit：dryRun 出「段/帧/秒/是否吃上一段尾帧」表 → 用户确认 → confirm:true + userConfirmed:true。",
          );
        }
      }
      // 生成执行已下沉到 ComfyUI 插件；MCP 只保留项目操作与任务状态查询。
      // 这里不再创建 MCP 任务（broker 已停用），避免提交后无人执行。
      throw new McpError(
        "VALIDATION",
        "导演台生成已交给 ComfyUI 插件：请由网页发起运行；MCP 只负责查询插件任务状态（list_generation_tasks / get_generation_task）。",
      );
    },
  });

  defTool(server, ctx, {
    name: "run_generation",
    description: "已停用：导演台生成由 ComfyUI 插件执行，请在网页发起运行；MCP 只查询任务状态。",
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
        "run_generation 已停用：导演台生成由 ComfyUI 插件执行，请由网页发起运行。",
      );
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
