/**
 * subject-cover.test - 主体封面唯一解析入口 resolveSubjectCover 回落链契约（2026-11-04）
 *
 * 约定：
 * 1. 无手动封面 → 默认第一个状态图（实体原始顺序，不另排序）
 * 2. 手动封面优先
 * 3. 手动封面指向的状态图被删除 → 自动回落第一个状态图，不留死链
 * 4. 恢复默认（清 coverKey）→ 回落第一个状态图
 * 5. 无状态图 → none（上层渲染图标+中性底占位，不留空白方块）
 */
import { describe, expect, it } from 'vitest';
import { resolveSubjectCover } from './production-manager-types';
import type { ProductionItemImage } from './production-manager-types';

const img = (storageKey: string): { storageKey: string; tags: string[] } => ({ storageKey, tags: [] });

describe('resolveSubjectCover 封面回落链', () => {
  it('主体树已有图时以树为准：条目 images 里的旧封面不得继续占用默认封面', () => {
    const item = { coverKey: 'k-old', images: [img('k-old')] as ProductionItemImage[] };
    // 树里只剩一张新图 → 旧 coverKey 不在候选里，应回落到这张新图
    expect(resolveSubjectCover(item, ['k-new'])).toEqual({ key: 'k-new', source: 'default' });
    // 树里明确把新图设为封面 → 手动封面生效
    expect(resolveSubjectCover({ ...item, coverKey: 'k-new' }, ['k-new'])).toEqual({ key: 'k-new', source: 'manual' });
  });

  it('树里没有图时才回落到条目 images', () => {
    const item = { coverKey: 'k-old', images: [img('k-old')] as ProductionItemImage[] };
    expect(resolveSubjectCover(item, [])).toEqual({ key: 'k-old', source: 'manual' });
  });

  it('无手动封面 → 取第一个状态图（实体原始顺序）', () => {
    const item = { coverKey: null, images: [img('k1'), img('k2'), img('k3')] as ProductionItemImage[] };
    expect(resolveSubjectCover(item)).toEqual({ key: 'k1', source: 'default' });
    // coverKey 字段缺失（旧数据）同样走默认
    const legacy = { images: [img('k9')] as ProductionItemImage[] };
    expect(resolveSubjectCover(legacy)).toEqual({ key: 'k9', source: 'default' });
  });

  it('手动封面优先：coverKey 指向非首张状态图时取手动值', () => {
    const item = { coverKey: 'k3', images: [img('k1'), img('k2'), img('k3')] as ProductionItemImage[] };
    expect(resolveSubjectCover(item)).toEqual({ key: 'k3', source: 'manual' });
  });

  it('手动封面指向的状态图被删除 → 自动回落第一个状态图，不留死链', () => {
    const item = { coverKey: 'k-deleted', images: [img('k1'), img('k2')] as ProductionItemImage[] };
    expect(resolveSubjectCover(item)).toEqual({ key: 'k1', source: 'default' });
  });

  it('恢复默认（coverKey 置 null）→ 回落第一个状态图', () => {
    const manual = { coverKey: 'k2', images: [img('k1'), img('k2')] as ProductionItemImage[] };
    expect(resolveSubjectCover(manual).source).toBe('manual');
    const restored = { ...manual, coverKey: null };
    expect(resolveSubjectCover(restored)).toEqual({ key: 'k1', source: 'default' });
  });

  it('无状态图 → none（key=null，上层渲染占位）', () => {
    expect(resolveSubjectCover({ coverKey: null, images: [] })).toEqual({ key: null, source: 'none' });
    expect(resolveSubjectCover({ coverKey: 'k1', images: [] })).toEqual({ key: null, source: 'none' });
    expect(resolveSubjectCover(null)).toEqual({ key: null, source: 'none' });
    expect(resolveSubjectCover(undefined)).toEqual({ key: null, source: 'none' });
  });
});
