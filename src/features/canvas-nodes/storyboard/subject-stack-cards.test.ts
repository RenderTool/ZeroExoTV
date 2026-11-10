/**
 * 主体 → 画布卡片映射（2026-11-10）：
 * 一个主体 = N 个资产（图片/视频/音频）；卡片带 rootId/stateId 供点击回跳主体库。
 */
import { describe, expect, it } from 'vitest';
import { buildSubjectStackCards, buildSubjectStackNodeData } from './subject-stack-cards.js';
import { createSubjectNode, createSubjectTree, type SubjectTree } from './subject-tree-types.js';

function makeTree(): SubjectTree {
  const tree = createSubjectTree('character', '老张');
  const base = createSubjectNode('基础状态', 'image', 'user', tree.rootId, { step: 1 });
  const angry = createSubjectNode('暴怒', 'image', 'user', tree.rootId, { step: 2 });
  base.media = [{ key: `cas:${'a'.repeat(64)}.png`, type: 'image' }];
  base.mediaHistory = [{ key: `cas:${'b'.repeat(64)}.png`, type: 'image' }];
  angry.media = [
    { key: `cas:${'c'.repeat(64)}.mp4`, type: 'video' },
    { key: `cas:${'d'.repeat(64)}.mp3`, type: 'audio' },
  ];
  tree.states = [base, angry];
  return tree;
}

describe('buildSubjectStackCards', () => {
  it('把各状态的图片/视频/音频映射成卡片，历史图不参与（只发当前资产）', () => {
    const cards = buildSubjectStackCards(makeTree());
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.sourceType).sort()).toEqual(['audio', 'image', 'video']);
    // 历史图（mediaHistory）不进画布，避免把废图也发出去
    expect(cards.some((c) => String(c.data.storageKey).includes('b'.repeat(64)))).toBe(false);
    for (const card of cards) {
      expect(String(card.data.storageKey).startsWith('cas:')).toBe(true);
      expect(card.data.status).toBe('success');
      expect(typeof card.data.subjectStateId).toBe('string');
      expect(card.data.subjectRootId).toBe(cards[0]?.data.subjectRootId);
    }
  });

  it('卡片标题带主体名与状态名', () => {
    const cards = buildSubjectStackCards(makeTree());
    expect(cards.some((c) => c.title === '老张 · 暴怒')).toBe(true);
  });

  it('没有任何媒体 → 不能发送（返回 null）', () => {
    const tree = createSubjectTree('character', '空主体');
    tree.states = [createSubjectNode('基础状态', 'image', 'user', tree.rootId, { step: 1 })];
    expect(buildSubjectStackNodeData(tree)).toBeNull();
  });

  it('节点数据带 subject 语义标记 + activeIndex', () => {
    const tree = makeTree();
    const data = buildSubjectStackNodeData(tree);
    expect(data?.subject).toEqual({ rootId: tree.rootId, name: '老张' });
    expect(data?.activeIndex).toBe(0);
  });
});
