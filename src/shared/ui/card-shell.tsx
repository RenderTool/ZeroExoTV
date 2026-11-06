/**
 * shared/ui/card-shell - 唯一卡片外壳（封面区）
 *
 * 固定圆角 12 / 1px 边框 / 统一底色；hover 与选中态走同一 token；
 * clip=true 时裁切封面内容（图片、视频、缩略图）。
 */

import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  UI_CARD_RADIUS,
  uiCardBorder,
  uiCardSelectedBorder,
  uiCardSurface,
} from './tokens.js';

export interface CardShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  theme: ThemeConfig;
  /** 选中 / 聚焦态：accent 边框 */
  selected?: boolean;
  /** hover 态：accent 边框（不传 selected 时生效） */
  hovered?: boolean;
  /** 是否裁切封面内容，默认 true */
  clip?: boolean;
  children?: ReactNode;
}

export function CardShell({
  theme,
  selected = false,
  hovered = false,
  clip = true,
  style,
  children,
  ...rest
}: CardShellProps): ReactElement {
  return (
    <div
      {...rest}
      data-ui-card-shell=""
      style={{
        position: 'relative',
        borderRadius: UI_CARD_RADIUS,
        overflow: clip ? 'hidden' : 'visible',
        background: uiCardSurface(theme),
        border: selected || hovered ? uiCardSelectedBorder(theme) : uiCardBorder(theme),
        transition: 'border-color .15s ease, box-shadow .15s ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
