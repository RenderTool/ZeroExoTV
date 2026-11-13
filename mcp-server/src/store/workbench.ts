/**
 * 导演台实体。Schema 对齐 src/entities/slot-containers.ts（WorkbenchContainer）与
 * src/features/.../workbench-types.ts（WorkbenchShot / WorkbenchShotReference）：
 *   { schemaVersion, version, title:'导演台', tracks[], shots[], totalDuration, sharedParams?, updatedAt }
 *
 * 关键契约（2026-11-07 依前端真实数据校准）：
 * - 片段必须有 shotType / imagePrompt / videoPrompt / references / paramValues 字段，
 *   缺字段前端会当脏数据渲染成空；
 * - references 是 WorkbenchShotReference：{id,kind,title,storageKey:'cas:<hash>.<ext>',url,originScope,slotNo}，
 *   不是 {slot,storageKey:'subject:<id>',name,source}（那种形状前端认不出，片段上看不到素材）；
 * - tracks 必须有 track-main 的 clips（ref.sourceShotId + timeline.startMs/durationMs），
 *   时间轴/箭头按它排，不按 shots 数组顺序；
 * - sharedParams.params 用 director-params.DIRECTOR_PARAM_SCHEMA 的键（aspect / scaleFactor / steps …），
 *   自造键（width/frames/guide_frames）前端参数面板读不到。
 */

import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { paths } from "../config.js";
import { readJsonIfExists, updateVersionedJson, type UpdateResult } from "./fs-node.js";
import { DIRECTOR_PRESET_IDS, DIRECTOR_SHARED_DEFAULTS, type DirectorPresetId } from "./director-params.js";
import type { SegmentDraft } from "./script.js";

export interface WorkbenchShot {
  id: string;
  number: number;
  description: string;
  shotType: string;
  duration: number;
  /** 2026-11-13 导演台按集切换：片段所属集 id；缺省 = 未分集 */
  episodeId?: string;
  imagePrompt: string;
  videoPrompt: string;
  status: "pending" | "generating" | "done" | "failed" | "cancelled" | "interrupted";
  clipState: "placeholder" | "completed";
  references: WorkbenchShotReference[];
  paramValues: Record<string, unknown>;
  continuation?: { enabled: boolean };
  /** 2026-11-09：与前端 workbench-types.ts 对齐，MCP 侧新增可读写字段（旧数据缺省兼容） */
  guide?: { id: string; title?: string; frames?: number; sha256?: string; fromAssetId?: string; createdAt?: string } | null;
  media?: { storageKey?: string; guide?: { id?: string; path?: string; frames?: number; sha256?: string; localKey?: string } | null; [k: string]: unknown } | null;
  negativePrompt?: string;
}

/** 片段参考素材：与前端 workbench-types.ts 的 WorkbenchShotReference 同形 */
export interface WorkbenchShotReference {
  id: string;
  kind: "image" | "video" | "audio" | "text";
  title?: string;
  storageKey?: string;
  url?: string;
  originScope?: "library" | "project";
  slotNo?: number;
  origin?: {
    kind: "subject-base" | "subject-state" | "color-card" | "user-upload";
    rootId?: string;
    state?: string;
    mediaKey?: string;
  };
}

/** 导演台公共素材（与前端 director-params.ts 的 DirectorAssetRef 同形） */
export interface DirectorAssetRef {
  id: string;
  kind: "image" | "audio" | "video";
  title?: string;
  storageKey?: string;
  url?: string;
  originScope?: "library" | "project";
  slotNo?: number;
}

export interface SharedParams {
  enabled: boolean;
  assets: DirectorAssetRef[];
  presetId: DirectorPresetId;
  params?: Record<string, unknown>;
}

export interface WorkbenchTrack {
  id: string;
  name: string;
  sourceChain: { origin: string; label?: string };
  status: "active" | "candidate" | "discarded";
  order: number;
  clips: Array<{
    ref: { sourceShotId: string; kind: "shot" | "media"; sourceKey?: string };
    timeline: { startMs: number; durationMs: number };
  }>;
}

export interface WorkbenchContainer {
  schemaVersion: 1;
  version: number;
  updatedAt: string;
  title: string;
  tracks: WorkbenchTrack[];
  shots: WorkbenchShot[];
  totalDuration: number;
  sharedParams?: SharedParams;
}

