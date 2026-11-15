/**
 * 片段缓存（shot.cache）：版本历史 + 当前选中版本 + media 投影。
 *
 * 规则（Plan 2026-11-15）：
 * - 每次生成成功追加一个版本，并设为当前选中版本；`shot.media` 只是选中版本的投影，兼容旧的播放/导出。
 * - 重生成第 N 段时，guide 固定取「时间线上一段当前选中版本」的 guide；上一段没有缓存/没有 guide 时
 *   明确本段无引导输入（source='none'），绝不回退插件 LAST_GUIDE 去拿别的场景尾帧。
 * - 本段显式引导槽（shot.guide）优先于上一段缓存。
 * - 存量数据（只有 media、没有 cache）视为一个 legacy 版本，首次追加时并入 versions。
 */

import crypto from "node:crypto";
import type {
  WorkbenchShot,
  WorkbenchShotCache,
  WorkbenchShotVersion,
} from "../store/workbench.js";

export interface ResolvedGuide {
  id: string;
  frames?: number;
  sha256?: string;
  localKey?: string;
  source: "cache" | "slot" | "none";
  sourceShotId?: string;
}

export function legacyVersion(shot: WorkbenchShot): WorkbenchShotVersion | null {
  const key = shot.media?.storageKey;
  if (!key) return null;
  return {
    id: `ver-legacy-${shot.id}`,
    storageKey: key,
    previewKey: shot.firstFrameKey,
    guide: shot.media?.guide ?? null,
    prompt: shot.imagePrompt ?? "",
    createdAt: String(shot.media?.createdAt ?? new Date(0).toISOString()),
    status: "done",
  };
}

export function shotVersions(shot: WorkbenchShot): WorkbenchShotVersion[] {
  const versions = shot.cache?.versions;
  if (Array.isArray(versions) && versions.length > 0) return versions;
  const legacy = legacyVersion(shot);
  return legacy ? [legacy] : [];
}

export function selectedVersion(shot: WorkbenchShot): WorkbenchShotVersion | null {
  const versions = shotVersions(shot);
  if (versions.length === 0) return null;
  const id = shot.cache?.selectedVersionId;
  // 片段 = 版本集合：默认启用最新版本（封面），只有显式选中的旧版本才覆盖
  return versions.find((v) => v.id === id) ?? versions[versions.length - 1] ?? null;
}

/**
 * 解析某段要吃的引导。
 * @param shots 时间线全序（按集分组后的顺序也要传入完整集内顺序）
 */
export function resolveGuide(shots: WorkbenchShot[], shotIndex: number): ResolvedGuide {
  const shot = shots[shotIndex];
  if (!shot) return { id: "", source: "none" };
  const slot = shot.guide;
  if (slot?.id) {
    return {
      id: slot.id,
      frames: slot.frames,
      sha256: slot.sha256,
      source: "slot",
    };
  }
  const prev = shotIndex > 0 ? shots[shotIndex - 1] : null;
  const prevVersion = prev ? selectedVersion(prev) : null;
  const guide = prevVersion?.guide;
  if (prev && guide?.id) {
    return {
      id: guide.id,
      frames: guide.frames,
      sha256: guide.sha256,
      localKey: guide.localKey,
      source: "cache",
      sourceShotId: prev.id,
    };
  }
  return { id: "", source: "none", ...(prev ? { sourceShotId: prev.id } : {}) };
}

function ensureCache(shot: WorkbenchShot): WorkbenchShotCache {
  if (shot.cache && Array.isArray(shot.cache.versions)) return shot.cache;
  const legacy = legacyVersion(shot);
  const cache: WorkbenchShotCache = {
    selectedVersionId: legacy?.id ?? "",
    versions: legacy ? [legacy] : [],
  };
  shot.cache = cache;
  return cache;
}

/** 把某版本投影为 shot.media（播放/导出/历史缩略都只认这份投影） */
export function projectVersion(shot: WorkbenchShot, versionId: string): WorkbenchShotVersion | null {
  const cache = ensureCache(shot);
  const version = cache.versions.find((v) => v.id === versionId);
  if (!version) return null;
  cache.selectedVersionId = version.id;
  shot.media = {
    ...(shot.media ?? {}),
    storageKey: version.storageKey,
    guide: version.guide ?? undefined,
    source: "generated",
    prompt: version.prompt,
    createdAt: version.createdAt,
  } as WorkbenchShot["media"];
  shot.firstFrameKey = version.previewKey;
  shot.status = "done";
  shot.clipState = "completed";
  return version;
}

export interface AppendVersionInput {
  storageKey: string;
  previewKey?: string;
  guide?: WorkbenchShotVersion["guide"];
  prompt?: string;
  params?: Record<string, unknown>;
  sourceVersionId?: string;
}

/** 生成成功：追加版本 + 设为当前缓存 + 投影 media */
export function appendVersion(shot: WorkbenchShot, input: AppendVersionInput): WorkbenchShotVersion {
  const cache = ensureCache(shot);
  const version: WorkbenchShotVersion = {
    id: `ver_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    storageKey: input.storageKey,
    previewKey: input.previewKey,
    guide: input.guide ?? null,
    prompt: input.prompt ?? shot.imagePrompt ?? "",
    params: input.params,
    sourceVersionId: input.sourceVersionId,
    createdAt: new Date().toISOString(),
    status: "done",
  };
  cache.versions.push(version);
  projectVersion(shot, version.id);
  return version;
}

/** 删除某版本：删的若是当前选中版本，切到最新一个还在的版本（没有则清空投影） */
export function removeVersion(shot: WorkbenchShot, versionId: string): boolean {
  const cache = ensureCache(shot);
  const before = cache.versions.length;
  cache.versions = cache.versions.filter((v) => v.id !== versionId);
  if (cache.versions.length === before) return false;
  if (cache.selectedVersionId === versionId) {
    const next = cache.versions[cache.versions.length - 1];
    if (next) {
      projectVersion(shot, next.id);
    } else {
      cache.selectedVersionId = "";
      shot.media = undefined;
      shot.firstFrameKey = undefined;
      shot.status = "pending";
      shot.clipState = "placeholder";
    }
  }
  return true;
}
