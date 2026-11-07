/**
 * ThumbBadge — 缩略图左上角标签的统一视觉（深色半透明底 + 白字）。
 *
 * 抽屉里所有卡片（资产/主体/历史/开源库）的左上角标签必须用这一款：
 * 之前各自用 shared Badge 的浅色描边，叠在图片上完全看不清。
 */
import type { CSSProperties, HTMLAttributes, ReactElement } from 'react';

const THUMB_BADGE_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  height: 16,
  boxSizing: 'border-box',
  padding: '0 6px',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.62)',
  color: '#fff',
  fontSize: 10,
  fontWeight: 500,
  lineHeight: '16px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

export function ThumbBadge({
  style,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement>): ReactElement {
  return (
    <span {...rest} data-thumb-badge="" style={{ ...THUMB_BADGE_BASE, ...style }}>
      {children}
    </span>
  );
}
