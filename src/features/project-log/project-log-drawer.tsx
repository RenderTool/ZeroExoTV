/**
 * 项目档案抽屉（2026-11-19）：把「需求 / 决策 / 进度 / 待办」放进网页，
 * 新建会话或换 LLM 时 MCP 调 get_project_log 就能直接拿到，不用再复述需求。
 * 数据落 projects/<pid>/entities/project-log.json，与项目同生共死。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Input, Space, Tag, Typography, message } from 'antd';
import { NotebookPen, RefreshCw } from 'lucide-react';
import { readJson, writeJson } from '@/platform/fs.js';

type Kind = 'requirement' | 'decision' | 'progress' | 'todo' | 'artifact';
interface LogEntry { id: string; kind: Kind; text: string; status: 'open' | 'done' | 'dropped'; at: string }
interface ProjectLog { title: string; version: number; updatedAt: string; entries: LogEntry[] }

const EMPTY: ProjectLog = { title: '项目档案', version: 0, updatedAt: '', entries: [] };
const KIND_LABEL: Record<Kind, string> = {
  requirement: '需求',
  decision: '决策',
  progress: '进度',
  todo: '待办',
  artifact: '产物',
};
const STATUS_COLOR: Record<LogEntry['status'], string> = { open: 'processing', done: 'success', dropped: 'default' };

function logPath(projectId: string) {
  return `projects/${projectId}/entities/project-log.json`;
}

export function ProjectLogDrawer({ projectId: propProjectId, open, onClose }: { projectId?: string; open: boolean; onClose: () => void }) {
  const projectId = propProjectId ?? (window.location.hash.match(/#\/editor\/([^/?]+)/)?.[1] ?? '');
  const [log, setLog] = useState<ProjectLog>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('requirement');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readJson<ProjectLog>(logPath(projectId));
      setLog(data ?? EMPTY);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const now = new Date().toISOString();
    const next: ProjectLog = {
      ...log,
      version: (log.version ?? 0) + 1,
      updatedAt: now,
      entries: [
        ...log.entries,
        {
          id: `log-${Date.now().toString(36)}`,
          kind,
          text: t,
          status: kind === 'requirement' || kind === 'todo' ? 'open' : 'done',
          at: now,
        },
      ],
    };
    await writeJson(logPath(projectId), next);
    setLog(next);
    setText('');
    message.success('已记录，新会话可读取');
  };

  const groups: Array<{ label: Kind; list: LogEntry[] }> = [
    { label: 'requirement', list: log.entries.filter((e) => e.kind === 'requirement') },
    { label: 'progress', list: log.entries.filter((e) => e.kind === 'progress').slice(-6).reverse() },
    { label: 'decision', list: log.entries.filter((e) => e.kind === 'decision') },
    { label: 'todo', list: log.entries.filter((e) => e.kind === 'todo') },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={
        <Space>
          <NotebookPen size={16} />
          项目档案
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            v{log.version} · {log.updatedAt ? new Date(log.updatedAt).toLocaleString() : '未记录'}
          </Typography.Text>
        </Space>
      }
      extra={<Button size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={load}>刷新</Button>}
    >
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="记一条需求 / 决策 / 进度，换会话不再重复描述"
          onPressEnter={add}
        />
        <Button onClick={() => setKind(kind === 'requirement' ? 'decision' : 'requirement')} style={{ width: 80 }}>
          {KIND_LABEL[kind]}
        </Button>
        <Button type="primary" onClick={add}>记录</Button>
      </Space.Compact>

      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 16 }}>
          <Typography.Text strong>{KIND_LABEL[g.label]}</Typography.Text>
          {g.list.length === 0 ? (
            <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>暂无</Typography.Paragraph>
          ) : (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {g.list.map((e) => (
                <li key={e.id} style={{ marginBottom: 6 }}>
                  <Tag color={STATUS_COLOR[e.status]}>{e.status === 'open' ? '进行中' : e.status === 'done' ? '已记录' : '已放弃'}</Tag>
                  {e.text}
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {new Date(e.at).toLocaleString()}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </Drawer>
  );
}
