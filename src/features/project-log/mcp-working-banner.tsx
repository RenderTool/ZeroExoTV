/**
 * MCP 代理工作浮层（2026-11-19）：项目档案 pipeline.active=true 时提示「Agent 正在处理，中间态不是报错」。
 * 2026-11-19 用户指令：浮层开关统一收到「任务队列」标题旁（见 useMcpBannerVisible），
 * 这里不再自带关闭记忆——只读那个开关，开关关掉即整块不出。
 */
import { useEffect, useState } from 'react';
import { Spin, Tag } from 'antd';
import { X } from 'lucide-react';
import { readJson } from '@/platform/fs.js';
import { projectLogExists } from './project-log-exists.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { useMcpBannerVisible } from './mcp-banner-visibility.js';

interface Pipeline {
  active?: boolean;
  phase?: string;
  note?: string;
  updatedAt?: string;
  phases?: { label: string; status: string }[];
}

const PHASE_TEXT: Record<string, string> = {
  script: '推敲剧本',
  subjects: '生成主体',
  shots: '生成分镜',
  generate: '生成画布资产',
  review: '等待审核',
};

export function McpWorkingBanner(): React.ReactElement | null {
  const { theme } = useTheme();
  const [visible, setVisible] = useMcpBannerVisible();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const projectId = window.location.hash.match(/#\/editor\/([^/?]+)/)?.[1] ?? '';

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const tick = async () => {
      try {
        // 没有这个文件就不发请求（否则每 4 秒一条 404 把控制台刷满）
        if (!(await projectLogExists(projectId))) {
          if (alive) setPipeline(null);
          return;
        }
        const j = await readJson<{ pipeline?: Pipeline }>(`projects/${projectId}/entities/project-log.json`);
        if (alive) setPipeline(j?.pipeline ?? null);
      } catch {
        if (alive) setPipeline(null);
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [projectId]);

  if (!visible || !pipeline?.active) return null;
  const phaseLabel = pipeline.phase ? PHASE_TEXT[pipeline.phase] ?? pipeline.phase : '项目流水线';

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1100,
        maxWidth: 520,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 999,
        background: theme.toolbar.panel,
        color: theme.toolbar.text,
        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        border: `1px solid ${theme.toolbar.border}`,
        fontSize: 12,
        pointerEvents: 'none',
      }}
    >
      <Spin size="small" />
      <Tag color="processing" style={{ margin: 0 }}>MCP 代理工作中</Tag>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {phaseLabel}{pipeline.note ? ` · ${pipeline.note}` : ''}
      </span>
      {/* 2026-11-19 用户指令：浮层自身也要常驻关闭入口；关掉只隐藏提示，MCP 任务与流水线状态照常推进 */}
      <button
        type="button"
        data-mcp-banner-close
        aria-label="关闭浮层"
        title="关闭浮层（不会停止 MCP 任务）"
        onClick={() => setVisible(false)}
        style={{
          pointerEvents: 'auto', flexShrink: 0, marginLeft: 2, width: 18, height: 18, padding: 0,
          border: 'none', borderRadius: 9, background: 'transparent', color: theme.toolbar.textMuted ?? '#78716c',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
