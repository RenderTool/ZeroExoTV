/**
 * send-to-workbench - 抽屉「发送到导演台」执行器（2026-11-05 约定）
 *
 * 判定链（全部零 UI 副作用先判后写）：
 * 1) 读宿主快照 getWorkbenchSendContext（导演台未打开/无选中片段 → 提示，不静默）；
 * 2) computeSegmentInsert（assignAssetSlots 唯一槽位分配）；
 * 3) ok → emitWorkbenchAddRef（宿主 updateShot references 落盘，槽位区缩略图自然出现）。
 * 铁律：满员/无选中/重复 → 不入槽、不改任何现有槽位、不改提示词正文。
 *
 * mode=guide：引导是视频的附带变体，进 WorkbenchShot.guide 独立槽，不占 9 格。
 */

import type { TFunction } from 'i18next';
import type { Asset } from '@/features/asset-picker/index.js';
import type { GuideMeta } from '@/features/asset-picker/index.js';
import { getGuideMeta } from '@/features/asset-picker/guide.js';
import { resolveGuideForAsset } from '@/features/asset-picker/services/guide-resolve.js';
import { computeSegmentInsert, emitWorkbenchAddRef, emitWorkbenchSetGuide } from '@/features/canvas-tabs/workbench-slot-bus.js';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
import { getWorkbenchSendContext } from './workbench-send.js';

interface MessageLike {
  success: (c: string) => void;
  warning: (c: string) => void;
  info: (c: string) => void;
}

export interface SendAssetToWorkbenchOptions {
  /** 发送内容：video（默认）= 媒体本身进参考槽；guide = 视频附带引导进片段引导槽 */
  mode?: 'video' | 'guide';
}

function guideOf(asset: Asset): GuideMeta | undefined {
  return getGuideMeta(asset.data);
}

/**
 * 历史/素材卡「发送引导到导演台」：存量产物没有 data.guide 时按 jobId 回查并回写，
 * 引导进片段独立槽，不占 9 个标准素材槽；重复发送即替换。
 */
export async function sendGuideToWorkbench(
  asset: Asset,
  message: MessageLike,
  t: TFunction,
): Promise<void> {
  const snap = getWorkbenchSendContext();
  if (!snap || !snap.activeShotId) {
    message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
    return;
  }
  let guide = guideOf(asset);
  if (!guide) {
    message.info(t('workbench.guideResolving', '正在查找引导…'));
    guide = (await resolveGuideForAsset(asset)) ?? undefined;
  }
  if (!guide) {
    message.warning(t('workbench.guideMissing', '该素材没有引导'));
    return;
  }
  const data = asset.data as { storageKey?: string; url?: string };
  const delivered = emitWorkbenchSetGuide({
    guide: {
      id: guide.id,
      title: asset.title,
      frames: guide.frames,
      sha256: guide.sha256,
      fromAssetId: asset.id,
      storageKey: data.storageKey,
      url: data.url,
      createdAt: new Date().toISOString(),
    },
    projectId: snap.projectId,
  });
  if (delivered) {
    message.success(t('workbench.guideSent', '已发送引导'));
    navigateToView('director', { shotId: snap.activeShotId ?? undefined, projectId: snap.projectId });
  } else {
    message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
  }
}

export function sendAssetToWorkbench(
  asset: Asset,
  message: MessageLike,
  t: TFunction,
  opts?: SendAssetToWorkbenchOptions,
): void {
  if (opts?.mode === 'guide') {
    void sendGuideToWorkbench(asset, message, t);
    return;
  }
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
        message.info(t('workbench.slotReused', '已在导演台，无需重复发送'));
        navigateToView('director', { shotId: snap.activeShotId ?? undefined, projectId: snap.projectId });
        return;
      case 'slot-full': {
        const label = asset.data.kind === 'video' ? '视频' : asset.data.kind === 'audio' ? '音频' : '图片';
        message.warning(t('workbench.slotFull', '{{kind}}槽位已满（{{used}}/{{cap}}），请先移除或替换一个素材', {
          kind: label, used: verdict.used, cap: verdict.cap,
        }));
        return;
      }
    }
    return;
  }

  const delivered = emitWorkbenchAddRef({
    assetId: asset.id,
    ref: verdict.ref,
    projectId: snap.projectId,
  });
  if (delivered) {
    message.success(t('workbench.addedToSegment', '已发送到导演台'));
    navigateToView('director', { shotId: snap.activeShotId ?? undefined, projectId: snap.projectId });
  } else {
    message.warning(t('workbench.noActiveShot', '请先在导演台选中一个片段'));
  }
}
