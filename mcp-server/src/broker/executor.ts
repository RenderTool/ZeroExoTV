/**
 * MCP Task Broker 执行器（项目侧唯一执行者）。
 *
 * - 串行推进：全局同一时刻只跑一个任务（ComfyUI 本身串行，避免多开页面互相抢队列）。
 * - 跨进程唯一：任务先 claimTask 拿 lease，拿不到就不碰（IDE MCP 与 fs-server 同时在线也只跑一份）。
 * - 重启恢复：running 任务被重新认领后，已提交的段沿用 comfyJobId 继续查，不重复提交。
 * - 导演台：选中片段按时间线切成连续 run；一个任务只提交一个批次，批次里每个 run 的第一段带起始 guide
 *   （上一段当前缓存），其余段用 chain 指令让插件内循环续接 —— 不逐段发送 guide，也不回退插件 LAST_GUIDE。
 * - 插件只被动执行作业，不持有任何项目数据；项目数据（workbench/CAS/资产记录）全在 MCP 落库。
 * - 预览：/ws 最后一帧写盘并挂到任务上，刷新/换浏览器后仍能看到。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataRoot } from "../config.js";
import { McpError } from "../errors.js";
import { durationToFrames } from "../lib/shot-prompt.js";
import { appendAssetRecord, type LibraryAsset } from "../store/asset-library.js";
import { uploadToCas } from "../store/cas.js";
import { getCanvas, listCanvases } from "../store/canvases.js";
import { readWorkbench, mutateWorkbench, type WorkbenchShot, type WorkbenchShotVersion } from "../store/workbench.js";
import {
  claimTask,
  createTask,
  heartbeatTask,
  listTasks,
  readTask,
  releaseTask,
  updateTask,
  type ImageTaskRequest,
  type TaskRecord,
  type TaskSegment,
} from "../store/tasks.js";
import {
  cacheGuideFile,
  cancelComfyJob,
  ComfyPreviewSocket,
  detectLowVram,
  downloadComfyOutput,
  ensureComfyGuide,
  getComfyJob,
  newClientId,
  probeComfy,
  resolveComfyBase,
  savePreviewImage,
  submitComfyBatch,
  submitComfyJob,
  uploadComfyImage,
  type ComfyJobStatus,
} from "./comfy.js";
import {
  clampQwenSize,
  resolveMegapixelSize,
  resolveVideoSize,
  snapGuide,
} from "./params.js";
import { appendVersion, resolveGuide } from "./shot-cache.js";

const POLL_MS = 2500;
const MAX_WAIT_MS = 60 * 60 * 1000;
const IMAGE_MAX_WAIT_MS = 20 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let started = false;

export function startBroker(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => { void tick(); }, 1000);
  if (typeof timer.unref === "function") timer.unref();
  void tick();
  process.stderr.write("[zeroexo-broker] task broker started\n");
}

export function stopBroker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

/** 供 HTTP 提交调用：只建任务，执行交给 worker（排队语义，网页立刻拿到 taskId） */
export async function submitDirectorTask(input: {
  projectId: string;
  selectedIds: string[];
  episode?: string;
  baseUrl?: string;
  models?: Record<string, string>;
}): Promise<TaskRecord> {
  const root = dataRoot();
  const wb = await readWorkbench(root, input.projectId);
  if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${input.projectId}`);
  const known = new Set(wb.shots.map((s) => s.id));
  const missing = input.selectedIds.filter((id) => !known.has(id));
  if (missing.length > 0) throw new McpError("VALIDATION", `片段不存在: ${missing.join("、")}`);
  return createTask(root, {
    projectId: input.projectId,
    kind: "director_run",
    title: `导演台出片 · ${input.selectedIds.length} 段`,
    request: {
      kind: "director_run",
      selectedIds: input.selectedIds,
      ...(input.episode ? { episode: input.episode } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.models ? { models: input.models } : {}),
    },
  });
}

export async function submitImageTask(input: {
  projectId: string;
  requests: ImageTaskRequest[];
  title?: string;
}): Promise<TaskRecord> {
  if (input.requests.length === 0) throw new McpError("VALIDATION", "requests 不能为空");
  return createTask(dataRoot(), {
    projectId: input.projectId,
    kind: "canvas_image",
    title: input.title ?? `画布图片 · ${input.requests.length} 张`,
    request: { kind: "canvas_image", requests: input.requests },
  });
}

/** 每秒一次：优先接着跑已认领过的 running 任务（重启恢复），否则取最早的 queued */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  let claimed: string | null = null;
  try {
    const root = dataRoot();
    const active = await listTasks(root, { activeOnly: true, limit: 8 });
    const target = active.find((t) => t.state === "running") ?? active.find((t) => t.state === "queued");
    if (!target) return;
    if (!(await claimTask(target.taskId, root))) return;
    claimed = target.taskId;
    await runTask(target.taskId);
  } catch (err) {
    process.stderr.write(`[zeroexo-broker] tick failed: ${(err as Error).message}\n`);
  } finally {
    if (claimed) await releaseTask(claimed).catch(() => undefined);
    running = false;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTerminal(state: TaskRecord["state"]): boolean {
  return state === "success" || state === "failed" || state === "canceled";
}

/** 终态收尾：未完成段按取消/失败标记，避免永远显示“排队中” */
async function finishTask(
  taskId: string,
  state: "success" | "failed" | "canceled",
  error?: string,
): Promise<void> {
  await updateTask(taskId, (task) => {
    task.state = state;
    if (error) task.error = error;
    task.currentSegment = null;
    task.doneCount = task.segments.filter((s) => s.state === "success").length;
    for (const seg of task.segments) {
      if (seg.state === "success") continue;
      if (seg.state === "running") {
        seg.state = state === "canceled" ? "canceled" : "failed";
        seg.finishedAt = new Date().toISOString();
        if (state === "failed" && error && !seg.error) seg.error = error;
      } else if (state !== "success") {
        seg.state = "canceled";
        if (state === "failed" && !seg.error) seg.error = "前一段失败，未执行";
      }
    }
    // 失败但没有任何段被标 failed（例如提交前就失败）：把当前段标失败，别让用户以为只是“取消”
    if (state === "failed" && !task.segments.some((s) => s.state === "failed")) {
      const target = task.segments.find((s) => s.index === task.currentSegment)
        ?? task.segments.find((s) => s.state === "canceled");
      if (target) {
        target.state = "failed";
        if (error) target.error = error;
        target.finishedAt = new Date().toISOString();
      }
    }
  });
}

async function markSegment(
  taskId: string,
  index: number,
  patch: (seg: TaskSegment, task: TaskRecord) => void,
): Promise<void> {
  await updateTask(taskId, (task) => {
    const seg = task.segments.find((s) => s.index === index);
    if (!seg) return;
    patch(seg, task);
    task.doneCount = task.segments.filter((s) => s.state === "success").length;
    if (seg.state === "running") task.currentSegment = index;
  });
}

/** 任务级预览会话：comfy WS 最后一帧落盘（≥1.2s 一次），进度顺带写进当前段 */
function startPreview(taskId: string, projectId: string, base: string, clientId: string) {
  let seq = 0;
  let lastWriteAt = 0;
  let pending: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const write = async (dataUrl: string): Promise<void> => {
    if (closed) return;
    lastWriteAt = Date.now();
    // 帧归属当前正在跑的段（插件批次一次只跑一段）；每段各自保留最后一帧，刷新后互不覆盖
    const current = await readTask(taskId).catch(() => null);
    const segmentIndex = current?.currentSegment ?? 0;
    const saved = await savePreviewImage(projectId, taskId, segmentIndex, seq++, dataUrl).catch(() => null);
    if (!saved || closed) return;
    await updateTask(taskId, (task) => {
      task.previewKey = saved.storageKey;
      const seg = task.segments.find((s) => s.index === segmentIndex);
      if (seg) {
        seg.previewKey = saved.storageKey;
        task.previewSegment = seg.index;
      }
    }).catch(() => undefined);
  };

  const schedule = (dataUrl: string): void => {
    const wait = 1200 - (Date.now() - lastWriteAt);
    if (wait <= 0) { void write(dataUrl); return; }
    pending = dataUrl;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const next = pending;
      pending = null;
      if (next) void write(next);
    }, wait);
  };

  const socket = new ComfyPreviewSocket(base, clientId, {
    onFrame: (frame) => {
      if (closed) return;
      if (frame.image) schedule(frame.image);
      if (frame.step !== null && frame.totalSteps !== null) {
        // 进度合并写：与预览同一节流窗口，避免每帧一次落盘
        if (Date.now() - lastWriteAt > 1200) {
          lastWriteAt = Date.now();
          void updateTask(taskId, (task) => {
            const index = task.currentSegment
              ?? task.segments.find((s) => s.state === "running")?.index
              ?? null;
            const seg = index ? task.segments.find((s) => s.index === index) : undefined;
            if (seg) seg.progress = { step: frame.step!, totalSteps: frame.totalSteps! };
          }).catch(() => undefined);
        }
      }
    },
  });
  socket.connect();

  return {
    close: () => {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      socket.close();
    },
  };
}

async function runTask(taskId: string): Promise<void> {
  const root = dataRoot();
  const task = await readTask(taskId, root);
  if (!task || isTerminal(task.state)) return;
  if (task.cancelRequested) {
    await finishTask(taskId, "canceled");
    return;
  }

  const beat = setInterval(() => { void heartbeatTask(taskId, root); }, 8000);
  if (typeof beat.unref === "function") beat.unref();
  let preview: { close(): void } | null = null;
  try {
    const base = await resolveComfyBase(
      task.request.kind === "director_run" ? task.request.baseUrl : undefined,
    );
    if (!(await probeComfy(base))) {
      throw new McpError("IO_ERROR", `ComfyUI 不可达（${base}）：确认云端在线、地址正确，再重试任务`);
    }
    const clientId = task.engine?.clientId ?? newClientId();
    await updateTask(taskId, (t) => {
      t.state = "running";
      t.attempt += 1;
      t.engine = { baseUrl: base, clientId };
      t.error = undefined;
    });
    preview = startPreview(taskId, task.projectId, base, clientId);
    if (task.kind === "director_run") await runDirector(taskId, base);
    else await runImages(taskId, base);
  } catch (err) {
    await finishTask(taskId, "failed", msg(err)).catch(() => undefined);
  } finally {
    preview?.close();
    clearInterval(beat);
  }
}

// ===== 导演台 =====

/**
 * 选中片段按时间线相邻切成若干连续段（run）。
 * 例：时间线 1..12，用户选 3,4,6,7 → [[2,3],[5,6]]（0 基下标）。
 * 显式断开衔接（shot.continuation.enabled=false）的段会另起一个 run。
 * 每个 run 的第一段吃「时间线上一段当前缓存」的 guide（没有就不用，绝不回退）；run 内其余段
 * 在同一个批次里由插件内循环续接 —— 项目侧不逐段发送 guide。
 */
export function contiguousRuns(
  all: WorkbenchShot[],
  selectedIds: string[],
  shouldContinue?: (prevIndex: number, index: number) => boolean,
): number[][] {
  const order = new Map(all.map((s, i) => [s.id, i]));
  const selected = new Set(selectedIds);
  const idxs = [...new Set(selectedIds)]
    .map((id) => order.get(id))
    .filter((i): i is number => i !== undefined)
    .sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const i of idxs) {
    const last = runs[runs.length - 1];
    const adjacent = last && i === last[last.length - 1]! + 1;
    const prevSelected = order.size > 0 && i > 0 && selected.has(all[i - 1]!.id) && adjacent;
    const continues = prevSelected && (shouldContinue ? shouldContinue(i - 1, i) : true);
    if (last && continues) last.push(i);
    else runs.push([i]);
  }
  return runs;
}

interface PlannedSegment {
  shot: WorkbenchShot;
  /** 批次里的 guide 指令：initial=起始段显式引导；chain=上一段产出；none=不用 */
  mode: "initial" | "chain" | "none";
  guideId?: string;
  /** 云端缓存校验用的 sha256（拿得到才比对内容） */
  guideSha256?: string;
  guideSource: "cache" | "slot" | "chain" | "none";
  guideSourceShotId?: string;
  guideFrames?: number;
}

/** 插件抽出的成品最后一帧 → 项目任务预览文件；返回 image: key。 */
async function importFinalPreview(
  projectId: string,
  taskId: string,
  segmentIndex: number,
  srcPath: string,
): Promise<string | null> {
  try {
    const buf = await fs.readFile(srcPath);
    if (buf.length === 0) return null;
    const ext = path.extname(srcPath).toLowerCase() || ".png";
    const dirRel = `assets/${projectId}/tasks`;
    const dirAbs = path.join(dataRoot(), dirRel);
    await fs.mkdir(dirAbs, { recursive: true });
    const prefix = `${taskId}-s${segmentIndex}-final`;
    const name = `${prefix}${ext}`;
    await fs.writeFile(path.join(dirAbs, name), buf);
    const old = await fs.readdir(dirAbs).catch(() => [] as string[]);
    await Promise.all(old
      .filter((f) => f.startsWith(prefix) && f !== name)
      .map((f) => fs.rm(path.join(dirAbs, f), { force: true }).catch(() => undefined)));
    return `image:${dirRel}/${name}`;
  } catch {
    return null;
  }
}

async function runDirector(taskId: string, base: string): Promise<void> {
  const root = dataRoot();
  const task0 = await readTask(taskId, root);
  if (!task0 || task0.request.kind !== "director_run") throw new McpError("VALIDATION", "任务类型不符");
  const request = task0.request;
  const wb = await readWorkbench(root, task0.projectId);
  if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${task0.projectId}`);
  const all = wb.shots as WorkbenchShot[];
  const byId = new Map(all.map((s) => [s.id, s]));
  const shared = (wb.sharedParams?.params ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number): number => {
    const n = Number(shared[key]);
    return Number.isFinite(n) ? n : fallback;
  };
  /** 该段是否要吃上一段（段级开关；缺省 true，与导演台链接图标默认开启一致）。段 1 恒不吃。 */
  const boundaryEnabled = (index: number): boolean => {
    const shot = all[index];
    if (!shot || index <= 0) return false;
    return shot.continuation ? shot.continuation.enabled === true : true;
  };
  const runs = contiguousRuns(all, request.selectedIds, (_prev, index) => boundaryEnabled(index));
  if (runs.length === 0) throw new McpError("VALIDATION", "导演台没有可运行的片段");

  const aspect = String(shared["aspect"] ?? "16:9");
  const { width, height } = resolveVideoSize(aspect, Number(shared["scaleFactor"] ?? 1));
  const steps = num("steps", 8);
  const cfg = num("cfg", 1);
  const seed = num("seed", 0);
  const guideFrames = snapGuide(shared["continuityOverlapFrames"]);
  const lowVram = await detectLowVram(base);
  const runParams = { width, height, steps, cfg, seed, guideFrames };

  // 每个 run 只解析第一段的起始 guide；run 内其余段交给批次内部 chain。
  // 起始段没有可用 guide 时直接不用（首次生成第一段本来就没有 guide），绝不拿别的段兜底。
  const planned: PlannedSegment[] = [];
  for (const run of runs) {
    const headIdx = run[0]!;
    const head = all[headIdx]!;
    const slot = head.guide;
    const starting = slot?.id
      ? { id: slot.id, source: "slot" as const, frames: slot.frames, sha256: slot.sha256, sourceShotId: undefined }
      : boundaryEnabled(headIdx)
        ? resolveGuide(all, headIdx)
        : { id: "", source: "none" as const, frames: undefined, sourceShotId: undefined };
    run.forEach((idx, k) => {
      const shot = all[idx]!;
      if (k === 0) {
        planned.push({
          shot,
          mode: starting.id ? "initial" : "none",
          ...(starting.id ? { guideId: starting.id } : {}),
          ...(starting.id && (starting as { sha256?: string }).sha256
            ? { guideSha256: (starting as { sha256?: string }).sha256 }
            : {}),
          guideSource: starting.id ? starting.source : "none",
          ...(starting.sourceShotId ? { guideSourceShotId: starting.sourceShotId } : {}),
          ...(starting.frames ? { guideFrames: starting.frames } : {}),
        });
      } else {
        planned.push({
          shot,
          mode: "chain",
          guideSource: "chain",
          guideSourceShotId: all[run[k - 1]!]!.id,
        });
      }
    });
  }

  // 段顺序 = 时间线顺序；重启恢复时保留已完成的段与批次 id，不重复提交
  await updateTask(taskId, (t) => {
    t.totalCount = planned.length;
    t.segments = planned.map((p, i) => {
      const prev = t.segments.find((s) => s.shotId === p.shot.id);
      return {
        index: i + 1,
        shotId: p.shot.id,
        state: prev?.state === "success" ? "success" : prev?.state === "failed" ? "failed" : "queued",
        ...(prev?.output ? { output: prev.output } : {}),
        ...(prev?.comfyJobId ? { comfyJobId: prev.comfyJobId } : {}),
        ...(prev?.state === "success" && prev.finishedAt ? { finishedAt: prev.finishedAt } : {}),
        guide: {
          id: p.guideId ?? "",
          source: p.guideSource,
          ...(p.guideSourceShotId ? { sourceShotId: p.guideSourceShotId } : {}),
          ...(p.guideFrames ? { frames: p.guideFrames } : {}),
        },
        prompt: promptOf(p.shot),
      };
    });
  });

  const firstSeg = task0.segments[0];
  let batchId = firstSeg?.comfyJobId ?? null;
  if (!batchId) {
    const succeeded = task0.segments.filter((s) => s.state === "success").length;
    if (succeeded > 0) {
      throw new McpError("VALIDATION", "任务里已有完成段但缺少批次 id，无法安全续接；请重新提交任务");
    }
    // 双重兜底（2026-11-19 用户拍板）：云端输出是账户制存储，机器换了只要没删引导就还在。
    // 提交前先查 ComfyUI 自己的 output/zeroexo/guides/<id>.safetensors；缺了再从本机
    // media/guides 传上去；两边都没有才报错，不静默降级成 none。
    const initialGuides = new Map<string, string | undefined>();
    for (const p of planned) {
      if (p.mode === "initial" && p.guideId && !initialGuides.has(p.guideId)) {
        initialGuides.set(p.guideId, p.guideSha256);
      }
    }
    for (const [gid, sha] of initialGuides) {
      if (!(await ensureComfyGuide(base, gid, sha)) ) {
        throw new McpError(
          "VALIDATION",
          `起始引导 ${gid} 在 ComfyUI 输出缓存与本机 media/guides 里都不存在 / 内容不一致，或云端插件不是 0.1.1（guides 查询与上传都会 404）。`
            + `先确认云端插件已升级；再在项目侧生成/缓存该引导，或把该段改成 none`,
        );
      }
    }
    const segments: Array<{ shotId: string; guide: { mode: "initial" | "chain" | "none"; id?: string }; params: Record<string, unknown> }> = [];
    for (const p of planned) {
      const refImages = (p.shot.references ?? [])
        .filter((r) => r.kind === "image" && r.storageKey)
        .slice(0, 9);
      const refNames: string[] = [];
      for (const ref of refImages) {
        if (!ref.storageKey) continue;
        const name = await uploadRef(base, ref.storageKey, `zxb_${p.shot.id}_${refNames.length}`);
        if (name) refNames.push(name);
      }
      segments.push({
        shotId: p.shot.id,
        guide: { mode: p.mode, ...(p.guideId ? { id: p.guideId } : {}) },
        params: {
          prompt: promptOf(p.shot),
          negative_prompt: String((p.shot as { negativePrompt?: string }).negativePrompt ?? ""),
          width,
          height,
          frames: durationToFrames(Number(p.shot.duration) || 5),
          steps,
          cfg,
          seed,
          frame_rate: 24,
          guide_frames: guideFrames,
          use_low_vram: lowVram,
          ...(refNames[0]
            ? { reference_image: refNames[0], reference_images: refNames }
            : {}),
        },
      });
    }
    try {
      batchId = await submitComfyBatch(base, {
        clientJobId: `zxb_${taskId}`,
        clientId: task0.engine?.clientId,
        runId: taskId,
        ...(request.models ? { models: request.models } : {}),
        segments,
      });
    } catch (err) {
      throw new McpError("IO_ERROR", `提交批次失败：${msg(err)}`);
    }
    await updateTask(taskId, (t) => {
      for (const seg of t.segments) seg.comfyJobId = batchId!;
      t.currentSegment = 1;
    });
  }

  const runBatchId = batchId;
  if (!runBatchId) throw new McpError("IO_ERROR", "批次 id 缺失，任务无法继续");
  let failures = 0;
  for (;;) {
    const cur = await readTask(taskId, root);
    if (!cur) return;
    if (cur.cancelRequested) {
      await cancelComfyJob(base, runBatchId);
      await finishTask(taskId, "canceled");
      return;
    }
    let status: ComfyJobStatus;
    try {
      status = await getComfyJob(base, runBatchId);
      failures = 0;
    } catch (err) {
      failures += 1;
      const m = msg(err);
      if (/404|not found/i.test(m) || failures >= 3) {
        throw new McpError(
          "IO_ERROR",
          /404|not found/i.test(m) ? "ComfyUI 上已找不到该批次（服务重启/队列被清）" : m,
        );
      }
      await sleep(POLL_MS);
      continue;
    }
    if (status.state === "cancelled") {
      await finishTask(taskId, "canceled");
      return;
    }
    const remote = status.segments ?? [];
    for (const [i, seg] of cur.segments.entries()) {
      const st = remote[i];
      if (!st) continue;
      if (seg.state === "success") continue;
      if (st.state === "error" || st.state === "cancelled") {
        const reason = st.error || `第 ${seg.index} 段生成失败`;
        if (st.state === "cancelled" && cur.cancelRequested) {
          await finishTask(taskId, "canceled");
          return;
        }
        await markSegment(taskId, seg.index, (s) => {
          s.state = "failed";
          s.error = reason;
          s.finishedAt = new Date().toISOString();
        });
        await finishTask(taskId, "failed", `第 ${seg.index} 段：${reason}`);
        return;
      }
      if (st.state === "success") {
        const shot = seg.shotId ? byId.get(seg.shotId) : undefined;
        if (!shot) {
          await finishTask(taskId, "failed", `第 ${seg.index} 段对应的片段已不存在`);
          return;
        }
        // 插件用成品视频最后一帧生成高清封面；优先于 WS 早期低清帧
        if (st.previewPath) {
          const finalKey = await importFinalPreview(task0.projectId, taskId, seg.index, st.previewPath);
          if (finalKey) {
            seg.previewKey = finalKey;
            await markSegment(taskId, seg.index, (s) => { s.previewKey = finalKey; });
          }
        }
        try {
          // 每段只用自己的预览帧，绝不把批次的某一帧塞给所有段
          const saved = await landVideo(
            taskId,
            shot,
            { jobId: `${runBatchId}#${i + 1}`, state: "success", outputs: st.outputs, guide: st.guide ?? null },
            seg.previewKey,
            { ...runParams, guideId: seg.guide?.id ?? "" },
          );
          await markSegment(taskId, seg.index, (s) => {
            s.state = "success";
            s.progress = undefined;
            s.output = saved.output;
            s.finishedAt = new Date().toISOString();
          });
          await updateTask(taskId, (t) => {
            if (!t.outputs.some((o) => o.storageKey === saved.output.storageKey)) t.outputs.push(saved.output);
          });
          await markSegment(taskId, seg.index, (s) => {
            if (s.state === "success") s.previewKey = saved.previewKey;
          });
        } catch (err) {
          const reason = `第 ${seg.index} 段已生成但保存失败：${msg(err)}`;
          await markSegment(taskId, seg.index, (s) => {
            s.state = "failed";
            s.error = reason;
            s.finishedAt = new Date().toISOString();
          });
          await finishTask(taskId, "failed", reason);
          return;
        }
        continue;
      }
      await markSegment(taskId, seg.index, (s) => {
        s.state = status.currentSegment === seg.index ? "running" : "queued";
      });
    }

    await updateTask(taskId, (t) => {
      t.currentSegment = status.currentSegment ?? t.segments.find((s) => s.state !== "success")?.index ?? null;
      t.doneCount = t.segments.filter((s) => s.state === "success").length;
    }).catch(() => undefined);

    if (status.state === "success") {
      // 防御：插件说批次成功但仍有段没落完时，绝不能把整任务标成功（否则段会永远停在 queued）
      const latest = await readTask(taskId, root);
      const allDone = latest ? latest.segments.every((s) => s.state === "success") : false;
      if (allDone) {
        await finishTask(taskId, "success");
        return;
      }
      await sleep(POLL_MS);
      continue;
    }
    if (status.state === "error") {
      await finishTask(taskId, "failed", status.error || "批次执行失败");
      return;
    }
    // 导演台批次不设硬超时：长视频/云端排队可能跑几小时，
    // 只由用户取消或 ComfyUI 明确失败来结束。
    await sleep(POLL_MS);
  }
}

