/**
 * TaskQueueDock — 右下角任务队列窗口（2026-11-10 用户要求）
 *
 * 画布、导演台、图片编辑器发起的生成/上传都登记在 task-queue-store，
 * 这里只负责展示排队情况：可收起、显示进度、清空已完成。挂在 app 根节点，跨页签常驻。
 */
import { useMemo } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2, ChevronDown, ChevronUp, Clapperboard, Image as ImageIcon, ListChecks,
  Loader2, Music, Upload, Video, XCircle, Ban,
} from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTaskQueueStore, countActiveTasks, type QueuedTask, type TaskKind } from './task-queue-store.js';

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

export function TaskQueueDock(): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const tasks = useTaskQueueStore((s) => s.tasks);
  const collapsed = useTaskQueueStore((s) => s.collapsed);
  const setCollapsed = useTaskQueueStore((s) => s.setCollapsed);
  const clearFinished = useTaskQueueStore((s) => s.clearFinished);
  const active = useMemo(() => countActiveTasks(tasks), [tasks]);
  if (tasks.length === 0) return null;

  const isDark = theme.mode === 'dark';
  const bg = isDark ? theme.toolbar.panel : '#ffffff';
  const border = isDark ? theme.toolbar.border : '#e7e5e4';
  const muted = theme.toolbar.textMuted ?? '#78716c';

  if (collapsed) {
    return (
      <button
        type="button"
        data-task-queue-toggle
        onClick={() => setCollapsed(false)}
        title={t('taskQueue.open', '展开任务队列')}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 9000,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 12px', borderRadius: 16,
          border: `1px solid ${border}`, background: bg, color: theme.toolbar.text,
          boxShadow: '0 4px 14px rgba(0,0,0,0.14)', cursor: 'pointer', fontSize: 12,
        }}
      >
        <ListChecks size={14} />
        {t('taskQueue.pill', '任务')}
        {active > 0 ? <span style={{ color: '#2563eb', fontWeight: 600 }}>{active}</span> : null}
        <ChevronUp size={13} />
      </button>
    );
  }

  return (
    <div
      data-task-queue-panel
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 9000,
        width: 300, maxHeight: 340, display: 'flex', flexDirection: 'column',
        borderRadius: 12, border: `1px solid ${border}`, background: bg,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)', overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderBottom: `1px solid ${border}`, fontSize: 12, color: theme.toolbar.text,
      }}>
        <ListChecks size={14} />
        <span style={{ fontWeight: 600 }}>{t('taskQueue.title', '任务队列')}</span>
        <span style={{ color: muted }}>{active > 0 ? active : tasks.length}</span>
        <span style={{ flex: 1 }} />
        <Button size="small" type="text" onClick={clearFinished} style={{ fontSize: 11, paddingInline: 4 }}>
          {t('taskQueue.clear', '清空已完成')}
        </Button>
        <button
          type="button"
          data-task-queue-toggle
          title={t('taskQueue.collapse', '收起')}
          onClick={() => setCollapsed(true)}
          style={{ border: 'none', background: 'transparent', color: muted, cursor: 'pointer', display: 'inline-flex', padding: 2 }}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <div style={{ overflowY: 'auto', padding: '4px 0' }}>
        {tasks.map((task) => {
          const pct = task.progress && task.progress.totalSteps > 0
            ? Math.min(100, Math.round((task.progress.step / task.progress.totalSteps) * 100))
            : null;
          return (
            <div
              key={task.id}
              data-task-row={task.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', fontSize: 12, color: theme.toolbar.text }}
            >
              <span style={{ display: 'inline-flex', marginTop: 2, color: muted }}>{KIND_ICON[task.kind] ?? <ListChecks size={13} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>
                  {task.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, color: muted, fontSize: 11 }}>
                  <StatusIcon status={task.status} />
                  <span>{t(STATUS_TEXT[task.status][0], STATUS_TEXT[task.status][1])}</span>
                  {task.status === 'running' && task.progress ? (
                    <span>· {task.progress.step}/{task.progress.totalSteps}</span>
                  ) : null}
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
