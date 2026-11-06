/**
 * StoryboardConnectDiffDialog - 出片连入分镜的校验弹窗（Task3，2026-08-31 约定）
 *
 * 语义：
 * - 出片节点连入分镜前，将「分镜主体树（root+states）」与「出片已有内容」逐行对比，
 *   映射 RowLevelDiffTable 样式（同一列 diff、added/removed/changed 徽章、层级行）。
 * - 无论有无差异都弹出：有差异给用户确认 + 问 AI 协助关联；无差异给视觉肯定。
 * - 用户确认后才完成连入，绝不静默覆盖。
 *
 * 数据输入：subject-tree-diff.ts 产出的 NodeDiffLine[]（状态节点级差异）+ 分镜/出片元信息。
 */
import { memo, useMemo, useState, type ReactElement } from 'react';
import { Modal, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  ArrowRight, Sparkles, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import type { NodeDiffLine } from './subject-tree-diff';
import type { SubjectTree } from './subject-tree-types';

export interface StoryboardConnectDiffDialogProps {
  open: boolean;
  /** 出片要与之连入的分镜节点 id */
  storyboardName?: string;
  /** 分镜主体树（当前引用快照） */
  trees: SubjectTree[];
  /** 出片侧旧内容快照描述（用于「问 AI」上下文） */
  oldContext?: string;
  /** 差异行（由父级调 subject-tree-diff 计算；空数组=无差异） */
  lines: NodeDiffLine[];
  /** 权限：见代码 */
  onCancel: () => void;
  /** 用户确认连入 */
  onConfirm: () => void;
  /** 问 AI 协助关联（父级投递到 Agent 会话） */
  onAskAi?: () => void;
}

/** 徽章文案映射（禁 emoji，纯中文/纯英文由 i18n key 控制） */
const KIND_LABEL_KEY: Record<string, string> = {
  unchanged: 'subjectDiff.unchanged',
  renamed: 'subjectDiff.renamed',
  typeChanged: 'subjectDiff.typeChanged',
  added: 'subjectDiff.added',
  removed: 'subjectDiff.removed',
  promptChanged: 'subjectDiff.promptChanged',
};

type BadgeTone = 'neutral' | 'warn' | 'danger' | 'ok';

const BADGE_TONE: Record<string, BadgeTone> = {
  unchanged: 'neutral',
  renamed: 'warn',
  typeChanged: 'warn',
  promptChanged: 'warn',
  added: 'ok',
  removed: 'danger',
};

function toneColor(kind: BadgeTone, isDark: boolean): string {
  switch (kind) {
    case 'ok': return isDark ? '#34d399' : '#16a34a';
    case 'danger': return isDark ? '#f87171' : '#dc2626';
    case 'warn': return isDark ? '#fbbf24' : '#d97706';
    default: return isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  }
}

function toneBg(kind: BadgeTone, isDark: boolean): string {
  switch (kind) {
    case 'ok': return isDark ? 'rgba(52,211,153,0.15)' : 'rgba(22,163,74,0.1)';
    case 'danger': return isDark ? 'rgba(248,113,113,0.16)' : 'rgba(220,38,38,0.1)';
    case 'warn': return isDark ? 'rgba(251,191,36,0.16)' : 'rgba(217,119,6,0.1)';
    default: return 'transparent';
  }
}

export const StoryboardConnectDiffDialog = memo(function StoryboardConnectDiffDialog({
  open,
  storyboardName,
  trees,
  oldContext,
  lines,
  onCancel,
  onConfirm,
  onAskAi,
}: StoryboardConnectDiffDialogProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const surface = isDark ? '#161616' : '#ffffff';
  const [asking, setAsking] = useState(false);

  const realDiff = useMemo(() => lines.filter((l) => l.kind !== 'unchanged'), [lines]);
  const unchangedCount = lines.length - realDiff.length;
  const hasDiff = realDiff.length > 0;

  // 连入后要注入出片的「新树」快照描述（供问 AI 关联确认上下文）
  const newContext = useMemo(() => {
    return trees
      .map((tree) => `【${tree.kind}·${tree.name}】` + (tree.states.length > 0
        ? tree.states.map((s) => `${s.state}(${s.type},${s.recognitionTerms.length ? `识别语:${s.recognitionTerms.join('/')}` : s.fullPrompt.slice(0, 40)})`).join('；')
        : '（无状态节点）'))
      .join('\n');
  }, [trees]);

  const askAi = () => {
    setAsking(true);
    try {
      onAskAi?.();
    } finally {
      window.setTimeout(() => setAsking(false), 400);
    }
  };

  return (
    <Modal
      open={open}
      width={640}
      centered
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowRight size={15} />
          {t('subjectDiff.connectTitle', '确认连入分镜')}
          {storyboardName ? ` · ${storyboardName}` : ''}
        </span>
      }
      okText={t('subjectDiff.confirm', '确认连入')}
      cancelText={t('subjectDiff.cancel', '取消')}
      onOk={onConfirm}
      onCancel={onCancel}
      footer={(_, { OkBtn, CancelBtn }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            size="small"
            icon={<Sparkles size={12} />}
            loading={asking}
            onClick={askAi}
          >
            {t('subjectDiff.askAi', '问 AI 协助关联')}
          </Button>
          <CancelBtn />
          <OkBtn />
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 摘要条 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
          background: hasDiff
            ? (isDark ? 'rgba(251,191,36,0.1)' : 'rgba(217,119,6,0.08)')
            : (isDark ? 'rgba(52,211,153,0.08)' : 'rgba(22,163,74,0.06)'),
          border: `1px solid ${hasDiff
            ? (isDark ? 'rgba(251,191,36,0.3)' : 'rgba(217,119,6,0.25)')
            : (isDark ? 'rgba(52,211,153,0.25)' : 'rgba(22,163,74,0.2)')}`,
        }}>
          {hasDiff ? <AlertTriangle size={14} style={{ color: toneColor('warn', isDark), flexShrink: 0 }} /> : <CheckCircle2 size={14} style={{ color: toneColor('ok', isDark), flexShrink: 0 }} />}
          <span style={{ fontSize: 12, color: textPrimary, lineHeight: 1.5 }}>
            {hasDiff
              ? t('subjectDiff.hasDiffSummary', { count: realDiff.length, unchanged: unchangedCount, type: '主体树' })
              : t('subjectDiff.noDiffSummary', { type: '主体树' })}
          </span>
        </div>

        {/* RowLevelDiffTable 风格逐行 diff */}
        <div style={{
          border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden',
          background: surface, maxHeight: 300,
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: textMuted, borderBottom: `1px solid ${border}`, width: 90 }}>{t('subjectDiff.colKind', '变化')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: textMuted, borderBottom: `1px solid ${border}` }}>{t('subjectDiff.colState', '状态')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: textMuted, borderBottom: `1px solid ${border}`, width: 90 }}>{t('subjectDiff.colType', '类型')}</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: textMuted, borderBottom: `1px solid ${border}` }}>{t('subjectDiff.colPrompt', '提示词')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 12, color: textMuted, textAlign: 'center' }}>
                    {t('subjectDiff.empty', '分镜暂无主体树可对比')}
                  </td>
                </tr>
              ) : lines.map((line, idx) => (
                <DiffRow key={`${line.key}-${idx}`} line={line} t={t} textMuted={textMuted} textPrimary={textPrimary} isDark={isDark} border={border} />
              ))}
            </tbody>
          </table>
        </div>

        {/* 连入后注入出片的新树快照（问 AI 时的上下文） */}
        {newContext && (
          <div style={{ fontSize: 11, color: textMuted, padding: '6px 10px', borderRadius: 6, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', border: `1px solid ${border}` }}>
            <span style={{ fontWeight: 600 }}>{t('subjectDiff.newContext', '连入后的主体树总览')}:</span>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontFamily: 'monospace' }}>{newContext}</pre>
            {oldContext ? (
              <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontFamily: 'monospace', opacity: 0.7 }}>
                {t('subjectDiff.oldContext', '出片已有内容')}: {oldContext}
              </pre>
            ) : null}
          </div>
        )}
      </div>
    </Modal>
  );
});

