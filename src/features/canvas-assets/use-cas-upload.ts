/**
 * use-cas-upload - 「导入资产到 CAS」统一入口（2026-11-05 @ 面板空态导入按钮用）
 *
 * 与画布素材抽屉 MaterialGroup.handleUpload 同一条链，不新写存储：
 * UploadQueue（并发 5/重试 2）→ useAssetUploadQueue.uploadFiles → asset-store.addAssets
 * 落 CAS → onAssetCreated 同步事件 → useAssets 订阅方（导演台 @ 面板等）自动刷新。
 * 归属口径：本项目段（resolveUploadScope('project', 当前画布)，无画布上下文兜底公共库）。
 */
import { useCallback, useRef } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { addAssets, resolveUploadScope } from '@/features/asset-picker/asset-store.js';
import { useAssetUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import type { Asset } from '@/features/asset-picker/index.js';

export function useCasUpload(): (files: FileList | File[]) => Promise<Asset[]> {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const { uploadFiles } = useAssetUploadQueue(uploadQueueRef.current);
  return useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return [];
    try {
      const inputs = await uploadFiles(list);
      if (inputs.length === 0) {
        message.warning(t('asset.uploadFailedAll', '全部文件上传失败'));
        return [];
      }
      const uploadScope = resolveUploadScope('project', getCurrentCanvasId());
      const created = await addAssets(inputs.map((i) => ({ ...i, ...uploadScope })));
      for (const a of created) onAssetCreated(a.id);
      message.success(t('director.importDone', '已导入 {{count}} 个资产', { count: created.length }));
      return created;
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('asset.uploadFailed', '上传失败'));
      return [];
    }
  }, [uploadFiles, message, t]);
}
