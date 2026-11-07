/**
 * last-seed-store — 每个项目「上一次生成实际使用的种子」。
 *
 * 用途：画布节点与导演台的种子参数都支持「随机（-1）」，
 * 随机后把实际种子记下来，面板显示「上次：N」，点一下可复用。
 */
import { create } from 'zustand';
import { getCurrentCanvasId } from './current-canvas-id.js';

const STORAGE_PREFIX = 'zeroexo.lastSeed.';

interface LastSeedState {
  byProject: Record<string, number>;
}

export const useLastSeedStore = create<LastSeedState>(() => ({ byProject: {} }));

function projectKey(projectId?: string | null): string {
  return projectId || getCurrentCanvasId() || 'default';
}

function readStored(projectId: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** 记录一次真实使用的种子（项目维度 + 内存/本地持久化） */
export function recordLastSeed(seed: number, projectId?: string | null): void {
  if (!Number.isFinite(seed)) return;
  const pid = projectKey(projectId);
  useLastSeedStore.setState((s) => ({ byProject: { ...s.byProject, [pid]: seed } }));
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${pid}`, String(seed));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function readLastSeed(projectId?: string | null): number | null {
  const pid = projectKey(projectId);
  const mem = useLastSeedStore.getState().byProject[pid];
  if (typeof mem === 'number') return mem;
  const stored = readStored(pid);
  if (stored !== null) useLastSeedStore.setState((s) => ({ byProject: { ...s.byProject, [pid]: stored } }));
  return stored;
}

/** 订阅「上次种子」（面板显示用） */
export function useLastSeed(projectId?: string | null): number | null {
  const pid = projectKey(projectId);
  return useLastSeedStore((s) => s.byProject[pid] ?? readStored(pid));
}

/** 种子参数解析：-1 / 空 / 非法 = 随机；返回实际使用的整数种子 */
export function resolveSeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Math.floor(Math.random() * 0x7fffffff);
  return Math.trunc(n);
}
