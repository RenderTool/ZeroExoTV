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

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { LanguageSwitcher } from '@/shared/components/language-switcher.js';
import { TopBarIconButton, TOPBAR_ICON_GAP } from '@/shared/components/topbar-icon-button.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { restoreRoot, rootName } from '@/platform/fs.js';
import { activateRoot } from '@/platform/root-flow.js';

export interface AppTopBarProps {
  onNavigate: (route: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }) => void;
  activeRoute?: string;
  /** 是否由外部控制"打开换肤"弹窗状态(由 app.tsx 接管) */
  onRequestAppearance?: () => void;
  /** 打开 MCP 服务配置 */
  onRequestMcp?: () => void;
}

export function AppTopBar({
  onRequestAppearance,
  onRequestMcp,
}: AppTopBarProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  // 数据目录授权状态（本地版唯一数据落点）
  const [dataRoot, setDataRoot] = useState<string | null>(() => rootName());

  useEffect(() => {
    void restoreRoot(false).then((name) => setDataRoot(name));
  }, []);

  const handlePickRoot = useCallback(async () => {
    const outcome = await activateRoot({ migrate: false });
    if (outcome.status === 'error') message.error(`选择数据目录失败：${outcome.message}`);
    // ok 分支会整页刷新（驱动必须重建）；cancelled 保持原状
  }, [message]);

  /** 移动端不再渲染本组件(由 AppLayout 的统一 MobileNavButton 替代) */
  if (isMobile) return null;
  const textColor = theme.toolbar.text;

  return (
    <>
    <header style={headerStyle}>
      <div style={innerStyle}>
        <div style={rightSectionStyle}>
          {/* 数据目录 */}
          <TopBarIconButton
            action="dataRoot"
            tooltip={dataRoot ? `数据目录：${dataRoot}` : '选择数据目录'}
            danger={!dataRoot}
            onClick={handlePickRoot}
            className="zeroexo-icon-btn"
            color={textColor}
          />

          {/* MCP 服务配置 */}
          <TopBarIconButton
            action="mcp"
            tooltip="MCP 服务配置"
            onClick={() => onRequestMcp?.()}
            className="zeroexo-icon-btn"
            color={textColor}
            testId="mcp-entry"
          />

          {/* GitHub */}
          <TopBarIconButton
            action="github"
            tooltip="GitHub"
            href="https://github.com/RenderTool/zeroexo-platform-infinite-canvas"
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
