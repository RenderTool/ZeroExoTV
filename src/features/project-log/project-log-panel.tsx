/**
 * 需求页（2026-11-19）：与剧本/分镜/画布同级挂载，只读展示，不提供手动增删改。
 * 记录与状态变更一律由 LLM Agent 通过 MCP 工具写入（append_project_log / update_project_log_entry），
 * 「移除」也只是标记 dropped，不物理删除，保证对话日志与项目档案一致。
 *
 * 2026-11-19 用户要求：条目列表按可视窗口渲染（定高行 + overscan），需求积累到几百条也不卡；
 * MCP 工作浮层的开关同时挂在「任务队列」标题旁，浮层本身另有常驻关闭按钮（关掉只隐藏提示，不停任务）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Switch, Tag, Typography } from 'antd';
import { RefreshCw } from 'lucide-react';
import { readJson, listDir, readFile } from '@/platform/fs.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { useMcpBannerVisible } from './mcp-banner-visibility.js';

type Kind = 'requirement' | 'decision' | 'progress' | 'todo' | 'artifact';
type Status = 'open' | 'review' | 'done' | 'dropped';
interface LogEntry { id: string; kind: Kind; text: string; status: Status; at: string }
interface PipelinePhase { key: string; label: string; status: 'pending' | 'working' | 'review' | 'done' | 'blocked'; note?: string }
interface PipelineState { active: boolean; phase?: string; note?: string; updatedAt?: string; phases: PipelinePhase[] }
interface ProjectLog { title: string; version: number; updatedAt: string; entries: LogEntry[]; pipeline?: PipelineState }
interface OpsJob { jobId: string; title?: string; model?: string; status: string; createdAt?: string }

const EMPTY: ProjectLog = { title: '需求', version: 0, updatedAt: '', entries: [] };
const STATUS_LABEL: Record<Status, string> = {
  open: '进行中',
  review: '待审核',
  done: '已完成',
  dropped: '已移除',
};
const STATUS_COLOR: Record<Status, string> = {
  open: 'processing',
  review: 'warning',
  done: 'success',
  dropped: 'default',
};
const PHASE_COLOR: Record<PipelinePhase['status'], string> = {
  pending: 'default',
  working: 'processing',
  review: 'warning',
  done: 'success',
  blocked: 'error',
};
const PHASE_LABEL: Record<PipelinePhase['status'], string> = {
  pending: '未开始',
  working: '进行中',
  review: '待审核',
  done: '已完成',
  blocked: '受阻',
};

/** 定高行（分组标题 / 空态 / 条目共用），窗口化渲染按它算位移 */
const ROW_H = 46;
const OVERSCAN = 8;

type LogRow =
  | { key: string; kind: 'header'; label: string }
  | { key: string; kind: 'empty'; label: string }
  | { key: string; kind: 'entry'; entry: LogEntry };

function logPath(projectId: string) {
  return `projects/${projectId}/entities/project-log.json`;
}

