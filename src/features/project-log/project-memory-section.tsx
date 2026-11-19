/**
 * 项目记忆区（2026-11-19 用户口径修正后）：
 * 「需求页」这个独立页签取消——需求/决策/进度/待办/审核批次都属于「项目记忆」，
 * 挂进任务队列面板下方，和任务队列一起看。这里只读陈列，写入一律走 MCP 工具
 * （append_project_log / update_project_log_entry / open_artifact_review / decide_artifact_review），
 * 压缩由项目自带 Agent 自主维护（compact_project_log）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tag } from 'antd';
import { readJson } from '@/platform/fs.js';
import { useTheme } from '@zeroexo/plugin-theme';

type Kind = 'requirement' | 'decision' | 'progress' | 'todo' | 'artifact';
type Status = 'open' | 'review' | 'done' | 'dropped';
interface LogEntry { id: string; kind: Kind; text: string; status: Status; at: string }
interface PipelinePhase { key: string; label: string; status: 'pending' | 'working' | 'review' | 'done' | 'blocked'; note?: string }
interface PipelineState { active: boolean; phase?: string; note?: string; updatedAt?: string; phases: PipelinePhase[] }
interface ProjectLog { version: number; updatedAt: string; entries: LogEntry[]; pipeline?: PipelineState }

const KIND_LABEL: Record<Kind, string> = {
  requirement: '需求',
  decision: '决策',
  progress: '进度',
  todo: '待办',
  artifact: '审核',
};
const KIND_COLOR: Record<Kind, string> = {
  requirement: 'blue',
  decision: 'purple',
  progress: 'green',
  todo: 'gold',
  artifact: 'orange',
};
const STATUS_LABEL: Record<Status, string> = { open: '进行中', review: '待审核', done: '已完成', dropped: '已移除' };
const PHASE_LABEL: Record<PipelinePhase['status'], string> = {
  pending: '未开始', working: '进行中', review: '待审核', done: '已完成', blocked: '受阻',
};
const PHASE_COLOR: Record<PipelinePhase['status'], string> = {
  pending: 'default', working: 'processing', review: 'warning', done: 'success', blocked: 'error',
};

const VISIBLE_LIMIT = 80;

export function ProjectMemorySection({ projectId }: { projectId?: string | null }): React.ReactElement | null {
  const { theme } = useTheme();
  const [log, setLog] = useState<ProjectLog | null>(null);
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const j = await readJson<ProjectLog>(`projects/${projectId}/entities/project-log.json`);
      setLog(j ?? null);
    } catch {
      setLog(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    // 定时轻刷新：Agent 通过 MCP 写档案后不用手动刷新也能看到
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => { void load(); }, 4000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [load]);

  if (!projectId || !log) return null;

  const muted = theme.toolbar.textMuted;
  const phases = log.pipeline?.phases ?? [];
  const entries = log.entries.slice(-VISIBLE_LIMIT).reverse();
  const openTodos = log.entries.filter((e) => e.kind === 'todo' && e.status === 'open').length;
  const reviewCount = log.entries.filter((e) => e.kind === 'artifact' && e.status === 'review').length;

  return (
    <div data-project-memory style={{ borderTop: `1px solid ${theme.toolbar.border}`, flexShrink: 0, background: 'transparent' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px',
          background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
          fontSize: 12, fontWeight: 600, color: theme.toolbar.text,
        }}
        title="项目记忆：需求 / 决策 / 进度 / 待办 / 审核，由 Agent 通过 MCP 维护，只读"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>项目记忆</span>
        {openTodos > 0 ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>待办 {openTodos}</Tag> : null}
        {reviewCount > 0 ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>待审核 {reviewCount}</Tag> : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontWeight: 400, color: muted }}>Agent 自主维护 · 只读</span>
      </button>

      {expanded ? (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '0 14px 10px' }}>
          {phases.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 0 8px' }}>
              {phases.map((p) => (
                <Tag key={p.key} color={PHASE_COLOR[p.status]} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  {p.label}·{PHASE_LABEL[p.status]}
                </Tag>
              ))}
            </div>
          ) : null}
          {entries.length === 0 ? (
            <div style={{ fontSize: 11, color: muted, padding: '6px 0' }}>暂无记录（Agent 写需求/进度后出现）</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} data-memory-entry={e.kind} style={{ display: 'flex', gap: 6, padding: '5px 0', borderTop: `1px dashed ${theme.toolbar.border}` }}>
                <Tag color={KIND_COLOR[e.kind]} style={{ marginInlineEnd: 0, flexShrink: 0, height: 18, lineHeight: '18px', fontSize: 10 }}>
                  {KIND_LABEL[e.kind]}
                </Tag>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: theme.toolbar.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                    {e.text}
                  </div>
                  <div style={{ fontSize: 9.5, color: muted, marginTop: 2 }}>
                    {new Date(e.at).toLocaleString()} · {STATUS_LABEL[e.status]}
                  </div>
                </div>
              </div>
            ))
          )}
          <div style={{ fontSize: 10, color: muted, paddingTop: 8, lineHeight: 1.5 }}>
            这里只是记忆体：采纳 / 打回请在对话里答 Agent，由它调 MCP 工具落盘；记录压缩也由 Agent 自主完成。
          </div>
        </div>
      ) : null}
    </div>
  );
}
