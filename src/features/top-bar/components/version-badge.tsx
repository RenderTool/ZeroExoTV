/**
 * VersionBadge — 顶栏版本号 + 「本地 vs 官方最新」对照（2026-11-11 用户要求）。
 *
 * 网页本地版 = 当前构建注入的版本；官方最新版 = 同源 version.json（部署产物）。
 * MCP 本地版 = 数据根 .mcp/server-info.json 的 version/tools（本机已安装并运行的 MCP）；
 * MCP 官方版 = 仓库构建时的 mcp-server 版本（version.json.mcpVersion）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Popover } from 'antd';
import type { ThemeConfig } from '@zeroexo/plugin-theme';
import { readJson } from '@/platform/fs.js';
import {
  APP_VERSION,
  EXPECTED_MCP_VERSION,
  fetchLatestVersionManifest,
  isNewerVersion,
  type VersionManifest,
} from '@/shared/constants/version.js';

interface McpInfo {
  version?: string;
  tools?: number;
  builtAt?: string | null;
  pid?: number;
}

const STATUS_OK = '#16a34a';
const STATUS_WARN = '#d97706';

export function VersionBadge({ theme }: { theme: ThemeConfig }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [mcp, setMcp] = useState<McpInfo | null>(null);

  const refresh = useCallback(async () => {
    const [latest, info] = await Promise.all([
      fetchLatestVersionManifest(),
      readJson<McpInfo>('.mcp/server-info.json').catch(() => null),
    ]);
    setManifest(latest);
    setMcp(info);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const latestApp = manifest?.appVersion;
  const appOutdated = isNewerVersion(APP_VERSION, latestApp);
  const latestMcp = manifest?.mcpVersion ?? EXPECTED_MCP_VERSION;
  const mcpLocal = mcp?.version ?? '';
  const mcpDetected = Boolean(mcpLocal);
  // 全新机器/未配置 MCP：不算「过时」，只提示首次配置
  const mcpOutdated = mcpDetected && isNewerVersion(mcpLocal, latestMcp);

  const muted = theme.toolbar.textMuted ?? '';
  const text = theme.toolbar.text ?? '';
  const border = theme.toolbar.border ?? 'rgba(255,255,255,0.12)';
  const isDark = theme.mode === 'dark';

  const rowStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '6px 0' } as const;
  const labelStyle = { fontSize: 11, color: muted, flexShrink: 0 } as const;
  const valueStyle = { fontSize: 12, color: text, fontVariantNumeric: 'tabular-nums' } as const;

  const content = (
    <div style={{ width: 300, fontSize: 12, color: text }}>
      <div style={rowStyle}>
        <span style={labelStyle}>网页本地</span>
        <span style={valueStyle}>v{APP_VERSION}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>网页官方最新</span>
        <span style={valueStyle}>{latestApp ? `v${latestApp}` : '读取失败'}</span>
      </div>
      <div style={{ ...rowStyle, paddingTop: 0 }}>
        <span style={labelStyle}>网页状态</span>
        <span style={{ fontSize: 11, color: appOutdated ? STATUS_WARN : STATUS_OK }}>
          {appOutdated ? '有新版本，请刷新页面' : '已是最新'}
        </span>
      </div>

      <div style={{ height: 1, background: border, margin: '8px 0' }} />

      <div style={rowStyle}>
        <span style={labelStyle}>MCP 本地</span>
        <span style={valueStyle}>
          {mcpLocal ? `v${mcpLocal}` : '未检测到'}
          {mcp?.tools ? ` · ${mcp.tools} 个工具` : ''}
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>MCP 官方最新</span>
        <span style={valueStyle}>v{latestMcp}</span>
      </div>
      <div style={{ ...rowStyle, paddingTop: 0 }}>
        <span style={labelStyle}>MCP 状态</span>
        <span style={{ fontSize: 11, color: mcpOutdated ? STATUS_WARN : mcpDetected ? STATUS_OK : muted }}>
          {!mcpDetected ? '未检测到（首次使用请先配置）' : mcpOutdated ? '需要更新 MCP 并重启' : '已是最新'}
        </span>
      </div>

      {(manifest?.commit || mcp?.builtAt) ? (
        <div style={{ marginTop: 8, fontSize: 10, color: muted, lineHeight: 1.6 }}>
          {manifest?.commit ? <div>提交 {manifest.commit}</div> : null}
          {mcp?.builtAt ? <div>MCP 构建 {new Date(mcp.builtAt).toLocaleString()}</div> : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      styles={{ content: { background: isDark ? '#1f1f1f' : '#fff', borderRadius: 10, padding: '10px 14px' } }}
    >
      <button
        type="button"
        data-version-badge
        title="版本与更新状态"
        style={{
          height: 24, padding: '0 8px', borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${appOutdated || mcpOutdated ? STATUS_WARN : border}`,
          background: 'transparent', color: appOutdated || mcpOutdated ? STATUS_WARN : muted,
          fontSize: 10, fontVariantNumeric: 'tabular-nums', fontFamily: 'inherit', lineHeight: 1,
        }}
      >
        v{APP_VERSION}
      </button>
    </Popover>
  );
}
