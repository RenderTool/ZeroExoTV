/**
 * WorkbenchMultiTrack - 出片工作台多轨容器 (Plan#82 重构，对齐 OpenCut)
 *
 * 「专业剪辑架构」: 顶部工具栏 + 时间轴标尺**全局固定**，下方是可滚动轨道列表。
 * - 2026-11-04：轨道头整列移除（名称/状态徽章/时长/拖拽排序把手），片段轨道从最左侧直接起铺。
 * - 播放头/缩放/播放命令全局共享，所有轨道使用同一套 pps/playheadTime。
 * - 支持跨轨拖拽片段移动。
 *
 * 重构要点 (Plan#82): 移除每个轨道内嵌的工具栏/标尺，改为全局固定一份，
 * 符合专业剪辑软件标准 (OpenCut 布局)。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ListChecks, Plus, SquareSplitHorizontal, Trash2 } from 'lucide-react';
import type { WorkbenchNodeData, WorkbenchTrack } from './workbench-types';
import { resolveShotsForTrack } from './workbench-sync';
import { StoryboardTimeline, type StoryboardTimelineProps, type TimelineClipData } from './storyboard-timeline';
import { TRACK_HEIGHT, RULER_HEIGHT, RULER_PADDING_LEFT, timelinePalette, DIRECTOR_CARD_GAP, pickDirectorCardWidth, directorCardHeight } from './timeline-constants';
import { computeInsertIndex } from './storyboard-drop-point';
import { useTranslation } from 'react-i18next';

/** 轨道内容总高度 */
const TRACK_FULL_HEIGHT = TRACK_HEIGHT + 16;

/**
 * 导轨工具栏图标按钮（2026-11-04 调整第二条B）：添加/链接/删除/批量 四键共用。
 * 视觉与原 toolBtnStyle 逐像素一致（高 25 / padding 0 8 / 圆角 5 / 透明底 / 图标-only /
 * title tooltip）；active = 段间衔接/批量模式态绿色（rgba(0,199,88,0.16)+#00c758）。
 */
function RailIconButton({ icon, label, title, onClick, disabled, active, dataAttr, color }: {
  icon: ReactNode;
  /** 2026-11-04 第七条B：文字标签（图标+文字，不退化为纯 icon） */
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  dataAttr?: string;
  color: string;
}): ReactElement {
  return (
    <button
      type="button"
      {...(dataAttr ? { [dataAttr]: true } : {})}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 25, padding: '0 8px', border: 0, borderRadius: 5,
        background: active ? 'rgba(0,199,88,0.16)' : 'transparent',
        color: active ? '#00c758' : color,
        fontSize: 11, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {label ? <span data-rail-label style={{ fontSize: 11, lineHeight: 1 }}>{label}</span> : null}
    </button>
  );
}

export interface WorkbenchMultiTrackProps {
  /** 全部方案轨 (过滤 discarded 由容器内部处理) */
  tracks: WorkbenchTrack[];
  /** 镜头池 + 类型数据 */
  data: WorkbenchNodeData;
  /** 当前聚焦轨 id */
  focusedTrackId: string | null;
  onFocusTrack: (trackId: string) => void;
  /** 完整宿主时间轴 props */
  timeline: StoryboardTimelineProps;
  /** 跨轨拖放回调: (fromTrackId, toTrackId, insertIndex, shotId) */
  onMoveShotBetweenTracks?: (fromTrackId: string, toTrackId: string, insertIndex: number, shotId: string) => void;
  /**
   * 2026-11-04 导演台 H3：活动轨片段内容层附加层（延续标记画在片段接缝上）。
   * 仅透传给活动轨 StoryboardTimeline；与片段同滚动/transform/pps。
   */
  contentOverlay?: React.ReactNode;
  /**
   * 2026-11-04 导演台（约定）：轨道选择模式（批量 / 段间衔接）。非 null 时
   * 全局工具行替换为模式态（名称 + 已选 N 段 + 完成/取消）；null 时工具行逐像素不变。
   * 勾选框本体由 contentOverlay 注入（与片段同坐标系）。
   */
  selectMode?: {
    kind: 'batch' | 'continuity';
    /** 已选段数（批量=选中集合大小；段间衔接=草稿中已开启引导的交界数） */
    count: number;
    /** 2026-11-04 链接模式「全选」：可衔接交界总数（段 2..N；段 1 恒不可选）。仅 continuity 传 */
    total?: number;
    /** 2026-11-04 链接模式「全选/取消全选」：当前是否已全选（决定按钮文案） */
    allSelected?: boolean;
    /** 2026-11-04 链接模式「全选/取消全选」回调（作用于草稿，完成才落盘、取消回滚） */
    onSelectAll?: () => void;
    onDone: () => void;
    onCancel: () => void;
  } | null;
  /**
   * 2026-11-04 导演台（约定）：分割图标保留原形（SquareSplitHorizontal），
   * 名称/功能改为「段间衔接」模式开关。仅在提供本 prop 时生效；缺省 = 原分割行为（出片页零变化）。
   */
  continuityEntry?: { active: boolean; onToggle: () => void };
  /**
   * 2026-11-04 导演台（调整第二条A）：「批量」从面板底栏下移为导轨工具栏第 4 个图标
   * 按钮（添加/链接/删除/批量 同款）。仅提供本 prop 时渲染；缺省 = 出片页零变化。
   */
  batchEntry?: { active: boolean; onToggle: () => void };
  /** 2026-11-04 导演台：片段文字单行版式（镜头号 N · Xs），仅活动轨透传 */
  clipLabelMode?: 'director';
  /* 2026-11-04 第八条B：片段内勾选框（clipChecks）整块移除——勾选改到轨道上方表格 */
  /**
   * 2026-11-04 导演台导轨零基线（调整，仅导演台宿主传 true）：
   * - 移除轨道行首白色竖线（聚焦轨 borderLeft 播放头色指示条），不留透明占位；
   * - 刻度/片段统一从 x=0 起铺（去掉 14px 左衬与 2px 行边距）→ 首个片段左缘 = 刻度 0 同 x；
   * - 横向滚动由本组件 scroll 容器统一承担（主题细滚动条、刻度尺 scrollLeft 同步、滚轮/Ctrl+缩放）；
   * - 拖拽 = pointer 制（project-rules/specs/director-h3-workspace/drag-spec.md）：4px 阈值、单一 2px 插入线
   *   [data-drop-line] + 虚线占位 [data-drag-placeholder]、100ms 防抖 ±8px 容差、Esc/失焦取消。
   * 缺省 false = 出片页等既有路径零变化。
   */
  zeroBaseRail?: boolean;
  /**
   * 2026-11-05 固定宽度卡片（220px 基准修订）：导演台卡片宽度随导轨容器宽度降级
   * （≥720→220；480–719→180；<480→160；测量不可用→220）。本组件实测容器宽度并
   * 计算最终卡片宽，经本回调上报宿主——宿主覆盖层（衔接箭头/勾选块/引导缩略）
   * 的 x 铺排必须与卡片同 pitch，杜绝两套几何。仅 zeroBaseRail 时调用；缺省 = 出片页零变化。
   */
  onDirectorCardWidthChange?: (width: number) => void;
  /**
   * 2026-11-05 导演台卡片缩略框播放键：点击 = 打开右侧预览并切到该段。
   * 仅活动轨透传；缺省 = 出片页零变化。
   */
  onDirectorPlay?: (shotId: string) => void;
  /**
   * 2026-11-04 参数区搬家（约定：参数移到导轨「批量」附近；
   * 2026-11-05 二调：批量按钮置于运行左侧——拆成两个注入位，渲染顺序 = 删除/参数/批量/运行）：
   * 「参数」按钮（浮层面板内含比例下拉/×系数/换算尺寸 chip）注入「删除」之后；
   * 「运行」按钮注入「批量」之后。仅导演台宿主提供；缺省 = 出片页工具行零变化。
   */
  paramsButton?: React.ReactNode;
  runButton?: React.ReactNode;
}

