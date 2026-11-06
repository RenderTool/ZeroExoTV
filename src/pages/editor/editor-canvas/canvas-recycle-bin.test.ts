import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readTombstoneIndex,
  appendTombstone,
  removeTombstone,
  clearTombstoneIndex,
  findTombstone,
  type TombstoneIndexEntry,
} from './canvas-recycle-bin.js';

// 控制 vi.useFakeTimers 确保 deletedAt 可预测
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function makeEntry(id: string, type = 'script', deletedAt = Date.now()): TombstoneIndexEntry {
  return { id, title: `节点-${id}`, type, deletedAt };
}

describe('canvas-recycle-bin (Plan#80 Phase C)', () => {
  it('TC-C1: 空画布返回空索引', () => {
    expect(readTombstoneIndex('cv1')).toEqual([]);
  });

  it('TC-C2: append 后 read 正确 + 去重', () => {
    appendTombstone('cv1', makeEntry('n1'));
    appendTombstone('cv1', makeEntry('n2', 'novel'));
    let idx = readTombstoneIndex('cv1');
    expect(idx).toHaveLength(2);
    expect(idx[0]!.id).toBe('n2'); // 新删除放前面
    // 同 id 重复 append → 去重并移到前面（不重复累积）
    appendTombstone('cv1', makeEntry('n1'));
    idx = readTombstoneIndex('cv1');
    expect(idx).toHaveLength(2);
    expect(idx[0]!.id).toBe('n1');
  });

  it('TC-C3: remove 单条 + clear 全清', () => {
    appendTombstone('cv1', makeEntry('n1'));
    appendTombstone('cv1', makeEntry('n2'));
    removeTombstone('cv1', 'n1');
    let idx = readTombstoneIndex('cv1');
    expect(idx).toHaveLength(1);
    expect(idx[0]!.id).toBe('n2');
    clearTombstoneIndex('cv1');
    expect(readTombstoneIndex('cv1')).toEqual([]);
  });

  it('TC-C4: find 按 id 查找', () => {
    appendTombstone('cv1', makeEntry('n1', 'script'));
    appendTombstone('cv1', makeEntry('n2', 'novel'));
    expect(findTombstone('cv1', 'n1')?.type).toBe('script');
    expect(findTombstone('cv1', 'n2')?.type).toBe('novel');
    expect(findTombstone('cv1', 'missing')).toBeUndefined();
  });

  it('TC-C5: 跨画布隔离（不同 canvasId 不串）', () => {
    appendTombstone('cvA', makeEntry('shared-id'));
    appendTombstone('cvB', makeEntry('shared-id'));
    expect(readTombstoneIndex('cvA')).toHaveLength(1);
    expect(readTombstoneIndex('cvB')).toHaveLength(1);
    // 删除 cvA 的不影响 cvB
    removeTombstone('cvA', 'shared-id');
    expect(readTombstoneIndex('cvA')).toHaveLength(0);
    expect(readTombstoneIndex('cvB')).toHaveLength(1);
  });

  it('TC-C6: 30 天 GC 自动清理过期条目', () => {
    const now = Date.now();
    appendTombstone('cv1', makeEntry('fresh', 'script', now));
    appendTombstone('cv1', makeEntry('stale', 'script', now - 31 * 24 * 60 * 60 * 1000));
    // GC 在 read 时触发
    const idx = readTombstoneIndex('cv1');
    expect(idx).toHaveLength(1);
    expect(idx[0]!.id).toBe('fresh');
  });

  it('TC-C7: 超过 50 条时保留最新 50', () => {
    for (let i = 0; i < 60; i++) {
      appendTombstone('cv1', makeEntry(`n${i}`, 'script', Date.now() + i));
    }
    const idx = readTombstoneIndex('cv1');
    expect(idx).toHaveLength(50);
  });

  it('TC-C8: 坏数据不抛错（parse 失败 → 空数组）', () => {
    localStorage.setItem('zeroeo:canvas-tombstones:cv1', 'not-json{{{');
    expect(readTombstoneIndex('cv1')).toEqual([]);
  });
});
