/**
 * TaskQueuePanel — 抽屉内的任务队列（2026-11-15 用户指令）
 *
 * 只做三件事：进行中/排队中的任务排在最上面并可取消；已结束的折叠在后面；
 * 错误只给人话，不把 ComfyUI 的原始 JSON 直接糊在列表里。
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2, Clapperboard, Image as ImageIcon, ListChecks, Loader2, Music, Upload, Video, X, XCircle, Ban,
} from 'lucide-react';
import { Switch } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { useMcpBannerVisible } from '@/features/project-log/mcp-banner-visibility.js';
import { ProjectMemorySection } from '@/features/project-log/project-memory-section.js';
import { useTaskQueueStore, countActiveTasks, type QueuedTask, type TaskKind } from './task-queue-store.js';
import { cancelBrokerTask } from './task-broker-client.js';
import { cancelPluginTask, deletePluginTask } from './plugin-task-client.js';
import { usePluginTaskQueue } from './use-plugin-task-queue.js';
import { useTaskBrokerSync } from './use-task-broker.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';

const KIND_ICON: Record<TaskKind, React.ReactNode> = {
  image: <ImageIcon size={12} />,
  video: <Video size={12} />,
  audio: <Music size={12} />,
  text: <ListChecks size={12} />,
  upload: <Upload size={12} />,
  director: <Clapperboard size={12} />,
};

const STATUS_COLOR: Record<QueuedTask['status'], string> = {
  queued: '#9ca3af',
  running: '#2563eb',
  success: '#16a34a',
  error: '#dc2626',
  cancelled: '#9ca3af',
};

function StatusIcon({ status }: { status: QueuedTask['status'] }): React.ReactElement {
  if (status === 'success') return <CheckCircle2 size={12} color={STATUS_COLOR.success} />;
  if (status === 'error') return <XCircle size={12} color={STATUS_COLOR.error} />;
  if (status === 'cancelled') return <Ban size={12} color={STATUS_COLOR.cancelled} />;
  if (status === 'queued') return <ListChecks size={12} color={STATUS_COLOR.queued} />;
  return <Loader2 size={12} color={STATUS_COLOR.running} />;
}

/** 原始错误 → 一行能看懂的话（完整错误放 title 里，不占列表） */
function friendlyError(raw?: string): string {
  if (!raw) return '';
  if (/prompt_outputs_failed_validation|队列拒绝|Value -1|seed/i.test(raw)) {
    return '参数校验未通过，请检查提示词、引导或尺寸后重试';
  }
  if (/原子写失败|EPERM|EBUSY|rename/i.test(raw)) return '任务状态写入失败，请重试';
  if (/下载视频失败|download/i.test(raw)) return '成品下载失败，请检查 ComfyUI 连接';
  const one = raw.replace(/\s+/g, ' ').trim();
  return one.length > 72 ? `${one.slice(0, 72)}…` : one;
}

function statusLine(task: QueuedTask, t: ReturnType<typeof useTranslation>['t']): string {
  if (task.status === 'running') {
    return `${t('taskQueue.running', '生成中')}${task.phase ? ` · ${task.phase}` : ''}${task.progress ? ` · 采样 ${task.progress.step}/${task.progress.totalSteps}` : ''}`;
  }
  if (task.status === 'queued') return `${t('taskQueue.queued', '排队中')}${task.phase ? ` · ${task.phase}` : ''}`;
  if (task.status === 'success') return t('taskQueue.success', '已完成');
  if (task.status === 'cancelled') return t('taskQueue.cancelled', '已取消');
  return t('taskQueue.error', '失败');
}

