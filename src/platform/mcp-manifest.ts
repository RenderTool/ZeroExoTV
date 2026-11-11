/**
 * 发布「前端要求的 MCP 工具清单」（2026-11-11 用户要求）
 *
 * 旧版 MCP 连到网页时，要由 Agent 工具自己感知「该更新了」，而不是客户去问。
 * 网页启动时把这份清单写到数据根，MCP 每次工具返回都会比对：
 * 缺工具 → 返回 _mcpOutdated → Agent 调 mcp_update_status / update_mcp_server。
 */
import { isAuthorized, writeJson } from '@/platform/fs.js';
import { MCP_TOOLS } from '@/features/mcp-settings/mcp-client.js';
import { MCP_REQUIRED_MANIFEST } from '@/shared/constants/mcp-manifest.js';
import { APP_VERSION, EXPECTED_MCP_VERSION } from '@/shared/constants/version.js';

export async function publishMcpRequiredManifest(): Promise<void> {
  try {
    if (!(await isAuthorized())) return;
    await writeJson(MCP_REQUIRED_MANIFEST, {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      mcpVersion: EXPECTED_MCP_VERSION,
      requiredTools: MCP_TOOLS.map((t) => t.name),
      writtenAt: new Date().toISOString(),
    });
  } catch {
    // 未授权 / 离线：下次启动再写，不影响主流程
  }
}
