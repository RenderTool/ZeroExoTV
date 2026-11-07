import { memo, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react';
// 铁律：图标一律 lucide + 模块级 icons.ts Map，禁止 emoji 字符（2026-08-31）
import { CANVAS_NODE_ICONS } from '../icons.js';
import { useHydratedContent, AISkeleton } from '@zeroexo/plugin-nodes';

/**
 * StoryboardVideoStage - 中区 16:9 视频舞台（Plan#53 T6）
 *
 * 主视频预览 + 状态覆盖层（生成中/失败/空位）。
 * 2026-08-31 重大修复/重构：
 * 1. 解析链修复：工作台视频 storageKey 是本地持久化键（video:xxx）或后端键（resources/xxx），
 *    不是可 fetch 的 URL —— 此前走 AuthorizedVideo(裸 fetch) 解析失败 → 播放器永远空白。
 *    现改走 useHydratedContent（与备选卡片同一条解析链，localforage/后端认证全覆盖）。
 * 2. 约定：不再使用浏览器原生播放器 —— 自研 OpenCut 风控制条
 *    （播放/暂停、时间码、进度条可点可拖、静音、全屏），点击画面切换播放。
 * 3. 播放同步：isPlaying=true 时按 playbackOffsetSec seek 后播放（时间轴整轨/片段播放驱动）；
 *    autoPlayKey 变化时从 0 播放（点击备选视频卡片 → 中央区立即播放对应视频）。
 *
 * 2026-09-02 征集 #134 —— 序列播放契约：
 * 4. playbackMode='all' 时控制条显示「整轨时间码」（总时长 = 全部片段之和），拖动进度条 = 拖拽整轨播放头；
 *    'clip'/未播放时仍显示当前片段视频自身时间码。主时钟始终由时间轴持有（rAF），
 *    本组件只负责按 playbackOffsetSec 在「片段切换 / seek」时校正一次（不做逐帧回拉，防抽搐）。
 * 5. 占位片段（未生成、无媒体）→ 黑幕占位卡 + 提示词显示，使整轨预览能完整走完（剪辑软件质感）。
 * 6. 全屏对象改为舞台根节点（保证黑幕卡/提示词/控制条在全屏下可见），
 *    全屏按钮改为下拉两项：「全屏播放全部」「全屏播放本片段」。
 */
export interface StoryboardVideoStageProps {
  videoStorageKey?: string;
  videoStatus?: 'idle' | 'pending' | 'generating' | 'done' | 'failed';
  videoProgress?: number;
  videoError?: string;
  /** 无视频空位时的占位提示 */
  emptyLabel?: string;
  /**
   * 空态引导动作 / 生成 / 取消 / 重试入口（2026-11-04 约定：预览区保持简洁，杜绝按钮嵌套）。
   * 本组件自 2026-11-04 起不再渲染任何空态/覆盖层按钮 —— 这些 props 仅保留签名兼容，
   * 操作入口统一移出预览区（新建片段 → 轨道工具行；生成/重试 → 导演台选择运行条）。
   */
  emptyActions?: Array<{ key: string; icon?: ReactNode; label: string; onClick: () => void }>;
  /** @deprecated 2026-11-04 起不在预览区渲染按钮 */
  onGenerate?: () => void;
  /** @deprecated 2026-11-04 起不在预览区渲染按钮 */
  onStop?: () => void;
  /** 时间轴播放中（true=播放/false=暂停）；切换片段视频时若为 true 则续播 */
  isPlaying?: boolean;
  /** 播放启动时本片段内的起始偏移（秒）= 播放头 - 片段轨道起点 + trimStart（已由宿主折算） */
  playbackOffsetSec?: number;
  /** 播放请求令牌：每次自增触发中央区从 0 播放（点击备选视频时由宿主自增） */
  autoPlayKey?: number;

  // ===== 序列播放契约（2026-09-02 征集 #134） =====
  /** 'all'=整轨序列播放（总时长=各片段之和）；'clip'=仅播放选中片段；null/undefined=未播放 */
  playbackMode?: 'all' | 'clip' | null;
  /** 整轨总时长（秒，全部片段之和）—— 'all' 模式时间码分母 */
  sequenceDuration?: number;
  /** 播放头在整轨上的时间（秒）—— 'all' 模式时间码分子与进度条游标 */
  sequenceTime?: number;
  /** 拖动整轨进度条 → 宿主跳播放头（秒） */
  onSequenceSeek?: (time: number) => void;
  /** 播放/暂停切换（宿主驱动时间轴主时钟） */
  onTogglePlay?: () => void;
  /** 占位片段（未生成）黑幕卡展示的提示词；有值且当前片段无视频 → 渲染黑幕+提示词卡 */
  placeholderPrompt?: string;
  /** 占位片段标题（如「#3 中景」） */
  placeholderTitle?: string;
  /** 2026-11-04 第十二条：状态型占位（仅单行状态文案 + 小图标，不回显提示词）。
   *  提供时优先于 placeholderPrompt 卡；旧 prompt 卡路径保留（出片页/节点侧零变化）。 */
  placeholderStatus?: 'idle' | 'generating' | 'done' | 'failed';
  /** 状态补充信息（如「3/5」「8s」），与状态文案同行以「 · 」拼接 */
  placeholderDetail?: string;
  /** 失败原因（允许跟一行，超长截断） */
  placeholderReason?: string;
  /* 实时预览帧（2026-11-05）：直连 ComfyUI /ws 推流，生成中在占位卡上按帧刷新（≤10fps，宿主节流）；
     image 为 dataURL；step/totalSteps/segmentIndex 可缺省（progress-only 事件） */
  livePreview?: {
    image: string;
    step?: number | null;
    totalSteps?: number | null;
    segmentIndex?: number | null;
  } | null;
  /** 本次运行无实时帧来源（OpenAI 兼容渠道无 ws）→ 占位卡标「仅进度」，不假装实时帧 */
  progressOnly?: boolean;
  /** 全屏播放范围选择（宿主负责切模式 + 起播，本组件只负责进入全屏） */
  onFullscreenPlay?: (mode: 'all' | 'clip') => void;
  /** 是否可播放「本片段」（无选中片段时置 false，全屏下拉对应项置灰） */
  canPlayClip?: boolean;
  /**
   * Plan#83 A 修正：纯视频预览模式（出片全屏编辑器顶栏专用）。
   * true 时去除所有 UI 控制条元素（播放/时间/进度/静音/全屏），
   * 同时禁用点击播放与双击全屏 —— 只剩「画面由时间轴时钟驱动」的纯预览区。
   */
  hideControls?: boolean;

  /**
   * 2026-11-04 参数合并（约定）：预览区只读文字标签（如「16:9 · 1512×840」），
   * 随比例/系数参数实时更新；小字次要色、不遮挡画面（右上角）、不参与点击。
   * 缺省 undefined = 不渲染（出片页等路径零变化）。
   */
  paramsLabel?: string;

  theme: any;
  isDark: boolean;
}

const formatTime = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

export const StoryboardVideoStage = memo(function StoryboardVideoStage({
  videoStorageKey, videoStatus = 'idle', videoProgress = 0, videoError, emptyLabel,
  isPlaying, playbackOffsetSec = 0, autoPlayKey = 0,
  playbackMode, sequenceDuration = 0, sequenceTime = 0,
  onSequenceSeek, onTogglePlay,
  placeholderPrompt, placeholderTitle, placeholderStatus, placeholderDetail, placeholderReason, onFullscreenPlay,
  livePreview, progressOnly = false,
  hideControls = false,
  paramsLabel,
  theme, isDark,
}: StoryboardVideoStageProps): ReactElement {
  // 注：emptyActions/onGenerate/onStop/canPlayClip 保留在 props 签名（兼容调用方），
  // 但 2026-11-04 起不在预览区渲染任何按钮（约定：预览区保持简洁、杜绝按钮嵌套）。
  const { t } = useTranslation();
  const textMuted = theme.toolbar.textMuted;
  const textPrimary = theme.toolbar.text;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  // 2026-08-31：全站统一画布背景色（原 #0c0a09 暖棕黑已废）
  const bg = theme.canvas.background;

  /** 整轨序列播放：控制条语义切到「全部片段之和」 */
  const isSequence = playbackMode === 'all';

  // 与备选卡片同一条解析链：本地 video: 键走 localforage，resources/ 键走后端认证
  const resolvedSrc = useHydratedContent(videoStorageKey, '');

  // ===== 播放器状态（自研控制条） =====
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  // ===== 播放同步（时间轴主时钟驱动 / 候选卡片点击驱动 / 游标 scrub 驱动） =====
  // offset 每帧都在变，只在播放启动/切片段/源就绪/漂移校正时读取 → 用 ref 避免进依赖数组
  const offsetRef = useRef(playbackOffsetSec);
  offsetRef.current = playbackOffsetSec;
  // 播放驱动：isPlaying 变化、切换片段、或片段视频源异步解析完成时 → seek 后续播。
  // resolvedSrc 进依赖是关键：整轨播放切到下一片段时源往往还没解析完，
  // 源就绪瞬间必须立刻续播，否则中央区停在静帧（2026-08-31 修复）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      try { v.currentTime = offsetRef.current; } catch { /* ignore */ }
      void v.play().catch(() => { /* 静默：浏览器拦截等 */ });
    } else {
      v.pause();
    }
  }, [isPlaying, videoStorageKey, resolvedSrc]);

  // 暂停态游标 scrub（2026-08-31 约定）：拖拽/点击游标、拨帧后立即显示对应帧
  const applyPausedSeek = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = Math.min(offsetRef.current, v.duration || offsetRef.current); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (isPlaying) return;
    const v = videoRef.current;
    if (v && v.readyState >= 1) applyPausedSeek();
    // 元数据未就绪时由 <video onLoadedMetadata> 兜底 apply（offsetRef 取最新值）
  }, [playbackOffsetSec, isPlaying, videoStorageKey, resolvedSrc, applyPausedSeek]);

  // 点击候选视频 → 中央区立即从 0 播放对应视频
  useEffect(() => {
    if (autoPlayKey <= 0) return;
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = 0; } catch { /* ignore */ }
    void v.play().catch(() => { /* ignore */ });
  }, [autoPlayKey]);

  // ===== 控制条动作 =====
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => { /* ignore */ });
    else v.pause();
  }, []);
  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);
  /**
   * 全屏对象 = 舞台根节点（2026-09-02）：
   * 此前对 <video> 元素调 requestFullscreen，全屏里只剩裸视频 ——
   * 占位黑幕卡/提示词/自研控制条全部看不见，且无法表达播放范围。
   */
  const enterFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (el?.requestFullscreen) void el.requestFullscreen().catch(() => { /* 浏览器拒绝时静默 */ });
  }, []);
  const goFullscreen = useCallback(() => {
    enterFullscreen();
  }, [enterFullscreen]);

  // 全屏（2026-11-04 约定：预览区不弹第二层按钮）：
  // 单击直接进全屏；宿主给了 onFullscreenPlay 时按当前播放模式先回调（'all' 序列 / 'clip' 单片段）。
  const handleFullscreenPlay = useCallback((mode: 'all' | 'clip') => {
    onFullscreenPlay?.(mode);
    // 等一帧让宿主把视频源/播放态切好，再进全屏（避免全屏里闪一下上一片段）
    requestAnimationFrame(() => enterFullscreen());
  }, [onFullscreenPlay, enterFullscreen]);
  const handleFullscreenClick = useCallback(() => {
    if (onFullscreenPlay) {
      handleFullscreenPlay(isSequence ? 'all' : 'clip');
      return;
    }
    goFullscreen();
  }, [onFullscreenPlay, isSequence, goFullscreen, handleFullscreenPlay]);

  // ===== 进度条 scrub（可点击 + 可拖拽；window + capture 规避页签边界冒泡阻断） =====
  const trackRef = useRef<HTMLDivElement>(null);
  const seekFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (isSequence) {
      // 整轨序列：拖动 = 移动整轨播放头（宿主持有主时钟）
      if (sequenceDuration > 0) onSequenceSeek?.(ratio * sequenceDuration);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = ratio * (v.duration || 0); setCurTime(v.currentTime); } catch { /* ignore */ }
  }, [isSequence, sequenceDuration, onSequenceSeek]);
  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    seekFromClientX(e.clientX);
    const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [seekFromClientX]);

  // 时间码与进度：整轨模式用序列时间，否则用当前视频自身时间
  const displayTime = isSequence ? sequenceTime : curTime;
  const displayDuration = isSequence ? sequenceDuration : duration;
  const progress = displayDuration > 0 ? Math.min(1, Math.max(0, displayTime / displayDuration)) : 0;
  // 播放态：只要时间轴主时钟在跑（playbackMode != null）就以它为准 —— 否则本地暂停会与主时钟脱节，
  // 主时钟继续前进而画面停在原处（2026-09-02 征集 #134）。
  const useMasterClock = playbackMode != null;
  const showPlaying = useMasterClock ? !!isPlaying : playing;
  const handlePlayToggle = useMasterClock ? (onTogglePlay ?? togglePlay) : togglePlay;
  const ctrlBtnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, padding: 0, border: 'none', borderRadius: 6,
    background: 'transparent', color: '#fff', cursor: 'pointer',
  } as const;

  const hasVideo = !!videoStorageKey && videoStatus !== 'failed';
  // 占位黑幕卡：当前片段没有视频、且有当前片段（宿主传了标题/提示词）→ 无论提示词是否为空都出黑屏+标题，
  // 满足「播放全部时占位节点 = 黑屏+标题」硬性要求（2026-09-02 验收）。
  const showPlaceholder = !hasVideo && (!!placeholderPrompt || !!placeholderTitle);
  // 第十二条：状态型占位（优先于旧 prompt 卡）——仅单行状态文案 + 小图标，不回显提示词
  const showStatusPlaceholder = !hasVideo && !!placeholderStatus;
  const statusLabel = placeholderStatus === 'generating'
    ? t('storyboard.statusGenerating', '生成中')
    : placeholderStatus === 'done'
      ? t('storyboard.statusDone', '已生成')
      : placeholderStatus === 'failed'
        ? t('storyboard.statusFailed', '生成失败')
        : t('storyboard.statusIdle', '未生成');
  // Plan#83 A 修正：hideControls 模式下不渲染控制条 UI
  const showControlBar = !hideControls && (hasVideo || showPlaceholder || showStatusPlaceholder);

  return (
    <div
      ref={rootRef}
      data-video-stage
      style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, background: showPlaceholder ? '#000000' : bg, borderRadius: 8, border: `1px solid ${cardBorder}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {hasVideo ? (
        <video
          key={videoStorageKey}
          ref={videoRef}
          src={resolvedSrc || undefined}
          // 约定：不用原生播放器 —— 自研控制条（下方独立渲染，占位黑幕卡下也要可见）
          controls={false}
          preload="metadata"
          // Plan#83 A 修正：hideControls 模式下禁用点击播放 / 双击全屏
          onClick={hideControls ? undefined : togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onLoadedMetadata={applyPausedSeek}
          // 沿用经验 #14 video-doubleclick-fullscreen：双击全屏（全屏对象=舞台根节点）
          onDoubleClick={hideControls ? undefined : goFullscreen}
          style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: hideControls ? 'default' : 'pointer' }}
        />
      ) : showStatusPlaceholder ? (
        /* ===== 第十二条：状态型占位卡（仅状态，不回显提示词） =====
           单行状态文案 + 小图标；失败时允许跟一行简短原因（截断一行）；
           无按钮、无框套框。状态由宿主按当前激活片段传入，切片段即联动。 */
        <div
          data-placeholder-status={placeholderStatus}
          style={{
            position: 'absolute', inset: 0, zIndex: 1,
            background: '#000000',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, padding: '28px 32px', textAlign: 'center',
          }}
        >
          {placeholderStatus === 'generating' && livePreview?.image ? (
            /* 实时预览帧（/ws 推流）：黑幕上按帧刷新，状态信息不压画面（见下方左下角角标） */
            <img
              data-live-preview-frame
              src={livePreview.image}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : null}
          {placeholderStatus === 'generating' && livePreview?.image ? (
            /* 2026-11-05 修复（生成中时文本标签挡画面）：两块居中 chip 合并为左下角紧凑角标 ——
               脉冲小点表示跑着 + 「2/25 · 段1」；小字半透明底、pointer-events:none 不拦截交互；
               完整文案（实时预览中 · 2/25 · 第 1 段）走 title 悬停；完成/失败后本角标随条件消失 */
            (() => {
              const stepText =
                typeof livePreview.step === 'number' && typeof livePreview.totalSteps === 'number'
                  ? `${livePreview.step}/${livePreview.totalSteps}`
                  : '';
              const segShort =
                typeof livePreview.segmentIndex === 'number'
                  ? t('storyboard.livePreviewSegmentShort', '段{{n}}', { n: livePreview.segmentIndex })
                  : '';
              const segFull =
                typeof livePreview.segmentIndex === 'number'
                  ? t('storyboard.livePreviewSegment', '第 {{n}} 段', { n: livePreview.segmentIndex })
                  : '';
              const compact = [stepText, segShort].filter(Boolean).join(' · ')
                || t('storyboard.livePreviewBadge', '实时预览中');
              const full = [t('storyboard.livePreviewBadge', '实时预览中'), stepText, segFull]
                .filter(Boolean)
                .join(' · ');
              return (
                <>
                  <style>{'@keyframes zxo-lp-pulse{0%,100%{opacity:1}50%{opacity:.25}}'}</style>
                  <span
                    data-live-preview-badge
                    title={full}
                    style={{
                      position: 'absolute', left: 10, bottom: 10, zIndex: 2,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: 'rgba(0,0,0,0.45)', borderRadius: 999, padding: '2px 9px',
                      fontSize: 11, letterSpacing: '0.02em',
                      color: 'rgba(255,255,255,0.75)',
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 6, height: 6, borderRadius: '50%', background: '#52c41a',
                        animation: 'zxo-lp-pulse 1.2s ease-in-out infinite',
                      }}
                    />
                    {compact}
                  </span>
                </>
              );
            })()
          ) : placeholderStatus === 'generating' ? (
            /* 无实时帧的生成中：用与画布节点同款骨架（脉冲点 + 阶段文案 + shimmer），
               不再只留一行静态文字，避免用户以为软件卡死 */
            <>
              <div
                data-generating-skeleton
                style={{
                  position: 'relative', zIndex: 2, width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <AISkeleton type="media" accentColor={theme.toolbar.accent} kind="video" />
              </div>
              {placeholderDetail ? (
                <span
                  data-generating-detail
                  style={{
                    position: 'relative', zIndex: 2,
                    color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.02em',
                  }}
                >
                  {placeholderDetail}
                </span>
              ) : null}
              {progressOnly ? (
                <span
                  data-progress-only-badge
                  style={{
                    position: 'relative', zIndex: 2,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    color: 'rgba(255,255,255,0.45)', fontSize: 12,
                  }}
                >
                  {t('storyboard.progressOnly', '仅进度（该渠道无实时帧）')}
                </span>
              ) : null}
            </>
          ) : (
            /* 非生成中（idle/完成/失败/取消）：保留单行状态文案 */
            <span
              style={{
                position: 'relative', zIndex: 2,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                color: 'rgba(255,255,255,0.72)', fontSize: 12, letterSpacing: '0.02em',
              }}
            >
              <CANVAS_NODE_ICONS.videoEmpty size={12} strokeWidth={1.8} />
              {statusLabel}
              {placeholderDetail ? ` · ${placeholderDetail}` : ''}
            </span>
          )}
          {placeholderStatus === 'failed' && placeholderReason ? (
            <span
              data-placeholder-reason
              style={{
                maxWidth: 340, fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.45)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {placeholderReason}
            </span>
          ) : null}
        </div>
      ) : showPlaceholder ? (
        /* ===== 占位片段黑幕卡（2026-09-02 征集 #134） =====
           整轨播放走到未生成片段时，像剪辑软件一样出黑幕 + 提示词，
           从而能把「全部片段」完整预览完，而不是空白/卡住。 */
        <div
          data-placeholder-card
          style={{
            position: 'absolute', inset: 0, zIndex: 1,
            background: '#000000',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: '28px 32px', textAlign: 'center',
          }}
        >
          {/* 2026-11-04 红圈重排：去掉 pill 边框/背景（黑幕上再套小卡 = 框套框），
              改纯文本一行；黑幕 + 标题硬需求（2026-09-02 征集 #134）不变 */}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              color: 'rgba(255,255,255,0.72)', fontSize: 12, letterSpacing: '0.02em',
            }}
          >
            <CANVAS_NODE_ICONS.videoEmpty size={12} strokeWidth={1.8} />
            {t('storyboard.placeholderBadge', '未生成')}
            {placeholderTitle ? ` · ${placeholderTitle}` : ''}
          </span>
          <span
            style={{
              maxWidth: 560, fontSize: 13, lineHeight: 1.7,
              color: placeholderPrompt ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
              display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', wordBreak: 'break-word',
            }}
          >
            {placeholderPrompt || t('storyboard.placeholderEmpty', '（暂无提示词，在下方填写后即可生成）')}
          </span>
          {!isPlaying && placeholderPrompt && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', marginTop: 2 }}>
              {t('storyboard.placeholderHint', '在下方填写提示词后即可生成视频')}
            </span>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: textMuted, fontSize: 12, padding: 20, textAlign: 'center' }}>
          <CANVAS_NODE_ICONS.videoEmpty size={32} strokeWidth={1.5} style={{ opacity: 0.45 }} />
          {/* 2026-11-04 约定：空态只留一行中性提示，不放任何按钮（杜绝按钮嵌套）。
              操作入口移出预览区：新建片段 → 轨道工具行；生成/重试 → 导演台选择运行条。 */}
          <span style={{ maxWidth: 340, lineHeight: 1.6 }}>{emptyLabel ?? t('storyboard.videoEmpty', '本镜尚无视频')}</span>
        </div>
      )}

      {/* 2026-11-04 参数合并：预览区只读文字标签（如「16:9 · 1512×840」）——
          小字次要色、右上角不遮挡画面、不参与点击；参数变化由宿主重算文本后实时同步 */}
      {paramsLabel && (
        <span
          data-params-label
          aria-hidden
          style={{
            position: 'absolute', top: 6, right: 8, zIndex: 3,
            fontSize: 10, lineHeight: '14px', color: 'rgba(255,255,255,0.55)',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
            textShadow: '0 1px 2px rgba(0,0,0,0.55)',
            pointerEvents: 'none', userSelect: 'none',
            maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {paramsLabel}
        </span>
      )}

      {/* 自研控制条（OpenCut 风：底部渐变 + 播放/时间/进度/静音/全屏） */}
      {showControlBar && (
        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.45) 60%, transparent)',
          }}
        >
          <button
            type="button"
            onClick={handlePlayToggle}
            style={ctrlBtnStyle}
            title={showPlaying ? t('storyboard.pause', '暂停') : t('storyboard.play', '播放')}
          >
            {showPlaying ? <Pause size={16} fill="#fff" /> : <Play size={16} fill="#fff" />}
          </button>
          <span style={{ fontSize: 11, color: '#fff', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', userSelect: 'none' }}>
            {formatTime(displayTime)} / {formatTime(displayDuration)}
          </span>
          {/* 进度条：整轨模式拖整轨播放头；否则拖当前视频 */}
          <div
            ref={trackRef}
            onPointerDown={handleTrackPointerDown}
            style={{ flex: 1, height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}
          >
            <div style={{ position: 'relative', width: '100%', height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.25)' }}>
              {/* 进度条填充：纯白（控制条底色是黑渐变，白色最中性清晰，无彩色） */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, borderRadius: 2, background: 'rgba(255,255,255,0.85)' }} />
              <div
                style={{
                  position: 'absolute', left: `${progress * 100}%`, top: '50%',
                  width: 10, height: 10, borderRadius: '50%', background: '#fff',
                  transform: 'translate(-50%, -50%)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>
          <button type="button" onClick={toggleMute} style={ctrlBtnStyle} title={muted ? t('storyboard.unmute', '取消静音') : t('storyboard.mute', '静音')}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          {/* 全屏：单一控制（2026-11-04 约定：不再有「全屏播放全部/本片段」第二层菜单按钮，
              范围跟随当前播放模式） */}
          <button type="button" onClick={handleFullscreenClick} style={ctrlBtnStyle} title={t('storyboard.fullscreen', '全屏')}>
            <Maximize size={14} />
          </button>
        </div>
      )}

      {/* 状态覆盖层 —— 颜色一律走 theme，禁止硬编码红（2026-08-31 修复） */}
      {videoStatus === 'generating' && (
        <div
          data-video-status="generating"
          style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)', color: isDark ? '#fff' : textPrimary, fontSize: 12 }}
        >
          <div
            style={{
              width: 26, height: 26, borderRadius: '50%',
              border: `2px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.10)'}`,
              // 无彩色：spinner 上弧用中性文字色（覆盖层明暗自适应）
              borderTopColor: isDark ? '#ffffff' : textPrimary,
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>{t('storyboard.generating', '视频生成中')} {Math.round((videoProgress ?? 0) * 100)}%</span>
        </div>
      )}
      {videoStatus === 'failed' && (
        <div
          data-video-status="failed"
          style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: isDark ? `${theme.toolbar.danger}40` : `${theme.toolbar.danger}18`, color: isDark ? '#fff' : theme.toolbar.danger, fontSize: 12, padding: 16, textAlign: 'center' }}
        >
          <CANVAS_NODE_ICONS.warning size={22} />
          <span>{videoError ?? t('storyboard.generateFailed', '生成失败')}</span>
        </div>
      )}
    </div>
  );
});
