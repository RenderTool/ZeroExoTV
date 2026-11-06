/**
 * send-to-workbench - 抽屉「发送到导演台当前片段」执行器（2026-11-05 约定）
 *
 * 判定链（全部零 UI 副作用先判后写）：
 * 1) 读宿主快照 getWorkbenchSendContext（导演台未打开/无选中片段 → 提示，不静默）；
 * 2) computeSegmentInsert（assignAssetSlots 唯一槽位分配）；
 * 3) ok → emitWorkbenchAddRef（宿主 updateShot references 落盘，槽位区缩略图自然出现）。
 * 铁律：满员/无选中/重复 → 不入槽、不改任何现有槽位、不改提示词正文。
 */

import type { TFunction } from 'i18next';
import type { Asset } from '@/features/asset-picker/index.js';
import { computeSegmentInsert, emitWorkbenchAddRef } from '@/features/canvas-tabs/workbench-slot-bus.js';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
import { getWorkbenchSendContext } from './workbench-send.js';

interface MessageLike {
  success: (c: string) => void;
  warning: (c: string) => void;
  info: (c: string) => void;
}

export function sendAssetToWorkbench(asset: Asset, message: MessageLike, t: TFunction): void {
  const snap = getWorkbenchSendContext();
  if (!snap || !snap.activeShotId) {
    message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
    return;
  }
  const verdict = computeSegmentInsert({
    asset,
    hasActiveShot: true,
    tier: snap.tier,
    segmentAssets: snap.segmentAssets,
  });

  if (!verdict.ok) {
    switch (verdict.reason) {
      case 'no-active-shot':
        message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
        return;
      case 'unsupported-kind':
        message.warning(t('workbench.unsupportedKind', '该素材类型不支持入导演台槽位'));
        return;
      case 'already-in-slot':
        message.info(t('workbench.slotReused', '该资产已在当前片段素材池，复用原槽位'));
        // 已在槽位语义上等于「已送达」——同样跳转导演台并聚焦当前片段（2026-11-05 发送即跳转）
        navigateToView('director', { shotId: snap.activeShotId ?? undefined, projectId: snap.projectId });
        return;
      case 'slot-full': {
        const label = asset.data.kind === 'video' ? '视频' : asset.data.kind === 'audio' ? '音频' : '图片';
        message.warning(t('workbench.slotFull', '{{kind}}槽位已满（{{used}}/{{cap}}），请先在素材区移除或替换一个素材', {
          kind: label, used: verdict.used, cap: verdict.cap,
        }));
        return;
      }
    }
    return;
  }

  // 事件目标 = 当前导演台宿主（快照的 projectId），不是资产自身归属——
  // 开源库导入资产 scope='library' 无 projectId，按资产归属发 '' 会被宿主
  // projectId 过滤静默丢弃（2026-11-05 修复：提示成功但槽位无变化）
  const delivered = emitWorkbenchAddRef({
    assetId: asset.id,
    ref: verdict.ref,
    projectId: snap.projectId,
  });
  if (delivered) {
    message.success(t('workbench.addedToSegment', '已送入当前片段素材池（{{label}}）', { label: verdict.slotLabel }));
    // 发送到导演台 = 跳转导演台并聚焦当前片段（2026-11-05 约定：发送目标即跳转目标）
    navigateToView('director', { shotId: snap.activeShotId ?? undefined, projectId: snap.projectId });
  } else {
    message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
  }
}
