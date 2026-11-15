/**
 * 片段缓存（前端视角）：版本历史、当前选中版本与 `media` 投影。
 *
 * 唯一事实源在导演台容器（projects/<id>/entities/workbench.json），MCP 生成成功后写版本；
 * 网页只读/合并/切换版本，不自己生成。存量只有 media 的片段视为一个 legacy 版本。
 */
import type {
  WorkbenchShot,
  WorkbenchShotCache,
  WorkbenchShotVersion,
} from '@/features/canvas-nodes/storyboard/workbench-types.js';

export function legacyShotVersion(shot: WorkbenchShot): WorkbenchShotVersion | null {
  const key = shot.media?.storageKey;
  if (!key) return null;
  return {
    id: `ver-legacy-${shot.id}`,
    storageKey: key,
    previewKey: shot.firstFrameKey,
    guide: shot.media?.guide ?? null,
    prompt: shot.media?.prompt ?? shot.imagePrompt ?? '',
    createdAt: shot.media?.createdAt ?? new Date(0).toISOString(),
    status: 'done',
  };
}

export function shotVersions(shot: WorkbenchShot): WorkbenchShotVersion[] {
  const versions = shot.cache?.versions;
  if (Array.isArray(versions) && versions.length > 0) return versions;
  const legacy = legacyShotVersion(shot);
  return legacy ? [legacy] : [];
}

export function selectedShotVersion(shot: WorkbenchShot): WorkbenchShotVersion | null {
  const versions = shotVersions(shot);
  if (versions.length === 0) return null;
  const id = shot.cache?.selectedVersionId;
  return versions.find((v) => v.id === id) ?? versions[versions.length - 1] ?? null;
}

function projectVersion(shot: WorkbenchShot, version: WorkbenchShotVersion): Partial<WorkbenchShot> {
  return {
    media: {
      ...(shot.media ?? {}),
      storageKey: version.storageKey,
      guide: version.guide ?? undefined,
      source: 'generated',
      prompt: version.prompt,
      createdAt: version.createdAt,
    },
    firstFrameKey: version.previewKey,
    status: 'done',
    clipState: 'completed',
  };
}

/** 合并一个由 MCP 落库的版本（幂等：同 id 只留最新一份）并设为当前缓存 */
export function mergeShotVersion(
  shot: WorkbenchShot,
  version: WorkbenchShotVersion,
): Partial<WorkbenchShot> {
  const existing = shot.cache?.versions ?? shotVersions(shot);
  const versions = [...existing.filter((v) => v.id !== version.id), version];
  const cache: WorkbenchShotCache = { selectedVersionId: version.id, versions };
  return { cache, ...projectVersion(shot, version) };
}

/** 切换当前缓存版本：media / 缩略 / 状态全部跟着投影 */
export function selectShotVersion(shot: WorkbenchShot, versionId: string): Partial<WorkbenchShot> | null {
  const versions = shotVersions(shot);
  const version = versions.find((v) => v.id === versionId);
  if (!version) return null;
  return {
    cache: { selectedVersionId: version.id, versions },
    ...projectVersion(shot, version),
  };
}

/** 删除版本：删的是当前选中版本时切到最新一个仍在的版本；全删光则回到占位态 */
export function deleteShotVersion(shot: WorkbenchShot, versionId: string): Partial<WorkbenchShot> | null {
  const versions = shotVersions(shot);
  const remaining = versions.filter((v) => v.id !== versionId);
  if (remaining.length === versions.length) return null;
  const selectedId = shot.cache?.selectedVersionId;
  if (selectedId !== versionId && versions.some((v) => v.id === selectedId)) {
    return { cache: { selectedVersionId: selectedId!, versions: remaining } };
  }
  const next = remaining[remaining.length - 1];
  if (next) {
    return {
      cache: { selectedVersionId: next.id, versions: remaining },
      ...projectVersion(shot, next),
    };
  }
  return {
    cache: { selectedVersionId: '', versions: [] },
    media: undefined,
    firstFrameKey: undefined,
    status: 'pending',
    clipState: 'placeholder',
  };
}
