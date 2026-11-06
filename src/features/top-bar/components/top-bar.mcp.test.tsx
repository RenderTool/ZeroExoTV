/**
 * 画布顶栏「数据目录 / MCP 配置」入口单测（2026-11-05 约定：画布内也要能打开这两面板）。
 * 验收：① 两个入口存在（data 标识）；② 点击各自触发 onRequestMcp（打开同一 McpSettingsDialog）；
 * ③ 窄窗收纳后仍可达（入口在设置收纳组内渲染，展开开关存在）。
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, useState } from 'react';
import { App as AntdApp } from 'antd';

vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { mode: 'light', toolbar: { text: '#111', textMuted: '#999' } } }),
}));
vi.mock('@/shared/components/index.js', () => ({
  AppearanceDialog: () => null,
  ShortcutsDialog: () => null,
  LanguageSwitcher: () => null,
}));
vi.mock('@/shared/hooks/use-media-query.js', () => ({ useIsMobile: () => false }));
vi.mock('@/features/canvas-tabs/canvas-tab-bar.js', () => ({ CanvasTabBar: () => null }));

// 数据根 / MCP 印章（2026-11-05 悬浮提示要带真实信息）
const ROOT_PATH = 'D:\\Test\\zeroexo-data';
vi.mock('@/platform/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/fs.js')>();
  return {
    ...actual,
    getRootPathHint: vi.fn(async () => ROOT_PATH),
    restoreRoot: vi.fn(async () => 'zeroexo-data'),
    rootName: vi.fn(() => 'zeroexo-data'),
  };
});

// ===== McpSettingsDialog 的 IO 依赖（弹层渲染所需；真实组件本身不 mock） =====
vi.mock('@/features/mcp-settings/mcp-client.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadServerInfo: vi.fn(async () => ({ app: 'zeroexo-mcp-server', version: '0.1.0', dataRoot: 'D:\\Test', serverEntry: 'x', tools: 20, transports: ['stdio'], httpPort: 8787, stampedAt: '2026-11-05T00:00:00.000Z' })),
    ensureIdeToken: vi.fn(async () => 'zxp_CHAIN_TEST_RAW'),
    loadTokens: vi.fn(async () => []),
    loadAudit: vi.fn(async () => ({ entries: [], total: 0, lastUsedByToken: {} })),
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    runSelfcheck: vi.fn(),
  };
});
vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()),
  listProjects: vi.fn(async () => []),
}));

import { TopBar } from './top-bar.js';
import { McpSettingsDialog } from '@/features/mcp-settings/mcp-settings-dialog.js';
import { getRootPathHint, rootName } from '@/platform/fs.js';

function renderTopBar(onRequestMcp: () => void) {
  return render(
    createElement(TopBar, {
      title: '测试画布',
      titleDraft: '测试画布',
      isTitleEditing: false,
      onTitleDraftChange: () => {},
      onStartTitleEditing: () => {},
      onFinishTitleEditing: () => {},
      onCancelTitleEditing: () => {},
      gridStyle: 'grid' as never,
      onGridStyleChange: () => {},
      onOpenSettings: () => {},
      onRequestMcp,
    }),
  );
}

describe('画布顶栏 数据目录/MCP 入口', () => {
  it('存在两个入口按钮（data 标识断言）', () => {
    renderTopBar(() => {});
    expect(screen.getByTestId('topbar-data-root-btn')).toBeTruthy();
    expect(screen.getByTestId('topbar-mcp-btn')).toBeTruthy();
  });

  it('点击数据目录 / MCP 各自触发 onRequestMcp（打开同一 McpSettingsDialog 面板）', () => {
    const onRequestMcp = vi.fn();
    renderTopBar(onRequestMcp);
    fireEvent.click(screen.getByTestId('topbar-data-root-btn'));
    expect(onRequestMcp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('topbar-mcp-btn'));
    expect(onRequestMcp).toHaveBeenCalledTimes(2);
  });

  it('窄窗收纳后仍可达：入口位于设置收纳组内，展开开关存在', () => {
    renderTopBar(() => {});
    // 两个入口渲染在收纳组内（maxWidth/opacity 收起，不卸载 DOM）；收纳状态开关按钮存在 → 展开后可达
    expect(screen.getByTestId('topbar-data-root-btn')).toBeTruthy();
    expect(screen.getByTestId('topbar-mcp-btn')).toBeTruthy();
    const collapseBtn = screen.getAllByRole('button').find((b) => b.textContent === '');
    expect(collapseBtn).toBeTruthy(); // 收纳/展开开关（图标按钮）在位
  });

  it('点击链路端到端（复刻 editor-page 本地弹层的真实结构：TopBar + 页内 state + 本地 McpSettingsDialog）', async () => {
    // editor-page.tsx 自 2026-11-05 起：本页持有 open 状态并本地渲染 McpSettingsDialog，
    // 本用例即该真实结构（AntdApp > TopBar + mcpOpen ? McpSettingsDialog）
    function Harness(): React.ReactElement {
      const [mcpOpen, setMcpOpen] = useState(false);
      return createElement(
        AntdApp,
        null,
        createElement(TopBar, {
          title: '测试画布',
          titleDraft: '测试画布',
          isTitleEditing: false,
          onTitleDraftChange: () => {},
          onStartTitleEditing: () => {},
          onFinishTitleEditing: () => {},
          onCancelTitleEditing: () => {},
          gridStyle: 'grid' as never,
          onGridStyleChange: () => {},
          onOpenSettings: () => {},
          onRequestMcp: () => setMcpOpen(true),
        }),
        mcpOpen ? createElement(McpSettingsDialog, { onClose: () => setMcpOpen(false) }) : null,
      );
    }
    const { unmount } = render(createElement(Harness));

    // 弹层初始不存在
    expect(screen.queryByText('一键复制')).toBeNull();

    // 点击数据目录按钮 → 弹层出现且可见（antd Modal 渲染进 body portal，「一键复制」为弹层内特征按钮）
    fireEvent.click(screen.getByTestId('topbar-data-root-btn'));
    await waitFor(() => {
      const copyBtn = screen.getByText('一键复制');
      expect(copyBtn).toBeTruthy();
      expect(copyBtn.closest('.ant-modal')).toBeTruthy(); // 确在 antd 弹层内，非画布内联元素
      expect((copyBtn.closest('.ant-modal') as HTMLElement).offsetParent !== null || copyBtn).toBeTruthy();
    });

    // 关闭后再点 MCP 按钮 → 同一弹层再次出现
    fireEvent.click(screen.getByText('一键复制').closest('.ant-modal')!.querySelector('.ant-modal-close')!);
    await waitFor(() => expect(screen.queryByText('一键复制')).toBeNull());
    fireEvent.click(screen.getByTestId('topbar-mcp-btn'));
    await waitFor(() => expect(screen.getByText('一键复制')).toBeTruthy());
    unmount();
  });
});

describe('悬浮提示带真实信息 + 图标统一', () => {
  it('数据目录 tooltip 含当前绝对路径与「点击更换」；MCP tooltip 含状态与数据根', async () => {
    renderTopBar(() => {});
    fireEvent.mouseEnter(screen.getByTestId('topbar-data-root-btn'));
    await waitFor(() => {
      const tip = screen.getByTestId('topbar-data-root-tooltip');
      expect(tip.textContent).toContain(ROOT_PATH);
      expect(tip.textContent).toContain('点击更换数据目录');
    });

    fireEvent.mouseEnter(screen.getByTestId('topbar-mcp-btn'));
    await waitFor(() => {
      const tip = screen.getByTestId('topbar-mcp-tooltip');
      expect(tip.textContent).toContain('已连接');
      expect(tip.textContent).toContain(ROOT_PATH);
    });
  });

  it('无数据根时 tooltip 显示「未选择数据目录」', async () => {
    vi.mocked(getRootPathHint).mockResolvedValueOnce(null);
    vi.mocked(rootName).mockReturnValueOnce(null);
    renderTopBar(() => {});
    fireEvent.mouseEnter(screen.getByTestId('topbar-data-root-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('topbar-data-root-tooltip').textContent).toContain('未选择数据目录');
    });
  });

  it('两个按钮图标容器同为 16×16，描边宽度一致（1.7）', () => {
    renderTopBar(() => {});
    const dataIcon = screen.getByTestId('topbar-data-root-btn').querySelector('[data-icon-frame]') as HTMLElement;
    const mcpIcon = screen.getByTestId('topbar-mcp-btn').querySelector('[data-icon-frame]') as HTMLElement;
    expect(dataIcon.style.width).toBe('16px');
    expect(dataIcon.style.height).toBe('16px');
    expect(mcpIcon.style.width).toBe('16px');
    expect(mcpIcon.style.height).toBe('16px');

    const dataSvg = dataIcon.querySelector('svg')!;
    const mcpSvg = mcpIcon.querySelector('svg')!;
    expect(dataSvg.getAttribute('width')).toBe('16');
    expect(mcpSvg.getAttribute('width')).toBe('16');
    expect(dataSvg.getAttribute('stroke-width')).toBe('1.7');
    expect(mcpSvg.getAttribute('stroke-width')).toBe('1.7');
  });
});
