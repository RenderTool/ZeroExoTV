/**
 * workbench-sync - 分镜→出片 导入制多轨同步（纯函数层，可单测）
 *
 * Plan#74 Phase E：把出片工作台从「resync 快照合并单轨」改为「导入制多轨方案轨」。
 * - 分镜连入 → 新建 active 轨（来源链 origin = 分镜节点 id）
 * - 同分镜断开重连 → 验差异（shots 内容指纹 + 引用失效 detectStaleRefs）→ 有差异建 candidate 轨，不替换原方案
 * - 数据模型见 workbench-types.ts（WorkbenchTrack / WorkbenchClipRef）
 *
 * 本模块同时承载 E3 的纯函数：
 * - resolveShotsForTrack：轨道 clip 实例 → 片段序列（分层过渡期：池优先 + clip.instanceData 兜底）
 * - resolveSuperimpose：上优先 + 空档回填 播放调度
 */

import type {
  WorkbenchNodeData,
  WorkbenchShot,
  WorkbenchShotReference,
  WorkbenchTrack,
  WorkbenchClipRef,
  WorkbenchStatus,
} from './workbench-types';
import { migrateSubjectTrees, type SubjectTree } from './subject-tree-types';
import { resolveShotMentions, buildRefsFromSource, buildPromptPreview } from './workbench-ref-builder';
import { detectStaleRefs } from './storyboard-utils';

/** 上游主体字典并集：entities ∪ aiSubjects ∪ productionItems（同名去重，前者优先）。
 * 从 creation-node-view.tsx 迁移，原逻辑与注释保留（BuildMerged 幂等合并的依赖）。 */
export function collectBaseEntities(sourceData: Record<string, unknown>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  const push = (name?: string, id?: string, aliases?: string[], images?: Array<Record<string, any>>) => {
    const n = (name ?? '').trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({
      id,
      name: n,
      aliases: aliases ?? [],
      referenceImages: (images ?? [])
        .map((i) => ({ storageKey: String(i?.storageKey ?? '') || undefined }))
        .filter((i) => !!i.storageKey),
    });
  };
  const ents = (sourceData.entities ?? []) as Array<Record<string, any>>;
  const ais = (sourceData.aiSubjects ?? []) as Array<Record<string, any>>;
  const items = (sourceData.productionItems ?? []) as Array<Record<string, any>>;
  for (const e of ents) push(String(e?.name ?? ''), String(e?.id ?? ''), e?.aliases as string[] | undefined, e?.referenceImages as Array<Record<string, any>> | undefined);
  // aiSubjects 无稳定 id（纯名字字典）→ 合成稳定键 ai:<name>，保证 resync 指纹可复用
  for (const a of ais) push(String(a?.name ?? ''), `ai:${String(a?.name ?? '')}`, a?.aliases as string[] | undefined, undefined);
  for (const p of items) push(String(p?.name ?? ''), String(p?.id ?? ''), p?.aliases as string[] | undefined, p?.images as Array<Record<string, any>> | undefined);
  return out;
}

/**
 * 出片节点重连分镜的合并策略（2026-08-31 初版；2026-09-03 Plan#71 T6 增强）：
 * 不再全量覆盖本地 shots，而是按 sourceShotId 合并——
 * - 本地已删除的上游镜头（deletedSourceShotIds）不复活
 * - 上游仍存在的镜头：本地产物已生成（clipState=completed）或用户已编辑 → 保留不动（幂等）；空占位 → 同步内容 + 回填 references + 预填提示词
 * - 上游新增镜头：追加占位 clip；本地补拍/拖入的无源镜头：保留在末尾
 * 原实现自 creation-node-view.tsx 迁出，未改逻辑。
 */
