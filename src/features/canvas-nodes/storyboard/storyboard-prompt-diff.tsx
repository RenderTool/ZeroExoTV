/**
 * StoryboardPromptDiff - 提示词版本 Diff 可视化组件（Plan#58 T4/T6）
 *
 * 使用 `diff` npm 包逐行对比 imagePrompt 和 videoPrompt 的差异，
 * 绿色高亮新增、红色高亮删除、黄色高亮修改。
 * 底部提供「问 AI 分析差异」按钮（T6 占位）。
 */
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { diffLines } from 'diff';
import { useTheme } from '@zeroexo/plugin-theme';
import { message } from 'antd';
import { Sparkles } from 'lucide-react';
import type { PromptHistoryEntry } from './workbench-types';

export interface StoryboardPromptDiffProps {
  version1: PromptHistoryEntry;
  version2: PromptHistoryEntry;
}

interface DiffLine {
  type: 'added' | 'removed' | 'changed';
  value: string;
}

/** 逐行对比两段文本，返回差异行数组 */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText || '', newText || '');
  const lines: DiffLine[] = [];

  for (const part of changes) {
    if (part.added) {
      // 整段新增
      const split = part.value.split('\n');
      for (const l of split) {
        if (l.length > 0) lines.push({ type: 'added', value: l });
      }
    } else if (part.removed) {
      // 整段删除
      const split = part.value.split('\n');
      for (const l of split) {
        if (l.length > 0) lines.push({ type: 'removed', value: l });
      }
    } else {
      // 未变化
      const split = part.value.split('\n');
      for (const l of split) {
        if (l.length > 0) lines.push({ type: 'changed', value: l });
      }
    }
  }

  return lines;
}

export const StoryboardPromptDiff = memo(function StoryboardPromptDiff({
  version1,
  version2,
}: StoryboardPromptDiffProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const textMuted = theme.toolbar.textMuted;

  const imagePromptDiff = useMemo(() => computeLineDiff(version1.imagePrompt, version2.imagePrompt), [version1.imagePrompt, version2.imagePrompt]);
  const videoPromptDiff = useMemo(() => computeLineDiff(version1.videoPrompt, version2.videoPrompt), [version1.videoPrompt, version2.videoPrompt]);

  const handleAskAI = useCallback(() => {
    message.info(t('promptDiff.aiComingSoon', 'AI 分析功能待集成'));
  }, [t]);

  const lineStyle = useCallback((type: DiffLine['type'], _index: number) => {
    const base: React.CSSProperties = {
      padding: '1px 8px',
      fontSize: 11,
      fontFamily: 'monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      lineHeight: 1.6,
    };

    if (type === 'added') {
      return {
        ...base,
        background: isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.10)',
        color: isDark ? '#4ade80' : '#16a34a',
      };
    }
    if (type === 'removed') {
      return {
        ...base,
        background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.10)',
        color: isDark ? '#f87171' : '#dc2626',
      };
    }
    // unchanged
    return {
      ...base,
      color: theme.toolbar.text,
      opacity: 0.7,
    };
  }, [isDark, theme.toolbar.text]);

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    padding: '6px 10px',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
    margin: 0,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 头部：版本信息 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '6px 10px', flexShrink: 0,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        fontSize: 11,
      }}>
        <span style={{ color: textMuted }}>
          {t('promptDiff.diffTitle', '版本对比')}
        </span>
        <span style={{ color: theme.toolbar.text, fontWeight: 600 }}>
          V{version1.version}
        </span>
        <span style={{ color: textMuted }}>→</span>
        <span style={{ color: theme.toolbar.text, fontWeight: 600 }}>
          V{version2.version}
        </span>
      </div>

      {/* 差异内容 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* Image Prompt 差异 */}
        <div style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}` }}>
          <div style={sectionTitleStyle}>
            Image Prompt
          </div>
          <div style={{ padding: '4px 0' }}>
            {imagePromptDiff.length > 0 ? imagePromptDiff.map((line, i) => (
              <div key={i} style={lineStyle(line.type, i)}>
                {line.type === 'added' && '+ '}
                {line.type === 'removed' && '- '}
                {line.type === 'changed' && '  '}
                {line.value}
              </div>
            )) : (
              <div style={{ padding: '6px 10px', fontSize: 11, color: textMuted }}>
                {t('promptDiff.noChanges', '无变化')}
              </div>
            )}
          </div>
        </div>

        {/* Video Prompt 差异 */}
        <div>
          <div style={sectionTitleStyle}>
            Video Prompt
          </div>
          <div style={{ padding: '4px 0' }}>
            {videoPromptDiff.length > 0 ? videoPromptDiff.map((line, i) => (
              <div key={i} style={lineStyle(line.type, i)}>
                {line.type === 'added' && '+ '}
                {line.type === 'removed' && '- '}
                {line.type === 'changed' && '  '}
                {line.value}
              </div>
            )) : (
              <div style={{ padding: '6px 10px', fontSize: 11, color: textMuted }}>
                {t('promptDiff.noChanges', '无变化')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部：「问 AI 分析差异」按钮（T6 占位） */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8px 10px', flexShrink: 0,
        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      }}>
        <button
          type="button"
          onClick={handleAskAI}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 26, padding: '0 12px', borderRadius: 6,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.10)'}`,
            background: 'transparent',
            color: theme.toolbar.text, fontSize: 11,
            cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            transition: 'all 0.12s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Sparkles size={12} />
          {t('promptDiff.askAI', '问 AI 分析差异')}
        </button>
      </div>
    </div>
  );
});