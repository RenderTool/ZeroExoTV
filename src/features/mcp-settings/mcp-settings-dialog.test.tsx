/**
 * MCP 设置页 UI 单测(一键复制版,2026-11-05)
 *
 * 验收覆盖:
 * 1. 首屏存在「一键复制」按钮;复制内容为合法 JSON 且含 command/args/env(token 已注入)
 * 2. 首次无 token 时自动生成并注入配置(无需先手动新建)
 * 3. 默认无技术说明文案:stdio/Bearer/Authorization/审计/自检等术语在 DOM 中出现 0 次(高级区折叠且懒渲染)
 * 4. 远程(HTTP)配置折进「高级选项」,展开后可见
 * 5. 密钥管理:原文仅显示一次、撤销后标记
 *
 * mcp-client 的 IO 函数全部 mock;buildStdioConfig/ensureIdeToken 等纯逻辑保留真实实现
 * (ensureIdeToken 内部走 mock 的 loadTokens/createToken + jsdom 真实 localStorage)。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { App as AntdApp } from 'antd';

// ===== hoisted mocks =====
const clientMock = vi.hoisted(() => ({
  loadServerInfo: vi.fn(async () => ({
    app: 'zeroexo-mcp-server',
    version: '0.1.0',
    dataRoot: 'D:\\Test',
    serverEntry: 'D:\\AICode\\zeroexo\\zeroexo-comfyui\\mcp-server\\dist\\index.js',
    tools: 20,
    transports: ['stdio', 'streamable-http'],
    httpPort: 8787,
    stampedAt: '2026-11-04T00:00:00.000Z',
  })),
  ensureIdeToken: vi.fn(async () => 'zxp_AUTO_GENERATED_RAW'),
  loadTokens: vi.fn(),
  loadAudit: vi.fn(async () => ({ entries: [], total: 0, lastUsedByToken: {} })),
  createToken: vi.fn(async () => ({
    record: { id: 'tok-new', hash: 'x'.repeat(64), prefix: 'zxp', projectIds: '*', bits: ['project.read'], createdAt: '2026-11-04T01:00:00.000Z' },
    raw: 'zxp_AUTO_GENERATED_RAW',
  })),
  revokeToken: vi.fn(async (_id: string) => {}),
  runSelfcheck: vi.fn(async () => ({ ok: false, reason: '数据目录未授权:No available storage method found' })),
}));

vi.mock('./mcp-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mcp-client.js')>();
  return {
    ...actual,
    loadServerInfo: clientMock.loadServerInfo,
    ensureIdeToken: clientMock.ensureIdeToken,
    loadTokens: clientMock.loadTokens,
    loadAudit: clientMock.loadAudit,
    createToken: clientMock.createToken,
    revokeToken: clientMock.revokeToken,
    runSelfcheck: clientMock.runSelfcheck,
  };
});

vi.mock('@zeroexo/plugin-theme', () => ({
  useTheme: () => ({ theme: { mode: 'light', toolbar: { text: '#111', textMuted: '#999' } } }),
}));

vi.mock('@zeroexo/plugin-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zeroexo/plugin-persistence')>()),
  listProjects: vi.fn(async () => [{ id: 'p1', title: '项目一' }]),
}));

import { McpSettingsDialog } from './mcp-settings-dialog.js';
import type { ServerInfo, TokenRecord } from './mcp-client.js';

const writeText = vi.fn(async () => {});
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

let tokensState: TokenRecord[] = [];

beforeEach(() => {
  tokensState = [];
  localStorage.clear();
  clientMock.loadTokens.mockImplementation(async () => tokensState.map((t) => ({ ...t }))); // 新引用,确保 React 重渲染
  clientMock.revokeToken.mockImplementation(async (id: string) => {
    const t = tokensState.find((x) => x.id === id);
    if (t) t.revokedAt = '2026-11-04T02:00:00.000Z';
  });
  writeText.mockClear();
  clientMock.createToken.mockClear();
  clientMock.ensureIdeToken.mockClear();
});

function renderDialog() {
  return render(createElement(AntdApp, null, createElement(McpSettingsDialog, { onClose: () => {} })));
}

/** 等待自动 token 生成完毕(配置块出现即代表 token 已注入) */
async function waitReady() {
  await waitFor(() => expect(screen.getByTestId('mcp-config-stdio')).toBeTruthy());
}

