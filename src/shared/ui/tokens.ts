/**
 * shared/ui/tokens - 全站徽标 / 卡片 / 按钮 / 输入框唯一取值源
 *
 * 徽标只有三种语义：neutral / emphasis / danger。
 * 业务类型（角色、场景、道具、来源、授权）一律走 neutral，不按类型自定义颜色。
 */

import type { CSSProperties } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';

// ===== 卡片 =====

export const UI_CARD_RADIUS = 12;
export const UI_CARD_BORDER_WIDTH = 1;
export const UI_CARD_GAP = 10;
export const UI_CARD_INFO_PADDING_X = 4;
export const UI_CARD_NAME_SIZE = 12;
export const UI_CARD_NAME_LINE_HEIGHT = '22px';
export const UI_CARD_NAME_WEIGHT = 500;
export const UI_CARD_META_SIZE = 11;
export const UI_CARD_META_WEIGHT = 500;

// ===== 徽标 =====

export const UI_BADGE_HEIGHT = 18;
export const UI_BADGE_FONT_SIZE = 10;
export const UI_BADGE_FONT_WEIGHT = 500;
export const UI_BADGE_LINE_HEIGHT = '16px';
export const UI_BADGE_PADDING_X = 6;
export const UI_BADGE_RADIUS = 999;
export const UI_BADGE_BORDER_WIDTH = 1;

// ===== 按钮 =====

export const UI_BUTTON_RADIUS = 6;
export const UI_BUTTON_SIZE_SM = 24;
export const UI_BUTTON_SIZE_MD = 28;
export const UI_BUTTON_SIZE_LG = 32;
export const UI_BUTTON_FONT_SIZE_SM = 11;
export const UI_BUTTON_FONT_SIZE_MD = 12;
export const UI_BUTTON_FONT_SIZE_LG = 13;

// ===== 输入框 =====

export const UI_INPUT_HEIGHT = 32;
export const UI_INPUT_HEIGHT_SM = 24;
export const UI_INPUT_RADIUS = 8;
export const UI_INPUT_FONT_SIZE = 12;
export const UI_INPUT_PADDING_X = 10;

// ===== 筛选 chip =====

export const UI_CHIP_HEIGHT = 24;
export const UI_CHIP_FONT_SIZE = 11;
export const UI_CHIP_PADDING_X = 8;
export const UI_CHIP_RADIUS = 6;

// ===== 状态点（语义状态色，非业务色） =====

export const UI_STATUS_DOT_SIZE = 7;
export function uiStatusDotColor(theme: ThemeConfig, status: 'draft' | 'wip' | 'done'): string {
  if (status === 'done') return theme.mode === 'dark' ? '#22c55e' : '#16a34a';
  if (status === 'wip') return theme.mode === 'dark' ? '#fbbf24' : '#d97706';
  return theme.toolbar.textMuted;
}

// ===== 颜色 =====

export function uiCardSurface(theme: ThemeConfig): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : '#ffffff';
}

export function uiCardBorderColor(theme: ThemeConfig): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.10)';
}

export function uiCardBorder(theme: ThemeConfig): string {
  return `${UI_CARD_BORDER_WIDTH}px solid ${uiCardBorderColor(theme)}`;
}

export function uiCardSelectedBorder(theme: ThemeConfig): string {
  return `${UI_CARD_BORDER_WIDTH}px solid ${theme.toolbar.accent}`;
}

/** 封面区 hover 遮罩（统一 5% 黑） */
export const UI_CARD_HOVER_OVERLAY = 'rgba(0,0,0,0.05)';

export function uiBadgeStyle(theme: ThemeConfig, tone: 'neutral' | 'emphasis' | 'danger'): CSSProperties {
  const isDark = theme.mode === 'dark';
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    height: UI_BADGE_HEIGHT,
    boxSizing: 'border-box',
    padding: `0 ${UI_BADGE_PADDING_X}px`,
    borderRadius: UI_BADGE_RADIUS,
    borderStyle: 'solid',
    borderWidth: UI_BADGE_BORDER_WIDTH,
    fontSize: UI_BADGE_FONT_SIZE,
    fontWeight: UI_BADGE_FONT_WEIGHT,
    lineHeight: UI_BADGE_LINE_HEIGHT,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };
  if (tone === 'emphasis') {
    return {
      ...base,
      background: `${theme.toolbar.accent}1f`,
      borderColor: `${theme.toolbar.accent}52`,
      color: theme.toolbar.accent,
    };
  }
  if (tone === 'danger') {
    return {
      ...base,
      background: `${theme.toolbar.danger}1f`,
      borderColor: `${theme.toolbar.danger}59`,
      color: theme.toolbar.danger,
    };
  }
  return {
    ...base,
    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
    borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.12)',
    color: theme.toolbar.textMuted,
  };
}

export function uiButtonHeight(size: 'sm' | 'md' | 'lg'): number {
  if (size === 'sm') return UI_BUTTON_SIZE_SM;
  if (size === 'lg') return UI_BUTTON_SIZE_LG;
  return UI_BUTTON_SIZE_MD;
}

export function uiButtonFontSize(size: 'sm' | 'md' | 'lg'): number {
  if (size === 'sm') return UI_BUTTON_FONT_SIZE_SM;
  if (size === 'lg') return UI_BUTTON_FONT_SIZE_LG;
  return UI_BUTTON_FONT_SIZE_MD;
}

export function uiButtonHoverBg(theme: ThemeConfig): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
}

export const UI_OVERLAY_BUTTON_BG = 'rgba(0,0,0,0.45)';
export const UI_OVERLAY_BUTTON_HOVER_BG = 'rgba(0,0,0,0.60)';

export function uiInputBorderColor(theme: ThemeConfig): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.12)';
}

export function uiInputBg(theme: ThemeConfig): string {
  return theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
}

export function uiInputFocusColor(theme: ThemeConfig): string {
  return theme.toolbar.accent;
}

// ===== 卡片文字 =====

export function uiCardNameStyle(theme: ThemeConfig): CSSProperties {
  return {
    fontSize: UI_CARD_NAME_SIZE,
    lineHeight: UI_CARD_NAME_LINE_HEIGHT,
    fontWeight: UI_CARD_NAME_WEIGHT,
    color: theme.toolbar.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

export function uiCardMetaStyle(theme: ThemeConfig): CSSProperties {
  return {
    fontSize: UI_CARD_META_SIZE,
    fontWeight: UI_CARD_META_WEIGHT,
    color: theme.toolbar.textMuted,
  };
}
