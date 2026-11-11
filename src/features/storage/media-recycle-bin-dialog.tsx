/**
 * MediaRecycleBinDialog — 孤立媒体回收站（2026-11-10 用户要求）
 *
 * 只做三件事：扫描未引用媒体并移入回收站、恢复某一条、彻底删除（立即或过期）。
 * 移入前就能看到来源、大小、时间；保留 30 天，过期由定时任务清理（见 app.tsx）。
 */
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Modal, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Trash2, Undo2 } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import {
  RECYCLE_RETENTION_DAYS,
  clearRecycleBin,
  formatBytes,
  listRecycleItems,
  purgeRecycleItem,
  restoreRecycleItem,
  sweepOrphansToRecycle,
  type RecycleItem,
} from '@/entities/media-recycle-bin.js';

export function MediaRecycleBinDialog({
  open,
  onClose,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  theme: ThemeConfig;
}): React.ReactElement {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setItems(await listRecycleItems());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const handleSweep = useCallback(async () => {
    setBusy(true);
    try {
      const res = await sweepOrphansToRecycle();
      if (res.moved > 0) message.success(t('recycle.swept', '已移入回收站 {{n}} 个文件', { n: res.moved }));
      else message.info(t('recycle.nothing', '没有发现未引用的媒体文件'));
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('recycle.sweepFailed', '扫描失败'));
    } finally {
      setBusy(false);
    }
  }, [message, refresh, t]);

  const handleRestore = useCallback(async (item: RecycleItem) => {
    try {
      await restoreRecycleItem(item.id);
      message.success(t('recycle.restored', '已恢复'));
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('recycle.restoreFailed', '恢复失败'));
    }
  }, [message, refresh, t]);

  const handlePurge = useCallback((item: RecycleItem) => {
    modal.confirm({
      centered: true,
      title: t('recycle.purgeTitle', '彻底删除这个文件？'),
      content: t('recycle.purgeDesc', '文件会被永久删除，无法恢复。'),
      okType: 'danger',
      okText: t('recycle.purgeOk', '彻底删除'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        await purgeRecycleItem(item.id);
        message.success(t('recycle.purged', '已彻底删除'));
        await refresh();
      },
    });
  }, [message, modal, refresh, t]);

  const handleClear = useCallback(() => {
    modal.confirm({
      centered: true,
      title: t('recycle.clearTitle', '清空回收站？'),
      content: t('recycle.clearDesc', '回收站里的全部文件会被永久删除，无法恢复。'),
      okType: 'danger',
      okText: t('recycle.clearOk', '清空'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        const n = await clearRecycleBin();
        message.success(t('recycle.cleared', '已清空 {{n}} 个文件', { n }));
        await refresh();
      },
    });
  }, [message, modal, refresh, t]);

  const columns: ColumnsType<RecycleItem> = [
    {
      title: t('recycle.name', '文件'),
      dataIndex: 'name',
      ellipsis: true,
      render: (_v, item) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.originalPath}>
            {item.name}
          </span>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }} title={item.originalPath}>
            {item.originalPath}
          </span>
        </div>
      ),
    },
    {
      title: t('recycle.source', '来源'),
      dataIndex: 'source',
      width: 170,
      render: (_v, item) => (
        <Tag color={item.source === 'cas' ? 'orange' : 'default'} style={{ marginInlineEnd: 0 }}>
          {item.source === 'cas' ? t('recycle.sourceCas', '索引外残留') : t('recycle.sourceEmpty', '零引用条目')}
        </Tag>
      ),
    },
    { title: t('recycle.size', '大小'), dataIndex: 'size', width: 90, render: (v: number) => formatBytes(v) },
    {
      title: t('recycle.deletedAt', '移入时间'),
      dataIndex: 'deletedAt',
      width: 150,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: t('recycle.expiresAt', '到期'),
      dataIndex: 'expiresAt',
      width: 110,
      render: (v: string) => new Date(v).toLocaleDateString(),
    },
    {
      title: '',
      key: 'actions',
      width: 96,
      render: (_v, item) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <Button size="small" type="text" icon={<Undo2 size={13} />} title={t('recycle.restore', '恢复')} aria-label={t('recycle.restore', '恢复')} onClick={() => void handleRestore(item)} />
          <Button size="small" type="text" danger icon={<Trash2 size={13} />} title={t('recycle.purge', '彻底删除')} aria-label={t('recycle.purge', '彻底删除')} onClick={() => handlePurge(item)} />
        </div>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={680}
      title={t('recycle.title', '媒体回收站')}
      // 数据多时弹窗不能超过视口：固定正文高度上限 + 内置滚动，footer 常驻可见
      styles={{ body: { paddingTop: 8, maxHeight: 'min(60vh, 520px)', overflowY: 'auto' } }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('recycle.retention', '保留 {{days}} 天，到期自动清理；移入前可查看来源、大小、时间', { days: RECYCLE_RETENTION_DAYS })}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button icon={<RefreshCw size={13} />} loading={busy} onClick={() => void handleSweep()}>
              {t('recycle.sweep', '扫描未引用媒体')}
            </Button>
            <Button danger disabled={items.length === 0} onClick={handleClear}>
              {t('recycle.clear', '清空回收站')}
            </Button>
            <Button type="primary" onClick={onClose}>{t('common.close', '关闭')}</Button>
          </span>
        </div>
      }
    >
      <Table<RecycleItem>
        size="small"
        rowKey="id"
        dataSource={items}
        columns={columns}
        pagination={items.length > 10 ? { pageSize: 10, size: 'small' } : false}
        locale={{ emptyText: t('recycle.empty', '回收站是空的（只收录已确认没人引用的媒体）') }}
      />
    </Modal>
  );
}