function DiffRow({
  line, t, textMuted, textPrimary, isDark, border,
}: {
  line: NodeDiffLine;
  t: TFunction;
  textMuted: string;
  textPrimary: string;
  isDark: boolean;
  border: string;
}): ReactElement {
  const kindKey = (KIND_LABEL_KEY[line.kind] ?? KIND_LABEL_KEY.unchanged) as string;
  const tone = BADGE_TONE[line.kind] ?? 'neutral';
  const bg = line.kind === 'removed'
    ? (isDark ? 'rgba(248,113,113,0.05)' : 'rgba(220,38,38,0.04)')
    : line.kind === 'added'
      ? (isDark ? 'rgba(52,211,153,0.05)' : 'rgba(22,163,74,0.04)')
      : undefined;

  // 提示词单元格：changed/typeChanged 显示新旧两侧（旧删线 + 新高亮）
  const promptCell = (line.kind === 'promptChanged' && line.old?.fullPrompt && line.next?.fullPrompt)
    ? (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ textDecoration: 'line-through', color: toneColor('danger', isDark), opacity: 0.85 }}>{line.old.fullPrompt.slice(0, 60)}</span>
        <span style={{ color: toneColor('ok', isDark) }}>{line.next.fullPrompt.slice(0, 60)}</span>
      </span>
    )
    : (line.next?.fullPrompt ?? line.old?.fullPrompt ?? '');

  const typeCell = (line.kind === 'typeChanged' && line.old?.type && line.next?.type)
    ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ textDecoration: 'line-through', color: toneColor('danger', isDark) }}>{line.old.type}</span>
        <ArrowRight size={10} style={{ color: textMuted }} />
        <span style={{ color: toneColor('ok', isDark) }}>{line.next.type}</span>
      </span>
    )
    : line.type;

  return (
    <tr style={{ background: bg, borderBottom: `1px solid ${border}`, verticalAlign: 'top' }}>
      <td style={{ padding: '6px 10px' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
          color: toneColor(tone, isDark), background: toneBg(tone, isDark), borderRadius: 999, padding: '1px 8px',
        }}>
          {t(kindKey)}
        </span>
        {line.linkedTarget ? (
          <span style={{ display: 'block', marginTop: 3, fontSize: 10, color: textMuted }}>
            {t('subjectDiff.linked', '已关联')}: {line.linkedTarget}
          </span>
        ) : null}
      </td>
      <td style={{ padding: '6px 10px', color: textPrimary, fontWeight: 600 }}>
        {line.kind === 'renamed'
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ textDecoration: 'line-through', color: toneColor('danger', isDark) }}>{line.old?.state}</span><ArrowRight size={10} style={{ color: textMuted }} /><span style={{ color: toneColor('ok', isDark) }}>{line.state}</span></span>
          : line.state}
      </td>
      <td style={{ padding: '6px 10px', color: textPrimary }}>{typeCell}</td>
      <td style={{ padding: '6px 10px', color: textMuted }}>{String(promptCell ?? '').slice(0, 80) || t('subjectDiff.noPrompt', '（无提示词）')}</td>
    </tr>
  );
}