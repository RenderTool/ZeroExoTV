/**
 * 导演台实体。Schema 对齐 src/entities/slot-containers.ts:53-64（WorkbenchContainer）：
 * version, title:'导演台', tracks[](默认 track-main), shots[](片段), totalDuration,
 * sharedParams?, updatedAt。片段 id='seg-<ts>-<rand>'，duration 默认 5s，
 * status='pending', clipState='placeholder'。ensureWorkbenchContainer 幂等且自带片段 1。
 */

import crypto from "node:crypto";
import { McpError } from "../errors.js";
import { paths } from "../config.js";
import { readJsonIfExists, updateVersionedJson, type UpdateResult } from "./fs-node.js";
import {
  assignAssetSlots,
  DIRECTOR_PRESET_IDS,
  type DirectorAssetRef,
  type DirectorPresetId,
} from "./director-params.js";
import type { SegmentDraft } from "./script.js";

export interface WorkbenchShot {
  id: string;
  number: number;
  description: string;
  shotType?: string;
  duration: number;
  imagePrompt?: string;
  videoPrompt?: string;
  status: "pending" | "generating" | "done";
  clipState: "placeholder" | "ready";
  references: DirectorAssetRef[];
  paramValues?: Record<string, unknown>;
}

export interface SharedParams {
  enabled: boolean;
  assets: DirectorAssetRef[];
  presetId: DirectorPresetId;
  params?: Record<string, unknown>;
}

export interface WorkbenchContainer {
  schemaVersion: 1;
  version: number;
  updatedAt: string;
  title: string;
  tracks: { id: string; clips: { ref: { sourceShotId: string; kind: "shot" }; timeline: { startMs: number; durationMs: number } }[] }[];
  shots: WorkbenchShot[];
  totalDuration: number;
  sharedParams?: SharedParams;
}

