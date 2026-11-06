/**
 * shared/ui/input - 唯一输入框与搜索框
 *
 * 高度 32（紧凑 24）、圆角 8、1px 边框；聚焦时 accent 边框 + 2px 光圈。
 */

import { useState } from 'react';
import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  UI_INPUT_FONT_SIZE,
  UI_INPUT_HEIGHT,
  UI_INPUT_HEIGHT_SM,
  UI_INPUT_PADDING_X,
  UI_INPUT_RADIUS,
  uiInputBg,
  uiInputBorderColor,
  uiInputFocusColor,
} from './tokens.js';

interface InputBaseProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style' | 'size'> {
  theme: ThemeConfig;
  compact?: boolean;
  style?: React.CSSProperties;
  /** 左侧图标（搜索框） */
  icon?: ReactNode;
  /** 外层容器额外样式 */
  wrapperStyle?: React.CSSProperties;
}

function InputFrame({
  theme,
  compact,
  style,
  wrapperStyle,
  icon,
  children,
}: {
  theme: ThemeConfig;
  compact: boolean;
  style?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
  icon?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const [focused, setFocused] = useState(false);
  const accent = uiInputFocusColor(theme);
  return (
    <div
      data-ui-input-frame=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: compact ? UI_INPUT_HEIGHT_SM : UI_INPUT_HEIGHT,
        padding: `0 ${UI_INPUT_PADDING_X}px`,
        boxSizing: 'border-box',
        borderRadius: UI_INPUT_RADIUS,
        border: `1px solid ${focused ? accent : uiInputBorderColor(theme)}`,
        background: uiInputBg(theme),
        boxShadow: focused ? `0 0 0 2px ${accent}2e` : 'none',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        ...style,
        ...wrapperStyle,
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      {icon}
      {children}
    </div>
  );
}

/** 受控搜索框：带搜索图标，容器统一高度/边框/聚焦态 */
export function SearchField({
  theme,
  compact = false,
  icon,
  wrapperStyle,
  ...rest
}: InputBaseProps): React.ReactElement {
  return (
    <InputFrame theme={theme} compact={compact} icon={icon} wrapperStyle={wrapperStyle}>
      <input
        {...rest}
        data-ui-search-input=""
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: UI_INPUT_FONT_SIZE,
          color: theme.toolbar.text,
          fontFamily: 'inherit',
        }}
      />
    </InputFrame>
  );
}

/** 普通文本输入框：与搜索框同一尺寸/边框/聚焦态 */
export function TextField({
  theme,
  compact = false,
  wrapperStyle,
  ...rest
}: InputBaseProps): React.ReactElement {
  return (
    <InputFrame theme={theme} compact={compact} wrapperStyle={wrapperStyle}>
      <input
        {...rest}
        data-ui-text-input=""
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: UI_INPUT_FONT_SIZE,
          color: theme.toolbar.text,
          fontFamily: 'inherit',
        }}
      />
    </InputFrame>
  );
}
