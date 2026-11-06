/**
 * StoryboardMergedTab - 分镜生产台四区容器（Plan#53 T4，2026-09-01 Plan#61 重构）
 *
 * OpenCut 风格布局（左栏可折叠侧边栏 + 主区分屏）：
 *   ┌─ 主体侧边栏 (可折叠) ──┆─── 主区 ───────────────────────────────┐
 *   │ [▶ 折叠]              │ │ 主视频 (16:9)                       ││
 *   │ [全类 ▼] [上传]       │ │                                   ││
 *   │ Tab: 参考/特效/角色/运镜 │ ├───────────────────────────────────┤│
 *   │                        │ │ 时间轴（单轨）                      ││
 *   │                        │ ├─ 提示词区（NodeGenerateDock 同款）───┤│
 *   └────────────────────────┴──┴────────────────────────────────────┘
 *
 * 2026-09-01 Plan#61 重构：移除备选视频区，消除「一镜多候选」语义。
 * 片态二分：placeholder（显示提示词输入器）/ completed（直接播放）。
 *
 * 数据源为只读 props（由 fullscreen-editor 接线），本组件管理纯 UI 状态
 * （侧边栏折叠、选中镜头、拖拽分隔线、时间轴缩放等），一切业务写入回调给上层。
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { StoryboardAssetPanel, type StoryboardAssetPanelProps } from './storyboard-asset-panel';
import { StoryboardVideoStage, type StoryboardVideoStageProps } from './storyboard-video-stage';
import { StoryboardTimeline, type StoryboardTimelineProps } from './storyboard-timeline';
import { WorkbenchMultiTrack, type WorkbenchMultiTrackProps } from './workbench-multitrack';
import { WorkbenchPromptDock, type WorkbenchPromptDockProps } from './workbench-prompt-dock';
import { DIRECTOR_RAIL_HEIGHT } from './timeline-constants';
import type { StoryboardEntity } from './storyboard-types';
// 2026-09-01 约定：生产台/报告/迭代三 Tab 移除，只留生产台本身
// （报告 Tab、迭代版本历史/Diff 相关 UI 与 props 全部下线）

// ===== 布局常量 =====
const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_FOLD_BTN_WIDTH = 24;
/**
 * 2026-11-04 出片页布局改造（覆写 2026-08-31 第六次迭代）：
 * 1. 主区改为左右并排——左列=提示词区(上)+片段轨道(下)，右列=视频预览（对齐用户参考截图）；
 * 2. 提示词区弹性填充左列剩余高度（WorkbenchPromptDock expandedHeight="100%"），不再固定 285px 贴底；
 * 3. 水平分割线拖拽调整的是**轨道区**高度（timelineHeight），提示词区随之弹性伸缩。
 */
/** 轨道默认高度（参考 AI Video Studio.html 的 .timeline height:215px） */
const TIMELINE_DEFAULT_HEIGHT = 215;
/** 导轨最小高度（保证标尺 + 单轨 clip 可读，组件内部固定骨架 ≈ 132px） */
const TIMELINE_MIN_HEIGHT = 140;
/** 导轨最大高度（防止把视频预览区挤没） */
const TIMELINE_MAX_HEIGHT = 360;
/**
 * 2026-11-04：上排「提示词区 | 视频预览」竖向分隔拖拽——提示词区宽度占比（相对主区上排宽）。
 * 默认 0.44，拖拽钳制 [0.25, 0.85] 且不小于 PROMPT_MIN_WIDTH px。
 * 2026-11-04 第七条：导演台经 promptRatioDefault 传 0.75（提示词:预览 = 3:1），本默认不动。
 */
const PROMPT_RATIO_DEFAULT = 0.44;
const PROMPT_RATIO_MIN = 0.25;
const PROMPT_RATIO_MAX = 0.85;
const PROMPT_MIN_WIDTH = 320;
/** 第七条A：预览区最小高 = max(120px, 25vh)（上排与提示词区等高；导轨拖拽不得把它压没） */
export const previewMinHeightPx = (): number => Math.max(120, Math.round((typeof window !== 'undefined' ? window.innerHeight : 768) * 0.25));

