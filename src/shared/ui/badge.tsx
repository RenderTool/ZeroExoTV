/**
 * shared/ui/badge - 唯一徽标组件
 *
 * 尺寸恒定（高 18 / 字号 10 / 圆角全圆 / 1px 描边）；只有三种语义色。
 * 业务类型不传色，一律 neutral。
 */

import type { HTMLAttributes, ReactElement } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import { uiBadgeStyle } from './tokens.js';

export type BadgeTone = 'neutral' | 'emphasis' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  theme: ThemeConfig;
  tone?: BadgeTone;
}

export function Badge({ theme, tone = 'neutral', style, children, ...rest }: BadgeProps): ReactElement {
  return (
    <span
      {...rest}
      data-ui-badge=""
      data-badge-tone={tone}
      style={{ ...uiBadgeStyle(theme, tone), ...style }}
    >
      {children}
    </span>
  );
}
