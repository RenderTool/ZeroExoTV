/**
 * delete-with-undo - 资产就地删除 + 3 秒撤销浮层（2026-11-05 需求定稿）
 *
 * 行为：项目里看到公共资产即可就地删除，不必跳回公共库。
 * 两个表面（画布抽屉 / 资产库弹窗）共用这一套删除实现：
 * - 复用公共库同一 removeAssets（作用域仍是公共库本身，不做权限收窄）；
 * - 删完 3 秒浮层 + 「撤销」（restoreAssets 原样恢复），与槽位移除同口径；
 * - 若资产在当前项目导演台仍被引用，浮层里带「有 N 处引用已失效」——只提示、不阻断、不用确认框。
 */

import type { TFunction } from 'i18next';
import type { Asset } from '@/features/asset-picker/index.js';
import { removeAssets, restoreAssets } from '@/features/asset-picker/asset-store.js';
import { countWorkbenchReferences } from '@/entities/slot-containers.js';
import { detachDeletedShotVersions } from '@/entities/workbench-version-detach.js';

/** antd MessageInstance 的最小面（App.useApp().message 即满足） */
export interface UndoMessageLike {
  open: (config: {
    key?: string;
    content: React.ReactNode;
    duration?: number;
    type?: 'success' | 'info' | 'warning' | 'error' | 'loading';
    onClose?: () => void;
  }) => void;
  success?: (content: React.ReactNode, duration?: number) => void;
  destroy?: (key?: string) => void;
}

export interface DeleteWithUndoArgs {
  /** 待删资产（抽屉/弹窗传入完整记录） */
  assets: Asset[];
  /** 当前项目 id；无项目上下文（主页公共库）时不统计引用 */
  projectId: string | null;
  /** antd message 实例（3 秒撤销浮层载体） */
  message: UndoMessageLike;
  t: TFunction;
  /** 撤销成功后的刷新回调（各表面自己刷列表） */
  onRestored: () => void;
}

/** 就地删除 + 撤销浮层。删除失败（未删到记录）时静默返回 0。 */
export async function deleteAssetsWithUndo(args: DeleteWithUndoArgs): Promise<number> {
  if (args.assets.length === 0) return 0;
  const ids = args.assets.map((a) => a.id);

  const deleted = await removeAssets(ids);

  // 2026-11-16 用户要求：删掉历史版本 = 片段自己也回到对应状态；
  // 否则预览仍显示旧成片、卡片仍「已完成」，刷新后这一版还会从片段缓存里冒出来。
  // 注意：历史分组里的「版本卡」是 shot.cache.versions 的投影，其 id 不一定是资产记录 id，
  // removeAssets 可能匹配不到（deleted 为空）；此时仍要按 storageKey 摘缓存，否则必定「刷新又回来」。
  if (args.projectId) {
    const source = deleted.length > 0 ? deleted : args.assets;
    const refs = source
      .map((a) => ({
        shotId: String((a.data as { originNodeId?: string } | undefined)?.originNodeId ?? ''),
        storageKey: String((a.data as { storageKey?: string } | undefined)?.storageKey ?? ''),
      }))
      .filter((r) => r.storageKey);
    if (refs.length > 0) {
      await detachDeletedShotVersions(args.projectId, refs).catch(() => undefined);
    }
  }

  if (deleted.length === 0) return 0;

  const refCount = args.projectId
    ? await countWorkbenchReferences(args.projectId, ids).catch(() => 0)
    : 0;

  const toastKey = `asset-undo-${ids.join('-')}`;
  const t = args.t;
  const title = deleted.length === 1
    ? t('assetLibrary.deletedOne', { defaultValue: '已删除「{{name}}」', name: deleted[0]?.title ?? '' })
    : t('assetLibrary.deletedMany', { defaultValue: '已删除 {{count}} 个素材', count: deleted.length });
  const refsNote = refCount > 0
    ? t('assetLibrary.refsInvalidated', { defaultValue: '，有 {{count}} 处引用已失效', count: refCount })
    : '';

  args.message.open({
    key: toastKey,
    type: 'info',
    duration: 3,
    content: (
      <span>
        {title}
        {refsNote}
        <a
          style={{ marginLeft: 12, fontWeight: 600 }}
          onClick={() =>
            (async () => {
              await restoreAssets(deleted);
              args.onRestored();
              args.message.destroy?.(toastKey);
              args.message.success?.(
                t('assetLibrary.deleteUndone', { defaultValue: '已撤销删除' }),
              );
            })()
          }
        >
          {t('assetLibrary.undoDelete', { defaultValue: '撤销' })}
        </a>
      </span>
    ),
  });
  return deleted.length;
}