function promptOf(shot: WorkbenchShot): string {
  const prompt = (shot.imagePrompt || shot.videoPrompt || "").trim();
  return prompt || `第 ${shot.number} 段`;
}

/** 参考图上传（storageKey → ComfyUI input 文件名；失败不阻断，退化成纯文字生成） */
async function uploadRef(base: string, storageKey: string, stem: string): Promise<string> {
  const buf = await readStorageBuffer(storageKey);
  if (!buf) return "";
  const ext = path.extname(storageKey).replace(/^\./, "") || "png";
  return (await uploadComfyImage(base, buf, `${stem}.${ext}`)) ?? "";
}

/** 等待 ComfyUI 作业终态；期间响应取消 */
async function waitForJob(
  base: string,
  jobId: string,
  taskId: string,
  timeoutMs = MAX_WAIT_MS,
): Promise<ComfyJobStatus> {
  const startedAt = Date.now();
  let failures = 0;
  for (;;) {
    const task = await readTask(taskId);
    if (task?.cancelRequested) {
      await cancelComfyJob(base, jobId);
      return { state: "cancelled", jobId };
    }
    let status: ComfyJobStatus;
    try {
      status = await getComfyJob(base, jobId);
      failures = 0;
    } catch (err) {
      failures += 1;
      const m = msg(err);
      if (/404|not found/i.test(m) || failures >= 3) {
        return {
          state: "error",
          jobId,
          error: /404|not found/i.test(m) ? "ComfyUI 上已找不到该作业（服务重启/队列被清）" : m,
        };
      }
      await sleep(POLL_MS);
      continue;
    }
    if (status.state === "success" || status.state === "error" || status.state === "cancelled") return status;
    if (Date.now() - startedAt > timeoutMs) {
      await cancelComfyJob(base, jobId);
      return { state: "error", jobId, error: `等待作业超时（${Math.round(timeoutMs / 60000)} 分钟）` };
    }
    await sleep(POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 视频落库：CAS + 资产记录 + 片段缓存版本（media 投影） */
async function landVideo(
  taskId: string,
  shot: WorkbenchShot,
  status: ComfyJobStatus,
  previewKey: string | undefined,
  params: Record<string, unknown>,
): Promise<{ output: NonNullable<TaskSegment["output"]>; previewKey?: string }> {
  const root = dataRoot();
  const task = await readTask(taskId, root);
  if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${taskId}`);
  const base = task.engine?.baseUrl ?? (await resolveComfyBase());
  const out = (status.outputs ?? []).find((o) => o.kind === "video") ?? status.outputs?.[0];
  if (!out?.path) throw new McpError("IO_ERROR", "插件没有返回视频路径");
  const buf = await downloadComfyOutput(base, out.path);
  if (!buf) throw new McpError("IO_ERROR", `下载视频失败: ${out.path}`);
  const filename = path.basename(out.path);
  const cas = await uploadToCas(root, {
    projectId: task.projectId,
    filename,
    dataBase64: buf.toString("base64"),
    mime: "video/mp4",
  });
  const guideLocalKey = await cacheGuideFile(base, status.guide);
  const rawGuide = status.guide;
  const guide = rawGuide?.id
    ? { ...rawGuide, id: rawGuide.id, ...(guideLocalKey ? { localKey: guideLocalKey } : {}) }
    : null;
  const prompt = promptOf(shot);
  const title = `片段 ${shot.number} · ${Math.round(Number(shot.duration) || 0)}s`;

  await appendAssetRecord(root, {
    id: `asset-${crypto.randomBytes(6).toString("hex")}`,
    title,
    kind: "video",
    tags: [],
    bytes: buf.length,
    mimeType: "video/mp4",
    createdAt: new Date().toISOString(),
    data: {
      kind: "video",
      storageKey: cas.storageKey,
      origin: "generation",
      originSource: "director",
      // 历史抽屉按 originNodeId 归到具体片段（版本数、按片段筛选都靠它）
      originNodeId: shot.id,
      ...(guide ? { guide } : {}),
      generation: {
        jobId: status.jobId ?? "",
        provider: "zeroexo",
        prompt,
        createdAt: new Date().toISOString(),
      },
    },
    cas: { hash: cas.hash, ext: path.extname(filename).replace(/^\./, "") || "mp4" },
    folderId: null,
    favorite: false,
    scope: "project",
    projectId: task.projectId,
  } as unknown as LibraryAsset);

  let version: WorkbenchShotVersion | null = null;
  await mutateShotWithRetry(root, task.projectId, shot.id, (s) => {
    version = appendVersion(s, {
      storageKey: cas.storageKey,
      previewKey,
      guide,
      prompt,
      params,
    });
  });
  const written = version as WorkbenchShotVersion | null;

  return {
    previewKey,
    output: {
      storageKey: cas.storageKey,
      mime: "video/mp4",
      ...(previewKey ? { previewKey } : {}),
      guide,
      ...(written ? {
        version: {
          id: written.id,
          storageKey: cas.storageKey,
          ...(previewKey ? { previewKey } : {}),
          guide,
          prompt,
          createdAt: written.createdAt,
        },
      } : {}),
    },
  };
}

/** 片段容器写：版本冲突自动重读重放 */
async function mutateShotWithRetry(
  root: string,
  projectId: string,
  shotId: string,
  fn: (shot: WorkbenchShot) => void,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wb = await readWorkbench(root, projectId);
    if (!wb) throw new McpError("NOT_FOUND", `导演台不存在: ${projectId}`);
    try {
      await mutateWorkbench(root, projectId, {
        baseVersion: wb.version,
        mutate: (w) => {
          const shot = (w.shots as WorkbenchShot[]).find((s) => s.id === shotId);
          if (!shot) throw new McpError("NOT_FOUND", `片段不存在: ${shotId}`);
          fn(shot);
        },
      });
      return;
    } catch (err) {
      if (err instanceof McpError && err.code === "VERSION_CONFLICT") continue;
      throw err;
    }
  }
  throw new McpError("VERSION_CONFLICT", `片段缓存连续写入冲突: ${shotId}`);
}

// ===== 图片 =====

interface ResolvedImage { width: number; height: number }

/** 图片任务：request 里给宽高优先，其次比例 + 百万像素；改图跟随输入图（插件要求输入输出同尺寸） */
async function resolveImageTarget(req: ImageTaskRequest, source: Buffer | null): Promise<ResolvedImage> {
  const model = req.model ?? "moss";
  const fromAspect = req.aspect
    ? (() => {
      const mp = Number(req.megapixels ?? 4);
      return model === "krea2"
        ? resolveMegapixelSize(req.aspect, mp, 32)
        : resolveMegapixelSize(req.aspect, mp, 16);
    })()
    : null;
  const explicit = req.width && req.height ? { width: req.width, height: req.height } : null;
  if (source) {
    // MCP 端没有像素重采样库：改图输出尺寸跟随输入图（否则 Qwen latent 尺寸对不上）
    return clampQwenSize(imageSize(source).width, imageSize(source).height);
  }
  if (explicit) {
    return model === "qwen" ? clampQwenSize(explicit.width, explicit.height) : explicit;
  }
  if (fromAspect) return fromAspect;
  return model === "qwen" ? { width: 1344, height: 1008 } : { width: 1024, height: 1024 };
}

async function runImages(taskId: string, base: string): Promise<void> {
  const root = dataRoot();
  const task = await readTask(taskId, root);
  if (!task || task.request.kind !== "canvas_image") throw new McpError("VALIDATION", "任务类型不符");
  const requests = task.request.requests;

  for (const [i, req] of requests.entries()) {
    const segIndex = i + 1;
    const fresh = await readTask(taskId, root);
    if (fresh?.cancelRequested) {
      await finishTask(taskId, "canceled");
      return;
    }
    const seg = fresh?.segments.find((s) => s.index === segIndex);
    if (seg?.state === "success") continue;

    const nodeId = req.nodeId ?? `mcp_${taskId}_${i}`;
    const sourceKey = req.sourceStorageKey ?? (req.sourceNodeId
      ? await resolveCanvasNodeStorageKey(task.projectId, req.sourceNodeId)
      : null);
    const source = sourceKey ? await readStorageBuffer(sourceKey) : null;
    const mask = req.maskStorageKey ? await readStorageBuffer(req.maskStorageKey) : null;

    await markSegment(taskId, segIndex, (s) => {
      s.state = "running";
      s.prompt = req.prompt;
      s.startedAt = new Date().toISOString();
      s.error = undefined;
    });

    let jobId = seg?.comfyJobId;
    if (!jobId) {
      try {
        const target = await resolveImageTarget(req, source);
        const model = source ? "qwen" : (req.model ?? "moss");
        let inputName = "";
        let maskName = "";
        if (source) {
          const ext = sourceKey ? path.extname(sourceKey).replace(/^\./, "") : "";
          inputName = (await uploadComfyImage(base, source, `zxb_${taskId}_${i}.${ext || "png"}`)) ?? "";
          if (!inputName) throw new McpError("IO_ERROR", "输入图上传 ComfyUI 失败");
        }
        if (mask) {
          maskName = (await uploadComfyImage(base, mask, `zxb_${taskId}_${i}_mask.png`)) ?? "";
        }
        const seed = resolveSeed(req.seed);
        const steps = req.steps && req.steps > 0
          ? req.steps
          : model === "qwen" ? 25 : model === "krea2" ? 10 : 25;
        const params: Record<string, unknown> = model === "qwen"
          ? {
            edit_prompt: source ? `参考图1：${req.prompt}` : req.prompt,
            negative_prompt: req.negative_prompt ?? "",
            input_image: inputName,
            mask_image: maskName,
            seed,
            steps,
            cfg: 1,
            denoise: 1,
            edit_mode: !inputName,
            use_llm_enhance: false,
            width: target.width,
            height: target.height,
          }
          : model === "krea2"
            ? {
              prompt: req.prompt,
              negative_prompt: req.negative_prompt ?? "",
              seed,
              steps,
              cfg: 1,
              eta: 0.55,
              width: target.width,
              height: target.height,
            }
            : {
              prompt: req.prompt,
              negative_prompt: req.negative_prompt ?? "",
              seed,
              steps,
              cfg: 2.5,
              width: target.width,
              height: target.height,
            };
        jobId = await submitComfyJob(
          base,
          model === "qwen" ? "qwen_image_edit" : model === "krea2" ? "krea2_t2i" : "moss_image_t2i",
          {
            clientJobId: `zxb_${taskId}_${i}`,
            clientId: task.engine?.clientId,
            project: task.projectId,
            episode: "image",
            params,
          },
        );
      } catch (err) {
        const reason = `第 ${segIndex} 张提交失败：${msg(err)}`;
        await markSegment(taskId, segIndex, (s) => {
          s.state = "failed";
          s.error = reason;
          s.finishedAt = new Date().toISOString();
        });
        await finishTask(taskId, "failed", reason);
        return;
      }
      await markSegment(taskId, segIndex, (s) => { s.comfyJobId = jobId; });
    }

    const terminal = await waitForJob(base, jobId, taskId, IMAGE_MAX_WAIT_MS);
    if (terminal.state === "cancelled") {
      await finishTask(taskId, "canceled");
      return;
    }
    if (terminal.state !== "success") {
      const reason = terminal.error || `第 ${segIndex} 张生成失败（${terminal.state ?? "unknown"}）`;
      await markSegment(taskId, segIndex, (s) => {
        s.state = "failed";
        s.error = reason;
        s.finishedAt = new Date().toISOString();
      });
      await finishTask(taskId, "failed", reason);
      return;
    }
    try {
      const saved = await landImage(taskId, segIndex, nodeId, req, terminal);
      await markSegment(taskId, segIndex, (s) => {
        s.state = "success";
        s.progress = undefined;
        s.output = saved.output;
        s.finishedAt = new Date().toISOString();
      });
      await updateTask(taskId, (t) => {
        if (!t.outputs.some((o) => o.storageKey === saved.output.storageKey)) t.outputs.push(saved.output);
      });
    } catch (err) {
      const reason = `第 ${segIndex} 张已生成但保存失败：${msg(err)}`;
      await markSegment(taskId, segIndex, (s) => {
        s.state = "failed";
        s.error = reason;
        s.finishedAt = new Date().toISOString();
      });
      await finishTask(taskId, "failed", reason);
      return;
    }
  }
  await finishTask(taskId, "success");
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

/** 简单时间戳：MM-DD HH:mm（资产命名用） */
function shortStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 有意义的资产名：取提示词首句，去掉 @引用 / <标签> / 技术词，截到 18 字。
 * 资产名不允许出现无意义编号（如 claimId 尾号）。
 */
function semanticImageName(prompt: string | undefined, fallback: string): string {
  const raw = (prompt ?? "").replace(/\r/g, "").replace(/<[^>]*>/g, " ");
  const first = raw.split(/\n|。|！|；|;/)[0] ?? "";
  const cleaned = first
    .replace(/@\S+(\s*·\s*\S+)?/g, " ")
    .replace(/[“”"'（）()【】\[\]]/g, " ")
    .replace(/无字幕|无水印|无文字|8K|4K|超清|高清|竖版|横版|16:9|9:16|1:1/g, " ")
    .replace(/[,，、:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 18 ? cleaned.slice(0, 18) : cleaned;
}

async function landImage(
  taskId: string,
  segIndex: number,
  nodeId: string,
  req: ImageTaskRequest,
  status: ComfyJobStatus,
): Promise<{ output: NonNullable<TaskSegment["output"]> }> {
  const root = dataRoot();
  const task = await readTask(taskId, root);
  if (!task) throw new McpError("NOT_FOUND", `任务不存在: ${taskId}`);
  const base = task.engine?.baseUrl ?? (await resolveComfyBase());
  const out = (status.outputs ?? []).find((o) => o.kind === "image") ?? status.outputs?.[0];
  if (!out?.path) throw new McpError("IO_ERROR", "插件没有返回图片路径");
  const buf = await downloadComfyOutput(base, out.path);
  if (!buf) throw new McpError("IO_ERROR", `下载图片失败: ${out.path}`);
  const ext = path.extname(out.path).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  const size = imageSize(buf);
  const cas = await uploadToCas(root, {
    projectId: task.projectId,
    filename: path.basename(out.path),
    dataBase64: buf.toString("base64"),
    mime,
  });
  const previewKey = task.segments.find((s) => s.index === segIndex)?.previewKey ?? task.previewKey;
  const model = req.model ?? "moss";
  await appendAssetRecord(root, {
    id: `asset-${crypto.randomBytes(6).toString("hex")}`,
    title: req.title?.trim() || `${semanticImageName(req.prompt, "MCP 图片")} · ${shortStamp()}`,
    kind: "image",
    tags: [],
    bytes: buf.length,
    mimeType: mime,
    createdAt: new Date().toISOString(),
    data: {
      kind: "image",
      storageKey: cas.storageKey,
      origin: "generation",
      originSource: "canvas",
      originNodeId: nodeId,
      width: size.width,
      height: size.height,
      prompt: req.prompt,
      generation: {
        jobId: status.jobId ?? "",
        provider: "zeroexo",
        model,
        prompt: req.prompt,
      },
    },
    cas: { hash: cas.hash, ext: path.extname(out.path).replace(/^\./, "") || "png" },
    folderId: null,
    favorite: false,
    scope: "project",
    projectId: task.projectId,
  } as unknown as LibraryAsset);
  return {
    output: {
      storageKey: cas.storageKey,
      mime,
      width: size.width,
      height: size.height,
      nodeId,
      ...(previewKey ? { previewKey } : {}),
    },
  };
}

function resolveSeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Math.floor(Math.random() * 0x7fffffff);
  return Math.trunc(n);
}

// ===== 存储键读取 =====

export async function readStorageBuffer(storageKey: string): Promise<Buffer | null> {
  if (!storageKey) return null;
  if (storageKey.startsWith("data:")) {
    const m = /^data:[^;,]+;base64,(.*)$/s.exec(storageKey);
    return m ? Buffer.from(m[1]!.replace(/\s+/g, ""), "base64") : null;
  }
  const m = /^(cas|image|video|audio):(.+)$/.exec(storageKey);
  if (!m) return null;
  const rel = m[1] === "cas" ? path.join("media", "cas", m[2]!) : m[2]!;
  return fs.readFile(path.join(dataRoot(), rel)).catch(() => null);
}

/** 改图传 sourceNodeId：从项目画布里找该节点的 storageKey */
export async function resolveCanvasNodeStorageKey(projectId: string, nodeId: string): Promise<string | null> {
  const root = dataRoot();
  const list = await listCanvases(root, projectId).catch(() => []);
  const ids = [list.find((c) => c.id === "main")?.id ?? "main", ...list.map((c) => c.id)];
  for (const canvasId of new Set(ids)) {
    const doc = await getCanvas(root, projectId, canvasId).catch(() => null);
    const nodes = (doc?.graph?.nodes ?? []) as Array<{ id: string; data?: Record<string, unknown> }>;
    const node = nodes.find((n) => n.id === nodeId);
    const key = node?.data?.["storageKey"];
    if (typeof key === "string" && key) return key;
    const content = node?.data?.["content"];
    if (typeof content === "string" && content.startsWith("data:")) return content;
  }
  return null;
}

// ===== 图片尺寸解析（无图像库：PNG/JPEG/WebP 头部） =====

export function imageSize(buf: Buffer): { width: number; height: number } {
  try {
    if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off += 1; continue; }
        const marker = buf[off + 1]!;
        const len = buf.readUInt16BE(off + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
        }
        off += 2 + len;
      }
    }
    if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8X") {
        const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
        const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
        return { width: w, height: h };
      }
      if (chunk === "VP8L" && buf.length >= 25) {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    // 解析失败按默认尺寸
  }
  return { width: 1024, height: 1024 };
}
