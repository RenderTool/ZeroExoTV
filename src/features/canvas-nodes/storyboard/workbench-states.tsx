/**
 * WorkbenchStates - 出片工作台节点内联态子组件
 *
 * 从 workbench-sheet.tsx 提取，纯渲染组件，无状态无 hook。
 * IdleState / ReadyState / GeneratingState / DoneState
 */
import type { CSSProperties, ReactElement } from 'react';
import { Clapperboard, Play, Plus, Maximize } from 'lucide-react';
import { Progress } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { CapsuleToolBtn } from '../../tools-dock/capsbtn.js';
import type { WorkbenchNodeData } from './workbench-types';

// ===== 样式（被子组件共享） =====

const centerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
};

/** 节点内联态内容堆叠（无卡片外壳：不画边框/底色/内边距） */
const stackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  maxWidth: 200,
  padding: '0 12px',
};

// ===== 组件 =====

/** idle 态：无片段空态，CanvasEmptyState 同款（图标标题 + 列表式按钮）
 * 2026-09-04 修复：出片空态此前没有任何引导/入口（IdleState 三按钮可选、
 * 调用方全未接线）→ 空壳卡片。现接入 hintText/hintDesc（静态引导行，同款按钮视觉）+ 全屏按钮。 */
export function IdleState({
  mutedColor: _mutedColor,
  onInsertAt,
  onOpenFullscreen,
  hintText,
  hintDesc,
}: {
  mutedColor: string;
  onInsertAt?: () => void;
  onOpenFullscreen?: () => void;
  /** 静态引导主行（可选） */
  hintText?: string;
  /** 静态引导描述行（可选） */
  hintDesc?: string;
}): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const iconStroke = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.55)';
  const textLabel = isDark ? 'rgba(255,255,255,0.74)' : 'rgba(0,0,0,0.62)';
  const textDesc = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.42)';
  const rowBgHover = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 50px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', maxWidth: 240 }}>
        {(hintText || hintDesc) && (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
              padding: '6px 12px 12px', boxSizing: 'border-box',
            }}
          >
            <Clapperboard size={16} strokeWidth={1.8} color={iconStroke} style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              {hintText && <div style={{ fontSize: 13, fontWeight: 500, color: textLabel, lineHeight: 1.3 }}>{hintText}</div>}
              {hintDesc && <div style={{ fontSize: 11, color: textDesc, lineHeight: 1.4 }}>{hintDesc}</div>}
            </div>
          </div>
        )}
        {onInsertAt && (
          <button
            type="button"
            onClick={onInsertAt}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '6px 12px', borderRadius: 9, border: 'none', backgroundColor: 'transparent',
              cursor: 'pointer', textAlign: 'left', transition: 'background-color 140ms ease', color: 'inherit',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = rowBgHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <Plus size={16} strokeWidth={1.8} color={iconStroke} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: textLabel, lineHeight: 1.3 }}>
                {t('workbench.newShot', '新建片段')}
              </div>
              <div style={{ fontSize: 11, color: textDesc, lineHeight: 1.4 }}>
                {t('workbench.newShotDesc', '新建片段')}
              </div>
            </div>
          </button>
        )}
        {onOpenFullscreen && (
          <button
            type="button"
            onClick={onOpenFullscreen}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
              padding: '6px 12px', borderRadius: 9, border: 'none', backgroundColor: 'transparent',
              cursor: 'pointer', textAlign: 'left', transition: 'background-color 140ms ease', color: 'inherit',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = rowBgHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
          >
            <Maximize size={16} strokeWidth={1.8} color={iconStroke} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: textLabel, lineHeight: 1.3 }}>
                {t('workbench.fullscreen', '全屏编辑')}
              </div>
              <div style={{ fontSize: 11, color: textDesc, lineHeight: 1.4 }}>
                {t('workbench.fullscreenDesc', '全屏编辑')}
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

/** ready 态：摘要 + 进度条 + 进入工作台按钮（无卡片外壳，纯居中堆叠） */
export function ReadyState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  isDark,
  onOpenFullscreen,
  accent,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
  accent: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchReady')}</span>
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
          {data.totalDuration > 0 && ` · ${t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}`}
        </span>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={accent}
          railColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <CapsuleToolBtn
          variant="accent"
          icon={<Play size={12} />}
          onClick={onOpenFullscreen}
        >
          {t('canvasNodes.workbenchEnter')}
        </CapsuleToolBtn>
      </div>
    </div>
  );
}

/** generating 态：进度条 + 生成中文案（无卡片外壳） */
export function GeneratingState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  isDark,
  accent,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  accent: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchGenerating')}</span>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={accent}
          railColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })} · {t('canvasNodes.workbenchCompletedCount', { count: data.completedCount })}
        </span>
      </div>
    </div>
  );
}

/** done 态：完成摘要 + 进入工作台按钮（无卡片外壳） */
export function DoneState({
  data,
  textColor,
  mutedColor,
  isDark,
  onOpenFullscreen,
}: {
  data: WorkbenchNodeData;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchDone')}</span>
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
          {data.totalDuration > 0 && ` · ${t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}`}
        </span>
        <Progress
          percent={100}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={isDark ? '#22c55e' : '#16a34a'}
          railColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <CapsuleToolBtn
          variant="accent"
          icon={<Play size={12} />}
          onClick={onOpenFullscreen}
        >
          {t('canvasNodes.workbenchEnter')}
        </CapsuleToolBtn>
      </div>
    </div>
  );
}