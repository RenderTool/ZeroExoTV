/**
 * shared/ui/buttons - 唯一图标按钮与文本按钮
 *
 * 尺寸档位 sm(24) / md(28) / lg(32)，圆角 6；hover 底色由 token 给出。
 */

import { forwardRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  UI_BUTTON_RADIUS,
  UI_OVERLAY_BUTTON_BG,
  UI_OVERLAY_BUTTON_HOVER_BG,
  uiButtonFontSize,
  uiButtonHeight,
  uiButtonHoverBg,
} from './tokens.js';

type ButtonSize = 'sm' | 'md' | 'lg';

interface BaseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  theme: ThemeConfig;
  size?: ButtonSize;
  style?: React.CSSProperties;
  children?: ReactNode;
}

export interface IconButtonProps extends BaseButtonProps {
  /** ghost = 透明底 + hover 底色；overlay = 封面上的半透明黑底 */
  variant?: 'ghost' | 'overlay';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  theme,
  size = 'md',
  variant = 'ghost',
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}, ref): ReactElement {
  const [hovered, setHovered] = useState(false);
  const height = uiButtonHeight(size);
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? 'button'}
      data-ui-icon-button=""
      data-button-size={size}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: height,
        height,
        padding: 0,
        border: 'none',
        borderRadius: UI_BUTTON_RADIUS,
        background: hovered
          ? (variant === 'overlay' ? UI_OVERLAY_BUTTON_HOVER_BG : uiButtonHoverBg(theme))
          : (variant === 'overlay' ? UI_OVERLAY_BUTTON_BG : 'transparent'),
        color: variant === 'overlay' ? '#fff' : 'inherit',
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        transition: 'background .15s, opacity .2s',
        ...style,
      }}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
});

export interface TextButtonProps extends BaseButtonProps {
  variant?: 'secondary' | 'primary' | 'danger' | 'ghost';
  /** 选中态（筛选类按钮）：accent 边框 + 10% accent 底 */
  selected?: boolean;
}

interface TextPalette {
  border: string;
  background: string;
  color: string;
  hover: string;
}

export function TextButton({
  theme,
  size = 'md',
  variant = 'secondary',
  selected = false,
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: TextButtonProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  const accent = theme.toolbar.accent;
  const danger = theme.toolbar.danger;
  const height = uiButtonHeight(size);

  const palette: TextPalette = variant === 'primary'
    ? { border: 'none', background: accent, color: '#fff', hover: `${accent}dd` }
    : variant === 'danger'
      ? {
        border: `1px solid color-mix(in srgb, ${danger} 35%, transparent)`,
        background: `color-mix(in srgb, ${danger} 10%, transparent)`,
        color: danger,
        hover: `color-mix(in srgb, ${danger} 18%, transparent)`,
      }
      : variant === 'ghost'
        ? { border: 'none', background: 'transparent', color: theme.toolbar.text, hover: uiButtonHoverBg(theme) }
        : {
          border: `1px solid ${theme.toolbar.border}`,
          background: 'transparent',
          color: theme.toolbar.text,
          hover: uiButtonHoverBg(theme),
        };

  const selectedPalette: TextPalette = {
    border: `1px solid ${accent}`,
    background: `color-mix(in srgb, ${accent} 10%, transparent)`,
    color: accent,
    hover: `color-mix(in srgb, ${accent} 16%, transparent)`,
  };
  const active = selected ? selectedPalette : palette;

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      data-ui-text-button=""
      data-button-size={size}
      data-selected={selected || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height,
        padding: `0 ${size === 'sm' ? 8 : 12}px`,
        border: active.border,
        borderRadius: UI_BUTTON_RADIUS,
        background: hovered ? active.hover : active.background,
        color: active.color,
        fontSize: uiButtonFontSize(size),
        fontWeight: selected ? 600 : 500,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.5 : 1,
        transition: 'background .15s, border-color .15s, color .15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        setHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}
