/**
 * sync-store - 简化版同步状态管理
 *
 * 设计原则:
 * - 无脏数据追踪:所有操作立即同步到云端
 * - 无离线队列:不支持离线操作
 * - 仅保留同步状态:用于 UI 显示同步中/空闲/错误
 */

import { useState, useEffect } from 'react';
import localforage from 'localforage';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'inactive';

const syncStateStore = localforage.createInstance({
  name: 'zeroexo',
  storeName: 'app_state',
});
const LAST_SYNCED_KEY = 'zeroexo:lastSyncedAt';

let syncStatus: SyncStatus = 'idle';
let lastSyncedAt: string | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

async function loadLastSynced(): Promise<void> {
  lastSyncedAt = await syncStateStore.getItem<string>(LAST_SYNCED_KEY);
}

// 本地版：数据目录未授权时 localforage 会 reject（磁盘驱动不可用）——此处吞掉，
// 避免模块加载期冒出未捕获的 Promise 拒绝（No available storage method found）。
void loadLastSynced().catch(() => { /* 目录未授权时无同步状态，忽略 */ });

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export function setSyncStatus(status: SyncStatus): void {
  syncStatus = status;
  notify();
}

export function getLastSyncedAt(): string | null {
  return lastSyncedAt;
}

export async function setLastSyncedAt(time: string): Promise<void> {
  lastSyncedAt = time;
  await syncStateStore.setItem(LAST_SYNCED_KEY, time);
  notify();
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * 本地版（2026-11-02）：**无云端** —— 云同步链路整体不启用。
 * 所有远端调用由此开关短路（数据一律落本地目录/本地库），
 * 避免本地版反复打后端接口导致「接口错误」噪音。
 */
export const CLOUD_ENABLED = false;

/** 当前标签页是否可见(离屏时标记失活,避免多标签页冲突) */
let tabInactive = false;

export function isTabActive(): boolean {
  return !tabInactive;
}

export function setTabInactive(inactive: boolean): void {
  tabInactive = inactive;
  if (inactive) {
    syncStatus = 'inactive';
  } else {
    syncStatus = isOnline() ? 'idle' : 'error';
  }
  notify();
}

/**
 * 通知 UI 层 dirty 状态已变化(节点增删改等操作触发)。
 * sync-service 的 markProjectDirty/markProjectClean 中调用,
 * 驱动 EditorSyncBadge 的"待同步"状态刷新。
 */
export function notifyDirtyChanged(): void {
  notify();
}

export async function clearAllSyncState(): Promise<void> {
  lastSyncedAt = null;
  syncStatus = isOnline() ? 'idle' : 'error';
  await syncStateStore.removeItem(LAST_SYNCED_KEY);
  notify();
}

export function useSyncStatus(): {
  status: SyncStatus;
  lastSyncedAt: string | null;
  isOnline: boolean;
} {
  const [, forceUpdate] = useState(0);
  const [snapshot, setSnapshot] = useState({
    status: syncStatus,
    lastSyncedAt,
    isOnline: isOnline(),
  });

  useEffect(() => {
    const listener = (): void => {
      forceUpdate((n) => n + 1);
      setSnapshot({
        status: syncStatus,
        lastSyncedAt,
        isOnline: isOnline(),
      });
    };
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  }, []);

  return snapshot;
}