export function TaskQueuePanel({ projectId }: { projectId?: string | null }): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const pid = projectId ?? getCurrentCanvasId();
  usePluginTaskQueue(pid);
  // MCP 发起的任务落在本地 broker 任务表（8790 /tasks）：云端插件不可达时也必须看得见
  useTaskBrokerSync(pid);
  const [mcpBanner, setMcpBanner] = useMcpBannerVisible();
  const tasks = useTaskQueueStore((s) => s.tasks);
  const clearFinished = useTaskQueueStore((s) => s.clearFinished);
  const active = useMemo(() => countActiveTasks(tasks), [tasks]);
  const ordered = useMemo(() => {
    const rank = (s: QueuedTask['status']): number => (s === 'running' ? 0 : s === 'queued' ? 1 : 2);
    return [...tasks].sort((a, b) => rank(a.status) - rank(b.status) || b.startedAt - a.startedAt);
  }, [tasks]);
  const running = ordered.filter((x) => x.status === 'running' || x.status === 'queued');
  const finished = ordered.filter((x) => x.status !== 'running' && x.status !== 'queued');
  const isDark = theme.mode === 'dark';
  const muted = theme.toolbar.textMuted ?? '#78716c';
  const border = isDark ? theme.toolbar.border : '#e7e5e4';
  const rowBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  const renderRow = (task: QueuedTask): React.ReactElement => {
    const pct = task.progress && task.progress.totalSteps > 0
      ? Math.min(100, Math.round((task.progress.step / task.progress.totalSteps) * 100))
      : null;
    const isActive = task.status === 'running' || task.status === 'queued';
    return (
      <div
        key={task.id}
        data-task-row={task.id}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px',
          margin: '0 10px 6px', borderRadius: 8, background: rowBg,
          opacity: isActive ? 1 : 0.68, fontSize: 12, color: theme.toolbar.text,
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          width: 22, height: 22, borderRadius: 6, marginTop: 1,
          color: STATUS_COLOR[task.status], background: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
          border: `1px solid ${border}`,
        }}>
          {KIND_ICON[task.kind] ?? <ListChecks size={12} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }} title={task.title}>
              {task.title}
            </span>
            {task.cancelable ? (
              <button
                type="button"
                data-task-cancel={task.id}
                title={t('taskQueue.cancel', '取消任务')}
                onClick={() => {
                  const cancel = task.source === 'plugin' ? cancelPluginTask : cancelBrokerTask;
                  void cancel(task.id).catch(() => undefined);
                }}
                style={{ border: 'none', background: 'transparent', color: muted, cursor: 'pointer', display: 'inline-flex', padding: 0, flexShrink: 0 }}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, color: muted, fontSize: 11, minWidth: 0 }}>
            <StatusIcon status={task.status} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {statusLine(task, t)}
            </span>
          </div>
          {task.status === 'error' && task.error ? (
            <div
              title={task.error}
              style={{ marginTop: 3, fontSize: 11, color: '#dc2626', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {friendlyError(task.error)}
            </div>
          ) : null}
          {isActive && pct !== null ? (
            <div style={{ marginTop: 5, height: 3, borderRadius: 2, background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: '#2563eb', transition: 'width 0.2s' }} />
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div data-task-queue-panel style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px 0',
        fontSize: 13, fontWeight: 600, color: theme.toolbar.text, flexShrink: 0,
      }}>

        <span>{t('taskQueue.title', '任务队列')}</span>
        {active > 0 ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
            background: '#2563eb', color: '#fff', fontSize: 10, fontWeight: 600,
          }}>{active}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {/* 2026-11-19 用户指令：MCP 工作浮层的开关放这里，浮层不再是关不掉的挂件 */}
        <span
          data-mcp-banner-toggle
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 400, color: muted }}
          title={t('taskQueue.mcpBannerHint', 'MCP 代理工作时在右下角显示进度浮层')}
        >
          <span>{t('taskQueue.mcpBanner', 'MCP 浮层')}</span>
          <Switch size="small" checked={mcpBanner} onChange={setMcpBanner} />
        </span>
        <button
          type="button"
          onClick={() => {
            // 2026-11-16 用户实测：只清展示层刷新必复活——插件侧任务 JSON 一并真删。
            // 先取 id 再 clearFinished（清空后 finished 就变了）。
            const pluginIds = finished.filter((x) => x.source === 'plugin').map((x) => x.id);
            clearFinished();
            for (const id of pluginIds) void deletePluginTask(id).catch(() => undefined);
          }}
          disabled={finished.length === 0}
          style={{
            border: 'none', background: 'transparent', padding: 0, cursor: finished.length ? 'pointer' : 'default',
            color: finished.length ? muted : 'transparent', fontSize: 11,
          }}
        >
          {t('taskQueue.clear', '清空已完成')}
        </button>
      </div>

      <div style={{ overflowY: 'auto', paddingTop: 10, flex: 1, minHeight: 0 }}>
        {tasks.length === 0 ? (
          <div style={{ padding: '36px 14px', textAlign: 'center', color: muted, fontSize: 12 }}>
            <div>{t('taskQueue.empty', '暂无任务')}</div>
          </div>
        ) : (
          <>
            {running.length > 0 ? (
              <>
                <div style={{ padding: '0 12px 6px', fontSize: 10, fontWeight: 600, color: muted, letterSpacing: 0.4 }}>
                  {t('taskQueue.activeSection', '进行中')}
                </div>
                {running.map(renderRow)}
              </>
            ) : null}
            {finished.length > 0 ? (
              <>
                <div style={{ padding: '8px 12px 6px', fontSize: 10, fontWeight: 600, color: muted, letterSpacing: 0.4 }}>
                  {t('taskQueue.finishedSection', '已结束')}
                </div>
                {finished.map(renderRow)}
              </>
            ) : null}
          </>
        )}
      </div>
      {/* 2026-11-19 用户口径：需求页签取消，需求/决策/进度/待办/审核统一收进这里，与任务队列同屏。 */}
      <ProjectMemorySection projectId={projectId} />
    </div>
  );
}
