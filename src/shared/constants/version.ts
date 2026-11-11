/**
 * 版本清单（2026-11-11 用户要求）：
 * - 本地版本 = 构建时注入的 __APP_VERSION__（网页）/ .mcp/server-info.json 的 version（MCP）
 * - 官方最新版 = 同源 version.json（构建/部署时由 vite 插件生成）
 * 用于页面上的「本地 vs 官方」对照，让用户知道是否需要刷新/更新。
 */
declare const __APP_VERSION__: string | undefined;
declare const __MCP_VERSION__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.1';
/** 本仓库期望的 MCP 版本（构建时注入；用于和本机安装的 MCP 对照） */
export const EXPECTED_MCP_VERSION = typeof __MCP_VERSION__ === 'string' ? __MCP_VERSION__ : '0.0.1';

export interface VersionManifest {
  appVersion: string;
  mcpVersion: string;
  commit?: string;
  builtAt?: string;
}

/** 官方最新版清单（同源 version.json，带 cache-bust） */
export async function fetchLatestVersionManifest(): Promise<VersionManifest | null> {
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    const res = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<VersionManifest>;
    if (!data?.appVersion) return null;
    return {
      appVersion: String(data.appVersion),
      mcpVersion: String(data.mcpVersion ?? data.appVersion),
      commit: data.commit ? String(data.commit) : undefined,
      builtAt: data.builtAt ? String(data.builtAt) : undefined,
    };
  } catch {
    return null;
  }
}

export function isNewerVersion(local: string, latest: string | undefined): boolean {
  if (!latest || !local) return false;
  const a = local.split('.').map((n) => Number(n) || 0);
  const b = latest.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return y > x;
  }
  return false;
}