export function buildMergedWorkbenchShots(
  sourceShots: Array<Record<string, any>>,
  current: WorkbenchNodeData,
  sourceRefCtx?: { subjectTrees?: SubjectTree[]; baseEntities?: Array<Record<string, any>> },
): WorkbenchShot[] {
  const deleted = new Set(current.deletedSourceShotIds ?? []);
  const localBySource = new Map<string, WorkbenchShot>();
  for (const s of current.shots) {
    if (s.sourceShotId) localBySource.set(s.sourceShotId, s);
  }

  /** 引用指纹 key（T6：自动回填按指纹复用旧 id，避免每次 resync 全量换 id 造成 Yjs 抖动） */
  const refFingerprint = (r: { id: string; origin?: { kind?: string; rootId?: string; nodeId?: string; mediaKey?: string } | null }): string => {
    const o = r.origin;
    if (!o || o.kind === 'user-upload') return `user:${r.id}`;
    return `subj:${o.kind}:${o.rootId ?? ''}:${o.nodeId ?? ''}:${o.mediaKey ?? ''}`;
  };

  /** 指纹级合并 references：旧 refs 中 user-upload/无 origin（用户素材）恒保留；subject 来源按指纹保留旧 id，补齐新缺失 */
  const mergeRefs = (
    prev: WorkbenchShotReference[] | undefined,
    fresh: WorkbenchShotReference[] | undefined,
  ): WorkbenchShotReference[] | undefined => {
    const oldList = prev ?? [];
    const freshList = fresh ?? [];
    if (freshList.length === 0 && oldList.length === 0) return undefined;
    const freshKeys = new Set(freshList.map(refFingerprint));
    const kept: WorkbenchShotReference[] = [];
    // 1) 保留用户素材（非 subject 指纹 / user-upload）——T6 幂等：用户已加素材不覆盖
    for (const r of oldList) {
      const o = r.origin;
      if (!o || o.kind === 'user-upload') {
        if (!freshKeys.has(`user:${r.id}`)) kept.push(r);
      } else if (!freshKeys.has(refFingerprint(r))) {
        // subject 来源在最新回填中已不存在（状态删除/图换代）→ 丢弃旧自动引用，交由 T8 失效标记
        kept.push({ ...r, stale: { level: 'broken', reason: '引用来源已变更，请在下方替换' } });
      }
    }
    // 2) 补入最新自动回填（按指纹与 kept 去重，防止新旧重复）
    const keptKeys = new Set(kept.map(refFingerprint));
    for (const r of freshList) {
      const k = refFingerprint(r);
      if (!keptKeys.has(k)) {
        const existing = oldList.find((o) => refFingerprint(o) === k);
        kept.push(existing ? { ...existing, origin: r.origin } : r);
        keptKeys.add(k);
      }
    }
    return kept;
  };

  /** 生成上游分镜行 → 占位 clip 的 references + 提示词预填（T6） */
  const buildPlaceholder = (s: Record<string, any>): { references: WorkbenchShotReference[]; videoPrompt?: string; imagePrompt?: string } => {
    const mentions = resolveShotMentions(s.entities as Array<Record<string, unknown> | string> | undefined, s.description ?? '');
    const refs = buildRefsFromSource(mentions, {
      subjectTrees: sourceRefCtx?.subjectTrees,
      baseEntities: (sourceRefCtx?.baseEntities ?? []) as Array<{ name: string; id: string; referenceImages?: Array<{ storageKey: string }> }>,
    });
    const preview = buildPromptPreview(s, refs);
    return {
      references: refs,
      // 视频提示词 = 语义描述(上游 promptText/description 兜底) + 参考素材映射行；上游显式 videoPrompt 优先
      videoPrompt: (s.videoPrompt as string | undefined) || preview || undefined,
      // dock 输入区绑定 imagePrompt（workbench-sheet promptDockProps.value），预填 preview 让用户直接可改
      imagePrompt: (s.imagePrompt as string | undefined) || preview || undefined,
    };
  };
  /** 该 clip 是否「用户已动」→ 幂等保护（T6：已生成/用户编辑过提示词/上传过素材则保留不动）
   * 注意：自动预填的 imagePrompt/videoPrompt 不算「用户已动」（manualEdit 未置位）；
   * 上游语义变化后重连仍会刷新空占位的提示词与 subject 引用。 */
  const isTouched = (shot: WorkbenchShot): boolean =>
    shot.clipState === 'completed' ||
    Boolean(shot.manualEdit) ||
    Boolean(shot.media) ||
    (shot.references ?? []).some((r) => !r.origin || r.origin.kind === 'user-upload');

  const merged: WorkbenchShot[] = [];
  for (const s of sourceShots) {
    if (deleted.has(s.id)) continue; // 本地删除不复活
    const prev = localBySource.get(s.id);
    if (prev) {
      if (isTouched(prev)) {
        // 幂等：已生成/已编辑/已有素材 → 只同步展示字段，绝不覆盖 prompt/references
        merged.push({
          ...prev,
          description: s.description ?? prev.description,
          shotType: s.shotType ?? prev.shotType,
          duration: s.duration ?? prev.duration,
          negativePrompt: s.negativePrompt,
          bibleRefs: s.bibleRefs,
        });
      } else {
        // 空占位 → 同步内容 + 指纹级合并 references + 预填提示词（无则补）
        const fill = buildPlaceholder(s);
        merged.push({
          ...prev,
          description: s.description ?? prev.description,
          shotType: s.shotType ?? prev.shotType,
          duration: s.duration ?? prev.duration,
          negativePrompt: s.negativePrompt,
          bibleRefs: s.bibleRefs,
          references: mergeRefs(prev.references, fill.references),
          videoPrompt: fill.videoPrompt ?? prev.videoPrompt,
          imagePrompt: fill.imagePrompt ?? prev.imagePrompt,
        });
      }
    } else {
      // 上游新增镜头
      const fill = buildPlaceholder(s);
      merged.push({
        id: s.id,
        number: s.number ?? 0,
        description: s.description ?? '',
        shotType: s.shotType ?? '',
        duration: s.duration ?? 0,
        imagePrompt: fill.imagePrompt,
        videoPrompt: fill.videoPrompt,
        negativePrompt: s.negativePrompt,
        quality: s.quality,
        promptAssembly: s.promptAssembly,
        manualEdit: s.manualEdit,
        bibleRefs: s.bibleRefs,
        audioPreview: s.audioPreview,
        status: s.status ?? 'pending',
        clipState: 'placeholder' as const,
        sourceShotId: s.id,
        references: fill.references,
      });
    }
  }
  // 本地补拍/拖入的无源片段保留在末尾（上游无此 sourceShotId）
  const sourceIds = new Set(sourceShots.map((s) => s.id));
  const extras = current.shots.filter((s) => !s.sourceShotId || !sourceIds.has(s.sourceShotId));
  return [...merged, ...extras].map((s, i) => ({ ...s, number: i + 1 }));
}

