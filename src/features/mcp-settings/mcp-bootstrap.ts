/**
 * 全新机器「一键安装并启动 MCP」命令（2026-11-11 用户要求）：
 * 任意 Agent IDE 的用户把这条命令粘到终端运行一次，就会下载官方 MCP 包、解压并用当前数据根+token 启动 HTTP 服务；
 * 之后回到网页刷新状态，即可复制标准 MCP 配置粘进 IDE。
 */
export type BootstrapPlatform = 'windows' | 'mac' | 'linux';

export function detectBootstrapPlatform(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): BootstrapPlatform {
  const ua = userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
}

function sq(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildBootstrapCommand(opts: {
  platform: BootstrapPlatform;
  downloadUrl: string;
  dataRoot: string;
  token: string;
  port?: number;
}): string {
  const port = opts.port ?? 8787;
  if (opts.platform === 'windows') {
    return [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "',
      "$d=Join-Path $env:USERPROFILE '.zeroexo\\mcp';",
      "New-Item -ItemType Directory -Force $d | Out-Null;",
      `Invoke-WebRequest '${sq(opts.downloadUrl)}' -OutFile (Join-Path $d 'mcp.tgz');`,
      "tar -xzf (Join-Path $d 'mcp.tgz') -C $d;",
      `$env:ZEROEXO_DATA_ROOT='${sq(opts.dataRoot)}';`,
      `$env:ZEROEXO_MCP_TOKEN='${sq(opts.token)}';`,
      `node (Join-Path $d 'package\\dist\\index.js') --http --port ${port}`,
      '"',
    ].join(' ');
  }
  const dir = '~/.zeroexo/mcp';
  return [
    `mkdir -p ${dir}`,
    `&& curl -fsSL '${sq(opts.downloadUrl)}' -o ${dir}/mcp.tgz`,
    `&& tar -xzf ${dir}/mcp.tgz -C ${dir}`,
    `&& ZEROEXO_DATA_ROOT='${sq(opts.dataRoot)}' ZEROEXO_MCP_TOKEN='${sq(opts.token)}' node ${dir}/package/dist/index.js --http --port ${port}`,
  ].join(' ');
}