function readOnlyTimelineProps(full: StoryboardTimelineProps): StoryboardTimelineProps {
  return {
    ...full,
    onReorder: undefined,
    onTrim: undefined,
    onDeleteShot: undefined,
    onDeleteShots: undefined,
    onSplitShot: undefined,
    onMergeShots: undefined,
    onInsertAt: undefined,
    onExportShot: undefined,
    onExportAll: undefined,
    onExportSelected: undefined,
    canExport: false,
    onBatchGenerateAll: undefined,
    onBatchGenerateSelected: undefined,
    canBatchGenerate: false,
  };
}

/** 格式化时间 (秒 → MM:SS) */
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

/**
 * 2026-11-04 拖拽重做（drag-spec.md#4/5）：插入缝 x（内容坐标）。
 * index === rects.length → 末段右缘；index === 0 → 0。
 */
function seamX(index: number, rects: Array<{ left: number; width: number }>): number {
  if (index <= 0) return 0;
  if (index >= rects.length) {
    const last = rects[rects.length - 1];
    return last ? last.left + last.width : 0;
  }
  return rects[index]!.left;
}

/** 标尺步进：根据 pixelsPerSecond 动态调整刻度步长 (Plan#82 T2) */
function rulerStep(pps: number): number {
  if (pps > 100) return 1;
  if (pps > 30) return 5;
  if (pps > 10) return 10;
  return 30;
}

