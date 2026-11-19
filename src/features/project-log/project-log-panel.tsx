/**
 * 需求页（2026-11-19）：与剧本/分镜/画布同级展示。
 * 记录需求 / 决策 / 进度 / 待办，落 projects/<pid>/entities/project-log.json；
 * 新会话的 MCP 通过 get_project_log 直接读取，不再让用户重复描述需求。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Space, Tag, Typography, message } from 'antd';
import { RefreshCw } from 'lucide-react';
import { readJson, writeJson } from '@/platform/fs.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';

type Kind = 'requirement' | 'decision' | 'progress' | 'todo' | 'artifact';
interface LogEntry { id: string; kind: Kind; text: string; status: 'open' | 'done' | 'dropped'; at: string }
interface ProjectLog { title: string; version: number; updatedAt: string; entries: LogEntry[] }

const EMPTY: ProjectLog = { title: '需求', version: 0, updatedAt: '', entries: [] };
const KIND_LABEL: Record<Kind, string> = {
  requirement: '需求',
  decision: '决策',
  progress: '进度',
  todo: '待办',
  artifact: '产物',
};

function logPath(projectId: string) {
  return `projects/${projectId}/entities/project-log.json`;
}

export function ProjectLogPanel(): React.ReactElement {
  const { theme } = useTheme();
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const projectId = window.location.hash.match(/#\/editor\/([^/?]+)/)?.[1] ?? '';
  const [log, setLog] = useState<ProjectLog>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('requirement');

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setLog((await readJson<ProjectLog>(logPath(projectId))) ?? EMPTY);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const saveEntries = async (entries: LogEntry[]) => {
    const next: ProjectLog = { ...log, version: (log.version ?? 0) + 1, updatedAt: new Date().toISOString(), entries };
    await writeJson(logPath(projectId), next);
    setLog(next);
  };

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const now = new Date().toISOString();
    await saveEntries([...log.entries, {
      id: `log-${Date.now().toString(36)}`,
      kind,
      text: t,
      status: kind === 'requirement' || kind === 'todo' ? 'open' : 'done',
      at: now,
    }]);
    setText('');
    message.success('已记录');
  };

  const setStatus = async (id: string, status: LogEntry['status']) => {
    await saveEntries(log.entries.map((e) => (e.id === id ? { ...e, status } : e)));
  };

  const compact = async () => {
    const open = log.entries.filter((e) => e.status === 'open');
    const closed = log.entries.filter((e) => e.status !== 'open').slice(-20);
    await saveEntries([...open, ...closed].sort((a, b) => a.at.localeCompare(b.at)));
    message.success('已清理已结束记录');
  };

  const requirements = log.entries.filter((e) => e.kind === 'requirement');
  const progress = log.entries.filter((e) => e.kind === 'progress').slice().reverse();
  const decisions = log.entries.filter((e) => e.kind === 'decision');
  const todos = log.entries.filter((e) => e.kind === 'todo');

  if (activeTabKey !== 'projectLog') return <></>;

  return (
    <div style={{ position: 'fixed', inset: '44px 0 0 0', zIndex: 90, background: theme.toolbar.panel, color: theme.toolbar.text, overflow: 'auto', padding: 20 }}>
      <Space align="center" style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>需求</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          v{log.version} · {log.updatedAt ? new Date(log.updatedAt).toLocaleString() : '未记录'}
        </Typography.Text>
        <Button size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void load()}>刷新</Button>
        <Button size="small" onClick={() => void compact()}>压缩</Button>
      </Space>

      <Space.Compact style={{ width: '100%', maxWidth: 720, marginBottom: 16 }}>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="记一条需求 / 决策 / 进度" onPressEnter={() => void add()} />
        <Button style={{ width: 72 }} onClick={() => setKind(kind === 'requirement' ? 'decision' : 'requirement')}>{KIND_LABEL[kind]}</Button>
        <Button type="primary" onClick={() => void add()}>记录</Button>
      </Space.Compact>

      <div style={{ maxWidth: 720 }}>
        {[
          { label: '需求', list: requirements },
          { label: '进度', list: progress },
          { label: '决策', list: decisions },
          { label: '待办', list: todos },
        ].map((g) => (
          <div key={g.label} style={{ marginBottom: 16 }}>
            <Typography.Text strong>{g.label}</Typography.Text>
            {g.list.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" style={{ margin: '4px 0' }} />
            ) : (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {g.list.map((e) => (
                  <li key={e.id} style={{ marginBottom: 6, lineHeight: 1.7 }}>
                    <Tag color={e.status === 'open' ? 'processing' : e.status === 'done' ? 'success' : 'default'}>
                      {e.status === 'open' ? '进行中' : e.status === 'done' ? '已记录' : '已放弃'}
                    </Tag>
                    {e.text}
                    {e.status === 'open' ? (
                      <Space size={2}>
                        <Button type="link" size="small" onClick={() => void setStatus(e.id, 'done')}>完成</Button>
                        <Button type="link" size="small" danger onClick={() => void setStatus(e.id, 'dropped')}>放弃</Button>
                      </Space>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
