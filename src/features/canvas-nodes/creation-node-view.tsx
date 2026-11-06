/**
 * CreationNodeView - 剧创节点(剧本/分镜/出片)共享视图
 *
 * 包裹 BaseNodeView,children 渲染对应独立页面壳(ScriptSheet/StoryboardSheet/WorkbenchSheet)。
 * 数据模型(独立页面壳版本):
 * - 节点不依赖任何创作项目,内容直接写入 node.data,随画布 Yjs 同步。
 * - 剧本节点:episodes/activeEpisodeId 持久化到 node.data,随画布 Yjs 同步。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Aperture, Film, FileText, BookOpen, Maximize, Sparkles, FileUp } from 'lucide-react';
import { ResizeNodeCommand, type NodeRendererProps } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView } from '@zeroexo/plugin-nodes';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { StoryboardNodeData } from './storyboard/storyboard-types.js';
import type { WorkbenchNodeData, WorkbenchShot } from './storyboard/workbench-types.js';
import { buildWorkbenchSync } from './storyboard/workbench-sync';
import type { CreationNodeType } from './creation-node-types.js';
import { CREATION_DEFAULT_SIZE, CREATION_EMPTY_SIZE } from './creation-node-types.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import { autoEpisodeTitle } from '@/entities/script-store.js';
import type { ChapterAnchor } from '@/shared/utils/episode-marker-detector.js';
import { serializeScriptLines, createScriptLine } from '@/features/canvas-nodes/script-editor/script-lines.js';
import { useReactGraphStore, useGraph } from '@zeroexo/plugin-render-react';
import { ScriptEditorSheet } from './storyboard/script-editor-sheet.js';
import { NovelNodeSheet } from './storyboard/novel-node-sheet.js';
import { StoryboardSheet } from './storyboard/storyboard-sheet.js';
import { WorkbenchSheet } from './storyboard/workbench-sheet.js';
import { CreationNodeEmptyCard } from './creation-node-empty-card.js';
import { StoryboardGeneratingLoader } from './storyboard/components/StoryboardGeneratingLoader.js';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { requestNodeDockExpand } from '@/features/tools-dock/node-generate-dock.js';
import type { SubjectTree } from './storyboard/subject-tree-types';

/**
 * 出片节点重连分镜的合并策略（2026-08-31 初版；2026-09-03 Plan#71 T6 增强）：
 * 不再全量覆盖本地 shots，而是按 sourceShotId 合并——
 * - 本地已删除的上游镜头（deletedSourceShotIds）不复活
 * - 上游仍存在的镜头：
 *   - 本地产物已生成（clipState=completed）或用户已编辑（manualEdit / 自填 prompt / 自有 references）→ **保留不动**（幂等，T6）
 *   - 仍为空占位 → 同步内容字段 + 回填 references + 预填 videoPrompt（T6）
 * - 上游新增镜头：追加占位 clip（含 references 回填 + 提示词预填，T6）
 * - 本地补拍/拖入的无源镜头：保留在末尾
 *
 * T6 references 回填数据源 = 上游分镜节点 data（subjectTree + 主体字典并集），
 * 见 workbench-ref-builder.ts（buildRefsFromSource/buildPromptPreview）。
 * 合并实现已迁至 workbench-sync.ts（buildWorkbenchSync / buildMergedWorkbenchShots）。
 */

export interface CreationNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  kind: CreationNodeType;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: any;
}

/** 各剧创节点头部图标(使用 CSS var(--zx-invk) 连续缩放,与 NodeShell 标题文本 font-size 对齐)
 * 之前的 Math.max(9, Math.min(13 * invK, 16)) 紧钳位导致缩放后图标比文本小(BUG 2026-09-02)。
 * 改用 CSS calc() 使图标与文本同比例缩放: 文本=11px×invK, 图标=13px×invK, 比例始终一致。 */
