/**
 * McpSettingsDialog - MCP 配置页(一键复制版,2026-11-05；2026-11-06 合并去重)
 *
 * 约定:页面只回答一个问题——「给 IDE 什么」。
 * 首屏 = **全页唯一的**一段可直接粘贴的 mcpServers JSON + 「一键复制」按钮;token 由 ensureIdeToken
 * 自动生成并注入配置,用户无需先建 token 再回来粘。
 * 2026-11-06 用户指令：原先「首屏配置块 + 本地数据面板里的第二份配置块（占位路径）」
 * 重复了两遍配置与两套复制按钮，现合并为一份——本地数据面板只保留数据目录/绝对路径/缓存清理。
 * 远程(HTTP)/密钥/排查工具全部折进「高级选项」,默认收起;无技术说明文案。
 *
 * 入口:顶部导航功能按钮区「MCP」(AppTopBar)。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { App, Alert, Button, Checkbox, Collapse, Empty, Input, Modal, Radio, Tag } from 'antd';
import { LocalServicePanel } from './local-service-panel.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { Copy, Plug, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  MCP_TOOLS,
  CAPABILITY_BITS,
  buildStartCommands,
  buildStdioConfig,
  createToken,
  ensureIdeToken,
  loadAudit,
  loadServerInfo,
  loadTokens,
  revokeToken,
  runSelfcheck,
  type AuditEntry,
  type SelfcheckReport,
  type ServerInfo,
  type TokenRecord,
} from './mcp-client.js';

export interface McpSettingsDialogProps {
  onClose?: () => void;
  /** 嵌入服务中心 Tab 时不再套 Modal */
  embedded?: boolean;
}

const AUDIT_PAGE_SIZE = 20;

