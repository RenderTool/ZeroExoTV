/**
 * TaskQueuePanel — 抽屉内的任务队列（2026-11-15 用户指令）
 *
 * 任务队列不再浮在画布右下角，而是作为抽屉的独立按钮/分组：点开看排队、进度，
 * 运行中/排队中可手动取消；数据仍来自 MCP 任务表（刷新/换浏览器不丢）。
 */
import { useMemo } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2, Clapperboard, Image as ImageIcon, ListChecks, Loader2, Music, Upload, Video, X, XCircle, Ban,
} from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTaskQueueStore, countActiveTasks, type QueuedTask, type TaskKind } from './task-queue-store.js';
import { cancelBrokerTask } from './task-broker-client.js';
import { useTaskBrokerSync } from './use-task-broker.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';

const KIND_ICON: Record<TaskKind, React.ReactNode> = {
  image: <ImageIcon size={13} />,
  video: <Video size={13} />,
  audio: <Music size={13} />,
  text: <ListChecks size={13} />,
  upload: <Upload size={13} />,
  director: <Clapperboard size={13} />,
};

const STATUS_TEXT: Record<QueuedTask['status'], [string, string]> = {
  queued: ['taskQueue.queued', '排队中'],
  running: ['taskQueue.running', '生成中'],
  success: ['taskQueue.success', '已完成'],
  error: ['taskQueue.error', '失败'],
  cancelled: ['taskQueue.cancelled', '已取消'],
};

function StatusIcon({ status }: { status: QueuedTask['status'] }): React.ReactElement {
  if (status === 'success') return <CheckCircle2 size={13} color="#16a34a" />;
  if (status === 'error') return <XCircle size={13} color="#dc2626" />;
  if (status === 'cancelled') return <Ban size={13} color="#9ca3af" />;
  if (status === 'queued') return <ListChecks size={13} color="#9ca3af" />;
  return <Loader2 size={13} color="#2563eb" />;
}

export function TaskQueuePanel({ projectId }: { projectId?: string | null }): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const pid = projectId ?? getCurrentCanvasId();
  // 面板挂载即同步一次 MCP 任务表；打开抽屉就能看到刷新/其它浏览器发起的最新任务
  useTaskBrokerSync(pid);
  const tasks = useTaskQueueStore((s) => s.tasks);
  const clearFinished = useTaskQueueStore((s) => s.clearFinished);
  const active = useMemo(() => countActiveTasks(tasks), [tasks]);
  const isDark = theme.mode === 'dark';
  const muted = theme.toolbar.textMuted ?? '#78716c';
  const border = isDark ? theme.toolbar.border : '#e7e5e4';

  return (
    <div data-task-queue-panel style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: `1px solid ${border}`, fontSize: 12, color: theme.toolbar.text, flexShrink: 0,
      }}>
        <ListChecks size={14} />
        <span style={{ fontWeight: 600 }}>{t('taskQueue.title', '任务队列')}</span>
        <span style={{ color: muted }}>{active > 0 ? active : tasks.length}</span>
        <span style={{ flex: 1 }} />
        <Button size="small" type="text" onClick={clearFinished} disabled={tasks.length === 0} style={{ fontSize: 11, paddingInline: 4 }}>
          {t('taskQueue.clear', '清空已完成')}
        </Button>
      </div>
      <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1, minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '32px 14px', textAlign: 'center', color: muted, fontSize: 12 }}>
            {t('taskQueue.empty', '暂无任务')}
          </div>
        ) : tasks.map((task) => {
          const pct = task.progress && task.progress.totalSteps > 0
            ? Math.min(100, Math.round((task.progress.step / task.progress.totalSteps) * 100))
            : null;
          return (
            <div
              key={task.id}
              data-task-row={task.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px', fontSize: 12, color: theme.toolbar.text, borderBottom: `1px solid ${border}` }}
            >
              <span style={{ display: 'inline-flex', marginTop: 2, color: muted }}>{KIND_ICON[task.kind] ?? <ListChecks size={13} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>
                    {task.title}
                  </div>
                  {task.cancelable ? (
                    <button
                      type="button"
                      data-task-cancel={task.id}
                      title={t('taskQueue.cancel', '取消任务')}
                      onClick={() => { void cancelBrokerTask(task.id).catch(() => undefined); }}
                      style={{ border: 'none', background: 'transparent', color: muted, cursor: 'pointer', display: 'inline-flex', padding: 0, flexShrink: 0 }}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, color: muted, fontSize: 11 }}>
                  <StatusIcon status={task.status} />
                  <span>{t(STATUS_TEXT[task.status][0], STATUS_TEXT[task.status][1])}</span>
                  {task.status === 'running' && task.progress ? <span>· {task.progress.step}/{task.progress.totalSteps}</span> : null}
                  {task.phase ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {task.phase}</span> : null}
                  {task.status === 'error' && task.error ? (
                    <span style={{ color: '#dc2626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {task.error}</span>
                  ) : null}
                </div>
                {pct !== null && task.status === 'running' ? (
                  <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: '#2563eb', transition: 'width 0.2s' }} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
