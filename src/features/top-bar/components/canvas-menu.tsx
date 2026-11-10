/**
 * CanvasMenu - 画布左上角 Logo 下拉菜单
 *
 * 点击 Logo 弹出下拉列表:
 * ① 回到项目列表
 * ② 创建新项目
 * ③ 拷贝项目(拷贝当前项目副本并打开)
 * ④ 删除本项目
 * 本地版（Plan#83）：无账号体系，原「账号组（用户名 / 退出登录）」已移除。
 * 2026-09-01 约定：语言/配置/快捷键/文档已移至顶栏右侧设置组，本菜单保持为纯「项目」文件菜单。
 *
 * 使用共享 Dropdown 组件,与红色加号列表样式统一。
 */

import { useState, useCallback } from 'react';
import { Home, Plus, Copy, Trash2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import type { ThemeConfig } from '@zeroexo/shared';
import { LogoIcon } from '@/assets/ico/index.js';
import { useReadOnly } from '@/shared/readonly-context.js';

export interface CanvasMenuProps {
  theme: ThemeConfig;
  onHome: () => void;
  onNewProject: () => void;
  /** 打包导出本项目（zip：画布 + 素材 + 副本画布），只读也不拦 */
  onExportProject: () => void;
  onCopyProject: () => void;
  onDeleteProject: () => void;
}

export function CanvasMenu({
  theme,
  onHome,
  onNewProject,
  onExportProject,
  onCopyProject,
  onDeleteProject,
}: CanvasMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);

  const handleHome = useCallback(() => { setOpen(false); onHome(); }, [onHome]);
  const handleNew = useCallback(() => { setOpen(false); onNewProject(); }, [onNewProject]);
  const handleExport = useCallback(() => { setOpen(false); onExportProject(); }, [onExportProject]);
  const handleCopy = useCallback(() => { setOpen(false); onCopyProject(); }, [onCopyProject]);
  const handleDelete = useCallback(() => { setOpen(false); onDeleteProject(); }, [onDeleteProject]);

  const items: MenuProps['items'] = [
    // ── 项目组 ──
    { key: 'home', label: t('menu.backHome'), icon: <Home size={14} />, onClick: handleHome },
    { key: 'new', label: t('menu.newProject'), icon: <Plus size={14} />, onClick: handleNew },
    // 导出是只读操作：只读模式下照常提供（用户要随时备份）
    { key: 'export', label: t('menu.exportProject', '导出项目'), icon: <Download size={14} />, onClick: handleExport },
    // 只读隐藏拷贝/删除（2026-08-25 系统性只读防护）：拷贝项目=创建副本、删除=销毁画布，均属项目级写操作
    ...(!readOnly
      ? [
          { key: 'copy', label: t('menu.copyProject'), icon: <Copy size={14} />, onClick: handleCopy },
          { key: 'delete', label: t('menu.deleteCanvas'), icon: <Trash2 size={14} />, danger: true, onClick: handleDelete },
        ]
      : []),
    // 本地版（Plan#83）：原「账号组（用户名 / 退出登录）」随无账号体系删除
    // 开发阶段不显示版本号 / 构建信息（版本行已下线）
  ];

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      menu={{ items, className: 'canvas-menu-dropdown' }}
    >
      <button
        type="button"
        aria-label={t('topbar.home')}
        style={logoBtnStyle(theme)}
      >
        <LogoIcon size={30} />
      </button>
    </Dropdown>
  );
}

function logoBtnStyle(theme: ThemeConfig): React.CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    // 征集 #87 验收轮二十二:与主页 AppSidebar LOGO 同款(36×36 圆角 10,图标 30)
    width: 36,
    height: 36,
    borderRadius: 10,
    border: 'none',
    background: 'transparent',
    color: theme.toolbar.text,
    cursor: 'pointer',
    transition: 'background 0.15s',
  };
}
