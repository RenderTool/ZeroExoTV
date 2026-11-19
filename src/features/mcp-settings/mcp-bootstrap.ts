/**
 * 全新机器「一键安装并启动 MCP」命令（2026-11-11 用户要求：只给一个复制按钮）。
 *
 * 命令完全自包含：自己决定安装目录与数据目录（用户主目录下的 .zeroexo/mcp 与 ZeroExo），
 * 不需要网页先知道绝对路径、也不需要先有 token；跑一次后 MCP 会把 server-info 写进数据根，
 * 网页轮询到后自动切换成「复制 MCP 配置」。
 */
export type BootstrapPlatform = 'windows' | 'mac' | 'linux';

export function detectBootstrapPlatform(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): BootstrapPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
}

export function buildBootstrapCommand(opts: {
  platform: BootstrapPlatform;
  downloadUrl: string;
  port?: number;
  /** 数据根绝对路径；Windows 下 MCP 装到 <数据根>\.mcp-server\next，禁止装进 C 盘（2026-11-17 用户硬性要求） */
  dataRoot?: string;
}): string {
  const port = opts.port ?? 8787;
  const url = opts.downloadUrl.replace(/'/g, "''");
  if (opts.platform === 'windows') {
    // 安装目录与数据根同目录：MCP 放 C 盘会让系统盘吃满，用户明确禁止（宁可同目录）
    const root = (opts.dataRoot ?? 'D:\\Test');
    const dir = `${root}\\.mcp-server\\next`;
    const tgz = `${dir}\\mcp.tgz`;
    const entry = `${dir}\\package\\dist\\index.js`;
    return [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "',
      `New-Item -ItemType Directory -Force '${dir}' | Out-Null;`,
      `Invoke-WebRequest '${url}' -OutFile '${tgz}';`,
      `tar -xzf '${tgz}' -C '${dir}';`,
      `node '${entry}' --http --port ${port}`,
      '"',
    ].join(' ');
  }
  return [
    'mkdir -p ~/.zeroexo/mcp ~/ZeroExo',
    `&& curl -fsSL '${url}' -o ~/.zeroexo/mcp/mcp.tgz`,
    '&& tar -xzf ~/.zeroexo/mcp/mcp.tgz -C ~/.zeroexo/mcp',
    `&& ZEROEXO_DATA_ROOT="$HOME/ZeroExo" node ~/.zeroexo/mcp/package/dist/index.js --http --port ${port}`,
  ].join(' ');
}
