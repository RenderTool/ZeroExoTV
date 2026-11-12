/**
 * subject-send - 「发送资产到主体」统一执行器（2026-11-05 主体库页面化）
 *
 * 资产卡片/抽屉里的「发送到主体」都走这里，避免各写一套：
 * - 用户在主体状态页展开了某张状态卡的卡内编辑面板 → 直接绑定到该状态
 *   （linkSubjectStateMedia 唯一写入）→ 容器写回 → 广播外部写入事件（卡片缩略图即时刷新）
 *   → navigateToView('subject') 定位；
 * - 无正在编辑的状态 → 复用 openSubjectLinkDialog（主体→状态选择弹层）。
 *
 * 不复制文件、不新增写入路径；取不到目标状态时降级到选择弹层（不静默失败）。
 */
import { message } from 'antd';
import { readStoryboardContainer, updateStoryboardContainer } from '@/entities/slot-containers.js';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
import { getCurrentSubjectStateContext } from './subject-page-nav';
import { openSubjectLinkDialog, type SubjectLinkDialogPayload } from './subject-link-dialog';
import {
  linkSubjectStateMedia,
  useSubjectMediaLinkEventStore,
  type SubjectStateMediaAsset,
} from './subject-state-media';
import { migrateSubjectTrees, type SubjectTree } from './subject-tree-types';

export type SendAssetToSubjectResult = 'linked-current' | 'dialog';

function treesOf(container: Awaited<ReturnType<typeof readStoryboardContainer>>): SubjectTree[] {
  return migrateSubjectTrees(container?.subjectTree);
}

/** 发送资产到主体：有正在编辑的状态卡 → 直接绑定；否则弹主体→状态选择 */
export async function sendAssetToSubject(
  payload: SubjectLinkDialogPayload,
  opts: { notify?: (text: string) => void } = {},
): Promise<SendAssetToSubjectResult> {
  const ctx = getCurrentSubjectStateContext();
  if (!ctx) {
    openSubjectLinkDialog(payload);
    return 'dialog';
  }
  try {
    const container = await readStoryboardContainer(ctx.projectId);
    const trees = treesOf(container);
    const asset: SubjectStateMediaAsset = {
      storageKey: payload.storageKey,
      kind: payload.kind,
      origin: {
        type: payload.fromNodeId ? 'canvas' : 'library',
        fromNodeId: payload.fromNodeId,
        label: payload.sourceLabel,
      },
    };
    const { trees: linkedTrees } = await linkSubjectStateMedia({
      trees,
      projectId: ctx.projectId,
      rootId: ctx.rootId,
      stateId: ctx.stateId,
      asset,
    });
    await updateStoryboardContainer(ctx.projectId, { subjectTree: linkedTrees });
    useSubjectMediaLinkEventStore.getState().emit({ rootId: ctx.rootId, stateId: ctx.stateId });
    // 成功反馈 + 跳转到当前状态（已是当前页时只是重新定位，不闪跳）
    const text = `已发送到「${ctx.subjectName} · ${ctx.stateName}」`;
    if (opts.notify) opts.notify(text);
    else message.success(text);
    navigateToView('subject', {
      rootId: ctx.rootId,
      stateId: ctx.stateId,
      projectId: ctx.projectId,
    });
    return 'linked-current';
  } catch (err) {
    // 目标状态已被删除等并发情况：降级到选择弹层，不静默失败
    console.warn('[subject-send] direct link failed, fallback to dialog:', err);
    openSubjectLinkDialog(payload);
    return 'dialog';
  }
}