export function ProjectLogTabContent(): React.ReactElement {
  const { theme } = useTheme();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const isActive = activeTabKey === 'projectLog';
  const projectId = window.location.hash.match(/#\/editor\/([^/?]+)/)?.[1] ?? '';
  const [log, setLog] = useState<ProjectLog>(EMPTY);
  const [jobs, setJobs] = useState<OpsJob[]>([]);
  const [mcpBanner, setMcpBanner] = useMcpBannerVisible();
  const [loading, setLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const entries = await listDir('.lf/zeroexo/app_meta/claims');
      const list: OpsJob[] = [];
      for (const e of entries.slice(-40)) {
        if (!e.name.endsWith('.json')) continue;
        const txt = await readFile(`.lf/zeroexo/app_meta/claims/${e.name}`);
        if (!txt) continue;
        const claim = JSON.parse(txt) as {
          projectId?: string; jobId?: string; title?: string; model?: string; status?: string; createdAt?: string;
        };
        if (claim.projectId !== projectId) continue;
        list.push({
          jobId: claim.jobId ?? e.name,
          title: claim.title,
          model: claim.model,
          status: claim.status ?? 'pending',
          createdAt: claim.createdAt,
        });
      }
      list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setJobs(list);
    } catch {
      setJobs([]);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setLog((await readJson<ProjectLog>(logPath(projectId))) ?? EMPTY);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isActive) return;
    void load();
    void loadJobs();
    const timer = window.setInterval(() => { void load(); void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [isActive, load, loadJobs]);

  const pipeline = log.pipeline;

  /** 分组拍平成「标题行 + 条目行」，窗口化只需要一条扁平列表 */
  const rows = useMemo<LogRow[]>(() => {
    const groups = [
      { label: '需求', list: log.entries.filter((e) => e.kind === 'requirement') },
      { label: '进度', list: log.entries.filter((e) => e.kind === 'progress').slice().reverse() },
      { label: '决策', list: log.entries.filter((e) => e.kind === 'decision') },
      { label: '待办', list: log.entries.filter((e) => e.kind === 'todo') },
    ];
    const out: LogRow[] = [];
    for (const g of groups) {
      out.push({ key: `h:${g.label}`, kind: 'header', label: g.label });
      if (!g.list.length) {
        out.push({ key: `e:${g.label}:empty`, kind: 'empty', label: '暂无' });
        continue;
      }
      for (const e of g.list) out.push({ key: e.id, kind: 'entry', entry: e });
    }
    return out;
  }, [log.entries]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewH(el.clientHeight);
    sync();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(sync);
      ro.observe(el);
    }
    window.addEventListener('resize', sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [isActive]);

  if (!isActive || !projectId) return <></>;

  const windowSpan = Math.ceil((viewH || 600) / ROW_H) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, start + windowSpan);
  const muted = theme.toolbar.textMuted ?? '#78716c';

  return (
    <div
      data-project-log-panel
      style={{
        position: 'absolute', inset: 0, background: theme.canvas.background, color: theme.toolbar.text,
        padding: 20, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden',
      }}
    >
      <Space align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>需求</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          v{log.version} · {log.updatedAt ? new Date(log.updatedAt).toLocaleString() : '未记录'}
        </Typography.Text>
        <Button size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void load()}>刷新</Button>
      </Space>

      {pipeline ? (
        <div style={{ flexShrink: 0 }}>
          <Space align="center" size={10}>
            <Typography.Text strong>任务队列</Typography.Text>
            {pipeline.active ? <Tag color="processing" style={{ margin: 0 }}>MCP 代理工作中</Tag> : null}
            {/* 2026-11-19 用户指令：MCP 浮层开关挂在这里；关掉只隐藏提示，MCP 任务照常跑 */}
            <span data-mcp-banner-toggle style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <span>浮层</span>
              <Switch size="small" checked={mcpBanner} onChange={setMcpBanner} />
            </span>
          </Space>
          <div style={{ marginTop: 8 }}>
            <Space size={6} wrap>
              {pipeline.phases.map((p) => (
                <Tag key={p.key} color={PHASE_COLOR[p.status]}>
                  {p.label}：{PHASE_LABEL[p.status]}
                </Tag>
              ))}
            </Space>
          </div>
          {pipeline.active ? (
            <Typography.Paragraph style={{ margin: '8px 0 0' }}>
              <Tag color="processing">MCP 代理工作中</Tag>
              {pipeline.phase ? `当前阶段：${pipeline.phase}` : ''}
              {pipeline.note ? ` · ${pipeline.note}` : ''}
            </Typography.Paragraph>
          ) : null}
          {jobs.length ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {jobs.slice(0, 12).map((j) => (
                <li key={j.jobId} style={{ marginBottom: 4 }}>
                  <Tag color={j.status === 'pending' ? 'processing' : j.status === 'landed' ? 'success' : j.status === 'failed' ? 'error' : 'default'}>
                    {j.status === 'pending' ? '进行中' : j.status === 'landed' ? '已完成' : j.status === 'failed' ? '失败' : j.status}
                  </Tag>
                  {j.title ?? j.jobId}
                  {j.model ? ` · ${j.model}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          ref={scrollRef}
          data-project-log-scroll
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ position: 'absolute', inset: 0, overflowY: 'auto', maxWidth: 760 }}
        >
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(start, end).map((r, i) => {
              const top = (start + i) * ROW_H;
              const rowStyle = { position: 'absolute', top, left: 0, right: 0, height: ROW_H, display: 'flex', alignItems: 'center' } as const;
              if (r.kind === 'header') {
                return (
                  <div key={r.key} style={rowStyle}>
                    <Typography.Text strong>{r.label}</Typography.Text>
                  </div>
                );
              }
              if (r.kind === 'empty') {
                return (
                  <div key={r.key} style={{ ...rowStyle, fontSize: 12, color: muted }}>{r.label}</div>
                );
              }
              const e = r.entry;
              return (
                <div key={r.key} style={{ ...rowStyle, gap: 6, overflow: 'hidden' }} title={e.text}>
                  <Tag color={STATUS_COLOR[e.status]} style={{ margin: 0, flexShrink: 0 }}>{STATUS_LABEL[e.status]}</Tag>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {e.text}
                  </span>
                  <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: muted }}>
                    {e.at ? new Date(e.at).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '8px 0 16px' }}>
            需求与状态的变更由对话中的 Agent 代理执行；此处只读展示，避免对话日志与项目档案不一致。
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