export interface StoryboardMergedTabProps {
  // 数据（只读，来自上层接线）
  entities: StoryboardEntity[];
  /**
   * 是否渲染左侧资产侧边栏（默认 true）
   * 出片工作台无"主体资产"语义 → 传 false，整条 sidebar（含拖拽分隔条）不渲染
   */
  showAssetSidebar?: boolean;
  // 子组件事件透传
  assetPanelProps?: Omit<StoryboardAssetPanelProps, 'theme' | 'isDark'>;
  videoStageProps?: Omit<StoryboardVideoStageProps, 'theme' | 'isDark'>;
  timelineProps?: Omit<StoryboardTimelineProps, 'theme' | 'isDark' | 't'>;
  /**
   * E3 多轨：提供时时间轴区改渲染 WorkbenchMultiTrack（tracks 主导），否则回落单轨 timelineProps。
   * timeline 交互回调用宿主 timelineProps 投喂。
   */
  multitrackProps?: Omit<WorkbenchMultiTrackProps, 'timeline'>;
  /**
   * 底部提示词栏（2026-08-31 重构）：不再复用画布节点 NodeGenerateDock。
   * 使用独立 WorkbenchPromptDock（数据视图分离，纯受控）。
   */
  promptDockProps?: Omit<WorkbenchPromptDockProps, 'shotId' | 'theme' | 'isDark'> & { shotId?: string };
  /**
   * 提示词区上方展示的引用主体胶囊（出片工作台：当前镜头 @提及 匹配主体库）。
   * 让用户一眼看到本镜关联了哪些主体。
   */
  promptSubjectChips?: Array<{ id: string; name: string; kind: string }>;
  /** 提示词区上方的附加操作按钮（出片工作台：跨镜衔接取帧等，2026-08-31 T3） */
  promptExtraActions?: Array<{ key: string; label: string; onClick: () => void }>;
  /** 2026-11-04：无可编辑提示词（如已完成镜头）时显示的只读提示词摘要，避免左列空壳 */
  promptReadonlyText?: string;
  /**
   * 2026-11-04 第七条A：上排提示词区初始宽度占比（不传 = PROMPT_RATIO_DEFAULT 0.44，默认行为不变）。
   * 导演台传 0.75（提示词:预览 = 3:1）。
   */
  promptRatioDefault?: number;
  /** 第七条A：用户拖拽后的比例持久化 key（localStorage；提供时下次进入沿用用户比例，未拖拽过用默认值） */
  promptRatioStorageKey?: string;
  /**
   * 导演台 H3 工作区：提供时替代内部 WorkbenchPromptDock 渲染（左列提示词区整体接管）。
   * 与 promptDockProps 互斥（override 优先）；不传 = 默认行为不变。
   */
  promptPanelOverride?: React.ReactNode;
  /**
   * 导演台 H3 工作区：渲染在轨道区正上方的附属条（延续关联条等），
   * 与轨道同一左对齐基准、同一 pixelsPerSecond 刻度（由宿主计算像素偏移）。
   */
  timelineAccessory?: React.ReactNode;
  /**
   * 2026-11-05 导演台参考图修订：导轨高度固定（由卡片高度 + 固定 padding 决定）。
   * true 时不渲染水平分割手柄、不接受高度拖拽；窗口变化只影响横向 220/180/160 档位。
   * 缺省 false = 出片页保留原有高度拖拽行为，零变化。
   */
  railHeightFixed?: boolean;
  /**
   * Plan#83 A 修正：顶部视频区是否为「纯预览模式」（出片全屏编辑器专用）。
   * true 时保留视频画面但去除所有 UI 控制条（播放/时间/进度/静音/全屏），
   * inline 节点预览不传 → 默认 false（保留完整控制条）。
   */
  videoPreviewOnly?: boolean;
  theme: any;
  isDark: boolean;
}

