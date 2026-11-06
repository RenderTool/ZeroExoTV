/**
 * TopBar - 顶部工具栏容器(画布编辑器专用)
 *
 * 左侧:LOGO 下拉(征集 #91:层级/资产按钮迁至底部工具栏小地图旁,LOGO 旁分割线删除);
 * 右侧:可编辑标题(compact 13px 右对齐)+ 外观设置 + 语言/配置 + 版本快照。
 * 本地版（Plan#83）：协作与 Agent 入口已随两条链路移除；账号信息与退出登录在左上角 CanvasMenu。
 * 主题由 useTheme() 注入;外观浮层开关内部管理;设置弹窗由父组件控制(通过 onOpenSettings)。
 * 左侧 padding 预留 CanvasControls(左上角竖向控件)的宽度,避免重叠。
 *
 * 移动端仅渲染层级按钮 + 标题 + 同步徽标(精简视图);
 * 移动端导航抽屉(MobileNavDrawer)改由 EditorPage 注入,统一与主页/创作/画布列表保持一致。
 */

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Badge, Tooltip } from 'antd';
import type { GridStyle } from '@/shared/components/index.js';
import {
  AppearanceDialog,
  ShortcutsDialog,
  LanguageSwitcher,
} from '@/shared/components/index.js';
import { TopBarIconButton, TOPBAR_ICON_GAP } from '@/shared/components/topbar-icon-button.js';
import type { ShortcutEntry } from '@zeroexo/plugin-keyboard';
import { getRootPathHint, restoreRoot, rootName } from '@/platform/fs.js';
import { loadServerInfo } from '@/features/mcp-settings/mcp-client.js';
import { TitleEditor } from './title-editor.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { CanvasTabBar } from '@/features/canvas-tabs/canvas-tab-bar.js';
import { ComfyuiConnectButton } from '@/features/canvas-tabs/comfyui-connect-button.js';

/** 路径中间省略：超长时保留头尾，完整路径仍在 tooltip 内可看 */
export function middleEllipsis(value: string, max = 44): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/** 设置组展开状态持久化 key（localStorage） */
const UTILS_EXPANDED_KEY = 'zeroexo:topbar-utils-expanded';

export interface TopBarProps {
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  /** 标题是否可编辑(参与者只读,默认 true) */
  titleEditable?: boolean;
  onTitleDraftChange: (v: string) => void;
  onStartTitleEditing: () => void;
  onFinishTitleEditing: () => void;
  onCancelTitleEditing: () => void;
  /** 网格样式(由 AppearancePanel 控制,透传给 CanvasView) */
  gridStyle: GridStyle;
  onGridStyleChange: (style: GridStyle) => void;
  /** 打开设置弹窗 */
  onOpenSettings: () => void;
  /** 快捷键注册表（2026-09-01：快捷键入口自 LOGO 下拉移至顶栏设置组） */
  keyboardShortcuts?: readonly ShortcutEntry[];
  /** 隐藏桌面端页签条（2026-09-01 约定：页签随画布走，editor-page 移到画布区上方渲染）
   * @deprecated 2026-11-04 单例槽位改造：四个固定页签常驻顶栏水平居中，不再支持隐藏；保留 prop 仅为兼容调用方签名 */
  hideTabBar?: boolean;
  isMobile?: boolean;
  /** 云同步状态徽章(渲染在标题右侧,垂直居中对齐) */
  syncBadge?: React.ReactNode;
  /** LOGO下拉菜单(画布编辑器左上角,桌面端显示) */
  canvasMenu?: React.ReactNode;
  /** 移动端导航按钮打开 */
  onMobileNavOpen?: () => void;
  /** 层级/资产抽屉(资产任何时刻可打开,2026-08-29 迁至标题旁) */
  isHierarchyOpen?: boolean;
  onToggleHierarchy?: () => void;
  /** 打开「MCP 配置/数据目录」面板（复用全局 McpSettingsDialog：数据目录授权/绝对路径 + MCP 配置一键复制） */
  onRequestMcp?: () => void;
}

