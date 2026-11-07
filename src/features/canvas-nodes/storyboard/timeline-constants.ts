/**
 * timeline-constants.ts - 分镜时间轴常量 + 类型定义 + 工具函数
 *
 * 从 storyboard-timeline.tsx 提取，职责单一：
 * 常量定义、TimelineClipData/StoryboardTimelineProps 接口、状态配色函数。
 */

// ===== 常量（对齐 workbench-track 视觉层 + freecut-main MINI 几何） =====

export const TRACK_HEIGHT = 58;
export const RULER_HEIGHT = 24;
export const CLIP_GAP = 2;
export const TRIM_HANDLE_WIDTH = 8;
export const CLIP_MIN_WIDTH = 10;
export const CLIP_BORDER_RADIUS = 4;
export const RULER_PADDING_LEFT = 14;
export const DEFAULT_MIN_CLIP_DURATION = 0.5;
export const DEFAULT_MAX_CLIP_DURATION = 30;
export const FRAME_STEP_SEC = 1 / 30;
export const MIN_PIXELS_PER_SECOND = 4;
export const MAX_PIXELS_PER_SECOND = 240;
export const FRAME_FPS = 30;
/**
 * 2026-11-05 导演台导轨「固定宽度片段卡片」（约定；220px 基准修订版）：
 * 导轨不再按时长×pps 铺宽度，改为等宽卡片 + 间隙；刻度尺/播放头随之删除。
 * 卡片宽度按导轨容器宽度降级（容器测量不可用时用基准 220）：
 * ≥720px → 220；480–719px → 180；<480px → 160。仅导演台路径（zeroBaseRail）使用；
 * 出片页零变化（不传 cardWidth 时仍按时长×pps 铺排）。
 */
export const DIRECTOR_CARD_WIDTH_BASE = 220;
export const DIRECTOR_CARD_WIDTH_MID = 180;
export const DIRECTOR_CARD_WIDTH_MIN = 160;
export const DIRECTOR_CARD_GAP = 6;
/**
 * 2026-11-05 参考图修订：导演台卡片 = 上缩略框 + 下标签行。
 * 缩略框高度 = 卡片宽 × 0.62（220→136 / 180→112 / 160→99），标签行固定 20px，
 * 卡片内边距 6px；高度只随宽度档位变化，不提供任何用户拖拽调整入口。
 */
export const DIRECTOR_CARD_ASPECT = 0.62;
export const DIRECTOR_CARD_LABEL_HEIGHT = 20;
export const DIRECTOR_CARD_PADDING = 6;
export const TRACK_CLIP_TOP = 7;

/** 卡片高度 = round(宽度×0.62) + 标签行 20 + 上下内边距 12 */
export function directorCardHeight(width: number): number {
  return Math.round(width * DIRECTOR_CARD_ASPECT) + DIRECTOR_CARD_LABEL_HEIGHT + DIRECTOR_CARD_PADDING * 2;
}

/**
 * 导轨总高度（导演台）固定值：基准档 220 的卡片高度 + 轨道行上下余量 16
 * + 工具栏 34 + 滚动区上下 padding 4 + 轨道区底部 padding 8。
 * 不随窗口宽度档位/用户拖拽变化，窗口变化只影响横向 220/180/160。
 */
export const DIRECTOR_RAIL_HEIGHT =
  34 + 4 + (directorCardHeight(DIRECTOR_CARD_WIDTH_BASE) + 16) + 8;

/** 容器宽度 → 卡片宽度；0/负值 = 测量不可用（jsdom、首帧）→ 基准 220 */
export function pickDirectorCardWidth(containerWidth: number): number {
  if (containerWidth >= 720) return DIRECTOR_CARD_WIDTH_BASE;
  if (containerWidth >= 480) return DIRECTOR_CARD_WIDTH_MID;
  if (containerWidth > 0) return DIRECTOR_CARD_WIDTH_MIN;
  return DIRECTOR_CARD_WIDTH_BASE;
}