export const StoryboardMergedTab = memo(function StoryboardMergedTab({
  entities, showAssetSidebar = true, assetPanelProps, videoStageProps, timelineProps, multitrackProps, promptDockProps, promptSubjectChips, promptExtraActions, promptReadonlyText, promptPanelOverride, timelineAccessory, railHeightFixed = false, videoPreviewOnly, promptRatioDefault, promptRatioStorageKey, theme, isDark,
}: StoryboardMergedTabProps): ReactElement {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_EXPANDED_WIDTH);
  /** 导轨区高度，水平分割线拖拽调整（提示词区固定高度不参与缩放）；
   *  2026-11-05 导演台 railHeightFixed=true 时不用该 state，改由 DIRECTOR_RAIL_HEIGHT 固定 */
  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_DEFAULT_HEIGHT);
  /** 上排提示词区宽度占比（竖向分隔线拖拽调整，视频预览随之弹性伸缩）；
   *  第七条A：初始值 = 持久化用户比例（合法范围内）→ promptRatioDefault → 全局默认 */
  const [promptRatio, setPromptRatio] = useState(() => {
    const fallback = promptRatioDefault ?? PROMPT_RATIO_DEFAULT;
    if (!promptRatioStorageKey) return fallback;
    try {
      const raw = window.localStorage.getItem(promptRatioStorageKey);
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) && v >= PROMPT_RATIO_MIN && v <= PROMPT_RATIO_MAX ? v : fallback;
    } catch { return fallback; }
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  // OpenCut 暗色专业剪辑风配色（Plan#53 §2 布局契约）
  // 2026-08-31：全站统一画布背景色；次级表面用中性微亮 #151517（无棕）
  const OPENCUT_BG = isDark ? theme.canvas.background : '#fafaf7';
  const OPENCUT_CARD = isDark ? '#151517' : 'rgba(0,0,0,0.02)';
  const OPENCUT_ACCENT = '#3b82f6';
  const textMuted = theme.toolbar.textMuted;
  const panelBg = isDark ? OPENCUT_CARD : 'rgba(0,0,0,0.02)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const dividerHover = OPENCUT_ACCENT;

  // ===== 侧边栏折叠 =====
  const toggleSidebar = useCallback(() => {
    setSidebarAnimating(true);
    setSidebarCollapsed((prev) => !prev);
    setTimeout(() => setSidebarAnimating(false), 180);
  }, []);

  const currentSidebarWidth = useMemo(() => {
    if (sidebarCollapsed) return SIDEBAR_FOLD_BTN_WIDTH;
    return sidebarWidth;
  }, [sidebarCollapsed, sidebarWidth]);

  // ===== 分隔线拖拽 =====
  /* 侧边栏拖拽
   * ⚠️ 必须用 window + capture 阶段监听（2026-08-31 修复：分割条拖不动）
   * 本组件被 CanvasTabContentBoundary 包裹，边界在冒泡阶段调用
   * `e.stopPropagation()`（React 合成事件会透传到原生事件 nativeEvent.stopPropagation）。
   * React 18 把监听器挂在 root container 上，原生事件冒泡到 root 时即被掐断，
   * 挂在 document/window 上的**冒泡阶段**监听永远收不到 pointermove/pointerup
   * → 拖拽无响应且 isDraggingSidebar 卡死在 true。
   * capture 阶段监听在事件下行时（window 为最外层）就已执行，不受冒泡阻断影响。 */
  const startDragSidebar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsDraggingSidebar(true);
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const widthPx = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, ev.clientX - rect.left));
      setSidebarWidth(widthPx);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setIsDraggingSidebar(false);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [sidebarCollapsed]);

  /* 导轨区高度拖拽（2026-08-31 第六次约定：提示词区固定底部，分隔线只调导轨高度）
   * ⚠️ 必须用「起始高度 + 位移增量」+ window + capture（规避页签边界的冒泡阻断）。
   * 导轨 min/max 保证标尺可读且不把视频预览区挤没（提示词固定高度不参与缩放）。 */
  const startDragTimeline = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      // 分割线上移(clientY 减小) → 轨道变高
      const h = timelineHeight + (startY - ev.clientY);
      // 动态上限：轨道不得把提示词区/预览区挤没（左列弹性伸缩，第七条A：余量 ≥ max(260, 预览最小高 max(120,25vh))）
      const containerH = containerRef.current?.clientHeight ?? 0;
      const maxByContainer = containerH > 0 ? containerH - Math.max(260, previewMinHeightPx()) : TIMELINE_MAX_HEIGHT;
      const max = Math.min(TIMELINE_MAX_HEIGHT, maxByContainer);
      setTimelineHeight(Math.max(TIMELINE_MIN_HEIGHT, Math.min(max, h)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [timelineHeight]);

  /* 2026-11-04：上排「提示词区 | 视频预览」竖向分隔拖拽（提示词区宽度占比）。
   * 与 startDragTimeline 同款 window + capture 模式（规避页签边界冒泡阻断）。 */
  const topRowRef = useRef<HTMLDivElement>(null);
  const startDragPromptSplit = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const rect = topRowRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const ratio = (ev.clientX - rect.left) / rect.width;
      const clamped = Math.max(PROMPT_RATIO_MIN, Math.min(PROMPT_RATIO_MAX, ratio));
      // 最小像素宽兜底：窄屏下不让提示词区被压到不可读
      if (clamped * rect.width < PROMPT_MIN_WIDTH) return;
      setPromptRatio(clamped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      // 第七条A：拖拽结束把用户比例持久化（下次进入沿用；未拖拽过则保持默认）
      if (promptRatioStorageKey) {
        try {
          setPromptRatio((cur) => {
            window.localStorage.setItem(promptRatioStorageKey, String(cur));
            return cur;
          });
        } catch { /* localStorage 不可用时静默 */ }
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [promptRatioStorageKey]);

  // ===== 渲染 =====
  const sidebarTransition = sidebarAnimating || sidebarCollapsed ? `width 180ms ease, min-width 180ms ease, max-width 180ms ease` : 'none';

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        background: isDark ? OPENCUT_BG : '#fafaf7',
        overflow: 'hidden',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* 2026-09-01 约定：生产台/报告/迭代三 Tab 移除，只留生产台本身（整页即生产台） */}

      {/* ===== 左侧边栏 ===== */}
      {showAssetSidebar && (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: currentSidebarWidth,
          minWidth: sidebarCollapsed ? SIDEBAR_FOLD_BTN_WIDTH : SIDEBAR_MIN_WIDTH,
          maxWidth: sidebarCollapsed ? SIDEBAR_FOLD_BTN_WIDTH : SIDEBAR_MAX_WIDTH,
          height: '100%',
          overflow: 'hidden',
          transition: sidebarTransition,
          borderRight: `1px solid ${dividerColor}`,
          background: isDark ? OPENCUT_CARD : panelBg,
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {/* 折叠按钮 */}
        <div
          onClick={toggleSidebar}
          style={{
            position: 'absolute',
            top: 8,
            right: sidebarCollapsed ? 4 : -10,
            zIndex: 10,
            width: 20,
            height: 20,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: textMuted,
            background: isDark ? OPENCUT_CARD : '#fff',
            border: `1px solid ${dividerColor}`,
            transition: 'right 180ms ease',
          }}
          title={sidebarCollapsed ? t('storyboard.expandSidebar', '展开侧边栏') : t('storyboard.collapseSidebar', '折叠侧边栏')}
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </div>

        {!sidebarCollapsed && (
          <StoryboardAssetPanel
            entities={entities}
            selectedEntityId={selectedEntityId}
            onSelectEntity={setSelectedEntityId}
            theme={theme}
            isDark={isDark}
            {...assetPanelProps}
            collapsed={false}
          />
        )}

        {/* 折叠态简化提示 */}
        {sidebarCollapsed && (
          <div
            onClick={toggleSidebar}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: textMuted,
              fontSize: 10,
              writingMode: 'vertical-rl',
              letterSpacing: '0.15em',
              opacity: 0.5,
            }}
          >
            {t('storyboard.sidebar', '资产')}
          </div>
        )}
      </div>
      )}

      {/* 侧边栏分隔线 */}
      {showAssetSidebar && !sidebarCollapsed && (
        <div
          onPointerDown={startDragSidebar}
          style={{
            width: 4,
            cursor: 'col-resize',
            background: isDraggingSidebar ? dividerHover : 'transparent',
            borderRadius: 2,
            transition: 'background 0.1s',
            zIndex: 2,
            flexShrink: 0,
            margin: '0 -2px',
          }}
          title={t('storyboard.dragResize', '拖拽调整宽度')}
        />
      )}

      {/* ===== 主区（2026-11-04 出片页布局，推翻左右整列并排的旧布局）：
          上排=左提示词区+右视频预览（等高并排，预览不下探）；
          下排=片段轨道通栏（占满全宽，含左右列下方）。 ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: 0, gap: 0, overflow: 'hidden' }}>
{/* 上排：提示词区(左) + 竖向分隔线 + 视频预览(右)，等高并排，可拖拽伸缩；预览不下探到轨道区 */}
<div ref={topRowRef} data-wb="top-row" style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0, padding: '8px 8px 0 8px', overflow: 'hidden' }}>
{/* 左列：引用胶囊行 + 提示词区（宽度占比由竖向分隔线拖拽调整） */}
<div data-wb="prompt-area" style={{ width: `${promptRatio * 100}%`, minWidth: PROMPT_MIN_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
{/* 引用主体胶囊 + 附加操作（跨镜衔接取帧）：提示词区上方（2026-08-31 T3） */}
{((promptSubjectChips && promptSubjectChips.length > 0) || (promptExtraActions && promptExtraActions.length > 0)) && (
<div
style={{
display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
padding: '6px 4px', flexShrink: 0,
}}
>
{promptSubjectChips && promptSubjectChips.length > 0 && (
<>
<span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>
{t('storyboard.referencedSubjects', '引用主体')}
</span>
{promptSubjectChips.map((s) => (
<span
key={s.id}
title={t('storyboard.subjectKind', { kind: s.kind })}
style={{
display: 'inline-flex', alignItems: 'center', gap: 4,
padding: '1px 8px', borderRadius: 10, fontSize: 11,
background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
color: theme.toolbar.text, border: `1px solid ${dividerColor}`,
whiteSpace: 'nowrap',
}}
>
{s.name}
</span>
))}
</>
)}
{/* 跨镜衔接取帧等附加操作（右对齐） */}
{promptExtraActions && promptExtraActions.length > 0 && (
<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
{promptExtraActions.map((a) => (
<button
key={a.key}
type="button"
onClick={a.onClick}
style={{
fontSize: 10, color: theme.toolbar.accent, background: 'transparent',
border: 'none', cursor: 'pointer', padding: '1px 6px', borderRadius: 8,
whiteSpace: 'nowrap',
}}
>
{a.label}
</button>
))}
</div>
)}
</div>
)}

{/* 提示词区：弹性填充左列剩余高度（展开 100% / 折叠 34px 细条吸附底部）；
    已完成镜头无可编辑提示词时显示只读摘要，无提示词时显示占位文案（不留空壳，2026-11-04）。
    promptPanelOverride 提供时整体接管（导演台 H3 工作区），默认行为不变。 */}
{promptPanelOverride ? (
<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
{promptPanelOverride}
</div>
) : promptDockProps ? (
<div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
<WorkbenchPromptDock
// 2026-08-31 重构后 shotId 仅作调试/兜底 key；
// 数据全部受控（value/references/model/paramValues 由宿主传入），
// 切换镜头 → props 更新 → 本组件 100% 跟随刷新，不再依赖内部 state 初始化。
shotId={promptDockProps.shotId ?? 'dock'}
{...promptDockProps}
expandedHeight="100%"
/>
</div>
) : promptReadonlyText !== undefined ? (
<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, fontSize: 12, lineHeight: 1.6, color: theme.toolbar.text, whiteSpace: 'pre-wrap', background: panelBg, borderRadius: 8, border: `1px solid ${dividerColor}` }}>
<span style={{ fontSize: 10, color: textMuted, display: 'block', marginBottom: 4 }}>{t('storyboard.promptReadonly', '提示词（已生成，只读）')}</span>
{promptReadonlyText.trim() ? promptReadonlyText : (
<span data-wb="prompt-empty" style={{ color: textMuted }}>{t('workbench.promptEmpty', '无提示词')}</span>
)}
</div>
) : null}
</div>

