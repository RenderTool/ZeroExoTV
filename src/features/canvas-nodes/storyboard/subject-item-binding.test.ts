/**
 * 条目 ↔ 主体树唯一绑定 + 新建主体自动命名（2026-11-06 用户反馈）
 *
 * 用户报的两条其实同根：
 * - 「新建主体不会自动递增序号」→ 默认名全是「新主体」，同名条目成堆；
 * - 「同名主体会被错误的一起切换主体类型」→ 旧口径 `trees.find(tr => tr.name === it.name)`
 *   让多条同名条目命中同一棵树，改一条串全部（连删除都会把别人的树一起删掉）。
 *
 * 这里锁死回落链：itemId 优先；老数据只在「名字唯一」时才配对，同名多条只让第一条继承，
 * 其余按无树处理（进详情各自建新树），绝不猜。
 */
import { describe, expect, it } from 'vitest';
import { createSubjectTree, findItemForTree, findTreeForItem, type SubjectTree } from './subject-tree-types';
import { nextUniqueName } from '../production-manager/production-manager-types';

function tree(name: string, itemId?: string | null): SubjectTree {
  const tr = createSubjectTree('character', name, itemId);
  return tr;
}

describe('findTreeForItem 唯一绑定', () => {
  it('itemId 命中优先，名字不同也认（改名不断链）', () => {
    const item = { id: 'item-1', name: '老人' };
    const tr = tree('老人（青年）', 'item-1');
    expect(findTreeForItem([tr], item, [item])?.rootId).toBe(tr.rootId);
  });

  it('老数据无 itemId：名字唯一才配对', () => {
    const a = { id: 'item-a', name: '东海龙王' };
    const b = { id: 'item-b', name: '山神庙' };
    const tr = tree('东海龙王');
    expect(findTreeForItem([tr], a, [a, b])?.name).toBe('东海龙王');
    expect(findTreeForItem([tr], b, [a, b])).toBeUndefined();
  });

  it('同名两条 + 一棵无绑定老树：只有第一条继承，第二条不再抢同一棵树', () => {
    const first = { id: 'item-1', name: '新主体' };
    const second = { id: 'item-2', name: '新主体' };
    const legacy = tree('新主体');
    expect(findTreeForItem([legacy], first, [first, second])?.rootId).toBe(legacy.rootId);
    expect(findTreeForItem([legacy], second, [first, second])).toBeUndefined();
  });

  it('一条已绑定、另一条同名无绑定：各回各的，互不串台', () => {
    const first = { id: 'item-1', name: '新主体' };
    const second = { id: 'item-2', name: '新主体' };
    const boundToSecond = tree('新主体', 'item-2');
    const legacy = tree('新主体');
    const trees = [legacy, boundToSecond];
    expect(findTreeForItem(trees, first, [first, second])?.rootId).toBe(legacy.rootId);
    expect(findTreeForItem(trees, second, [first, second])?.rootId).toBe(boundToSecond.rootId);
  });
});

describe('findItemForTree 反向查询', () => {
  it('itemId 命中优先', () => {
    const items = [{ id: 'item-1', name: '新主体' }, { id: 'item-2', name: '新主体' }];
    const tr = tree('新主体', 'item-2');
    expect(findItemForTree(items, tr, [tr])?.id).toBe('item-2');
  });

  it('多棵无绑定同名树 = 归属不明，不猜', () => {
    const items = [{ id: 'item-1', name: '新主体' }];
    const a = tree('新主体');
    const b = tree('新主体');
    expect(findItemForTree(items, a, [a, b])).toBeUndefined();
  });

  it('单棵无绑定老树仍按名字回第一条（老数据可用，不逼用户先迁移）', () => {
    const items = [{ id: 'item-1', name: '东海龙王' }, { id: 'item-2', name: '东海龙王' }];
    const tr = tree('东海龙王');
    expect(findItemForTree(items, tr, [tr])?.id).toBe('item-1');
  });
});

describe('nextUniqueName 新建主体自动递增', () => {
  it('空列表用原名；重复后依次递增，且取已有最大值 +1', () => {
    expect(nextUniqueName([], '新主体')).toBe('新主体');
    expect(nextUniqueName(['新主体'], '新主体')).toBe('新主体 2');
    expect(nextUniqueName(['新主体', '新主体 2'], '新主体')).toBe('新主体 3');
    // 中间号被删也不复用，避免和「记忆里的名字」撞车
    expect(nextUniqueName(['新主体', '新主体 7'], '新主体')).toBe('新主体 8');
  });

  it('比较忽略首尾空格；空 base 原样返回', () => {
    expect(nextUniqueName(['  新主体 '], '新主体')).toBe('新主体 2');
    expect(nextUniqueName(['a'], '')).toBe('');
  });

  it('base 含正则特殊字符不会被当模式解析', () => {
    expect(nextUniqueName(['C++(1)'], 'C++(1)')).toBe('C++(1) 2');
  });
});