const KIND_ICON = (_invK: number): Record<CreationNodeType, React.ReactNode> => {
  const cssSize = `calc(13px * var(--zx-invk, 1))` as unknown as number | undefined;
  const style = { width: cssSize, height: cssSize };
  return {
    script: <FileText size={13} style={style} />,
    storyboard: <Aperture size={13} style={style} />,
    workbench: <Film size={13} style={style} />,
    novel: <BookOpen size={13} style={style} />,
  };
};

export function CreationNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  externalRenaming,
  onRenameFinish,
  connectionController,
  kind,
  store,
  commandQueue,
}: CreationNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();

  const data = (node.data ?? {}) as Record<string, unknown>;
  // 剧本剧集(持久化到 node.data.episodes) + 当前选中集
  // 向后兼容:旧节点仅有 data.content(单集 HTML)而无 episodes,则从 content 迁移出首集
  const episodes = useMemo<Episode[]>(() => {
    const eps = (data.episodes as Episode[] | undefined) ?? [];
    if (eps.length > 0) return eps;
    const legacyContent = (data.content as string | undefined) ?? '';
    if (!legacyContent) return [];
    return [{ id: 'ep-1', number: 1, title: '第1集', content: legacyContent }];
  }, [data.episodes, data.content]);
  const activeEpisodeId = (data.activeEpisodeId as string | undefined) ?? episodes[0]?.id ?? '';
  // 分镜数据（useMemo 稳定引用，避免 StoryboardSheet 不必要的重渲染）
  // 2026-08-30 修复：白名单必须覆盖 StoryboardNodeData 全部字段——
  // 缺 productionItems/aiSubjects 等会导致主体库(剧管合并)读空、写回后 UI 不刷新
  // 2026-09-03 修复（主体编辑刷新后丢失）：补上 2026-08-31 主体树重构
  // 新增的 subjectTree/subjectAiIndex/colorCard/aiMemory —— 写回 node.data 后若读回白名单
  // 缺这些字段，主体树在组件重挂载/刷新后永远读空，表现为「编辑没持久化」。
  const storyboardData: StoryboardNodeData = useMemo(() => ({
    shots: (data.shots as StoryboardNodeData['shots']) ?? [],
    entities: (data.entities as StoryboardNodeData['entities']) ?? [],
    status: (data.status as StoryboardNodeData['status']) ?? 'idle',
    progress: (data.progress as StoryboardNodeData['progress']),
    sourceScriptId: (data.sourceScriptId as string | undefined),
    activeEpisodeId: (data.activeEpisodeId as string | undefined),
    shotsByEpisode: (data.shotsByEpisode as StoryboardNodeData['shotsByEpisode']),
    statusByEpisode: (data.statusByEpisode as StoryboardNodeData['statusByEpisode']),
    progressByEpisode: (data.progressByEpisode as StoryboardNodeData['progressByEpisode']),
    steps: (data.steps as StoryboardNodeData['steps']),
    conflicts: (data.conflicts as StoryboardNodeData['conflicts']),
    aiSubjects: (data.aiSubjects as StoryboardNodeData['aiSubjects']),
    productionManagerId: (data.productionManagerId as string | undefined),
    productionItems: (data.productionItems as StoryboardNodeData['productionItems']),
    subjectTree: (data.subjectTree as StoryboardNodeData['subjectTree']),
    subjectAiIndex: (data.subjectAiIndex as StoryboardNodeData['subjectAiIndex']),
    colorCard: (data.colorCard as StoryboardNodeData['colorCard']),
    aiMemory: (data.aiMemory as StoryboardNodeData['aiMemory']),
  }), [data.shots, data.entities, data.status, data.progress, data.sourceScriptId, data.activeEpisodeId, data.shotsByEpisode, data.statusByEpisode, data.progressByEpisode, data.steps, data.conflicts, data.aiSubjects, data.productionManagerId, data.productionItems, data.subjectTree, data.subjectAiIndex, data.colorCard, data.aiMemory]);
  // 出片工作台数据
  // 2026-09-03 Plan#71 T6 补全白名单：缺失 entities/mediaAssets/deletedSourceShotIds
  // 会导致 resync 合并后 UI 读空（同 storyboardData 2026-08-30 教训）。
  const workbenchData: WorkbenchNodeData = useMemo(() => ({
    status: (data.status as WorkbenchNodeData['status']) ?? 'idle',
    shots: (data.shots as WorkbenchNodeData['shots']) ?? [],
    totalDuration: (data.totalDuration as number) ?? 0,
    completedCount: (data.completedCount as number) ?? 0,
    sourceStoryboardId: (data.sourceStoryboardId as string | undefined),
    sourceProductionManagerId: (data.sourceProductionManagerId as string | undefined),
    deletedSourceShotIds: (data.deletedSourceShotIds as WorkbenchNodeData['deletedSourceShotIds']),
    mediaAssets: (data.mediaAssets as WorkbenchNodeData['mediaAssets']),
    entities: (data.entities as WorkbenchNodeData['entities']),
    aiMemory: (data.aiMemory as WorkbenchNodeData['aiMemory']),
    scriptSummary: (data.scriptSummary as WorkbenchNodeData['scriptSummary']),
    report: (data.report as WorkbenchNodeData['report']),
    subjectTrees: (data.subjectTrees as WorkbenchNodeData['subjectTrees']),
    tracks: (data.tracks as WorkbenchNodeData['tracks']),
  }), [data.status, data.shots, data.totalDuration, data.completedCount, data.sourceStoryboardId, data.sourceProductionManagerId, data.deletedSourceShotIds, data.mediaAssets, data.entities, data.aiMemory, data.scriptSummary, data.report, data.subjectTrees, data.tracks]);
  // 标签显隐开关持久化到 node.data(全屏编辑使用)
  const showLabels = data.showLabels !== false;

  const nodeColor = theme.node.fill;
  const title = node.title ?? (data.title as string) ?? t(`canvasNodes.stage.${kind}`);

  // ===== Plan#74 Phase G：未生成态统一空态卡（3:4，单一共享组件）=====
  // 空态判定：script 无 episodes / storyboard 无任何 shots / workbench idle 无 shots；novel 恒有内容不适用
  const storyboardHasShots = (storyboardData.shots?.length ?? 0) > 0
    || Object.values(storyboardData.shotsByEpisode ?? {}).some((ep) => Array.isArray(ep) && ep.length > 0);
  const isCreationEmpty =
    kind === 'script' ? episodes.length === 0
      : kind === 'storyboard' ? !storyboardHasShots
        : kind === 'workbench' ? workbenchData.status === 'idle' && (workbenchData.shots?.length ?? 0) === 0
          : false;
  // Plan#77 U4：Agent 两段式生成空窗期（status='generating' 且尚无任何内容）→ 渲染落点骨架屏，
  // 产物 update_node 到达后本壳切换真实内容（自愈 effect 恢复基准尺寸）。超时防呆见下方 effect。
  const isGenerationPending = data.status === 'generating'
    && episodes.length === 0
    && (storyboardData.shots?.length ?? 0) === 0
    && Object.keys(storyboardData.shotsByEpisode ?? {}).length === 0
    && (workbenchData.shots?.length ?? 0) === 0;
  const openTab = useCanvasTabStore((s) => s.openTab);
  const myTabKey = buildTabKey(kind as 'script' | 'storyboard' | 'workbench', node.id);
  // 2026-11-04 单例槽位改造：本节点是否为流水线槽位绑定节点。
  // 剧本槽位绑定的是资产 id（非节点 id），故画布上所有遗留剧本节点一律为非槽位（只读保留）。
  const slotBoundId = useCanvasTabStore((s) =>
    kind === 'storyboard' || kind === 'workbench' || kind === 'script' ? s.slotBindings[kind] : null);
  const isSlotNode = slotBoundId !== null && slotBoundId === node.id;
  // 全屏页签激活时即使空态也必须渲染 sheet（sheet 通过 portal 向页签宿主渲染全屏编辑器），
  // 否则空节点点「全屏编辑」页签内空白无法编辑（Phase G 回归修复）
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const handleOpenFullscreen = useCallback(() => {
    openTab({ kind: kind as 'script' | 'storyboard' | 'workbench', id: node.id, title });
  }, [openTab, kind, node.id, title]);
  // Plan#79 T3：「AI帮我写」= 展开节点下方的提示词 dock（**不再直接弹 Agent 面板**）。
  // Agent 面板只在 dock 内点「生成」投递时才打开，且以 @节点引用的形态进聊天气泡。
  const handleOpenPromptDock = useCallback(() => {
    // dock 仅在本节点成为画布选中节点时才挂载,<｜hy_place▁holder▁no▁813｜>口径此前依赖节点点击选中;
    // 这里显式补一次选中,杜绝「点了 AI帮我写没反应」。
    store?.setSelection?.({ selectedNodeIds: new Set([node.id]), selectedEdgeIds: new Set() });
    requestNodeDockExpand(node.id);
  }, [node.id, store]);
  const handleImportNovel = useCallback(() => {
    nodeActionBus.emit('novel:import-from-script', { nodeId: node.id });
  }, [node.id]);
  const emptyIcon = kind === 'script' ? FileText : kind === 'storyboard' ? Aperture : Film;
  const emptyActions = useMemo(() => {
    // 2026-11-04 单例槽位改造：非槽位的遗留节点（多实例旧图的第 2..N 个、遗留剧本节点）
    // 只读保留——空态卡不提供任何编辑入口（编辑统一走顶部固定槽位页签）。
    if ((kind === 'script' || kind === 'storyboard' || kind === 'workbench') && !isSlotNode) return [];
    // Plan#79 T3（2026-09-07 文案约定）：「全屏编辑」→「我自己写」、「AI生成」→「AI帮我写」、「导入长文本」→「导入小说」
    const writeBySelf = { key: 'fullscreen', icon: Maximize, label: t('canvasNodes.writeBySelf', '我自己写'), onClick: handleOpenFullscreen };
    const aiWrite = { key: 'ai', icon: Sparkles, label: t('canvasNodes.aiWrite', 'AI帮我写'), onClick: handleOpenPromptDock };
    if (kind === 'script') {
      return [writeBySelf, aiWrite, { key: 'import', icon: FileUp, label: t('scriptEditor.importNovel', '导入小说'), onClick: handleImportNovel }];
    }
    if (kind === 'storyboard') return [writeBySelf, aiWrite];
    return [writeBySelf];
  }, [kind, isSlotNode, t, handleOpenFullscreen, handleOpenPromptDock, handleImportNovel]);

  // 稳定化 data 引用：避免 handleXxx 闭包捕获过时数据
  const dataRef = useRef(data);
  dataRef.current = data;
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;
  const activeEpisodeIdRef = useRef(activeEpisodeId);
  activeEpisodeIdRef.current = activeEpisodeId;
  const workbenchDataRef = useRef(workbenchData);
  workbenchDataRef.current = workbenchData;

  // 剧本剧集变更 → 回写 node.data.episodes(随画布 Yjs 同步)
  const handleEpisodesChange = useCallback(
    (nextEpisodes: Episode[]) => {
      const currentData = dataRef.current;
      console.log('[CreationNodeView] handleEpisodesChange called, episodes count:', nextEpisodes.length, 'first episode content length:', nextEpisodes[0]?.content?.length ?? 0);
      updateNode({ data: { ...currentData, episodes: nextEpisodes, status: 'ready' } });
    },
    [updateNode],
  );

  // 当前剧集变更 → 回写 node.data.activeEpisodeId
  const handleActiveEpisodeChange = useCallback(
    (id: string) => {
      const currentActiveId = activeEpisodeIdRef.current;
      if (id === currentActiveId) return;
      const currentData = dataRef.current;
      updateNode({ data: { ...currentData, activeEpisodeId: id } });
    },
    [updateNode],
  );

  // 复合更新(同时写入 episodes + activeEpisodeId,避免 stale closure)
  const handleEpisodesAndActiveChange = useCallback(
    (nextEpisodes: Episode[], nextActiveId?: string) => {
      const currentData = dataRef.current;
      const patch: Record<string, unknown> = { episodes: nextEpisodes, status: 'ready' };
      if (nextActiveId !== undefined) {
        patch.activeEpisodeId = nextActiveId;
      }
      updateNode({ data: { ...currentData, ...patch } });
    },
    [updateNode],
  );

  // 新增剧集:根据当前最大编号生成新集,并自动创建一个空段落
  const handleAddEpisode = useCallback(() => {
    const currentEpisodes = episodesRef.current;
    const currentData = dataRef.current;
    const maxNumber = currentEpisodes.reduce((max, ep) => Math.max(max, ep.number), 0);
    const newEp: Episode = {
      id: `ep-${Date.now()}`,
      number: maxNumber + 1,
      // 2026-11-04：新增集标题统一 autoEpisodeTitle（禁止自拼字符串）
      title: autoEpisodeTitle(maxNumber + 1),
      content: serializeScriptLines([createScriptLine('action', '')]),
    };
    const nextEpisodes = [...currentEpisodes, newEp];
    updateNode({ data: { ...currentData, episodes: nextEpisodes, activeEpisodeId: newEp.id, status: 'ready' } });
  }, [updateNode]);

  // 本地版（2026-11-02）：剧本不再落画布节点 —— 剧本由顶部页签承载（剧本资产 = 数据事实源）。
  // 老画布里的剧本节点仍可渲染与编辑，其内容经「加入资产库」写回绑定剧本资产。

  // 标签显隐开关变更 → 回写 node.data.showLabels
  const handleShowLabelsChange = useCallback(
    (next: boolean) => {
      if (next === showLabels) return;
      updateNode({ data: { ...data, showLabels: next } });
    },
    [updateNode, data, showLabels],
  );

  // 分镜数据变更 → 回写 node.data
  const handleStoryboardDataChange = useCallback(
    (next: StoryboardNodeData) => {
      updateNode({ data: { ...data, ...next } });
    },
    [updateNode, data],
  );

  // novel 节点数据变更（Plan#75 D5：编辑保存重算 chapters / 存量惰性补 chapters 回写）
  const handleNovelDataChange = useCallback(
    (patch: Record<string, unknown>) => {
      updateNode({ data: { ...data, ...patch } });
    },
    [updateNode, data],
  );

  // 出片工作台数据变更 → 回写 node.data
  const handleWorkbenchDataChange = useCallback(
    (next: WorkbenchNodeData) => {
      updateNode({ data: { ...data, ...next } });
    },
    [updateNode, data],
  );

  // 当前出片节点的上游分镜连接检测(命名 graphStore 避免与 props 的 store 重复标识)
  const graphStore = useReactGraphStore();
  const graph = useGraph(graphStore);

  // 出片节点：统一导入制多轨同步（Plan#74 E2）
  // 替换原 syncFromGraph 与按需重连两条重复同步链路：
  // 连入分镜 → buildWorkbenchSync 建 active 轨；同分镜断开重连 → 验差异建 candidate 轨。
  const prevSourceOriginsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (kind !== 'workbench') return;
    // 收集当前指向本节点的来源：分镜 (storyboard) + 媒体 (video, Q2 新)
    const connectedOrigins = new Set<string>();
    const connectedVideos = new Set<string>();
    for (const e of graph.edges) {
      if (e.target?.nodeId === node.id && e.source?.nodeId) {
        const sn = graph.nodes.find((n) => n.id === e.source?.nodeId);
        if (sn?.type === 'storyboard') connectedOrigins.add(sn.id);
        else if (sn?.type === 'video') connectedVideos.add(sn.id);
      }
    }
    const allKnownOrigins = new Set([...connectedOrigins, ...connectedVideos]);
    // 逐源处理「由无→有」的连接/重连
    let acc = workbenchDataRef.current;
    let didWrite = false;
    // PE3：来源断开（storyboard 或 video）→ 该源全部轨归档 discarded（保留 clips 快照，不丢用户已排）
    // 并从 prevSourceOriginsRef 移除，让下次重连能重新处理
    const removedOrigins = [...prevSourceOriginsRef.current].filter((o) => !allKnownOrigins.has(o));
    if (removedOrigins.length > 0) {
      let touched = false;
      const tracks = (acc.tracks ?? []).map((t) => {
        if (t.status !== 'discarded' && removedOrigins.includes(t.sourceChain.origin)) {
          touched = true;
          return { ...t, status: 'discarded' as const };
        }
        return t;
      });
      if (touched) {
        acc = { ...acc, tracks };
        didWrite = true;
      }
      // 断连 → 清出 ref，让重连时重新跑处理
      for (const rm of removedOrigins) prevSourceOriginsRef.current.delete(rm);
    }
    for (const origin of connectedOrigins) {
      if (prevSourceOriginsRef.current.has(origin)) continue; // 未变化，跳过
      const sourceNode = graph.nodes.find((n) => n.id === origin);
      if (!sourceNode) continue;
      const sourceData = (sourceNode.data ?? {}) as Record<string, unknown>;
      const sourceShots = (sourceData.shots ?? []) as Array<Record<string, any>>;
      if (!Array.isArray(sourceShots) || sourceShots.length === 0) continue; // 尚无镜头 → 不入库，等下次 source 刷新再试
      const hasTrack = (acc.tracks ?? []).some((t) => t.sourceChain.origin === origin);
      const r = buildWorkbenchSync({
        sourceNode: {
          id: origin,
          title: typeof sourceNode.title === 'string' ? sourceNode.title : String(sourceData.title ?? ''),
        },
        sourceShots,
        sourceData,
        current: acc,
        event: hasTrack ? 'reconnect' : 'connect',
      });
      if (!r.changed && acc.status !== 'idle') continue; // 无差异，不写（避免 Yjs 抖动）
      const sourceSubjectTrees = Array.isArray(sourceData.subjectTree) ? (sourceData.subjectTree as SubjectTree[]) : undefined;
      const sourceEntities = Array.isArray(sourceData.entities) ? (sourceData.entities as WorkbenchNodeData['entities']) : undefined;
      acc = {
        ...acc,
        status: r.status,
        shots: r.shots,
        tracks: r.tracks,
        totalDuration: r.totalDuration,
        sourceStoryboardId: origin,
        subjectTrees: sourceSubjectTrees ?? acc.subjectTrees,
        entities: sourceEntities ?? acc.entities,
      };
      didWrite = true;
      // 成功写入 → 入库 ref，后续跳过
      prevSourceOriginsRef.current.add(origin);
    }
    // Q2: video 节点连入 → 在该 video 专属 track 末尾追加 completed clip（不占分镜唯一槽）
    for (const videoId of connectedVideos) {
      if (prevSourceOriginsRef.current.has(videoId)) continue; // 已成功处理过，跳过
      const videoNode = graph.nodes.find((n) => n.id === videoId);
      if (!videoNode) continue;
      const vd = (videoNode.data ?? {}) as Record<string, unknown>;
      const storageKey = String(vd.storageKey ?? vd.content ?? '');
      if (!storageKey) continue; // 媒体 key 缺失 → 暂不入库 ref，等下次 data 刷新重试
      const srcDurSec = typeof vd.durationMs === 'number'
        ? (vd.durationMs as number) / 1000
        : (typeof vd.duration === 'number' ? (vd.duration as number) : 5);
      const vTitle = (typeof videoNode.title === 'string' && videoNode.title) || (vd.title as string) || '视频素材';
      const existingTrack = (acc.tracks ?? []).find((t) => t.sourceChain.origin === videoId);
      const trackId = existingTrack?.id ?? `track-video-${videoId.slice(-6)}`;
      const clips = existingTrack?.clips ?? [];
      const startMs = clips.reduce((ms, c) => Math.max(ms, c.timeline.startMs + c.timeline.durationMs), 0);
      const clipId = `vid-${videoId.slice(-6)}-${Date.now()}`;
      const newClips = [...clips, {
        id: clipId,
        ref: { sourceShotId: clipId, kind: 'media' as const, sourceKey: storageKey },
        timeline: { startMs, durationMs: Math.max(1, srcDurSec) * 1000 },
        instanceData: {
          id: clipId,
          number: clips.length + 1,
          description: vTitle,
          shotType: 'video',
          duration: srcDurSec,
          clipState: 'completed' as const,
          media: {
            storageKey,
            title: vTitle,
            source: 'external' as const,
            sourceDuration: srcDurSec,
          },
        },
      }];
      const trackEntry = {
        id: trackId,
        name: `视频素材 · ${vTitle}`,
        sourceChain: { origin: videoId, label: 'video' },
        status: 'active' as const,
        order: (acc.tracks?.length ?? 0) + 1,
        clips: newClips,
      };
      const tracks = existingTrack
        ? (acc.tracks ?? []).map((t) => (t.id === trackId ? trackEntry : t))
        : [...(acc.tracks ?? []), trackEntry];
      // video clip 同时镜像到 shots 数组（兼容渲染层读取 data.shots 的逻辑）
      const newShot = (newClips[newClips.length - 1] as { instanceData: WorkbenchShot }).instanceData;
      acc = {
        ...acc,
        status: acc.status === 'idle' ? ('ready' as const) : acc.status,
        shots: [...(acc.shots ?? []), newShot],
        tracks,
      };
      didWrite = true;
      // 成功处理 → 入库 ref
      prevSourceOriginsRef.current.add(videoId);
    }
    if (didWrite) {
      updateNode({ data: { ...dataRef.current, ...acc } });
    }
    // NOTE：不再无条件覆盖 prevSourceOriginsRef = allKnownOrigins（旧逻辑会让 storageKey
    // 缺失的 media 节点永久跳过），改为在上面各分支里「成功才入库」+ 断连分支里「移除」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, node.id, graph, updateNode]);

  // Plan#74 Phase G：空态 3:4 卡（261×348）↔ 有内容恢复各自基准尺寸（自愈，含存量节点）
  // 走 ResizeNodeCommand（updateNode 只处理 data/title，size 补丁会被静默丢弃）
  useEffect(() => {
    if (!commandQueue) return;
    // novel 不参与自愈校准：其固定尺寸由创建基准尺寸 + resizable:false 保证。
    // 若在此反复发 ResizeNodeCommand，会与画布布局对抗、打开查看/滚动时重渲染反复抖动 → 画布节点乱动。
    if (kind === 'novel') return;
    const target = isCreationEmpty ? CREATION_EMPTY_SIZE : CREATION_DEFAULT_SIZE[kind];
    const w = node.size?.width ?? 0;
    const h = node.size?.height ?? 0;
    if (w === target.width && h === target.height) return;
    // workbench 固定尺寸不可 resize → 始终纠正到目标（含存量 3:4 遗留节点）
    // script/storyboard：空态强制锁空态卡(用户无法在空态改尺寸)；具体态仅从空态尺寸恢复时纠正(已改尺寸不打架)
    const isFixed = kind === 'workbench';
    const isSnappingFromEmpty = w === CREATION_EMPTY_SIZE.width && h === CREATION_EMPTY_SIZE.height;
    if (!isFixed && !isCreationEmpty && !isSnappingFromEmpty) return;
    const { x, y } = node.position;
    commandQueue.execute(
      new ResizeNodeCommand(node.id, { x, y, width: w, height: h }, { x, y, width: target.width, height: target.height }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isCreationEmpty, node.id, node.size?.width, node.size?.height, commandQueue]);

  // 空态节点胶囊「全屏编辑/编辑」代收事件 → 直接开页签。
  // sheet 订阅链(script:edit / storyboard:fullscreen / workbench:fullscreen)仅在非空态生效：
  // 空态时 sheet 未挂载、无人响应，胶囊点了打不开页签（回归）。这里空态时在本壳统一代收，
  // openTab 幂等，非空态仍由 sheet 订阅处理（双触发无副作用）。
  const openFullscreenTab = useCallback(
    (k: CreationNodeType) => {
      if (k === 'novel') return;
      openTab({ kind: k as 'script' | 'storyboard' | 'workbench', id: node.id, title });
    },
    [openTab, node.id, title],
  );
  useEffect(() => {
    // 2026-11-04 单例槽位改造：非槽位遗留节点不代收全屏事件（只读保留，不给打开页签的错觉）
    if (!isCreationEmpty || kind === 'novel' || !isSlotNode) return;
    const eventKey = kind === 'script'
      ? 'script:edit'
      : kind === 'storyboard' ? 'storyboard:fullscreen' : 'workbench:fullscreen';
    const unsub = nodeActionBus.on(eventKey, (e: { nodeId: string }) => {
      if (e.nodeId === node.id) openFullscreenTab(kind);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isCreationEmpty, node.id, openFullscreenTab]);

  // Plan#77 U4：落点骨架超时防呆——Agent 两段式中断/失联导致 generating 永挂时，60s 后降级回空态卡。
  // 归 'idle' 而非 'ready'：workbench 空态判定依赖 status==='idle'，归 ready 会跳过空态卡直接渲染空 sheet。
  useEffect(() => {
    if (!isGenerationPending) return;
    const timer = window.setTimeout(() => {
      updateNode({ data: { ...dataRef.current, status: 'idle' } });
    }, 60_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerationPending, node.id]);

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={title}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      invK={invK}
      titleIcon={KIND_ICON(invK ?? 1)[kind]}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      contentPadding="0"
      store={store}
    >
      <div style={contentShellStyle}>
        {isGenerationPending && !tabActive ? (
          // Plan#77 U4：落点骨架屏——盖过空态卡，避免生成空窗期误导用户点按钮
          <StoryboardGeneratingLoader status="generating" />
        ) : isCreationEmpty && !tabActive ? (
          <CreationNodeEmptyCard icon={emptyIcon} actions={emptyActions} />
        ) : kind === 'script' ? (
          <ScriptEditorSheet
            nodeId={node.id}
            title={title}
            episodes={episodes}
            activeEpisodeId={activeEpisodeId}
            onEpisodesChange={handleEpisodesChange}
            onActiveEpisodeChange={handleActiveEpisodeChange}
            onEpisodesAndActiveChange={handleEpisodesAndActiveChange}
            onAddEpisode={handleAddEpisode}
            showLabels={showLabels}
            onShowLabelsChange={handleShowLabelsChange}
          />
        ) : kind === 'storyboard' ? (
          <StoryboardSheet nodeId={node.id} data={storyboardData} onDataChange={handleStoryboardDataChange} />
        ) : kind === 'novel' ? (
          <NovelNodeSheet
            nodeId={node.id}
            storageKey={typeof data.storageKey === 'string' ? data.storageKey : undefined}
            title={typeof data.title === 'string' ? data.title : undefined}
            wordCount={typeof data.wordCount === 'number' ? data.wordCount : undefined}
            chapters={Array.isArray(data.chapters) ? (data.chapters as ChapterAnchor[]) : undefined}
            onDataChange={handleNovelDataChange}
          />
        ) : (
          <WorkbenchSheet nodeId={node.id} data={workbenchData} onDataChange={handleWorkbenchDataChange} />
        )}
      </div>
    </BaseNodeView>
  );
}

const contentShellStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
  position: 'relative',
};