/**
 * topbar-icon-button — 顶栏图标按钮的唯一来源
 *
 * 主页顶栏(features/app-sidebar/AppTopBar)与画布顶栏(features/top-bar/TopBar)
 * 共用本模块：同一动作只对应一个图标，图标统一 16px、描边统一 1.7、
 * 按钮统一 32×32 且 padding 为 0，间距统一 TOPBAR_ICON_GAP。
 */

import type { CSSProperties, ReactNode } from 'react';
import { Button as AntdButton, Tooltip } from 'antd';
import {
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Github,
  Keyboard,
  Languages,
  PanelsTopLeft,
  Plug,
  PlugZap,
  SquareMousePointer,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';

/** 顶栏图标尺寸(固定 16) */
export const TOPBAR_ICON_SIZE = 16;

/** 顶栏图标描边宽度(固定 1.7,两处顶栏共用) */
export const TOPBAR_ICON_STROKE = 1.7;

/** 顶栏图标按钮外框尺寸(固定 32×32) */
export const TOPBAR_BUTTON_SIZE = 32;

/** 顶栏图标按钮之间的水平间距 */
export const TOPBAR_ICON_GAP = 6;

/** 顶栏动作 → 图标(同一动作两处顶栏必须取同一项) */
export const TOPBAR_ICONS = {
  dataRoot: FolderOpen,
  mcp: Plug,
  comfyui: PlugZap,
  appearance: SunMoon,
  language: Languages,
  github: Github,
  shortcuts: Keyboard,
  settings: SquareMousePointer,
  hierarchy: PanelsTopLeft,
  collapse: ChevronsLeft,
  expand: ChevronsRight,
} satisfies Record<string, LucideIcon>;

export type TopBarAction = keyof typeof TOPBAR_ICONS;

/** 顶栏图标按钮外框样式(32×32,padding 0,内容居中) */
export const topBarButtonStyle: CSSProperties = {
  width: TOPBAR_BUTTON_SIZE,
  height: TOPBAR_BUTTON_SIZE,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: TOPBAR_ICON_SIZE,
};

export interface TopBarIconProps {
  action: TopBarAction;
}

/** 统一图标外框:16×16 容器 + 统一描边,两处顶栏渲染结果一致 */
export function TopBarIcon({ action }: TopBarIconProps): React.ReactElement {
  const Icon = TOPBAR_ICONS[action];
  return (
    <span
      data-icon-frame={TOPBAR_ICON_SIZE}
      data-icon-kind={action}
      style={{
        width: TOPBAR_ICON_SIZE,
        height: TOPBAR_ICON_SIZE,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
      }}
    >
      <Icon size={TOPBAR_ICON_SIZE} strokeWidth={TOPBAR_ICON_STROKE} />
    </span>
  );
}

export interface TopBarIconButtonProps {
  action: TopBarAction;
  tooltip?: ReactNode;
  onClick?: () => void;
  href?: string;
  target?: string;
  rel?: string;
  danger?: boolean;
  /** 图标颜色(默认继承按钮,调用方按主题注入) */
  color?: string;
  className?: string;
  ariaLabel?: string;
  testId?: string;
}

/** 顶栏图标按钮:统一 32×32 + 16px 图标 + 可选 Tooltip */
export function TopBarIconButton({
  action,
  tooltip,
  onClick,
  href,
  target,
  rel,
  danger,
  color,
  className,
  ariaLabel,
  testId,
}: TopBarIconButtonProps): React.ReactElement {
  const button = (
    <AntdButton
      type="text"
      danger={danger}
      href={href}
      target={target}
      rel={rel}
      aria-label={ariaLabel}
      data-testid={testId}
      className={className}
      onClick={onClick}
      style={color ? { ...topBarButtonStyle, color } : topBarButtonStyle}
      icon={<TopBarIcon action={action} />}
    />
  );
  return tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button;
}