{/* 竖向分隔线：拖拽调整「提示词区 : 视频预览」宽度比（2026-11-04） */}
<div
onPointerDown={startDragPromptSplit}
data-wb="prompt-split"
style={{
width: 8,
cursor: 'col-resize',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
color: textMuted,
flexShrink: 0,
}}
title={t('storyboard.dragResize', '拖拽调整宽度')}
>
<div style={{ width: 2, height: 40, background: dividerColor, borderRadius: 1 }} />
</div>

{/* 右列：视频预览（与提示词区等高，不向下延伸到轨道区；videoPreviewOnly 透传隐藏控制条） */}
<div data-wb="video-preview" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
<StoryboardVideoStage theme={theme} isDark={isDark} hideControls={!!videoPreviewOnly} {...videoStageProps} />
</div>
</div>

{/* 水平分隔线（通栏，拖拽调整「轨道区」高度；上排弹性伸缩）；
    2026-11-05 导演台 railHeightFixed=true：导轨高度固定，不提供任何高度拖拽入口 */}
{!railHeightFixed && (
<div
data-wb="rail-resize"
onPointerDown={startDragTimeline}
style={{
display: 'flex',
alignItems: 'center',
gap: 6,
height: 8,
cursor: 'row-resize',
color: textMuted,
padding: '0 8px',
flexShrink: 0,
}}
title={t('storyboard.dragResize', '拖拽调整轨道高度')}
>
<div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
<ChevronsUpDown size={10} />
<div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
</div>
)}

