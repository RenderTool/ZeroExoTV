/**
 * WorkbenchTabContent — 顶部「导演台」页签 = 真正的导演台单轨工作区（2026-11-04 重写）
 *
 * 初始化完成即进入可用页面。
 *
 * ## 结构（沿用出片页已落地的 2026-11-04 布局，复用 StoryboardMergedTab）
 * - 上排：左提示词区（WorkbenchPromptDock，受控读写当前片段）+ 右视频预览；
 * - 下排：单轨片段轨道通栏（WorkbenchMultiTrack，活动轨唯一）；
 * - 「一段 = 一个片段」：容器初始化即带片段 1（5 秒、序号 1，ensureWorkbenchContainer 幂等），
 *   提示词区与当前选中片段 1 对 1 绑定；删除统一经 guardDeleteShots 把关——剩最后一个
 *   拒绝并轻提示（workbench.keepAtLeastOneClip），任何路径都不可删到 0。
 *
 * ## 数据源（绝不读 graph）
 * 唯一事实源 = 项目级容器 projects/<projectId>/entities/workbench.json
 * （@/entities/slot-containers：shots=片段 WorkbenchShot[]，tracks=单轨镜像）。
 * projectId 取自 slotBindings.script（与 ScriptTabContent 同一取值路径）。
 * 读取路径一律走 ensureWorkbenchContainer：容器缺失 → 创建；存在但 0 片段 → 幂等自愈
 * 补 1 段 5s 并落盘（不依赖"新建项目"，存量项目进入即补）。本组件不 import 任何图 store。
 *
 * ## 2026-11-04 渲染根因修复（用户实测"看不到片段"）
 * WorkbenchMultiTrack 对活动轨渲染的是 timeline.shots（workbench-multitrack.tsx:603
 * `shots={isActive ? timeline.shots : resolvedClips}`），不是从 tracks/data 解析的片段——
 * 此前这里误传 `shots: []`，导致活动轨永远渲染 0 个片段（实体里有数据也看不见）。
 * 修复：timeline.shots 与 tracks/data 由同一份实体 shots 派生（单链路，不两套）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Modal } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { History, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/shared/components/confirm-dialog.js';
import { useCanvasTabStore } from './canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { CanvasTabContentBoundary } from './CanvasTabContentBoundary.js';
import {
  ensureWorkbenchContainer,
  readStoryboardContainer,
  readWorkbenchContainer,
  updateWorkbenchContainer,
  type WorkbenchContainer,
  type WorkbenchSharedParams,
} from '@/entities/slot-containers.js';
import {
  deleteSnapshotFile,
  listSnapshots,
  pruneDuplicateSnapshots,
  restoreSnapshot,
  type SnapshotListItem,
} from '@/entities/snapshot-store.js';
import {
  DIRECTOR_FPS,
  DIRECTOR_PRESETS,
  buildPackSummary,
  rebaseShotsForSharedChange,
  resolveVideoSize,
  segmentContinuityEnabled,
  type DirectorAssetRef,
  type PackSummary,
  type RunShotLike,
} from '@/entities/director-params.js';
import { resolveSubjectCover } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { StoryboardMergedTab } from '@/features/canvas-nodes/storyboard/storyboard-merged-tab.js';
/* 2026-11-04 批量复用 dry-run 预检：DirectorBatchPanel（独立简化勾选页）已删除——
   勾选在轨道行、确认/运行收敛到 dry-run 预检，不留两套并行 UI */
import type { TimelineClipData } from '@/features/canvas-nodes/storyboard/timeline-constants.js';
import { DIRECTOR_ARROW_SIZE, DIRECTOR_ARROW_GLYPH, DIRECTOR_CARD_GAP, DIRECTOR_CARD_WIDTH_BASE, TRACK_CLIP_TOP, directorArrowTone, directorCardHeight } from '@/features/canvas-nodes/storyboard/timeline-constants.js';
import type { ProductionItem } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { readScript, watchScript } from '@/entities/script-store.js';
import type {
  WorkbenchNodeData,
  WorkbenchShot,
  WorkbenchShotReference,
  WorkbenchTrack,
} from '@/features/canvas-nodes/storyboard/workbench-types.js';
import { WORKBENCH_ADD_REF_EVENT, type WorkbenchAddRefDetail } from './workbench-slot-bus.js';
import { syncWorkbenchSendContext } from '@/features/canvas-assets/workbench-send.js';
import { DirectorPromptPanel } from './director-prompt-panel.jsx';
import { DirectorParamsButton, DirectorRunButton } from './director-run-params-row.js';
import { useDirectorRun } from './use-director-run.js';
import { getRunConfigFromEndpoint, useComfyuiEndpointStore } from './comfyui-endpoint.js';
import { normalizeBaseUrl } from './comfyui-bridge-client.js';
import { reconcileStaleGenerating } from './workbench-stale-generating.js';
import { NAVIGATE_FOCUS_SHOT_EVENT, takePendingNavigateFocus, type NavigateFocusPayload } from './navigate-to-view.js';

/** 公共参数默认值：本地预设 h3（不调线上 API），与节点 INPUT_TYPES 默认值一致；aspect/scaleFactor 为 APP 级换算入参
 * 2026-11-05 公共提示词层下线：不再产生 prompt 字段（历史数据由 ensureWorkbenchContainer 一次性迁移） */
function createDefaultSharedParams(): WorkbenchSharedParams {
  return {
    enabled: true, assets: [], presetId: 'h3',
    params: { ...DIRECTOR_PRESETS.h3.params, aspect: '16:9', scaleFactor: 1 },
  };
}

/** WorkbenchShot → 运行校验/摘要结构（text 类引用不进槽位编号空间） */
function toRunShot(s: WorkbenchShot): RunShotLike {
  return {
    id: s.id,
    number: s.number,
    duration: s.duration,
    status: s.status,
    imagePrompt: s.imagePrompt,
    continuation: s.continuation,
    references: (s.references ?? [])
      .filter((r) => r.kind === 'image' || r.kind === 'video' || r.kind === 'audio')
      .map((r) => ({ id: r.id, kind: r.kind as 'image' | 'video' | 'audio', title: r.title, storageKey: r.storageKey, url: r.url })),
  };
}

/** 新建空片段（占位态：显示提示词输入器；默认 5 秒，与容器默认片段一致——2026-11-04 约定） */
function createSegment(number: number): WorkbenchShot {
  return {
    id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    number,
    description: '',
    shotType: '',
    duration: 5,
    imagePrompt: '',
    videoPrompt: '',
    status: 'pending',
    clipState: 'placeholder',
    references: [],
    paramValues: {},
  };
}

/**
 * WorkbenchShot.status → 卡片六态徽标（2026-11-05 220px 卡片规格）：
 * 排队/已取消由运行态派生——排队 = 提交中/在队/运行中未轮到本段；已取消 = 运行取消且本段未完成。
 * 仅导演台路径调用；未生成/生成中/完成/失败直接透传。
 */
export function resolveClipStatus(
  status: WorkbenchShot['status'],
  run: { phase: string; segmentShotIds: readonly string[]; currentSegment: number | null } | undefined,
  shotId: string,
): NonNullable<TimelineClipData['status']> {
  if (status === 'pending') return 'idle';
  if (status === 'done' || status === 'failed') return status;
  if (!run) return 'generating';
  if (run.phase === 'canceled') return 'cancelled';
  if (run.phase === 'submitting' || run.phase === 'queued') return 'queued';
  if (run.phase === 'running') {
    const idx = run.segmentShotIds.indexOf(shotId);
    // 不在本次运行序列（历史残留 generating）→ 保持原态，不误标排队
    if (idx < 0) return 'generating';
    return run.currentSegment !== null && idx === run.currentSegment - 1 ? 'generating' : 'queued';
  }
  return 'generating';
}

/** WorkbenchShot → 时间轴 clip（与 workbench-multitrack.tsx byTrack 的转换逐项对齐，同一映射不两套） */
function toTimelineClip(s: WorkbenchShot, firstFrameUrls: Record<string, string> | undefined, run?: { phase: string; segmentShotIds: readonly string[]; currentSegment: number | null }): TimelineClipData {
  return {
    id: s.id,
    number: s.number,
    duration: s.duration,
    status: resolveClipStatus(s.status, run, s.id),
    // 生成完成段的缩略：会话内 objectURL（主线程截帧产物）优先，回落持久化 firstFrameKey
    thumbnailUrl: firstFrameUrls?.[s.id] ?? s.firstFrameKey,
    videoKey: s.clipState === 'completed' && s.media?.storageKey ? s.media.storageKey : undefined,
    trimStart: s.media?.trimStart,
    trimEnd: s.media?.trimEnd,
    sourceDuration: s.media?.sourceDuration,
    label: `#${s.number} ${s.description || s.shotType}`,
    hasAudio: !!s.audioPreview,
  };
}

