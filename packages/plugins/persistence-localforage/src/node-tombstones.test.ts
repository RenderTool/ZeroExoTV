/**
 * C-24 画布删除墓碑：同步兜底（刷新也得记住「这个节点被删了」）
 *
 * 根因回归：删节点后落盘是 400ms 防抖 + idle 回调，删完立刻刷新时会话被丢弃，
 * load 读回旧图 → 节点复活。墓碑必须**同步**写、按项目隔离、可清空、有上限。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODE_TOMBSTONE_KEY_PREFIX,
  clearNodeTombstones,
  readNodeTombstones,
  writeNodeTombstones,
} from './node-tombstones';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

let prev: unknown;

beforeEach(() => {
  prev = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
});

afterEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = prev;
  vi.restoreAllMocks();
});

describe('node-tombstones', () => {
  it('同步写入 → 同步读回（不等任何异步落盘）', () => {
    writeNodeTombstones('p1', new Set(['n1', 'n2']));
    expect(readNodeTombstones('p1')).toEqual(new Set(['n1', 'n2']));
  });

  it('按项目隔离，不串项目', () => {
    writeNodeTombstones('p1', new Set(['n1']));
    expect(readNodeTombstones('p2').size).toBe(0);
  });

  it('清空后读回为空，且 key 被移除', () => {
    writeNodeTombstones('p1', new Set(['n1']));
    clearNodeTombstones('p1');
    expect(readNodeTombstones('p1').size).toBe(0);
    const ls = (globalThis as { localStorage: { _map: Map<string, string> } }).localStorage;
    expect(ls._map.has(`${NODE_TOMBSTONE_KEY_PREFIX}p1`)).toBe(false);
  });

  it('上限 500：只保留最近写入的 500 条，不会无限膨胀', () => {
    const ids = new Set(Array.from({ length: 700 }, (_, i) => `n${i}`));
    writeNodeTombstones('big', ids);
    const read = readNodeTombstones('big');
    expect(read.size).toBe(500);
    expect(read.has('n699')).toBe(true);
    expect(read.has('n0')).toBe(false);
  });

  it('存储不可用时不抛异常（墓碑是兜底，不能阻断删除/加载）', () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(() => writeNodeTombstones('p', new Set(['x']))).not.toThrow();
    expect(readNodeTombstones('p').size).toBe(0);
  });
});