/** 全局标尺组件 (Plan#82 T2 步进隐藏 + 2026-09-08 集成全局唯一播放头) */
function GlobalRuler({
  pps,
  totalDuration,
  renderedWidth,
  formatTime: fmt,
  isDark,
  colors,
  playheadTime,
  onPlayheadChange,
  contentPad = RULER_PADDING_LEFT,
}: {
  pps: number;
  totalDuration: number;
  renderedWidth: number;
  formatTime: (s: number) => string;
  isDark: boolean;
  colors: ReturnType<typeof timelinePalette>;
  playheadTime: number;
  onPlayheadChange?: (timeSec: number) => void;
  /** 2026-11-04 内容零基线：刻度/标签/播放头起算 x（出片页=14；导演台零基线=0） */
  contentPad?: number;
}) {
  const step = rulerStep(pps);
  const labels: ReactElement[] = [];
  const maxSec = Math.max(totalDuration, renderedWidth / pps);
  for (let s = 0; s <= Math.ceil(maxSec); s += step) {
    // Plan#83 bug2：刻度/标签与轨道内容、播放头统一从 contentPad 起算，0s 刻度正对片段起点
    const x = contentPad + s * pps;
    if (x > renderedWidth + contentPad * 1.5) break;
    const isInExtension = s > totalDuration;
    labels.push(
      <span
        key={`ruler-${s}`}
        style={{
          position: 'absolute',
          left: x,
          bottom: 3,
          // Plan#83 bug3：8px→10px 且改用最高对比 text 色，两种主题下刻度文本清晰可读
          fontSize: 10,
          fontWeight: 500,
          lineHeight: '10px',
          color: isInExtension ? (isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)') : colors.text,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmt(s)}
      </span>,
    );
  }
  // 刻度线（每 1s 一条，保持刻度线密度不变，只有标签步进）
  const tickMarks: ReactElement[] = [];
  for (let s = 0; s <= Math.ceil(maxSec); s += 1) {
    // Plan#83 bug2：刻度线同样加 contentPad，与标签/播放头/片段起点对齐
    const x = contentPad + s * pps;
    if (x > renderedWidth + contentPad * 1.5) break;
    // 只画刻度线，不画标签（标签由 labels 控制）
    tickMarks.push(
      <div
        key={`tick-${s}`}
        data-ruler-tick={s}
        style={{
          position: 'absolute',
          left: x,
          bottom: 0,
          width: 1,
          height: s % step === 0 ? 8 : 4,
          background: s % step === 0 ? colors.rulerLine : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
          pointerEvents: 'none',
        }}
      />,
    );
  }
  // 点击空白标尺：移动播放头到点击位置（参照 StoryboardTimeline.handleRulerClick 行为）
  // Plan#83 bug4：拖播放头松手后浏览器会补发一次合成 click，若不吞掉会把播放头再
  // 跳一次到鼠标位置（症状：松手后游标仍跟随鼠标）。与 handleTrackPointerUp 的
  // suppressTrackClickRef 同款模式：pointerup 置位 → 吞掉本宏任务内的 click → setTimeout 复位。
  const suppressClickRef = useRef(false);
  /** 播放头是否正在被拖拽（供 moveHandler 兜底校验，杜绝松手后仍跟随的边界泄漏） */
  const draggingPlayheadRef = useRef(false);
  const handleRulerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPlayheadChange) return;
    if (suppressClickRef.current) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    // Plan#83 bug5：点击定位减 contentPad，与刻度/播放头同一坐标基准
    const x = e.clientX - rect.left;
    const timeSec = Math.max(0, (x - contentPad) / pps);
    onPlayheadChange(timeSec);
  }, [pps, onPlayheadChange, contentPad]);
  // 拖动播放头三角形
  const handlePlayheadPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!onPlayheadChange) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startTime = playheadTime;
    const moveHandler = (ev: PointerEvent) => {
      // 兜底：若已发生过 pointerup/pointercancel，残留的 move 一律忽略（松手后不再跟随鼠标）
      if (!draggingPlayheadRef.current) return;
      const dx = ev.clientX - startX;
      const t = Math.max(0, startTime + dx / pps);
      onPlayheadChange(t);
    };
    const upHandler = () => {
      draggingPlayheadRef.current = false;
      // 拖拽结束 → 吞掉紧随的合成 click，防止播放头「松手后又跳到鼠标位置」
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      window.removeEventListener('pointermove', moveHandler);
      window.removeEventListener('pointerup', upHandler);
      window.removeEventListener('pointercancel', upHandler);
    };
    draggingPlayheadRef.current = true;
    // pointercancel 同样收尾：浏览器中断指针序列（如系统手势/捕获被抢）时也能正常清理，不留泄漏
    window.addEventListener('pointermove', moveHandler);
    window.addEventListener('pointerup', upHandler);
    window.addEventListener('pointercancel', upHandler);
  }, [pps, onPlayheadChange, playheadTime]);

  const playheadLeft = contentPad + playheadTime * pps;

  return (
    <div
      style={{
        position: 'relative',
        height: RULER_HEIGHT,
        flexShrink: 0,
        borderBottom: `1px solid ${colors.rulerLine}`,
        overflow: 'hidden',
        width: '100%',
        minWidth: '100%',
        background: colors.bg,
        cursor: onPlayheadChange ? 'pointer' : 'default',
      }}
      onClick={handleRulerClick}
    >
      <div style={{ position: 'relative', width: renderedWidth, height: '100%' }}>
        {tickMarks}
        {labels}
        {/* 播放头：三角形把手 + 竖线（三角形落在刻度上，竖线向下贯穿轨道区，由 scrollRef 内的全局竖线接管） */}
        {onPlayheadChange && (
          <div
            onPointerDown={handlePlayheadPointerDown}
            style={{
              position: 'absolute',
              left: playheadLeft - 6,
              top: 0,
              width: 14,
              height: '100%',
              cursor: 'ew-resize',
              touchAction: 'none',
              zIndex: 5,
            }}
            title="拖动播放头"
          >
            <div
              style={{
                position: 'absolute',
                left: 6,
                top: 0,
                bottom: 0,
                width: 1,
                background: colors.playhead,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 1.5,
                width: 11,
                height: 9,
                background: colors.playhead,
                clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
                pointerEvents: 'none',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const WorkbenchMultiTrack = memo(function WorkbenchMultiTrack({
  tracks,
  data,
  focusedTrackId,
  onFocusTrack,
  timeline,
  onMoveShotBetweenTracks,
  contentOverlay,
  selectMode,
  continuityEntry,
  batchEntry,
  clipLabelMode,
  zeroBaseRail = false,
  onDirectorCardWidthChange,
  onDirectorPlay,
  paramsButton,
  runButton,
}: WorkbenchMultiTrackProps): ReactElement {
  const { t } = useTranslation();
  /** 内容零基线：出片页保持 RULER_PADDING_LEFT(14)；导演台零基线=0（片段起点=刻度 0，无占位列） */
  const CONTENT_PAD = zeroBaseRail ? 0 : RULER_PADDING_LEFT;
  // 2026-11-04 出片页单轨化：UI 只显示活动轨（缺省回落第一轨=主轨）。
  // 其余轨道数据保留在 data.tracks 不删不迁（旧多轨项目打开时仅隐藏候选轨，可逆）。
  const visible = useMemo(
    () => {
      const all = tracks.filter((t) => t.status !== 'discarded').slice().sort((a, b) => a.order - b.order);
      const active = all.find((t) => t.status === 'active') ?? all[0];
      return active ? [active] : [];
    },
    [tracks],
  );
  const focused = focusedTrackId ? visible.find((t) => t.id === focusedTrackId) : undefined;
  const active = visible.find((t) => t.status === 'active') ?? visible[0];
  const focusedTrack = focused ?? active;

  // 各轨 resolved 镜头序列与时长
  const byTrack = useMemo(() => {
    const m = new Map<string, { timelineClips: TimelineClipData[]; duration: number }>();
    for (const t of visible) {
      const shots = resolveShotsForTrack(t, data);
      const duration = shots.reduce((s, x) => s + x.duration, 0);
      const timelineClips = shots.map((s) => ({
        id: s.id,
        number: s.number,
        duration: s.duration,
        status: s.status === 'pending' ? 'idle' as const : s.status,
        thumbnailUrl: s.firstFrameKey,
        videoKey: s.clipState === 'completed' && s.media?.storageKey ? s.media.storageKey : undefined,
        trimStart: s.media?.trimStart,
        trimEnd: s.media?.trimEnd,
        sourceDuration: s.media?.sourceDuration,
        label: `#${s.number} ${s.description || s.shotType}`,
        hasAudio: !!s.audioPreview,
      }));
      m.set(t.id, { timelineClips, duration });
    }
    return m;
  }, [visible, data]);

  const C = useMemo(() => timelinePalette(timeline.isDark, timeline.theme?.canvas?.background), [timeline.isDark, timeline.theme?.canvas?.background]);
  // Plan#83 E：跨轨拖拽 hover 状态——记录当前被悬停的 track + 插入位 x（仅出片页 HTML5 DnD 路径使用）
  const [dragHover, setDragHover] = useState<{ trackId: string; insertX: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 刻度尺容器（导演台零基线：与轨道 scroll 容器 scrollLeft 同步） */
  const rulerScrollRef = useRef<HTMLDivElement>(null);

  /**
   * 2026-11-05 固定宽度卡片（220px 基准修订）：实测导轨容器（[data-rail-scroll]）可视宽度
   * → 卡片宽度降级（≥720→220；480–719→180；<480→160；测量不可用→220 基准）。
   * ResizeObserver 跟随分栏拖拽/窗口缩放；jsdom 等无布局环境 clientWidth=0 → 基准 220。
   */
  const [railViewportWidth, setRailViewportWidth] = useState(0);
  useEffect(() => {
    if (!zeroBaseRail) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => { if (el.clientWidth > 0) setRailViewportWidth(el.clientWidth); };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [zeroBaseRail]);
  const directorCardWidth = zeroBaseRail ? pickDirectorCardWidth(railViewportWidth) : 0;
  const directorCardPitch = directorCardWidth + DIRECTOR_CARD_GAP;
  /** 2026-11-05 导演台卡片高度（缩略框 + 标签行）+ 轨道行上下余量 16；出片页保持 TRACK_FULL_HEIGHT */
  const railCardHeight = zeroBaseRail ? directorCardHeight(directorCardWidth) : TRACK_HEIGHT;
  const railRowHeight = zeroBaseRail ? railCardHeight + 16 : TRACK_FULL_HEIGHT;
  const onDirectorCardWidthChangeRef = useRef(onDirectorCardWidthChange);
  onDirectorCardWidthChangeRef.current = onDirectorCardWidthChange;
  useEffect(() => {
    if (zeroBaseRail) onDirectorCardWidthChangeRef.current?.(directorCardWidth);
  }, [zeroBaseRail, directorCardWidth]);

  // 聚焦轨时长
  const totalDuration = useMemo(() => {
    if (!focusedTrack) return 0;
    const entry = byTrack.get(focusedTrack.id);
    return entry?.duration ?? 0;
  }, [focusedTrack, byTrack]);

  // 总渲染宽度（2026-11-04 刻度范围修复，症状：时间轴时长只有 3 分钟）：
  // 按内容计算——刻度总长 = 所有片段时长之和 + 尾部余量（与内层时间轴同一规则
  // max(30%, 60s)，能继续往后拖/看）；无硬编码上限，内容超长自动延伸，最后一段
  // 永远在刻度内；下限 800px（短工程刻度也不会短到看不见）；新增片段/改时长/
  // 拖拽重排后随 totalDuration 即时重算。
  // 2026-11-05 固定宽度片段卡片（导演台 zeroBaseRail）：总宽改按卡片数计算 =
  // 卡片间距铺排 + 固定尾部余量 200px（刻度尺已删，无时间↔像素映射）。
  const renderedWidth = useMemo(() => {
    if (zeroBaseRail) {
      const count = focusedTrack ? (byTrack.get(focusedTrack.id)?.timelineClips.length ?? 0) : 0;
      return Math.max(count * directorCardPitch + 200, 800);
    }
    const tailSec = Math.max(totalDuration * 0.3, 60);
    return Math.max((totalDuration + tailSec) * timeline.pixelsPerSecond, 800);
  }, [zeroBaseRail, focusedTrack, byTrack, totalDuration, timeline.pixelsPerSecond, directorCardPitch]);

  /**
   * 2026-11-04 导演台拖拽 hover（zeroBaseRail）：每轨 clip 矩形（内容坐标，clipGap=0 首尾相接）。
   * hover 高亮与最终 drop 共用同一份判定（computeInsertIndex，见下），杜绝「亮 A 落 B」。
   */
  const trackClipRects = useMemo(() => {
    const m = new Map<string, Array<{ left: number; width: number }>>();
    const pps = timeline.pixelsPerSecond;
    for (const track of visible) {
      const entry = byTrack.get(track.id);
      const clips = entry?.timelineClips ?? [];
      let left = 0;
      const rects: Array<{ left: number; width: number }> = [];
      for (const c of clips) {
        // 2026-11-05 固定宽度片段卡片（导演台 zeroBaseRail）：矩形 = 等宽卡片按间距铺排
        const width = zeroBaseRail ? directorCardWidth : Math.max(1, c.duration * pps);
        rects.push({ left, width });
        left += zeroBaseRail ? directorCardPitch : width;
      }
      m.set(track.id, rects);
    }
    return m;
  }, [visible, byTrack, timeline.pixelsPerSecond, zeroBaseRail, directorCardWidth, directorCardPitch]);

  /** 拖拽会话实时读取最新 rects（window 监听器闭包内用，避免过期快照） */
  const trackClipRectsRef = useRef(trackClipRects);
  trackClipRectsRef.current = trackClipRects;
  /** 提交回调 ref（同上：window 监听器闭包内始终调最新） */
  const onMoveShotRef = useRef(onMoveShotBetweenTracks);
  onMoveShotRef.current = onMoveShotBetweenTracks;

  /** 2026-11-04 导演台（zeroBaseRail）：滚轮横向滚动 + Ctrl/Cmd 缩放（单 scroll 容器统一承担） */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !zeroBaseRail) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // 2026-11-05 固定宽度卡片：卡片导轨不随时长/缩放铺排，Ctrl+滚轮仅拦截浏览器页缩放
        return;
      }
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta !== 0) {
        e.preventDefault();
        el.scrollLeft += delta;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zeroBaseRail, timeline.pixelsPerSecond, timeline.onPixelsPerSecondChange]);

  // 全局工具栏回调
  const handleAddClip = useCallback(() => {
    if (!timeline.onInsertAt) return;
    timeline.onInsertAt(null);
  }, [timeline.onInsertAt]);

  const handleDeleteShot = useCallback(() => {
    if (!timeline.activeShotId || !timeline.onDeleteShot) return;
    timeline.onDeleteShot(timeline.activeShotId);
  }, [timeline.activeShotId, timeline.onDeleteShot]);

  // 跨轨拖拽: 从 clip 开始拖拽时记录源信息（仅出片页 HTML5 DnD 路径；导演台 zeroBaseRail 传 undefined）
  const handleClipDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, clipId: string) => {
    // 从 byTrack 查找 clipId 所属轨道
    let fromTrackId: string | undefined;
    for (const [tid, entry] of byTrack) {
      if (entry.timelineClips.some((c) => c.id === clipId)) {
        fromTrackId = tid;
        break;
      }
    }
    if (!fromTrackId) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-workbench-shot', JSON.stringify({ shotId: clipId, fromTrackId }));
    e.dataTransfer.effectAllowed = 'move';
  }, [byTrack]);

  // Plan#83 E：跨轨/同轨拖拽 hover 高亮 + 插入位指示（仅出片页 HTML5 DnD 路径）
  const handleTrackDragOver = useCallback((e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes('application/x-workbench-shot')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLDivElement;
    const rect = el.getBoundingClientRect();
    e.dataTransfer.dropEffect = 'move';
    // 实时计算插入位 x（2026-11-04 轨道头已下线：轨道内容从最左侧起算）
    const x = Math.max(0, e.clientX - rect.left);
    setDragHover({ trackId, insertX: x });
  }, []);

  const handleTrackDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>, trackId: string) => {
    // 仅当离开的是当前 hover track 时清除（避免子元素触发leave把高亮闪掉）
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    if (dragHover?.trackId === trackId) setDragHover(null);
  }, [dragHover]);

  const handleTrackDrop = useCallback((e: React.DragEvent<HTMLDivElement>, toTrackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragHover(null);
    try {
      const raw = e.dataTransfer.getData('application/x-workbench-shot');
      if (!raw) return;
      const { shotId, fromTrackId } = JSON.parse(raw) as { shotId: string; fromTrackId: string };

      const el = e.currentTarget as HTMLDivElement;
      const rect = el.getBoundingClientRect();

      const x = (e.clientX - rect.left) + (el.parentElement?.scrollLeft ?? 0);
      const pps = timeline.pixelsPerSecond;
      const timeSec = x / pps;

      const entry = byTrack.get(toTrackId);
      const clips = entry?.timelineClips ?? [];
      let insertIndex = clips.length;
      let acc = 0;
      for (let i = 0; i < clips.length; i++) {
        const c = clips[i]!;
        const clipEnd = acc + c.duration;
        if (timeSec < clipEnd) {
          insertIndex = i;
          break;
        }
        acc += c.duration + 2;
        insertIndex = i + 1;
      }

      // Plan#83 E：同轨 drop 也调用 onMoveShotBetweenTracks（同轨即重排序）
      onMoveShotBetweenTracks?.(fromTrackId, toTrackId, insertIndex, shotId);
    } catch { /* ignore */ }
  }, [byTrack, timeline.pixelsPerSecond, onMoveShotBetweenTracks]);

  // ===== 2026-11-04 导演台拖拽 实时预览（zeroBaseRail，唯一判定来源 = project-rules/specs/director-h3-workspace/drag-spec.md）=====
  // 规格#1：仅普通模式可拖（selectMode 非 null / 无 onMoveShotBetweenTracks → 不启动）。
  // 规格#2：pointerdown 起算，位移 ≤4px 视为点击；>4px 才进入拖拽。
  // 规格#3：拖起后被拖片段 = 浮层幽灵跟随指针（externalClipPreview.dragX，抓取点偏移保持，scale/阴影/半透明/grabbing 由 TimelineClip 承担）。
  // 规格#4：拖动中其余片段实时让位（StoryboardTimeline 按预览顺序算 transform delta，过渡 ~120ms），拖动期间呈现 = 松手后排列。
  // 规格#5：预览落点唯一判定 = computeInsertIndex 中点归属；距当前缝线 ≤8px 不换边；预览跟手即时更新（无 100ms 防抖）。
  // 规格#6：预览落位渲染整段占位框（半透明实体，非 2px 线）。
  // 规格#7：仅指针距容器左右缘 <24px 时按 12px/次固定步进自动横滚；幽灵位移含滚动补偿。
  // 规格#8：Esc / 窗口失焦 / pointercancel = 取消恢复原顺序；预览态即刻清零。
  // 规格#9：pointerup = 提交当前预览顺序唯一一次（落点 === 预览位置）；原位（index === from 或 from+1）不提交。
  // 规格#10：提交后 capture 阶段吞掉紧随的 click，避免松手误选中。
  /** 渲染态（预览落点 + 幽灵位移）；拖拽会话的实时值在 ref，避免高频 re-render */
  const [railDragView, setRailDragView] = useState<{ trackId: string; clipId: string; insertIndex: number; dragX: number } | null>(null);
  const railDragSessionRef = useRef<{
    clipId: string; trackId: string; fromIndex: number; startX: number; startScrollLeft: number;
    dragging: boolean; insertIndex: number;
  } | null>(null);

  const handleRailPointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 规格#1：仅普通模式（zeroBaseRail + 非批量/衔接模式 + 可编辑）可拖
    if (!zeroBaseRail || selectMode || !onMoveShotBetweenTracks) return;
    if (e.button !== 0) return;
    if (railDragSessionRef.current) return;
    const target = e.target as Element | null;
    const clipEl = target?.closest?.('[data-clip-id]') as HTMLElement | null;
    if (!clipEl) return;
    // 勾选框（批量模式覆盖层）上不启动拖拽
    if (target?.closest?.('[data-clip-check]')) return;
    const clipId = clipEl.getAttribute('data-clip-id');
    const trackRow = target?.closest?.('[data-track-id]');
    const trackId = trackRow?.getAttribute('data-track-id');
    if (!clipId || !trackId) return;
    const entry = byTrack.get(trackId);
    const fromIndex = (entry?.timelineClips ?? []).findIndex((c) => c.id === clipId);
    if (fromIndex < 0) return;

    const session = {
      clipId, trackId, fromIndex, startX: e.clientX,
      startScrollLeft: scrollRef.current?.scrollLeft ?? 0,
      dragging: false, insertIndex: fromIndex,
    };
    railDragSessionRef.current = session;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      railDragSessionRef.current = null;
      // 规格#3：grabbing 光标与预览态随会话结束即刻恢复（规格#11 零残留）
      document.body.style.cursor = '';
      setRailDragView(null);
    };
    const onCancel = () => { cleanup(); };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cleanup(); }
    };
    const onMove = (ev: PointerEvent) => {
      const s = railDragSessionRef.current;
      if (!s) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const sRect = scrollEl.getBoundingClientRect();
      // 规格#7：仅指针贴近左右缘 <24px 时按 12px 固定步进自动横滚，其余不滚、不跳滚
      if (ev.clientX < sRect.left + 24) scrollEl.scrollLeft = Math.max(0, scrollEl.scrollLeft - 12);
      else if (ev.clientX > sRect.right - 24) scrollEl.scrollLeft = Math.min(scrollEl.scrollWidth, scrollEl.scrollLeft + 12);
      // 幽灵位移 = 指针位移 + 滚动补偿（content 坐标系，自动横滚后不跑偏）
      const dx = (ev.clientX - s.startX) + (scrollEl.scrollLeft - s.startScrollLeft);
      if (!s.dragging) {
        // 规格#2：位移 ≤4px 视为点击（交给片段原有点击选中），>4px 才进入拖拽
        if (Math.abs(dx) <= 4) return;
        s.dragging = true;
        s.insertIndex = s.fromIndex;
        document.body.style.cursor = 'grabbing';
      }
      const xContent = Math.max(0, ev.clientX - sRect.left + scrollEl.scrollLeft - CONTENT_PAD);
      const rects = trackClipRectsRef.current.get(s.trackId) ?? [];
      // 规格#5：唯一落点判定（中点归属）+ ±8px 容差；预览跟手即时更新（无防抖迟滞）
      let idx = computeInsertIndex(xContent, rects);
      if (idx !== s.insertIndex && Math.abs(xContent - seamX(s.insertIndex, rects)) <= 8) idx = s.insertIndex;
      s.insertIndex = idx;
      setRailDragView({ trackId: s.trackId, clipId: s.clipId, insertIndex: idx, dragX: dx });
    };
    const onUp = (ev: PointerEvent) => {
      const s = railDragSessionRef.current;
      if (!s) { cleanup(); return; }
      if (s.dragging) {
        // 规格#9：提交当前预览顺序唯一一次；落点 === 预览位置；原位（index === from 或 from+1）不提交
        if (s.insertIndex !== s.fromIndex && s.insertIndex !== s.fromIndex + 1) {
          onMoveShotRef.current?.(s.trackId, s.trackId, s.insertIndex, s.clipId);
        }
        // 规格#10：吞掉紧随的合成 click 与本次 pointerup 的下游选中逻辑（松手不误选中、不跳播放头）。
        // 合成 click 在 pointerup 同一事件序列内同步派发（pointerup → mouseup → click），
        // 故 setTimeout(0) 即可兜底移除——窗口越短，越不会误吞下一次真实点击（曾以 50ms 残留
        // 吞掉后续交互，造成批量模式偶发进不去的 flake）。
        ev.stopPropagation();
        ev.preventDefault();
        const swallow = (cev: Event) => { cev.stopPropagation(); cev.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      cleanup();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    // 规格#8：pointercancel / Esc / 窗口失焦 = 取消恢复原顺序
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  }, [zeroBaseRail, selectMode, onMoveShotBetweenTracks, byTrack, CONTENT_PAD]);

  /** 组件卸载兜底：拖拽会话的 window 监听器必须随组件一起清掉（规格#11 零残留的卸载面） */
  useEffect(() => () => {
    if (railDragSessionRef.current) {
      railDragSessionRef.current = null;
      document.body.style.cursor = '';
      setRailDragView(null);
    }
  }, []);

  // Plan#83 H：toolBtnStyle 颜色从 C.muted 改为 C.text，确保 ≥0.75 亮度对比，工具栏图标/标题可读
  const toolBtnStyle = useMemo(() => ({
    height: 25,
    padding: '0 8px',
    border: 0,
    borderRadius: 5,
    background: 'transparent',
    color: C.text,
    fontSize: 11,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  }), [C.text]);

  /**
   * 2026-11-04 第五条：批量/段间衔接模式键盘等价操作
   * Esc = 取消并退出模式；Enter = 完成（与点击等价）。
   * 焦点在文本输入（INPUT/TEXTAREA/contentEditable，如提示词编辑器）时不拦截，避免与文本输入冲突。
   */
  useEffect(() => {
    if (!selectMode) return;
    const isTextTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTextTarget(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); selectMode.onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); selectMode.onDone(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selectMode]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: C.bg,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* ===== 全局固定工具栏 (Plan#82 T3 重构 + Plan#83 B1~B4 中间样式重构) =====
          2026-11-04 第五条：selectMode 不再整行替换——完成/取消+已选计数注入入口按钮之后，
          与 添加/链接/删除/批量 同一视区同一行；本行 flexShrink:0 固定在轨道区顶部，滚动片段区不消失 */}
      <div data-rail-toolbar style={{ height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', ...(zeroBaseRail ? {} : { borderBottom: `1px solid ${C.border}` }), overflowX: 'auto', scrollbarWidth: 'none', containerType: 'inline-size', containerName: 'railToolbar' } as React.CSSProperties}>
        {/* 左侧: 编辑工具（2026-11-04 第二条A/B：添加/链接/删除/批量 四键共用 RailIconButton；
            第七条B：图标+文字，容器变窄横向滚动、不换行、不退化纯 icon） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <RailIconButton icon={<Plus size={15} />} label={t('workbench.multitrack.add', '添加')} title="在末尾添加新片段" onClick={handleAddClip} disabled={!timeline.onInsertAt} color={C.text} />
          {continuityEntry ? (
            /* 分割图标保留原形，名称/功能改为「段间衔接」模式开关 */
            <RailIconButton dataAttr="data-continuity-mode" icon={<SquareSplitHorizontal size={14} />} label={t('workbench.multitrack.link', '链接')} title="段间衔接" onClick={continuityEntry.onToggle} active={continuityEntry.active} color={C.text} />
          ) : null}
          {/* 分割入口整项删除（2026-11-05 调整：右键菜单/工具栏/快捷键入口全清，数据逻辑 onSplitShot 不动） */}
          <RailIconButton icon={<Trash2 size={15} />} label={t('workbench.multitrack.delete', '删除')} title="删除选中片段" onClick={handleDeleteShot} disabled={!timeline.activeShotId || !timeline.onDeleteShot} color={C.text} />
          {/* 2026-11-04 参数合并（约定）+ 2026-11-05 二调（批量按钮置于运行左侧）：
              工具行顺序 = 添加/链接/删除/参数/批量/运行；「参数」（浮层面板，无边框）在「删除」之后，
              「运行」（主行动实心）紧邻「批量」右侧；裸控件不再出现在导轨上。
              仅导演台宿主提供 paramsButton/runButton，出片页工具行零变化。 */}
          {paramsButton}
          {batchEntry ? (
            /* 2026-11-04 第十一条B/C：「批量」= 打开批量运行面板（不再是勾选模式），图标+文字的普通按钮 */
            <RailIconButton dataAttr="data-batch-mode" icon={<ListChecks size={14} />} label={t('workbench.multitrack.batch', '批量')} title={t('workbench.multitrack.batchTitle', '批量运行（勾选片段）')} onClick={batchEntry.onToggle} active={batchEntry.active} color={C.text} />
          ) : null}
          {runButton}
          {selectMode && (
            /* 完成(主行动·实心 accent)/取消(次要·描边)：紧跟其后，间距 ≤12px，高度 25 与同行控件同基线；
               第八条A：「已选 N 段」计数只服务批量勾选——第十一条后勾选收敛进批量面板（计数在面板底部），模式条不显示计数 */
            <span data-track-select-mode={selectMode.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
              {selectMode.kind === 'batch' && (
                <span data-select-mode-count style={{ fontSize: 11, color: C.muted }}>已选 {selectMode.count} 段</span>
              )}
              {selectMode.kind === 'continuity' && (
                /* 2026-11-04 链接模式「全选/取消」（约定）：计数 已选 M/M + 全选/取消全选按钮，
                   与批量模式同一行同一基线；草稿语义（完成落盘/取消回滚）由宿主承担 */
                <>
                  <span data-select-mode-count style={{ fontSize: 11, color: C.muted }}>已选 {selectMode.count}/{selectMode.total ?? 0}</span>
                  <button
                    type="button"
                    data-select-all
                    onClick={selectMode.onSelectAll}
                    style={{ height: 25, padding: '0 10px', fontSize: 11, cursor: 'pointer', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, whiteSpace: 'nowrap' }}
                  >{selectMode.allSelected ? '取消全选' : '全选'}</button>
                </>
              )}
              <button
                type="button"
                data-select-mode-done
                onClick={selectMode.onDone}
                style={{ height: 25, padding: '0 10px', fontSize: 11, cursor: 'pointer', borderRadius: 5, border: 'none', background: timeline.theme.toolbar.accent, color: '#fff', whiteSpace: 'nowrap' }}
                /* 2026-11-04 文案微调（约定）：批量模式提交按钮 = 「生成」（打开 dry-run 预检）；链接模式 = 「完成」（草稿落盘） */
              >{selectMode.kind === 'batch' ? t('workbench.multitrack.generate', '生成') : t('workbench.multitrack.done', '完成')}</button>
              <button
                type="button"
                data-select-mode-cancel
                onClick={selectMode.onCancel}
                style={{ height: 25, padding: '0 10px', fontSize: 11, cursor: 'pointer', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: C.text }}
              >取消</button>
            </span>
          )}
        </div>

        {/* 2026-11-04 出片页改造：去掉播放按钮与时间码显示（原 Plan#83 B1~B4 中间播放控制 + 「播放选中」按钮下线） */}
        <div style={{ flex: 1 }} />

        {/* 右侧: 缩放控件 (对接 StoryboardTimeline 的缩放，保留 zx-timeline-zoom 白色画风)
            2026-11-05 固定宽度片段卡片：导演台（zeroBaseRail）卡片不随时长/缩放铺排，缩放控件整组下线 */}
        {!zeroBaseRail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={() => timeline.onPixelsPerSecondChange?.(timeline.pixelsPerSecond - 10)} style={{ ...toolBtnStyle, fontSize: 14, padding: '0 6px' }} title="缩小">−</button>
          <input
            type="range"
            min={4}
            max={240}
            step={1}
            value={timeline.pixelsPerSecond}
            onChange={(e) => timeline.onPixelsPerSecondChange?.(Number(e.target.value))}
            className="zx-timeline-zoom"
            data-theme={timeline.isDark ? 'dark' : 'light'}
            style={{ width: 120 }}
            title="缩放"
          />
          <button type="button" onClick={() => timeline.onPixelsPerSecondChange?.(timeline.pixelsPerSecond + 10)} style={{ ...toolBtnStyle, fontSize: 14, padding: '0 6px' }} title="放大">+</button>
          {/* Plan#83 H：缩放百分比文字 C.muted → C.text，保证 ≥0.75 亮度对比 */}
          <span style={{ fontSize: 10, color: C.text, minWidth: 36, textAlign: 'center' }}>
            {Math.round((timeline.pixelsPerSecond / 60) * 100)}%
          </span>
        </div>
        )}
      </div>

      {/* ===== 全局固定标尺 (Plan#82 T2 步进隐藏 + 2026-09-08 全局唯一播放头) =====
          2026-11-05 固定宽度片段卡片（约定）：导演台（zeroBaseRail）刻度尺整项删除，
          播放头随刻度尺一并删除（卡片按序号铺排，无时间↔像素映射）；出片页原样保留 */}
      {!zeroBaseRail && (
      <div ref={rulerScrollRef} data-rail-ruler style={{ flexShrink: 0, overflow: 'hidden' }}>
        <GlobalRuler
          pps={timeline.pixelsPerSecond}
          totalDuration={totalDuration}
          renderedWidth={renderedWidth}
          formatTime={fmtTime}
          isDark={timeline.isDark}
          colors={C}
          playheadTime={timeline.playheadTime ?? 0}
          onPlayheadChange={timeline.onPlayheadTimeChange}
          contentPad={CONTENT_PAD}
        />
      </div>
      )}

      {/* ===== 可滚动轨道列表 ===== */}
      <div
        ref={scrollRef}
        data-rail-scroll
        className={zeroBaseRail ? 'zx-timeline-scroll zx-director-rail' : undefined}
        onPointerDownCapture={handleRailPointerDownCapture}
        onScroll={(e) => {
          // 2026-11-04 导演台：刻度尺与轨道同一滚动位置（内容等宽，scrollLeft 1:1 同步）
          const sl = e.currentTarget.scrollLeft;
          if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = sl;
        }}
        style={{
          flex: 1,
          position: 'relative',
          overflowY: 'auto',
          overflowX: zeroBaseRail ? 'auto' : 'hidden',
          minHeight: 0,
          padding: '2px 0',
        }}
      >
        {/* 全局播放头竖线（贯穿所有轨道，与 GlobalRuler 上的三角形把手联动 2026-09-08）
            2026-11-05 固定宽度片段卡片：导演台（zeroBaseRail）播放头随刻度尺一并删除 */}
        {!zeroBaseRail && timeline.onPlayheadTimeChange && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: CONTENT_PAD + (timeline.playheadTime ?? 0) * timeline.pixelsPerSecond - 0.5,
              width: 1,
              background: C.playhead,
              pointerEvents: 'none',
              zIndex: 4,
            }}
          />
        )}
        {visible.map((track) => {
          const entry = byTrack.get(track.id);
          const resolvedClips = entry?.timelineClips ?? [];
          const isFocused = focusedTrack?.id === track.id;
          const isActive = track.status === 'active';

          const trackTimelineProps = isActive ? timeline : readOnlyTimelineProps(timeline);
          // Plan#83 E：当前 track 是否被拖拽 hover
          const isDragHover = dragHover?.trackId === track.id;

          return (
            <div
              key={track.id}
              data-track-id={track.id}
              style={{
                display: 'flex',
                flexDirection: 'row',
                flexShrink: 0,
                height: railRowHeight,
                background: isActive ? C.bg : isDarkBg(track.status, timeline.isDark),
                // 2026-11-04 导演台：移除行首白色竖线（聚焦指示 borderLeft，C.playhead 深色主题下即白色）
                // ——连同 2px 透明占位一并去除，不留占位列；同时去掉 2px 行边距（片段起点 = 刻度 0）
                ...(zeroBaseRail
                  ? { borderLeft: 'none' as const, margin: '1px 0' }
                  : { borderLeft: isFocused ? `2px solid ${C.playhead}` : '2px solid transparent', margin: '1px 2px' }),
                opacity: isActive ? 1 : 0.72,
                boxSizing: 'border-box',
                borderRadius: 4,
                overflow: zeroBaseRail ? 'visible' : 'hidden',
                alignItems: 'stretch',
                position: 'relative',
                // Plan#83 E：拖拽 hover 高亮（accent 色外环）
                outline: isDragHover ? `2px solid ${timeline.theme.toolbar.accent}` : 'none',
                outlineOffset: -2,
                transition: 'outline 0.1s',
              }}
              onDragOver={(e) => handleTrackDragOver(e, track.id)}
              onDragLeave={(e) => handleTrackDragLeave(e, track.id)}
              onDrop={(e) => handleTrackDrop(e, track.id)}
            >
              {/* Plan#83 E：插入位指示线（hover 时在该 x 处画一条 2px 竖线） */}
              {isDragHover && dragHover && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: dragHover.insertX - 1,
                    width: 2,
                    background: timeline.theme.toolbar.accent,
                    pointerEvents: 'none',
                    zIndex: 10,
                  }}
                />
              )}
              {/* 2026-11-04 拖拽（drag-spec.md#4/#6）：预览重排（幽灵跟手 + 实时让位 + 整段占位框）
                  由 StoryboardTimeline 的 externalClipPreview 承担；旧的 [data-drop-line] 2px 插入线
                  与 [data-drag-placeholder] 覆盖层已移除，不再保留两套提示。 */}
              {/* 2026-11-04 出片页布局纠正：轨道头（名称/状态徽章/时长/重排序拖拽）整体下线，轨道内容从最左侧直接起铺 */}


              {/* 轨道内容区: 只显示 clips (无 toolbar/ruler) */}
              <div
                onClick={(e) => {
                  // Plan#83 C 兜底：track-area 上点击 StoryboardTimeline 内部已处理过（handleTrackClick），
                  // 此处再补一层：万一内层事件被吞（empty hint 覆盖 / pointer-events 拦截），这里兜底
                  // 把播放头移到点击点。命中 clip 时不动播放头。
                  if (e.target instanceof Element && e.target.closest('[data-clip-id]')) return;
                  if (!timeline.onPlayheadTimeChange) return;
                  const wrapperRect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  // Plan#83 bug5：轨道空白点击 → 播放头精确落到点击位置（减 CONTENT_PAD，与刻度对齐）
                  const x = e.clientX - wrapperRect.left - CONTENT_PAD;
                  const time = Math.max(0, x / timeline.pixelsPerSecond);
                  timeline.onPlayheadTimeChange(time);
                }}
                style={{
                  flex: 1,
                  position: 'relative',
                  minHeight: 0,
                  overflow: zeroBaseRail ? 'visible' : 'hidden',
                  alignSelf: 'stretch',
                }}
              >
                <StoryboardTimeline
                  {...trackTimelineProps}
                  theme={timeline.theme}
                  isDark={timeline.isDark}
                  t={timeline.t}
                  pixelsPerSecond={timeline.pixelsPerSecond}
                  onPixelsPerSecondChange={timeline.onPixelsPerSecondChange}
                  shots={isActive ? timeline.shots : resolvedClips}
                  activeShotId={isFocused ? timeline.activeShotId : undefined}
                  onSelectShot={isActive ? timeline.onSelectShot : () => onFocusTrack(track.id)}
                  onClipDoubleClick={isActive ? (timeline.onClipDoubleClick ?? (() => undefined)) : () => onFocusTrack(track.id)}
                  inline={true}
                  readonly={!isActive}
                  hideToolbar={true}
                  hideRuler={true}
                  hidePlayhead={true}
                  containerWidth={renderedWidth}
                  allowDragPropagation={true}
                  enableWheelScroll={true}
                  onClipDragStart={zeroBaseRail ? undefined : handleClipDragStart}
                  // 2026-11-04 拖拽：导演台拖拽由本组件 pointer 会话统一接管（内部鬼影不启动）
                  clipDragExternal={zeroBaseRail}
                  // 2026-11-04 拖拽 实时预览：幽灵跟手位移 + 预览落点（其余片段按预览顺序实时让位）
                  externalClipPreview={zeroBaseRail && railDragView?.trackId === track.id
                    ? { clipId: railDragView.clipId, insertIndex: railDragView.insertIndex, dragX: railDragView.dragX }
                    : null}
                  // Plan#83 bug1：出片工作台片段首尾相接铺满轨道，不留 2px 间隙
                  // 2026-11-05 固定宽度片段卡片：导演台改等宽卡片 + 卡片间隙（DIRECTOR_CARD_GAP）；
                  // 卡片宽随导轨容器降级（220/180/160），不随时长/缩放变化
                  clipGap={zeroBaseRail ? DIRECTOR_CARD_GAP : 0}
                  cardWidth={zeroBaseRail ? directorCardWidth : undefined}
                  cardHeight={zeroBaseRail ? railCardHeight : undefined}
                  onDirectorPlay={isActive ? onDirectorPlay : undefined}
                  // 2026-11-05 导演台：时长只来自参数（无 trim handle/ew-resize 热区）；上方无横向边线
                  trimEnabled={!zeroBaseRail}
                  noTopBorder={zeroBaseRail}
                  // 2026-11-04 导演台 H3：延续标记等附加层只进活动轨（候选轨只读不注入）
                  contentOverlay={isActive ? contentOverlay : undefined}
                  // 2026-11-04 导演台：片段文字单行版式仅活动轨生效（出片页等缺省不变）
                  clipLabelMode={isActive ? clipLabelMode : undefined}
                  // 2026-11-04 导演台导轨零基线：内容从 x=0 起铺 + 横向滚动交给外层 scroll 容器
                  contentInsetLeft={CONTENT_PAD}
                  outerScroll={zeroBaseRail}
                />
              </div>
            </div>
          );
        })}

        {/* 2026-11-04 出片页单轨化：「新建轨 drop 区域」下线（不再支持新增轨道；data.tracks 结构保留） */}
      </div>
    </div>
  );
});

function isDarkBg(status: WorkbenchTrack['status'], isDark: boolean): string {
  if (status === 'candidate') return isDark ? 'rgba(217,119,6,0.05)' : 'rgba(217,119,6,0.03)';
  return isDark ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.02)';
}