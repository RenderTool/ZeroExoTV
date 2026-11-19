/**
 * 画布历史版本（2026-11-19 数据安全）
 *
 * 主画布每次写盘成功都会在 projects/<pid>/canvases/history/ 追加只读快照。
 * 这里只做两件事：列出快照、把选中的快照写回主 graph（再刷新页面加载）。
 * 不提供删除入口——历史版本只增不减（由写入侧按数量轮转）。
 */
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Modal, Tag, Tooltip } from 'antd';
import { Bookmark, History, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listDir, readJson } from '@/platform/fs.js';
import { saveManualSnapshot } from '@/platform/history-snapshots.js';
import { loadProjectGraph, saveProjectGraph } from '@zeroexo/plugin-persistence';

interface SnapshotItem {
  name: string;
  at: string;
  nodeCount: number;
  edgeCount: number;
  manual: boolean;
  label: string;
}

export interface CanvasHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
}

function dirOf(projectId: string): string {
  return `projects/${projectId}/canvases/history`;
}

export function CanvasHistoryDialog({ open, onClose, projectId }: CanvasHistoryDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const entries = await listDir(dirOf(projectId)).catch(() => []);
      const files = entries
        .filter((e) => e.kind === 'file' && e.name.endsWith('.json')
          && (e.name.startsWith('main-') || e.name.startsWith('manual-')))
        .map((e) => e.name)
        .sort()
        .reverse();
      const rows: SnapshotItem[] = [];
      for (const name of files) {
        const meta = await readJson<{ at?: string; nodeCount?: number; manual?: boolean; label?: string; graph?: { nodes?: unknown[]; edges?: unknown[] } }>(`${dirOf(projectId)}/${name}`).catch(() => null);
        if (!meta) continue;
        rows.push({
          name,
          at: typeof meta.at === 'string' ? meta.at : '',
          nodeCount: meta.nodeCount ?? meta.graph?.nodes?.length ?? 0,
          edgeCount: meta.graph?.edges?.length ?? 0,
          manual: Boolean(meta.manual) || name.startsWith('manual-'),
          label: typeof meta.label === 'string' ? meta.label : '',
        });
      }
      // 手动存档点永远排在自动快照前面
      rows.sort((a, b) => (Number(b.manual) - Number(a.manual)) || b.name.localeCompare(a.name));
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const createManual = useCallback(async () => {
    try {
      const graph = await loadProjectGraph(projectId);
      if (!graph?.nodes?.length) {
        message.warning(t('canvasHistory.emptyGraph', '当前画布没有节点，无法创建存档点'));
        return;
      }
      await saveManualSnapshot(projectId, graph);
      message.success(t('canvasHistory.manualCreated', '已创建存档点'));
      await refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, message, t, refresh]);

  const restore = (item: SnapshotItem): void => {
    modal.confirm({
      title: t('canvasHistory.restoreTitle', '恢复到这个版本？'),
      content: t('canvasHistory.restoreBody', '{{time}} · {{n}} 个节点。当前画布会被这个版本替换，页面随后自动刷新。', {
        time: item.at ? new Date(item.at).toLocaleString() : item.name,
        n: item.nodeCount,
      }),
      okText: t('canvasHistory.restoreOk', '恢复并刷新'),
      cancelText: t('common.cancel', '取消'),
      onOk: async () => {
        const snap = await readJson<{ graph?: { nodes?: unknown[]; edges?: unknown[] } }>(`${dirOf(projectId)}/${item.name}`);
        if (!snap?.graph || !Array.isArray(snap.graph.nodes)) {
          message.error(t('canvasHistory.badSnapshot', '这个快照内容不完整，未恢复'));
          return;
        }
        await saveProjectGraph(projectId, snap.graph as never);
        message.success(t('canvasHistory.restored', '已恢复，正在刷新'));
        window.setTimeout(() => window.location.reload(), 400);
      },
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <History size={16} /> {t('canvasHistory.title', '画布历史版本')}
        </span>
      )}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, color: 'var(--z-text-muted, #6b7280)', fontSize: 12 }}>
          {t('canvasHistory.hint', '自动快照最多 40 份；手动存档点单独保留 20 份，不会被自动快照挤掉。')}
        </div>
        <Button size="small" type="primary" icon={<Bookmark size={13} />} onClick={() => void createManual()}>
          {t('canvasHistory.createManual', '创建存档点')}
        </Button>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--z-text-muted, #6b7280)' }}>
          {loading ? t('common.loading', '加载中…') : t('canvasHistory.empty', '还没有历史版本：先在画布上改一次，保存成功后自动生成')}
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it) => (
            <div
              key={it.name}
              data-canvas-snapshot={it.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--z-border, rgba(0,0,0,0.08))',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {it.at ? new Date(it.at).toLocaleString() : it.name}
                  {it.manual ? (
                    <Tooltip title={t('canvasHistory.manualTip', '手动存档点，不会被自动快照轮转删除')}>
                      <Tag color="blue" style={{ marginInlineEnd: 0 }}>{t('canvasHistory.manualTag', '存档点')}</Tag>
                    </Tooltip>
                  ) : null}
                </div>
                <div style={{ fontSize: 11, color: 'var(--z-text-muted, #6b7280)' }}>
                  {t('canvasHistory.counts', '{{n}} 节点 · {{e}} 连线', { n: it.nodeCount, e: it.edgeCount })}
                </div>
              </div>
              <Button size="small" icon={<RotateCcw size={13} />} onClick={() => restore(it)}>
                {t('canvasHistory.restore', '恢复')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
