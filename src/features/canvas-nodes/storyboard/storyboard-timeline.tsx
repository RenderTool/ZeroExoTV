/**
 * StoryboardTimeline - 分镜生产台时间轴（Plan#53 T8）
 *
 * 以 freecut-main timeline 契约层为蓝本（store/hooks/utils 管状态与交互，
 * mini-timeline scrub 引擎搬帧级水平缩放），workbench-track 仅借视觉层
 * （状态配色/缩放控件/标尺样式）。
 *
 * 验收硬标准：带间距 clip + 外部 trim handle + 拖拽排序 + 选中高亮 +
 * 帧级水平缩放看清每一帧。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent, type ReactElement, type CSSProperties } from 'react';
// 图标铁律（经验 #19）：播放语义图标一律走模块级 icons.ts Map，禁止散落内联 lucide
import { Plus, Trash2, Pause, ChevronsLeft, ChevronsRight, MoreHorizontal, Download, Wand2, Copy } from 'lucide-react';
import { CANVAS_NODE_ICONS } from '../icons.js';
import { resolveVideoDurationSec } from './storyboard-utils';
import type { Asset } from '@/features/asset-picker/index.js';
import {
  TRACK_HEIGHT, RULER_HEIGHT, CLIP_GAP, CLIP_MIN_WIDTH,
  RULER_PADDING_LEFT, DEFAULT_MIN_CLIP_DURATION, DEFAULT_MAX_CLIP_DURATION, FRAME_STEP_SEC,
  MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND, FRAME_FPS,
  createScrubThrottleState, shouldCommitScrubFrame,
  timelinePalette,
  type TimelineClipData, type StoryboardTimelineProps,
} from './timeline-constants.js';
import { TimelineClip } from './timeline-clip.js';
import { computeInsertIndex, insertSeamX, clipPlaceholderWidth, movedClipLeft } from './storyboard-drop-point';
import { capsuleTransparentStyle } from '../../tools-dock/capsbtn.js';

/** 拖拽插入占位框样式（2026-09-02 约定：整段蓝色虚线占位，替代单线指示） */
function dropPlaceholderStyle(isDark: boolean, left: number, width: number, height: number = TRACK_HEIGHT) {
  return {
    position: 'absolute' as const,
    left,
    top: 7,
    width,
    height,
    border: `1.5px dashed ${isDark ? 'rgba(96,165,250,0.9)' : 'rgba(59,130,246,0.9)'}`,
    background: isDark ? 'rgba(96,165,250,0.16)' : 'rgba(59,130,246,0.12)',
    borderRadius: 4,
    boxSizing: 'border-box' as const,
    zIndex: 15,
    pointerEvents: 'none' as const,
  };
}
/** 外部素材时长未知时占位框的兜底宽（px） */
const EXTERNAL_PLACEHOLDER_FALLBACK_WIDTH = 80;

// Re-export for backward compatibility (storyboard-merged-tab.tsx depends on these)
export type { TimelineClipData, StoryboardTimelineProps };