function makeSegment(number: number, description: string, extra?: Partial<WorkbenchShot>): WorkbenchShot {
  return {
    id: `seg-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
    number,
    description,
    duration: 5,
    status: "pending",
    clipState: "placeholder",
    references: [],
    ...extra,
  };
}

function emptyWorkbench(): Omit<WorkbenchContainer, "version" | "updatedAt"> {
  const first = makeSegment(1, "片段 1");
  return {
    schemaVersion: 1,
    title: "导演台",
    tracks: [{ id: "track-main", clips: [] }],
    shots: [first],
    totalDuration: first.duration,
  };
}

/**
 * 公共提示词 → 每段提示词 一次性迁移（2026-11-05 公共提示词层下线，与 APP 端 slot-containers 同步）：
 * - sharedParams.prompt 为空/缺失 → 返回 false（无迁移）；
 * - 非空 → 并入每段 imagePrompt（已包含则不重复追加；空段直接置为公共提示词），随后删除该字段；
 * - 除各段 imagePrompt 与 sharedParams.prompt 外不改任何字段；幂等，只做一次。
 */
export function migrateSharedPromptInPlace(wb: WorkbenchContainer): boolean {
  // 历史字段已从 SharedParams 移除，这里以运行时形状读取（老数据 prompt 为 string）
  const shared = wb.sharedParams as { prompt?: string } | undefined;
  const raw = shared?.prompt;
  if (typeof raw !== "string" || raw.trim() === "") return false;
  const merged = raw.trim();
  for (const shot of wb.shots) {
    const cur = (shot.imagePrompt ?? "").trim();
    if (cur.includes(merged)) continue; // 已包含 → 不重复追加
    shot.imagePrompt = cur ? `${merged}\n\n${cur}` : merged;
  }
  delete (shared as { prompt?: string }).prompt;
  return true;
}

function logSharedPromptMigration(projectId: string, wb: WorkbenchContainer): void {
  // 迁移日志（一次性，不静默丢弃历史公共提示词内容）
  console.info(
    `[workbench-migration] project=${projectId} 公共提示词已并入 ${wb.shots.length} 段 imagePrompt，sharedParams.prompt 已清空`,
  );
}

export async function readWorkbench(root: string, projectId: string): Promise<WorkbenchContainer | null> {
  const p = paths.workbench(projectId, root);
  const wb = await readJsonIfExists<WorkbenchContainer>(p);
  if (!wb) return wb;
  // 历史公共提示词一次性迁移（读取即导入）：非空 → 并入每段并落盘（version+1）；
  // 落盘失败不影响读取（返回内存迁移结果），下次读取/写入自动重试
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

type WbOpts = { baseVersion: number; dryRun?: boolean };

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
      // 历史公共提示词一次性迁移：任何写入前先迁移，避免旧字段与新 schema 并存
      if (migrateSharedPromptInPlace(wb)) logSharedPromptMigration(projectId, wb);
      opts.mutate(wb);
      wb.totalDuration = wb.shots.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    },
  });
}

function findShot(wb: WorkbenchContainer, shotId: string): WorkbenchShot {
  const shot = wb.shots.find((s) => s.id === shotId);
  if (!shot) throw new McpError("NOT_FOUND", `导演台片段不存在: ${shotId}`, { shotId });
  return shot;
}

export function addSegments(
  root: string,
  projectId: string,
  opts: WbOpts & { drafts: SegmentDraft[] },
) {
  return updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const base = wb.shots.reduce((m, s) => Math.max(m, s.number), 0);
      opts.drafts.forEach((d, i) => {
        wb.shots.push(makeSegment(base + i + 1, d.description, { duration: d.duration }));
      });
    },
  });
}

export function addSegment(
  root: string,
  projectId: string,
  opts: WbOpts & { description: string; shotType?: string; duration?: number },
) {
  let created!: WorkbenchShot;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const n = wb.shots.reduce((m, s) => Math.max(m, s.number), 0) + 1;
      created = makeSegment(n, opts.description, { shotType: opts.shotType, duration: opts.duration ?? 5 });
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
      const cur: SharedParams =
        wb.sharedParams ?? { enabled: true, assets: [], presetId: "h3" };
      wb.sharedParams = {
        ...cur,
        ...(opts.patch.presetId ? { presetId: opts.patch.presetId } : {}),
        ...(opts.patch.params ? { params: { ...(cur.params ?? {}), ...opts.patch.params } } : {}),
      };
    },
  });
}

/** attach_asset_to_slot：走 assignAssetSlots 语义（公共占 1..K、片段 K+1 续排、超限 SLOT_OVERFLOW）。 */
export function attachAssetToSlot(
  root: string,
  projectId: string,
  opts: WbOpts & { storageKey: string; name?: string; shotId?: string },
) {
  let ref!: DirectorAssetRef;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const sharedCount = wb.sharedParams?.assets.length ?? 0;
      if (opts.shotId) {
        const shot = findShot(wb, opts.shotId);
        ref = assignAssetSlots(
          [...(wb.sharedParams?.assets ?? []), ...shot.references],
          { storageKey: opts.storageKey, name: opts.name, source: "segment" },
          sharedCount,
        );
        shot.references.push(ref);
      } else {
        const cur: SharedParams = wb.sharedParams ?? { enabled: true, assets: [], presetId: "h3" };
        ref = assignAssetSlots(cur.assets, { storageKey: opts.storageKey, name: opts.name, source: "shared" }, sharedCount);
        cur.assets.push(ref);
        wb.sharedParams = cur;
      }
    },
  });
  return promise.then((r) => ({ ...r, ref }));
}

/** link_subject_to_shot：把主体以 DirectorAssetRef(source=segment, subjectId) 形式挂到片段 references[]。 */
export function linkSubjectToShot(
  root: string,
  projectId: string,
  opts: WbOpts & { shotId: string; subjectId: string; subjectName?: string },
) {
  let ref!: DirectorAssetRef;
  const promise = updateWorkbench(root, projectId, {
    ...opts,
    mutate: (wb) => {
      const shot = findShot(wb, opts.shotId);
      const sharedCount = wb.sharedParams?.assets.length ?? 0;
      ref = assignAssetSlots(
        [...(wb.sharedParams?.assets ?? []), ...shot.references],
        {
          storageKey: `subject:${opts.subjectId}`,
          name: opts.subjectName,
          source: "segment",
          subjectId: opts.subjectId,
        },
        sharedCount,
      );
      shot.references.push(ref);
    },
  });
  return promise.then((r) => ({ ...r, ref }));
}