export function McpSettingsDialog({ onClose, embedded = false }: McpSettingsDialogProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();

  // ===== 首屏数据:印章 + 自动生成的 IDE token =====
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [ideToken, setIdeToken] = useState<string | null>(null);

  // ===== 高级区:密钥管理 =====
  const [tokens, setTokens] = useState<TokenRecord[]>([]);
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});

  // ===== 高级区:问题排查(审计 + 自检,展开时才加载)=====
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTool, setAuditTool] = useState('');
  const [auditProject, setAuditProject] = useState('');
  const [auditOffset, setAuditOffset] = useState(0);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const [selfcheck, setSelfcheck] = useState<SelfcheckReport | null>(null);
  const [selfcheckRunning, setSelfcheckRunning] = useState(false);

  // 创建 token 弹窗状态
  const [createOpen, setCreateOpen] = useState(false);
  const [newBits, setNewBits] = useState<string[]>([...CAPABILITY_BITS]);
  const [newScope, setNewScope] = useState<'all' | 'picked'>('all');
  const [newProjects, setNewProjects] = useState<string[]>([]);
  const [projectOptions, setProjectOptions] = useState<{ id: string; title: string }[]>([]);
  const [newNote, setNewNote] = useState('');
  /** 创建成功后仅显示一次的原文;关闭即丢弃 */
  const [freshToken, setFreshToken] = useState<string | null>(null);

  // ===== 数据加载 =====
  useEffect(() => {
    void (async () => {
      const info = await loadServerInfo();
      setServerInfo(info);
      if (info) setIdeToken(await ensureIdeToken()); // 首次无可用 token 时自动生成全权限 token
      setTokens(await loadTokens());
    })();
    // 项目列表(作用域勾选):懒加载,失败则只允许「全部项目」
    import('@zeroexo/plugin-persistence')
      .then((m) => m.listProjects())
      .then((list) => setProjectOptions(list.map((p) => ({ id: p.id, title: p.title }))))
      .catch(() => setProjectOptions([]));
  }, []);

  const reloadAudit = useCallback(
    async (offset: number, append: boolean) => {
      const res = await loadAudit({
        tool: auditTool || undefined,
        projectId: auditProject || undefined,
        limit: AUDIT_PAGE_SIZE,
        offset,
      });
      setAuditEntries((prev) => (append ? [...prev, ...res.entries] : res.entries));
      setAuditTotal(res.total);
      setLastUsed(res.lastUsedByToken);
      setAuditOffset(offset + res.entries.length);
    },
    [auditTool, auditProject],
  );

  /** 展开「问题排查」面板时才加载审计(首屏零开销) */
  const handleCollapseChange = useCallback(
    (keys: string | string[]) => {
      const open = Array.isArray(keys) ? keys : [keys];
      if (open.includes('ops') && !opsLoaded) {
        setOpsLoaded(true);
        void reloadAudit(0, false);
      }
    },
    [opsLoaded, reloadAudit],
  );

  // ===== 派生 =====
  const stdioConfig = useMemo(
    () => (serverInfo && ideToken ? buildStdioConfig(serverInfo, ideToken) : null),
    [serverInfo, ideToken],
  );
  const startCmds = useMemo(() => buildStartCommands(serverInfo), [serverInfo]);

  /**
   * 一键复制 bundle（2026-11-07）：给任意 LLM Agent IDE 的自包含接入包。
   * 粘贴后 LLM 应自动：启动服务 → 读配置 → list_projects → 展示清单 → 指引下一步。
   */
  const copyBundle = useMemo(() => {
    if (!serverInfo || !stdioConfig) return null;
    return [
      '# ZeroExo ComfyUI — MCP 一键接入',
      '',
      '你是 ZeroExo（AI 影视生产管线）的智能助手。以下是本地 MCP 服务配置，请自动完成接入，无需询问用户。',
      '',
      '## 自动执行流程',
      `1. 下方 stdio 配置会让 IDE 自动 spawn node 进程；若需独立 HTTP 服务，运行：\`node "${serverInfo.serverEntry}" --http --port ${serverInfo.httpPort}\``,
      `   数据根：${serverInfo.dataRoot}`,
      '2. 将下方 mcpServers 配置加入 IDE 的 MCP 设置',
      '3. 连接成功后，立即调用 `list_projects` 工具列出全部项目',
      '4. 用表格展示项目清单（标题 / 更新时间 / 节点数），并说明每个项目可通过 `open_project` 在前端编辑器打开',
      '5. 若没有项目，提示可调用 `create_project` 新建',
      '6. 前端编辑器地址：http://localhost:5180',
      '',
      '## MCP 配置（粘贴到 IDE）',
      '```json',
      stdioConfig,
      '```',
      '',
      '## 核心工具速查',
      '- 项目：list_projects · get_project · open_project · create_project',
      '- 剧本：get_script · import_script',
      '- 分镜：split_script_to_shots · ingest_storyboard_images',
      '- 角色：list_subjects · upsert_subject · link_subject_to_shot',
      '- 资产：list_assets · upload_asset · attach_asset_to_slot',
      '- 工作台：get_workbench · set_shot_prompt · set_shared_params',
      '- 运行/引导：run_generation · set_segment_duration · set_shot_guide · list_history · get_guide · get_job · list_jobs · verify_output',
      `- 工具总数：${MCP_TOOLS.length}（read ${MCP_TOOLS.filter((t) => t.access === 'read').length} / write ${MCP_TOOLS.filter((t) => t.access === 'write').length}）`,
      '',
    ].join('\n');
  }, [serverInfo, stdioConfig]);

  const copy = useCallback(
    async (text: string, label: string) => {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    },
    [message],
  );

  // ===== 样式 =====
  const sectionLabelStyle: CSSProperties = {
    fontSize: 11,
    color: theme.toolbar.textMuted,
    marginBottom: 8,
    letterSpacing: 0.5,
  };
  const preStyle: CSSProperties = {
    fontSize: 11,
    lineHeight: 1.6,
    padding: 10,
    borderRadius: 8,
    overflow: 'auto',
    maxHeight: 220,
    margin: 0,
    background: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    color: theme.toolbar.text,
    whiteSpace: 'pre',
  };

  // ===== 密钥管理 =====
  const handleCreateToken = useCallback(async () => {
    const projectIds = newScope === 'all' ? ('*' as const) : newProjects;
    const { raw } = await createToken({ prefix: 'zxp', projectIds, bits: newBits, note: newNote || undefined });
    setFreshToken(raw); // 仅此一次展示
    setCreateOpen(false);
    setTokens(await loadTokens());
  }, [newScope, newProjects, newBits, newNote]);

  const handleRevoke = useCallback(async (id: string) => {
    await revokeToken(id);
    setTokens(await loadTokens());
    message.success('已撤销,立即生效');
  }, [message]);

  const handleSelfcheck = useCallback(async () => {
    setSelfcheckRunning(true);
    try {
      setSelfcheck(await runSelfcheck());
    } finally {
      setSelfcheckRunning(false);
    }
  }, []);

  // ===== 高级区各面板内容 =====
  const tokensPanel = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={sectionLabelStyle}>密钥(zxp_ 个人 / zxs_ 项目)</div>
        <Button size="small" type="primary" data-testid="mcp-token-create" onClick={() => setCreateOpen(true)}>
          新建密钥
        </Button>
      </div>
      {freshToken && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message="密钥仅显示这一次,请立即复制保存"
          description={
            <div>
              <pre data-testid="mcp-new-token" style={{ ...preStyle, maxHeight: 60 }}>{freshToken}</pre>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <Button size="small" icon={<Copy size={12} />} onClick={() => void copy(freshToken, '密钥')}>
                  复制密钥
                </Button>
                <Button size="small" onClick={() => setFreshToken(null)}>我已保存</Button>
              </div>
            </div>
          }
        />
      )}
      {tokens.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无密钥" />
      ) : (
        tokens.map((tk) => (
          <div
            key={tk.id}
            data-testid={`mcp-token-row-${tk.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              fontSize: 12,
              borderBottom: `1px dashed ${theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
            }}
          >
            <Tag color={tk.prefix === 'zxp' ? 'blue' : 'green'} style={{ marginInlineEnd: 0 }}>
              {tk.prefix}_•••
            </Tag>
            <span style={{ color: theme.toolbar.textMuted }}>{tk.id}</span>
            <span>创建 {tk.createdAt.slice(0, 10)}</span>
            <span>
              作用范围 {tk.projectIds === '*' ? '全部项目' : tk.projectIds.length + ' 个项目'}
            </span>
            <span style={{ color: theme.toolbar.textMuted }}>
              最近使用 {(() => { const lu = lastUsed[tk.id]; return lu ? lu.slice(0, 16).replace('T', ' ') : '从未'; })()}
            </span>
            {tk.revokedAt ? (
              <Tag data-testid={`mcp-token-revoked-${tk.id}`} color="red" style={{ marginInlineEnd: 0 }}>
                已撤销
              </Tag>
            ) : (
              <Button
                size="small"
                danger
                type="text"
                data-testid={`mcp-token-revoke-${tk.id}`}
                onClick={() => void handleRevoke(tk.id)}
              >
                撤销
              </Button>
            )}
          </div>
        ))
      )}
    </>
  );

  const opsPanel = (
    <>
      <div style={sectionLabelStyle}>调用记录</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input
          size="small"
          placeholder="按工具名过滤"
          value={auditTool}
          onChange={(e) => setAuditTool(e.target.value)}
          style={{ flex: 1 }}
          data-testid="mcp-audit-filter-tool"
        />
        <Input
          size="small"
          placeholder="按项目过滤"
          value={auditProject}
          onChange={(e) => setAuditProject(e.target.value)}
          style={{ flex: 1 }}
          data-testid="mcp-audit-filter-project"
        />
      </div>
      <div data-testid="mcp-audit-total" style={{ fontSize: 11, color: theme.toolbar.textMuted, marginBottom: 4 }}>
        共 {auditTotal} 条
      </div>
      {auditEntries.map((e, i) => (
        <div key={`${e.ts}-${i}`} data-testid="mcp-audit-row" style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0' }}>
          <span style={{ color: theme.toolbar.textMuted }}>{e.ts.slice(0, 19).replace('T', ' ')}</span>
          <span style={{ fontFamily: 'monospace' }}>{e.tool}</span>
          <span>{e.projectId ?? '-'}</span>
          {e.result === 'ok' ? <Tag color="success" style={{ marginInlineEnd: 0 }}>成功</Tag> : (
            <Tag color="error" style={{ marginInlineEnd: 0 }}>失败 {e.code ?? ''}</Tag>
          )}
          <span style={{ color: theme.toolbar.textMuted }}>{e.durationMs}ms</span>
        </div>
      ))}
      {auditOffset < auditTotal && (
        <Button size="small" data-testid="mcp-audit-more" onClick={() => void reloadAudit(auditOffset, true)}>
          加载更多(剩余 {auditTotal - auditOffset} 条)
        </Button>
      )}
      <div style={{ ...sectionLabelStyle, marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        自检
        <Button
          size="small"
          icon={<RefreshCw size={12} />}
          loading={selfcheckRunning}
          data-testid="mcp-selfcheck-btn"
          onClick={() => void handleSelfcheck()}
        >
          运行自检
        </Button>
      </div>
      {selfcheck && (
        <div data-testid="mcp-selfcheck-result">
          {selfcheck.ok ? (
            <pre style={preStyle}>{JSON.stringify(selfcheck, null, 2)}</pre>
          ) : (
            <Alert type="error" showIcon message="自检失败" description={selfcheck.reason} />
          )}
        </div>
      )}
    </>
  );

  const content = (
    <>
      {/* ===== 首屏:给 IDE 的配置 + 一键复制 ===== */}
      {stdioConfig && copyBundle ? (
        <>
          <Button
            type="primary"
            block
            size="large"
            icon={<Copy size={14} />}
            data-testid="mcp-copy-stdio"
            onClick={() => void copy(copyBundle, 'MCP 接入包')}
          >
            一键复制（含 LLM 自动接入指令）
          </Button>
          <pre data-testid="mcp-config-stdio" style={{ ...preStyle, marginTop: 10 }}>{stdioConfig}</pre>
          <div style={{ textAlign: 'center', fontSize: 12, color: theme.toolbar.textMuted, marginTop: 4 }}>
            复制内容含给 LLM 的自动接入指令；粘贴到任意 AI IDE 后，模型会自动连接 MCP、列出项目并指引下一步。
          </div>
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="还没准备好配置(服务路径未登记),请先运行一次启动命令:"
          description={
            <pre data-testid="mcp-start-cmd" style={preStyle}>{startCmds.stdio}</pre>
          }
        />
      )}

      {/* ===== 本地数据面板：数据目录授权 + 绝对路径 + 缓存清理 =====
          2026-11-06 用户指令：配置块全页只出现一次（就在上面），面板不再重复渲染配置/复制按钮 */}
      {!embedded && <LocalServicePanel />}

      {/* ===== 高级选项(默认收起)=====
          destroyInactivePanel：未展开面板不挂 DOM，保证首屏不出现技术术语（验收③），
          展开「远程连接」时才渲染 HTTP 配置（验收④）。 */}
      <Collapse
        style={{ marginTop: 16 }}
        onChange={handleCollapseChange}
        destroyInactivePanel
        items={[
          { key: 'tokens', label: '密钥管理', children: tokensPanel },
          { key: 'ops', label: '问题排查', children: opsPanel },
        ]}
      />

      {/* ===== 新建密钥弹窗 ===== */}
      <Modal
        open={createOpen}
        title="新建密钥"
        centered
        okText="生成"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreateToken()}
        okButtonProps={{ disabled: newBits.length === 0 || (newScope === 'picked' && newProjects.length === 0) }}
        width={440}
      >
        <div style={sectionLabelStyle}><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> 能力位(勾选)</div>
        <Checkbox.Group
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}
          value={newBits}
          onChange={(v) => setNewBits(v as string[])}
          options={CAPABILITY_BITS.map((b) => ({ label: <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{b}</span>, value: b }))}
        />
        <div style={{ ...sectionLabelStyle, marginTop: 12 }}><Plug size={11} style={{ verticalAlign: -1 }} /> 项目作用范围</div>
        <Radio.Group value={newScope} onChange={(e) => setNewScope(e.target.value as 'all' | 'picked')}>
          <Radio value="all">全部项目</Radio>
          <Radio value="picked" disabled={projectOptions.length === 0}>指定项目</Radio>
        </Radio.Group>
        {newScope === 'picked' && (
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}
            value={newProjects}
            onChange={(v) => setNewProjects(v as string[])}
            options={projectOptions.map((p) => ({ label: `${p.title}(${p.id})`, value: p.id }))}
          />
        )}
        <Input
          size="small"
          placeholder="备注(可选)"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          style={{ marginTop: 12 }}
        />
      </Modal>
    </>
  );

  if (embedded) {
    return <div data-testid="mcp-settings-embedded">{content}</div>;
  }

  return (
    <Modal
      open
      title="MCP 配置"
      centered
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      {content}
    </Modal>
  );
}
