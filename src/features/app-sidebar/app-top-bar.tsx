/**
 * AppTopBar - 应用顶部栏(桌面端)
 *
 * ⚠️ 重要职责分离:
 * - AppTopBar 仅承载**功能按钮**（数据目录 / MCP / GitHub / 语言切换 / 换肤）
 * - 导航菜单（项目 / 资产）由 AppSidebar 渲染，绝对不要放在这里
 * - 本地版（Plan#83）：无账号体系，账户头像与登录/退出入口已移除
 *
 * 桌面端:
 * - 浮在右上角(由 AppLayout.floatingHeaderStyle 控制)
 * - 不显示导航菜单,只显示功能按钮
 *
 * 移动端:
 * - 不渲染(由 AppLayout 注入的统一 MobileNavButton 替代)
 * - 移动端导航按钮在右上角(MobileNavFloatingWrapper 控制)
 *
 * 设计原则:
 * - 桌面端: 悬浮显示,内容由 features/app-sidebar/AppTopBar 负责
 * - 移动端: 不渲染(避免与 AppLayout 注入的统一移动端导航重复)
 *
 * 开发阶段不显示任何版本号 / 版本迭代记录（顶栏版本徽标与更新日志入口已下线）。
 */

import { useTheme } from '@zeroexo/plugin-theme';
import type { CSSProperties } from 'react';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { TopBarIconButton, TOPBAR_ICON_GAP } from '@/shared/components/topbar-icon-button.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { openServiceCenter } from '@/features/service-center/service-center-events.js';

export interface AppTopBarProps {
  onNavigate: (route: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }) => void;
  activeRoute?: string;
  /** 是否由外部控制"打开换肤"弹窗状态(由 app.tsx 接管) */
  onRequestAppearance?: () => void;
  /** @deprecated 服务入口已合并到 services；保留兼容测试与旧调用 */
  onRequestMcp?: () => void;
}

export function AppTopBar({
  onRequestAppearance,
}: AppTopBarProps): React.ReactElement | null {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  /** 移动端不再渲染本组件(由 AppLayout 的统一 MobileNavButton 替代) */
  if (isMobile) return null;
  const textColor = theme.toolbar.text;

  return (
    <>
    <header style={headerStyle}>
      <div style={innerStyle}>
        <div style={rightSectionStyle}>
          {/* 服务：ComfyUI / MCP / 数据目录 / 插件统一入口 */}
          <TopBarIconButton
            action="services"
            tooltip="服务（ComfyUI / MCP / 数据目录 / 插件）"
            onClick={openServiceCenter}
            className="zeroexo-icon-btn"
            color={textColor}
            testId="services-entry"
          />

          {/* GitHub */}
          <TopBarIconButton
            action="github"
            tooltip="GitHub"
            href="https://github.com/RenderTool/ZeroExoTV"
            target="_blank"
            rel="noopener noreferrer"
            className="zeroexo-icon-btn"
            color={textColor}
          />

          {/* 语言切换 */}
          <LanguageSwitcher theme={theme} />

          {/* 换肤 */}
          <TopBarIconButton
            action="appearance"
            tooltip="外观设置"
            onClick={() => onRequestAppearance?.()}
            className="zeroexo-icon-btn"
            color={textColor}
          />

        </div>
      </div>
    </header>
    </>
  );
}

// ===== 样式 =====

const headerStyle: CSSProperties = {
  height: 'auto',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  pointerEvents: 'auto',
};

const innerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  height: '100%',
};

const rightSectionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: TOPBAR_ICON_GAP,
  justifyContent: 'flex-end',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '8px 12px',
  borderRadius: 12,
  background: 'transparent',
  border: 'none',
};
