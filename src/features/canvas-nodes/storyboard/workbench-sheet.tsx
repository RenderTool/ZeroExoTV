/**
 * WorkbenchSheet - 画布"出片(workbench)节点"独立页面壳
 *
 * 节点内紧凑视图：根据 status 显示不同状态内容（场记板视觉）。
 * 全屏编辑器：portal 到 document.body，左侧镜头列表 + 右侧空白占位（轨道区由 T4 实现）。
 * 数据写入 node.data，随画布 Yjs 同步。
 *
 * 2026-09-01 Plan#61 重构：片态二分（placeholder/completed），消除备选视频（videos[]/activeVideoIndex/generated）。
 * - placeholder：未调用 AI，准备提示词/素材 → 显示提示词输入器。
 * - completed：API 生成后 / 资产拖入 → 无提示词输入，直接播放。
 */

import { memo, useState, useCallback, useMemo, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

import { Button, Modal, App as AntdApp, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { CanvasTabContentBoundary } from '@/features/canvas-tabs/CanvasTabContentBoundary.js';
import { loadModelDurationBounds } from '@/features/generator-settings/dynamic-param-form.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { addAssets } from '@/features/asset-picker/asset-store.js';
import type { WorkbenchNodeData, WorkbenchShot, WorkbenchClipRef, WorkbenchShotReference, WorkbenchMediaAsset } from './workbench-types';
import type { StoryboardEntity } from './storyboard-types';

import { extractSubjectMentions, detectStaleRefs } from './storyboard-utils';
import { generateVideo } from './workbench-frame-api';
import { ensureDefaultShot, ensureMainTrack, canDeleteShots } from './workbench-sync';
import { apiGet } from '@/services/api-client';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store';
import { Semaphore } from '@/shared/utils/Semaphore';
import { useReactGraphStore } from '@zeroexo/plugin-render-react';
import { extractVideoFirstFrame, extractVideoLastFrame, blobToFile } from '@/shared/utils/video-frame.js';

import { StoryboardMergedTab } from './storyboard-merged-tab';
import { useWorkbenchVideoStageProps } from './useWorkbenchVideoStageProps';
import { GeneratingState } from './workbench-states';
import { StoryboardTimeline, type StoryboardTimelineProps } from './storyboard-timeline';
import type { TimelineClipData } from './timeline-constants';

// OpenCut 暗色专业剪辑风配色常量（模块级，供组件内外使用）
const OPENCUT_ACCENT = '#3b82f6';

/**
 * 拖入素材时长解析已下沉到 storyboard-utils.resolveVideoDurationSec，由时间轴 drop 侧先行解析。
 * 占位片默认时长 = 模型模板 duration.max，获取不到模型时兜底 15s（2026-09-02 约定）。
 */
const PLACEHOLDER_DEFAULT_DURATION = 15;

export interface WorkbenchSheetProps {
  nodeId: string;
  data: WorkbenchNodeData;
  onDataChange: (data: WorkbenchNodeData) => void;
}

// Q2 bidirectional sync: 同步字段清单（提示词+参数）
const SYNC_FIELDS = ['imagePrompt', 'videoPrompt', 'model', 'paramValues'] as const;
type SyncField = (typeof SYNC_FIELDS)[number];
function pickSyncFields<T extends Partial<WorkbenchShot>>(src: T): Partial<Record<SyncField, unknown>> {
  const out: Partial<Record<SyncField, unknown>> = {};
  for (const f of SYNC_FIELDS) {
    if (f in src) (out as Record<string, unknown>)[f] = src[f];
  }
  return out;
}

export const WorkbenchSheet = memo(function WorkbenchSheet({
  nodeId,
  data,
  onDataChange,
}: WorkbenchSheetProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  // Q2 双向同步：直接用 store 跨节点读写
  const store = useReactGraphStore();
  /** 最近一次上游同步的指纹（避免下游→上游回写时把同值推回去引发循环） */
  const lastSyncRef = useRef<Map<string, string>>(new Map());
  /** data 最新值 ref（给 useEffect 闭包引用，避免上游订阅回调读到过期数据） */
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);
  /** onDataChange 最新引用 ref（上游 subscribe 回调里调用，避开依赖循环） */
  const onShotsChangeRef = useRef(onDataChange);
  useEffect(() => { onShotsChangeRef.current = onDataChange; }, [onDataChange]);
  // antd 静态 Modal.confirm/message 无法消费 ConfigProvider 动态主题（console 警告），
  // 统一改用 App.useApp() 实例（2026-09-02，先例：version-dialogs/home-page）
  const { message, modal } = AntdApp.useApp();

  const myTabKey = buildTabKey('workbench', nodeId);
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const tabHost = useCanvasTabStore((s) => s.contentHost);
  const openTab = useCanvasTabStore((s) => s.openTab);
  const openWorkbenchTab = useCallback(() => {
    openTab({ kind: 'workbench', id: nodeId, title: t('canvasNodes.stage.workbench') });
  }, [openTab, nodeId, t]);
  const [pps, setPps] = useState(60);

  // 本地版（Plan#83）：向 Agent 声明工作台焦点的效果随 canvas-agent 移除

  const OPENCUT_BG = isDark ? theme.canvas.background : '#f8f8f8';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const bgPage = isDark ? OPENCUT_BG : '#f8f8f8';

  const progressPercent = useMemo(() => {
    if (data.shots.length === 0) return 0;
    return Math.round((data.completedCount / data.shots.length) * 100);
  }, [data.shots.length, data.completedCount]);

  useEffect(() => {
    const unsub = nodeActionBus.on('workbench:fullscreen', (e: { nodeId: string }) => {
      if (e.nodeId === nodeId) openWorkbenchTab();
    });
    return () => unsub?.();
  }, [nodeId, openWorkbenchTab]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [timelineOrder, _setTimelineOrder] = useState<string[] | null>(null);
  const [playhead, setPlayhead] = useState(0);
  /** Phase 2：多轨聚焦 id（哪条轨处于高亮/编辑态）；null 时回退到 active 轨 */
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);

  // 本地版（Plan#83）：无分镜连入建轨这一步 → 只有段没有轨时自动补一条主轨，避免导轨区空白
  // 2026-11-04 出片页布局改造：空数据兜底——先保证至少 1 个占位片段（序号 1），再补主轨
  useEffect(() => {
    let patched = ensureDefaultShot(data);
    patched = ensureMainTrack(patched);
    if (patched !== data) onDataChange(patched);
  }, [data, onDataChange]);
  /** Plan#71 T11：批量生成确认弹窗（ids=目标占位片；null=关闭） */
  const [batchOpen, setBatchOpen] = useState<string[] | null>(null);
  /** 批量统一模型（'' = 沿用各片已选模型） */
  const [batchModel, setBatchModel] = useState('');
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [autoPlayKey] = useState(0);
  /** 播放模式（2026-09-02 征集 #134）：'all'=整轨序列 / 'clip'=仅选中片段 / null=停止 */
  const [playbackMode, setPlaybackMode] = useState<'all' | 'clip' | null>(null);
  /** 外部播放指令（舞台控制条 / 全屏下拉驱动时间轴主时钟）：seq 自增即触发一次 */
  const [playbackCommand, setPlaybackCommand] = useState<{ seq: number; action: 'play-all' | 'play-clip' | 'stop'; restart?: boolean }>({ seq: 0, action: 'stop' });
  const cmdSeqRef = useRef(0);
  const sendPlayCommand = useCallback((action: 'play-all' | 'play-clip' | 'stop', restart?: boolean) => {
    cmdSeqRef.current += 1;
    setPlaybackCommand({ seq: cmdSeqRef.current, action, restart });
  }, []);

  const orderedShots = useMemo<WorkbenchShot[]>(() => {
    if (!timelineOrder || timelineOrder.length === 0) return data.shots;
    const shotMap = new Map(data.shots.map((s) => [s.id, s]));
    return timelineOrder.map((id) => shotMap.get(id)).filter(Boolean) as WorkbenchShot[];
  }, [data.shots, timelineOrder]);

  const currentShot = useMemo<WorkbenchShot | undefined>(() => {
    return orderedShots[activeIndex] ?? orderedShots[0];
  }, [orderedShots, activeIndex]);

  const activeClipStartSec = useMemo(() => {
    let acc = 0;
    for (const s of orderedShots) {
      if (s.id === currentShot?.id) return acc;
      acc += s.duration;
    }
    return 0;
  }, [orderedShots, currentShot?.id]);

  /**
   * 整轨总时长（秒）= 全部片段时长之和（2026-09-02 征集 #134）。
   * 「播放全部」的时间码基准 —— 未生成的占位片段也要计入，才能像剪辑软件一样完整预览全片。
   */
  const sequenceDuration = useMemo(
    () => orderedShots.reduce((sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 0), 0),
    [orderedShots],
  );

  /** 中央舞台控制条 播放/暂停 → 驱动时间轴主时钟（播放态唯一持有者） */
  const handleTogglePlay = useCallback(() => {
    if (timelinePlaying) {
      sendPlayCommand('stop');
      return;
    }
    sendPlayCommand(playbackMode === 'clip' ? 'play-clip' : 'play-all');
  }, [timelinePlaying, playbackMode, sendPlayCommand]);

  /** 拖动整轨进度条 → 跳播放头 + 同步选中落点所在片段（中央区立即投影对应画面） */
  const handleSequenceSeek = useCallback((time: number) => {
    setPlayhead(time);
    let acc = 0;
    for (let i = 0; i < orderedShots.length; i++) {
      const s = orderedShots[i];
      if (!s) break;
      if (time < acc + s.duration) { setActiveIndex(i); return; }
      acc += s.duration;
    }
    setActiveIndex(Math.max(0, orderedShots.length - 1));
  }, [orderedShots]);

  /** 全屏播放范围选择：从头起播（整轨=0s / 本片段=片段起点），随后由舞台进入全屏 */
  const handleFullscreenPlay = useCallback((mode: 'all' | 'clip') => {
    sendPlayCommand(mode === 'all' ? 'play-all' : 'play-clip', true);
  }, [sendPlayCommand]);

  /** 按指定 shot 解析引用主体（T11 批量生成按镜计算主体文本；当前镜 = shotSubjects） */
  const shotSubjectsForShot = useCallback((shot: WorkbenchShot | undefined) => {
    if (!shot) return [] as Array<{ id: string; name: string; kind: string; anchorSentence?: string; description?: string; stateName?: string }>;
    const mentions = extractSubjectMentions(shot.description ?? '');
    const bibleIds = new Set([
      ...(shot.bibleRefs?.characters ?? []),
      ...(shot.bibleRefs?.scenes ?? []),
      ...(shot.bibleRefs?.props ?? []),
    ]);
    return (data.entities ?? []).flatMap((e) => {
      const m = mentions.find((x) => x.name === e.name);
      const byBible = bibleIds.has(e.id) || bibleIds.has(e.name);
      if (!m && !byBible) return [];
      const state = m?.state ? e.states?.find((s) => s.name === m.state) : undefined;
      return [{
        id: e.id,
        name: e.name,
        kind: e.kind,
        anchorSentence: e.anchorSentence,
        description: e.description,
        stateName: state?.name ?? m?.state,
      }];
    });
  }, [data.entities]);

  const shotSubjects = useMemo(
    () => shotSubjectsForShot(currentShot),
    [shotSubjectsForShot, currentShot],
  );

  const prevRefModeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const mode = (currentShot?.paramValues?.mode as string) ?? 'multi-modal-reference';
    const prev = prevRefModeRef.current;
    prevRefModeRef.current = mode;
    if (!prev || prev === mode) return;
    const hiddenImages = (currentShot?.references ?? []).filter(
      (r) => r.kind === 'image' && !r.slot,
    ).length;
    if (mode === 'image-to-video-first-last-frame' && hiddenImages > 0) {
      message.info(`${hiddenImages} 张参考图在当前首尾帧模式下不可见，切回多模态即恢复`);
    }
  }, [currentShot, message]);

  // 本地版（Plan#83）：镜头上下文不再注入 Agent 会话（分镜/提示词维护由外部工具经 MCP 直接读写数据目录）

  const activeMedia = useMemo(() => {
    return currentShot?.clipState === 'completed' ? currentShot.media : undefined;
  }, [currentShot]);

  const timelineData = useMemo(() => {
    return orderedShots.map((s) => ({
      id: s.id,
      number: s.number,
      duration: s.duration,
      status: s.status === 'pending' ? 'idle' as const : s.status,
      thumbnailUrl: s.firstFrameKey,
      videoKey: s.clipState === 'completed' && s.media?.storageKey
        ? s.media.storageKey
        : undefined,
      // 2026-09-01 T7：传递 trim 区间给缩略图重采样
      trimStart: s.media?.trimStart,
      trimEnd: s.media?.trimEnd,
      // 2026-09-02：素材 trim 上限 = 源视频真实时长（素材不受生成模型 duration.max 约束）
      sourceDuration: s.media?.sourceDuration,
      label: `#${s.number} ${s.description || s.shotType}`,
      hasAudio: !!s.audioPreview,
    }));
  }, [orderedShots]);

  const adoptedClips = useMemo(() => orderedShots.flatMap((s) => {
    const media = s.clipState === 'completed' ? s.media : undefined;
    if (!media || !media.storageKey || s.status !== 'done') return [];
    return [{ shot: s, storageKey: media.storageKey }];
  }), [orderedShots]);

  const handleSendClipsToAssets = useCallback(async () => {
    if (adoptedClips.length === 0) {
      message.info('暂无已生成的视频可发送');
      return;
    }
    const created = await addAssets(adoptedClips.map(({ shot, storageKey }) => ({
      title: `镜头${shot.number} ${shot.description || shot.shotType || ''}`.trim(),
      kind: 'video' as const,
      coverUrl: shot.firstFrameKey,
      bytes: 0,
      data: { kind: 'video' as const, url: '', storageKey, durationMs: Math.round(shot.duration * 1000) },
    })));
    if (created.length === 0) message.info('所选视频均已在「我的资产」中');
    else message.success(`已发送 ${created.length} 个视频到我的资产`);
  }, [adoptedClips, message]);

  // ===== 2026-09-02 导出到我的素材（真实可读 key 才启用；拼接引擎 P2 接入后成为单视频） =====
  /** 可导出判定：已生成完成 + 后端真实 resources/ storageKey（mock/纯 URL 不导出） */
  const isExportableShot = useCallback((s: WorkbenchShot) =>
    s.clipState === 'completed' && s.status === 'done'
    && !!s.media?.storageKey && s.media.storageKey.startsWith('resources/'),
  []);
  const exportableCount = useMemo(() => orderedShots.filter(isExportableShot).length, [orderedShots, isExportableShot]);

  /** 把单个片段注册为「我的素材」视频资产（与 handleSendClipsToAssets 同口径） */
  const registerShotAsset = useCallback(async (shot: WorkbenchShot): Promise<void> => {
    const storageKey = shot.media?.storageKey;
    if (!storageKey || !isExportableShot(shot)) return;
    await addAssets([{
      title: `镜头${shot.number} ${shot.description || shot.shotType || ''}`.trim(),
      kind: 'video' as const,
      coverUrl: shot.firstFrameKey,
      bytes: 0,
      data: { kind: 'video' as const, url: '', storageKey, durationMs: Math.round(shot.duration * 1000) },
    }]);
  }, [isExportableShot]);

  /** 右键单片段导出 */
  const handleExportShot = useCallback((shotId: string) => {
    const shot = orderedShots.find((s) => s.id === shotId);
    if (!shot) return;
    if (!isExportableShot(shot)) {
      message.info('该片段暂无可导出的真实视频（未生成或源文件不可读）');
      return;
    }
    void registerShotAsset(shot).then(() => {
      message.success(`已导出「#${shot.number}」到我的素材`);
    });
  }, [orderedShots, isExportableShot, registerShotAsset, message]);

  /** 导出全部 / 导出选定入口。当前为逐段注册资产；P2 接入浏览器拼接后改为合成单视频入库。 */
  const handleExportShots = useCallback(async (shots: WorkbenchShot[]) => {
    const exportable = shots.filter(isExportableShot);
    if (exportable.length === 0) {
      message.info('所选片段均无可导出的真实视频');
      return;
    }
    const hide = message.loading(`正在导出 ${exportable.length} 个片段到我的素材…`, 0);
    try {
      await Promise.all(exportable.map((s) => registerShotAsset(s)));
      message.success(`已导出 ${exportable.length} 个片段到我的素材`);
      // TODO(P2): 浏览器 mp4box.js 拼接成单个视频后上传入库
    } finally {
      hide();
    }
  }, [isExportableShot, registerShotAsset, message]);

  const onUpdateShot = useCallback((shotId: string, updates: Partial<WorkbenchShot>) => {
    const updatedShots = data.shots.map((s) =>
      s.id === shotId ? { ...s, ...updates } : s,
    );
    onDataChange({ ...data, shots: updatedShots });
  }, [data, onDataChange]);

  /**
   * Q2 双向同步：下游(本节点) → 上游 storyboard
   * 仅同步 imagePrompt/videoPrompt/model/paramValues 四个字段；仅当 shot.sourceShotId 匹配上游 storyboard 某个 shot.id 时触发。
   * 指纹校验：同步字段值与上游当前一致时跳过（避免回写上游→下游回波循环）。
   */
  const syncUp = useCallback((shotId: string, updates: Partial<WorkbenchShot>) => {
    const { sourceStoryboardId: storyId, shots: localShots } = dataRef.current;
    if (!storyId) return;
    const localShot = localShots.find((s) => s.id === shotId);
    if (!localShot?.sourceShotId) return;
    const syncPatch = pickSyncFields(updates);
    if (Object.keys(syncPatch).length === 0) return;
    const storyNode = store.getNode(storyId);
    if (!storyNode) return;
    const storyShots = (((storyNode?.data ?? {}) as Record<string, unknown>).shots ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(storyShots)) return;
    const upShot = storyShots.find((s) => s.id === localShot.sourceShotId) as Record<string, unknown> | undefined;
    if (!upShot) return;
    // 指纹校验：如果下游要推的值和上游已经一致，说明是上游→下游的回波本地应用，不上推
    const lastFp = lastSyncRef.current.get(localShot.sourceShotId);
    const nowFp = JSON.stringify(syncPatch);
    if (lastFp === nowFp) return;
    for (const [k, v] of Object.entries(syncPatch)) {
      if (JSON.stringify(upShot[k]) === JSON.stringify(v)) continue;
      // 上游字段存在且不同 → 触发上推
      const updatedStoryShots = storyShots.map((s) =>
        s.id === localShot.sourceShotId ? { ...s, ...syncPatch } : s,
      );
      store.updateNodeData(storyId, { shots: updatedStoryShots });
      const m = new Map(lastSyncRef.current);
      m.set(localShot.sourceShotId, nowFp);
      lastSyncRef.current = m;
      return;
    }
    // 全部一致（无差异） → 仅更新指纹，不写上游
    const m = new Map(lastSyncRef.current);
    m.set(localShot.sourceShotId, nowFp);
    lastSyncRef.current = m;
  }, [store]);

  /** 包装 onUpdateShot：下游编辑后自动上推 */
  const onUpdateShotWithSync = useCallback((shotId: string, updates: Partial<WorkbenchShot>) => {
    onUpdateShot(shotId, updates);
    syncUp(shotId, updates);
  }, [onUpdateShot, syncUp]);

  /**
   * Q2 双向同步：上游 storyboard → 下游(本节点)
   * 订阅上游 storyboard node，轮询其 shots 的同步字段变化。规则：
   * - 上游值变化 → 覆盖 local 对应 WorkbenchShot 的同步字段
   * - 写入后更新指纹（避免回写上游）
   */
  useEffect(() => {
    const storyId = dataRef.current.sourceStoryboardId;
    if (!storyId) return;
    const unsub = store.subscribeNode(storyId, () => {
      const { sourceStoryboardId: curStoryId, shots: localShots } = dataRef.current;
      if (!curStoryId || curStoryId !== storyId) return;
      const storyNode = store.getNode(storyId);
      if (!storyNode) return;
      const storyShots = (((storyNode?.data ?? {}) as Record<string, unknown>).shots ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(storyShots)) return;
      const storyShotMap = new Map(storyShots.map((s) => [s.id, s]));
      let changed = false;
      const updatedShots = localShots.map((localShot) => {
        if (!localShot.sourceShotId) return localShot;
        const upShot = storyShotMap.get(localShot.sourceShotId) as Record<string, unknown> | undefined;
        if (!upShot) return localShot;
        const patch: Partial<WorkbenchShot> = {};
        for (const f of SYNC_FIELDS) {
          const upVal = upShot[f];
          if (upVal !== undefined && JSON.stringify(upVal) !== JSON.stringify((localShot as unknown as Record<string, unknown>)[f])) {
            (patch as Record<string, unknown>)[f] = upVal;
          }
        }
        if (Object.keys(patch).length > 0) {
          changed = true;
          return { ...localShot, ...patch };
        }
        return localShot;
      });
      if (!changed) return;
      // 更新指纹（不等同于下游→上游回写路径的同步值）
      const m = new Map(lastSyncRef.current);
      for (const s of updatedShots) {
        if (s.sourceShotId) m.set(s.sourceShotId, JSON.stringify(pickSyncFields(s)));
      }
      lastSyncRef.current = m;
      // 通过 onDataChangeRef 更新数据
      const curData = dataRef.current;
      onShotsChangeRef.current({ ...curData, shots: updatedShots });
    });
    return unsub;
  }, [store]);

  // ===== Plan#71 T8：引用失效检测（幂等，只标不自动改）=====
  // 触发：subjectTrees（上游主体树）变化 / shots 变化（重连分镜后）/ 打开时全量校验一次。
  // detectStaleRefs 对 references 中带 subject 指纹的项产出失效清单，写回 references[].stale；
  // 用户上传素材（无 origin / user-upload）永不被标红。检测收敛：结果一致不再写回（防循环）。
  const subjectTreesForCheck = (data.subjectTrees ?? []) as unknown as Array<{
    rootId: string;
    name: string;
    baseState?: { referenceImages?: Array<{ key?: string }> };
    states?: Array<{ id: string; state?: string; media?: Array<{ key?: string }> }>;
  }>;
  useEffect(() => {
    if (subjectTreesForCheck.length === 0) return;
    if (data.shots.length === 0) return;
    let changed = false;
    const nextShots = data.shots.map((shot) => {
      const refs = shot.references;
      if (!refs || refs.length === 0) return shot;
      const results = detectStaleRefs({ subjects: subjectTreesForCheck, refs });
      if (results.length === 0) return shot;
      const resultMap = new Map(results.map((r) => [r.refId, r]));
      const nextRefs = refs.map((r) => {
        const hit = resultMap.get(r.id);
        if (!hit) return r; // 无失效结果 → 保持原样（含 user-upload）
        if (r.stale?.level === hit.level && r.stale?.reason === hit.reason) return r; // 已收敛
        return { ...r, stale: { level: hit.level, reason: hit.reason } };
      });
      const hasDiff = nextRefs.some((r, i) => r !== refs[i]);
      if (!hasDiff) return shot;
      changed = true;
      return { ...shot, references: nextRefs };
    });
    if (changed) {
      onDataChange({ ...data, shots: nextShots });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.subjectTrees, data.sourceStoryboardId, data.shots, onDataChange]);

  /** T8 修复动作① re-resolve：失效引用「用最新图替换」（拉取主体树当前最新图，正文/用户素材不动） */
  const handleReplaceRef = useCallback((shotId: string, refId: string) => {
    const shot = data.shots.find((s) => s.id === shotId);
    if (!shot) return;
    const ref = (shot.references ?? []).find((r) => r.id === refId);
    if (!ref) return;
    const trees = data.subjectTrees ?? [];
    if (trees.length === 0) return;
    const o = ref.origin;
    if (!o || o.kind === 'user-upload' || !o.rootId) return;
    const tree = trees.find((t) => t.rootId === o.rootId);
    if (!tree) {
      message.info('该主体树已删除，建议移除该引用');
      return;
    }
    let newKey: string | undefined;
    let newState: string | undefined;
    if (o.kind === 'subject-base') {
      newKey = (tree.baseState?.referenceImages ?? [])[0]?.key;
    } else if (o.kind === 'subject-state') {
      const node = (tree.states ?? []).find((s) => s.id === o.nodeId || s.state === o.state);
      newState = node?.state;
      newKey = (node?.media ?? [])[0]?.key;
    }
    if (!newKey) {
      message.info('当前主体暂无可用新图（状态可能未生成），可先在上游主体树生成后重试');
      return;
    }
    onUpdateShotWithSync(shotId, {
      references: (shot.references ?? []).map((r) =>
        r.id === refId
          ? {
              ...r,
              storageKey: newKey,
              url: undefined,
              stale: null,
              title: r.title ?? tree.name,
              origin: { ...o, mediaKey: newKey, updatedAt: new Date().toISOString(), state: o.state ?? newState },
            }
          : r,
      ),
    });
    message.success('已替换为最新引用');
  }, [data.shots, data.subjectTrees, onUpdateShot, message]);

  const extractFrameIntoShot = useCallback(async (
    videoKey: string,
    slot: 'first' | 'last',
    title: string,
  ): Promise<void> => {
    if (!currentShot) return;
    try {
      const blob =
        slot === 'first'
          ? await extractVideoFirstFrame(videoKey)
          : await extractVideoLastFrame(videoKey);
      const uploaded = await uploadAsset(blobToFile(blob, `shot-${currentShot.number}-${slot}.jpg`));
      const d = uploaded.data;
      let storageKey: string | undefined;
      let url: string | undefined;
      if (d.kind === 'image') {
        storageKey = d.storageKey;
        url = d.dataUrl;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image',
        title,
        storageKey,
        url,
        slot,
      };
      const existing = currentShot.references ?? [];
      onUpdateShotWithSync(currentShot.id, { references: [...existing.filter((r) => r.slot !== slot), ref] });
    } catch {
      // 抽帧失败静默
    }
  }, [currentShot, onUpdateShot]);

  const autoLinkedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentShot) return;
    const entityRefs = shotSubjects.flatMap((s) => {
      const entity = (data.entities ?? []).find((e) => e.id === s.id);
      return (entity?.referenceImages ?? [])
        .filter((img) => !!img.storageKey)
        .map((img) => ({
          storageKey: img.storageKey!,
          title: `${entity?.name ?? s.name}-参考`,
        }));
    });
    if (entityRefs.length === 0) return;
    const existingKeys = new Set((currentShot.references ?? []).map((r) => r.storageKey).filter(Boolean));
    const toAdd = entityRefs.filter((r) => {
      const linkKey = `${currentShot.id}:${r.storageKey}`;
      return !autoLinkedRef.current.has(linkKey) && !existingKeys.has(r.storageKey);
    });
    if (toAdd.length === 0) return;
    toAdd.forEach((r) => autoLinkedRef.current.add(`${currentShot.id}:${r.storageKey}`));
    onUpdateShotWithSync(currentShot.id, {
      references: [
        ...(currentShot.references ?? []),
        ...toAdd.map((r) => ({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: 'image' as const,
          title: r.title,
          storageKey: r.storageKey,
        })),
      ],
    });
  }, [currentShot, shotSubjects, data.entities, onUpdateShot]);

  const importSubjectImages = useCallback(async () => {
    if (!currentShot) return;
    const existing = currentShot.references ?? [];
    const newRefs = shotSubjects.flatMap((s) => {
      const entity = (data.entities ?? []).find((e) => e.id === s.id);
      return (entity?.referenceImages ?? []).map((img) => ({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image' as const,
        title: `${entity?.name ?? s.name}-参考`,
        storageKey: img.storageKey,
      }));
    });
    if (newRefs.length > 0) {
      onUpdateShotWithSync(currentShot.id, { references: [...existing, ...newRefs] });
    }
  }, [currentShot, shotSubjects, data.entities, onUpdateShot]);

  const promptExtraActions = useMemo(() => {
    if (!currentShot) return [];
    const actions: Array<{ key: string; label: string; onClick: () => void }> = [];
    const prevShot = activeIndex > 0 ? orderedShots[activeIndex - 1] : undefined;
    const nextShot = activeIndex < orderedShots.length - 1 ? orderedShots[activeIndex + 1] : undefined;
    if (prevShot) {
      const done = prevShot.clipState === 'completed' ? prevShot.media : undefined;
      if (done?.storageKey) {
        actions.push({
          key: 'prev-tail',
          label: `取#${prevShot.number}尾帧作首帧`,
          onClick: () => void extractFrameIntoShot(done.storageKey!, 'first', `前镜#${prevShot.number}尾帧`),
        });
      }
    }
    if (nextShot) {
      const done = nextShot.clipState === 'completed' ? nextShot.media : undefined;
      if (done?.storageKey) {
        actions.push({
          key: 'next-head',
          label: `取#${nextShot.number}首帧作尾帧`,
          onClick: () => void extractFrameIntoShot(done.storageKey!, 'last', `后镜#${nextShot.number}首帧`),
        });
      }
    }
    const hasSubjectImages = shotSubjects.some(
      (s) => (data.entities ?? []).find((e) => e.id === s.id)?.referenceImages?.length,
    );
    if (hasSubjectImages) {
      actions.push({
        key: 'import-subjects',
        label: '导入主体参考图',
        onClick: () => void importSubjectImages(),
      });
    }
    return actions;
  }, [currentShot, activeIndex, orderedShots, extractFrameIntoShot, shotSubjects, data.entities, importSubjectImages]);

  const uploadFileToCurrentShot = useCallback(async (file: File) => {
    if (!currentShot) return;
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      let refKind: WorkbenchShotReference['kind'] = 'text';
      let storageKey: string | undefined;
      let url: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (d.kind === 'image') {
        refKind = 'image';
        storageKey = d.storageKey;
        url = d.dataUrl;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'video') {
        refKind = 'video';
        storageKey = d.storageKey;
        url = d.url;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'audio') {
        refKind = 'audio';
        storageKey = d.storageKey;
        url = d.url;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: refKind,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        storageKey,
        url,
        width,
        height,
      };
      onUpdateShotWithSync(currentShot.id, { references: [...(currentShot.references ?? []), ref] });
    } catch {
      // 上传失败静默
    }
  }, [currentShot, onUpdateShot]);

  // 2026-11-04 出片页单轨化：原「拖文件新建轨道」(Phase 2.2 handleDropNewTrack)
  // 与「+ 新建轨道」按钮(Phase 2.3 handleAddEmptyTrack) 入口已下线，handler 一并移除；
  // data.tracks 结构保留，WorkbenchMultiTrack 仅渲染活动轨（旧多轨数据降级为只显示主轨）。

  // Plan#83 E：跨轨 / 同轨拖拽剪辑——从源轨移除 + 按 insertIndex 插入目标轨
  const handleMoveShotBetweenTracks = useCallback((
    fromTrackId: string,
    toTrackId: string,
    insertIndex: number,
    shotId: string,
  ) => {
    const tracks = dataRef.current.tracks ?? [];
    const fromTrack = tracks.find((t) => t.id === fromTrackId);
    if (!fromTrack) return;
    const sourceIndex = fromTrack.clips.findIndex((c) => c.ref.sourceShotId === shotId);
    if (sourceIndex < 0) return;
    const sourceClip = fromTrack.clips[sourceIndex]!;
    const nextFromClips = [...fromTrack.clips];
    nextFromClips.splice(sourceIndex, 1);
    const toTrack = tracks.find((t) => t.id === toTrackId);
    if (!toTrack) return;
    let nextToClips: WorkbenchClipRef[];
    let actualInsertIndex = insertIndex;
    if (fromTrackId === toTrackId) {
      // 同轨：先剔除再按 insertIndex 插入
      nextToClips = [...toTrack.clips];
      nextToClips.splice(sourceIndex, 1);
      actualInsertIndex = insertIndex > sourceIndex ? insertIndex - 1 : insertIndex;
      nextToClips.splice(Math.max(0, Math.min(actualInsertIndex, nextToClips.length)), 0, sourceClip);
    } else {
      // 跨轨：把刚才从源轨剔除的引用插到目标轨
      nextToClips = [...toTrack.clips];
      nextToClips.splice(Math.max(0, Math.min(insertIndex, nextToClips.length)), 0, sourceClip);
    }
    const nextTracks = tracks.map((t) => {
      if (t.id === fromTrackId && fromTrackId !== toTrackId) return { ...t, clips: nextFromClips };
      if (t.id === toTrackId) return { ...t, clips: nextToClips };
      return t;
    });
    onShotsChangeRef.current({
      ...(dataRef.current as WorkbenchNodeData),
      tracks: nextTracks as WorkbenchNodeData['tracks'],
    });
    if (fromTrackId !== toTrackId) setFocusedTrackId(toTrackId);
  }, []);

  // 2026-11-04：轨道头整列移除（WorkbenchMultiTrack 不再渲染轨道头），
  // 原 Plan#83 G「轨道拖拽排序」(handleReorderTracks) 随之下线——单轨显示下无排序对象。

  // Plan#71 T11：批量生成可选的视频模型/渠道（默认沿用各片已选，空值时用首个可用兜底）
  const [batchModelOptions, setBatchModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: Array<{ id: string; name: string; provider: string; modelIcons?: Record<string, string>; models: Array<{ name: string; capabilities?: string[] }> }> }>('/ai/channels')
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const channels = items.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          baseUrl: '',
          apiKey: '',
          apiFormat: 'openai' as const,
          models: Array.isArray(item.models) ? item.models.map((m) => m.name) : [],
          modelConfigs: Array.isArray(item.models) ? item.models.map((m) => ({ name: m.name, capabilities: m.capabilities ?? [] })) : undefined,
          modelIcons: item.modelIcons || {},
        }));
        const encoded = filterChannelModelsByCapability(channels as never, 'video');
        setBatchModelOptions(
          encoded.map((enc: string) => {
            const parts = enc.split('::');
            const modelName = parts[1] ?? enc;
            const ch = channels.find((c) => c.id === parts[0]);
            return { value: enc, label: ch ? `${modelName}(${ch.name})` : modelName };
          }),
        );
      })
      .catch(() => { if (!cancelled) setBatchModelOptions([]); });
    return () => { cancelled = true; };
  }, []);

  const [durationBounds, setDurationBounds] = useState<{ min: number; max: number } | null>(null);
  const activeModel = currentShot?.model ?? '';
  useEffect(() => {
    if (!activeModel) {
      setDurationBounds(null);
      return;
    }
    let cancelled = false;
    void loadModelDurationBounds('video', activeModel).then((bounds) => {
      if (!cancelled) setDurationBounds(bounds);
    });
    return () => { cancelled = true; };
  }, [activeModel]);

  useEffect(() => {
    if (!durationBounds) return;
    const { min, max } = durationBounds;
    const clamp = (d: number) => Math.round(Math.min(Math.max(d, min), max) * 10) / 10;
    // ⚠️ 2026-09-02 约定：素材按原时长——completed（拖入素材/已生成）不受模型 max 钳制，
    // 只有 placeholder（待生成）才按模型参数区间收敛。
    if (!data.shots.some((s) => s.clipState !== 'completed' && clamp(s.duration) !== s.duration)) return;
    const clampedShots = data.shots.map((s) => {
      if (s.clipState === 'completed') return s;
      const d = clamp(s.duration);
      if (d === s.duration) return s;
      return { ...s, duration: d, paramValues: { ...(s.paramValues ?? {}), duration: d } };
    });
    onDataChange({ ...data, shots: clampedShots });
  }, [durationBounds, data.shots, onDataChange]);

  const onReorder = useCallback((orderedIds: string[]) => {
    const shotMap = new Map(data.shots.map((s) => [s.id, s]));
    const reordered = orderedIds
      .map((id, i) => {
        const shot = shotMap.get(id);
        return shot ? { ...shot, number: i + 1 } : null;
      })
      .filter(Boolean) as WorkbenchShot[];
    onDataChange({ ...data, shots: reordered });
  }, [data, onDataChange]);

  /**
   * 单条生成执行器（T11：单发与批量共用）。
   * 返回成功与否（批量据此汇总，单条失败不阻断续跑）。
   */
  const generateOneShot = useCallback(async (shot: WorkbenchShot, overrideModel?: string): Promise<{ ok: boolean; error?: string }> => {
    const refs = shot.references ?? [];
    const isFirstLast = (shot.paramValues?.mode as string) === 'image-to-video-first-last-frame';
    const referenceImages = refs
      .filter((r) => r.kind === 'image' && r.storageKey)
      .filter((r) => (isFirstLast ? r.slot === 'first' || r.slot === 'last' : true))
      .map((r) => r.storageKey!) as string[];
    // 批量按各自镜头的 @主体/圣经引用计算主体文本（单发 = shotSubjects 同源）
    const subjects = shotSubjectsForShot(shot);
    const subjectText = subjects
      .map((s) => {
        const base = s.anchorSentence?.trim() || s.description?.trim() || s.name;
        return s.stateName ? `${base}(${s.stateName}状态)` : base;
      })
      .filter(Boolean)
      .join(', ');
    const shotWithModel = overrideModel ? { ...shot, model: overrideModel } : shot;
    const promptShot = subjectText
      ? { ...shotWithModel, videoPrompt: `${shotWithModel.videoPrompt || ''} ${subjectText}`.trim() }
      : shotWithModel;

    const generatedTitle = shot.description?.trim() || `#${shot.number}`;
    onUpdateShotWithSync(shot.id, { status: 'generating', ...(overrideModel ? { model: overrideModel } : {}) });
    try {
      const { storageKey, generationId } = await generateVideo({ shot: promptShot, referenceImages });
      const sourceDuration = shot.duration;
      onUpdateShotWithSync(shot.id, {
        clipState: 'completed',
        status: 'done',
        duration: sourceDuration,
        media: {
          storageKey,
          sourceDuration,
          trimStart: 0,
          trimEnd: sourceDuration,
          source: 'generated',
          title: generatedTitle,
          prompt: promptShot.videoPrompt,
          model: overrideModel ?? shot.model,
          generationId,
          createdAt: new Date().toISOString(),
        },
      });
      return { ok: true };
    } catch (err) {
      onUpdateShotWithSync(shot.id, { status: 'failed' });
      return { ok: false, error: err instanceof Error ? err.message : '生成失败' };
    }
  }, [onUpdateShot, shotSubjectsForShot]);

  /** 单发（当前选中镜头） */
  const runVideoGenerate = useCallback(() => {
    if (!currentShot) return;
    void generateOneShot(currentShot);
  }, [currentShot, generateOneShot]);

  /** 打开批量生成确认弹窗（T11）：过滤出可生成占位片，弹出确认（含渠道/模型选择） */
  const openBatchGenerate = useCallback((shotIds: string[]) => {
    const targets = data.shots.filter(
      (s) => shotIds.includes(s.id) && s.clipState === 'placeholder' && s.status !== 'generating',
    );
    if (targets.length === 0) {
      message.info('没有可批量生成的占位片段（已完成/生成中的已跳过）');
      return;
    }
    // 默认模型：优先沿用当前镜头已选；否则留给用户在下拉选择
    setBatchModel(currentShot?.model ?? '');
    setBatchOpen(targets.map((s) => s.id));
  }, [data.shots, currentShot?.model, message]);

  /**
   * T11 批量执行：Semaphore 低并发逐条跑 → 末尾汇总（成功/失败明细/耗时）。
   * 单条失败不阻断续跑；已完成（completed）/生成中（generating）片段自动跳过。
   */
  const runBatchExecute = useCallback(async () => {
    if (!batchOpen || batchOpen.length === 0) return;
    const targets = data.shots.filter(
      (s) => batchOpen.includes(s.id) && s.clipState === 'placeholder' && s.status !== 'generating',
    );
    setBatchOpen(null);
    if (targets.length === 0) return;
    const hide = message.loading(`正在批量生成 ${targets.length} 段…`, 0);
    try {
      const sem = new Semaphore(2); // mock/真实都限 2 并发，避免瞬时打满渠道
      const startedAt = Date.now();
      const results = await Promise.all(
        targets.map((t) => sem.run(() => generateOneShot(t, batchModel || undefined))),
      );
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      const costSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      const failDetails = results
        .map((r, i) => (r.ok ? null : `#${targets[i]?.number}：${r.error ?? '失败'}`))
        .filter(Boolean) as string[];
      if (failCount === 0) {
        message.success(`批量生成完成：${okCount}/${targets.length} 成功（${costSec}s）`);
      } else {
        message.warning(`批量生成完成：${okCount} 成功 / ${failCount} 失败（${costSec}s）`, 6);
        if (failDetails.length > 0) {
          message.error({ key: 'batch-fail', content: `失败明细：\n${failDetails.join('\n')}`, duration: 8 });
        }
      }
    } finally {
      hide();
    }
  }, [batchOpen, data.shots, generateOneShot, batchModel, message]);

  const runVideoStop = useCallback(() => { /* TODO: 接入生成任务取消端点 */ }, []);
  const onInsertAt = useCallback((afterShotId: string | null, insert?: { title?: string; durationSec?: number; storageKey?: string; coverUrl?: string; sourceDuration?: number; index?: number }) => {
    // ⚠️ 2026-09-02 修复（约定）：
    // 1. 素材按原时长：拖入素材 durationSec 已在时间轴 drop 侧解析为真实时长，直接用（无 30s 钳制）；
    // 2. 占位片（新建空白/未生成）默认时长 = 模型模板 duration.max，获取不到模型时兜底 15s；
    // 3. 时长未知（素材 metadata 解析失败等极端情况）→ 占位默认时长兜底，且 sourceDuration 留
    //    undefined（trimEnd=undefined 表示裁到视频末尾），绝不用兜底时长冒充源时长。
    const storageKey = insert?.storageKey;
    const hasKnownDuration = !!insert?.durationSec && insert.durationSec > 0;
    const fallbackDur = durationBounds?.max ?? PLACEHOLDER_DEFAULT_DURATION;
    const dur = storageKey
      ? (hasKnownDuration && insert.durationSec ? Math.max(0.5, insert.durationSec) : fallbackDur)
      : fallbackDur;
    const sourceDuration = hasKnownDuration ? dur : undefined;
    const newShot: WorkbenchShot = {
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      number: 0,
      description: insert?.title ?? '',
      shotType: '中景',
      duration: Math.round(dur * 10) / 10,
      status: 'pending',
      clipState: storageKey ? 'completed' : 'placeholder',
      firstFrameKey: insert?.coverUrl,
      paramValues: { duration: Math.round(dur * 10) / 10 },
      ...(storageKey ? {
        media: {
          storageKey,
          sourceDuration,
          trimStart: 0,
          trimEnd: sourceDuration,
          source: 'external' as const,
          title: insert?.title,
          createdAt: new Date().toISOString(),
        },
      } : {}),
    };
    // 2026-09-02：拖入素材的 insert.index 由时间轴占位框给出（占位框在哪=插哪），优先采用并 clamp。
    // 无 index（工具栏「选中后插入」/ 空态「新建片段」）时退回 afterShotId 兼容语义。
    const rawIndex = insert?.index;
    const idx = typeof rawIndex === 'number'
      ? Math.max(0, Math.min(Math.trunc(rawIndex), data.shots.length))
      : (afterShotId ? data.shots.findIndex((s) => s.id === afterShotId) + 1 : data.shots.length);
    const next = [...data.shots.slice(0, idx), newShot, ...data.shots.slice(idx)].map((s, i) => ({
      ...s,
      number: i + 1,
    }));
    onDataChange({ ...data, shots: next });
  }, [data, onDataChange, durationBounds]);

  /** 2026-09-02：抽公共删除结果构造（单删/批量共用）——素材归池 + 源引用记录 + 重编号 */
  const buildDeletedResult = useCallback((ids: string[]) => {
    const set = new Set(ids);
    const targets = data.shots.filter((s) => set.has(s.id));
    const mediaAssets: WorkbenchMediaAsset[] = [];
    const deletedRefs = [...(data.deletedSourceShotIds ?? [])];
    for (const target of targets) {
      if (target.clipState === 'completed' && target.media?.storageKey) {
        mediaAssets.push({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          storageKey: target.media.storageKey,
          title: target.description || `#${target.number}`,
          model: target.model,
          duration: target.duration,
          fromShotId: target.id,
          createdAt: new Date().toISOString(),
        });
      }
      if (target.sourceShotId) deletedRefs.push(target.sourceShotId);
    }
    const nextShots = data.shots
      .filter((s) => !set.has(s.id))
      .map((s, i) => ({ ...s, number: i + 1 }));
    return { nextShots, deletedRefs, mediaAssets, targetCount: targets.length };
  }, [data]);

  /** 公共删除执行：data 变更 + activeIndex 修正 + 可撤销提示（单删/批量共用） */
  const runDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    // 2026-11-04 出片页布局改造：删除保护——至少保留 1 个片段，拒绝时给可见轻提示（不静默失败）
    if (!canDeleteShots(data.shots.length, ids.length)) {
      message.warning(t('workbench.keepAtLeastOneClip', '至少保留一个片段'));
      return;
    }
    const before = data;
    const r = buildDeletedResult(ids);
    if (r.targetCount === 0) return;
    const curActiveId = orderedShots[activeIndex]?.id;
    onDataChange({
      ...data,
      shots: r.nextShots,
      deletedSourceShotIds: r.deletedRefs,
      mediaAssets: [...(data.mediaAssets ?? []), ...r.mediaAssets],
    });
    // 当前选中若被删 → 落到删除位置同序号（clamp），避免选中态悬空
    if (curActiveId && ids.includes(curActiveId)) {
      setActiveIndex(Math.max(0, Math.min(activeIndex, Math.max(0, r.nextShots.length - 1))));
    }
    const key = `del-shots-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    message.info({
      key,
      content: (
        <span>
          {t('workbench.deletedWithUndo', '片段已删除（视频素材已保留）')}
          <a
            style={{ marginLeft: 10, color: '#5DDCFF' }}
            onClick={() => { message.destroy(key); onDataChange(before); }}
          >
            {t('workbench.undo', '撤销')}
          </a>
        </span>
      ),
      duration: 5,
    });
  }, [data, onDataChange, t, message, buildDeletedResult, orderedShots, activeIndex]);

  // Plan#83 F：删除不弹 confirm（约定：删除操作不再弹确认框）
  // 已生成的视频素材保留在素材池中（runDelete 内已保证），无需二次确认
  const onDeleteShot = useCallback((shotId: string) => {
    runDelete([shotId]);
  }, [runDelete]);

  /** 2026-09-02 批量删除（框选 / Ctrl+A 后 Delete）：Plan#83 F 同上，不再弹窗 */
  const onDeleteShots = useCallback((shotIds: string[]) => {
    const ids = shotIds.filter((id) => data.shots.some((s) => s.id === id));
    if (ids.length === 0) return;
    runDelete(ids);
  }, [data.shots, runDelete]);

  const removeMediaAsset = useCallback((assetId: string) => {
    modal.confirm({
      title: t('workbench.removeAssetTitle', '移除素材引用'),
      content: t('workbench.removeAssetConfirm', '仅移除素材池中的引用，云端文件不会被删除。'),
      okText: t('workbench.remove', '移除'),
      okType: 'danger',
      cancelText: t('workbench.cancel', '取消'),
      centered: true,
      onOk: () => {
        onDataChange({ ...data, mediaAssets: (data.mediaAssets ?? []).filter((m) => m.id !== assetId) });
      },
    });
  }, [data, onDataChange, t, modal]);

  const handleSplitShot = useCallback((shotId: string) => {
    const idx = data.shots.findIndex((s) => s.id === shotId);
    if (idx < 0) return;
    const shot = data.shots[idx];
    if (!shot) return;
    const splitTime = playhead;
    if (splitTime <= 0 || splitTime >= shot.duration) return;

    if (shot.clipState === 'placeholder') {
      const newShot: WorkbenchShot = {
        ...shot,
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        number: shot.number + 1,
        duration: Math.round((shot.duration - splitTime) * 10) / 10,
        status: 'pending',
        firstFrameKey: undefined,
        lastFrameKey: undefined,
        references: shot.references ? [...shot.references] : undefined,
      };
      const updatedShot = {
        ...shot,
        duration: Math.round(splitTime * 10) / 10,
      };
      const nextShots = [
        ...data.shots.slice(0, idx),
        updatedShot,
        newShot,
        ...data.shots.slice(idx + 1),
      ].map((s, i) => ({ ...s, number: i + 1 }));
      onDataChange({ ...data, shots: nextShots });
      return;
    }

    // completed 分割：复制 media，调整 trimStart/trimEnd，两段都保持 completed
    const origMedia = shot.media!;
    const sourceDuration = origMedia.sourceDuration ?? origMedia.trimEnd ?? shot.duration;
    const origTrimStart = origMedia.trimStart ?? 0;
    const origTrimEnd = origMedia.trimEnd ?? sourceDuration;

    const frontTrimEnd = origTrimStart + splitTime;
    const frontDuration = frontTrimEnd - origTrimStart;
    const frontMedia = { ...origMedia, trimEnd: frontTrimEnd };

    const backTrimStart = origTrimStart + splitTime;
    const backDuration = origTrimEnd - backTrimStart;
    const backMedia = { ...origMedia, trimStart: backTrimStart };

    const newShot: WorkbenchShot = {
      ...shot,
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      number: shot.number + 1,
      duration: Math.round(backDuration * 10) / 10,
      clipState: 'completed',
      media: backMedia,
      status: shot.status,
      firstFrameKey: shot.firstFrameKey,
      lastFrameKey: shot.lastFrameKey,
      references: shot.references ? [...shot.references] : undefined,
    };

    const updatedShot: WorkbenchShot = {
      ...shot,
      duration: Math.round(frontDuration * 10) / 10,
      media: frontMedia,
    };

    const nextShots = [
      ...data.shots.slice(0, idx),
      updatedShot,
      newShot,
      ...data.shots.slice(idx + 1),
    ].map((s, i) => ({ ...s, number: i + 1 }));

    onDataChange({ ...data, shots: nextShots });
  }, [data, onDataChange, playhead]);

  const handleMergeShots = useCallback((shotId1: string, shotId2: string) => {
    const idx1 = data.shots.findIndex((s) => s.id === shotId1);
    const idx2 = data.shots.findIndex((s) => s.id === shotId2);
    if (idx1 < 0 || idx2 < 0) return;
    if (Math.abs(idx1 - idx2) !== 1) return;
    const first = idx1 < idx2 ? data.shots[idx1] : data.shots[idx2];
    const second = idx1 < idx2 ? data.shots[idx2] : data.shots[idx1];
    if (!first || !second) return;
    const mergedDuration = Math.round((first.duration + second.duration) * 10) / 10;

    let mergedMedia: WorkbenchShot['media'] = undefined;
    if (first.clipState === 'completed' && second.clipState === 'completed' && first.media && second.media) {
      mergedMedia = {
        ...first.media,
        trimEnd: second.media.trimEnd ?? second.media.sourceDuration ?? second.duration,
        source: first.media.source,
      };
    }

    const mergedShot: WorkbenchShot = {
      ...first,
      duration: mergedDuration,
      description: first.description + ' + ' + second.description,
      status: (first.status === 'done' && second.status === 'done') ? 'done' : 'pending',
      references: [...(first.references ?? []), ...(second.references ?? [])],
      clipState: mergedMedia ? 'completed' : 'placeholder',
      media: mergedMedia,
    };
    const nextShots = data.shots
      .filter((s) => s.id !== second.id)
      .map((s) => s.id === first.id ? mergedShot : s)
      .map((s, i) => ({ ...s, number: i + 1 }));
    onDataChange({ ...data, shots: nextShots });
  }, [data, onDataChange]);

  const videoStageProps = useWorkbenchVideoStageProps({
    currentShot,
    activeMediaStorageKey: activeMedia?.storageKey,
    timelinePlaying,
    playhead,
    activeClipStartSec,
    autoPlayKey,
    sequenceDuration,
    playbackMode,
    onTogglePlay: handleTogglePlay,
    onSequenceSeek: handleSequenceSeek,
    onFullscreenPlay: handleFullscreenPlay,
    onInsertAt,
    onGenerate: runVideoGenerate,
    onStop: runVideoStop,
    theme,
    isDark,
    t: t as (...args: any[]) => string,
  });

  // Q4: 节点 body（非 generating）渲染全屏同款 StoryboardTimeline 导轨组件——
  // 与全屏共用同一套时间轴，只是高度/宽度受画布节点大小约束；不 DIY 内嵌态。
  const timelinePropsBase = useMemo(() => ({
    shots: orderedShots as unknown as TimelineClipData[],
    activeShotId: currentShot?.id,
    pixelsPerSecond: pps,
    onPixelsPerSecondChange: setPps,
    onSelectShot: (id: string) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
    onReorder,
    minClipDuration: durationBounds?.min,
    maxClipDuration: durationBounds?.max,
    onTrim: (shotId: string, newDuration: number, side: 'left' | 'right') => {
      const shot = data.shots.find((s) => s.id === shotId);
      if (!shot) return;
      if (shot.clipState === 'completed' && shot.media) {
        const trimStart = shot.media.trimStart ?? 0;
        const trimEnd = shot.media.trimEnd ?? (shot.media.sourceDuration ?? shot.duration);
        if (side === 'right') {
          onUpdateShotWithSync(shotId, {
            duration: newDuration,
            media: { ...shot.media, trimEnd: trimStart + newDuration },
            paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
          });
        } else {
          onUpdateShotWithSync(shotId, {
            duration: newDuration,
            media: { ...shot.media, trimStart: trimEnd - newDuration },
            paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
          });
        }
      } else {
        onUpdateShotWithSync(shotId, {
          duration: newDuration,
          paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
        });
      }
    },
    playheadTime: playhead,
    onPlayheadTimeChange: setPlayhead,
    onPlayingChange: setTimelinePlaying,
    onPlaybackModeChange: setPlaybackMode,
    playbackCommand,
    onClipDoubleClick: (id: string) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
    onInsertAt,
    onDeleteShot,
    onDeleteShots,
    canBatchGenerate: false,
    theme,
    isDark,
    t: t as (...args: any[]) => string,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [orderedShots, currentShot?.id, pps, setPps, onReorder, durationBounds?.min, durationBounds?.max,
    onUpdateShotWithSync, data.shots, playhead, setPlayhead, setTimelinePlaying, setPlaybackMode,
    playbackCommand, setActiveIndex, onInsertAt, onDeleteShot, onDeleteShots, theme, isDark]);
  // inline 分支在上面基础上追加 inline+readonly+emptyHint。
  // readonly=true 隐藏 toolbar，禁掉 Delete/Ctrl+A/S/空格等快捷键；
  // 编辑回调（select/reorder/trim/delete/insert/doubleClick）也一并置 undefined，防止 clip 点击/拖拽裁剪等误触发。
  // 播放头/缩放/播放命令保留 —— 节点 body 作为「可交互预览」而非纯截图。
  const inlineTimelineProps: StoryboardTimelineProps = useMemo(() => ({
    ...timelinePropsBase,
    inline: true,
    readonly: true,
    inlineEmptyHint: data.shots.length === 0 ? t('canvasNodes.workbench.emptyHintPlaceFirst') : undefined,
    onSelectShot: undefined,
    onReorder: undefined,
    onTrim: undefined,
    onInsertAt: undefined,
    onDeleteShot: undefined,
    onDeleteShots: undefined,
    onClipDoubleClick: undefined,
    canBatchGenerate: false,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [timelinePropsBase, data.shots.length, t]);

  return (
    <div style={shellStyle}>
      {data.status === 'generating' ? (
        <GeneratingState
          data={data}
          progressPercent={progressPercent}
          textColor={textColor}
          mutedColor={mutedColor}
          isDark={isDark}
          accent={OPENCUT_ACCENT} />
      ) : (
        <StoryboardTimeline {...inlineTimelineProps} />
      )}

      {tabActive && tabHost ? createPortal(
        <CanvasTabContentBoundary>
          {/* 2026-11-04 出片页布局改造：ensureDefaultShot 兜底保证 shots ≥ 1，
              原「空数据空态 + 新建片段按钮」分支随之移除（不再是空轨道等拖入） */}
          <div
            style={tabEmbeddedStyle(bgPage, isDark, OPENCUT_BG)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer!.dropEffect = 'copy'; }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const files = Array.from(e.dataTransfer?.files ?? []);
              if (files.length > 0) {
                void (async () => {
                  for (const f of files) await uploadFileToCurrentShot(f);
                })();
              }
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <StoryboardMergedTab
                theme={theme}
                isDark={isDark}
                showAssetSidebar={false}
                videoPreviewOnly={true}
                // 2026-11-04：已完成镜头显示只读提示词摘要（提示词区不留空壳）；
                // 无提示词时传 ''（非 undefined）→  merged-tab 渲染「无提示词」占位
                promptReadonlyText={currentShot?.clipState === 'completed'
                  ? (currentShot.media?.prompt || currentShot.videoPrompt || currentShot.imagePrompt || '')
                  : undefined}
                entities={(data.entities ?? []) as StoryboardEntity[]}
                promptSubjectChips={shotSubjects}
                promptExtraActions={promptExtraActions}
                assetPanelProps={{
                  entities: (data.entities ?? []) as StoryboardEntity[],
                }}
                videoStageProps={videoStageProps}
                multitrackProps={{
                  tracks: data.tracks ?? [],
                  data,
                  focusedTrackId,
                  onFocusTrack: setFocusedTrackId,
                  // 2026-11-04 出片页单轨化：不再传 onDropNewTrack / onAddEmptyTrack，
                  // 「+ 拖入素材新建视频轨道」drop 区与新建轨道入口随之下线（数据结构保留）。
                  // 2026-11-04：轨道头（名称/操作条/拖拽排序把手）整列移除，onReorderTracks 随之下线。
                  onMoveShotBetweenTracks: handleMoveShotBetweenTracks,
                }}
                timelineProps={{
                  shots: timelineData,
                  activeShotId: currentShot?.id,
                  pixelsPerSecond: pps,
                  onPixelsPerSecondChange: setPps,
                  onSelectShot: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
                  onReorder,
                  minClipDuration: durationBounds?.min,
                  maxClipDuration: durationBounds?.max,
                  onTrim: (shotId, newDuration, side) => {
                    const shot = data.shots.find((s) => s.id === shotId);
                    if (!shot) return;
                    if (shot.clipState === 'completed' && shot.media) {
                      const trimStart = shot.media.trimStart ?? 0;
                      const trimEnd = shot.media.trimEnd ?? (shot.media.sourceDuration ?? shot.duration);
                      if (side === 'right') {
                        onUpdateShotWithSync(shotId, {
                          duration: newDuration,
                          media: { ...shot.media, trimEnd: trimStart + newDuration },
                          paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
                        });
                      } else {
                        // side === 'left': trim from front, keep end
                        onUpdateShotWithSync(shotId, {
                          duration: newDuration,
                          media: { ...shot.media, trimStart: trimEnd - newDuration },
                          paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
                        });
                      }
                    } else {
                      onUpdateShotWithSync(shotId, {
                        duration: newDuration,
                        paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
                      });
                    }
                  },
                  playheadTime: playhead,
                  onPlayheadTimeChange: setPlayhead,
                  onPlayingChange: setTimelinePlaying,
                  playbackMode,
                  onPlaybackModeChange: setPlaybackMode,
                  playbackCommand,
                  onClipDoubleClick: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
                  onInsertAt,
                  onDeleteShot,
                  onDeleteShots,
                  onExportShot: handleExportShot,
                  onExportAll: () => void handleExportShots(orderedShots),
                  onExportSelected: (ids) => void handleExportShots(orderedShots.filter((s) => ids.includes(s.id))),
                  canExport: exportableCount > 0,
                  onSplitShot: handleSplitShot,
                  onMergeShots: handleMergeShots,
                  // Plan#71 T11：批量生成（全部占位 / 选中占位 → 确认弹窗逐条跑 mock/真实 → 汇总）
                  onBatchGenerateAll: () => {
                    openBatchGenerate(data.shots.map((s) => s.id));
                  },
                  onBatchGenerateSelected: (ids) => {
                    openBatchGenerate(ids);
                  },
                  canBatchGenerate: data.shots.some((s) => s.clipState === 'placeholder' && s.status !== 'generating'),
                  extraToolbarButtons: (data.mediaAssets?.length ?? 0) > 0
                    ? [{ key: 'media', label: `素材 ${data.mediaAssets!.length}`, onClick: () => setMediaOpen(true) }]
                    : [],
                  moreMenuItems: [
                    { key: 'send-to-assets', label: '发送到我的资产', onClick: () => { void handleSendClipsToAssets(); } },
                  ],
                }}
                promptDockProps={currentShot?.clipState === 'placeholder' ? {
                  shotId: currentShot?.id,
                  value: currentShot?.imagePrompt ?? '',
                  // Plan#71 T6：用户编辑提示词/素材即置 manualEdit —— 幂等同步（buildWorkbenchSync）时
                  // buildMergedWorkbenchShots 据此保留用户改动，不被上游语义覆盖
                  onValueChange: (prompt) => currentShot && onUpdateShotWithSync(currentShot.id, { imagePrompt: prompt, manualEdit: true }),
                  references: currentShot?.references ?? [],
                  onReferencesChange: (items) => currentShot && onUpdateShotWithSync(currentShot.id, { references: items, manualEdit: true }),
                  model: currentShot?.model,
                  onModelChange: (m) => currentShot && onUpdateShotWithSync(currentShot.id, { model: m }),
                  paramValues: (currentShot?.paramValues ?? {}) as Record<string, unknown>,
                  onParamValuesChange: (patch) => {
                    if (!currentShot) return;
                    const merged = { ...(currentShot.paramValues ?? {}), ...patch };
                    const updates: Partial<WorkbenchShot> = { paramValues: merged };
                    const d = merged.duration;
                    if (typeof d === 'number' && Number.isFinite(d) && d !== currentShot.duration) {
                      updates.duration = d;
                      if (currentShot.clipState === 'completed' && currentShot.media) {
                        const trimStart = currentShot.media.trimStart ?? 0;
                        updates.media = { ...currentShot.media, trimEnd: trimStart + d };
                      }
                    }
                    onUpdateShotWithSync(currentShot.id, updates);
                  },
                  isRunning: currentShot?.status === 'generating',
                  onGenerate: runVideoGenerate,
                  onStop: runVideoStop,
                  onReplaceRef: (refId) => {
                    if (!currentShot) return;
                    handleReplaceRef(currentShot.id, refId);
                  },
                  onExtractFrame: (slot) => {
                    if (!currentShot || !activeMedia?.storageKey) return;
                    void extractFrameIntoShot(
                      activeMedia.storageKey,
                      slot,
                      `镜头${currentShot.number}${slot === 'first' ? '首帧' : '尾帧'}`,
                    );
                  },
                } : undefined}
              />
            </div>
          </div>
        </CanvasTabContentBoundary>,
        tabHost,
      ) : null}

      <Modal
        title={t('workbench.mediaAssetsTitle', '素材池')}
        open={mediaOpen}
        onCancel={() => setMediaOpen(false)}
        footer={null}
        width={520}
        centered
      >
        <div style={{ fontSize: 12, color: mutedColor, marginBottom: 12 }}>
          {t('workbench.mediaAssetsHint', '生成的视频素材独立留存于此，不随片段删除而丢失；移除仅去掉引用，云端文件不删除。')}
        </div>
        {(data.mediaAssets ?? []).length === 0 ? (
          <div style={{ textAlign: 'center', color: mutedColor, padding: 24 }}>
            {t('workbench.mediaAssetsEmpty', '暂无独立素材')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
            {(data.mediaAssets ?? []).map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 8,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.title || m.storageKey}
                  </span>
                  <span style={{ fontSize: 10, color: mutedColor }}>
                    {m.duration ? `${m.duration}s` : ''}
                    {m.model ? ` · ${m.model}` : ''}
                    {m.fromShotId ? ' · 原片段已删除' : ''}
                  </span>
                </span>
                <Button size="small" danger onClick={() => removeMediaAsset(m.id)}>
                  {t('workbench.removeAsset', '移除')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Plan#71 T11：批量生成确认弹窗（模型/渠道 + 目标占位清单） */}
      <Modal
        title={t('workbench.batchGenerateTitle', '批量生成')}
        open={batchOpen !== null}
        onCancel={() => setBatchOpen(null)}
        okText={t('workbench.batchGenerateOk', '开始生成')}
        cancelText={t('workbench.cancel', '取消')}
        onOk={() => { void runBatchExecute(); }}
        okButtonProps={{ disabled: batchOpen === null }}
        width={520}
        centered
      >
        {batchOpen !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: mutedColor }}>
              {t('workbench.batchGenerateHint', '将逐条调用生成（mock/真实渠道均可）；单条失败不阻断续跑，结束后汇总成功/失败明细。')}
            </div>
            {/* 统一模型/渠道选择（缺省沿用各片已选；空则使用后端推荐/首个可用） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, flexShrink: 0 }}>{t('workbench.batchModel', '统一模型（可留空=沿用各片）')}</span>
              <Select
                allowClear
                placeholder={t('workbench.batchModelPlaceholder', '沿用各片已选 / 自动')}
                style={{ flex: 1 }}
                value={batchModel || undefined}
                onChange={(v) => setBatchModel(v ?? '')}
                options={batchModelOptions}
                size="small"
              />
            </div>
            <div style={{ fontSize: 11, color: mutedColor, maxHeight: 180, overflowY: 'auto', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`, paddingTop: 8 }}>
              {data.shots
                .filter((s) => batchOpen.includes(s.id) && s.clipState === 'placeholder' && s.status !== 'generating')
                .map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 6, padding: '2px 0', fontSize: 12 }}>
                    <span style={{ flexShrink: 0 }}>#{s.number}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.description || s.shotType || '（无描述）'}
                    </span>
                    <span style={{ flexShrink: 0, color: mutedColor, fontSize: 11 }}>{s.duration}s</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
});


// ===== 样式 =====

const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: 16,
  overflow: 'hidden',
};

/** Plan#50:页签内嵌容器(absolute 填满页签内容层,替代原 fixed 全屏 overlay) */
const tabEmbeddedStyle = (background: string, isDark: boolean, opencutBg: string): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: isDark ? opencutBg : background,
});