{/* 轨道附属条（导演台 H3：延续关联条等；与轨道同一左对齐基准、同一 pps 刻度） */}
{timelineAccessory}
{/* 下排：片段轨道通栏（占满全宽，独立于上排一行）；导演台固定高度 = 卡片高度 + 固定 padding */}
<div data-wb="track-area" style={{ height: railHeightFixed ? DIRECTOR_RAIL_HEIGHT : timelineHeight, flexShrink: 0, overflow: 'hidden', minHeight: 0, padding: '0 8px 8px' }}>
{multitrackProps ? (
<>
{/* 2026-11-04 根因修复：此前逐项列 props 导致 contentOverlay/selectMode/continuityEntry/
    clipLabelMode 在真实渲染链被静默丢弃（用户实测绿箭头 0 个）。改为整体展开，
    宿主传什么就透传什么；未传的可选 props = undefined，multitrack 默认行为不变。 */}
<WorkbenchMultiTrack
{...multitrackProps}
timeline={{
theme,
isDark,
t,
shots: timelineProps?.shots ?? [],
pixelsPerSecond: timelineProps?.pixelsPerSecond ?? 40,
onPixelsPerSecondChange: timelineProps?.onPixelsPerSecondChange ?? (() => {}),
onSelectShot: timelineProps?.onSelectShot ?? (() => {}),
...timelineProps,
}}
/>
</>
) : (
<StoryboardTimeline
theme={theme}
isDark={isDark}
t={t}
{...timelineProps}
shots={timelineProps?.shots ?? []}
pixelsPerSecond={timelineProps?.pixelsPerSecond ?? 40}
onPixelsPerSecondChange={timelineProps?.onPixelsPerSecondChange ?? (() => {})}
onSelectShot={timelineProps?.onSelectShot ?? (() => {})}
/>
)}
</div>
      </div>

    </div>
  );
});
