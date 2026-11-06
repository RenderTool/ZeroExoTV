/**
 * StoryboardPromptVersionList - 提示词版本历史列表（Plan#58 T3/T5）
 *
 * 渲染当前镜头所有版本，支持选中两版对比，用户标签（废片/可用/精品）。
 * 列表样式对齐生产台备选视频列表风格。
 */
import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Square, GitCompare, ThumbsDown, ThumbsUp, Star } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { PromptHistoryEntry } from './workbench-types';

export interface StoryboardPromptVersionListProps {
  /** 版本历史数组 */
  history: PromptHistoryEntry[];
  /** 选中两个版本对比回调 */
  onCompare: (v1: number, v2: number) => void;
  /** 更新版本标签回调 */
  onLabelUpdate?: (version: number, label: 'failed' | 'acceptable' | 'excellent') => void;
}

export const StoryboardPromptVersionList = memo(function StoryboardPromptVersionList({
  history,
  onCompare,
  onLabelUpdate,
}: StoryboardPromptVersionListProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  // 选中用于对比的版本号
  const [selectedVersions, setSelectedVersions] = useState<number[]>([]);

  // 排序：最新版本在前
  const sorted = useMemo(() => {
    return [...history].sort((a, b) => b.version - a.version);
  }, [history]);

  const toggleSelect = useCallback((version: number) => {
    setSelectedVersions((prev) => {
      if (prev.includes(version)) {
        return prev.filter((v) => v !== version);
      }
      // 最多选两个
      if (prev.length >= 2) return prev;
      return [...prev, version];
    });
  }, []);

  const handleCompare = useCallback(() => {
    if (selectedVersions.length === 2) {
      // 按版本号升序传入（旧版在前）
      const sorted = [...selectedVersions].sort((a, b) => a - b);
      onCompare(sorted[0]!, sorted[1]!);
    }
  }, [selectedVersions, onCompare]);

  const formatTime = useCallback((ts: string) => {
    try {
      const d = new Date(ts);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return ts;
    }
  }, []);

  // 标签颜色映射
  const labelStyle = useCallback((label?: 'failed' | 'acceptable' | 'excellent') => {
    switch (label) {
      case 'failed':
        return { bg: 'rgba(239,68,68,0.15)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' };
      case 'acceptable':
        return { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: 'rgba(59,130,246,0.3)' };
      case 'excellent':
        return { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', border: 'rgba(34,197,94,0.3)' };
      default:
        return { bg: 'transparent', color: theme.toolbar.textMuted, border: 'transparent' };
    }
  }, [theme.toolbar.textMuted]);

  const textMuted = theme.toolbar.textMuted;

  if (history.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: textMuted, fontSize: 12, userSelect: 'none',
      }}>
        {t('promptDiff.noHistory', '暂无版本历史')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 对比按钮 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '6px 10px', flexShrink: 0, gap: 6,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      }}>
        <span style={{ fontSize: 10, color: textMuted }}>
          {selectedVersions.length === 0
            ? t('promptDiff.selectVersions', '选择两个版本对比')
            : selectedVersions.length === 1
              ? t('promptDiff.selectAnother', '再选一个版本')
              : t('promptDiff.selectedTwo', '已选两个版本')}
        </span>
        <button
          type="button"
          onClick={handleCompare}
          disabled={selectedVersions.length !== 2}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 24, padding: '0 8px', borderRadius: 6,
            border: 'none',
            background: selectedVersions.length === 2
              ? (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)')
              : 'transparent',
            color: selectedVersions.length === 2 ? theme.toolbar.text : textMuted,
            fontSize: 11, fontWeight: 500,
            cursor: selectedVersions.length === 2 ? 'pointer' : 'default',
            fontFamily: 'inherit', transition: 'all 0.12s',
          }}
        >
          <GitCompare size={12} />
          {t('promptDiff.compare', '对比')}
        </button>
      </div>

      {/* 版本列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sorted.map((entry) => {
          const isSelected = selectedVersions.includes(entry.version);

          return (
            <div
              key={entry.version}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', cursor: 'pointer',
                background: isSelected
                  ? (isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)')
                  : 'transparent',
                transition: 'background 0.1s',
                borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}`,
                fontSize: 11,
              }}
              onClick={() => toggleSelect(entry.version)}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* 选择框 */}
              <span style={{ flexShrink: 0, display: 'inline-flex', color: textMuted }}>
                {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              </span>

              {/* 缩略图 */}
              {entry.thumbnailUrl ? (
                <div style={{
                  width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                  overflow: 'hidden', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                }}>
                  <img
                    src={entry.thumbnailUrl}
                    alt={`v${entry.version}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              ) : (
                <div style={{
                  width: 32, height: 32, borderRadius: 4, flexShrink: 0,
                  background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: textMuted,
                }}>
                  V{entry.version}
                </div>
              )}

              {/* 版本信息 */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, color: theme.toolbar.text, fontSize: 11 }}>
                    {t('promptDiff.version', '版本')} {entry.version}
                  </span>
                  {entry.qualityScore !== undefined && (
                    <span style={{
                      fontSize: 10, color: entry.qualityScore >= 80 ? '#22c55e' : entry.qualityScore >= 50 ? '#eab308' : '#ef4444',
                      fontWeight: 500,
                    }}>
                      {entry.qualityScore}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 10, color: textMuted }}>
                  {t('promptDiff.timestamp', '时间')}: {formatTime(entry.timestamp)}
                </span>
              </div>

              {/* 标签按钮（T5） */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                {(['failed', 'acceptable', 'excellent'] as const).map((l) => {
                  const isActive = entry.label === l;
                  const activeLs = labelStyle(l);
                  const labelKey = l === 'failed' ? 'promptDiff.labelFailed' : l === 'acceptable' ? 'promptDiff.labelAcceptable' : 'promptDiff.labelExcellent';
                  return (
                    <button
                      key={l}
                      type="button"
                      title={t(labelKey)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onLabelUpdate?.(entry.version, l);
                      }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 10, padding: 0,
                        border: isActive ? `1px solid ${activeLs.color}` : `1px solid transparent`,
                        background: isActive ? activeLs.bg : 'transparent',
                        color: isActive ? activeLs.color : textMuted,
                        cursor: 'pointer', transition: 'all 0.12s',
                        opacity: isActive ? 1 : 0.4,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.opacity = '0.4';
                      }}
                    >
                      {l === 'failed' ? <ThumbsDown size={10} /> :
                       l === 'acceptable' ? <ThumbsUp size={10} /> :
                       <Star size={10} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});