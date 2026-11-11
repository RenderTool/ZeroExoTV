/** 全新机器一键安装命令（2026-11-11 用户要求）：只需一个复制按钮，命令自包含安装目录/数据根。 */
import { describe, expect, it } from 'vitest';
import { buildBootstrapCommand, detectBootstrapPlatform } from './mcp-bootstrap.js';

describe('buildBootstrapCommand', () => {
  const base = {
    downloadUrl: 'https://rendertool.github.io/ZeroExoTV/downloads/zeroexo-mcp-server.tgz',
  };

  it('Windows：下载 → 解压 → 启动（沿用默认数据根，不劫持现有数据目录）', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'windows' });
    expect(cmd).toContain('powershell');
    expect(cmd).toContain('Invoke-WebRequest');
    expect(cmd).not.toContain('ZEROEXO_DATA_ROOT');
    expect(cmd).toContain('--http --port 8787');
    expect(cmd).toContain('tar -xzf');
  });

  it('mac/linux：curl 下载 + tar 解压 + 自动数据根启动', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'mac' });
    expect(cmd).toContain("curl -fsSL 'https://");
    expect(cmd).toContain('ZEROEXO_DATA_ROOT="$HOME/ZeroExo"');
    expect(cmd).toContain('node ~/.zeroexo/mcp/package/dist/index.js');
  });

  it('命令不再依赖网页传入绝对路径或 token（全新机器自包含）', () => {
    const cmd = buildBootstrapCommand({ ...base, platform: 'linux' });
    expect(cmd).not.toContain('zxp_');
    expect(cmd).not.toContain('D:\\Test');
  });

  it('按 UA 识别平台', () => {
    expect(detectBootstrapPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('windows');
    expect(detectBootstrapPlatform('Mozilla/5.0 (Macintosh)')).toBe('mac');
    expect(detectBootstrapPlatform('Mozilla/5.0 (X11; Linux)')).toBe('linux');
  });
});