/** 分镜源内容指纹（shots 级差异依据）：稳定的确定性 hash，仅作同源前后一致性比较。 */
export function fingerprintSourceShots(shots: Array<{ id?: string; description?: string; shotType?: string; duration?: number }>): string {
  const parts = shots
    .map((s) => `${s.id ?? ''}|${s.description ?? ''}|${s.shotType ?? ''}|${typeof s.duration === 'number' ? s.duration : 0}`)
    .join('__');
  let h = 5381;
  for (let i = 0; i < parts.length; i++) {
    h = ((h << 5) + h + parts.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** 由合并后的镜头序列生成轨道 clip 实例（源引用 + 上沿累计摆位 + 全量实例快照做兜底） */
function buildClipsFromShots(shots: WorkbenchShot[]): WorkbenchClipRef[] {
  const clips: WorkbenchClipRef[] = [];
  let acc = 0;
  for (const s of shots) {
    clips.push({
      ref: { sourceShotId: s.sourceShotId ?? s.id, kind: 'shot' as const },
      timeline: { startMs: acc, durationMs: Math.max(1, s.duration * 1000) },
      instanceData: { ...s },
    });
    acc += Math.max(1, s.duration * 1000);
  }
  return clips;
}

/**
 * 本地版（Plan#83）：项目唯一导轨兑底。
 *
 * SaaS 版导轨靠「分镜节点连入」触发 buildWorkbenchSync 建轨；本地版分镜节点已取消，
 * 新建的段只进 data.shots → tracks 为空 → 导轨区什么都不画（问题：轨道里看不到片段，只有画布有）。
 * 因此：无轨但有段时，按段顺序自动生成一条 active 主轨（段与 clip 1:1 引用）。
 */
export function ensureMainTrack(data: WorkbenchNodeData): WorkbenchNodeData {
  const tracks = data.tracks ?? [];
  const shots = data.shots ?? [];
  if (tracks.length > 0 || shots.length === 0) return data;

  const clips = buildClipsFromShots(shots);
  const totalMs = clips.reduce((m, c) => Math.max(m, c.timeline.startMs + c.timeline.durationMs), 0);
  const main: WorkbenchTrack = {
    id: 'track-main',
    name: '主轨',
    sourceChain: { origin: 'project', label: '本项目' },
    status: 'active',
    order: 1,
    clips,
  };
  return {
    ...data,
    tracks: [main],
    totalDuration: data.totalDuration || totalMs / 1000,
    status: data.status === 'idle' ? 'ready' : data.status,
  };
}

/** 出片页默认占位片段时长（秒）：与 workbench-sheet PLACEHOLDER_DEFAULT_DURATION 同口径（2026-11-04） */
export const DEFAULT_CLIP_DURATION_SEC = 15;

/**
 * 2026-11-04 出片页布局改造：空数据兜底——进入出片页时保证至少 1 个占位片段（序号 1）。
 * 与 ensureMainTrack 同节奏（挂载 effect 幂等补齐）：已有片段时原样返回（=== 原引用，不触发写回）。
 */
export function ensureDefaultShot(data: WorkbenchNodeData): WorkbenchNodeData {
  if ((data.shots ?? []).length > 0) return data;
  const shot: WorkbenchShot = {
    id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    number: 1,
    description: '',
    shotType: '中景',
    duration: DEFAULT_CLIP_DURATION_SEC,
    status: 'pending',
    clipState: 'placeholder',
    paramValues: { duration: DEFAULT_CLIP_DURATION_SEC },
  };
  return { ...data, shots: [shot] };
}

/**
 * 2026-11-04 出片页布局改造：删除保护——任何删除路径（单删/批量/快捷键）执行后
 * 必须至少保留 1 个片段。返回 true = 允许删除。
 */
export function canDeleteShots(totalShots: number, deleteCount: number): boolean {
  return totalShots - deleteCount >= 1;
}

/** 重连差异检验：同源已有 active 轨时，shots 指纹变化 或 引用失效 认定有差异。 */
function hasContentDiff(
  existing: WorkbenchTrack,
  fingerprint: string,
  sourceData: Record<string, unknown>,
  currentShots: WorkbenchShot[],
): boolean {
  if (fingerprint !== existing.contentFingerprint) return true;
  // 统一读盘口径：旧 baseState 双结构在这里一并迁移成 states[0]
  const subjectTrees = migrateSubjectTrees(sourceData.subjectTree);
  if (subjectTrees.length === 0) return false;
  const refs: WorkbenchShotReference[] = [];
  for (const s of currentShots ?? []) {
    if (s.sourceShotId && (s.references ?? []).length) refs.push(...(s.references as WorkbenchShotReference[]));
  }
  if (refs.length === 0) return false;
  return detectStaleRefs({ subjects: subjectTrees, refs }).length > 0;
}

/**
 * 单一同步点：分镜连入 → 建 active 轨；同分镜断开重连验差异 → 建 candidate 轨。
 * 合并原 creation-node-view 的 syncFromGraph 与按需重连两条重复同步链路。
 */
export function buildWorkbenchSync(input: {
  sourceNode: { id: string; title?: string };
  sourceShots: Array<Record<string, any>>;
  sourceData: Record<string, unknown>;
  current: WorkbenchNodeData;
  event: 'connect' | 'reconnect';
}): {
  shots: WorkbenchShot[];
  tracks: WorkbenchTrack[];
  totalDuration: number;
  status: WorkbenchStatus;
  /** 是否新建了轨道（供接线方决定是否 write，避免无差异重载引发 Yjs 抖动） */
  changed: boolean;
} {
  const { sourceNode, sourceShots, sourceData, current, event } = input;
  const subjectTrees = Array.isArray(sourceData.subjectTree) ? (sourceData.subjectTree as SubjectTree[]) : undefined;
  const baseEntities = collectBaseEntities(sourceData);
  const merged = buildMergedWorkbenchShots(sourceShots, current, { subjectTrees, baseEntities });
  const fingerprint = fingerprintSourceShots(sourceShots);

  const prevTracks = current.tracks ?? [];
  const sameOrigin = prevTracks.filter((t) => t.sourceChain.origin === sourceNode.id);
  // 优先非 discarded 轨；全部 discarded（曾断开归档，PE3）时取最新一条做重连基准
  const existing = sameOrigin.find((t) => t.status !== 'discarded') ?? sameOrigin[sameOrigin.length - 1];
  let tracks = [...prevTracks];
  let changed = false;

  if (!existing) {
    // 首次连入 → active 轨
    const title = typeof sourceNode.title === 'string' && sourceNode.title.trim() ? sourceNode.title.trim() : '分镜';
    tracks.push({
      id: `track-${sourceNode.id}-${Date.now()}`,
      name: title,
      sourceChain: { origin: sourceNode.id, label: title },
      status: 'active',
      order: prevTracks.reduce((m, t) => Math.max(m, t.order), 0) + 1,
      clips: buildClipsFromShots(merged),
      contentFingerprint: fingerprint,
    });
    changed = true;
  } else if (existing.status === 'discarded') {
    // PE3：全归档重连——内容有差异直接建新 active 轨（无活跃轨可比并，不走 candidate）；
    // 无差异复活归档轨为 active（保留用户已排 clips 快照，不重建）
    if (hasContentDiff(existing, fingerprint, sourceData, current.shots)) {
      const title = typeof sourceNode.title === 'string' && sourceNode.title.trim() ? sourceNode.title.trim() : '分镜';
      tracks.push({
        id: `track-${sourceNode.id}-${Date.now()}`,
        name: title,
        sourceChain: { origin: sourceNode.id, label: title },
        status: 'active',
        order: prevTracks.reduce((m, t) => Math.max(m, t.order), 0) + 1,
        clips: buildClipsFromShots(merged),
        contentFingerprint: fingerprint,
      });
    } else {
      tracks = tracks.map((t) => (t.id === existing.id ? { ...t, status: 'active' as const } : t));
    }
    changed = true;
  } else if (event === 'reconnect' && hasContentDiff(existing, fingerprint, sourceData, current.shots)) {
    // 断开重连且内容有差异 → candidate 轨（插入被改轨下方，不替换原方案）
    const siblingMaxOrder = prevTracks
      .filter((t) => t.sourceChain.origin === sourceNode.id)
      .reduce((m, t) => Math.max(m, t.order), existing.order);
    const versionCount = prevTracks.filter((t) => t.sourceChain.origin === sourceNode.id).length + 1;
    const baseName = existing.name || existing.sourceChain.label || '分镜';
    tracks.push({
      id: `track-${sourceNode.id}-cand${Date.now()}`,
      name: `${baseName} 方案v${versionCount}`,
      sourceChain: { origin: sourceNode.id, label: existing.sourceChain.label },
      status: 'candidate',
      order: siblingMaxOrder + 1,
      clips: buildClipsFromShots(merged),
      contentFingerprint: fingerprint,
    });
    changed = true;
  }
  // 无差异或 connect 已处理：沿用现有轨（不抖动）

  tracks = tracks.sort((a, b) => a.order - b.order || (a.status === 'active' ? -1 : 1));

  return {
    shots: merged,
    tracks,
    totalDuration: merged.reduce((s, x) => s + x.duration, 0),
    status: current.status === 'idle' ? 'ready' : current.status,
    changed,
  };
}

/** E3：轨道 clip 实例 → 该轨真实镜头序列（分层过渡：池优先 + clip.instanceData 兜底） */
export function resolveShotsForTrack(track: WorkbenchTrack | undefined, data: WorkbenchNodeData): WorkbenchShot[] {
  if (!track || !Array.isArray(track.clips)) return [];
  const pool = new Map<string, WorkbenchShot>();
  for (const s of data.shots ?? []) pool.set(s.id, s);
  const out: WorkbenchShot[] = [];
  for (const clip of track.clips) {
    const sid = clip.ref.sourceShotId;
    const base = (sid ? pool.get(sid) : undefined) ?? (clip.instanceData as WorkbenchShot | undefined);
    if (!base) continue;
    out.push({
      ...base,
      ...clip.instanceData,
      number: out.length + 1,
      duration: clip.timeline.durationMs > 0 ? clip.timeline.durationMs / 1000 : base.duration,
      sourceShotId: base.sourceShotId ?? sid,
    });
  }
  return out;
}

export interface SuperimposeSlot {
  /** 本槽起止（毫秒） */
  t0: number;
  t1: number;
  /** 归属轨 id；空档为 null */
  trackId: string | null;
  /** 是否空档回填（非最上 active 轨填充） */
  backfilled: boolean;
}

/** 按 order 升序取 active 轨交集（上优先 + 空档回填裁决）。
 * 以最上 active 轨为主播放行程，其空档处由下方轨（candidate 优先 order 小者）回填。 */
export function resolveSuperimpose(tracks: WorkbenchTrack[]): SuperimposeSlot[] {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];
  const actives = tracks
    .filter((t) => t.status !== 'discarded')
    .slice()
    .sort((a, b) => a.order - b.order);
  if (actives.length === 0) return [];
  const primary = actives[0] as WorkbenchTrack;
  const totalEnd = actives.reduce(
    (m, t) => Math.max(m, (t.clips ?? []).reduce((cm, c) => Math.max(cm, c.timeline.startMs + c.timeline.durationMs), 0)),
    0,
  );

  const asRange = (t: WorkbenchTrack) =>
    (t.clips ?? [])
      .map((c) => ({ t0: c.timeline.startMs, t1: c.timeline.startMs + c.timeline.durationMs, trackId: t.id, backfilled: false }))
      .filter((r) => r.t1 > r.t0);
  const owned: Array<{ t0: number; t1: number; trackId: string | null; backfilled: boolean }> = [];
  const addOwned = (t0: number, t1: number, trackId: string | null, backfilled: boolean) => {
    for (let i = owned.length - 1; i >= 0; i--) {
      const e = owned[i];
      if (!e) continue;
      if (t0 < e.t1 && e.t0 < t1) {
        if (e.t0 < t0) owned.push({ t0: e.t0, t1: t0, trackId: e.trackId, backfilled: e.backfilled });
        if (t1 < e.t1) owned.push({ t0: t1, t1: e.t1, trackId: e.trackId, backfilled: e.backfilled });
        owned.splice(i, 1);
      }
    }
    owned.push({ t0, t1, trackId, backfilled });
    owned.sort((a, b) => a.t0 - b.t0);
  };

  // 1) 最上 active 轨：上优先，占据全部命中区间（backfilled=false）
  for (const r of asRange(primary)) addOwned(r.t0, r.t1, r.trackId, false);
  // 2) 其余轨：只回填未被占用的空档（backfilled=true），按 order 升序（candidate 在上层级者先回填）
  for (const trk of actives) {
    if (trk.id === primary.id) continue;
    for (const r of asRange(trk)) {
      // 找 [r.t0,r.t1] 内未被占用的片段
      let cursor = r.t0;
      const sortedOwned = owned.filter((e) => e.t1 > r.t0 && e.t0 < r.t1);
      for (const e of sortedOwned) {
        if (cursor < e.t0) addOwned(cursor, Math.min(e.t0, r.t1), trk.id, true);
        cursor = Math.max(cursor, e.t1);
        if (cursor >= r.t1) break;
      }
      if (cursor < r.t1) addOwned(cursor, r.t1, trk.id, true);
    }
  }
  // 3) 收尾剩余空档划为 gap
  const slots: SuperimposeSlot[] = [];
  let cursor = 0;
  for (const e of owned) {
    if (e.t0 > cursor) {
      const t0 = cursor;
      const t1 = Math.min(e.t0, totalEnd);
      if (t1 > t0) slots.push({ t0, t1, trackId: null, backfilled: false });
    }
    cursor = Math.max(cursor, e.t1);
    slots.push({ t0: e.t0, t1: e.t1, trackId: e.trackId, backfilled: e.backfilled });
  }
  if (cursor < totalEnd) slots.push({ t0: cursor, t1: totalEnd, trackId: null, backfilled: false });
  return slots.filter((s) => s.t1 > s.t0).sort((a, b) => a.t0 - b.t0);
}