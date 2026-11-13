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
import { App, Button, Checkbox, Modal, Select } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { History, Link2, Link2Off, Palette, Star, Trash2, Play, Square } from 'lucide-react';
import { ConfirmDialog } from '@/shared/components/confirm-dialog.js';
import { useCanvasTabStore } from './canvas-tab-store.js';
import { useViewPrefsStore } from '@/shared/view-prefs.js';
import { useMcpDirectorJobs } from '@/features/mcp-director-jobs/use-mcp-director-jobs.js';
import {
  UNASSIGNED_EPISODE_KEY, groupShotsByEpisode, orderEpisodeKeys,
} from '@/features/canvas-nodes/storyboard/workbench-episodes.js';
import { StyleGalleryDialog } from '@/features/canvas-nodes/storyboard/style-gallery-dialog.js';
import { stylePresetPrompt, type StylePreset } from '@/shared/style-presets.js';
import { styleShotGuide } from '@/shared/style-shot-guides.js';
import { CanvasTabContentBoundary } from './CanvasTabContentBoundary.js';
import {
  ensureWorkbenchContainer,
  readStoryboardContainer,
  readWorkbenchContainer,
  snapshotWorkbenchForRun,
  updateWorkbenchContainer,
  type WorkbenchContainer,
  type WorkbenchSharedParams,
} from '@/entities/slot-containers.js';
import {
  SNAPSHOT_KEEP_COUNT,
  deleteSnapshotFile,
  listSnapshots,
  pruneDuplicateSnapshots,
  restoreSnapshot,
  setSnapshotFavorite,
  type SnapshotListItem,
} from '@/entities/snapshot-store.js';
import {
  DIRECTOR_FPS,
  DIRECTOR_PRESETS,
  rebaseShotsForSharedChange,
  resolveVideoSize,
  segmentContinuityEnabled,
  type DirectorAssetRef,
  type RunShotLike,
} from '@/entities/director-params.js';
import { resolveSubjectCover } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import { StoryboardMergedTab } from '@/features/canvas-nodes/storyboard/storyboard-merged-tab.js';
/* 2026-11-04 批量复用 dry-run 预检：DirectorBatchPanel（独立简化勾选页）已删除——
   勾选在轨道行、确认/运行收敛到 dry-run 预检，不留两套并行 UI */
import type { TimelineClipData } from '@/features/canvas-nodes/storyboard/timeline-constants.js';
import { DIRECTOR_ARROW_SIZE, DIRECTOR_CARD_GAP, DIRECTOR_CARD_WIDTH_BASE, TRACK_CLIP_TOP, directorArrowTone, directorCardHeight } from '@/features/canvas-nodes/storyboard/timeline-constants.js';
import type { ProductionItem } from '@/features/canvas-nodes/production-manager/production-manager-types.js';
import type { SubjectTree } from '@/features/canvas-nodes/storyboard/subject-tree-types.js';
import { readScript, watchScript, displayEpisodeTitle, type ScriptVisualStyle } from '@/entities/script-store.js';
import type {
  WorkbenchNodeData,
  WorkbenchShot,
  WorkbenchShotReference,
  WorkbenchTrack,
} from '@/features/canvas-nodes/storyboard/workbench-types.js';
import { WORKBENCH_ADD_REF_EVENT, WORKBENCH_SET_GUIDE_EVENT, type WorkbenchAddRefDetail, type WorkbenchSetGuideDetail } from './workbench-slot-bus.js';
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
    guide: s.guide ? { id: s.guide.id, frames: s.guide.frames, sha256: s.guide.sha256 } : undefined,
    // 2026-11-09：产物自带 guide 一起带进运行参数，重跑单段时才能接续上一段
    media: s.media?.guide ? { guide: { id: s.media.guide.id } } : undefined,
  };
}

/** 新建空片段（占位态：显示提示词输入器；默认 5 秒，与容器默认片段一致——2026-11-04 约定） */
function createSegment(number: number, episodeId?: string): WorkbenchShot {
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
    ...(episodeId ? { episodeId } : {}),
  };
}

/**
 * WorkbenchShot.status → 卡片六态徽标（2026-11-05 220px 卡片规格）：
 * 排队/已取消由运行态派生——排队 = 提交中/在队/运行中未轮到本段；已取消 = 运行取消且本段未完成。
 * 仅导演台路径调用；未生成/生成中/完成/失败直接透传。
 */
export function resolveClipStatus(
  status: WorkbenchShot['status'],
  run: { phase: string; segmentShotIds: readonly string[]; currentSegment: number | null; previewSegmentIndex?: number | null } | undefined,
  shotId: string,
): NonNullable<TimelineClipData['status']> {
  if (status === 'pending') return 'idle';
  if (status === 'done' || status === 'failed') return status;
  if (!run) return 'generating';
  const idx = run.segmentShotIds.indexOf(shotId);
  if (idx < 0) return 'idle';
  if (run.phase === 'canceled') return 'cancelled';
  // 插件已开始推实时帧，但作业状态可能还停在 queued：以帧的段号为准
  if (run.previewSegmentIndex && idx === run.previewSegmentIndex - 1) return 'generating';
  if (run.phase === 'submitting' || run.phase === 'queued') return 'queued';
  if (run.phase === 'running') {
    return run.currentSegment !== null && idx === run.currentSegment - 1 ? 'generating' : 'queued';
  }
  return 'generating';
}

