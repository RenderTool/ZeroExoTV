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
      const uploadScope = resolveUploadScope('project', getCurrentCanvasId());
      // 三态上报：新建 / 去重用例 / 墓碑跳过，不再用一句「已导入」掩盖没新增（2026-11-16）
      const report = { created: [] as Asset[], dedupedExisting: [] as Asset[], skippedTombstone: [] as string[] };
      const handled = await addAssets(inputs.map((i) => ({ ...i, ...uploadScope })), report);
      for (const a of report.created) onAssetCreated(a.id);
      if (report.created.length > 0) {
        message.success(
          report.dedupedExisting.length > 0
            ? `已导入 ${report.created.length} 个，另有 ${report.dedupedExisting.length} 个已存在直接复用`
            : t('director.importDone', '已导入 {{count}} 个资产', { count: report.created.length }),
        );
      } else if (report.dedupedExisting.length > 0) {
        message.info(`${report.dedupedExisting.length} 个资产已存在，已复用（不产生重复记录）`);
      } else if (report.skippedTombstone.length > 0) {
        message.warning('这些资产此前被删除过，不会重建；如需恢复请用「撤销删除」');
      } else {
        message.warning(`上传链路没有产出记录（解析出 ${inputs.length} 个、入账 ${handled.length} 个），请检查数据目录与服务状态`);
      }
      return handled;
    } catch (err) {
      console.warn('[upload] cas-upload 失败', err);
      message.error(err instanceof Error ? err.message : t('asset.uploadFailed', '上传失败'));
      return [];
    }
  }, [uploadFiles, message, t]);
}
