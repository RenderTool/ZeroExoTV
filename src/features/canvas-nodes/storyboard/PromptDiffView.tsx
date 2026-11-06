/**
 * PromptDiffView - 提示词「两版对比」词级 diff 组件（Task 4/TextDiffChecker）
 *
 * 纯客户端实现：基于 LCS（最长公共子序列）对提示词做词级对比，
 * 本地计算，不请求 LLM / API。
 * - 被删除的词：删除线 + 红色系强调背景
 * - 新增的词：高亮 + 绿色系背景
 * - 未变部分正常显示（视觉近似 GitHub 代码 diff 的红删绿增）
 * 风格与 StoryboardSubjectTree.tsx 对齐，主题由 @zeroexo/plugin-theme 的 useTheme 获取。
 */
import { Fragment, memo, useMemo, type CSSProperties, type ReactElement } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { GitCompareArrows, CheckCircle2, Info } from 'lucide-react';

export interface PromptDiffViewProps {
  /** 出片旧版 / 上一版提示词 */
  oldPrompt: string;
  /** 新版 / 建议版提示词 */
  newPrompt: string;
  /** 可选标题 */
  title?: string;
}

type OpType = 'equal' | 'remove' | 'add';

interface Op {
  type: OpType;
  token: string;
}

interface DiffSeg {
  type: OpType;
  tokens: string[];
}

/** 按空白切分为词（含标点随词），用于 LCS 对比 */
function tokenize(text: string): string[] {
  return (text || '').match(/\S+/g) ?? [];
}

/**
 * 词级 LCS diff（O(n*m) DP + 回溯）。
 * 返回按类型聚合的连续段，便于渲染出连续的红/绿背景块。
 */
function computeWordDiff(oldText: string, newText: string): DiffSeg[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  // DP 表：dp[i][j] = a[0..i) 与 b[0..j) 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1]!;
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = ai === b[j - 1]! ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // 回溯生成操作序列（逆序，最后统一 reverse）
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', token: a[i - 1]! });
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.push({ type: 'remove', token: a[i - 1]! });
      i--;
    } else {
      ops.push({ type: 'add', token: b[j - 1]! });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: 'remove', token: a[i - 1]! });
    i--;
  }
  while (j > 0) {
    ops.push({ type: 'add', token: b[j - 1]! });
    j--;
  }
  ops.reverse();

  // 相邻同类型聚合为段落
  const segs: DiffSeg[] = [];
  for (const op of ops) {
    const last = segs[segs.length - 1];
    if (last && last.type === op.type) {
      last.tokens.push(op.token);
    } else {
      segs.push({ type: op.type, tokens: [op.token] });
    }
  }
  return segs;
}

export const PromptDiffView = memo(function PromptDiffView({
  oldPrompt,
  newPrompt,
  title,
}: PromptDiffViewProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const border = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)';
  const surface = isDark ? '#161616' : '#ffffff';

  const segs = useMemo(() => computeWordDiff(oldPrompt, newPrompt), [oldPrompt, newPrompt]);
  const hasChanges = useMemo(() => segs.some((s) => s.type !== 'equal'), [segs]);
  const empty = oldPrompt.trim().length === 0 && newPrompt.trim().length === 0;

  const segStyle = (type: OpType): CSSProperties => {
    const base: CSSProperties = {
      padding: '0 3px',
      borderRadius: 4,
      lineHeight: 1.9,
      wordBreak: 'break-word',
    };
    if (type === 'remove') {
      return {
        ...base,
        background: isDark ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.12)',
        color: isDark ? '#f87171' : '#dc2626',
        textDecoration: 'line-through',
        textDecorationColor: 'currentColor',
      };
    }
    if (type === 'add') {
      return {
        ...base,
        background: isDark ? 'rgba(34,197,94,0.18)' : 'rgba(34,197,94,0.12)',
        color: isDark ? '#4ade80' : '#16a34a',
      };
    }
    return { ...base, color: textPrimary };
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      background: surface, border: `1px solid ${border}`, borderRadius: 12,
    }}>
      {/* 顶部标题 + 图例 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        padding: '10px 12px', borderBottom: `1px solid ${border}`,
      }}>
        <GitCompareArrows size={14} style={{ color: textMuted }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title ?? t('promptDiff.diffTitle', '提示词两版对比')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isDark ? '#4ade80' : '#16a34a', background: isDark ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.10)', borderRadius: 999, padding: '1px 8px' }}>
          {t('promptDiff.added', '新增')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: isDark ? '#f87171' : '#dc2626', background: isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.10)', borderRadius: 999, padding: '1px 8px' }}>
          {t('promptDiff.removed', '删除')}
        </span>
      </div>

      {/* diff 内容区 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px' }}>
        {empty ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: textMuted, fontSize: 12 }}>
            <Info size={14} />
            {t('promptDiff.empty', '暂无提示词可对比')}
          </div>
        ) : !hasChanges ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: textMuted, fontSize: 12 }}>
            <CheckCircle2 size={14} />
            {t('promptDiff.noChanges', '两版提示词无差异')}
          </div>
        ) : (
          <div style={{ fontSize: 12, fontFamily: 'monospace', whiteSpace: 'normal' }}>
            {segs.map((seg, idx) => (
              <Fragment key={idx}>
                <span style={segStyle(seg.type)}>{seg.tokens.join(' ')}</span>
                {idx < segs.length - 1 ? ' ' : null}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});