/** WorkbenchShot → 时间轴 clip（与 workbench-multitrack.tsx byTrack 的转换逐项对齐，同一映射不两套） */
function toTimelineClip(s: WorkbenchShot, firstFrameUrls: Record<string, string> | undefined, run?: { phase: string; segmentShotIds: readonly string[]; currentSegment: number | null; previewSegmentIndex?: number | null }): TimelineClipData {
  return {
    id: s.id,
    number: s.number,
    duration: s.duration,
    status: s.clipState === 'completed' && s.media?.storageKey
      ? 'done'
      : resolveClipStatus(s.status, run, s.id),
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
  /** 版本多选（2026-11-07 用户指令：版本历史支持批量操作） */
  const [versionSelected, setVersionSelected] = useState<Set<string>>(new Set());
  const [versionBatchConfirmOpen, setVersionBatchConfirmOpen] = useState(false);
  const toggleVersionSelected = useCallback((fileName: string, checked: boolean): void => {
    setVersionSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(fileName); else next.delete(fileName);
      return next;
    });
  }, []);
  /** 片段列表（本地受控；防抖写回容器） */
  const [shots, setShots] = useState<WorkbenchShot[]>([]);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  /** 点击片段 = 右侧预览区立即从 0 播放（自增令牌；源异步解析后由预览组件起播） */
  const [previewAutoPlayKey, setPreviewAutoPlayKey] = useState(0);
  const selectShotAndPlay = useCallback((shotId: string) => {
    setActiveShotId(shotId);
    setPreviewAutoPlayKey((k) => k + 1);
  }, []);
  // 2026-11-04 约定（偏好记忆）：时间线缩放持久化到全局偏好 store——
  // 页签切换会卸载本组件，此前缩放只活在本地 useState，切走即回 40；现存 store，切回/刷新都保留
  const pixelsPerSecond = useViewPrefsStore((s) => s.workbench.pixelsPerSecond);
  const setPixelsPerSecond = useViewPrefsStore((s) => s.setWorkbenchPixelsPerSecond);
  /** 公共参数（受控；与 shots 同一防抖链路写回容器） */
  const [sharedParams, setSharedParams] = useState<WorkbenchSharedParams>(createDefaultSharedParams);
  /** 选择运行：勾选的片段 id 集合（唯一勾选状态源；只在批量模式期间存活） */
  const [runSelection, setRunSelection] = useState<ReadonlySet<string>>(new Set());
  // 旧预检弹层保留为不可达兜底（生成入口已改为直接提交，不再打开它）
  const [dryRun, setDryRun] = useState<{ summary: { segments: Array<{ id: string; number: number; frames: number }>; issues: Array<{ message: string }> }; disconnects: Array<{ fromNo: number; toNo: number }>; selectedIds: string[]; continuationOff: ReadonlySet<string> } | null>(null);
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
  const [visualStyle, setVisualStyle] = useState<ScriptVisualStyle | null>(null);
  const [styleGalleryOpen, setStyleGalleryOpen] = useState(false);
  const [episodeContext, setEpisodeContext] = useState<{
    activeEpisodeId: string | null;
    numberById: Record<string, number>;
    episodes: Array<{ id: string; number: number; title?: string }>;
  }>({ activeEpisodeId: null, numberById: {}, episodes: [] });
  /** dry-run 预检弹层：片段表 + pack 摘要 + 本次运行断开的衔接列表（执行按钮保留 dry-run 语义，不发起真实生成） */

  /** 片段选择面板（2026-11-07 统一生成入口：点"生成"弹出，默认勾选当前段，可全选/按需勾选） */
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [runPickerSelection, setRunPickerSelection] = useState<ReadonlySet<string>>(new Set());
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
    setVersionSelected(new Set());
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

  /** 星标收藏版本（2026-11-08）：收藏项跳过一切自动回收，且不占 30 份配额 */
  const toggleVersionFavorite = useCallback(async (snap: SnapshotListItem<WorkbenchContainer>): Promise<void> => {
    if (!projectId) return;
    const next = !snap.favorite;
    try {
      await setSnapshotFavorite(projectId, 'workbench', snap.fileName, next);
      setVersions((prev) => prev?.map((v) => (v.fileName === snap.fileName ? { ...v, favorite: next } : v)) ?? prev);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, message]);

  /** 删除某份版本（仅删该快照文件，不改当前内容） */
  const deleteVersion = useCallback((snap: SnapshotListItem<WorkbenchContainer>): void => {
    if (!projectId) return;
    setVersionConfirm({ kind: 'delete', snap });
  }, [projectId]);

  /** 批量删除选中的版本（只作用于勾选项） */
  const deleteSelectedVersions = useCallback(async (): Promise<void> => {
    if (!projectId || versionSelected.size === 0) return;
    setVersionBatchConfirmOpen(false);
    const names = [...versionSelected];
    let done = 0;
    let failed = 0;
    for (const fileName of names) {
      try {
        await deleteSnapshotFile(projectId, 'workbench', fileName);
        done += 1;
      } catch {
        failed += 1;
      }
    }
    setVersionSelected(new Set());
    const list = await listSnapshots<WorkbenchContainer>(projectId, 'workbench', { withSize: true }).catch(() => null);
    if (list) setVersions([...list].reverse());
    if (failed === 0) message.success(t('director.batchDeleteVersionsDone', { n: done, defaultValue: '已删除 {{n}} 个版本' }));
    else message.warning(t('director.batchDeleteVersionsPartial', { done, failed, defaultValue: '已删除 {{done}} 个版本，{{failed}} 个失败' }));
  }, [projectId, versionSelected, message, t]);

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
      setEpisodeContext({ activeEpisodeId: null, numberById: {}, episodes: [] });
      return;
    }
    let cancelled = false;
    const apply = (e: { episodes?: Array<{ id?: string; number: number; title?: string }>; activeEpisodeId?: string; meta?: { visualStyle?: ScriptVisualStyle } } | null) => {
      if (cancelled) return;
      const numberById: Record<string, number> = {};
      const episodes: Array<{ id: string; number: number; title?: string }> = [];
      for (const ep of e?.episodes ?? []) {
        if (typeof ep.id !== 'string' || typeof ep.number !== 'number') continue;
        numberById[ep.id] = ep.number;
        episodes.push({ id: ep.id, number: ep.number, title: ep.title });
      }
      const active = typeof e?.activeEpisodeId === 'string' ? e.activeEpisodeId : null;
      setEpisodeContext({ activeEpisodeId: active && numberById[active] != null ? active : null, numberById, episodes });
      setVisualStyle(e?.meta?.visualStyle ?? null);
    };
    void readScript(pid).then(apply);
    const un = watchScript(pid, apply);
    return () => { cancelled = true; un(); };
  }, [isActive, projectId]);

  // 2026-11-13 导演台按集切换：一个地点/集一份；默认第一集，其它集为空
  const workbenchEpisodeByProject = useViewPrefsStore((s) => s.workbench.activeEpisodeByProject);
  const setWorkbenchActiveEpisode = useViewPrefsStore((s) => s.setWorkbenchActiveEpisode);
  const episodeGroups = useMemo(() => groupShotsByEpisode(shots), [shots]);
  const scriptEpisodeIds = useMemo(() => episodeContext.episodes.map((e) => e.id), [episodeContext.episodes]);
  /** 默认集 = 第一集正片（跳过「故事大纲/设定」这类非正片条目） */
  const defaultEpisodeId = useMemo(() => {
    const list = episodeContext.episodes;
    const drama = list.find((e) => !/(大纲|设定|梗概|人物小传|分集)/.test(e.title ?? ''));
    return (drama ?? list[0])?.id ?? null;
  }, [episodeContext.episodes]);
  const episodeKeys = useMemo(() => {
    const result = [...scriptEpisodeIds];
    for (const key of orderEpisodeKeys(episodeGroups, scriptEpisodeIds)) {
      if (key !== UNASSIGNED_EPISODE_KEY && !result.includes(key)) result.push(key);
    }
    return result;
  }, [episodeGroups, scriptEpisodeIds]);
  const [episodeOverride, setEpisodeOverride] = useState<string | null>(null);
  const placeholderKeyRef = useRef<string | null>(null);
  const activeEpisodeKey = useMemo(() => {
    if (episodeKeys.length === 0) return null;
    const remembered = projectId ? workbenchEpisodeByProject[projectId] : undefined;
    const candidate = episodeOverride ?? remembered ?? null;
    if (candidate && episodeKeys.includes(candidate)) return candidate;
    if (defaultEpisodeId && episodeKeys.includes(defaultEpisodeId)) return defaultEpisodeId;
    return episodeKeys.find((k) => episodeGroups[k]?.length) ?? episodeKeys[0] ?? null;
  }, [episodeKeys, episodeGroups, defaultEpisodeId, episodeOverride, projectId, workbenchEpisodeByProject]);
  const visibleShots = useMemo(
    () => (activeEpisodeKey ? (episodeGroups[activeEpisodeKey] ?? []) : shots),
    [activeEpisodeKey, episodeGroups, shots],
  );

  /** 「连续播放」：从当前选中片段起，按轨道顺序播放后续所有有视频的片段 */
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const [sequenceVideoKey, setSequenceVideoKey] = useState<string | undefined>(undefined);
  const sequenceTimer = useRef<number | null>(null);
  const stopSequence = useCallback(() => {
    if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current);
    sequenceTimer.current = null;
    setSequencePlaying(false);
    setSequenceVideoKey(undefined);
  }, []);
  const playSequence = useCallback(() => {
    if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current);
    sequenceTimer.current = null;
    const list = visibleShots;
    const startIdx = Math.max(0, list.findIndex((s) => s.id === activeShotId));
    const playAt = (from: number): void => {
      let i = from;
      while (i < list.length && !list[i]?.media?.storageKey) i += 1;
      if (i >= list.length) { stopSequence(); return; }
      const shot = list[i]!;
      // 只换预览视频，不切 activeShot：避免提示词编辑器随片段切换被卸载触发 removeChild
      setSequenceVideoKey(shot.media!.storageKey);
      setPreviewAutoPlayKey((k) => k + 1);
      sequenceTimer.current = window.setTimeout(() => playAt(i + 1), Math.max(1, Number(shot.duration) || 5) * 1000 + 700);
    };
    setSequencePlaying(true);
    playAt(startIdx);
  }, [visibleShots, activeShotId, stopSequence]);
  useEffect(() => () => {
    if (sequenceTimer.current !== null) window.clearTimeout(sequenceTimer.current);
  }, []);
  const episodeOptions = useMemo(() => episodeKeys.map((key) => {
    const count = episodeGroups[key]?.length ?? 0;
    const ep = episodeContext.episodes.find((e) => e.id === key);
    const label = ep ? displayEpisodeTitle(ep.title, ep.number) : '已删除的集';
    return { value: key, label: `${label}（${count} 段）` };
  }), [episodeKeys, episodeGroups, episodeContext.episodes]);

  const handleEpisodeChange = useCallback((key: string) => {
    setEpisodeOverride(key);
    if (projectId) setWorkbenchActiveEpisode(projectId, key);
    const first = episodeGroups[key]?.[0];
    if (first) setActiveShotId(first.id);
  }, [projectId, setWorkbenchActiveEpisode, episodeGroups]);

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

  // 旧数据兜底：所有片段都没分集时，归到第一集（用户默认看到第一集，不是「未分集」）
  useEffect(() => {
    if (!isActive || !projectId || !defaultEpisodeId || shots.length === 0) return;
    if (!shots.some((s) => !s.episodeId)) return;
    setShots((prev) => prev.map((s) => (s.episodeId ? s : { ...s, episodeId: defaultEpisodeId })));
    setWorkbenchActiveEpisode(projectId, defaultEpisodeId);
    markDirty();
  }, [isActive, projectId, defaultEpisodeId, shots, setWorkbenchActiveEpisode, markDirty]);


  // 切到没有片段的分集：自动挂一个空片段（导演台永远不出现空白页）
  useEffect(() => {
    if (!isActive || !projectId || !activeEpisodeKey || visibleShots.length > 0) return;
    if (placeholderKeyRef.current === activeEpisodeKey) return;
    placeholderKeyRef.current = activeEpisodeKey;
    const seg = createSegment(1, activeEpisodeKey === UNASSIGNED_EPISODE_KEY ? undefined : activeEpisodeKey);
    setShots((prev) => [...prev, seg]);
    setActiveShotId(seg.id);
    markDirty();
  }, [isActive, projectId, activeEpisodeKey, visibleShots.length, markDirty]);

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

  const handlePickGlobalStyle = useCallback((preset: StylePreset) => {
    // 风格是导演台的可变参数：只写 sharedParams，不篡改片段提示词；生成时再拼接
    updateSharedParams({
      params: {
        ...(sharedParams.params ?? {}),
        stylePrompt: stylePresetPrompt(preset),
        styleName: preset.nameZh,
        stylePresetId: preset.id,
        styleGuide: styleShotGuide(preset),
      },
    });
    message.success(`已应用风格：${preset.nameZh}`);
    message.info('风格会影响构图/机位/镜头时长；现有提示词建议按新风格重写');
  }, [updateSharedParams, sharedParams.params, message]);

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
      // 发送源视频 = 切回源视频变体：同一来源的引导槽必须清掉，避免同格隐藏
      const clearGuide = shot.guide?.fromAssetId === detail.ref.id;
      if (existing) {
        if (clearGuide) updateShot(shot.id, { guide: undefined });
        message.info(t('workbench.slotReused', '该资产已在片段素材池，复用原槽位'));
        return;
      }
      const shotRef: WorkbenchShotReference = {
        id: detail.ref.id, kind: detail.ref.kind, title: detail.ref.title,
        storageKey: detail.ref.storageKey, url: detail.ref.url, slotNo: detail.ref.slotNo,
      };
      (shotRef as WorkbenchShotReference & { originScope?: string }).originScope = detail.ref.originScope;
      updateShot(shot.id, {
        references: [...(shot.references ?? []), shotRef],
        ...(clearGuide ? { guide: undefined } : {}),
      });
      message.success(t('workbench.addedToSegment', '已送入当前片段素材池'));
    };
    window.addEventListener(WORKBENCH_ADD_REF_EVENT, onAddRef);
    return () => window.removeEventListener(WORKBENCH_ADD_REF_EVENT, onAddRef);
  }, [projectId, activeShotId, updateShot, message, t]);

  // ===== 引导槽（2026-11-07）：发送引导数据 → 覆盖当前片段唯一引导槽 =====
  // 独立槽位类型：不占 9 张参考图上限；每段至多一个，重复发送即替换（需求 3/5）。
  useEffect(() => {
    const onSetGuide = (e: Event) => {
      const detail = (e as CustomEvent<WorkbenchSetGuideDetail>).detail;
      if (!detail || detail.projectId !== (projectId ?? '')) return;
      const shot = shotsRef.current.find((s) => s.id === activeShotId) ?? shotsRef.current[0];
      if (!shot) return;
      // 引导是视频槽的变体：同一格切换，源视频不能继续占一个参考槽
      const references = detail.guide.fromAssetId
        ? (shot.references ?? []).filter((r) => r.id !== detail.guide.fromAssetId)
        : shot.references;
      updateShot(shot.id, { guide: { ...detail.guide }, ...(references ? { references } : {}) });
      message.success(t('workbench.guideSent', '已送入当前片段引导槽（重复发送会替换）'));
    };
    window.addEventListener(WORKBENCH_SET_GUIDE_EVENT, onSetGuide);
    return () => window.removeEventListener(WORKBENCH_SET_GUIDE_EVENT, onSetGuide);
  }, [projectId, activeShotId, updateShot, message, t]);

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
      const seg = createSegment(prev.length + 1, activeEpisodeKey && activeEpisodeKey !== UNASSIGNED_EPISODE_KEY ? activeEpisodeKey : undefined);
      const at = insert?.index ?? (afterShotId ? prev.findIndex((s) => s.id === afterShotId) + 1 : prev.length);
      const idx = Math.max(0, Math.min(prev.length, at));
      const next = [...prev.slice(0, idx), seg, ...prev.slice(idx)].map((s, i) => ({ ...s, number: i + 1 }));
      setShots(next);
      setActiveShotId(seg.id);
      markDirty();
    },
    [markDirty, activeEpisodeKey],
  );

  /** 交换两个片段的位置（2026-11-10）：数组互换 + 重新编号；选中片段不丢 */
  const swapShots = useCallback((aId: string, bId: string) => {
    const prev = shotsRef.current;
    const ia = prev.findIndex((s) => s.id === aId);
    const ib = prev.findIndex((s) => s.id === bId);
    if (ia < 0 || ib < 0 || ia === ib) return;
    const next = [...prev];
    const a = next[ia]!;
    next[ia] = next[ib]!;
    next[ib] = a;
    setShots(next.map((s, i) => ({ ...s, number: i + 1 })));
    markDirty();
  }, [markDirty]);

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

  /**
   * 衔接图标直接点击 = 切换该交界（2026-11-07 用户指令）：
   * - 链接模式内 → 与点片段一致，写草稿（完成后统一落盘）；
   * - 模式外 → 立即写持久值（continuation.enabled），图标同步变链接/断开。
   */
  const toggleContinuityDirect = useCallback((shotId: string) => {
    if (continuityDraft) {
      toggleShotContinuity(shotId);
      return;
    }
    const idx = shotsRef.current.findIndex((s) => s.id === shotId);
    const shot = idx >= 0 ? shotsRef.current[idx] : undefined;
    if (idx <= 0 || !shot) return;
    const next = !segmentContinuityEnabled(toRunShot(shot), idx);
    updateShot(shot.id, { continuation: { enabled: next } });
  }, [continuityDraft, toggleShotContinuity, updateShot]);

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

  /** 片段选择面板自己的缺口检测（不能复用 runSelection，那个只在批量导轨模式里维护） */
  const pickerAutoDisconnect = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    shots.forEach((s, i) => {
      if (i === 0 || !runPickerSelection.has(s.id)) return;
      if (!segmentContinuityEnabled(toRunShot(s), i)) return;
      const prev = shots[i - 1];
      if (prev && !runPickerSelection.has(prev.id)) set.add(s.id);
    });
    return set;
  }, [shots, runPickerSelection]);

  /** 退出批量模式：清空勾选（不残留） */
  const exitBatchMode = useCallback(() => {
    setRunSelection(new Set<string>());
    setTrackMode(null);
  }, []);



  /** ===== ComfyUI 真实运行（2026-11-05 极简化单地址）=====
   * 连接配置来自右上角「ComfyUI」弹层（comfyui-connect-button，单地址 + 自动判定后端）；
   * 运行配置推导统一在 comfyui-endpoint.getRunConfigFromEndpoint：
   * 直连（/zeroexo/h3/* zip 包契约）或 OpenAI 兼容口（POST /v1/videos，导演参数映射唯一表）；
   * 运行 = 3s 轮询 /status，每段 done 立即下载落库（video storageKey + 首帧缩略，复用 platform/media CAS 机制）；
   * 段状态经 updateShot 直接写回片段实体（导轨卡片三态 + 预览区跟随）。 */
  const [firstFrameUrls, setFirstFrameUrls] = useState<Record<string, string>>({});
  const comfyRun = useDirectorRun({
    getBridgeConfig: () => getRunConfigFromEndpoint(),
    // 单段完成要尽快回到卡片/预览，不等到 3 秒轮询
    pollIntervalMs: 1000,
    callbacks: {
      onSegmentState: (shotId, state) => {
        const shot = shotsRef.current.find((s) => s.id === shotId);
        // 已完成/已有成片的片段，取消旧任务不能把它改回 cancelled（否则视频入口消失）
        if (state === 'cancelled' && (shot?.status === 'done' || shot?.media?.storageKey)) return;
        updateShot(shotId, { status: state });
        // 发起生成任务时自动存一份版本快照（2026-11-07：版本=任务记录，而非编辑记录）
        if (state === 'generating' && projectId) {
          const shot = shotsRef.current.find((s) => s.id === shotId);
          void snapshotWorkbenchForRun(projectId, shot?.number ?? 0).catch(() => undefined);
        }
      },
      onSegmentDone: (shotId, payload) => {
        const media: NonNullable<WorkbenchShot['media']> = {
          storageKey: payload.videoStorageKey,
          source: 'generated',
          ...(payload.guide ? { guide: payload.guide } : {}),
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

  /** 统一真实提交：片段选择面板「确认 N 段」和批量导轨「生成」都直接走这里，不再二次预检。 */
  const startRunNow = useCallback(
    (selectedIds: string[], continuationOff: ReadonlySet<string> = new Set()) => {
      if (selectedIds.length === 0) {
        message.warning(t('director.runEmpty', '请先勾选要运行的片段'));
        return;
      }
      const size = resolveVideoSize(
        String(sharedParamsRef.current.params['aspect'] ?? '16:9'),
        Number(sharedParamsRef.current.params['scaleFactor'] ?? 1),
      );
      // 上一轮残留的「生成中/排队」不属于本次勾选：先归零，避免未选片段亮状态
      const selected = new Set(selectedIds);
      for (const s of shotsRef.current) {
        if (!selected.has(s.id) && s.status === 'generating') {
          updateShot(s.id, { status: 'pending' });
        }
      }
      void comfyRun.startRun({
        selectedIds,
        shots: shotsRef.current.map(toRunShot).map((s) =>
          continuationOff.has(s.id) ? { ...s, continuation: { enabled: false } } : s,
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
      if (trackMode === 'batch') exitBatchMode();
    },
    [comfyRun, subjects, projectId, trackMode, exitBatchMode, message, t],
  );

  // MCP 只投递请求；真正运行必须由当前网页执行（预览/进度/落库都归网页）
  useMcpDirectorJobs({
    projectId,
    onRequest: (req) => startRunNow(req.selectedIds ?? []),
  });

  /** 批量导轨「生成」：确认勾选后直接开始。 */
  const openBatchPreflight = useCallback(() => {
    if (runSelection.size === 0) {
      message.warning(t('director.runEmpty', '请先勾选要运行的片段'));
      return;
    }
    startRunNow([...runSelection], batchAutoDisconnect);
  }, [runSelection, batchAutoDisconnect, startRunNow, message, t]);

  /** 旧预检弹层兜底：现在生成入口不会打开它，保留只为兼容旧调用。 */
  const confirmDryRun = useCallback(() => {
    if (!dryRun) return;
    startRunNow(dryRun.selectedIds, dryRun.continuationOff);
    setDryRun(null);
  }, [dryRun, startRunNow]);

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
    () => visibleShots.map((s) => toTimelineClip(s, firstFrameUrls, {
      phase: comfyRun.phase,
      segmentShotIds: comfyRun.segmentShotIds,
      currentSegment: comfyRun.currentSegment,
      previewSegmentIndex: comfyRun.preview?.segmentIndex ?? null,
    })),
    [visibleShots, firstFrameUrls, comfyRun.phase, comfyRun.segmentShotIds, comfyRun.currentSegment, comfyRun.preview?.segmentIndex],
  );

  // 切项目只清本地运行态，绝不取消上一个项目的云端作业：项目之间是并发排队，
  // 切回来/切过去都不该要求用户点「取消」。
  const runProjectRef = useRef(projectId);
  useEffect(() => {
    if (runProjectRef.current === projectId) return;
    runProjectRef.current = projectId;
    comfyRun.reset();
  }, [projectId, comfyRun.reset]);

  // 外部（MCP/另一条链路）已经把全部选中片段写成 done+media 时，网页残留的 submitting/queued
  // 运行态必须让位，否则卡片会永远停在「排队」，成片入口也被旧 phase 挡住。
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (!['submitting', 'queued', 'running'].includes(comfyRun.phase)) return;
    if (visibleShots.length === 0) return;
    const allDone = visibleShots.every((s) =>
      s.status === 'done' && s.clipState === 'completed' && Boolean(s.media?.storageKey));
    // 提交/轮询回包丢失时 startedAt 会一直停在那里；超过 10 分钟且每段都已有成片，
    // 说明这是死运行态，必须让位给视频，而不是永远显示「取消」。
    const stale = comfyRun.startedAt > 0 && Date.now() - comfyRun.startedAt > 10 * 60 * 1000;
    const allHaveVideo = visibleShots.every((s) => Boolean(s.media?.storageKey));
    if (allDone || (stale && allHaveVideo)) comfyRun.reset();
  }, [loadState, comfyRun.phase, comfyRun.reset, comfyRun.startedAt, visibleShots]);

  const selectedShot: WorkbenchShot = visibleShots.find((s) => s.id === activeShotId) ?? visibleShots[0] ?? {
    id: '__empty__',
    number: 1,
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
  const selectedShotIndex = selectedShot ? visibleShots.findIndex((s) => s.id === selectedShot.id) : 0;

  /**
   * 2026-11-07 修复（运行中点选「没运行到的片段」串帧 + 假播放器进度条）：
   * 1) 只有 done + completed + 有 storageKey 的片段才有可播放视频；生成中/排队/
   *    未运行/失败/已中断一律不把旧成片 key 交给播放器（否则显示上一条成片 + 假进度）。
   * 2) /ws 实时帧带 1 基段号，必须映射回 shotId 且等于当前选中的片段才允许显示；
   *    否则用户点选未运行片段时，右侧会错误盖着正在生成的那一帧。
   */
  const completedVideoKey = sequenceVideoKey ?? (selectedShot?.media?.storageKey
    && selectedShot.clipState === 'completed'
    ? selectedShot.media.storageKey
    : undefined);
  const previewFrame = comfyRun.preview;
  // 一作业一段时，插件每次内部的 segment_index 都是 1；必须优先用本次运行的段号，
  // 否则所有批量的实时帧都会被压到第 1 段。
  const previewSegment = comfyRun.currentSegment ?? previewFrame?.segmentIndex;
  const previewFrameShotId = previewSegment
    ? comfyRun.segmentShotIds[previewSegment - 1]
    : undefined;
  const canShowLiveFrame = !completedVideoKey
    && !!previewFrame?.image
    && !!selectedShot
    && (previewFrameShotId ?? runningShotId ?? selectedShot.id) === selectedShot.id;

  // 2026-11-05 固定宽度卡片（220px 基准修订）：WorkbenchMultiTrack 实测导轨容器宽度后回传最终
  // 卡片宽（220/180/160 降级；初始 = 基准 220）。覆盖层（箭头/勾选块/引导缩略）与卡片同 pitch 铺排。
  const [directorCardWidth, setDirectorCardWidth] = useState<number>(DIRECTOR_CARD_WIDTH_BASE);
  const directorCardPitch = directorCardWidth + DIRECTOR_CARD_GAP;
  /** 2026-11-05 参考图修订：卡片高度（缩略框 + 标签行），衔接箭头据此垂直居中 */
  const directorCardHeightPx = directorCardHeight(directorCardWidth);
  /** hover 命中哪条衔接箭头：仅 hover 的箭头 opacity 回 1，静息按主题 token */
  const [hoveredArrowId, setHoveredArrowId] = useState<string | null>(null);

  // ===== 段间衔接标记（2026-11-07 用户指令：箭头改链接图标，断开为红色断链，点击即切换）=====
  // 每个可用交界（段 2..N）常显一枚图标：开启 = 绿色链接，断开 = 红色断链；
  // 图标本身可点，直接切换衔接开/关（链接模式内写草稿，模式外立即落盘）。
  // 占位 34×22 不变（交界间隙中心 + 卡片垂直居中），不随卡片 220/180/160 档位变化。
  const continuityArrows = useMemo(() => {
    const items: Array<{ id: string; x: number; fromNo: number; toNo: number; on: boolean }> = [];
    visibleShots.forEach((s, i) => {
      // 2026-11-04 链接模式草稿：模式内图标按草稿实时渲染（取消回滚后恢复持久态）
      // 2026-11-05 固定宽度片段卡片：交界 x = 卡片下标 × pitch（随容器 220/180/160）
      if (i > 0) {
        items.push({ id: s.id, x: i * directorCardPitch, fromNo: shots[i - 1]!.number, toNo: s.number, on: continuityOn(s, i) });
      }
    });
    if (items.length === 0) return null;
    const arrowTone = directorArrowTone(theme.mode === 'dark');
    const arrowTop = TRACK_CLIP_TOP + directorCardHeightPx / 2 - DIRECTOR_ARROW_SIZE.height / 2;
    const linkOn = '#00c758';
    const linkOff = '#ef4444';
    return (
      <div data-director-continuity-overlay style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
        {items.map((it) => {
          const hovered = hoveredArrowId === it.id;
          return (
            <button
              type="button"
              key={`joint-${it.id}`}
              data-continuity-arrow={it.id}
              data-continuity-on={it.on ? 'true' : 'false'}
              data-continuity-arrow-hovered={hovered ? 'true' : 'false'}
              title={it.on
                ? t('workbench.multitrack.jointOff', '断开衔接')
                : t('workbench.multitrack.jointOn', '开启衔接')}
              aria-label={it.on
                ? t('workbench.multitrack.jointOff', '断开衔接')
                : t('workbench.multitrack.jointOn', '开启衔接')}
              onClick={(e) => { e.stopPropagation(); toggleContinuityDirect(it.id); }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={() => setHoveredArrowId(it.id)}
              onMouseLeave={() => setHoveredArrowId((prev) => (prev === it.id ? null : prev))}
              style={{
                position: 'absolute',
                left: it.x - DIRECTOR_ARROW_SIZE.width / 2 - DIRECTOR_CARD_GAP / 2,
                top: arrowTop,
                width: DIRECTOR_ARROW_SIZE.width,
                height: DIRECTOR_ARROW_SIZE.height,
                padding: 0,
                opacity: hovered ? 1 : arrowTone.opacityRest,
                // 项目同款深色胶囊（底 + 细描边 + 圆角 + 阴影）；border-box 保证加边不撑大命中区
                boxSizing: 'border-box',
                background: arrowTone.surface,
                border: `1px solid ${hovered ? arrowTone.hoverBorder : arrowTone.border}`,
                borderRadius: 5,
                boxShadow: hovered ? arrowTone.hoverShadow : arrowTone.shadow,
                transition: 'opacity 0.12s, border-color 0.12s, box-shadow 0.12s',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'auto',
                cursor: 'pointer',
                color: it.on ? linkOn : linkOff,
                fontFamily: 'inherit',
              }}
            >
              {it.on ? <Link2 size={13} color={linkOn} strokeWidth={2.2} /> : <Link2Off size={13} color={linkOff} strokeWidth={2.2} />}
            </button>
          );
        })}
      </div>
    );
  }, [visibleShots, t, continuityOn, toggleContinuityDirect, directorCardPitch, directorCardHeightPx, hoveredArrowId, theme.mode]);

  // ===== 批量勾选层（2026-11-04 批量复用 dry-run 预检） =====
  // 勾选来源 = 轨道行：批量模式下每个片段左上叠一个勾选块（绝对定位纯视觉，不挤布局），
  // 点勾选块或点片段本体都切换同一份 runSelection；模式外零渲染。
  // 2026-11-05 用户指令：勾选（=选中态）不再用绿色 #00c758，改中性亮色；
  // 绿色只保留给「段间衔接」语义标记（箭头）。
  const batchCheckOverlay = useMemo(() => {
    if (trackMode !== 'batch') return null;
    const items: Array<{ id: string; x: number; checked: boolean }> = [];
    // 2026-11-05 固定宽度片段卡片：勾选块 x = 卡片下标 × pitch（等宽卡片铺排，随容器 220/180/160）
    visibleShots.forEach((s, i) => {
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
  }, [trackMode, visibleShots, runSelection, toggleRunSelection, t, directorCardPitch, theme.mode]);

  // 注入活动轨 clip 内容层的覆盖物：衔接箭头（常显）+ 批量勾选块（仅批量模式）
  const railContentOverlay = useMemo(
    () => (continuityArrows || batchCheckOverlay
      ? <>{continuityArrows}{batchCheckOverlay}</>
      : null),
    [continuityArrows, batchCheckOverlay],
  );

  if (!isActive) return null;

  // 容器未就绪：渲染加载提示，不白屏、不显示任何占位状态文案
  if (loadState !== 'ready') {
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
            // 导演台：无成片时隐藏播放控制条（播放/时间码/进度条只在生成完成后出现）
            hideControlBarWhenNoVideo: true,
            // 生成中/未运行/失败一律没有可播放视频；只有完成段才交给播放器
            videoStorageKey: completedVideoKey,
            videoStatus: completedVideoKey
              ? 'done'
              : selectedShot.status === 'generating' ? 'generating' : 'idle',
            // 点击片段/片段缩略播放键 → 预览区从 0 起播（2026-11-07 用户反馈修复）
            autoPlayKey: previewAutoPlayKey,
            /* 2026-11-04 第十二条：预览占位只显示状态（单行文案+小图标），不回显提示词；
               状态跟随当前激活片段（selectedShot 切换即联动）。
               未生成 / 生成中（·detail 预留，dry-run 阶段无真实进度）/ 已生成 · Ns / 生成失败（+原因一行）。 */
            placeholderStatus:
              completedVideoKey
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
              if (selectedShot.status === 'done') return `${Math.round(selectedShot.duration)}s`;
              return undefined;
            })(),
            /* 2026-11-05 实时预览：直连 /ws 帧按 ≤10fps 刷新在占位卡上（badge 带步进/段号）；
               OpenAI 兼容渠道无 ws → 只标「仅进度」，不假装实时帧 */
            livePreview:
              canShowLiveFrame && previewFrame?.image
                ? {
                    image: previewFrame.image,
                    step: previewFrame.step,
                    totalSteps: previewFrame.totalSteps,
                    segmentIndex: previewFrame.segmentIndex,
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
            railExtra: (scriptEpisodeIds.length > 0 || episodeKeys.length > 1) ? (
              <div data-director-episode-switcher style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Select
                  size="small"
                  data-director-episode
                  value={activeEpisodeKey ?? undefined}
                  options={episodeOptions}
                  onChange={(key: string) => handleEpisodeChange(key)}
                  style={{ width: 150 }}
                  popupMatchSelectWidth={false}
                />
                <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>{visibleShots.length} 段</span>
                <Button size="small" type="text" data-director-global-style icon={<Palette size={14} />} style={{ fontSize: 12 }} onClick={() => setStyleGalleryOpen(true)}>
                  {(() => {
                    // 风格名优先取导演台自己的可变参数；没选过则回落全剧风格（本剧信息里设的那套）
                    const name = String(
                      sharedParams.params?.['styleName']
                      ?? visualStyle?.name
                      ?? '',
                    ).trim();
                    return name ? `风格：${name}` : '风格';
                  })()}
                </Button>
                {String(sharedParams.params?.['stylePrompt'] ?? '').trim() ? (
                  <Button
                    size="small"
                    type="text"
                    data-director-style-clear
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      const next = { ...(sharedParams.params ?? {}) };
                      delete next['stylePrompt'];
                      delete next['styleName'];
                      updateSharedParams({ params: next });
                      message.success('已清除风格，生成时只遵循片段自己的提示词');
                    }}
                  >清除风格</Button>
                ) : null}
                {String(sharedParams.params?.['stylePrompt'] ?? '').trim() ? (
                  <Button
                    size="small"
                    type="text"
                    data-director-style-rewrite
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      const styleName = String(sharedParams.params?.['styleName'] ?? '当前风格');
                      const stylePrompt = String(sharedParams.params?.['stylePrompt'] ?? '');
                      const guide = String(sharedParams.params?.['styleGuide'] ?? '按该风格重写构图/机位/节奏');
                      const lines = [
                        '【ZeroExo 风格重写】',
                        `projectId: ${projectId ?? ''}`,
                        `风格：${styleName}`,
                        `风格片段：${stylePrompt}`,
                        `镜头/节奏：${guide}`,
                        '请按该风格重写本集每段的 imagePrompt / videoPrompt，并给出建议时长；不要只追加一句风格行。',
                        '当前集片段：',
                        ...visibleShots.map((x, i) => `#${i + 1} ${Math.round(x.duration)}s\n画面：${x.imagePrompt ?? ''}\n视频：${x.videoPrompt ?? ''}`),
                      ];
                      if (!navigator.clipboard) {
                        message.warning('复制失败，请手动选择复制');
                        return;
                      }
                      void navigator.clipboard.writeText(lines.join('\n')).then(
                        () => message.success('已复制风格重写要求，粘给 AI 即可'),
                        () => message.warning('复制失败，请手动选择复制'),
                      );
                    }}
                  >
                    重写要求
                  </Button>
                ) : null}
              </div>
            ) : null,
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
            // 2026-11-07 统一生成入口：批量按钮已移除，所有生成走「生成」按钮 → 片段选择面板
            // batchEntry: { active: trackMode === 'batch', onToggle: ... },
            clipLabelMode: 'director',
            // 2026-11-04 导演台导轨零基线：去白色竖线（聚焦轨 borderLeft）+ 片段起点=刻度 0
            // + 横向滚动统一外层容器
            zeroBaseRail: true,
            // 2026-11-05 220px 卡片修订：接收 multitrack 实测容器后的最终卡片宽，覆盖层与卡片同 pitch
            onDirectorCardWidthChange: setDirectorCardWidth,
            /* 2026-11-05 参考图修订：缩略框中央播放键 = 打开右侧预览并切到该段；2026-11-07 同时起播 */
            onDirectorPlay: selectShotAndPlay,
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
                <button
                  type="button"
                  disabled={!visibleShots.some((s) => Boolean(s.media?.storageKey))}
                  onClick={sequencePlaying ? stopSequence : playSequence}
                  aria-label={sequencePlaying ? t('director.sequenceStop', '停止连播') : t('director.sequencePlay', '连续播放')}
                  title={sequencePlaying ? t('director.sequenceStop', '停止连播') : t('director.sequencePlay', '从当前片段开始，按顺序播放后续所有视频')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, height: 25, padding: '0 8px',
                    borderRadius: 5, fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap',
                    cursor: visibleShots.some((s) => Boolean(s.media?.storageKey)) ? 'pointer' : 'not-allowed',
                    border: 0, outline: 'none', boxShadow: 'none', background: 'transparent',
                    color: sequencePlaying ? theme.toolbar.accent : theme.toolbar.text,
                    opacity: visibleShots.some((s) => Boolean(s.media?.storageKey)) ? 1 : 0.45,
                  }}
                >
                  {sequencePlaying ? <Square size={12} /> : <Play size={12} />}
                  {sequencePlaying ? t('director.sequenceStopShort', '停止') : t('director.sequencePlayShort', '连播')}
                </button>
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
                  onRun={() => {
                    // 统一入口：打开片段选择面板，默认勾选当前片段
                    setRunPickerSelection(new Set(selectedShot.id ? [selectedShot.id] : []));
                    setRunPickerOpen(true);
                  }}
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
                  : (() => { stopSequence(); selectShotAndPlay(shotId); })(),
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
              totalShots={visibleShots.length}
              // 2026-11-06 标题区镜头跳转胶囊：与导轨/预览共用 activeShotId 单一受控源，
              // 面板内不自建序号状态（受控组件复用铁律）
              onPrevShot={() => setActiveShotId(visibleShots[Math.max(0, selectedShotIndex - 1)]!.id)}
              onNextShot={() => setActiveShotId(visibleShots[Math.min(visibleShots.length - 1, selectedShotIndex + 1)]!.id)}
              // 2026-11-10：下拉直达任意镜头 + 与其它镜头交换位置（大量片段时不用一路拖）
              onJumpShot={(i) => {
                const target = visibleShots[Math.max(0, Math.min(visibleShots.length - 1, i))];
                if (target) setActiveShotId(target.id);
              }}
              onSwapShot={(i) => {
                const target = visibleShots[i];
                if (target && target.id !== selectedShot.id) swapShots(selectedShot.id, target.id);
              }}
              shotLabels={visibleShots.map((s) => `${Math.round(s.duration)}s`)}
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
        {/* 版本批量删除确认：只作用于勾选项 */}
        <ConfirmDialog
          open={versionBatchConfirmOpen}
          title={t('director.batchDeleteVersionsTitle', { n: versionSelected.size, defaultValue: '删除选中的 {{n}} 个版本？' })}
          confirmLabel={t('director.deleteVersionOk', '删除')}
          cancelLabel={t('director.restoreVersionCancel', '取消')}
          danger
          zIndex={21000}
          onConfirm={() => void deleteSelectedVersions()}
          onClose={() => setVersionBatchConfirmOpen(false)}
        >
          {t('director.batchDeleteVersionsBody', '只删除这些历史快照，当前内容不受影响。')}
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
            <>
              {/* 批量操作条（2026-11-07）：只作用于勾选的版本 */}
              <div
                data-version-batch-bar
                style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '0 2px' }}
              >
                <Checkbox
                  checked={versions.length > 0 && versionSelected.size === versions.length}
                  indeterminate={versionSelected.size > 0 && versionSelected.size < versions.length}
                  onChange={(e) => setVersionSelected(e.target.checked ? new Set(versions.map((v) => v.fileName)) : new Set())}
                >
                  {t('director.versionSelectAll', '全选')}
                </Checkbox>
                <span style={{ fontSize: 12, opacity: 0.65 }}>
                  {t('director.versionSelectedCount', { n: versionSelected.size, defaultValue: '已选 {{n}} 个' })}
                </span>
                <span data-version-cap style={{ fontSize: 12, opacity: 0.65 }}>
                  {t('director.versionsCount', {
                    n: versions.filter((v) => !v.favorite).length,
                    max: SNAPSHOT_KEEP_COUNT,
                    defaultValue: '{{n}} / {{max}} 个版本',
                  })}
                </span>
                {versions.some((v) => v.favorite) && (
                  <span data-version-favorite-count style={{ fontSize: 12, opacity: 0.65 }}>
                    {t('director.versionFavoriteCount', {
                      n: versions.filter((v) => v.favorite).length,
                      defaultValue: '已收藏 {{n}} 个',
                    })}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <Button
                  size="small"
                  danger
                  data-version-batch-delete
                  disabled={versionSelected.size === 0}
                  onClick={() => setVersionBatchConfirmOpen(true)}
                >
                  {t('director.versionBatchDelete', '批量删除')}
                </Button>
              </div>
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
                        borderRadius: 8,
                        border: `1px solid ${v.favorite ? 'rgba(245,158,11,0.45)' : 'rgba(128,128,128,0.25)'}`,
                      }}
                    >
                      <Checkbox
                        data-version-check={v.fileName}
                        checked={versionSelected.has(v.fileName)}
                        onChange={(e) => toggleVersionSelected(v.fileName, e.target.checked)}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12 }}>{new Date(v.createdAt).toLocaleString()}</div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>
                          {reasonText} · {t('director.versionShots', { n: (v.entity?.shots ?? []).length, defaultValue: '{{n}} 个片段' })}
                          {typeof v.entity?.totalDuration === 'number' ? ` · ${v.entity.totalDuration.toFixed(1)}s` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-version-favorite={v.fileName}
                        data-favorited={v.favorite ? 'true' : undefined}
                        aria-pressed={!!v.favorite}
                        onClick={() => void toggleVersionFavorite(v)}
                        title={v.favorite
                          ? t('director.versionUnfavorite', '取消收藏')
                          : t('director.versionFavorite', '收藏（不自动回收）')}
                        style={{
                          height: 26, width: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(128,128,128,0.35)',
                          background: 'transparent', color: v.favorite ? '#f59e0b' : 'inherit', padding: 0,
                        }}
                      >
                        <Star size={12} fill={v.favorite ? '#f59e0b' : 'none'} />
                      </button>
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
            </>
          )}
        </Modal>
        {/* 片段选择面板（2026-11-07 统一生成入口）：点「生成」弹出，默认勾选当前段，
            可全选/按需勾选；确认后进入 dry-run 预检。替代原导轨批量模式按钮。 */}
        <Modal
          open={runPickerOpen}
          onCancel={() => setRunPickerOpen(false)}
          centered
          width={520}
          title={t('director.runPickerTitle', '选择要生成的片段')}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="small"
                  onClick={() => setRunPickerSelection(new Set(shots.map((s) => s.id)))}
                >
                  {t('director.runPickerSelectAll', '全选')}
                </Button>
                <Button
                  size="small"
                  onClick={() => setRunPickerSelection(new Set())}
                >
                  {t('director.runPickerSelectNone', '全不选')}
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => setRunPickerOpen(false)}>
                  {t('common.cancel', '取消')}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  disabled={runPickerSelection.size === 0}
                  onClick={() => {
                    setRunPickerOpen(false);
                    startRunNow([...runPickerSelection], pickerAutoDisconnect);
                  }}
                >
                  {t('director.runPickerConfirm', '确认 ({{n}} 段)', { n: runPickerSelection.size })}
                </Button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 400, overflowY: 'auto' }}>
            {shots.map((shot) => (
              <label
                key={shot.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 8, border: '1px solid rgba(128,128,128,0.20)', cursor: 'pointer',
                  opacity: runPickerSelection.has(shot.id) ? 1 : 0.7,
                }}
              >
                <Checkbox
                  checked={runPickerSelection.has(shot.id)}
                  onChange={(e) => {
                    setRunPickerSelection((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(shot.id);
                      else next.delete(shot.id);
                      return next;
                    });
                  }}
                />
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {t('director.shotNumber', '片段 {{n}}', { n: shot.number })}
                </span>
                <span style={{ opacity: 0.55, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {shot.duration}s
                </span>
                <span style={{
                  flex: 1, opacity: 0.5, fontSize: 12, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {shot.imagePrompt || '—'}
                </span>
                {shot.status === 'done' && (
                  <span style={{ fontSize: 11, color: '#52c41a' }}>✓ 已生成</span>
                )}
                {shot.status === 'generating' && (
                  <span style={{ fontSize: 11, color: '#1890ff' }}>生成中</span>
                )}
              </label>
            ))}
          </div>
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
        <StyleGalleryDialog
          open={styleGalleryOpen}
          onClose={() => setStyleGalleryOpen(false)}
          selectedId={String(sharedParams.params?.['stylePresetId'] ?? visualStyle?.presetId ?? '') || null}
          onSelect={(preset) => handlePickGlobalStyle(preset)}
          theme={theme}
        />
      </div>
    </CanvasTabContentBoundary>
  );
}