function makeSegment(number: number, description: string, extra?: Partial<WorkbenchShot>): WorkbenchShot {
  return {
    id: `seg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
    number,
    description,
    shotType: "",
    duration: 5,
    imagePrompt: "",
    videoPrompt: "",
    status: "pending",
    clipState: "placeholder",
    references: [],
    paramValues: {},
    ...extra,
  };
}

/** 主轨按 shots 顺序重排（时间轴是前端排片与段间箭头的依据） */
function rebuildMainTrack(wb: WorkbenchContainer): void {
  let startMs = 0;
  const clips = wb.shots.map((s) => {
    const durationMs = Math.round((Number(s.duration) || 0) * 1000);
    const clip = {
      ref: { sourceShotId: s.id, kind: "shot" as const },
      timeline: { startMs, durationMs },
    };
    startMs += durationMs;
    return clip;
  });
  const main = wb.tracks.find((t) => t.id === "track-main");
  if (main) {
    main.clips = clips;
    return;
  }
  wb.tracks = [
    {
      id: "track-main",
      name: "主轨",
      sourceChain: { origin: "workbench-container" },
      status: "active",
      order: 0,
      clips,
    },
  ];
}

function emptyWorkbench(): Omit<WorkbenchContainer, "version" | "updatedAt"> {
  const first = makeSegment(1, "");
  return {
    schemaVersion: 1,
    title: "导演台",
    tracks: [
      {
        id: "track-main",
        name: "主轨",
        sourceChain: { origin: "workbench-container" },
        status: "active",
        order: 0,
        clips: [{ ref: { sourceShotId: first.id, kind: "shot" }, timeline: { startMs: 0, durationMs: first.duration * 1000 } }],
      },
    ],
    shots: [first],
    totalDuration: first.duration,
  };
}

/** 唯一拼路径处 */
export function workbenchPath(projectId: string, root?: string): string {
  return paths.workbench(projectId, root);
}

/**
 * 历史公共提示词 → 每段提示词 一次性迁移（2026-11-05 公共提示词层下线，与前端 slot-containers 同步）：
 * - sharedParams.prompt 为空/缺失 → 返回 false（无迁移）；
 * - 非空 → 并入每段 imagePrompt（已包含则不重复追加；空段直接置为公共提示词），随后删除该字段。
 */
export function migrateSharedPromptInPlace(wb: WorkbenchContainer): boolean {
  const shared = wb.sharedParams as { prompt?: string } | undefined;
  const raw = shared?.prompt;
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const merged = raw.trim();
  for (const shot of wb.shots) {
    const cur = (shot.imagePrompt ?? "").trim();
    if (cur.includes(merged)) continue;
    shot.imagePrompt = cur ? `${merged}\n\n${cur}` : merged;
  }
  delete (shared as { prompt?: string }).prompt;
  return true;
}

function logSharedPromptMigration(projectId: string, wb: WorkbenchContainer): void {
  console.info(
    `[workbench-migration] project=${projectId} 公共提示词已并入 ${wb.shots.length} 段 imagePrompt，sharedParams.prompt 已清空`,
  );
}

export async function readWorkbench(root: string, projectId: string): Promise<WorkbenchContainer | null> {
  const p = paths.workbench(projectId, root);
  const wb = await readJsonIfExists<WorkbenchContainer>(p);
  if (!wb) return wb;
  if (!migrateSharedPromptInPlace(wb)) return wb;
  try {
    const res = await updateVersionedJson<WorkbenchContainer>(p, {
      baseVersion: wb.version,
      mutate: (w) => {
        migrateSharedPromptInPlace(w);
      },
    });
    logSharedPromptMigration(projectId, res.after);
    return res.after;
  } catch (err) {
    console.warn(
      `[workbench-migration] project=${projectId} 迁移落盘失败（下次自动重试）:`,
      err instanceof Error ? err.message : err,
    );
    return wb;
  }
}

export type WbOpts = { baseVersion: number; dryRun?: boolean };

/** 片段编号按集重置：每集从 1 开始，禁止全剧连续编号 */
function renumberShotsPerEpisode(wb: WorkbenchContainer): void {
  const counters = new Map<string, number>();
  for (const shot of wb.shots) {
    const key = shot.episodeId || "__no_episode__";
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    shot.number = next;
  }
}

async function updateWorkbench(
  root: string,
  projectId: string,
  opts: WbOpts & { mutate: (wb: WorkbenchContainer) => void },
): Promise<UpdateResult<WorkbenchContainer>> {
  return updateVersionedJson<WorkbenchContainer>(paths.workbench(projectId, root), {
    baseVersion: opts.baseVersion,
    createIfMissing: () => emptyWorkbench(),
    dryRun: opts.dryRun,
    mutate: (wb) => {
      if (!Array.isArray(wb.tracks)) wb.tracks = [];
      if (migrateSharedPromptInPlace(wb)) logSharedPromptMigration(projectId, wb);
      opts.mutate(wb);
      renumberShotsPerEpisode(wb);
      rebuildMainTrack(wb);
      wb.totalDuration = wb.shots.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    },
  });
}

/**
 * 2026-11-09：给新增 MCP 工具复用的通用写入口。
 * 复用完整 mutate（含公共提示词迁移、rebuildMainTrack、totalDuration），
 * 避免新工具另造一条写路径导致轨道与片段时长不同步。
 */
export function mutateWorkbench(
  root: string,
  projectId: string,
  opts: WbOpts & { mutate: (wb: WorkbenchContainer) => void },
): Promise<UpdateResult<WorkbenchContainer>> {
  return updateWorkbench(root, projectId, opts);
}

function findShot(wb: WorkbenchContainer, shotId: string): WorkbenchShot {
  const shot = wb.shots.find((s) => s.id === shotId);
  if (!shot) throw new McpError("NOT_FOUND", `导演台片段不存在: ${shotId}`, { shotId });
  return shot;
}

/** 下一个片段素材槽号（同类引用内续排） */
function nextSlotNo(refs: WorkbenchShotReference[], kind: WorkbenchShotReference["kind"]): number {
  const used = refs.filter((r) => r.kind === kind).map((r) => r.slotNo ?? 0);
  return Math.max(0, ...used) + 1;
}

export function addSegments(
  root: string,
  projectId: string,
  opts: WbOpts & { drafts: SegmentDraft[]; episodeId?: string },
) {
  return updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const sameEpisode = opts.episodeId
        ? wb.shots.filter((s) => s.episodeId === opts.episodeId)
        : wb.shots.filter((s) => !s.episodeId);
      const base = sameEpisode.reduce((m, s) => Math.max(m, s.number), 0);
      opts.drafts.forEach((d, i) => {
        wb.shots.push(makeSegment(base + i + 1, d.description, {
          duration: d.duration,
          ...(opts.episodeId ? { episodeId: opts.episodeId } : {}),
        }));
      });
    },
  });
}

export function addSegment(
  root: string,
  projectId: string,
  opts: WbOpts & { description: string; shotType?: string; duration?: number; episodeId?: string },
) {
  let created!: WorkbenchShot;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const sameEpisode = opts.episodeId
        ? wb.shots.filter((s) => s.episodeId === opts.episodeId)
        : wb.shots.filter((s) => !s.episodeId);
      const n = sameEpisode.reduce((m, s) => Math.max(m, s.number), 0) + 1;
      created = makeSegment(n, opts.description, {
        shotType: opts.shotType ?? "",
        duration: opts.duration ?? 5,
        ...(opts.episodeId ? { episodeId: opts.episodeId } : {}),
      });
      wb.shots.push(created);
    },
  });
  return promise.then((r) => ({ ...r, segment: created }));
}

export function setShotPrompt(
  root: string,
  projectId: string,
  opts: WbOpts & {
    shotId: string;
    imagePrompt?: string;
    videoPrompt?: string;
    description?: string;
    shotType?: string;
    duration?: number;
    negativePrompt?: string;
    paramValues?: Record<string, unknown>;
  },
) {
  return updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const shot = findShot(wb, opts.shotId);
      if (opts.imagePrompt !== undefined) shot.imagePrompt = opts.imagePrompt;
      if (opts.videoPrompt !== undefined) shot.videoPrompt = opts.videoPrompt;
      if (opts.description !== undefined) shot.description = opts.description;
      if (opts.shotType !== undefined) shot.shotType = opts.shotType;
      if (opts.duration !== undefined) shot.duration = opts.duration;
      if (opts.negativePrompt !== undefined) {
        shot.paramValues = { ...(shot.paramValues ?? {}), negativePrompt: opts.negativePrompt };
      }
      if (opts.paramValues) shot.paramValues = { ...(shot.paramValues ?? {}), ...opts.paramValues };
    },
  });
}

export function setSharedParams(
  root: string,
  projectId: string,
  opts: WbOpts & { patch: { presetId?: DirectorPresetId; params?: Record<string, unknown> } },
) {
  if (opts.patch.presetId && !DIRECTOR_PRESET_IDS.includes(opts.patch.presetId)) {
    throw new McpError("VALIDATION", `非法 presetId: ${opts.patch.presetId}，可选 ${DIRECTOR_PRESET_IDS.join("/")}`);
  }
  return updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const cur: SharedParams = wb.sharedParams ?? {
        enabled: true,
        assets: [],
        presetId: "h3",
        params: { ...DIRECTOR_SHARED_DEFAULTS },
      };
      wb.sharedParams = {
        ...cur,
        ...(opts.patch.presetId ? { presetId: opts.patch.presetId } : {}),
        params: {
          ...DIRECTOR_SHARED_DEFAULTS,
          ...(cur.params ?? {}),
          ...(opts.patch.params ?? {}),
        },
      };
    },
  });
}

/**
 * attach_asset_to_slot：给 shotId → 片段槽（续排）；不给 → 公共槽。
 * 参考素材按前端 WorkbenchShotReference / DirectorAssetRef 形状写。
 */
export function attachAssetToSlot(
  root: string,
  projectId: string,
  opts: WbOpts & {
    storageKey: string;
    title?: string;
    kind?: "image" | "video" | "audio";
    shotId?: string;
  },
) {
  const kind = opts.kind ?? "image";
  let ref!: WorkbenchShotReference;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      if (opts.shotId) {
        const shot = findShot(wb, opts.shotId);
        ref = {
          id: `ref-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          kind,
          title: opts.title ?? opts.storageKey,
          storageKey: opts.storageKey,
          url: "",
          originScope: "project",
          slotNo: nextSlotNo(shot.references, kind),
        };
        shot.references.push(ref);
        return;
      }
      const cur: SharedParams = wb.sharedParams ?? { enabled: true, assets: [], presetId: "h3" };
      const slotNo = Math.max(0, ...cur.assets.filter((a) => a.kind === kind).map((a) => a.slotNo ?? 0)) + 1;
      cur.assets.push({
        id: `ref-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        kind,
        title: opts.title ?? opts.storageKey,
        storageKey: opts.storageKey,
        url: "",
        originScope: "project",
        slotNo,
      });
      wb.sharedParams = cur;
    },
  });
  return promise.then((r) => ({ ...r, ref }));
}

/** 主体状态图 → 片段参考素材（优先指定 state，其次 coverKey，最后第一张） */
export interface SubjectForRef {
  id: string;
  name: string;
  images: Array<{ storageKey: string; stateTag?: string }>;
  coverKey?: string | null;
}

/**
 * link_subject_to_shot：把主体挂到片段 references[]（前端按 storageKey 渲染缩略图）。
 * id 用 subject-state:<主体id>/<状态>，与前端引用指纹一致，便于失效检测。
 */
export function linkSubjectToShot(
  root: string,
  projectId: string,
  opts: WbOpts & { shotId: string; subject: SubjectForRef; subjectName?: string; state?: string },
) {
  let ref!: WorkbenchShotReference;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const shot = findShot(wb, opts.shotId);
      const subject = opts.subject;
      const image =
        (opts.state ? subject.images.find((i) => i.stateTag === opts.state) : undefined) ??
        subject.images.find((i) => i.storageKey === subject.coverKey) ??
        subject.images.find((i) => i.stateTag && i.storageKey) ??
        subject.images[0];
      if (!image?.storageKey) {
        throw new McpError("VALIDATION", `主体「${subject.name}」还没有状态图，先 set_subject_image 再关联`);
      }
      const slotNo = nextSlotNo(shot.references, "image");
      if (slotNo > 9) {
        throw new McpError("SLOT_OVERFLOW", `片段素材超出上限：第 ${slotNo} 张，上限 9 张`);
      }
      ref = {
        id: `subject-state:${subject.id}/${opts.state ?? "__base__"}`,
        kind: "image",
        title: opts.state ? `${subject.name}-${opts.state}` : subject.name,
        storageKey: image.storageKey,
        url: "",
        originScope: "project",
        slotNo,
        origin: {
          kind: opts.state ? "subject-state" : "subject-base",
          rootId: subject.id,
          state: opts.state,
          mediaKey: image.storageKey,
        },
      };
      shot.references.push(ref);
    },
  });
  return promise.then((r) => ({ ...r, ref }));
}