export interface TimelineClipData {
  id: string;
  number: number;
  duration: number;
  /**
   * 2026-11-05 卡片六态徽标：queued/cancelled 由运行态派生（排队 = 提交/在队/未轮到；
   * 已取消 = 运行取消且未完成），仅导演台路径产生；出片页仍只有 idle/generating/done/failed。
   */
  status?: 'idle' | 'queued' | 'generating' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  thumbnailUrl?: string;
  videoKey?: string;
  trimStart?: number;
  trimEnd?: number;
  sourceDuration?: number;
  label?: string;
  hasAudio?: boolean;
  quality?: { score: number; deductions?: Array<{ item: number; reason: string }>; checkedAt: string };
  /** §8.5 待修改标记（随 WorkbenchShot.rework 透传，时间轴 clip 橙描边+角标） */
  rework?: { status: 'flagged' | 'reworking' | 'done'; reason?: string };
}

export interface StoryboardTimelineProps {
  shots: TimelineClipData[];
  activeShotId?: string | null;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pps: number) => void;
  onSelectShot?: (shotId: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onTrim?: (shotId: string, newDuration: number, side: 'left' | 'right') => void;
  minClipDuration?: number;
  maxClipDuration?: number;
  playheadTime?: number;
  onPlayheadTimeChange?: (time: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** 播放模式（多轨全局工具栏读取，StoryboardTimeline 内部也有同名 state，外部传入时覆盖内部） */
  playbackMode?: 'all' | 'clip' | null;
  onPlaybackModeChange?: (mode: 'all' | 'clip' | null) => void;
  playbackCommand?: { seq: number; action: 'play-all' | 'play-clip' | 'stop'; restart?: boolean } | null;
  onClipDoubleClick?: (shotId: string) => void;
  /**
   * 插入片段。
   * @param afterShotId 兼容语义：插到该片段之后；传 null 且无 insert.index 时插到**末尾**。
   * @param insert.index 精确插入下标（0..shots.length；length=末尾），由时间轴占位框落点给出（2026-09-02
   *                     约定：占位框位置即插入位置），提供时**优先于** afterShotId。
   */
  onInsertAt?: (afterShotId: string | null, insert?: { title?: string; durationSec?: number; storageKey?: string; coverUrl?: string; sourceDuration?: number; index?: number }) => void;
  onDeleteShot?: (shotId: string) => void;
  /** 2026-09-02 批量删除（框选/Ctrl+A 多选后 Delete），宿主一次确认 + 素材归池 */
  onDeleteShots?: (shotIds: string[]) => void;
  /** 2026-09-02 导出：右键单片段「导出到我的素材」 */
  onExportShot?: (shotId: string) => void;
  /** 2026-09-02 导出：顶部「导出 ▾」→ 导出全部（host 拼接成单视频并入库） */
  onExportAll?: () => void;
  /** 2026-09-02 导出：顶部「导出 ▾」→ 导出选定（shotIds=active+多选，host 拼接成单视频并入库） */
  onExportSelected?: (shotIds: string[]) => void;
  /** 是否存在可导出的片段（决定导出菜单可用态；host 按真实 resources/ key 判定） */
  canExport?: boolean;
  onSplitShot?: (shotId: string) => void;
  onMergeShots?: (shotId1: string, shotId2: string) => void;
  /** Plan#71 T11：批量生成全部占位片段（确认弹窗 → 逐条跑 mock/真实 → 汇总）。缺省不渲染。 */
  onBatchGenerateAll?: () => void;
  /** Plan#71 T11：批量生成选中片段（ids=active+多选，仅占位片生效）。缺省不渲染。 */
  onBatchGenerateSelected?: (shotIds: string[]) => void;
  /** 是否存在可批量生成的占位片段（决定批量生成菜单可用态；host 按 clipState=placeholder 判定） */
  canBatchGenerate?: boolean;
  extraToolbarButtons?: Array<{ key: string; label: string; onClick: () => void; danger?: boolean }>;
  moreMenuItems?: Array<{ key: string; label: string; onClick: () => void; disabled?: boolean }>;
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: any;
  isDark: boolean;
  /**
   * Q4：内联模式（出片节点 body 渲染）。开启后隐藏顶部批量/导出等高级按钮，
   * 仅展示基础时间轴 + 片段缩略图 + 播放头；点击片段仍可选中并唤起 dock 编辑。
   */
  inline?: boolean;
  /** inline 模式且 shots 为空时的占位提示文案 */
  inlineEmptyHint?: string;
  /**
   * Q4：只读模式（出片节点 body 渲染时自动只读）。开启后 toolbar 完全隐藏，
   * clip 所有编辑回调（select/reorder/trim/delete/split/merge/export/batch）禁用；
   * 播放头/标尺/缩略图仍渲染，作为视觉预览。
   */
  readonly?: boolean;
  /** Plan#82: 多轨模式下隐藏顶部工具栏（由全局工具栏接管） */
  hideToolbar?: boolean;
  /** Plan#82: 多轨模式下隐藏标尺（由全局标尺接管） */
  hideRuler?: boolean;
  /** 多轨模式下隐藏播放头（仅聚焦轨渲染，避免 N 条轨 N 根播放头） */
  hidePlayhead?: boolean;
  /** Plan#82: 多轨模式下容器宽度（px），用于计算 clips 渲染宽度 */
  containerWidth?: number;
  /** Plan#82 T4: 多轨模式下允许拖拽事件冒泡（跨轨拖拽时使用），不阻止 onDragOver/onDrop 传播 */
  allowDragPropagation?: boolean;
  /** Plan#82 T4: 片段跨轨拖拽开始回调 (clipId, e) */
  onClipDragStart?: (e: React.DragEvent<HTMLDivElement>, clipId: string) => void;
  /**
   * Plan#83 D：是否允许滚轮事件在内部 scrollRef 生效（Ctrl+滚轮缩放 / 普通滚轮水平滚动）。
   * 默认 false（即 inline 模式默认阻止轮子传播给画布，避免画布误缩放）。
   * 全屏出片编辑器必须传 true，否则滚轮快捷键失效。
   */
  enableWheelScroll?: boolean;
  /**
   * Plan#83: 片段间横向间隙（px），默认 CLIP_GAP=2。
   * 出片工作台多轨模式传 0 → 片段首尾相接铺满轨道不留白（验收：出片轨道不允许留白）。
   */
  clipGap?: number;
  /**
   * 2026-11-04 导演台 H3：片段内容层附加层（可选）。渲染在 clips 之后的同一
   * 滚动/transform 容器内（坐标零点 = 0s），宿主用 `left = startTime * pps` 绝对
   * 定位即可与片段同步缩放/滚动/重排——用于延续标记画在片段接缝上。
   */
  contentOverlay?: React.ReactNode;
  /**
   * 2026-11-04 导演台：片段文字版式。'director' = 单行「镜头号 N · Xs」（照线上版图2）；
   * 缺省 = 原有 #号/状态文本/质量徽章（出片页等路径零变化）。
   */
  clipLabelMode?: 'director';
  /* 2026-11-04 第八条B：clipChecks（片段内勾选框）已整块移除——勾选改到轨道上方表格 */
  /**
   * 2026-11-04 导演台导轨零基线：内容区左内边距（px），默认 RULER_PADDING_LEFT=14。
   * 导演台传 0 → 片段起点 = 时间线 0 = 刻度 0（同一 x 坐标，无占位列）。
   */
  contentInsetLeft?: number;
  /**
   * 2026-11-04 导演台导轨：横向滚动交给外层容器（多轨 scroll 容器统一管理，
   * 刻度尺由宿主 onScroll 同步）。true 时本组件 body overflowX=visible 且不接管滚轮。
   * 缺省 false = 出片页等路径零变化（body 自行滚动）。
   */
  outerScroll?: boolean;
  /**
   * 2026-11-04 拖拽重做（project-rules/specs/director-h3-workspace/drag-spec.md）：
   * true = 拖拽由宿主（multitrack）统一接管，本组件 pointerdown 只记录起点
   * （供 pointerup 点击选中判定），不启动内部鬼影/推挤/提交。
   * 缺省 false = 出片页等路径零变化。
   */
  clipDragExternal?: boolean;
  /**
   * 2026-11-04 拖拽实时预览（drag-spec.md，仅 clipDragExternal 路径使用）：
   * 宿主驱动的外部拖拽预览态 —— clipId=被拖片段；insertIndex=预览落点（computeInsertIndex
   * 语义，含自身数组的插入前下标）；dragX=幽灵跟手位移 px（content 坐标系，含滚动补偿）。
   * 非 null 时：被拖片段渲染为浮层幽灵（translateX+scale+半透明），其余片段按预览顺序
   * 让位（占位框+pushX），占位框位置 = 松手后落位。缺省 null = 出片页零变化。
   */
  externalClipPreview?: { clipId: string; insertIndex: number; dragX: number } | null;
  /**
   * 2026-11-05 导演台导轨「固定宽度片段卡片」：设定后 clip 宽度恒为该值（不再
   * duration×pps），left 按卡片序号等距铺排。仅导演台路径传；缺省 = 出片页零变化。
   */
  cardWidth?: number;
  /**
   * 2026-11-05 导演台卡片高度（上缩略框 + 下标签行）。缺省 = TRACK_HEIGHT（出片页零变化）。
   * 由宿主按 `directorCardHeight(cardWidth)` 计算后传入，保证导轨行高与覆盖层几何同源。
   */
  cardHeight?: number;
  /**
   * 2026-11-05 导演台缩略框中央播放键：点击 = 打开右侧预览并切到该段。
   * 缺省不渲染播放键交互（出片页零变化）。
   */
  onDirectorPlay?: (shotId: string) => void;
  /**
   * 2026-11-05 导演台：关闭片段时长拖拽（trim handle / ew-resize 热区 / onTrim 写回）。
   * 时长只来自参数，标签行只读展示；缺省 true = 出片页原行为不变。
   */
  trimEnabled?: boolean;
  /** 2026-11-05 导演台：去掉内层时间轴容器顶部横向边线；缺省 false = 其它页面不变 */
  noTopBorder?: boolean;
}

/** 简易 scrub 节流（freecut-mini scrub 引擎的轻量本地版） */
export function createScrubThrottleState() {
  return { lastCommitMs: 0, lastFrame: -1 };
}

export function shouldCommitScrubFrame(state: { lastCommitMs: number; lastFrame: number }, nowMs: number, targetFrame: number): boolean {
  const minInterval = 16;
  if (nowMs - state.lastCommitMs < minInterval && targetFrame === state.lastFrame) return false;
  state.lastCommitMs = nowMs;
  state.lastFrame = targetFrame;
  return true;
}

// ===== 状态配色（workbench-track 视觉层） =====

export function statusColor(status: TimelineClipData['status'], isDark: boolean): string {
  switch (status) {
    case 'done': return isDark ? '#22c55e' : '#16a34a';
    case 'generating': return isDark ? '#60a5fa' : '#3b82f6';
    case 'failed': return isDark ? '#ef4444' : '#dc2626';
    // 2026-11-05 六态徽标新增配色（仅导演台卡片出现，出片页不可达）
    case 'queued': return isDark ? '#fbbf24' : '#d97706';
    case 'cancelled': return isDark ? '#94a3b8' : '#64748b';
    // 2026-11-05 自愈降级态：上次异常退出残留的 generating → 已中断（与已取消同灰）
    case 'interrupted': return isDark ? '#94a3b8' : '#64748b';
    default: return isDark ? '#a3a3a3' : '#78716c';
  }
}

export function statusBgColor(status: TimelineClipData['status'], isDark: boolean): string {
  switch (status) {
    case 'done': return isDark ? 'rgba(34,197,94,0.16)' : 'rgba(22,163,74,0.10)';
    case 'generating': return isDark ? 'rgba(96,165,250,0.16)' : 'rgba(59,130,246,0.10)';
    case 'failed': return isDark ? 'rgba(239,68,68,0.16)' : 'rgba(220,38,38,0.10)';
    case 'queued': return isDark ? 'rgba(251,191,36,0.14)' : 'rgba(217,119,6,0.10)';
    case 'cancelled': return isDark ? 'rgba(148,163,184,0.14)' : 'rgba(100,116,139,0.10)';
    case 'interrupted': return isDark ? 'rgba(148,163,184,0.14)' : 'rgba(100,116,139,0.10)';
    default: return isDark ? 'rgba(163,163,163,0.12)' : 'rgba(120,113,108,0.08)';
  }
}

/**
 * 2026-11-05 导演台导轨卡片视觉 token（浅/深两套同源）。
 * 所有取值集中在此，TimelineClip / 衔接箭头 / 徽标只消费 token，禁止在组件里
 * 写只对暗色成立的硬编码色值。
 * 2026-11-05 用户指令（选中态去绿色）：选中描边/阴影改中性亮色（深色=中性冷白 226,232,240；
 * 浅色=中性暖灰 68,64,60，与 empty-canvas-guide 同一中性口径）。
 * 绿色 #00c758 仅保留给「段间衔接」语义标记（箭头），不再用于任何选中态。
 */
export interface DirectorRailTone {
  /** 卡片底色（中性渐变，两主题可读） */
  cardSurface: string;
  cardBorder: string;
  cardHoverBorder: string;
  selectedBorder: string;
  selectedOutline: string;
  selectedShadow: string;
  hoverShadow: string;
  text: string;
  /** 缩略框无产物时的中性渐变 + 图标/三角色 */
  thumbSurface: string;
  thumbIcon: string;
  /** 半透明圆形播放键 */
  playBg: string;
  playIcon: string;
  /** 右下角时长角标 */
  durationBg: string;
  durationText: string;
  /** 未选中压暗 / hover 回亮 / 选中全亮 */
  opacityRest: number;
  opacityHover: number;
}

export function directorRailTone(isDark: boolean): DirectorRailTone {
  return isDark
    ? {
        // 2026-11-07 用户指令（原话）：跟画布导轨同底色、只留细描边。
        // 卡片不填色（transparent = 导轨底色），只靠 1px 中性描边区分；不压暗、不渐变、不自造色。
        cardSurface: 'transparent',
        cardBorder: 'rgba(255,255,255,0.14)',
        cardHoverBorder: 'rgba(255,255,255,0.26)',
        selectedBorder: 'rgba(245,245,244,0.70)',
        selectedOutline: 'rgba(245,245,244,0.90)',
        selectedShadow: '0 0 0 1px rgba(245,245,244,0.16), 0 2px 8px rgba(0,0,0,0.45)',
        hoverShadow: '0 2px 8px rgba(0,0,0,0.35)',
        text: '#f5f5f4',
        thumbSurface: 'rgba(255,255,255,0.04)',
        thumbIcon: '#a8a29e',
        playBg: 'rgba(0,0,0,0.55)',
        playIcon: '#ffffff',
        durationBg: 'rgba(0,0,0,0.62)',
        durationText: '#ffffff',
        opacityRest: 1,
        opacityHover: 1,
      }
    : {
        cardSurface: 'transparent',
        cardBorder: 'rgba(0,0,0,0.12)',
        cardHoverBorder: 'rgba(0,0,0,0.22)',
        selectedBorder: 'rgba(68,64,60,0.55)',
        selectedOutline: 'rgba(68,64,60,0.85)',
        selectedShadow: '0 0 0 1px rgba(68,64,60,0.14), 2px 4px 10px rgba(15,23,42,0.10)',
        hoverShadow: '0 1px 2px rgba(15,23,42,0.06), 0 4px 10px rgba(15,23,42,0.08)',
        text: '#1c1917',
        thumbSurface: 'rgba(0,0,0,0.03)',
        thumbIcon: '#78716c',
        playBg: 'rgba(17,24,39,0.55)',
        playIcon: '#ffffff',
        durationBg: 'rgba(17,24,39,0.62)',
        durationText: '#ffffff',
        opacityRest: 1,
        opacityHover: 1,
      };
}

/** 六态徽标：半透明底 + 细描边 + 状态色点；文字色保证 ≥4.5:1（对卡片/缩略框底） */
export interface DirectorBadgeTone {
  text: string;
  dot: string;
  bg: string;
  border: string;
  dashed?: boolean;
  pulse?: boolean;
}

export function directorBadgeTone(
  status: TimelineClipData['status'],
  isDark: boolean,
): DirectorBadgeTone {
  if (isDark) {
    switch (status) {
      case 'queued': return { text: '#93c5fd', dot: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)' };
      case 'generating': return { text: '#86efac', dot: '#22c55e', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.40)', pulse: true };
      case 'done': return { text: '#86efac', dot: '#22c55e', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.35)' };
      case 'failed': return { text: '#fca5a5', dot: '#ef4444', bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.35)' };
      case 'cancelled':
      case 'interrupted':
        return { text: '#cbd5e1', dot: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.40)', dashed: true };
      default: return { text: '#c7c7c7', dot: '#8a8a8a', bg: 'rgba(255,255,255,0.06)', border: '#333333' };
    }
  }
  switch (status) {
    case 'queued': return { text: '#1d4ed8', dot: '#3b82f6', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.35)' };
    case 'generating': return { text: '#047857', dot: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.40)', pulse: true };
    case 'done': return { text: '#15803d', dot: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' };
    case 'failed': return { text: '#b91c1c', dot: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)' };
    case 'cancelled':
    case 'interrupted':
      return { text: '#57534e', dot: '#a8a29e', bg: 'rgba(120,113,108,0.08)', border: 'rgba(120,113,108,0.40)', dashed: true };
    default: return { text: '#44403c', dot: '#78716c', bg: 'rgba(120,113,108,0.10)', border: 'rgba(120,113,108,0.30)' };
  }
}

/** 段间衔接箭头占位：34×22 恒定，不随 220/180/160 档位变化（位置公式见 rail-visual-spec §5） */
export const DIRECTOR_ARROW_SIZE = { width: 34, height: 22 } as const;
/** 单向 glyph 尺寸（占位内居中，2.2:1 比例沿用原造型） */
export const DIRECTOR_ARROW_GLYPH = { width: 22, height: 10 } as const;

/**
 * 段间衔接箭头 token（2026-11-06 用户指令：箭头要「像这个项目该有的 UI」）。
 * 旧口径「无底色/无描边/无圆角」已作废；改为项目同款深色胶囊：半透明底 + 1px 细描边 +
 * 圆角 5 + 柔和阴影，hover 边框转绿并带外发光。
 * 绿色 glyph 保留（征集 #176 状态色契约：绿色只用于段间衔接语义），34×22 几何与
 * hover/静息 opacity 不变——胶囊只承载造型，不改变命中区与布局。
 */
export interface DirectorArrowTone {
  glyph: string;
  opacityRest: number;
  surface: string;
  border: string;
  hoverBorder: string;
  shadow: string;
  hoverShadow: string;
}

export function directorArrowTone(isDark: boolean): DirectorArrowTone {
  return isDark
    ? {
        glyph: '#00c758',
        opacityRest: 0.86,
        // 与 @ 素材面板同款中性深灰胶囊（不再用偏蓝/偏棕自造色）
        surface: 'rgba(32,32,32,0.94)',
        border: '#333333',
        hoverBorder: 'rgba(0,199,88,0.50)',
        shadow: '0 2px 8px rgba(0,0,0,0.45)',
        hoverShadow: '0 0 0 1px rgba(0,199,88,0.18), 0 4px 14px rgba(0,0,0,0.55)',
      }
    : {
        glyph: '#0a8a43',
        opacityRest: 0.62,
        surface: 'rgba(255,255,255,0.94)',
        border: 'rgba(0,0,0,0.10)',
        hoverBorder: 'rgba(10,138,67,0.45)',
        shadow: '0 1px 3px rgba(15,23,42,0.10)',
        hoverShadow: '0 0 0 1px rgba(10,138,67,0.14), 0 3px 10px rgba(15,23,42,0.14)',
      };
}

/**
 * 轨道外壳主题配色（2026-08-31 二次适配：底色统一用画布背景主题色，
 * 分隔线/标尺线用中性 rgba 分割线——此前写死 #151617/#242629/#25272a 偏棕且不随主题）。
 *
 * Plan#83 H：muted / empty 提亮，保证二级文字在深浅主题下均能 ≥0.75 亮度对比
 *   - Dark bg #11110f 亮度≈0.067：muted/empty 亮度需 ≥ 0.82
 *   - Light bg #ffffff 亮度=1.0：muted/empty 亮度需 ≤ 0.25
 */
export function timelinePalette(isDark: boolean, canvasBg: string | undefined) {
  const divider = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  return isDark
    ? {
        bg: canvasBg ?? '#11110f',
        border: divider,
        text: '#e6e7e9',
        muted: '#cfd0d2',
        rulerLine: divider,
        empty: '#bdc0c3',
        playhead: '#f2f3f4',
        clipSelected: '#f1f2f3',
        clipText: '#ffffff',
        trimHandle: 'rgba(241,242,243,0.9)',
      }
    : {
        bg: '#ffffff',
        border: 'rgba(0,0,0,0.10)',
        text: '#1c1917',
        muted: '#292524',
        rulerLine: 'rgba(0,0,0,0.12)',
        empty: '#3d3835',
        playhead: '#18181b',
        clipSelected: '#18181b',
        clipText: '#1c1917',
        trimHandle: 'rgba(24,24,27,0.85)',
      };
}