export const StoryboardTimeline = memo(function StoryboardTimeline({
  shots, activeShotId, pixelsPerSecond, onPixelsPerSecondChange, onSelectShot, onReorder, onTrim,
  minClipDuration, maxClipDuration,
  playheadTime = 0, onPlayheadTimeChange, onPlayingChange, onPlaybackModeChange, playbackCommand, onClipDoubleClick, onInsertAt, onDeleteShot, onDeleteShots,
  onExportShot, onExportAll, onExportSelected, canExport,
  onBatchGenerateAll, onBatchGenerateSelected, canBatchGenerate,
  extraToolbarButtons, moreMenuItems, t, theme, isDark,
  inline, inlineEmptyHint, readonly = false, hideToolbar = false, hideRuler = false, hidePlayhead = false,
  allowDragPropagation,
  enableWheelScroll,
  onClipDragStart,
  /** Plan#83: 片段间间隙（px）。出片工作台多轨模式传 0 → 片段首尾相接铺满轨道不留白 */
  clipGap = CLIP_GAP,
  /** 2026-11-04 导演台 H3：片段内容层附加层（延续标记等，与片段同滚动/transform/pps） */
  contentOverlay,
  /** 2026-11-04 导演台：片段文字单行版式（镜头号 N · Xs），仅导演台路径传 'director' */
  clipLabelMode,
  /** 2026-11-04 导演台导轨零基线：内容左内边距（默认 RULER_PADDING_LEFT；导演台传 0） */
  contentInsetLeft,
  /** 2026-11-04 导演台导轨：横向滚动交给外层容器（body overflowX=visible、不接管滚轮） */
  outerScroll = false,
  /** 2026-11-04 拖拽重做：true = 拖拽由宿主接管（pointerdown 只记起点，不启动内部鬼影/提交） */
  clipDragExternal = false,
  /** 2026-11-04 拖拽实时预览（drag-spec.md）：宿主驱动的幽灵跟手+实时让位预览态 */
  externalClipPreview = null,
  /** 2026-11-05 导演台固定宽度片段卡片：设定后 clip 宽度恒为该值（等宽卡片，不再 duration×pps） */
  cardWidth,
  /** 2026-11-05 导演台卡片高度（缩略框 + 标签行）；缺省 = TRACK_HEIGHT（出片页零变化） */
  cardHeight,
  /** 2026-11-05 导演台缩略框播放键：点击 = 打开右侧预览并切到该段 */
  onDirectorPlay,
  /** 2026-11-05 导演台：关闭时长拖拽（trim handle / ew-resize / onTrim 写回）；缺省 true = 出片页不变 */
  trimEnabled = true,
  /** 2026-11-05 导演台：去掉容器顶部横向边线；缺省 false = 出片页不变 */
  noTopBorder = false,
  /* 2026-11-04 第八条B：clipChecks（片段内勾选框）已整块移除 */
}: StoryboardTimelineProps): ReactElement {
  /** 内容左内边距：默认 RULER_PADDING_LEFT（出片页零变化）；导演台零基线传 0（片段起点=刻度 0） */
  const inset = contentInsetLeft ?? RULER_PADDING_LEFT;
  /** 2026-11-05 导演台卡片行高：片段卡片高度 + 上下余量 16（出片页保持 TRACK_HEIGHT+16） */
  const resolvedCardHeight = cardHeight ?? TRACK_HEIGHT;
  const trackRowHeight = resolvedCardHeight + 16;
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 鼠标是否悬停在时间轴区域（Delete 键删除片段仅在悬停时生效，避免与画布删除节点冲突） */
  const [hovering, setHovering] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 内部拖拽：被拖 clip 的跟手偏移（px）——2026-09-02 鬼影方案，被拖 clip translateX 跟手滑行 */
  const [dragOffset, setDragOffset] = useState(0);
  /** 内部拖拽：目标插入下标（松手落定的 splice 位置；null=未拖动/回原位） */
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  /** 外部素材拖入：插入下标 0..len（与占位框/drop 同源，2026-09-02 约定：占位框位置即插入位置） */
  const [externalDropIdx, setExternalDropIdx] = useState<number | null>(null);
  /** 外部素材拖入：占位框宽度 px（dragEnter 读素材时长算得；null=时长未知用兜底宽） */
  const [externalDropWidth, setExternalDropWidth] = useState<number | null>(null);
  /** T8: 裁剪时间气泡（位置 + 文本；仅出片页 trimEnabled=true 时使用） */
  const [trimBubble, setTrimBubble] = useState<{ x: number; y: number; text: string } | null>(null);
  /** 右键菜单状态 */
  const [contextMenu, setContextMenu] = useState<{ shotId: string; x: number; y: number } | null>(null);
  /** 多选（Ctrl/Shift+click / 框选 / Ctrl+A）选中镜头 id 集合 */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  /** 框选（2026-09-02 画布式矩形选框，内容坐标 x 范围；null=无框选） */
  const [rubberRange, setRubberRange] = useState<{ x0: number; x1: number } | null>(null);
  const rubberRef = useRef<{ downClientX: number; downContentX: number; active: boolean } | null>(null);
  const suppressTrackClickRef = useRef(false);
  /** Q1: 导出/批量生成 trigger 按钮的 hover 态（补上与 toolbar 其余按钮一致的高亮） */
  const [exportHovering, setExportHovering] = useState(false);
  const [batchHovering, setBatchHovering] = useState(false);
  const [zoomHovering, setZoomHovering] = useState(false);
  const [moreHovering, setMoreHovering] = useState(false);
  /** 2026-08-31 主题适配：轨道外壳配色随明暗主题切换；暗色底色=画布背景色 */
  const C = useMemo(
    () => timelinePalette(isDark, theme?.canvas?.background),
    [isDark, theme?.canvas?.background],
  );

  // ===== 时间轴缩放（2026-08-31 约定：缩放以「时间游标(播放头)」为中心，游标视觉位置永远不动；
  // 除非内容缩得比视口还窄（不足以计算原位）才允许游标被挤压移动）=====
  // pps 用 ref 读取：监听只注册一次，避免每次缩放都重建 wheel 监听。
  const ppsRef = useRef(pixelsPerSecond);
  ppsRef.current = pixelsPerSecond;
  /** 以播放头为锚点缩放：播放头当前在视口内的 x 位置缩放前后不变。
   * 用户看到的时间停在哪，放大缩小后它仍然停在那。 */
  const zoomAroundPlayhead = useCallback((nextPps: number) => {
    const el = scrollRef.current;
    const cur = ppsRef.current;
    const next = Math.round(
      Math.max(MIN_PIXELS_PER_SECOND, Math.min(MAX_PIXELS_PER_SECOND, nextPps)) * 10,
    ) / 10;
    if (!el) {
      onPixelsPerSecondChange(next);
      return;
    }
    // 播放头在视口的视觉偏移 = playheadTime × pps − scrollLeft（缩放前后保持）
    const anchorX = playheadTime * cur - el.scrollLeft;
    onPixelsPerSecondChange(next);
    // 内容不足视口宽时浏览器自动 clamp，播放头才可能被「挤压」移动
    el.scrollLeft = Math.max(0, playheadTime * next - anchorX);
  }, [onPixelsPerSecondChange, playheadTime]);
  useEffect(() => {
    const el = scrollRef.current;
    // 2026-11-04 导演台 outerScroll：滚轮交给外层多轨容器统一处理（缩放/横滚都在外层）
    if (!el || outerScroll) return;
    const onWheel = (e: WheelEvent): void => {
      // Plan#83 D：仅 inline 且未显式开启滚轮滚动时才阻断传播给画布
      if (inline && !enableWheelScroll) {
        // Q4 fix: inline 模式下接管滚轮，避免画布缩放/平移也跟着跑
        e.stopPropagation();
      }
      // Ctrl/⌘ + 滚轮 = 缩放（以时间游标为锚点向外扩张）
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAroundPlayhead(ppsRef.current * Math.exp(-e.deltaY * 0.0015));
        return;
      }
      // 普通滚轮 = 水平滚动（查看远处片段；时间轴只有一行轨道，纵向无内容）
      el.scrollLeft += e.deltaY || e.deltaX || 0;
      e.preventDefault();
    };
    // passive:false 才能 preventDefault（React onWheel 为 passive，无法阻止浏览器缩放）
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAroundPlayhead, inline, enableWheelScroll, outerScroll]);

  // clip 布局：宽度 = duration × pixelsPerSecond；
  // 2026-11-05 导演台固定宽度片段卡片：设定 cardWidth 时宽度恒为该值（等宽卡片，不随时长/缩放变化）
  const clips = useMemo(() => {
    const arr: Array<{ id: string; left: number; width: number; data: TimelineClipData }> = [];
    let acc = 0;
    for (const s of shots) {
      const width = cardWidth ?? Math.max(s.duration * pixelsPerSecond, CLIP_MIN_WIDTH);
      arr.push({ id: s.id, left: acc, width, data: s });
      acc += width + clipGap;
    }
    return arr;
  }, [shots, pixelsPerSecond, clipGap, cardWidth]);

  const totalWidth = useMemo(() => {
    if (clips.length === 0) return 200;
    const last = clips[clips.length - 1];
    return last ? last.left + last.width + clipGap : 200;
  }, [clips, clipGap]);

  /**
   * 拖拽占位（2026-09-02 约定：占位框把右侧片段推开才叫占位）。
   * 统一渲染占位框坐标 + 被推 clip 的位移量（同一份状态，避免两处各算各的）。
   */
  const dropPlaceholder = useMemo(() => {
    if (draggingId !== null && dropTargetIdx !== null) {
      const currentIdx = clips.findIndex((c) => c.id === draggingId);
      if (currentIdx < 0) return null;
      const draggedClip = clips[currentIdx];
      if (!draggedClip) return null;
      const finalIdx = dropTargetIdx > currentIdx ? dropTargetIdx - 1 : dropTargetIdx;
      return {
        seamX: movedClipLeft(currentIdx, finalIdx, clips),
        width: draggedClip.width,
        excludeId: draggingId, // ghost 跟手，不受 push
      };
    }
    if (draggingId === null && externalDropIdx !== null) {
      return {
        seamX: insertSeamX(externalDropIdx, clips),
        width: externalDropWidth ?? EXTERNAL_PLACEHOLDER_FALLBACK_WIDTH,
        excludeId: null,
      };
    }
    return null;
  }, [draggingId, dropTargetIdx, externalDropIdx, externalDropWidth, clips]);

  /**
   * 2026-11-04 拖拽实时预览（drag-spec.md #4/#6，导演台导轨 externalClipPreview 路径）：
   * 按预览顺序算出每个未拖片段的让位位移（transform delta，带过渡平滑），
   * 被拖片段的预览落位渲染为整段占位框 —— 拖动期间屏幕呈现的就是松手后的排列。
   */
  const externalPreviewLayout = useMemo(() => {
    if (!externalClipPreview) return null;
    const currentIdx = clips.findIndex((c) => c.id === externalClipPreview.clipId);
    if (currentIdx < 0) return null;
    const dragged = clips[currentIdx];
    if (!dragged) return null;
    const rawFinal = externalClipPreview.insertIndex > currentIdx ? externalClipPreview.insertIndex - 1 : externalClipPreview.insertIndex;
    const finalIdx = Math.max(0, Math.min(clips.length - 1, rawFinal));
    const rest = clips.filter((_, i) => i !== currentIdx);
    const previewOrder = [...rest.slice(0, finalIdx), dragged, ...rest.slice(finalIdx)];
    const deltas = new Map<string, number>();
    let slotLeft = 0;
    let acc = 0;
    for (const c of previewOrder) {
      if (c.id === dragged.id) slotLeft = acc;
      else deltas.set(c.id, acc - c.left);
      acc += c.width + clipGap;
    }
    return { deltas, slotLeft, slotWidth: dragged.width };
  }, [externalClipPreview, clips, clipGap]);

  const totalDuration = useMemo(() => shots.reduce((s, x) => s + x.duration, 0), [shots]);

  // Q3: 无限时间刻度——内容末尾追加 30% 延伸区或固定 60 秒（取大值），
  // 给 drop 留出「永远有空间」的心理感受；落在延伸区时 drop handler 把片段插在末尾即可。
  const extendingBufferSec = useMemo(() => Math.max(totalDuration * 0.3, 60), [totalDuration]);
  const renderedDuration = totalDuration + extendingBufferSec;
  const bufferWidth = extendingBufferSec * pixelsPerSecond;
  const renderedWidth = totalWidth + bufferWidth;

  // ===== 播放态（2026-08-31 约定：剪辑软件式整轨/选中片段播放；无画面时游标也要位移） =====
  const [isPlaying, setIsPlaying] = useState(false);
  /** 播放范围：null=整轨按序；选中 clip 的 [start,end) 秒区间则仅播该片段 */
  const playRangeRef = useRef<{ start: number; end: number } | null>(null);
  const playingShotIdRef = useRef<string | null>(null);
  /**
   * 播放模式（2026-09-02 征集 #134）：'all'=整轨序列 / 'clip'=仅选中片段 / null=停止。
   * 上报宿主 → 中央舞台据此切换「整轨时间码（总时长=片段之和）」与「单片段时间码」。
   */
  const [playbackMode, setPlaybackMode] = useState<'all' | 'clip' | null>(null);
  const playbackModeRef = useRef<'all' | 'clip' | null>(null);
  const modeChangeRef = useRef(onPlaybackModeChange);
  modeChangeRef.current = onPlaybackModeChange;
  const applyMode = useCallback((mode: 'all' | 'clip' | null) => {
    if (playbackModeRef.current === mode) return;
    playbackModeRef.current = mode;
    setPlaybackMode(mode);
    modeChangeRef.current?.(mode);
  }, []);
  /** 上一帧走的秒数基础（rAF 增量，避免依赖记忆化导致闭包陈旧） */
  const playStateRef = useRef({ lastTs: 0, acc: 0 });
  const playheadRef = useRef(playheadTime);
  playheadRef.current = playheadTime;

  /** 整轨播放/按序播放/游标拖拽时：播放头落在某 clip 即让宿主选中它 → 中央公共投影区切换为该片段视频（剪辑软件：游标到哪段中区投哪段） */
  const lastAutoSelectedRef = useRef<string | null>(null);
  // ⚠️ 2026-09-02 播放抽搐根因修复：autoProjectShotAt 必须用 ref 读最新值、保持引用**绝对稳定**。
  // 宿主每帧 setPlayhead 都会重渲染 → onSelectShot/clips 新引用 → 若回调带依赖，rAF 播放引擎 effect
  // 每帧重建（cleanup 清零 lastTs）→ 播放头每两帧才推进一帧（速度减半）+ 视频与主时钟脱节。
  const onSelectShotRef = useRef(onSelectShot);
  onSelectShotRef.current = onSelectShot;
  const projectClipsRef = useRef(clips);
  projectClipsRef.current = clips;
  const ppsRef2 = useRef(pixelsPerSecond);
  ppsRef2.current = pixelsPerSecond;
  const autoProjectShotAt = useCallback((time: number) => {
    const cb = onSelectShotRef.current;
    if (!cb) return;
    // 时间落在哪段 clip 内就选哪段（整轨顺序播放 = 按序投影；拖拽游标 = 实时投影）
    for (const c of projectClipsRef.current) {
      const start = c.left / ppsRef2.current;
      const end = (c.left + c.width) / ppsRef2.current;
      if (time >= start && time < end && lastAutoSelectedRef.current !== c.id) {
        lastAutoSelectedRef.current = c.id;
        cb(c.id);
        break;
      }
    }
  }, []);

  /** 播放头推进到指定秒（供拨帧/播放共用，落到宿主 state 保证 timecode/竖线同步）。
   *  2026-08-31 约定：游标落点变化时同步投影所在片段（拨帧/范围跳转也立即换画面） */
  const commitTime = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, time));
    onPlayheadTimeChange?.(clamped);
    autoProjectShotAt(clamped);
  }, [onPlayheadTimeChange, totalDuration, autoProjectShotAt]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    playRangeRef.current = null;
    playingShotIdRef.current = null;
    playStateRef.current = { lastTs: 0, acc: 0 };
    applyMode(null);
  }, [applyMode]);

  const startPlayback = useCallback((range: { start: number; end: number } | null, shotId: string | null) => {
    // 单片段播放：播放头不在片段区间内 → 跳到片段起点（剪辑软件「播放选中」语义）
    if (range) {
      if (playheadTime < range.start || playheadTime >= range.end) {
        commitTime(range.start);
      }
    } else if (playheadTime >= totalDuration - 0.01) {
      // 整轨播放：已在末尾（上一轮播完停住）→ 从头重播
      commitTime(0);
    }
    playRangeRef.current = range;
    playingShotIdRef.current = shotId;
    applyMode(range ? 'clip' : 'all');
    setIsPlaying(true);
  }, [commitTime, playheadTime, totalDuration, applyMode]);

  /** rAF 播放引擎：无画面也推进游标（剪辑软件工作流）；播完范围则停止，不循环 */
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = (ts: number) => {
      const st = playStateRef.current;
      const range = playRangeRef.current;
      if (st.lastTs === 0) { st.lastTs = ts; raf = requestAnimationFrame(tick); return; }
      const dt = Math.min(0.1, (ts - st.lastTs) / 1000); // 上限防切标签页后跳变
      st.lastTs = ts;
      const next = playheadRef.current + dt;
      const end = range ? range.end : totalDuration;
      if (next >= end) {
        onPlayheadTimeChange?.(end);
        setIsPlaying(false);
        playRangeRef.current = null;
        playingShotIdRef.current = null;
        playStateRef.current = { lastTs: 0, acc: 0 };
        applyMode(null);
        return; // 播放结束停在末尾，不循环
      }
      // 整轨播放时把播放头所在片段投影到中央公共投影区（剪辑软件工作流）
      if (!range) autoProjectShotAt(next);
      onPlayheadTimeChange?.(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); playStateRef.current.lastTs = 0; };
  }, [isPlaying, onPlayheadTimeChange, totalDuration, autoProjectShotAt, applyMode]);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  /** 播放态上报宿主（2026-08-31）：联动中区视频舞台 play/pause（公共投影区：时间轴播放时中区同播） */
  useEffect(() => { onPlayingChange?.(isPlaying); }, [isPlaying, onPlayingChange]);

  /** 播放时跟随播放头滚动（剪辑软件式：任何播放/拨帧让被看时间保持可见） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 仅把视口滚到播放头 x 处（尽量让播放头位于视口中部），不改变缩放
    const targetX = inset + playheadTime * pixelsPerSecond;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    if (targetX < viewLeft || targetX > viewRight) {
      el.scrollLeft = Math.max(0, targetX - el.clientWidth * 0.4);
    }
  }, [playheadTime, pixelsPerSecond]);

  // ===== 整轨播放 / 选中片段播放 / 拨帧 =====
  /** restart=true 时从头（整轨=0 秒）开始播：用于「全屏播放全部 / 全屏播放本片段」 */
  const playWholeTrack = useCallback((restart = false) => {
    if (restart) {
      // ⚠️ 必须先同步内部 playheadRef：host setPlayhead 是异步的，rAF 首帧读 ref（旧值=末尾）会立即判结束
      playheadRef.current = 0;
      commitTime(0);
    }
    startPlayback(null, null);
  }, [startPlayback, commitTime]);
  const stopTrack = useCallback(() => { stopPlayback(); }, [stopPlayback]);
  const stepFrame = useCallback((dir: 1 | -1) => {
    stopPlayback();
    let next = playheadTime + dir * FRAME_STEP_SEC;
    // 到边界后拨到对侧（无缝循环：上一帧在 0 就跳到末尾，下一帧在末尾就回 0）
    if (dir === 1 && next >= totalDuration) next = 0;
    if (dir === -1 && next <= 0) next = totalDuration;
    commitTime(next);
  }, [stopPlayback, playheadTime, totalDuration, commitTime]);
  /** restart=true 时从该片段起点开始播（否则从当前播放头位置续播） */
  const playSelected = useCallback((restart = false) => {
    if (!activeShotId) return;
    const idx = shots.findIndex((s) => s.id === activeShotId);
    if (idx < 0) return;
    const c = clips[idx];
    if (!c) { playWholeTrack(restart); return; }
    const start = c.left / pixelsPerSecond;
    const end = (c.left + c.width) / pixelsPerSecond;
    if (restart) {
      playheadRef.current = start; // 同 playWholeTrack：先同步 ref，防 rAF 首帧用旧值判结束
      commitTime(start);
    }
    startPlayback({ start, end }, activeShotId);
  }, [activeShotId, shots, clips, pixelsPerSecond, startPlayback, playWholeTrack, commitTime]);

  /** 外部播放指令（中央舞台控制条 / 全屏下拉）：按 seq 去重，同一指令只执行一次 */
  const commandSeqRef = useRef(0);
  useEffect(() => {
    const cmd = playbackCommand;
    if (!cmd || cmd.seq <= 0 || cmd.seq === commandSeqRef.current) return;
    commandSeqRef.current = cmd.seq;
    if (cmd.action === 'stop') stopPlayback();
    else if (cmd.action === 'play-all') playWholeTrack(!!cmd.restart);
    else playSelected(!!cmd.restart);
  }, [playbackCommand, stopPlayback, playWholeTrack, playSelected]);

  // ===== 帧级水平缩放（freecut-mini scrub 引擎：rAF + 节流） =====
  // 2026-08-31 修复「时间预览线拖不动/不顺滑」：
  // 1. 拖动中标记用 ref（此前用 isDraggingPlayhead state——handleMove 闭包捕获的是
  //    pointerdown 那一帧的 false，rAF 循环第一帧就被短路退出 → 预览线根本不跟随）；
  // 2. 标尺 rect 在按下时只取一次（此前每帧 getBoundingClientRect 强制布局回流）。
  const scrubThrottleRef = useRef(createScrubThrottleState());
  const pendingXRef = useRef<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const draggingPlayheadRef = useRef(false);
  const rulerRectRef = useRef<DOMRect | null>(null);

  const cancelScrubRaf = useCallback(() => {
    if (scrubRafRef.current !== null) { cancelAnimationFrame(scrubRafRef.current); scrubRafRef.current = null; }
    pendingXRef.current = null;
  }, []);
  useEffect(() => () => cancelScrubRaf(), [cancelScrubRaf]);

  const commitPlayheadFromX = useCallback((clientX: number, rect: DOMRect) => {
    // rect 约定 = 滚动容器自身（scrollRef/body）的视口 rect：位置固定，不随内容横向滚动。
    // 内容坐标 = (clientX - rect.left) + scrollLeft - inset：
    //   - 容器 rect.left 不含 padding，而内容坐标 0 从 paddingLeft(inset) 处开始 → 减 padding；
    //   - scrollLeft 实时补偿横向滚动（拖动播放头 auto-scroll 时变化）。
    // 2026-08-31 修复：内容元素(Ruler/Track)撑宽后已可横向滚动，若沿用旧公式
    // 「clientX - 内容rect.left + scrollLeft」，内容 rect.left 已含滚动偏移会重复计入 → 偏右 S；
    // 而「容器 rect + scrollLeft - padding」对点击（容器 rect 实时取）与拖动（容器 rect 缓存
    // 不随滚动变、scrollLeft 实时）均正确，且不强制回流。
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = (clientX - rect.left + scrollLeft) - inset;
    const time = Math.max(0, Math.min(x / pixelsPerSecond, totalDuration));
    const targetFrame = Math.round(time * FRAME_FPS);
    const nowMs = performance.now();
    if (shouldCommitScrubFrame(scrubThrottleRef.current, nowMs, targetFrame)) {
      onPlayheadTimeChange?.(time);
      // 游标拖拽/点击 → 中央投影区立即切到游标所在片段（2026-08-31 约定）
      autoProjectShotAt(time);
    }
  }, [pixelsPerSecond, totalDuration, onPlayheadTimeChange, autoProjectShotAt]);

  const runScrubLoop = useCallback(() => {
    const clientX = pendingXRef.current;
    const rect = rulerRectRef.current;
    if (!draggingPlayheadRef.current || clientX === null || !rect) { scrubRafRef.current = null; return; }
    commitPlayheadFromX(clientX, rect);
    scrubRafRef.current = requestAnimationFrame(runScrubLoop);
  }, [commitPlayheadFromX]);

  const handleRulerClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (draggingPlayheadRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    commitPlayheadFromX(e.clientX, el.getBoundingClientRect());
  }, [commitPlayheadFromX]);

  const handlePlayheadDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    draggingPlayheadRef.current = true;
    rulerRectRef.current = el.getBoundingClientRect();
    pendingXRef.current = e.clientX;
    scrubRafRef.current = requestAnimationFrame(runScrubLoop);
    const handleMove = (moveE: globalThis.MouseEvent) => {
      pendingXRef.current = moveE.clientX;
      // 2026-08-31 精准拖动：接近视口左右边缘时自动横向滚动，跟随鼠标到视口外的时间
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const edge = 48;
        if (moveE.clientX < rect.left + edge) {
          el.scrollLeft = Math.max(0, el.scrollLeft - (rect.left + edge - moveE.clientX) * 0.6);
        } else if (moveE.clientX > rect.right - edge) {
          el.scrollLeft = Math.min(
            el.scrollWidth - el.clientWidth,
            el.scrollLeft + (moveE.clientX - (rect.right - edge)) * 0.6,
          );
        }
      }
      if (scrubRafRef.current === null) scrubRafRef.current = requestAnimationFrame(runScrubLoop);
    };
    const handleUp = () => {
      draggingPlayheadRef.current = false;
      cancelScrubRaf();
      window.removeEventListener('mousemove', handleMove, true);
      window.removeEventListener('mouseup', handleUp, true);
    };
    // window + capture：规避 CanvasTabContentBoundary 对冒泡阶段事件的阻断（与分割条同款）
    window.addEventListener('mousemove', handleMove, true);
    window.addEventListener('mouseup', handleUp, true);
  }, [cancelScrubRaf, runScrubLoop]);

  // ===== 拖拽排序（点击 clip 拖到另一 clip 位置） =====
  const dragStartRef = useRef<{ id: string; x: number } | null>(null);
  /** 外部拖拽落点 index ref（防频繁 re-render，2026-09-01 修复） */
  const externalDragIdxRef = useRef<number | null>(null);
  /** clips ref（稳定引用，避免 drag-over 期间 handler 重建导致 e.preventDefault() 失效，2026-09-01 修复） */
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const handleClipPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    dragStartRef.current = { id, x: e.clientX };
    // 2026-11-04 拖拽重做：宿主接管拖拽时仅记录起点（pointerup 仍走点击选中），
    // 不捕获指针、不进入内部鬼影拖拽（消除「两套判定并存」）。
    if (clipDragExternal) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraggingId(id);
  }, [clipDragExternal]);

  const handleClipPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingId || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    // 被拖 clip 跟手滑行（translateX），其他片段原地不动 —— 2026-09-02 约定：拖拽跟手、松手落定
    setDragOffset(dx);
    if (Math.abs(dx) < 8) {
      setDropTargetIdx(null);
      return;
    }
    // 目标下标 = 鬼影中心命中的缝隙（中点归属：拖到某 clip 左半→其前，右半→其后）
    const currentIdx = clips.findIndex((c) => c.id === draggingId);
    if (currentIdx < 0) return;
    const curClip = clips[currentIdx];
    if (!curClip) return;
    const ghostCenter = curClip.left + dx + curClip.width / 2;
    const targetIdx = computeInsertIndex(ghostCenter, clips);
    // 仍在原位附近（没跨过别的片段）→ 不显示占位、松手即回原位
    setDropTargetIdx(targetIdx === currentIdx ? null : targetIdx);
  }, [draggingId, clips]);

  const handleClipPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const id = dragStartRef.current?.id;
    // 2026-09-02 鬼影方案：拖动中不实时换位，松手一次性提交排序（从 currentIdx 移到 dropTargetIdx）
    if (id && dropTargetIdx !== null) {
      const currentIdx = shots.findIndex((s) => s.id === id);
      if (currentIdx >= 0 && currentIdx !== dropTargetIdx) {
        const reordered = [...shots];
        const [moved] = reordered.splice(currentIdx, 1);
        if (moved) {
          const insertAt = dropTargetIdx > currentIdx ? dropTargetIdx - 1 : dropTargetIdx;
          reordered.splice(insertAt, 0, moved);
          onReorder?.(reordered.map((s) => s.id));
        }
      }
    }
    if (id) {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle multi-select without changing active shot
        setMultiSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (e.shiftKey) {
        // Shift+click: select range from first selected to current
        const currentIdx = shots.findIndex((s) => s.id === id);
        if (currentIdx >= 0) {
          let firstSelectedIdx = currentIdx;
          const firstSelected = shots.find((s) => multiSelectedIds.has(s.id));
          if (firstSelected) {
            const idx = shots.findIndex((s) => s.id === firstSelected.id);
            if (idx >= 0) firstSelectedIdx = idx;
          }
          const start = Math.min(firstSelectedIdx, currentIdx);
          const end = Math.max(firstSelectedIdx, currentIdx);
          const rangeIds = shots.slice(start, end + 1).map((s) => s.id);
          setMultiSelectedIds(new Set(rangeIds));
        }
      } else {
        // Normal click: single select
        setMultiSelectedIds(new Set());
        onSelectShot?.(id);
      }
    }
    dragStartRef.current = null;
    setDraggingId(null);
    setDragOffset(0);
    setDropTargetIdx(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, [onSelectShot, shots, multiSelectedIds, dropTargetIdx, onReorder]);

  // ===== 右键菜单（2026-11-05 调整：整项删除「分割」「合并」，只保留实际需要的项） =====
  const handleClipContextMenu = useCallback((e: ReactMouseEvent, shotId: string) => {
    e.preventDefault();
    e.stopPropagation();
    // 若右键点击的 clip 不在多选集中，清空多选并单选该 clip
    if (!multiSelectedIds.has(shotId)) {
      setMultiSelectedIds(new Set());
      onSelectShot?.(shotId);
    }
    setContextMenu({ shotId, x: e.clientX, y: e.clientY });
  }, [multiSelectedIds, onSelectShot]);

  /** 相对某片段插入空片段（插槽编号固定：只是在该位置插一格，其余顺序后移） */
  const handleInsertRelative = useCallback((shotId: string, where: 'before' | 'after') => {
    if (!onInsertAt) return;
    const idx = shots.findIndex((s) => s.id === shotId);
    if (idx < 0) return;
    onInsertAt(shotId, { index: where === 'before' ? idx : idx + 1 });
  }, [shots, onInsertAt]);

  /** 复制插入：把该片段的媒体与时长原样复制一份，插在它后面（纯插入，不改原片段） */
  const handleDuplicateClip = useCallback((shotId: string) => {
    if (!onInsertAt) return;
    const idx = shots.findIndex((s) => s.id === shotId);
    const shot = shots[idx];
    if (!shot) return;
    onInsertAt(shotId, {
      index: idx + 1,
      title: shot.label,
      durationSec: shot.duration,
      storageKey: shot.videoKey,
      coverUrl: shot.thumbnailUrl,
      sourceDuration: shot.sourceDuration,
    });
  }, [shots, onInsertAt]);

  /** 删除选中（右键）：多选则一次删多条 */
  const handleDeleteSelection = useCallback((shotId: string) => {
    const ids = new Set<string>(multiSelectedIds);
    ids.add(shotId);
    if (onDeleteShots && ids.size > 1) {
      onDeleteShots([...ids]);
      setMultiSelectedIds(new Set());
      return;
    }
    onDeleteShot?.(shotId);
  }, [multiSelectedIds, onDeleteShots, onDeleteShot]);

  // ===== trim（外部 handle） =====
  const handleTrimStart = useCallback((e: ReactMouseEvent<HTMLDivElement>, id: string, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;
    const originalDuration = shot.duration;
    const handleMove = (moveE: globalThis.MouseEvent) => {
      const el = scrollRef.current;
      if (!el) return;
      // 容器 rect（位置固定）+ 实时 scrollLeft - padding = 内容坐标（同 commitPlayheadFromX）
      const rect = el.getBoundingClientRect();
      const x = (moveE.clientX - rect.left + el.scrollLeft) - inset;
      // ⚠️ 全部换算到「秒」再比较（2026-08-31 修复：此前 prevEnd 是像素、time 是秒，
      // 二者直接相减 → 右侧 trim 结果恒为负/被下限截断；左侧还把「像素-秒」当秒用且上限写死 10）
      const timeSec = Math.max(0, x / pixelsPerSecond);
      const currentIdx = shots.findIndex((s) => s.id === id);
      const curClip = clips[currentIdx];
      if (!curClip) return;
      const prevClip = currentIdx > 0 ? clips[currentIdx - 1] : undefined;
      const prevEndSec = prevClip ? (prevClip.left + prevClip.width) / pixelsPerSecond : 0;
      // 时长上限：素材（有源时长）→ 源视频真实时长（2026-09-02 约定：素材按原时长）；
      // 占位片 → 模型模板真实上限（缺省兜底）。左侧 trim 再叠加「不得越过上一 clip 右边缘」。
      const minDur = minClipDuration ?? DEFAULT_MIN_CLIP_DURATION;
      const sourceDur = curClip.data.sourceDuration;
      const modelMax = sourceDur && sourceDur > 0
        ? sourceDur
        : (maxClipDuration ?? DEFAULT_MAX_CLIP_DURATION);
      // 2026-09-01 约定：trim 拖拽整数秒吸附（视频生成模型普遍输出整数秒，
      // 0.1s 粒度会让 clip 边界落在非整数刻度上，标尺对不齐）。向上取整下限防越界。
      const minDurInt = Math.ceil(minDur);
      const maxDurInt = Math.floor(modelMax);
      let dur = originalDuration;
      if (side === 'right') {
        dur = Math.min(Math.max(Math.round(timeSec - prevEndSec), minDurInt), maxDurInt);
        onTrim?.(id, dur, side);
      } else {
        const rightEdgeSec = (curClip.left + curClip.width) / pixelsPerSecond;
        const spaceMax = Math.max(minDur, rightEdgeSec - prevEndSec);
        dur = Math.min(Math.max(Math.round(rightEdgeSec - timeSec), minDurInt), Math.min(maxDurInt, Math.floor(spaceMax)));
        onTrim?.(id, dur, side);
      }
      // T8: 裁剪时间气泡（节流，避免频繁 re-render）
      const diff = dur - originalDuration;
      const bubbleText = diff >= 0 ? `+${diff}s` : `${diff}s`;
      setTrimBubble({ x: moveE.clientX, y: moveE.clientY - 40, text: bubbleText });
    };
    const handleUp = () => {
      setTrimBubble(null);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [shots, clips, pixelsPerSecond, minClipDuration, maxClipDuration, onTrim]);

  // ===== 渲染标尺（对齐 AI Video Studio.html：底部分布时间标签 + 背景刻度线） =====
  const formatTime = useCallback((s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }, []);
  const renderRuler = useCallback(() => {
    const labels: ReactElement[] = [];
    // Plan#82 T2: 步进隐藏 — 根据缩放级别动态调整刻度步长，避免挤压
    let step: number;
    if (pixelsPerSecond > 100) step = 1;
    else if (pixelsPerSecond > 30) step = 5;
    else if (pixelsPerSecond > 10) step = 10;
    else step = 30;
    for (let s = 0; s <= Math.ceil(renderedDuration); s += step) {
      const x = s * pixelsPerSecond;
      if (x > renderedWidth * 1.5) break;
      const isInExtension = s > totalDuration;
      labels.push(
        <span
          key={`ruler-label-${s}`}
          style={{
            position: 'absolute',
            left: x,
            bottom: 4,
            fontSize: 8,
            color: isInExtension ? (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)') : C.empty,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(s)}
        </span>,
      );
    }
    return labels;
  }, [totalDuration, renderedDuration, pixelsPerSecond, renderedWidth, formatTime, C, isDark]);

  // ===== 缩放控件（滑块 + 加减按钮，右侧；缩放以时间游标为锚点，游标视觉位置不动）=====
  const handleZoomIn = useCallback(() => { zoomAroundPlayhead(ppsRef.current + 10); }, [zoomAroundPlayhead]);
  const handleZoomOut = useCallback(() => { zoomAroundPlayhead(ppsRef.current - 10); }, [zoomAroundPlayhead]);
  const handleSliderZoom = useCallback((v: number) => { zoomAroundPlayhead(v); }, [zoomAroundPlayhead]);
  // ===== 资产拖入轨道（2026-08-31：HTML5 drag 拖视频素材到轨道 → 按 drop 时间插入镜头）=====
  // 兼容两种拖拽源：资产库弹窗(application/x-canvas-asset) 与 画布资产抽屉(application/x-testlib-item)
  const TRACK_DRAG_MIMES = ['application/x-canvas-asset', 'application/x-testlib-item'];
  const handleTrackDragEnter = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (!TRACK_DRAG_MIMES.some((m) => types.includes(m))) return;
    // 读素材时长 → 占位框宽度（2026-09-02 约定：整段蓝色虚线占位框，宽度=素材时长×pps）
    let durSec: number | undefined;
    try {
      const rawAsset = e.dataTransfer.getData('application/x-canvas-asset');
      if (rawAsset) {
        const p = JSON.parse(rawAsset) as { kind?: string; durationMs?: number };
        if (p.kind === 'video' && p.durationMs) durSec = Math.max(0.5, p.durationMs / 1000);
      } else {
        const rawLib = e.dataTransfer.getData('application/x-testlib-item');
        const item = rawLib ? (JSON.parse(rawLib) as { data?: Asset }) : null;
        const a = item?.data;
        const d = a?.data;
        if (a && a.kind === 'video' && d && d.kind === 'video') {
          const ms = d.durationMs ?? (a as any).durationMs;
          if (ms) durSec = Math.max(0.5, ms / 1000);
        }
      }
    } catch { /* 个别浏览器 dragEnter 阶段 getData 受限，静默兜底 */ }
    // 2026-11-05 固定宽度卡片：卡片导轨模式下占位框 = 一张卡宽（不再按时长×pps）
    setExternalDropWidth(cardWidth ?? (durSec && durSec > 0 ? clipPlaceholderWidth(durSec, ppsRef.current) : null));
  }, [cardWidth]);
  const handleTrackDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (TRACK_DRAG_MIMES.some((m) => types.includes(m))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // 落点 = 插入下标（占位框/drop 同源）。state 只存整数下标、仅变化时 set（低频，防卡顿）
      const el = scrollRef.current;
      const currentClips = clipsRef.current;
      if (el && currentClips) {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left + el.scrollLeft) - inset;
        const idx = computeInsertIndex(x, currentClips);
        if (idx !== externalDragIdxRef.current) {
          externalDragIdxRef.current = idx;
          setExternalDropIdx(idx);
        }
      }
    }
  }, []);
  const handleTrackDragLeave = useCallback(() => {
    setExternalDropIdx(null);
    externalDragIdxRef.current = null;
    setExternalDropWidth(null);
  }, []);

  const handleTrackDrop = useCallback(async (e: ReactDragEvent<HTMLDivElement>) => {
    if (!onInsertAt) return;
    // 2026-09-02：先取占位框落点（用户松手那一刻看到的插入位置），再清空占位状态
    const dropIndexRef = externalDragIdxRef.current;
    setExternalDropIdx(null);
    externalDragIdxRef.current = null;
    setExternalDropWidth(null);
    const rawAsset = e.dataTransfer.getData('application/x-canvas-asset');
    const rawLib = e.dataTransfer.getData('application/x-testlib-item');
    if (!rawAsset && !rawLib) return;
    e.preventDefault();
    // 归一化两种 payload → { storageKey, coverUrl, title, durationMs }
    let storageKey: string | undefined;
    let coverUrl: string | undefined;
    let title: string | undefined;
    let durationMs: number | undefined;
    try {
      if (rawAsset) {
        const p = JSON.parse(rawAsset) as {
          kind?: string; title?: string; durationMs?: number; storageKey?: string; coverUrl?: string;
        };
        if (p.kind !== 'video') return; // 目前仅接受视频素材
        storageKey = p.storageKey;
        coverUrl = p.coverUrl;
        title = p.title;
        durationMs = p.durationMs;
      } else {
        // 画布资产抽屉 payload：{ type:'asset', name, data: Asset }
        const item = JSON.parse(rawLib) as { type?: string; name?: string; data?: Asset };
        const a = item?.data;
        const d = a?.data;
        if (!a || a.kind !== 'video' || !d || d.kind !== 'video') return;
        storageKey = d.storageKey ?? (a as any).storageKey;
        coverUrl = a.coverUrl;
        title = item.name ?? a.title;
        durationMs = d.durationMs;
      }
    } catch { return; }
    if (!storageKey) return;
    // 插入下标 = 占位框落点（与渲染占位框同一函数产出，杜绝「框在这、插到别处」）
    let insertIndex = dropIndexRef;
    if (insertIndex === null) {
      const el = scrollRef.current;
      if (!el) return;
      // 容器 rect（位置固定）+ 实时 scrollLeft - padding = 内容坐标（同 commitPlayheadFromX）
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left + el.scrollLeft) - inset;
      insertIndex = computeInsertIndex(x, clipsRef.current);
    }
    // afterId 兼容语义（index 缺失的旧调用方用）：占位框处前一个 clip 之后
    const prevClip = insertIndex > 0 ? clipsRef.current[insertIndex - 1] : undefined;
    const afterId = prevClip ? prevClip.data.id : null;
    // 素材按原时长（2026-09-02 约定）：payload 有 durationMs 直接用；
    // 无时长元数据 → 先解析真实时长再插入（同步插入的兜底值会让 trimEnd 落错，且
    // 插入后再回填会因 onInsertAt 闭包持有旧 data 而整体覆盖 → 刚拖入的 clip 消失）。
    let durationSec: number | undefined = durationMs ? Math.max(0.5, durationMs / 1000) : undefined;
    if (!durationSec) {
      const real = await resolveVideoDurationSec(storageKey);
      if (real && real > 0) durationSec = Math.round(real * 10) / 10;
    }
    onInsertAt(afterId, {
      title,
      durationSec,
      sourceDuration: durationSec,
      storageKey,
      coverUrl,
      index: insertIndex,
    });
  }, [onInsertAt]);
  // ===== 框选（2026-09-02，画布式矩形选框）：空白区按下拖出选框 → 相交片段多选 =====
  // 与「点击空白跳播放头」并存：拖动超过阈值(5px)才进入框选，否则走原 click。
  const handleTrackPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // clip 上的按下交给 clip 自己（拖动排序/选择），不启动框选
    if (e.target instanceof Element && e.target.closest('[data-clip-id]')) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left + el.scrollLeft) - inset;
    rubberRef.current = { downClientX: e.clientX, downContentX: x, active: false };
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  }, []);
  const handleTrackPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = rubberRef.current;
    if (!st) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!st.active) {
      if (Math.abs(e.clientX - st.downClientX) < 5) return; // 未过阈值 → 视为点击（播放头）
      st.active = true;
    }
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left + el.scrollLeft) - inset;
    setRubberRange({ x0: Math.min(st.downContentX, x), x1: Math.max(st.downContentX, x) });
  }, []);
  const handleTrackPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = rubberRef.current;
    rubberRef.current = null;
    if (st?.active) {
      suppressTrackClickRef.current = true;
      // click 在本宏任务内触发，先吞掉；下个宏任务复位
      setTimeout(() => { suppressTrackClickRef.current = false; }, 0);
      const el = scrollRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left + el.scrollLeft) - inset;
        const x0 = Math.min(st.downContentX, x);
        const x1 = Math.max(st.downContentX, x);
        // 与选框 x 范围相交的片段全部选中（替换当前多选）
        const hitIds = clips.filter((c) => c.left <= x1 && c.left + c.width >= x0).map((c) => c.id);
        setMultiSelectedIds(new Set(hitIds));
      }
      setRubberRange(null);
    }
    // 仅在本次按下建立过 capture 时才释放（否则对无捕获元素 release 会抛 NotFoundError）
    if (st) (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
  }, [clips]);
  const handleTrackPointerCancel = useCallback(() => {
    rubberRef.current = null;
    setRubberRange(null);
  }, []);
  // 2026-08-31 约定：点击轨道空白（非片段）区 → 播放头精准跳到该时间
  const handleTrackClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('[data-clip-id]')) return;
    if (suppressTrackClickRef.current) return; // 刚完成框选拖动的 click 不移动播放头
    const el = scrollRef.current;
    if (!el) return;
    commitPlayheadFromX(e.clientX, el.getBoundingClientRect());
  }, [commitPlayheadFromX]);
  // ===== Delete/Backspace 删除（2026-09-02：active + 框选/Ctrl+A 多选一并批量删除）=====
  useEffect(() => {
    if (readonly) return;
    if (!onDeleteShot && !onDeleteShots) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!hovering) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // 收集选中集 = active（若有）+ 多选集（框选/Ctrl+A）
      const ids = new Set<string>();
      if (activeShotId) ids.add(activeShotId);
      multiSelectedIds.forEach((id) => ids.add(id));
      if (ids.size === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (onDeleteShots) {
        onDeleteShots([...ids]);
      } else if (activeShotId) {
        onDeleteShot?.(activeShotId);
      }
      setMultiSelectedIds(new Set());
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [activeShotId, hovering, onDeleteShot, onDeleteShots, multiSelectedIds]);
  // ===== Ctrl+A 全选（2026-09-02，悬停时间轴时）=====
  useEffect(() => {
    if (readonly) return;
    if (!hovering || shots.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 'a' && e.key !== 'A')) return;
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      e.stopPropagation();
      setMultiSelectedIds(new Set(shots.map((s) => s.id)));
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [hovering, shots]);
  // ===== 播放快捷键（2026-08-31：悬停时间轴时空格播放/暂停、Ctrl+←/→ 拨帧） =====
  useEffect(() => {
    if (readonly) return;
    if (!hovering) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (isPlaying) stopTrack(); else playWholeTrack();
      } else if (e.ctrlKey || e.metaKey) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); stepFrame(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); stepFrame(1); }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [hovering, isPlaying, stopTrack, playWholeTrack, stepFrame]);
  // ===== 右键菜单关闭（点击任意处关闭）=====
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
    };
  }, [contextMenu]);
  // ===== 「更多」下拉菜单（2026-09-01：导出入口等低频操作收纳于此） =====
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = () => setMoreOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
    };
  }, [moreOpen]);
  // ===== 「导出」下拉（2026-09-02：导出全部 / 导出选定，host 拼接成单视频入库） =====
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!exportOpen) return;
    const handleClick = () => setExportOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
    };
  }, [exportOpen]);
  /** 导出选定集 = active + 多选（去重），供导出按钮计算可用态 */
  const exportSelectedIds = useMemo(() => {
    const set = new Set<string>();
    if (activeShotId) set.add(activeShotId);
    multiSelectedIds.forEach((id) => set.add(id));
    return [...set];
  }, [activeShotId, multiSelectedIds]);

  // ===== 「批量生成」下拉（Plan#71 T11：全部占位 / 选中占位 → host 确认弹窗逐条跑 mock/真实） =====
  const [batchOpen, setBatchOpen] = useState(false);
  useEffect(() => {
    if (!batchOpen) return;
    const handleClick = () => setBatchOpen(false);
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
    };
  }, [batchOpen]);

  // ===== 渲染（对齐 AI Video Studio.html：暗色 toolbar + 刻度 ruler + 全高 playhead + 缩略图 clip） =====
  const totalTrackWidth = Math.max(renderedWidth, 200);
  // 2026-09-01 约定：工具栏时间码（00:05 / 00:15）与标尺信息重复，已移除展示
  const zoomPercent = `${Math.round((pixelsPerSecond / 60) * 100)}%`;
  // Plan#83 H：toolBtnStyle 默认色 C.muted → C.text，工具栏图标/标题在深浅主题下都能 ≥0.75 亮度对比可读
  const toolBtnStyle: CSSProperties = { height: 25, padding: '0 8px', border: 0, borderRadius: 5, background: 'transparent', color: C.text, fontSize: 11, cursor: 'pointer' };

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onWheelCapture={inline && !enableWheelScroll ? (e: React.WheelEvent) => { e.stopPropagation(); } : undefined}
      onDragStartCapture={inline && !allowDragPropagation ? (e: React.DragEvent) => { e.stopPropagation(); } : undefined}
      onDragOverCapture={inline && !allowDragPropagation ? (e: React.DragEvent) => { e.stopPropagation(); } : undefined}
      onDropCapture={inline && !allowDragPropagation ? (e: React.DragEvent) => { e.stopPropagation(); } : undefined}
      onDragEnterCapture={inline && !allowDragPropagation ? (e: React.DragEvent) => { e.stopPropagation(); } : undefined}
      onDragLeaveCapture={inline && !allowDragPropagation ? (e: React.DragEvent) => { e.stopPropagation(); } : undefined}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, width: '100%', background: C.bg, ...(noTopBorder ? {} : { borderTop: `1px solid ${C.border}` }), color: C.text, overflow: 'hidden', boxSizing: 'border-box' }}
    >
      {/* Toolbar：readonly 或 hideToolbar 模式下隐藏（出片节点 body / 节点内只读预览）；fullscreen 模式下完整保留原按钮 */}
      {!readonly && !hideToolbar && (
      <div style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
        {/* ===== 播放传输组：上一帧 / 播放全部 / 下一帧 / 播放选中片段 ===== */}
        <button type="button" onClick={() => stepFrame(-1)} style={toolBtnStyle} title="上一帧（Ctrl+←）">
          <ChevronsLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => (playbackMode === 'all' ? stopTrack() : playWholeTrack())}
          style={{ ...toolBtnStyle, color: playbackMode === 'all' ? theme.toolbar.accent : C.text }}
          title={playbackMode === 'all' ? '停止播放全部' : '播放全部（整轨序列）'}
        >
          {playbackMode === 'all' ? <Pause size={14} /> : <CANVAS_NODE_ICONS.playAll size={15} />}
        </button>
        <button type="button" onClick={() => stepFrame(1)} style={toolBtnStyle} title="下一帧（Ctrl+→）">
          <ChevronsRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => (playbackMode === 'clip' ? stopTrack() : playSelected())}
          disabled={!activeShotId}
          style={{
            ...toolBtnStyle,
            color: playbackMode === 'clip' ? theme.toolbar.accent : C.text,
            opacity: activeShotId ? 1 : 0.4,
            cursor: activeShotId ? 'pointer' : 'not-allowed',
          }}
          title={!activeShotId ? '未选中片段' : (playbackMode === 'clip' ? '停止播放本片段' : '播放选中片段')}
        >
          {playbackMode === 'clip' ? <Pause size={14} /> : <CANVAS_NODE_ICONS.playClip size={14} />}
        </button>
        <span style={{ width: 1, height: 16, background: C.border, flexShrink: 0, margin: '0 4px' }} />
        {/* 编辑组：插入 / 复制 / 删除（同一功能聚在一起） */}
        {onInsertAt && (
          <button type="button" onClick={() => onInsertAt(activeShotId ?? null)} style={{ ...toolBtnStyle, color: C.text }} title="在选中片段后插入新片段">
            <Plus size={15} />
          </button>
        )}
        {onInsertAt && activeShotId && (
          <button type="button" onClick={() => handleDuplicateClip(activeShotId)} style={{ ...toolBtnStyle, color: C.text }} title="复制选中片段并插入到其后">
            <Copy size={14} />
          </button>
        )}
        {onDeleteShot && activeShotId && (
          <button type="button" onClick={() => handleDeleteSelection(activeShotId)} style={{ ...toolBtnStyle, color: theme.toolbar.danger }} title="删除选中片段（Delete）">
            <Trash2 size={15} />
          </button>
        )}
        <span style={{ width: 1, height: 16, background: C.border, flexShrink: 0, margin: '0 4px' }} />
        {/* 导出 dropdown（inline 模式下隐藏） */}
        {!inline && (onExportAll || onExportSelected) && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" onClick={() => setExportOpen((o) => !o)} style={capsuleTransparentStyle(isDark, exportHovering)} title="导出视频" onMouseEnter={() => setExportHovering(true)} onMouseLeave={() => setExportHovering(false)}>
              <Download size={14} />
            </button>
            {exportOpen && (
              <div style={{ position: 'absolute', zIndex: 1000, right: 0, top: '100%', marginTop: 4, background: isDark ? '#2a2a2a' : '#ffffff', border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '4px 0', minWidth: 170, fontSize: 12, userSelect: 'none' }}>
                <button type="button" disabled={!canExport} onClick={() => { setExportOpen(false); onExportAll?.(); }} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: canExport ? C.text : C.muted, cursor: canExport ? 'pointer' : 'default', textAlign: 'left', fontSize: 12, whiteSpace: 'nowrap' }}>
                  导出全部（自动拼接）
                </button>
                <button type="button" disabled={!canExport || exportSelectedIds.length === 0} onClick={() => { setExportOpen(false); if (exportSelectedIds.length > 0) onExportSelected?.(exportSelectedIds); }} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: canExport && exportSelectedIds.length > 0 ? C.text : C.muted, cursor: canExport && exportSelectedIds.length > 0 ? 'pointer' : 'default', textAlign: 'left', fontSize: 12, whiteSpace: 'nowrap' }}>
                  导出选定（{exportSelectedIds.length} 段）
                </button>
              </div>
            )}
          </div>
        )}
        {/* 批量生成 dropdown（inline 模式下隐藏） */}
        {!inline && (onBatchGenerateAll || onBatchGenerateSelected) && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" onClick={() => setBatchOpen((o) => !o)} style={capsuleTransparentStyle(isDark, batchHovering)} title="批量生成" onMouseEnter={() => setBatchHovering(true)} onMouseLeave={() => setBatchHovering(false)}>
              <Wand2 size={14} />
            </button>
            {batchOpen && (
              <div style={{ position: 'absolute', zIndex: 1000, right: 0, top: '100%', marginTop: 4, background: isDark ? '#2a2a2a' : '#ffffff', border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '4px 0', minWidth: 170, fontSize: 12, userSelect: 'none' }}>
                <button type="button" disabled={!canBatchGenerate} onClick={() => { setBatchOpen(false); onBatchGenerateAll?.(); }} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: canBatchGenerate ? C.text : C.muted, cursor: canBatchGenerate ? 'pointer' : 'default', textAlign: 'left', fontSize: 12, whiteSpace: 'nowrap' }}>
                  生成全部占位（{shots.filter((s) => s.status === 'idle' || !s.status).length} 段）
                </button>
                <button type="button" disabled={!canBatchGenerate || exportSelectedIds.length === 0} onClick={() => { setBatchOpen(false); if (exportSelectedIds.length > 0) onBatchGenerateSelected?.(exportSelectedIds); }} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: canBatchGenerate && exportSelectedIds.length > 0 ? C.text : C.muted, cursor: canBatchGenerate && exportSelectedIds.length > 0 ? 'pointer' : 'default', textAlign: 'left', fontSize: 12, whiteSpace: 'nowrap' }}>
                  生成选中（{exportSelectedIds.length} 段）
                </button>
              </div>
            )}
          </div>
        )}
        {extraToolbarButtons?.map((b) => (
          <button key={b.key} type="button" onClick={b.onClick} style={{ ...toolBtnStyle, color: b.danger ? theme.toolbar.danger : C.text }}>
            {b.label}
          </button>
        ))}
        {/* 弹性占位撑开左右按钮组 */}
        <div style={{ flex: 1 }} />
        {/* 缩放控键（保留原始 zx-timeline-zoom 样式，不变宽度/不改样式） */}
        <button type="button" onClick={handleZoomOut} style={capsuleTransparentStyle(isDark, zoomHovering)} title="缩小" onMouseEnter={() => setZoomHovering(true)} onMouseLeave={() => setZoomHovering(false)}>−</button>
        <input type="range" min={MIN_PIXELS_PER_SECOND} max={MAX_PIXELS_PER_SECOND} step={1} value={pixelsPerSecond} onChange={(e) => handleSliderZoom(Number(e.target.value))} className="zx-timeline-zoom" style={{ width: 120 }} title="缩放" />
        <button type="button" onClick={handleZoomIn} style={capsuleTransparentStyle(isDark, zoomHovering)} title="放大" onMouseEnter={() => setZoomHovering(true)} onMouseLeave={() => setZoomHovering(false)}>+</button>
        <button type="button" style={{ ...capsuleTransparentStyle(isDark, false, { noHover: true }), width: 46 }}>{zoomPercent}</button>
        {/* 更多 dropdown */}
        {moreMenuItems && moreMenuItems.length > 0 && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" onClick={() => setMoreOpen((o) => !o)} style={{ ...capsuleTransparentStyle(isDark, moreHovering), width: 25, padding: 0 }} title="更多" onMouseEnter={() => setMoreHovering(true)} onMouseLeave={() => setMoreHovering(false)}>
              <MoreHorizontal size={14} />
            </button>
            {moreOpen && (
              <div style={{ position: 'absolute', zIndex: 1000, right: 0, top: '100%', marginTop: 4, background: isDark ? '#2a2a2a' : '#ffffff', border: `1px solid ${C.border}`, borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', padding: '4px 0', minWidth: 150, fontSize: 12, userSelect: 'none' }}>
                {moreMenuItems.map((item) => (
                  <button key={item.key} type="button" disabled={item.disabled} onClick={() => { setMoreOpen(false); item.onClick(); }} style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: item.disabled ? C.muted : C.text, cursor: item.disabled ? 'default' : 'pointer', textAlign: 'left', fontSize: 12, whiteSpace: 'nowrap' }} onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
      {/* Timeline body（ruler + track + playhead；2026-08-31 显示水平滚动条，滚轮水平滚动）
        * 2026-09-01 约定：滚动条改克制的 4px 白色细条（.zx-timeline-scroll，见 app.css） */}
      <div
        ref={scrollRef}
        data-timeline-body
        className="zx-timeline-scroll"
        style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, overflowX: outerScroll ? 'visible' : 'auto', overflowY: outerScroll ? 'visible' : 'hidden', paddingLeft: inset }}
      >
        {/* Ruler：hideRuler 模式下隐藏（多轨模式下由全局标尺接管，Plan#82 T1） */}
        {!hideRuler && (
        <div
          data-ruler
          onClick={handleRulerClick}
          style={{ position: 'relative', height: RULER_HEIGHT, borderBottom: `1px solid ${C.rulerLine}`, display: 'flex', alignItems: 'flexEnd', overflow: 'hidden', background: `repeating-linear-gradient(to right, transparent 0, transparent 49px, ${C.rulerLine} 50px)`, width: 'max-content', minWidth: '100%' }}
        >
          {/* 撑宽层：刻度是 absolute 定位不撑宽自身，必须用普通流元素把标尺宽度拉到与轨道一致，
           * 标尺刻度/背景才能随横向滚动同步移动（与轨道右缘对齐）。 */}
          <div style={{ width: totalTrackWidth, height: 0, flexShrink: 0 }} />
          {renderRuler()}
        </div>
        )}
        {/* Track area（可拖入资产；空白区点击移动播放头） */}
        <div
          data-track-area
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerCancel}
          onDragEnter={handleTrackDragEnter}
          onDragOver={handleTrackDragOver}
          onDragLeave={handleTrackDragLeave}
          onDrop={handleTrackDrop}
          onClick={handleTrackClick}
          style={{ position: 'relative', flex: 1, minHeight: 0, padding: '7px 10px 9px 0', overflow: 'hidden', width: 'max-content', minWidth: '100%' }}
        >
<div style={{ position: 'relative', height: trackRowHeight, width: totalTrackWidth, minWidth: '100%' }}>
{/* Q3: 内容/延伸交界细线 — 提示「此后的空白为无限延展区」 */}
{totalDuration > 0 && (
  <div
    style={{
      position: 'absolute',
      left: totalWidth,
      top: 0,
      width: 1,
      height: '100%',
      background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
      pointerEvents: 'none',
      zIndex: 2,
    }}
  />
)}
{clips.map((clip) => (
              <TimelineClip
                key={clip.id}
                clip={clip}
                isSelected={activeShotId === clip.id || multiSelectedIds.has(clip.id)}
                isDragging={draggingId === clip.id || externalClipPreview?.clipId === clip.id}
                dragTranslateX={externalClipPreview?.clipId === clip.id ? externalClipPreview.dragX : (draggingId === clip.id ? dragOffset : 0)}
                pushX={externalPreviewLayout
                  ? (externalPreviewLayout.deltas.get(clip.id) ?? 0)
                  : (dropPlaceholder && clip.id !== dropPlaceholder.excludeId && clip.left >= dropPlaceholder.seamX ? dropPlaceholder.width + clipGap : 0)}
                onPointerDown={handleClipPointerDown}
                onPointerMove={handleClipPointerMove}
                onPointerUp={handleClipPointerUp}
                onContextMenu={handleClipContextMenu}
                onDoubleClick={(id) => onClipDoubleClick?.(id)}
                onTrimStart={trimEnabled ? handleTrimStart : undefined}
                t={t}
                isDark={isDark}
                clipSelectedColor={C.clipSelected}
                trimHandleColor={C.trimHandle}
                clipTextColor={C.clipText}
                draggable={!!onClipDragStart}
                onDragStart={onClipDragStart}
                directorLabel={clipLabelMode === 'director'}
                directorCardHeight={clipLabelMode === 'director' ? resolvedCardHeight : undefined}
                onDirectorPlay={onDirectorPlay}
              />
            ))}
            {/* 2026-11-04 导演台 H3：内容层附加层（延续标记画在片段接缝上；
             * 与 clips 同容器 → 缩放/滚动/重排实时跟随，坐标零点 = 0s） */}
            {contentOverlay}
            {shots.length === 0 && (
              // Plan#83 C：pointerEvents: none —— 空提示只占视觉，不拦截下方 track-area 的点击（用于移动播放头）
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.empty, fontSize: 12, padding: 12, textAlign: 'center', pointerEvents: 'none' }}>
                {inline && inlineEmptyHint
                  ? inlineEmptyHint
                  : (t('storyboard.timelineEmpty') || '暂无镜头')}
              </div>
            )}
            {/* 拖拽插入占位框（2026-09-02 约定：整段蓝色虚线占位，右侧片段被推开让位；占位框位置即素材插入位置） */}
            {dropPlaceholder && (
              <div key="drop-placeholder" data-drop-placeholder style={dropPlaceholderStyle(isDark, dropPlaceholder.seamX, dropPlaceholder.width, resolvedCardHeight)} />
            )}
            {/* 2026-11-04 拖拽实时预览（drag-spec.md #6）：被拖片段的预览落位 = 整段占位框（半透明实体），
                占位框在哪 = 松手落哪；其余片段已按预览顺序让位 */}
            {externalPreviewLayout && (
              <div key="external-preview-slot" data-drop-placeholder style={dropPlaceholderStyle(isDark, externalPreviewLayout.slotLeft, externalPreviewLayout.slotWidth, resolvedCardHeight)} />
            )}
            {/* 框选矩形（2026-09-02 画布式选框） */}
            {rubberRange && (
              <div
                style={{
                  position: 'absolute',
                  left: rubberRange.x0,
                  width: Math.max(0, rubberRange.x1 - rubberRange.x0),
                  top: 0,
                  bottom: 0,
                  border: `1px solid ${isDark ? 'rgba(96,165,250,0.9)' : 'rgba(59,130,246,0.9)'}`,
                  background: isDark ? 'rgba(96,165,250,0.14)' : 'rgba(59,130,246,0.10)',
                  zIndex: 14,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
        {/* Playhead spans full body：外层加宽命中区(14px)便于精准拖动；内层才是 1px 竖线 + 大三角
         * ⚠️ left 必须 = RULER_PADDING_LEFT + t*pps - 6，才让 1px 竖线对准 t*pps 位置。
         * 之前裸写 `playheadTime * pps - 7` 漏算 RULER_PADDING_LEFT(14) → 竖线永远左偏 14px，
         * 用户拖动时「指针位置」和「竖线」永远对不齐（2026-08-31 修复）。 */}
        {!hidePlayhead && (
        <div
          onMouseDown={handlePlayheadDown}
          title="拖动播放头"
          style={{ position: 'absolute', zIndex: 5, left: inset + playheadTime * pixelsPerSecond - 6, top: 0, bottom: 0, width: 14, cursor: 'ew-resize', touchAction: 'none' }}
        >
          <div style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 1, background: C.playhead, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: -3, left: 1.5, width: 11, height: 9, background: C.playhead, clipPath: 'polygon(0 0, 100% 0, 50% 100%)', pointerEvents: 'none' }} />
        </div>
        )}
      </div>
      {/* 右键菜单（分割 / 合并） */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            zIndex: 1000,
            left: contextMenu.x,
            top: contextMenu.y,
            background: isDark ? '#2a2a2a' : '#ffffff',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: '4px 0',
            minWidth: 130,
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          {onInsertAt && contextMenu.shotId && (
            <>
              <button
                type="button"
                onClick={() => { handleInsertRelative(contextMenu.shotId, 'before'); setContextMenu(null); }}
                style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: C.text, cursor: 'pointer', textAlign: 'left', fontSize: 12 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                向前插入
              </button>
              <button
                type="button"
                onClick={() => { handleInsertRelative(contextMenu.shotId, 'after'); setContextMenu(null); }}
                style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: C.text, cursor: 'pointer', textAlign: 'left', fontSize: 12 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                向后插入
              </button>
              <button
                type="button"
                onClick={() => { handleDuplicateClip(contextMenu.shotId); setContextMenu(null); }}
                style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: C.text, cursor: 'pointer', textAlign: 'left', fontSize: 12 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                复制插入
              </button>
              {(onDeleteShot || onDeleteShots) && (
                <button
                  type="button"
                  onClick={() => { handleDeleteSelection(contextMenu.shotId); setContextMenu(null); }}
                  style={{ display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent', color: theme.toolbar.danger, cursor: 'pointer', textAlign: 'left', fontSize: 12 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  删除选中
                </button>
              )}
              <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
            </>
          )}
          {onExportShot && activeShotId && (
            <button
              type="button"
              onClick={() => {
                onExportShot(activeShotId);
                setContextMenu(null);
              }}
              style={{
                display: 'block', width: '100%', padding: '6px 14px', border: 0, background: 'transparent',
                color: activeShotId ? C.text : C.muted, cursor: activeShotId ? 'pointer' : 'default',
                textAlign: 'left', fontSize: 12,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              导出到我的素材
            </button>
          )}
        </div>
      )}
      {/* T8: 裁剪时间气泡 — 跟随鼠标显示时长变化 */}
      {trimBubble && (
        <div
          style={{
            position: 'fixed',
            left: trimBubble.x,
            top: trimBubble.y,
            transform: 'translateX(-50%)',
            padding: '4px 8px',
            background: isDark ? 'rgba(42,42,42,0.95)' : 'rgba(255,255,255,0.95)',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            fontSize: 11,
            color: C.text,
            zIndex: 1000,
            pointerEvents: 'none',
            minWidth: 40,
            textAlign: 'center',
          }}
        >
          {trimBubble.text}
        </div>
      )}
    </div>
  );
});
