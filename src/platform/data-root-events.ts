/**
 * 数据根状态事件（2026-11-18 用户报障：素材读取失败被统一弹成「目录需要重新授权」）。
 *
 * 唯一口径：读取失败先问 fs.ts 的 `dataRootState()`，再按结果分流——
 * - unauthorized（真的没有读写权限）→ DATA_ROOT_AUTH_NEEDED_EVENT，直接弹授权框；
 * - service-offline（8790 本地数据服务不在线）→ DATA_ROOT_SERVICE_OFFLINE_EVENT，
 *   提示服务离线并给「重新连接」，不许让用户去重新选目录；
 * - ok（有权限，纯文件问题）→ 不弹任何框，只显示可读原因。
 */

import type { DataRootState } from './fs.js';

export const DATA_ROOT_AUTH_NEEDED_EVENT = 'zeroexo:data-root-auth-needed';
export const DATA_ROOT_SERVICE_OFFLINE_EVENT = 'zeroexo:data-root-service-offline';

/** 按状态广播对应事件；ok 不广播（有权限时的读取失败是文件问题，不是授权问题） */
export function emitDataRootStateEvent(state: DataRootState, detail?: { storageKey?: string; reason?: string }): void {
  if (state === 'unauthorized') {
    window.dispatchEvent(new CustomEvent(DATA_ROOT_AUTH_NEEDED_EVENT, { detail }));
  } else if (state === 'service-offline') {
    window.dispatchEvent(new CustomEvent(DATA_ROOT_SERVICE_OFFLINE_EVENT, { detail }));
  }
}
