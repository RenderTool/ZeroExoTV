/**
 * capsule-tabs - 通用胶囊分段控件（抽屉素材「全局 / 本项目」同款视觉）
 *
 * 由 scope-capsule-tabs 抽出：容器深色 #1a1a1a / 浅色 rgba(0,0,0,.05)、
 * border-radius 10、padding 3、gap 2；选中块深色 rgba(255,255,255,.10)（浅色 #fff）
 * + 0 1px 2px 轻投影；每段右侧带实时数量徽标。
 * 2026-11-07：抽屉「历史」按来源分 Tab（从画布生成 / 从导演台）复用同一控件，
 * 保证两处切换交互与视觉完全一致，不另造一套样式。
 */

import type { ThemeConfig } from '@zeroexo/shared';

export interface CapsuleSegment {
  key: string;
  label: string;
  /** null / 缺省 = 尚未加载 → 不显示徽标（不假称 0） */
  count?: number | null;
  disabled?: boolean;
  disabledHint?: string;
}

export interface CapsuleTabsProps {
  value: string;
  onChange: (key: string) => void;
  segments: readonly CapsuleSegment[];
  theme: ThemeConfig;
  /** 测试标识；scope-capsule-tabs 缺省时沿用旧值，不影响既有断言 */
  testId?: string;
}

export function CapsuleTabs({ value, onChange, segments, theme, testId = 'scope-capsule-tabs' }: CapsuleTabsProps): React.ReactElement {
  const isDark = theme.mode === 'dark';
  return (
    <div
      data-testid={testId}
      role="tablist"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        borderRadius: 10,
        background: isDark ? '#1a1a1a' : 'rgba(0,0,0,0.05)',
        flexShrink: 0,
      }}
    >
      {segments.map((seg) => {
        const active = value === seg.key;
        const disabled = !!seg.disabled;
        return (
          <button
            key={seg.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            data-scope={seg.key}
            data-active={active || undefined}
            disabled={disabled}
            title={disabled ? seg.disabledHint : seg.label}
            onClick={() => { if (!disabled) onChange(seg.key); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              height: 26,
              padding: '0 12px',
              border: 'none',
              borderRadius: 8,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              whiteSpace: 'nowrap',
              background: active ? (isDark ? 'rgba(255,255,255,0.10)' : '#ffffff') : 'transparent',
              boxShadow: active ? `0 1px 2px ${isDark ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.12)'}` : 'none',
              color: disabled
                ? theme.toolbar.textMuted
                : active ? theme.toolbar.text : theme.toolbar.textMuted,
              opacity: disabled ? 0.45 : 1,
              transition: 'all 0.15s',
            }}
          >
            {seg.label}
            {seg.count !== null && seg.count !== undefined && (
              <span
                data-scope-count={seg.key}
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  padding: '0 5px',
                  borderRadius: 999,
                  fontVariantNumeric: 'tabular-nums',
                  background: active
                    ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)')
                    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
                  color: active ? theme.toolbar.text : theme.toolbar.textMuted,
                }}
              >
                {seg.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
