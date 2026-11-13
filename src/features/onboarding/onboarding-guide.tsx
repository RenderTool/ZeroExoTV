/**
 * 使用指引 / 服务（唯一页面，2026-11-13 用户指令）
 *
 * 原「首次使用指引」与顶栏「服务」弹窗是同一件事的两套 UI，现合并成这一页：
 * - 存储目录、MCP、ComfyUI 连接、插件下载、支持的模型都在这里；
 * - 顶栏「服务」打开的就是这一页，不再有第二个 Tabs 弹窗；
 * - 文案只讲「放哪 / 填什么」，密钥、token、绝对路径收进「高级选项」。
 *
 * 首次打开自动弹出一次；之后从主页底部「使用指引」再次打开。
 */
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Collapse, Input, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Copy, Cpu, Download, FolderOpen } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, rootName, currentDataRootPath, switchDataRoot } from '@/platform/fs.js';
import { buildBootstrapCommand, detectBootstrapPlatform } from '@/features/mcp-settings/mcp-bootstrap.js';
import {
  buildStdioConfig,
  ensureIdeToken,
  loadServerInfo,
  mcpServerMissingTools,
  type ServerInfo,
} from '@/features/mcp-settings/mcp-client.js';
import {
  testEndpointConnection,
  useComfyuiEndpointStore,
} from '@/features/canvas-tabs/comfyui-endpoint.js';

const SEEN_KEY = 'zeroexo:onboarding.seen';
const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const PLUGIN_DIR = 'ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes';

/** 机器档位 → 模型推荐（本地 / 云端）。8GB 本地只建议图片；H3 按量化档位选。 */
const MODEL_RECOMMENDATIONS: Array<{ vram: string; local: string; cloud: string }> = [
  { vram: '8 GB', local: '图片：QwenImage2.1（GGUF Q4）/ Krea2 / MossImage。视频不推荐本地跑 H3。', cloud: 'H3 INT8 / 云端 2K' },
  { vram: '12–16 GB', local: '图片全量；H3：pruned INT8 + NVFP4 文本编码器 + offload，0.4MP 短片段（建议 32GB 内存）。', cloud: 'H3 INT8' },
  { vram: '24 GB', local: 'H3：pruned INT8 常驻（约 21GB）+ 文本编码器编码后卸载；图片全量。', cloud: 'H3 INT8 / 2K' },
  { vram: '32 GB+', local: 'H3：pruned INT8，Blackwell 可用 NVFP4；全画布 768p。', cloud: '2K 托管' },
];
const MODELS: Array<{ name: string; note: string }> = [
  { name: 'QwenImage2.1', note: '图片 / 图生图' },
  { name: 'Krea2', note: '图片' },
  { name: 'MossImage', note: '图片' },
  { name: 'H3ZeroExo', note: '视频' },
];

export function isOnboardingDone(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingDone(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 隐私模式忽略 */
  }
}

