/**
 * subject-stack-cards — 「发送到画布」的主体 → 堆叠卡片映射（2026-11-10）
 *
 * 语义：一个主体 = N 个资产（各状态的图片/视频/音频），复用堆叠节点框架承载；
 * 节点 data.subject 标记它是「主体节点」，卡片 data 里带 rootId/stateId 供点击回跳主体库。
 * 不复制文件，只引用 CAS storageKey。
 */
import type { StackCard } from '@zeroexo/plugin-nodes';
import type { SubjectTree } from './subject-tree-types';
import { SUBJECT_BASE_STATE_ID } from './subject-page-nav';

export interface SubjectStackNodeData {
  cards: StackCard[];
  activeIndex: number;
  /** 语义标记：这是主体节点，不是普通堆叠媒体 */
  subject: { rootId: string; name: string };
}

function stateLabel(stateId: string, stateName?: string): string {
  if (stateName?.trim()) return stateName.trim();
  return stateId === SUBJECT_BASE_STATE_ID ? '基础状态' : '状态';
}

/** 把一个主体的全部状态媒体映射成堆叠卡片（同内容同卡只为同一状态服务） */
export function buildSubjectStackCards(tree: SubjectTree): StackCard[] {
  const cards: StackCard[] = [];
  for (const state of tree.states ?? []) {
    for (const media of state.media ?? []) {
      if (!media?.key) continue;
      const kind: StackCard['sourceType'] = media.type === 'video' ? 'video' : media.type === 'audio' ? 'audio' : 'image';
      const label = stateLabel(state.id, state.state);
      cards.push({
        id: `subject-${tree.rootId}-${state.id}-${media.key}`,
        sourceType: kind,
        data: {
          // 只存引用：图片/视频/音频都由 storageKey 解析，绝不写 blob: 会话地址
          content: '',
          storageKey: media.key,
          status: 'success',
          subjectRootId: tree.rootId,
          subjectStateId: state.id,
          subjectStateName: label,
        },
        title: `${tree.name} · ${label}`,
        ...(kind === 'image' ? { size: { width: 340, height: 240 } } : {}),
      });
    }
  }
  return cards;
}

/** 主体为空（一个媒体都没有）时不允许发送，返回 null 让调用方提示 */
export function buildSubjectStackNodeData(tree: SubjectTree): SubjectStackNodeData | null {
  const cards = buildSubjectStackCards(tree);
  if (cards.length === 0) return null;
  return { cards, activeIndex: 0, subject: { rootId: tree.rootId, name: tree.name } };
}
