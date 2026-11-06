/**
 * useWorkbenchVideoStageProps - 出片工作台视频舞台属性 Hook
 *
 * 从 WorkbenchSheet 中提取 emptyActions / emptyLabel / videoStatus 等逻辑，
 * 解耦 700+ 行的巨无霸组件，使视频舞台的交互行为可独立维护。
 *
 * 片态二分（2026-09-01 Plan#61）：
 * - placeholder：未调用 AI，准备提示词/素材 → 显示提示词输入器，舞台无生成按钮。
 * - completed：API 生成后 / 资产拖入 → 无提示词输入，直接播放。
 *
 * 空态引导（2026-09-01）：
 * - 无任何片段（currentShot == null）→ 显示「新建片段 · 关联分镜」高级感文字链接。
 * - 有占位片但未生成 → 仅提示「在下方填写提示词后即可生成视频」，无生成按钮。
 * - completed 但无视频 → 中性「本镜尚无视频」。
 *
 * 序列播放契约（2026-09-02 征集 #134）：
 * - playbackMode='all' 时舞台控制条切到整轨时间码（总时长 = 全部片段之和）；
 * - 当前片段无媒体 → 透传 placeholderPrompt，舞台渲染黑幕 + 提示词，
 *   使整轨预览能完整走完未生成片段（剪辑软件质感）。
 */

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
/* i18n TFunction type not exported in this version, using any */
import type { StoryboardVideoStageProps } from './storyboard-video-stage';
import type { WorkbenchShot } from './workbench-types';

export interface UseVideoStagePropsInput {
  currentShot: WorkbenchShot | undefined;
  activeMediaStorageKey: string | undefined;
  timelinePlaying: boolean;
  playhead: number;
  activeClipStartSec: number;
  autoPlayKey: number;
  /** 全部片段时长之和（秒）—— 整轨播放时间码分母 */
  sequenceDuration: number;
  /** 播放模式：'all'=整轨序列 / 'clip'=仅选中片段 / null=未播放 */
  playbackMode: 'all' | 'clip' | null;
  /** 中央舞台控制条播放/暂停 → 驱动时间轴主时钟 */
  onTogglePlay: () => void;
  /** 拖动整轨进度条 → 跳播放头（秒） */
  onSequenceSeek: (time: number) => void;
  /** 全屏播放范围选择 */
  onFullscreenPlay: (mode: 'all' | 'clip') => void;
  /** 新建片段回调 */
  onInsertAt: (afterShotId: string | null) => void;
  /** 生成视频回调（仅 completed 片态可用） */
  onGenerate: (() => void) | undefined;
  /** 停止生成回调 */
  onStop: () => void;
  theme: any;
  isDark: boolean;
  t: (...args: any[]) => string;
}

/**
 * 根据工作台当前状态生成 StoryboardVideoStageProps。
 *
 * 核心职责：
 * 1. 根据 clipState 决定 videoStatus（idle / generating / done / failed）
 * 2. 根据 currentShot 是否存在及 clipState 决定空态文案（emptyLabel）
 * 3. 无片段时渲染「新建片段 · 关联分镜」引导动作（emptyActions）
 * 4. 仅 completed 片态才暴露 onGenerate 入口
 * 5. 序列播放：折算片段内偏移（含 trimStart）+ 透传整轨时间码与占位提示词
 */
export function useWorkbenchVideoStageProps(input: UseVideoStagePropsInput): StoryboardVideoStageProps {
  const {
    currentShot,
    activeMediaStorageKey,
    timelinePlaying,
    playhead,
    activeClipStartSec,
    autoPlayKey,
    sequenceDuration,
    playbackMode,
    onTogglePlay,
    onSequenceSeek,
    onFullscreenPlay,
    onInsertAt,
    
    onGenerate,
    onStop,
    theme,
    isDark,
    t,
  } = input;

  return useMemo<StoryboardVideoStageProps>(() => {
    let videoStatus: StoryboardVideoStageProps['videoStatus'] = 'idle';
    if (currentShot?.status === 'generating') {
      videoStatus = 'generating';
    } else if (currentShot?.status === 'failed') {
      videoStatus = 'failed';
    } else if (currentShot?.clipState === 'completed') {
      videoStatus = 'done';
    }

    let emptyLabel: string;
    if (!currentShot) {
      emptyLabel = t('workbench.emptyGuide.title', '从分镜导入镜头，或新建片段开始创作');
    } else if (currentShot.clipState === 'placeholder') {
      emptyLabel = t('workbench.fillPromptHint', '在下方填写提示词后即可生成视频');
    } else {
      emptyLabel = t('storyboard.videoEmpty', '本镜尚无视频');
    }

    const emptyActions: StoryboardVideoStageProps['emptyActions'] = !currentShot
      ? [
          {
            key: 'insert',
            icon: <Plus size={14} strokeWidth={1.8} />,
            label: t('workbench.emptyGuide.insert', '新建片段'),
            onClick: () => onInsertAt(null),
          },
        ]
      : [];

    // 有媒体时：片段内偏移 = 播放头 - 片段轨道起点 + 源内裁剪起点（trimStart 必须计入，
    // 否则裁剪后播放的画面比片段内容更早，2026-09-02 修复）
    const trimStart = currentShot?.media?.trimStart ?? 0;
    const playbackOffsetSec = activeMediaStorageKey
      ? Math.max(0, playhead - activeClipStartSec) + trimStart
      : 0;

    // 占位黑幕卡：当前片段没有媒体时才出（未生成的占位片段）
    const placeholderPrompt = !activeMediaStorageKey && currentShot
      ? (currentShot.videoPrompt || currentShot.imagePrompt || currentShot.description || '')
      : undefined;
    const placeholderTitle = currentShot
      ? `#${currentShot.number}${currentShot.shotType ? ` ${currentShot.shotType}` : ''}`
      : undefined;

    return {
      videoStorageKey: activeMediaStorageKey,
      videoStatus,
      videoProgress: 0,
      videoError: undefined,
      emptyLabel,
      emptyActions,
      onGenerate: currentShot?.clipState === 'completed' ? onGenerate : undefined,
      onStop,
      isPlaying: timelinePlaying,
      playbackOffsetSec,
      autoPlayKey,
      // ===== 序列播放契约（2026-09-02 征集 #134） =====
      playbackMode,
      sequenceDuration,
      sequenceTime: playhead,
      onSequenceSeek,
      onTogglePlay,
      placeholderPrompt,
      placeholderTitle,
      onFullscreenPlay,
      canPlayClip: !!currentShot,
      theme,
      isDark,
    };
  }, [
    currentShot,
    activeMediaStorageKey,
    timelinePlaying,
    playhead,
    activeClipStartSec,
    autoPlayKey,
    sequenceDuration,
    playbackMode,
    onTogglePlay,
    onSequenceSeek,
    onFullscreenPlay,
    onInsertAt,
    
    onGenerate,
    onStop,
    theme,
    isDark,
    t,
  ]);
}
