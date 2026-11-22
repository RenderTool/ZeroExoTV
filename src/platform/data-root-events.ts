/**
 * 数据根状态事件（2026-11-22 收敛为单一口径）。
 *
 * 读取失败先问 fs.ts 的 `dataRootState()`：
 * - unauthorized（没有可用的目录授权）→ DATA_ROOT_AUTH_NEEDED_EVENT，直接弹一次授权/确认；
 * - ok（有权限，纯文件问题）→ 不弹任何框，只显示可读原因。
 *
 * 2026-11-22 用户拍板：网页读写本地文件只认浏览器目录授权，
 * 不再有"本地数据服务离线"这一态（8790 整个移除，任务心跳走 MCP）。
 */

import type { DataRootState } from './fs.js';

export const DATA_ROOT_AUTH_NEEDED_EVENT = 'zeroexo:data-root-auth-needed';

/** 按状态广播对应事件；ok 不广播（有权限时的读取失败是文件问题，不是授权问题） */
export function emitDataRootStateEvent(state: DataRootState, detail?: { storageKey?: string; reason?: string }): void {
  if (state === 'unauthorized') {
    window.dispatchEvent(new CustomEvent(DATA_ROOT_AUTH_NEEDED_EVENT, { detail }));
  }
}