export function WorkbenchTabContent(): React.ReactElement | null {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { theme } = useTheme();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  // 项目 id = 剧本槽位绑定（editor-page 进入项目时写入；与 ScriptTabContent 同一路径）
  const projectId = useCanvasTabStore((s) => s.slotBindings.script);
  // 接受裸 kind（无载体）与 kind:id（历史 key）两种形态
  const isActive = activeTabKey === 'workbench' || activeTabKey.startsWith('workbench:');

  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** 版本（快照）面板：workbench 每次写盘都会自动落 pre-save/auto 快照，这里只做查看/恢复 */
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<Array<SnapshotListItem<WorkbenchContainer>> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [versionConfirm, setVersionConfirm] = useState<{ kind: 'restore' | 'delete'; snap: SnapshotListItem<WorkbenchContainer> } | null>(null);
  /** 片段列表（本地受控；防抖写回容器） */
  const [shots, setShots] = useState<WorkbenchShot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  // 2026-11-04 约定（偏好记忆）：时间线缩放持久化到全局偏好 store——
  // 页签切换会卸载本组件，此前缩放只活在本地 useState，切走即回 40；现存 store，切回/刷新都保留
  const pixelsPerSecond = useViewPrefsStore((s) => s.workbench.pixelsPerSecond);
  const setPixelsPerSecond = useViewPrefsStore((s) => s.setWorkbenchPixelsPerSecond);
  /** 公共参数（受控；与 shots 同一防抖链路写回容器） */
  const [sharedParams, setSharedParams] = useState<WorkbenchSharedParams>(createDefaultSharedParams);
  /** 选择运行：勾选的片段 id 集合（唯一勾选状态源；只在批量模式期间存活） */
  const [runSelection, setRunSelection] = useState<ReadonlySet<string>>(new Set());
  /** 轨道模式：'continuity'=链接（点片段切引导）；'batch'=批量（轨道行勾选，确认/运行收敛到 dry-run 预检页）；null=普通浏览 */
  const [trackMode, setTrackMode] = useState<'continuity' | 'batch' | null>(null);
  /**
   * 2026-11-04 链接模式「全选/取消」（约定）：进入链接模式先快照一份草稿
   * （shotId → 该段前侧交界是否开启，仅段 2..N），模式内所有勾选改动只写草稿；
   * 「完成」一次性落盘，「取消」/Esc 回滚到进入前状态（与批量模式同样的临时态语义）。
   * null = 非链接模式。
   */
  const [continuityDraft, setContinuityDraft] = useState<Record<string, boolean> | null>(null);
  /** 主体库条目（ProductionItem[]；面板「主体」Tab 数据源） */
  const [subjects, setSubjects] = useState<ProductionItem[]>([]);
  /** 主体树（状态级媒体：图片/音频；@ 面板「主体状态素材」候选源，与插槽无关） */
  const [subjectTrees, setSubjectTrees] = useState<SubjectTree[]>([]);
  /**
   * 2026-11-05 方案 C：剧本集上下文（activeEpisodeId + 集 id→集号映射）——
   * 主体列表按「出现集数」排序（命中本集/未标注前、其它集后 +「标注为第 N 集」小字）。
   * activeEpisodeId 取不到 = null → 不重排不加标签（与主体库 StoryboardSubjectTree 同口径）。
   */
  const [episodeContext, setEpisodeContext] = useState<{ activeEpisodeId: string | null; numberById: Record<string, number> }>({ activeEpisodeId: null, numberById: {} });
  /** dry-run 预检弹层：片段表 + pack 摘要 + 本次运行断开的衔接列表（执行按钮保留 dry-run 语义，不发起真实生成） */
  const [dryRun, setDryRun] = useState<{ summary: PackSummary; disconnects: Array<{ fromNo: number; toNo: number }>; selectedIds: string[]; continuationOff: ReadonlySet<string> } | null>(null);
  const dirtyRef = useRef(false);
  const shotsRef = useRef<WorkbenchShot[]>([]);
  shotsRef.current = shots;
  const sharedParamsRef = useRef<WorkbenchSharedParams>(sharedParams);
  sharedParamsRef.current = sharedParams;

  // 2026-11-05 约定：把 选中片段/预设 tier 快照同步给抽屉侧判定桥（workbench-send.ts），
  // 抽屉「发送到导演台当前片段」与素材区加号使用同一份事实源（同一 references/tier；
  // 公共素材 UI 已下线，槽号只按本片段 refs 从 1 连续编号）。
  useEffect(() => {
    const activeShot = shots.find((s) => s.id === activeShotId) ?? shots[0] ?? null;
    syncWorkbenchSendContext({
      projectId: projectId ?? '',
      activeShotId: activeShot?.id ?? null,
      segmentAssets: (activeShot?.references ?? []) as unknown as DirectorAssetRef[],
      tier: sharedParams.presetId === 'sd2.5' ? 'sd2.5' : 'h3',
    });
    return () => syncWorkbenchSendContext(null);
  }, [projectId, shots, activeShotId, sharedParams]);

  // 载入导演台容器：一律走 ensureWorkbenchContainer（幂等）——
  // 缺失 → 创建（自带片段 1）；存在但 0 片段 → 自愈补 1 段 5s 并落盘；≥1 片段 → 原样。
  useEffect(() => {
    const pid = isActive ? projectId : null;
    if (!pid) {
      setShots([]);
      setActiveShotId(null);
      setLoadState('idle');
      return;
    }
    let cancelled = false;
    setLoadState('loading');
    ensureWorkbenchContainer(pid)
      .then((ensured) => (cancelled ? null : ensured.container))
      .then((c) => {
        if (cancelled || !c) return;
        const loaded = ((c.shots ?? []) as WorkbenchShot[]).filter((s) => s && typeof s === 'object');
        // 一段 = 一个片段：零片段时默认一个空片段（可用结构，不是状态文案）
        const next = loaded.length > 0 ? loaded : [createSegment(1)];
        setShots(next);
        setSharedParams(c.sharedParams ?? createDefaultSharedParams());
        setActiveShotId((cur) => (cur && next.some((s) => s.id === cur) ? cur : next[0]?.id ?? null));
        setLoadState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[WorkbenchTabContent] read workbench container failed:', err);
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [isActive, projectId, reloadToken]);

  /** 打开「版本」：列出 workbench 自动快照（新 → 旧） */
  const openVersions = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setVersionsOpen(true);
    setVersions(null);
    try {
      // 历史垃圾清理：同内容 hash 只保留最新一份（旧实现每次自动保存都落一份）
      await pruneDuplicateSnapshots(projectId, 'workbench');
      const list = await listSnapshots<WorkbenchContainer>(projectId, 'workbench', { withSize: true });
      setVersions([...list].reverse());
    } catch (err) {
      message.warning(err instanceof Error ? err.message : String(err));
      setVersions([]);
    }
  }, [projectId, message]);

  /** 删除某份版本（仅删该快照文件，不改当前内容） */
  const deleteVersion = useCallback((snap: SnapshotListItem<WorkbenchContainer>): void => {
    if (!projectId) return;
    setVersionConfirm({ kind: 'delete', snap });
  }, [projectId]);

  /** 恢复某份版本：先自动存当前版（pre-restore），再写回容器 */
  const restoreVersion = useCallback((snap: SnapshotListItem<WorkbenchContainer>): void => {
    if (!projectId) return;
    setVersionConfirm({ kind: 'restore', snap });
  }, [projectId]);

  /** 统一确认弹窗（项目 ConfirmDialog：主题 + zIndex 1050，不用静态 Modal.confirm） */
  const applyVersionConfirm = useCallback(async (): Promise<void> => {
    const target = versionConfirm;
    if (!target || !projectId) return;
    setVersionConfirm(null);
    try {
      if (target.kind === 'restore') {
        await restoreSnapshot<WorkbenchContainer>(projectId, 'workbench', { entity: target.snap.entity }, {
          readCurrent: () => readWorkbenchContainer(projectId),
          write: (entity) => updateWorkbenchContainer(projectId, {
            title: entity.title,
            tracks: entity.tracks,
            shots: entity.shots,
            totalDuration: entity.totalDuration,
            sharedParams: entity.sharedParams,
          }),
        });
        setVersionsOpen(false);
        setReloadToken((v) => v + 1);
        message.success(t('director.restoreVersionDone', '已恢复到该版本'));
      } else {
        await deleteSnapshotFile(projectId, 'workbench', target.snap.fileName);
        setVersions((prev) => prev?.filter((v) => v.fileName !== target.snap.fileName) ?? prev);
        message.success(t('director.deleteVersionDone', '已删除该版本'));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }, [versionConfirm, projectId, message, t]);

  // 主体库（面板「主体」Tab 数据源）：读 projects/<pid>/entities/storyboard.json 的 entities 字段
  // （元素结构 = ProductionItem：production-manager-types.ts L33-52；状态图 = images[].stateTag）
  useEffect(() => {
    const pid = isActive ? projectId : null;
    if (!pid) {
      setSubjects([]);
      setSubjectTrees([]);
      return;
    }
    let cancelled = false;
    readStoryboardContainer(pid)
      .then((c) => {
        if (cancelled) return;
        setSubjects(((c?.entities ?? []) as ProductionItem[]).filter((s) => s && typeof s === 'object'));
        setSubjectTrees(((c?.subjectTree ?? []) as SubjectTree[]).filter((t) => t && typeof t === 'object'));
      })
      .catch(() => {
        if (!cancelled) {
          setSubjects([]);
          setSubjectTrees([]);
        }
      });
    return () => { cancelled = true; };
  }, [isActive, projectId]);

  // 2026-11-05 方案 C：读剧本集上下文（activeEpisodeId + 集 id→集号映射），watch 联动；
  // 取不到 = null → 面板不重排不加标签（与主体库 StoryboardSubjectTab 同一取数口径）
  useEffect(() => {
    const pid = isActive ? projectId : null;
    if (!pid) {
      setEpisodeContext({ activeEpisodeId: null, numberById: {} });
      return;
    }
    let cancelled = false;
    const apply = (e: { episodes?: Array<{ id?: string; number: number }>; activeEpisodeId?: string } | null) => {
      if (cancelled) return;
      const numberById: Record<string, number> = {};
      for (const ep of e?.episodes ?? []) {
        if (typeof ep.id === 'string' && typeof ep.number === 'number') numberById[ep.id] = ep.number;
      }
      const active = typeof e?.activeEpisodeId === 'string' ? e.activeEpisodeId : null;
      setEpisodeContext({ activeEpisodeId: active && numberById[active] != null ? active : null, numberById });
    };
    void readScript(pid).then(apply);
    const un = watchScript(pid, apply);
    return () => { cancelled = true; un(); };
  }, [isActive, projectId]);

  // 编辑防抖写回容器（shots + 单轨镜像 + 总时长；版本 +1 由写 API 保证）
  const persist = useCallback(() => {
    const pid = projectId;
    if (!pid || !dirtyRef.current) return;
    dirtyRef.current = false;
    const current = shotsRef.current;
    let start = 0;
    const track: WorkbenchTrack = {
      id: 'track-main',
      name: '主轨',
      sourceChain: { origin: 'workbench-container' },
      status: 'active',
      order: 0,
      clips: current.map((s) => {
        const durationMs = Math.round(s.duration * 1000);
        const clip = {
          ref: { sourceShotId: s.id, kind: 'shot' as const },
          timeline: { startMs: start, durationMs },
        };
        start += durationMs;
        return clip;
      }),
    };
    updateWorkbenchContainer(pid, {
      shots: current,
      tracks: [track],
      totalDuration: current.reduce((sum, s) => sum + s.duration, 0),
      sharedParams: sharedParamsRef.current,
    }).catch((err: unknown) => console.error('[WorkbenchTabContent] write container failed:', err));
  }, [projectId]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    window.setTimeout(persist, 600);
  }, [persist]);

  const updateShot = useCallback(
    (shotId: string, patch: Partial<WorkbenchShot>) => {
      setShots((prev) => prev.map((s) => (s.id === shotId ? { ...s, ...patch } : s)));
      markDirty();
    },
    [markDirty],
  );

  /** 公共参数写入口（与 shots 同一防抖链路落盘） */
  const updateSharedParams = useCallback(
    (patch: Partial<WorkbenchSharedParams>) => {
      setSharedParams((prev) => {
        const next = { ...prev, ...patch };
        // 2026-11-05 公共池顺延（约定，算法照抄插件 minimax_image_batch.js
        // _rebaseIndexedMedia L133-183 / rebaseR2vGroupSlotsForCommon L185-222）：
        // 公共素材数组或开关变化 → 公共池占编号前缀 1..K，所有片段 pinned 槽 ≤K 的整体顺延，
        // 同步改写各段 imagePrompt 的 @PictureN/@AudioN/@VideoN；公共池收缩不回退。
        if (patch.assets !== undefined || patch.enabled !== undefined) {
          const tier = next.presetId === 'sd2.5' ? 'sd2.5' : 'h3';
          const effectiveShared = next.enabled ? ((next.assets ?? []) as DirectorAssetRef[]) : [];
          const { changed, shots: rebased } = rebaseShotsForSharedChange({
            shared: effectiveShared,
            shots: shotsRef.current.map((s) => ({
              id: s.id,
              references: (s.references ?? []) as unknown as DirectorAssetRef[],
              imagePrompt: s.imagePrompt ?? '',
            })),
            tier,
          });
          if (changed) {
            const byId = new Map(rebased.map((r) => [r.shotId, r]));
            setShots((prevShots) =>
              prevShots.map((s) => {
                const r = byId.get(s.id);
                if (!r) return s;
                return {
                  ...s,
                  references: r.references as unknown as WorkbenchShot['references'],
                  imagePrompt: r.imagePrompt,
                };
              }),
            );
          }
        }
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  // ===== 抽屉「发送到导演台当前片段」宿主监听（2026-11-05 约定） =====
  // 抽屉（canvas-assets）emit zeroexo:workbench-add-ref；这里对当前选中片段落槽——
  // 与提示词面板素材区加号同一条 persistRef 路径（references 整体写回，走同一防抖落盘链路），
  // 槽位区缩略图/提示自然出现。满员/无选中/重复入槽在抽屉侧 computeSegmentInsert 已判，
  // 此处再兜一次（宿主侧同资产复用槽号→提示而不重复占位）。
  useEffect(() => {
    const onAddRef = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchAddRefDetail>).detail;
      if (!detail || detail.projectId !== (projectId ?? '')) return;
      const shot = shotsRef.current.find((s) => s.id === activeShotId) ?? shotsRef.current[0];
      if (!shot) return; // 无片段（理论不到达：抽屉侧已拦 no-active-shot）
      const existing = (shot.references ?? []).find((r) => r.id === detail.ref.id);
      if (existing) {
        message.info(t('workbench.slotReused', '该资产已在片段素材池，复用原槽位'));
        return;
      }
      const shotRef: WorkbenchShotReference = {
        id: detail.ref.id, kind: detail.ref.kind, title: detail.ref.title,
        storageKey: detail.ref.storageKey, url: detail.ref.url, slotNo: detail.ref.slotNo,
      };
      (shotRef as WorkbenchShotReference & { originScope?: string }).originScope = detail.ref.originScope;
      updateShot(shot.id, { references: [...(shot.references ?? []), shotRef] });
      message.success(t('workbench.addedToSegment', '已送入当前片段素材池'));
    };
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, onAddRef);
    return () => window.removeEventListener(WORKBENCH_ADD_REF_EVENT, onAddRef);
  }, [projectId, activeShotId, updateShot, message, t]);

  /** 选择运行：dry-run（本仓库无导演台生成链路——只产出 pack 结构摘要，不发起真实生成）。
   *  第十一条D：continuationOff 内的片段本次运行强制断开段间引导（仅投影到运行参数，不改持久实体）。 */
  const handleRun = useCallback(
    (selectedIds: string[], continuationOff?: ReadonlySet<string>) => {
      if (selectedIds.length === 0) {
        message.warning(t('director.runEmpty', '请先勾选要运行的片段'));
        return;
      }
      const runShots = shotsRef.current.map(toRunShot).map((s) =>
        continuationOff?.has(s.id) ? { ...s, continuation: { enabled: false } } : s,
      );
      const summary = buildPackSummary({
        shots: runShots,
        shared: sharedParamsRef.current,
        tier: sharedParamsRef.current.presetId,
        selectedIds,
        /** 无图主体槽位校验（2026-11-04 @ 浮层指令C）：`subject:<id>` 引用经封面回落链解析，null = 尚未录入图像 */
        subjectCoverOf: (subjectId: string) => {
          const subject = subjects.find((s) => s.id === subjectId);
          return subject ? resolveSubjectCover(subject).key : null;
        },
      });
      // 2026-11-04 批量复用预检（要求4）：预检页显式列出本次被断开的衔接处（前段未勾选 → 引导强制 false）
      const disconnects: Array<{ fromNo: number; toNo: number }> = [];
      if (continuationOff && continuationOff.size > 0) {
        const current = shotsRef.current;
        current.forEach((s, i) => {
          if (i > 0 && continuationOff.has(s.id)) {
            disconnects.push({ fromNo: current[i - 1]!.number, toNo: s.number });
          }
        });
      }
      setDryRun({ summary, disconnects, selectedIds, continuationOff: continuationOff ?? new Set() });
    },
    [message, subjects, t],
  );

  const toggleRunSelection = useCallback((shotId: string) => {
    setRunSelection((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }, []);

  /** 轨道「+」插入片段（afterShotId 之后 / 末尾；新增永远允许，新片段自动选中） */
  const handleInsertAt = useCallback(
    (afterShotId: string | null, insert?: { index?: number }) => {
      const prev = shotsRef.current;
      const seg = createSegment(prev.length + 1);
      const at = insert?.index ?? (afterShotId ? prev.findIndex((s) => s.id === afterShotId) + 1 : prev.length);
      const idx = Math.max(0, Math.min(prev.length, at));
      const next = [...prev.slice(0, idx), seg, ...prev.slice(idx)].map((s, i) => ({ ...s, number: i + 1 }));
      setShots(next);
      setActiveShotId(seg.id);
      markDirty();
    },
    [markDirty],
  );

  /* 2026-11-05 导演台：时长不可拖拽（trim handle / ew-resize / onTrim 写回全部移除），
     片段时长只来自参数（参数区/预检）；标签行只读展示 duration。 */

  /* 2026-11-04 批量复用 dry-run 预检（调整：删除独立简化勾选面板）：
     勾选来源 = 轨道行（批量模式下点片段/勾选块 → toggleRunSelection），
     最终确认与运行收敛到同一个 dry-run 预检页（与「运行选中」同一组件、同一渲染）。 */

  /** 段间衔接：草稿态生效值（链接模式内读草稿；模式外读持久值） */
  const continuityOn = useCallback((shot: WorkbenchShot, idx: number): boolean => {
    if (idx === 0) return false;
    if (continuityDraft) return continuityDraft[shot.id] ?? segmentContinuityEnabled(toRunShot(shot), idx);
    return segmentContinuityEnabled(toRunShot(shot), idx);
  }, [continuityDraft]);

  /** 段间衔接：模式内点击片段 = 切换该片段段间引导（写草稿，完成才落盘；段1 恒关，不响应） */
  const toggleShotContinuity = useCallback((shotId: string) => {
    const idx = shotsRef.current.findIndex((s) => s.id === shotId);
    const shot = idx >= 0 ? shotsRef.current[idx] : undefined;
    if (idx > 0 && shot) {
      setContinuityDraft((prev) => {
        if (!prev) return prev;
        const cur = prev[shotId] ?? segmentContinuityEnabled(toRunShot(shot), idx);
        return { ...prev, [shotId]: !cur };
      });
    }
  }, []);

  /** 进入链接模式：快照草稿（段 2..N 的前侧交界当前持久值） */
  const enterContinuityMode = useCallback(() => {
    const draft: Record<string, boolean> = {};
    shotsRef.current.forEach((s, i) => {
      if (i > 0) draft[s.id] = segmentContinuityEnabled(toRunShot(s), i);
    });
    setContinuityDraft(draft);
    setTrackMode('continuity');
  }, []);

  /** 链接模式「取消」/Esc：丢弃草稿回滚到进入前状态，退出模式（持久值零改动） */
  const cancelContinuityMode = useCallback(() => {
    setContinuityDraft(null);
    setTrackMode(null);
  }, []);

  /** 链接模式「完成」/Enter：草稿一次性落盘（仅写有改动的段），退出模式 */
  const commitContinuityMode = useCallback(() => {
    const draft = continuityDraft;
    if (draft) {
      shotsRef.current.forEach((s, i) => {
        if (i === 0) return;
        const next = draft[s.id];
        if (next !== undefined && next !== segmentContinuityEnabled(toRunShot(s), i)) {
          updateShot(s.id, { continuation: { enabled: next } });
        }
      });
    }
    setContinuityDraft(null);
    setTrackMode(null);
  }, [continuityDraft, updateShot]);

  /** 链接模式「全选/取消全选」：一键勾选/清空所有可衔接交界（段 2..N；段 1 恒不可选），作用于草稿 */
  const selectAllContinuity = useCallback(() => {
    setContinuityDraft((prev) => {
      if (!prev) return prev;
      const entries = Object.entries(prev);
      const allOn = entries.length > 0 && entries.every(([, v]) => v);
      const next: Record<string, boolean> = {};
      for (const [id] of entries) next[id] = !allOn;
      return next;
    });
  }, []);

  /** 缺口检测——勾选片段开了段间引导、但其直接前段未勾选 → 本次运行强制断开（持久值不变） */
  const batchAutoDisconnect = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    shots.forEach((s, i) => {
      if (i === 0 || !runSelection.has(s.id)) return;
      if (!segmentContinuityEnabled(toRunShot(s), i)) return;
      const prev = shots[i - 1];
      if (prev && !runSelection.has(prev.id)) set.add(s.id);
    });
    return set;
  }, [shots, runSelection]);

  /** 退出批量模式：清空勾选（不残留） */
  const exitBatchMode = useCallback(() => {
    setRunSelection(new Set<string>());
    setTrackMode(null);
  }, []);

  /** 批量模式「生成」→ 打开 dry-run 预检（按时间线顺序列出勾选片段；缺口引导强制 false 并列明断开处）。
      确认/运行都在预检页完成；此处不改勾选（留待预检页「确认运行」或继续调整）。 */
  const openBatchPreflight = useCallback(() => {
    if (runSelection.size === 0) {
      message.warning(t('director.runEmpty', '请先勾选要运行的片段'));
      return;
    }
    handleRun([...runSelection], batchAutoDisconnect);
  }, [runSelection, batchAutoDisconnect, handleRun, message, t]);

  /** ===== ComfyUI 真实运行（2026-11-05 极简化单地址）=====
   * 连接配置来自右上角「ComfyUI」弹层（comfyui-connect-button，单地址 + 自动判定后端）；
   * 运行配置推导统一在 comfyui-endpoint.getRunConfigFromEndpoint：
   * 直连（/zeroexo/h3/* zip 包契约）或 OpenAI 兼容口（POST /v1/videos，导演参数映射唯一表）；
   * 运行 = 3s 轮询 /status，每段 done 立即下载落库（video storageKey + 首帧缩略，复用 platform/media CAS 机制）；
   * 段状态经 updateShot 直接写回片段实体（导轨卡片三态 + 预览区跟随）。 */
  const [firstFrameUrls, setFirstFrameUrls] = useState<Record<string, string>>({});
  const comfyRun = useDirectorRun({
    getBridgeConfig: () => getRunConfigFromEndpoint(),
    callbacks: {
      onSegmentState: (shotId, state) => {
        updateShot(shotId, { status: state });
      },
      onSegmentDone: (shotId, payload) => {
        const media: NonNullable<WorkbenchShot['media']> = {
          storageKey: payload.videoStorageKey,
          source: 'generated',
        };
        updateShot(shotId, {
          status: 'done',
          clipState: 'completed',
          media,
          firstFrameKey: payload.firstFrameKey,
        });
        if (payload.firstFrameUrl) {
          const url = payload.firstFrameUrl;
          setFirstFrameUrls((m) => ({ ...m, [shotId]: url }));
        }
      },
      onFollowSegment: (shotId) => {
        setActiveShotId(shotId);
      },
      onNotice: (level, node) => {
        if (level === 'error') message.error(node);
        else if (level === 'warning') message.warning(node);
        else message.info(node);
      },
    },
  });
  const runPhaseActive =
    comfyRun.phase === 'submitting' || comfyRun.phase === 'queued' || comfyRun.phase === 'running';

  /**
   * 实时预览跟段（2026-11-07 用户反馈：预览只出现在轨道卡片、右侧预览窗没有）：
   * 预览帧自带 1 基段号 → 自动把选中片段切到正在生成的那段，右侧预览窗用同一帧渲染。
   * 还没有实时帧时退回「当前生成段」（status.currentSegment）也能让右侧跟到进度。
   */
  const livePreviewShotId = comfyRun.preview?.segmentIndex
    ? comfyRun.segmentShotIds[comfyRun.preview.segmentIndex - 1] ?? null
    : null;
  const runningShotId = comfyRun.currentSegment
    ? comfyRun.segmentShotIds[comfyRun.currentSegment - 1] ?? null
    : null;
  const followShotId = livePreviewShotId ?? runningShotId;
  useEffect(() => {
    if (!followShotId) return;
    if (comfyRun.phase !== 'running' && comfyRun.phase !== 'queued') return;
    setActiveShotId((cur) => (cur === followShotId ? cur : followShotId));
  }, [followShotId, comfyRun.phase]);

  // 2026-11-05 自愈对账（workbench-stale-generating）：上次旧包/异常退出把段留在 generating，
  // 刷新后卡片照旧「生成中」而后端队列是空的（用户被假状态连骗数次）。
  // 实体加载完成后对账一次：无本页运行 + 队列无任务 → 残留段降级「已中断」（interrupted）并落盘 +
  // 一次轻提示；幂等（落盘后 status 不再是 generating，重复进入不命中、不重复提示）。
  const staleReconciledRef = useRef(false);
  useEffect(() => {
    if (loadState !== 'ready' || staleReconciledRef.current) return;
    staleReconciledRef.current = true;
    void (async () => {
      // 后端队列探测：优先桥接 /zeroexo/h3/health（自带 CORS，跨域可读）；老插件回退原生 /queue。
      // 都探测不了 = null → 照降级（后端未确认也落确定状态）
      let queueBusy: boolean | null = null;
      const ep = useComfyuiEndpointStore.getState();
      if (ep.connected) {
        try {
          const res = await fetch(`${normalizeBaseUrl(ep.address)}/zeroexo/h3/health`);
          if (res.ok) {
            const h = (await res.json()) as { ok?: boolean; queue?: { running?: number | null; pending?: number | null } };
            if (h.ok && h.queue) queueBusy = (h.queue.running ?? 0) + (h.queue.pending ?? 0) > 0;
          }
        } catch { /* 桥接未装/未开 CORS → 回退 /queue */ }
        if (queueBusy === null) {
          try {
            const res = await fetch(`${normalizeBaseUrl(ep.address)}/queue`);
            if (res.ok) {
              const q = (await res.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
              queueBusy = (q.queue_running?.length ?? 0) + (q.queue_pending?.length ?? 0) > 0;
            }
          } catch { /* 跨域/未连上 → queueBusy 保持 null，按不可探测处理 */ }
        }
      }
      const { demotedIds } = reconcileStaleGenerating({
        shots: shotsRef.current.map((s) => ({ id: s.id, status: s.status })),
        runPhase: comfyRun.phase,
        queueBusy,
      });
      if (demotedIds.length > 0) {
        for (const id of demotedIds) updateShot(id, { status: 'interrupted' });
        message.info(t('director.staleGeneratingDemoted', '上次生成已中断，可重新生成'));
      }
    })();
  }, [loadState, comfyRun.phase, updateShot, message, t]);

  /* 2026-11-05 统一导航入口（navigate-to-view）：「发送到导演台」→ 选中对应片段并滚动可见、右侧预览跟随。
     双通道接收：已挂载时收 NAVIGATE_FOCUS_SHOT_EVENT；刚切页签未挂载时 mount 取 pendingFocus。 */
  useEffect(() => {
    const focusShot = (shotId: string | undefined) => {
      if (!shotId) return;
      if (!shotsRef.current.some((s) => s.id === shotId)) return; // 段不存在（已删/未建）→ 不动当前选中
      setActiveShotId(shotId);
      // 目标内容渲染出来后再滚动（切页签后首帧可能尚未挂 DOM）
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-clip-id="${shotId}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      });
    };
    const onEvent = (e: Event) => focusShot((e as CustomEvent<NavigateFocusPayload>).detail?.shotId);
    window.addEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onEvent);
    const pending = takePendingNavigateFocus();
    if (pending?.shotId) focusShot(pending.shotId);
    return () => window.removeEventListener(NAVIGATE_FOCUS_SHOT_EVENT, onEvent);
  }, []);

  /** 预检页「确认运行」：真实提交（组装包 → /pack → /run → 轮询），预检摘要语义保留 */
  const confirmDryRun = useCallback(() => {
    if (!dryRun) return;
    const size = resolveVideoSize(
      String(sharedParamsRef.current.params['aspect'] ?? '16:9'),
      Number(sharedParamsRef.current.params['scaleFactor'] ?? 1),
    );
    void comfyRun.startRun({
      selectedIds: dryRun.selectedIds,
      shots: shotsRef.current.map(toRunShot).map((s) =>
        dryRun.continuationOff.has(s.id) ? { ...s, continuation: { enabled: false } } : s,
      ),
      shared: sharedParamsRef.current,
      tier: sharedParamsRef.current.presetId,
      width: size.width,
      height: size.height,
      projectId: projectId ?? 'workbench',
      episode: `${projectId ?? 'workbench'}-E01`,
      subjectCoverOf: (subjectId: string) => {
        const subject = subjects.find((s) => s.id === subjectId);
        return subject ? resolveSubjectCover(subject).key : null;
      },
    });
    setDryRun(null);
    if (trackMode === 'batch') exitBatchMode();
  }, [dryRun, comfyRun, subjects, projectId, trackMode, exitBatchMode]);

  /* 2026-11-04 拖拽 hover 高亮配套：导演台单轨 drop = 重排（落点判定与 hover 同为 computeInsertIndex） */
  const handleMoveShotBetweenTracks = useCallback(
    (_fromTrackId: string, _toTrackId: string, insertIndex: number, shotId: string) => {
      const current = shotsRef.current;
      const from = current.findIndex((s) => s.id === shotId);
      if (from < 0) return;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      // insertIndex 语义 = computeInsertIndex（含自身数组的插入前下标）→ 移除自身后需折算
      const adjusted = insertIndex > from ? insertIndex - 1 : insertIndex;
      next.splice(Math.max(0, Math.min(next.length, adjusted)), 0, moved!);
      setShots(next.map((s, i) => ({ ...s, number: i + 1 })));
      markDirty();
    },
    [markDirty],
  );

  /**
   * 删除把关（2026-11-04 约定：删除后不得少于 1 个片段）：单删/批量删/快捷键统一走这里——
   * 删除后不足 1 个片段时拒绝并轻提示（沿用 workbench.keepAtLeastOneClip 语义，
   * 与出片页 workbench-sheet 同款）；通过时才真正删除并重排序号。
   */
  const guardDeleteShots = useCallback(
    (shotIds: string[]) => {
      const current = shotsRef.current;
      if (current.length - shotIds.length < 1) {
        message.warning(t('workbench.keepAtLeastOneClip', '至少保留一个片段'));
        return;
      }
      const drop = new Set(shotIds);
      setShots(current.filter((s) => !drop.has(s.id)).map((s, i) => ({ ...s, number: i + 1 })));
      markDirty();
    },
    [markDirty, message, t],
  );

  const handleDeleteShot = useCallback(
    (shotId: string) => guardDeleteShots([shotId]),
    [guardDeleteShots],
  );

  // 单轨镜像（渲染用；持久化镜像在 persist 内重建）
  const track = useMemo<WorkbenchTrack>(() => {
    let start = 0;
    return {
      id: 'track-main',
      name: '主轨',
      sourceChain: { origin: 'workbench-container' },
      status: 'active',
      order: 0,
      clips: shots.map((s) => {
        const durationMs = Math.round(s.duration * 1000);
        const clip = {
          ref: { sourceShotId: s.id, kind: 'shot' as const },
          timeline: { startMs: start, durationMs },
        };
        start += durationMs;
        return clip;
      }),
    };
  }, [shots]);

  const data = useMemo<WorkbenchNodeData>(
    () => ({
      status: 'ready',
      shots,
      tracks: [track],
      totalDuration: shots.reduce((sum, s) => sum + s.duration, 0),
      completedCount: shots.filter((s) => s.status === 'done').length,
    }),
    [shots, track],
  );

  // 活动轨渲染源（根因修复）：WorkbenchMultiTrack 对活动轨取 timeline.shots——
  // 必须与 tracks/data 由同一份实体 shots 派生，否则活动轨渲染 0 个片段
  // 2026-11-05 六态徽标：透传 comfyRun 运行态（排队/已取消派生 + 运行中未轮到=排队）
  const timelineClips = useMemo<TimelineClipData[]>(
    () => shots.map((s) => toTimelineClip(s, firstFrameUrls, {
      phase: comfyRun.phase,
      segmentShotIds: comfyRun.segmentShotIds,
      currentSegment: comfyRun.currentSegment,
    })),
    [shots, firstFrameUrls, comfyRun.phase, comfyRun.segmentShotIds, comfyRun.currentSegment],
  );

  const selectedShot = shots.find((s) => s.id === activeShotId) ?? shots[0];
  const selectedShotIndex = selectedShot ? shots.findIndex((s) => s.id === selectedShot.id) : 0;

  // 2026-11-05 固定宽度卡片（220px 基准修订）：WorkbenchMultiTrack 实测导轨容器宽度后回传最终
  // 卡片宽（220/180/160 降级；初始 = 基准 220）。覆盖层（箭头/勾选块/引导缩略）与卡片同 pitch 铺排。
  const [directorCardWidth, setDirectorCardWidth] = useState<number>(DIRECTOR_CARD_WIDTH_BASE);
  const directorCardPitch = directorCardWidth + DIRECTOR_CARD_GAP;
  /** 2026-11-05 参考图修订：卡片高度（缩略框 + 标签行），衔接箭头据此垂直居中 */
  const directorCardHeightPx = directorCardHeight(directorCardWidth);
  /** hover 命中哪条衔接箭头：仅 hover 的箭头 opacity 回 1，静息按主题 token */
  const [hoveredArrowId, setHoveredArrowId] = useState<string | null>(null);

  // ===== 段间衔接标记 =====
  // 2026-11-05 图标重做：旧的 ⇄ 双向箭头在时间轴上语义不对（衔接有方向：前段 → 本段），
  // 且两条对称箭头在小尺寸下显拥挤。现改为「起点圆点 + 连接线 + 单箭头」：
  // 圆点落在前段一侧、箭头指向本段，读起来就是“延续过去”。
  // 占位 34×22 不变（交界间隙中心 + 卡片垂直居中），不随卡片 220/180/160 档位变化。
  // x = 下标×pitch − 间隙/2 − 占位半宽(17)；y = 卡片顶 + 卡片高/2 − 占位半高(11)。
  const continuityArrows = useMemo(() => {
    const items: Array<{ id: string; x: number; fromNo: number; toNo: number }> = [];
    shots.forEach((s, i) => {
      // 2026-11-04 链接模式草稿：模式内箭头按草稿实时渲染（取消回滚后恢复持久态）
      // 2026-11-05 固定宽度片段卡片：交界 x = 卡片下标 × pitch（随容器 220/180/160）
      if (i > 0 && continuityOn(s, i)) {
        items.push({ id: s.id, x: i * directorCardPitch, fromNo: shots[i - 1]!.number, toNo: s.number });
      }
    });
    if (items.length === 0) return null;
    const arrowTone = directorArrowTone(theme.mode === 'dark');
    const arrowTop = TRACK_CLIP_TOP + directorCardHeightPx / 2 - DIRECTOR_ARROW_SIZE.height / 2;
    return (
      <div data-director-continuity-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
        {items.map((it) => {
          const hovered = hoveredArrowId === it.id;
          return (
            <span
              key={`joint-${it.id}`}
              data-continuity-arrow={it.id}
              data-continuity-arrow-hovered={hovered ? 'true' : 'false'}
              title={t('workbench.multitrack.jointTip', '段间衔接：片段 {{from}} → 片段 {{to}}', { from: it.fromNo, to: it.toNo })}
              onMouseEnter={() => setHoveredArrowId(it.id)}
              onMouseLeave={() => setHoveredArrowId((prev) => (prev === it.id ? null : prev))}
              style={{
                position: 'absolute',
                left: it.x - DIRECTOR_ARROW_SIZE.width / 2 - DIRECTOR_CARD_GAP / 2,
                top: arrowTop,
                width: DIRECTOR_ARROW_SIZE.width,
                height: DIRECTOR_ARROW_SIZE.height,
                opacity: hovered ? 1 : arrowTone.opacityRest,
                // 2026-11-06 用户指令：箭头改项目同款深色胶囊（底 + 细描边 + 圆角 + 阴影），
                // 绿色 glyph / 34×22 占位 / hover 透明度契约全部保留；border-box 保证加边不撑大命中区
                boxSizing: 'border-box',
                background: arrowTone.surface,
                border: `1px solid ${hovered ? arrowTone.hoverBorder : arrowTone.border}`,
                borderRadius: 5,
                boxShadow: hovered ? arrowTone.hoverShadow : arrowTone.shadow,
                transition: 'opacity 0.12s, border-color 0.12s, box-shadow 0.12s',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'auto',
              }}
            >
              <svg
                width={DIRECTOR_ARROW_GLYPH.width}
                height={DIRECTOR_ARROW_GLYPH.height}
                viewBox={`${-DIRECTOR_ARROW_GLYPH.width / 2} ${-DIRECTOR_ARROW_GLYPH.height / 2} ${DIRECTOR_ARROW_GLYPH.width} ${DIRECTOR_ARROW_GLYPH.height}`}
                aria-hidden="true"
              >
                {/* 连接线 + 右向箭头头 */}
                <path d="M -6.5 0 L 6 0 M 2.6 -3.4 L 6 0 L 2.6 3.4"
                  fill="none" stroke={arrowTone.glyph} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                {/* 起点：前段一侧的实心圆点 */}
                <circle cx="-8.6" cy="0" r="1.7" fill={arrowTone.glyph} />
              </svg>
            </span>
          );
        })}
      </div>
    );
  }, [shots, t, continuityOn, directorCardPitch, directorCardHeightPx, hoveredArrowId, theme.mode]);

  // ===== 批量勾选层（2026-11-04 批量复用 dry-run 预检） =====
  // 勾选来源 = 轨道行：批量模式下每个片段左上叠一个勾选块（绝对定位纯视觉，不挤布局），
  // 点勾选块或点片段本体都切换同一份 runSelection；模式外零渲染。
  // 2026-11-05 用户指令：勾选（=选中态）不再用绿色 #00c758，改中性亮色；
  // 绿色只保留给「段间衔接」语义标记（箭头）。
  const batchCheckOverlay = useMemo(() => {
    if (trackMode !== 'batch') return null;
    const items: Array<{ id: string; x: number; checked: boolean }> = [];
    // 2026-11-05 固定宽度片段卡片：勾选块 x = 卡片下标 × pitch（等宽卡片铺排，随容器 220/180/160）
    shots.forEach((s, i) => {
      items.push({ id: s.id, x: i * directorCardPitch, checked: runSelection.has(s.id) });
    });
    const darkRail = theme.mode === 'dark';
    const checkOn = darkRail ? 'rgba(226,232,240,0.88)' : 'rgba(68,64,60,0.75)';
    return (
      <div data-director-batch-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
        {items.map((it) => (
          <button
            key={`check-${it.id}`}
            type="button"
            data-clip-check={it.id}
            data-checked={it.checked ? 'true' : 'false'}
            aria-pressed={it.checked}
            title={t('workbench.multitrack.batch', '批量')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); toggleRunSelection(it.id); }}
            style={{
              position: 'absolute', left: it.x + 4, top: 9, width: 13, height: 13,
              padding: 0, borderRadius: 3, pointerEvents: 'auto', cursor: 'pointer',
              border: `1.5px solid ${it.checked ? checkOn : 'rgba(128,128,128,0.9)'}`,
              background: it.checked ? checkOn : 'rgba(0,0,0,0.35)',
              color: darkRail ? '#111418' : '#ffffff', fontSize: 10, lineHeight: '10px', textAlign: 'center',
            }}
          >
            {it.checked ? '✓' : ''}
          </button>
        ))}
      </div>
    );
  }, [trackMode, shots, runSelection, toggleRunSelection, t, directorCardPitch, theme.mode]);

  // ===== 引导缩略层（2026-11-05 真实运行）：段 N≥2 的卡片左上叠前段尾部 22 帧动画 WebP =====
  // 数据 = GET /zeroexo/h3/guidance?jobId=&segment=N（data URI）；404 → 灰块「…」+ title 未就绪，不报错。
  // 挂在该段卡片左缘（与衔接箭头同 x、箭头下方），仅运行期间渲染。
  const guidanceOverlay = useMemo(() => {
    const guidanceEntries = Object.entries(comfyRun.guidance);
    if (guidanceEntries.length === 0) return null;
    const items: Array<{ segNo: number; x: number; image: string | null }> = [];
    // 2026-11-05 固定宽度片段卡片：引导缩略 x = 卡片下标 × pitch（等宽卡片铺排，随容器 220/180/160）
    shots.forEach((s, i) => {
      const segNo = comfyRun.segmentShotIds.indexOf(s.id) + 1;
      if (segNo >= 2) {
        const g = comfyRun.guidance[segNo];
        if (g) items.push({ segNo, x: i * directorCardPitch, image: g.image });
      }
    });
    if (items.length === 0) return null;
    return (
      <div data-director-guidance-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
        {items.map((it) => (
          <span
            key={`guide-${it.segNo}`}
            data-guidance-chip={it.segNo}
            title={it.image
              ? t('director.guidanceTip', '第 {{n}} 段引导：前段尾部 22 帧动画', { n: it.segNo })
              : t('director.guidanceNotReady', '引导未就绪')}
            style={{
              position: 'absolute', left: it.x + 24, top: 20, width: 48, height: 28,
              borderRadius: 4, overflow: 'hidden', background: 'rgba(15,23,42,0.9)',
              border: '1px solid rgba(0,199,88,0.55)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {it.image ? (
              <img src={it.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 9, color: '#9ca3af' }}>···</span>
            )}
          </span>
        ))}
      </div>
    );
  }, [comfyRun.guidance, comfyRun.segmentShotIds, shots, t, directorCardPitch]);

  // 注入活动轨 clip 内容层的覆盖物：衔接箭头（常显）+ 批量勾选块（仅批量模式）+ 引导缩略（运行期）
  const railContentOverlay = useMemo(
    () => (continuityArrows || batchCheckOverlay || guidanceOverlay
      ? <>{continuityArrows}{batchCheckOverlay}{guidanceOverlay}</>
      : null),
    [continuityArrows, batchCheckOverlay, guidanceOverlay],
  );

  if (!isActive) return null;

  // 容器未就绪：渲染加载提示，不白屏、不显示任何占位状态文案
  if (loadState !== 'ready' || !selectedShot) {
    return (
      <CanvasTabContentBoundary>
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: theme.toolbar.textMuted, fontSize: 13,
          }}
        >
          {loadState === 'error'
            ? t('canvasTab.workbenchLoadError', '导演台读取失败，请重新打开页签')
            : t('canvasTab.workbenchLoading', '正在加载导演台…')}
        </div>
      </CanvasTabContentBoundary>
    );
  }

  const isDark = theme.mode === 'dark';

  return (
    <CanvasTabContentBoundary>
      <div data-workbench-page style={{ position: 'absolute', inset: 0 }}>
        <StoryboardMergedTab
          entities={[]}
          showAssetSidebar={false}
          /* 2026-11-05 参考图修订：导演台导轨高度固定，删除高度拖拽分割手柄 */
          railHeightFixed
          /* 2026-11-04 第七条A：导演台初始 提示词:预览 = 3:1（其余页面仍用组件默认 0.44）；
             用户拖拽后的比例按项目持久化，下次进入沿用 */
          promptRatioDefault={0.75}
          promptRatioStorageKey={`zerovideo.director.promptRatio:${projectId}`}
          videoStageProps={{
            // 有产物就允许播放（不依赖 clipState：恢复/导入/旧数据可能只写了 media）
            videoStorageKey: selectedShot.media?.storageKey,
            videoStatus: selectedShot.media?.storageKey ? 'done' : 'idle',
            /* 2026-11-04 第十二条：预览占位只显示状态（单行文案+小图标），不回显提示词；
               状态跟随当前激活片段（selectedShot 切换即联动）。
               未生成 / 生成中（·detail 预留，dry-run 阶段无真实进度）/ 已生成 · Ns / 生成失败（+原因一行）。 */
            placeholderStatus:
              selectedShot.status === 'done'
                ? 'done'
                : selectedShot.status === 'generating'
                  ? 'generating'
                  : selectedShot.status === 'failed'
                    ? 'failed'
                    : 'idle',
            /* 2026-11-05 真实运行：detail 反映桥接作业进度（排队位置 / 第 N 段 / 取消保留 N 段），
               已完成段回落时长标签；错误时透传上游人话一行 */
            placeholderDetail: (() => {
              if (comfyRun.phase === 'error' && comfyRun.error) return comfyRun.error;
              if (comfyRun.phase === 'canceled' && comfyRun.canceledKept !== null) {
                return t('director.runCanceledKept', { n: comfyRun.canceledKept });
              }
              if (selectedShot.status === 'generating') {
                if (comfyRun.phase === 'submitting') return t('director.runUploading');
                if (comfyRun.phase === 'queued') {
                  return comfyRun.queueNumber !== null
                    ? t('director.runQueuedAt', { n: comfyRun.queueNumber })
                    : t('director.runQueuedPlain');
                }
                if (comfyRun.phase === 'running' && comfyRun.currentSegment !== null) {
                  return t('director.runSegmentProgress', {
                    n: comfyRun.currentSegment,
                    total: comfyRun.totalCount,
                  });
                }
                return undefined;
              }
              if (selectedShot.status === 'done') return `${selectedShot.duration}s`;
              return undefined;
            })(),
            /* 2026-11-05 实时预览：直连 /ws 帧按 ≤10fps 刷新在占位卡上（badge 带步进/段号）；
               OpenAI 兼容渠道无 ws → 只标「仅进度」，不假装实时帧 */
            livePreview:
              (comfyRun.phase === 'running' || comfyRun.phase === 'queued') && comfyRun.preview?.image
                ? {
                    image: comfyRun.preview.image,
                    step: comfyRun.preview.step,
                    totalSteps: comfyRun.preview.totalSteps,
                    segmentIndex: comfyRun.preview.segmentIndex,
                  }
                : null,
            progressOnly:
              selectedShot.status === 'generating' &&
              (comfyRun.phase === 'queued' || comfyRun.phase === 'running') &&
              !comfyRun.preview?.image &&
              !comfyRun.livePreviewSupported,
            /* 2026-11-04 参数合并：预览区只读文字标签（公共参数，随比例/系数实时更新），
               格式「16:9 · 1512×840」；裸控件已收进导轨「参数」浮层面板 */
            paramsLabel: (() => {
              const aspect = String(sharedParams.params['aspect'] ?? '16:9');
              const size = resolveVideoSize(aspect, Number(sharedParams.params['scaleFactor'] ?? 1));
              return `${aspect} · ${size.width}×${size.height}`;
            })(),
          }}
          multitrackProps={{
            tracks: [track],
            data,
            focusedTrackId: track.id,
            onFocusTrack: () => {},
            // 内容层覆盖物：衔接箭头（常显）+ 批量勾选块（仅批量模式）；与片段同滚动/transform/pps
            contentOverlay: railContentOverlay,
            // 模式条：链接=全选/取消全选+完成(落盘)/取消(回滚)+已选 M/M；批量=生成(开预检)/取消(清空勾选)+已选计数
            selectMode: trackMode === 'continuity'
              ? {
                  kind: 'continuity',
                  count: Object.values(continuityDraft ?? {}).filter(Boolean).length,
                  total: Object.keys(continuityDraft ?? {}).length,
                  allSelected: Object.keys(continuityDraft ?? {}).length > 0
                    && Object.values(continuityDraft ?? {}).every(Boolean),
                  onSelectAll: selectAllContinuity,
                  onDone: commitContinuityMode,
                  onCancel: cancelContinuityMode,
                }
              : trackMode === 'batch'
                ? {
                    kind: 'batch',
                    count: runSelection.size,
                    onDone: openBatchPreflight,
                    onCancel: exitBatchMode,
                  }
                : null,
            continuityEntry: {
              active: trackMode === 'continuity',
              // 2026-11-04：再点「链接」退出 = 取消语义（回滚草稿），与 Esc 一致
              onToggle: () => (trackMode === 'continuity' ? cancelContinuityMode() : enterContinuityMode()),
            },
            // 2026-11-04 批量复用 dry-run 预检：「批量」= 轨道勾选模式开关（勾选在轨道行，
            // 「生成」进入与「运行选中」同一个 dry-run 预检页，确认/运行都在预检页完成）
            batchEntry: {
              active: trackMode === 'batch',
              onToggle: () => (trackMode === 'batch' ? exitBatchMode() : setTrackMode('batch')),
            },
            clipLabelMode: 'director',
            // 2026-11-04 导演台导轨零基线：去白色竖线（聚焦轨 borderLeft）+ 片段起点=刻度 0
            // + 横向滚动统一外层容器
            zeroBaseRail: true,
            // 2026-11-05 220px 卡片修订：接收 multitrack 实测容器后的最终卡片宽，覆盖层与卡片同 pitch
            onDirectorCardWidthChange: setDirectorCardWidth,
            /* 2026-11-05 参考图修订：缩略框中央播放键 = 打开右侧预览并切到该段 */
            onDirectorPlay: setActiveShotId,
            // 拖拽（2026-11-04 实时预览，project-rules/specs/director-h3-workspace/drag-spec.md）：
            // 幽灵跟手 + 预览顺序实时让位 + 整段占位框；中点判定 ±8px 容差；drop 提交唯一一次
            onMoveShotBetweenTracks: handleMoveShotBetweenTracks,
            // 2026-11-04 参数合并（约定）+ 2026-11-05 二调（参数按钮无外边线、批量置于运行左侧）：
            // 裸控件收进「参数」浮层面板（无边框）；工具行顺序 = 添加/链接/删除/参数/批量/运行；
            // 全界面唯一一份，提示词面板不再渲染
            paramsButton: (
              <>
                <DirectorParamsButton
                  shared={sharedParams}
                  onSharedChange={updateSharedParams}
                  subColor={theme.toolbar.textMuted}
                  textColor={theme.toolbar.text}
                />
                <button
                  type="button"
                  data-director-versions
                  onClick={() => void openVersions()}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, height: 25, padding: '0 8px',
                    borderRadius: 5, fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap', cursor: 'pointer',
                    border: 0, outline: 'none', boxShadow: 'none', background: 'transparent', color: theme.toolbar.text,
                  }}
                >
                  <History size={12} />
                  {t('director.versions', '版本')}
                </button>
              </>
            ),
            runButton: (
              <>
                {/* 2026-11-05 真实运行：运行中显示「取消」（POST /zeroexo/h3/cancel），
                    完成态显示摘要一行（排队位置 / 第 N 段 / 成功 N/M / 已保留 N 段） */}
                {runPhaseActive && (
                  <Button
                    size="small"
                    danger
                    onClick={() => void comfyRun.cancel()}
                    aria-label={t('director.cancelRun')}
                  >
                    {t('director.cancelRun')}
                  </Button>
                )}
                {comfyRun.phase === 'success' && (
                  <span style={{ fontSize: 11, color: '#52c41a' }}>
                    {t('director.runDoneCount', { n: comfyRun.doneCount, total: comfyRun.totalCount })}
                  </span>
                )}
                {comfyRun.phase === 'canceled' && comfyRun.canceledKept !== null && (
                  <span style={{ fontSize: 11, color: '#faad14' }}>
                    {t('director.runCanceledKept', { n: comfyRun.canceledKept })}
                  </span>
                )}
                {comfyRun.phase === 'error' && comfyRun.error && (
                  <span style={{ fontSize: 11, color: '#ff4d4f', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={comfyRun.error}>
                    {comfyRun.error}
                  </span>
                )}
                <DirectorRunButton
                  runDisabled={!selectedShot || runPhaseActive}
                  onRun={() => handleRun([selectedShot.id])}
                  accentColor={theme.toolbar.accent}
                />
              </>
            ),
          }}
          timelineProps={{
            // 根因修复：活动轨渲染的就是这份 clips（不是空数组），与 tracks/data 同一实体源
            shots: timelineClips,
            activeShotId: selectedShot.id,
            pixelsPerSecond,
            onPixelsPerSecondChange: setPixelsPerSecond,
            // 链接模式内点击片段 = 切换其段间引导（段1 恒关）；批量模式 = 切换勾选；否则正常选中
            onSelectShot: (shotId: string) =>
              trackMode === 'continuity'
                ? toggleShotContinuity(shotId)
                : trackMode === 'batch'
                  ? toggleRunSelection(shotId)
                  : setActiveShotId(shotId),
            onInsertAt: handleInsertAt,
            // 2026-11-05 导演台：不接 onTrim（时长不可拖拽，只来自参数）
            // 单删/批量删统一经 guardDeleteShots 把关：剩最后一个拒绝并轻提示（删不准到 0）
            onDeleteShot: handleDeleteShot,
            onDeleteShots: guardDeleteShots,
            // 分割/合并不接线（undefined）
          }}
          promptPanelOverride={
            <DirectorPromptPanel
              shared={sharedParams}
              onSharedChange={updateSharedParams}
              shot={selectedShot}
              shotIndex={selectedShotIndex}
              totalShots={shots.length}
              // 2026-11-06 标题区镜头跳转胶囊：与导轨/预览共用 activeShotId 单一受控源，
              // 面板内不自建序号状态（受控组件复用铁律）
              onPrevShot={() => setActiveShotId(shots[Math.max(0, selectedShotIndex - 1)]!.id)}
              onNextShot={() => setActiveShotId(shots[Math.min(shots.length - 1, selectedShotIndex + 1)]!.id)}
              onShotChange={(patch) => updateShot(selectedShot.id, patch)}
              theme={theme}
              isDark={isDark}
              subjects={subjects}
              subjectTrees={subjectTrees}
              // 2026-11-05 方案 C：主体列表按「出现集数」排序（命中本集/未标注前、其它集后）
              episodeContext={episodeContext}
              // 2026-11-05 全局化：ComfyUI 地址只在顶栏配置，导演台不再重复挂连接入口
              // 2026-11-04 参数区搬家：比例/系数/尺寸/运行整组移到导轨工具行（paramsButton/runButton），
              // 本面板不再渲染参数行；批量唯一入口 = 导轨工具栏 batchEntry（onRunAll 已删除）。
            />
          }
          theme={theme}
          isDark={isDark}
        />
        {/* 版本操作确认：走项目统一 ConfirmDialog（主题 + zIndex，不用静态 Modal.confirm） */}
        <ConfirmDialog
          open={versionConfirm !== null}
          title={versionConfirm?.kind === 'delete'
            ? t('director.deleteVersionTitle', '删除这个版本？')
            : t('director.restoreVersionTitle', '恢复到这个版本？')}
          confirmLabel={versionConfirm?.kind === 'delete'
            ? t('director.deleteVersionOk', '删除')
            : t('director.restoreVersionOk', '恢复')}
          cancelLabel={t('director.restoreVersionCancel', '取消')}
          danger={versionConfirm?.kind === 'delete'}
          zIndex={21000}
          onConfirm={() => void applyVersionConfirm()}
          onClose={() => setVersionConfirm(null)}
        >
          {versionConfirm?.kind === 'delete'
            ? t('director.deleteVersionBody', '只删除这份历史快照，当前内容不受影响。')
            : t('director.restoreVersionBody', '当前内容会先自动存一份快照，恢复后可再次切换回来。')}
        </ConfirmDialog>
        {/* 版本（快照）面板：workbench 每次写盘自动落 pre-save/auto 快照，可查看/恢复 */}
        <Modal
          open={versionsOpen}
          onCancel={() => setVersionsOpen(false)}
          centered
          width={560}
          footer={null}
          title={t('director.versionsTitle', '版本记录')}
        >
          {versions === null ? (
            <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
              {t('director.versionsLoading', '加载中…')}
            </div>
          ) : versions.length === 0 ? (
            <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
              {t('director.versionsEmpty', '还没有版本记录，修改片段后会自动生成')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
              {versions.map((v) => {
                const reasonText = v.reason === 'auto' ? t('director.versionReasonAuto', '自动')
                  : v.reason === 'pre-save' ? t('director.versionReasonPreSave', '保存前')
                  : v.reason === 'manual' ? t('director.versionReasonManual', '手动')
                  : t('director.versionReasonPreRestore', '恢复前');
                return (
                  <div
                    key={v.fileName}
                    data-version-row={v.fileName}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderRadius: 8, border: '1px solid rgba(128,128,128,0.25)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{new Date(v.createdAt).toLocaleString()}</div>
                      <div style={{ fontSize: 11, opacity: 0.6 }}>
                        {reasonText} · {t('director.versionShots', { n: (v.entity?.shots ?? []).length, defaultValue: '{{n}} 个片段' })}
                        {typeof v.entity?.totalDuration === 'number' ? ` · ${v.entity.totalDuration.toFixed(1)}s` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-version-delete={v.fileName}
                      onClick={() => void deleteVersion(v)}
                      title={t('director.deleteVersionOk', '删除')}
                      style={{
                        height: 26, width: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(128,128,128,0.35)',
                        background: 'transparent', color: 'inherit', padding: 0,
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                    <button
                      type="button"
                      data-version-restore={v.fileName}
                      onClick={() => void restoreVersion(v)}
                      style={{
                        height: 26, padding: '0 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit',
                      }}
                    >
                      {t('director.versionRestore', '恢复')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
        {/* 运行预检（2026-11-05 起确认 = 真实提交）：槽位表 / 每段帧数 / 延续关系 / 本次断开的衔接；
            「确认运行」→ 组装导演包 → POST /zeroexo/h3/pack → /run → 轮询落库。
            2026-11-04 批量复用：批量「生成」与「运行选中」打开的是同一个预检弹层（同一组件同一渲染）。 */}
        <Modal
          open={dryRun !== null}
          onCancel={() => setDryRun(null)}
          // 2026-11-05 用户指令：所有弹层屏幕居中（antd Modal 默认 top:100px）
          centered
          width={680}
          title={t('director.dryRunTitle', '确认生成')}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                type="button"
                data-dry-run-cancel
                onClick={() => setDryRun(null)}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit',
                }}
              >
                {t('director.dryRunBack', '返回')}
              </button>
              {/* 2026-11-04 文案微调（约定）：主按钮只写「确认运行」；dry-run 说明移到正文信息条 */}
              <button
                type="button"
                data-dry-run-confirm
                onClick={confirmDryRun}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                  border: 'none', background: '#00c758', color: '#fff', fontWeight: 600,
                }}
              >
                {t('director.dryRunConfirm', '开始生成')}
              </button>
              </div>
            </div>
          }
        >
          {dryRun && (
            <div data-director-dry-run style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 客户向文案：只说「生成几个片段、共多少秒、点了会发生什么」，不暴露 pack/timeline/槽位/帧预算 */}
              <div data-dry-run-note style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.30)', color: 'inherit' }}>
                {t('director.dryRunNote', {
                  count: dryRun.summary.segments.length,
                  seconds: Math.max(1, Math.round(dryRun.summary.segments.reduce((sum, seg) => sum + seg.frames, 0) / DIRECTOR_FPS)),
                  defaultValue: '本次将生成 {{count}} 个片段，共约 {{seconds}} 秒。点「开始生成」提交到本机 ComfyUI 真实生成。',
                })}
              </div>
              {dryRun.summary.issues.length > 0 && (
                <div data-dry-run-issues style={{ padding: 8, borderRadius: 8, background: 'rgba(250,173,20,0.10)', border: '1px solid rgba(250,173,20,0.35)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {t('director.dryRunIssues', '还有 {{count}} 项没准备好', { count: dryRun.summary.issues.length })}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {dryRun.summary.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
                  </ul>
                </div>
              )}
              {/* 不连续勾选且开启引导时：只说明本次哪两段不衔接，不改持久设置 */}
              {dryRun.disconnects.length > 0 && (
                <div data-dry-run-disconnect style={{ padding: 8, borderRadius: 8, background: 'rgba(0,199,88,0.08)', border: '1px solid rgba(0,199,88,0.30)' }}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {dryRun.disconnects.map((d) => (
                      <li key={`${d.fromNo}-${d.toNo}`} data-dry-run-disconnect-item>
                        {t('director.dryRunDisconnectItem', '片段 {{from}} 与片段 {{to}} 不相邻，本次不启用衔接', { from: d.fromNo, to: d.toNo })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dryRun.summary.segments.map((seg) => (
                  <div
                    key={seg.id}
                    data-dry-run-segment
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.25)',
                    }}
                  >
                    <span>{t('director.dryRunSegmentRow', '片段 {{n}}', { n: seg.number })}</span>
                    <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
                      {t('director.dryRunSeconds', '{{seconds}} 秒', { seconds: Math.max(0.2, Math.round((seg.frames / DIRECTOR_FPS) * 10) / 10) })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </CanvasTabContentBoundary>
  );
}
