/**
 * 首次启动（全新机器）MCP 状态（2026-11-11 用户反馈）：
 * 没有 server-info 是「还没配置」，不是「服务信息生成失败/旧版本」，不许告警。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('首次启动 MCP 状态', () => {
  it('onboarding：MCP 直接复用唯一 MCP 设置面板（首屏配置 + 高级密钥都在同一处）', () => {
    const src = read('src/features/onboarding/onboarding-guide.tsx');
    expect(src).toContain('<McpSettingsDialog embedded />');
    expect(src).toContain('stepMcp');
    expect(src).not.toContain('MCP 服务信息还没有生成');
  });

  it('version badge：未检测到 MCP 时显示中性文案，不标成需要更新', () => {
    const src = read('src/features/top-bar/components/version-badge.tsx');
    expect(src).toContain('mcpDetected && isNewerVersion');
    expect(src).toContain('首次使用请先配置');
  });

  it('mcpServerMissingTools(null) 返回空（空清单不再误报缺全部工具）', async () => {
    const { mcpServerMissingTools } = await import('@/features/mcp-settings/mcp-client.js');
    expect(mcpServerMissingTools(null)).toEqual([]);
    expect(mcpServerMissingTools({ toolNames: [] } as never)).toEqual([]);
  });
});