describe('MCP 设置页(一键复制版)', () => {
  it('① 首屏存在「一键复制」按钮,复制内容为合法 JSON 且含 command/args/env', async () => {
    renderDialog();
    await waitReady();
    const btn = screen.getByTestId('mcp-copy-stdio');
    expect(btn.textContent).toMatch(/一\s*键\s*复\s*制/);
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = (writeText.mock.calls as unknown as string[][])[0]![0]!;
    // 2026-11-07 起「一键复制」给的是自包含接入包（含给 LLM 的指令），配置在其中的 json 代码块里
    const jsonBlock = /```json\n([\s\S]*?)\n```/.exec(copied)?.[1];
    expect(jsonBlock).toBeTruthy();
    const cfg = JSON.parse(jsonBlock!); // 合法 JSON
    const server = cfg.mcpServers.zeroexo;
    expect(server.command).toBe('node');
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args[0]).toContain('mcp-server');
    expect(server.env.ZEROEXO_DATA_ROOT).toBe('D:\\Test');
    expect(server.env.ZEROEXO_MCP_TOKEN).toBe('zxp_AUTO_GENERATED_RAW');
  });

  it('② 首次无 token 时自动生成全权限 token 并注入配置(无需先手动新建)', async () => {
    renderDialog();
    await waitReady();
    // 打开面板即自动取 token(ensureIdeToken 内部在无可用 token 时自动创建全权限 token,逻辑见 mcp-client.test.ts)
    expect(clientMock.ensureIdeToken).toHaveBeenCalledTimes(1);
    // 自动生成的 token 原文直接写进配置块
    expect(screen.getByTestId('mcp-config-stdio').textContent).toContain('zxp_AUTO_GENERATED_RAW');
    // 首屏不要求用户先去新建:不应出现"粘贴你的 token"占位符
    expect(document.body.textContent).not.toContain('<粘贴你的');
  });

  it('③ 默认无技术说明文案:关键术语在 DOM 中出现 0 次(折叠且懒渲染)', async () => {
    renderDialog();
    await waitReady();
    const text = document.body.textContent ?? '';
    for (const term of ['stdio', 'Bearer', 'Authorization', 'jsonrpc', '协议', '审计', '自检', '能力清单', '作用域']) {
      expect(text).not.toContain(term);
    }
  });

  it('④ 本版本隐藏「远程连接(多台设备共用)」', async () => {
    renderDialog();
    await waitReady();
    expect(screen.queryByText('远程连接(多台设备共用)')).toBeNull();
    expect(screen.queryByTestId('mcp-config-http')).toBeNull();
  });

  it('⑤ 密钥管理:新建后原文仅显示一次,「我已保存」后消失', async () => {
    renderDialog();
    await waitReady();
    fireEvent.click(screen.getByText('密钥管理'));
    await waitFor(() => expect(screen.getByTestId('mcp-token-create')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-token-create'));
    fireEvent.click(await screen.findByRole('button', { name: /生\s*成/ }));
    await waitFor(() => expect(screen.getByTestId('mcp-new-token').textContent).toBe('zxp_AUTO_GENERATED_RAW'));
    fireEvent.click(screen.getByText('我已保存'));
    await waitFor(() => expect(screen.queryByTestId('mcp-new-token')).toBeNull());
  });

  it('⑤ 密钥管理:撤销后列表标记「已撤销」', async () => {
    tokensState = [{
      id: 'tok-a', hash: 'h', prefix: 'zxp', projectIds: '*',
      bits: ['project.read'], createdAt: '2026-11-04T00:00:00.000Z',
    }];
    renderDialog();
    await waitReady();
    fireEvent.click(screen.getByText('密钥管理'));
    await waitFor(() => expect(screen.getByTestId('mcp-token-revoke-tok-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mcp-token-revoke-tok-a'));
    await waitFor(() => expect(clientMock.revokeToken).toHaveBeenCalledWith('tok-a'));
    await waitFor(() => expect(screen.getByTestId('mcp-token-revoked-tok-a').textContent).toBe('已撤销'));
  });

  it('⑥ 无印章(server 未跑过)→ 显示启动命令兜底,不崩溃', async () => {
    clientMock.loadServerInfo.mockImplementationOnce(async () => null as unknown as ServerInfo);
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('mcp-start-cmd').textContent).toContain('node'));
    // 不应自动生成 token(配置块都还没有)
    expect(clientMock.ensureIdeToken).not.toHaveBeenCalled();
  });

  it('⑦ 配置块全页唯一:本地数据面板不再渲染第二份配置/复制按钮', async () => {
    renderDialog();
    await waitReady();
    // 2026-11-06 用户指令：原先首屏与「本地数据面板」各有一份 mcpServers 配置块 → 合并为一份
    expect(screen.getAllByTestId('mcp-config-stdio')).toHaveLength(1);
    expect(screen.getAllByTestId('mcp-copy-stdio')).toHaveLength(1);
    const text = document.body.textContent ?? '';
    // 数据目录 / 绝对路径合并为一块：面板只剩一个「数据目录」小节标题
    expect(text.match(/数据目录/g) ?? []).toHaveLength(1);
  });
});
