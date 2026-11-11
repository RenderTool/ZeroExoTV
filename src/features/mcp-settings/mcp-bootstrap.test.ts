/** 全新机器一键安装命令（2026-11-11 用户要求）：复制给任意 Agent IDE 用户，终端跑一次即可。 */
import { describe, expect, it } from 'vitest';
import { buildBootstrapCommand, detectBootstrapPlatform } from './mcp-bootstrap.js';

describe('buildBootstrapCommand', () => {
  const base = {
    downloadUrl: 'https://rendertool.github.io/ZeroExoTV/downloads/zeroexo-mcp-server.tgz',
    dataRoot: "D:\\Test",
    token: 'zxp_abc',
  };

  it('Windows：下载 → 解压 → 用数据根+token 启动 HTTP 服务', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'windows' });
    expect(cmd).toContain('powershell');
    expect(cmd).toContain('Invoke-WebRequest');
    expect(cmd).toContain("ZEROEXO_DATA_ROOT='D:\\Test'");
    expect(cmd).toContain("ZEROEXO_MCP_TOKEN='zxp_abc'");
    expect(cmd).toContain('--http --port 8787');
    expect(cmd).toContain('tar -xzf');
  });

  it('mac/linux：curl 下载 + tar 解压 + env 启动', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'mac', dataRoot: '/Users/a/ZeroExo' });
    expect(cmd).toContain("curl -fsSL 'https://");
    expect(cmd).toContain("ZEROEXO_DATA_ROOT='/Users/a/ZeroExo'");
    expect(cmd).toContain('node ~/.zeroexo/mcp/package/dist/index.js');
  });

  it('单引号路径做转义，不破坏命令', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'linux', dataRoot: "/tmp/a'b" });
    expect(cmd).toContain("ZEROEXO_DATA_ROOT='/tmp/a''b'");
  });

  it('按 UA 识别平台', () => {
    expect(detectBootstrapPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('windows');
    expect(detectBootstrapPlatform('Mozilla/5.0 (Macintosh)')).toBe('mac');
    expect(detectBootstrapPlatform('Mozilla/5.0 (X11; Linux)')).toBe('linux');
  });
});
