/**
 * shared/ui/chip - 筛选 chip（可点击胶囊）
 *
 * 与徽标同为胶囊形态，但是交互控件：选中态 accent 边框 + 10% 底。
 */

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { UI_CHIP_RADIUS, uiButtonHoverBg } from './tokens.js';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  theme: ThemeConfig;
  selected?: boolean;
  style?: React.CSSProperties;
  children?: ReactNode;
}

export function Chip({
  theme,
  selected = false,
  style,
  children,
  ...rest
}: ChipProps): ReactElement {
  const accent = theme.toolbar.accent;
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      data-ui-chip=""
      data-selected={selected || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        padding: '0 8px',
        fontSize: 11,
        fontWeight: selected ? 600 : 400,
        borderRadius: UI_CHIP_RADIUS,
        border: selected ? `1px solid ${accent}` : '1px solid transparent',
        background: selected ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
        color: selected ? accent : theme.toolbar.textMuted,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition: 'all .15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = uiButtonHoverBg(theme);
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}
