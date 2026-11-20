/**
 * plugin-version —— 云端 ComfyUI 插件版本提醒（2026-11-20 用户要求）
 *
 * 云端实例（waas.aigate.cc）不自带自动更新：插件装进去后不会自己变新。
 * 所以连通后必须拿 `/zeroexo/v1/health` 回的 `version` 跟官方版本比一次，
 * 低了就在面板和一次性提示里告诉用户「手动更新插件」，不能默默跑旧插件。
 *
 * OFFICIAL_PLUGIN_VERSION 与 `comfyui-plugin/ComfyUI_ZeroExoNodes/__init__.py`
 * 的 PLUGIN_VERSION 必须一起改（发版时同一条提交里同步）。
 */

export const OFFICIAL_PLUGIN_VERSION = '0.1.4';

/** 官网下载的插件包文件名（带版本号，2026-11-21 用户要求） */
export const PLUGIN_ZIP_FILENAME = `ComfyUI_ZeroExoNodes-${OFFICIAL_PLUGIN_VERSION}.zip`;

const PARTS = 3;

function parseVersion(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const nums = value.trim().replace(/^v/i, '').split('.');
  if (nums.length === 0 || nums.some((n) => !/^\d+$/.test(n))) return null;
  const out = nums.slice(0, PARTS).map((n) => Number(n));
  while (out.length < PARTS) out.push(0);
  return out;
}

/** a < b → 负数；相等 → 0；a > b → 正数 */
export function comparePluginVersion(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < PARTS; i += 1) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  }
  return 0;
}

/** 插件版本是否低于官方（拿不到版本号按不提醒处理，避免误报） */
export function isPluginOutdated(localVersion: string | null | undefined): boolean {
  const diff = comparePluginVersion(localVersion, OFFICIAL_PLUGIN_VERSION);
  return diff !== null && diff < 0;
}

/** 面板一行提示（明文写清「云端不会自动更新，要手动换插件后重启」） */
export function pluginUpdateHint(localVersion: string): string {
  return `插件版本 ${localVersion} 低于官方 ${OFFICIAL_PLUGIN_VERSION}：云端 ComfyUI 不会自动更新插件，请手动替换 ComfyUI_ZeroExoNodes 后重启 ComfyUI`;
}
