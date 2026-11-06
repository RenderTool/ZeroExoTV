/**
 * AppSidebar - 应用侧边栏导航(桌面端)
 *
 * ⚠️ 重要职责分离:
 * - AppSidebar 仅承载**导航菜单**(Logo / 主页 / 创作 / 画布 / 资产 / 帮助)
 * - 功能按钮(数据目录 / MCP / GitHub / 语言切换 / 换肤)由 AppTopBar 渲染
 *
 * 桌面端:
 * - 固定在左侧(由 AppLayout.layoutBodyStyle flex row 布局控制)
 * - 包含 Logo + 4 个导航按钮 + 底部帮助按钮
 *
 * 移动端:
 * - 不渲染(由 AppLayout 注入的统一 MobileNavButton + MobileNavDrawer 替代)
 * - 移动端导航按钮在右上角
 *
 * 纯图标侧边栏,使用原生 SVG + CSS 动画实现,激活时有描边绘制和发光效果。
 */

import { useState, useCallback } from 'react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { LAYOUT } from '@/shared/components/LAYOUT_CONSTANTS.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { SidebarAnimatedIcon } from './sidebar-animated-icon.js';

export interface AppSidebarProps {
  activeRoute: string;
  onNavigate: (route: 'home' | 'canvas' | 'assets' | 'openlib' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }) => void;
}

export interface NavItem {
  key: string;
  label: string;
  iconType: 'home' | 'canvas' | 'assets' | 'openlib' | 'publicPrompts' | 'policies';
}

export const NAV_ITEMS: NavItem[] = [
  // 本地版（Plan#83 约定）：主页与公共提示词已去掉；首页=画布列表
  { key: 'canvas', label: '项目', iconType: 'canvas' },
  { key: 'assets', label: '资产', iconType: 'assets' },
  // 2026-11-05 任务D 约定：开源资产库入口 = 侧栏图标按钮（与「资产」同级，
  // hover tooltip「开源资产库」），点击进入独立 #/openlib；首页不再放任何开源入口
  { key: 'openlib', label: '开源资产库', iconType: 'openlib' },
];

export function AppSidebar({ activeRoute, onNavigate }: AppSidebarProps): React.ReactElement {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';

  const handleNavigate = useCallback((key: string) => {
    onNavigate(key as 'home' | 'canvas' | 'assets' | 'openlib' | 'publicPrompts' | 'policies');
  }, [onNavigate]);

  const bg = isDark ? 'transparent' : '#ffffff';
  const textColor = theme.toolbar.text;
  const accent = theme.toolbar.accent;

  return (
    <>
      <style>{`
        .zeroexo-sidebar-btn:hover {
          background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'} !important;
        }
        .zeroexo-sidebar-btn.active {
          background: ${accent}18 !important;
          color: ${accent} !important;
        }
        .zeroexo-sidebar-btn.active svg {
          color: ${accent} !important;
        }
        @keyframes zeroexo-sidebar-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }
      `}</style>
      <div style={{
        width: LAYOUT.SIDEBAR_COLLAPSED,
        minWidth: LAYOUT.SIDEBAR_COLLAPSED,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: bg,
        overflow: 'hidden',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        position: 'relative',
        zIndex: 50, // 确保 sidebar 在顶层,不被浮动 header 覆盖
        flexShrink: 0,
      }}>
        {/* ===== Logo ===== */}
        {/* 2026-09-01 约定：LOGO 区 padding 16 → 6，与画布页 TopBar(高48) 的 LOGO 垂直居中(距顶6px)视觉对齐，
            两页 LOGO 规格一致：36×36/r10/图标30 */}
        <div style={{
          padding: '6px 0',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 10,
            color: textColor,
          }}>
            <LogoIcon size={30} />
          </div>
        </div>

        {/* ===== 导航菜单 ===== */}
        <div style={{ flex: 1, padding: '8px 10px', overflow: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeRoute === item.key;
            const isHovered = hoveredKey === item.key;
            // 三语不硬编码：新入口文案走 i18n（既有项沿用原文案不动）
            const label = item.key === 'openlib' ? t('nav.openLib', '开源资产库') : item.label;
            return (
              <Tooltip key={item.key} title={label} placement="right">
                <button
                  type="button"
                  data-testid={`sidebar-nav-${item.key}`}
                  onClick={() => handleNavigate(item.key)}
                  onMouseEnter={() => setHoveredKey(item.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  className={`zeroexo-sidebar-btn ${isActive ? 'active' : ''}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: '100%', height: 40, marginBottom: 4,
                    borderRadius: 10, border: 'none',
                    background: 'transparent',
                    color: isActive ? accent : textColor,
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all .15s',
                  }}
                >
                  <SidebarAnimatedIcon
                    type={item.iconType}
                    size={item.iconType === 'publicPrompts' ? 18 : 20}
                    active={isActive}
                    hovered={isHovered}
                    color={isActive ? accent : textColor}
                    strokeWidth={1.5}
                  />
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* ===== 底部政策公告按钮 ===== */}
        <div style={{
          padding: '10px',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <Tooltip title="政策公告" placement="right">
            <button
              type="button"
              className="zeroexo-sidebar-btn"
              onClick={() => handleNavigate('policies')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: '50%',
                border: 'none', background: 'transparent',
                color: textColor,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all .15s',
              }}
            >
              <SidebarAnimatedIcon
                type="help"
                size={20}
                active={false}
                color={textColor}
                strokeWidth={1.5}
              />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