export function TopBar({
  title,
  titleDraft,
  isTitleEditing,
  titleEditable = true,
  onTitleDraftChange,
  onStartTitleEditing,
  onFinishTitleEditing,
  onCancelTitleEditing,
  isMobile,
  syncBadge,
  canvasMenu,
  gridStyle,
  onGridStyleChange,
  onOpenSettings,
  isHierarchyOpen,
  onToggleHierarchy,
  keyboardShortcuts,
  onRequestMcp,
}: TopBarProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isMobileAuto = useIsMobile();
  const mobile = isMobile ?? isMobileAuto;
  // 本地版（Plan#83）：无协作与内置 Agent，未读红点的状态源（pendingApprovals/newMemberCount/unreadMessages/agentUnread）整体移除
  // 外观设置弹窗(高频操作,自 LOGO 下拉移回顶栏:2026-08-29 约定)
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // 快捷键弹窗(2026-09-01:快捷键入口自 LOGO 下拉移至顶栏设置组)
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // 设置组展开/收纳(2026-09-01 约定:点击水平展开、再点收纳,非下拉;状态持久化,按需展开)
  const [utilsOpen, setUtilsOpen] = useState(() => {
    try { return localStorage.getItem(UTILS_EXPANDED_KEY) === '1'; } catch { return false; }
  });
  const toggleUtils = useCallback(() => {
    setUtilsOpen((v) => {
      const next = !v;
      try { localStorage.setItem(UTILS_EXPANDED_KEY, next ? '1' : '0'); } catch { /* 隐私模式等忽略 */ }
      return next;
    });
  }, []);

  // 2026-11-05 「悬浮提示带真实信息」：数据根绝对路径（FSA 无盘符时用已持久化的用户填写值）+ MCP 服务状态。
  // 数据根：优先用户登记的绝对路径 → 已授权目录名 → 未选择（null）。
  const [dataRootPath, setDataRootPath] = useState<string | null>(null);
  const [mcpReady, setMcpReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [hint, info] = await Promise.all([
        getRootPathHint().catch(() => null),
        loadServerInfo().catch(() => null),
      ]);
      await restoreRoot(false).catch(() => null);
      if (!alive) return;
      setDataRootPath(hint || rootName() || null);
      setMcpReady(info !== null);
    })();
    return () => { alive = false; };
  }, []);

  const dataPathLabel = dataRootPath ?? '未选择数据目录';
  const dataRootTooltip = (
    <div data-testid="topbar-data-root-tooltip" style={{ maxWidth: 320 }}>
      <div style={{ wordBreak: 'break-all' }}>{middleEllipsis(dataPathLabel)}</div>
      {dataRootPath && dataPathLabel.length > 44 && (
        // 中间省略后的完整路径（小字、可换行）
        <div style={{ fontSize: 11, opacity: 0.72, wordBreak: 'break-all' }}>{dataPathLabel}</div>
      )}
      <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>
        {dataRootPath ? '点击更换数据目录' : '点击选择数据目录'}
      </div>
    </div>
  );

  const mcpTooltip = (
    <div data-testid="topbar-mcp-tooltip" style={{ maxWidth: 320 }}>
      <div>MCP 服务：{mcpReady ? '已连接' : '未配置'}</div>
      <div style={{ fontSize: 11, opacity: 0.72, wordBreak: 'break-all' }}>
        数据根：{middleEllipsis(dataPathLabel)}
      </div>
    </div>
  );

  // 2026-09-01 约定：桌面端高 48——LOGO 按钮 36×36/r10/图标30 与主页同规格、水平距左 12 同主页，
  // 但垂直留白收紧（用户二次拍板：Head 占比过多，内容区优先；放弃主页 68px 的 LOGO 区高度照搬）
  // 移动端保持 45
  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: mobile ? 45 : 48,
    padding: mobile ? '0 12px' : '0 16px 0 12px',
    background: 'transparent',
    borderBottom: 'none',
    position: 'relative', // 2026-11-04：为水平居中的固定槽位页签条提供定位基准
  };

  const leftStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: mobile ? 8 : 12,
    minWidth: 0,
  };

  const rightStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: TOPBAR_ICON_GAP,
    position: 'relative',
  };

  /** 可编辑标题(compact 13px;桌面端右侧组,移动端居中容器) */
  const titleEditor = (
    <TitleEditor
      compact
      theme={theme}
      title={title}
      titleDraft={titleDraft}
      isTitleEditing={isTitleEditing}
      editable={titleEditable}
      onTitleDraftChange={onTitleDraftChange}
      onStartTitleEditing={onStartTitleEditing}
      onFinishTitleEditing={onFinishTitleEditing}
      onCancelTitleEditing={onCancelTitleEditing}
    />
  );

  return (
    <>
    <div style={barStyle}>
      <div style={leftStyle}>
        {!mobile && canvasMenu}
        {/* 征集 #92 T26 验收修正二(约定):标题放 LOGO 旁(左侧),保存状态条(syncBadge,含「已保存」)放标题旁边 */}
        {!mobile && (
          <>
            {titleEditor}
            {/* 资产(任何时刻可打开,2026-08-29 迁至标题旁) */}
            {onToggleHierarchy && (
              <TopBarIconButton
                action="hierarchy"
                tooltip={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')}
                onClick={onToggleHierarchy}
                color={isHierarchyOpen ? theme.toolbar.accent : theme.toolbar.text}
              />
            )}
            {syncBadge}
          </>
        )}
        {/* 2026-11-04 单例槽位改造（推翻 2026-09-01 "页签随画布走"）：
            四个固定槽位页签（剧本/分镜/出片/画布）回到顶栏并水平居中（绝对定位，不受左右两组宽度影响）。
            页签不再可关闭/新增，仅切换 + 拖拽重排。 */}
        {!mobile && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              // 不挡左右两组的鼠标事件（页签条自身仍接收事件）
              pointerEvents: 'none',
            }}
          >
            <div style={{ pointerEvents: 'auto' }}>
              <CanvasTabBar />
            </div>
          </div>
        )}
      </div>
      {/* 移动端:标题 + 同步徽标居中(征集 #87 验收轮十八);页签条同行(标题旁,占剩余空间) */}
      {mobile && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
          {titleEditor}
          {onToggleHierarchy && (
            <TopBarIconButton
              action="hierarchy"
              tooltip={t(isHierarchyOpen ? 'canvasControls.hierarchyOpen' : 'canvasControls.hierarchyClosed')}
              onClick={onToggleHierarchy}
              color={isHierarchyOpen ? theme.toolbar.accent : theme.toolbar.text}
            />
          )}
          {syncBadge}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <CanvasTabBar />
          </div>
        </div>
      )}
      <div style={rightStyle}>
        {/* 协作 + Agent(桌面端;账号/退出已移入左上角 CanvasMenu) */}
        {!mobile && (
          <>
            {/* 设置组：水平展开/收纳（2026-09-01 约定，替代原 LOGO 下拉的视图/帮助组）。
                收起态仅一个开关按钮；点击水平展开 外观/语言/配置/快捷键/协作，再点收纳。
                展开状态持久化（UTILS_EXPANDED_KEY）；Agent 排除在外保持常驻。 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: TOPBAR_ICON_GAP,
                overflow: 'hidden',
                maxWidth: utilsOpen ? 260 : 0,
                opacity: utilsOpen ? 1 : 0,
                transition: 'max-width 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s',
              }}
            >
              {/* 外观(主题切换,2026-08-29 移回顶栏;与主页顶栏共用同一图标) */}
              <TopBarIconButton
                action="appearance"
                tooltip={t('topbar.appearance')}
                onClick={() => setAppearanceOpen(true)}
                color={theme.toolbar.text}
              />
              {/* 语言(主页同款 LanguageSwitcher:Globe 图标 → LanguageDialog 居中弹窗) */}
              <LanguageSwitcher theme={theme} />
              {/* 配置(画布设置弹窗) */}
              <TopBarIconButton
                action="settings"
                tooltip={t('settings.title')}
                onClick={onOpenSettings}
                color={theme.toolbar.text}
              />
              {/* 快捷键 */}
              <TopBarIconButton
                action="shortcuts"
                tooltip={t('menu.shortcuts')}
                onClick={() => setShortcutsOpen(true)}
                color={theme.toolbar.text}
              />
              {/* 数据目录（2026-11-05 约定：画布内也要能打开数据目录/MCP 面板；与管理页同一 McpSettingsDialog） */}
              <TopBarIconButton
                action="dataRoot"
                tooltip={dataRootTooltip}
                testId="topbar-data-root-btn"
                onClick={onRequestMcp}
                color={theme.toolbar.text}
              />
              {/* MCP 配置（同一面板：数据目录 + MCP 配置一键复制） */}
              <TopBarIconButton
                action="mcp"
                tooltip={mcpTooltip}
                testId="topbar-mcp-btn"
                onClick={onRequestMcp}
                color={theme.toolbar.text}
              />
              {/* 本地版（Plan#83）：协作入口随 collaboration 链路移除 */}
            </div>
            {/* 展开/收纳开关 */}
            <Tooltip title={utilsOpen ? t('topbar.utilsCollapse', '收纳') : t('topbar.utilsExpand', '展开')}>
              <Badge
                count={0}
                size="small"
                overflowCount={99}
                offset={[2, -2]}
              >
                <TopBarIconButton
                  action={utilsOpen ? 'expand' : 'collapse'}
                  onClick={toggleUtils}
                  color={theme.toolbar.text}
                />
              </Badge>
            </Tooltip>
            {/* 本地版（Plan#83）：Agent 面板开关随 canvas-agent 链路移除 */}
            {/* ComfyUI 全局唯一入口（地址只在此处配置；导演台等其他功能从这里读） */}
            <ComfyuiConnectButton />
          </>
        )}
      </div>

    </div>

    {/* 外观设置弹窗(高频操作,2026-08-29 移回顶栏) */}
    {appearanceOpen ? (
      <AppearanceDialog
        theme={theme}
        currentMode={theme.mode}
        gridStyle={gridStyle}
        onGridStyleChange={onGridStyleChange}
        onClose={() => setAppearanceOpen(false)}
      />
    ) : null}
    {/* 快捷键弹窗(2026-09-01:入口自 LOGO 下拉移至顶栏设置组) */}
    {shortcutsOpen ? (
      <ShortcutsDialog
        theme={theme}
        onClose={() => setShortcutsOpen(false)}
        shortcuts={keyboardShortcuts}
      />
    ) : null}
    </>
  );
}