function StepCard({
  index,
  title,
  done,
  theme,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  theme: ThemeConfig;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 10,
        border: `1px solid ${theme.toolbar.border}`,
        background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.02)',
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: 1, color: done ? '#16a34a' : theme.toolbar.textMuted }}>
        {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{index}. {title}</span>
          {done ? <Tag color="success" style={{ marginInlineEnd: 0 }}>已完成</Tag> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

const hintStyle = (theme: ThemeConfig): React.CSSProperties => ({
  fontSize: 12,
  color: theme.toolbar.textMuted,
  lineHeight: 1.7,
});

export function OnboardingGuide({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message } = App.useApp();
  const endpoint = useComfyuiEndpointStore();

  const [root, setRoot] = useState<string | null>(null);
  const [rootPathInput, setRootPathInput] = useState('');
  const [address, setAddress] = useState(endpoint.address || DEFAULT_COMFYUI);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [mcpStaleTools, setMcpStaleTools] = useState<string[]>([]);

  const pluginZipUrl = `${import.meta.env.BASE_URL}downloads/ComfyUI_ZeroExoNodes.zip`;

  useEffect(() => {
    if (!open) return;
    setRoot(rootName() ?? null);
    setRootPathInput(currentDataRootPath() ?? '');
    setAddress(endpoint.address || DEFAULT_COMFYUI);
    void (async () => {
      try {
        const info = await loadServerInfo();
        setServerInfo(info);
        setMcpStaleTools(mcpServerMissingTools(info));
        if (info) setMcpToken(await ensureIdeToken());
      } catch {
        setServerInfo(null);
      }
    })();
  }, [open, endpoint.address]);

  // 首装机器：用户跑完安装命令后 MCP 才写 server-info，这里自动识别，不用刷新
  useEffect(() => {
    if (!open || serverInfo) return;
    const timer = window.setInterval(() => {
      void loadServerInfo().then(async (info) => {
        if (!info) return;
        setServerInfo(info);
        setMcpStaleTools(mcpServerMissingTools(info));
        setMcpToken(await ensureIdeToken().catch(() => null));
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, serverInfo]);

  const chooseRoot = useCallback(async () => {
    try {
      const pickedName = await pickRoot();
      const current = currentDataRootPath();
      if (current) {
        const sep = current.includes('\\') ? '\\' : '/';
        const parent = current.replace(/[\\/][^\\/]*$/, '');
        const guess = `${parent}${sep}${pickedName}`;
        setRootPathInput(guess);
        message.info(t('onboarding.rootGuess', '已按所选目录名推测为 {{path}}；确认后点「切换到此目录」', { path: guess }));
        return;
      }
      setRoot(rootName() ?? null);
      setRootPathInput('');
      message.success(t('onboarding.rootSelected', '存储目录已指定'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('onboarding.rootFailed', '选择目录失败'));
    }
  }, [message, t]);

  const applyRootPath = useCallback(async () => {
    const next = rootPathInput.trim();
    if (!next) {
      message.warning(t('onboarding.rootPathRequired', '请填写数据目录的绝对路径'));
      return;
    }
    try {
      const applied = await switchDataRoot(next);
      message.success(t('onboarding.rootSwitched', '数据目录已切换，正在重新加载…'));
      void applied;
      window.setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('onboarding.rootSwitchFailed', '切换目录失败'));
    }
  }, [rootPathInput, message, t]);

  const mcpConfig = serverInfo && mcpToken
    ? buildStdioConfig({ serverEntry: serverInfo.serverEntry, dataRoot: serverInfo.dataRoot }, mcpToken)
    : '';
  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(t('onboarding.copyFailed', '复制失败，请手动选择复制'));
    }
  }, [message, t]);
  const copyBootstrap = useCallback(() => {
    const command = buildBootstrapCommand({
      platform: detectBootstrapPlatform(),
      downloadUrl: `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}downloads/zeroexo-mcp-server.tgz`,
    });
    void copyText(command, t('onboarding.installCommand', '安装命令'));
  }, [copyText, t]);

  const testComfy = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testEndpointConnection(address);
      if (res.kind === 'ok') {
        useComfyuiEndpointStore.getState().markTested(address, res.backend, res.models, res.machine);
        const backendLabel = res.backend === 'zeroexo'
          ? t('onboarding.backendZeroexo', 'ZeroExo 插件')
          : res.backend === 'direct'
            ? t('onboarding.backendDirect', '直连桥接')
            : t('onboarding.backendOpenAI', 'OpenAI 兼容口');
        setTestResult(`${t('onboarding.comfyOk', '已连接')}：${backendLabel}`);
      } else {
        setTestResult(res.message);
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : t('onboarding.comfyFailed', '连接失败'));
    } finally {
      setTesting(false);
    }
  }, [address, t]);

  const comfyDone = endpoint.connected;
  const advanceRoot = currentDataRootPath();

  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={680}
      title={t('onboarding.title', '使用指引')}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('onboarding.footerHint', '随时可从主页底部「使用指引」再次打开')}
          </span>
          <Button type="primary" onClick={onClose}>{t('onboarding.start', '开始创作')}</Button>
        </div>
      )}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        {/* 1 存储目录 */}
        <StepCard index={1} title={t('onboarding.stepRoot', '选择存储目录')} done={Boolean(root)} theme={theme}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<FolderOpen size={13} />} onClick={() => void chooseRoot()}>
              {root ? t('onboarding.changeRoot', '重新选择') : t('onboarding.chooseRoot', '选择目录')}
            </Button>
            <span style={{ ...hintStyle(theme), overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {root ?? t('onboarding.rootNone', '尚未选择')}
            </span>
          </div>
          {advanceRoot ? (
            <Collapse
              ghost
              size="small"
              items={[{
                key: 'advanced-root',
                label: <span style={{ fontSize: 12 }}>{t('onboarding.advanced', '高级选项')}</span>,
                children: (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Input
                      size="small"
                      value={rootPathInput}
                      onChange={(e) => setRootPathInput(e.target.value)}
                      placeholder={t('onboarding.rootPathPlaceholder', '绝对路径，例如 D:\\ZeroExo')}
                      style={{ width: 320 }}
                    />
                    <Button size="small" onClick={() => void applyRootPath()}>
                      {t('onboarding.switchRoot', '切换到此目录')}
                    </Button>
                  </div>
                ),
              }]}
            />
          ) : null}
        </StepCard>

        {/* 2 MCP：默认只给一个复制按钮；完整配置/密钥收进高级选项 */}
        <StepCard index={2} title={t('onboarding.stepMcp', '接入 MCP（给 Agent IDE）')} done={Boolean(serverInfo)} theme={theme}>
          <span style={hintStyle(theme)}>
            {serverInfo
              ? t('onboarding.stepMcpHint', '复制配置，粘到 Agent IDE 的 MCP 设置里。')
              : t('onboarding.stepMcpFirstRun', '先复制安装命令，在终端跑一次；成功后这里会自动识别。')}
          </span>
          <div>
            <Button
              size="small"
              type="primary"
              icon={<Copy size={13} />}
              onClick={() => {
                if (serverInfo) void copyText(mcpConfig, t('onboarding.copyMcp', 'MCP 配置'));
                else copyBootstrap();
              }}
            >
              {serverInfo
                ? t('onboarding.copyMcp', '复制 MCP 配置')
                : t('onboarding.copyBootstrap', '复制安装命令')}
            </Button>
          </div>
          {mcpStaleTools.length > 0 ? (
            <span style={{ fontSize: 12, color: '#d97706' }}>
              检测到 MCP 服务是旧版本（缺 {mcpStaleTools.length} 个工具）：重启 IDE 里的 MCP 服务后再生效。
            </span>
          ) : null}
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'advanced-mcp',
              label: <span style={{ fontSize: 12 }}>{t('onboarding.advancedKeys', '高级选项（密钥 / 完整配置）')}</span>,
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    readOnly
                    value={mcpConfig || t('onboarding.mcpNotReady', 'MCP 未就绪，暂无可复制配置')}
                    style={{
                      width: '100%', minHeight: 92, resize: 'vertical', boxSizing: 'border-box',
                      fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5,
                      color: theme.toolbar.text, background: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.03)',
                      border: `1px solid ${theme.toolbar.border}`, borderRadius: 8, padding: 8,
                    }}
                  />
                  <div>
                    <Button size="small" disabled={!mcpConfig} onClick={() => void copyText(mcpConfig, t('onboarding.copyMcp', 'MCP 配置'))}>
                      {t('onboarding.copyMcp', '复制 MCP 配置')}
                    </Button>
                  </div>
                </div>
              ),
            }]}
          />
        </StepCard>

        {/* 3 ComfyUI */}
        <StepCard index={3} title={t('onboarding.stepComfy', '连接 ComfyUI')} done={comfyDone} theme={theme}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button
              size="small"
              type="primary"
              icon={<Download size={13} />}
              href={pluginZipUrl}
              download
              data-testid="onboarding-download-plugin"
            >
              {t('onboarding.downloadPlugin', '下载插件 ZIP')}
            </Button>
            <span style={hintStyle(theme)}>
              {t('onboarding.pluginPathHint', '解压到 {{path}}，重启 ComfyUI', { path: PLUGIN_DIR })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              size="small"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={DEFAULT_COMFYUI}
              style={{ width: 320 }}
            />
            <Button size="small" icon={<Cpu size={13} />} loading={testing} onClick={() => void testComfy()}>
              {t('onboarding.testComfy', '测试连接')}
            </Button>
          </div>
          {testResult ? (
            <span style={{ fontSize: 12, color: comfyDone ? '#16a34a' : '#dc2626' }}>{testResult}</span>
          ) : null}
          <div data-onboarding-models style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ ...hintStyle(theme), flexShrink: 0 }}>{t('onboarding.models', '支持的模型')}</span>
            {MODELS.map((m) => (
              <Tag key={m.name} style={{ marginInlineEnd: 0 }} title={m.note}>
                {m.name}
                <span style={{ opacity: 0.6, marginLeft: 4 }}>{m.note}</span>
              </Tag>
            ))}
          </div>
          {/* 机器档位 → 模型推荐（本地 / 云端）：8GB 只建议图片，H3 按量化档位选 */}
          <div data-model-recommendations style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t('onboarding.modelGuide', '机器配置推荐')}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, lineHeight: 1.5 }}>
              <thead>
                <tr style={{ color: theme.toolbar.textMuted, textAlign: 'left' }}>
                  <th style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}` }}>{t('onboarding.vram', '显存')}</th>
                  <th style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}` }}>{t('onboarding.localPick', '本地推荐')}</th>
                  <th style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}` }}>{t('onboarding.cloudPick', '云端 / 远程')}</th>
                </tr>
              </thead>
              <tbody>
                {MODEL_RECOMMENDATIONS.map((row) => (
                  <tr key={row.vram}>
                    <td style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}`, whiteSpace: 'nowrap', fontWeight: 600 }}>{row.vram}</td>
                    <td style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}` }}>{row.local}</td>
                    <td style={{ padding: '3px 6px', borderBottom: `1px solid ${theme.toolbar.border}` }}>{row.cloud}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span style={hintStyle(theme)}>
              {t('onboarding.modelGuideHint', 'H3 官方推荐：pruned INT8 扩散（约 21GB）+ NVFP4 文本编码器（14.6GB）；BF16 66GB 非消费级，本地任何卡都出不了 2K。8GB 机器优先做图片，视频走云端 INT8。')}
            </span>
          </div>
        </StepCard>
      </div>
    </Modal>
  );
}

/** 主页底部「使用指引」条（代替原来的政策公告位），同时充当「MCP 服务已更新」的自动提示位 */
export function OnboardingNotice({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();

  return (
    <div
      data-onboarding-notice
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 20px',
        borderTop: `1px solid ${theme.toolbar.border}`,
        fontSize: 12,
        color: theme.toolbar.textMuted,
        background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
      }}
    >
      <span>{t('onboarding.notice', '第一次使用？先完成存储目录、MCP、ComfyUI 三项准备。')}</span>
      <Button size="small" type="link" onClick={onOpen} style={{ paddingInline: 4 }}>
        {t('onboarding.open', '打开使用指引')}
      </Button>
    </div>
  );
}
