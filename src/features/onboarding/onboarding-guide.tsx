/**
 * 首次使用指引（2026-11-10 用户要求）
 *
 * 三项先决条件，缺一项都跑不起来：
 * 1. 指定存储路径（浏览器数据目录授权）；
 * 2. MCP 服务：一键复制配置，去 Agent IDE 里粘贴启动；
 * 3. ComfyUI：装插件 + 填地址（本机 / 云端均可）。
 *
 * 首次打开自动弹出一次；之后从主页底部「使用指引」再次打开（代替已经不存在的政策公告位）。
 */
import { buildBootstrapCommand, detectBootstrapPlatform } from '@/features/mcp-settings/mcp-bootstrap.js';
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Copy, Cpu, FolderOpen } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, rootName, currentDataRootPath, switchDataRoot } from '@/platform/fs.js';
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

export function OnboardingGuide({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message } = App.useApp();
  const endpoint = useComfyuiEndpointStore();

  // 步骤 1：数据目录
  const [root, setRoot] = useState<string | null>(null);
  // 步骤 2：MCP
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  /** 服务端跑的是旧代码时缺的工具（网页自动感知更新） */
  const [mcpStaleTools, setMcpStaleTools] = useState<string[]>([]);
  /** 本地服务托管时的绝对路径输入（浏览器目录选择在该模式下不生效） */
  const [rootPathInput, setRootPathInput] = useState('');
  // 步骤 3：ComfyUI
  const [address, setAddress] = useState(endpoint.address || DEFAULT_COMFYUI);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(rootName() ?? null);
    setRootPathInput(currentDataRootPath() ?? '');
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
    setAddress(endpoint.address || DEFAULT_COMFYUI);
  }, [open, endpoint.address]);

  // 全新机器：用户跑完安装命令后，MCP 会写 server-info；这里自动轮询识别，不需要「刷新」按钮。
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
      await pickRoot();
      setRoot(rootName() ?? null);
      setRootPathInput(currentDataRootPath() ?? '');
      message.success(t('onboarding.rootSelected', '存储路径已指定'));
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

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) {
      // 全新机器本来就没有 MCP 服务：这不是错误，给「首次使用」指引而不是告警
      message.info(t('onboarding.mcpFirstRun', '还没有检测到 MCP 服务：首次使用请先下载并启动一次，启动后这里会自动生成带 token 的配置'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(t('onboarding.copyFailed', '复制失败，请手动选择复制'));
    }
  }, [message, t]);

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
            : t('onboarding.backendOpenai', 'OpenAI 兼容口');
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

  return (
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={680}
      title={t('onboarding.title', '开始使用：先完成 3 项准备')}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('onboarding.footerHint', '随时可从主页底部「使用指引」再次打开')}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onClose}>{t('onboarding.later', '稍后设置')}</Button>
            <Button type="primary" onClick={onClose}>{t('onboarding.start', '开始创作')}</Button>
          </span>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        {/* 1 存储路径 */}
        <StepCard index={1} title={t('onboarding.stepRoot', '指定存储路径')} done={Boolean(root)} theme={theme}>
          <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
            {t('onboarding.stepRootHint', '项目、素材、生成结果都会写在同一个本地目录；换机器时把这个目录拷走即可。')}
          </span>
          {currentDataRootPath() ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
                {t('onboarding.rootManaged', '当前由本地数据服务托管：')}
                <code style={{ marginLeft: 6 }}>{currentDataRootPath()}</code>
              </span>
              <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
                {t('onboarding.rootManagedHint', '该模式下浏览器里选目录不生效（MCP 与网页必须同源）。要换目录：填下面的绝对路径并切换，网页和 MCP 会同时改用新目录。')}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Input
                  size="small"
                  value={rootPathInput}
                  onChange={(e) => setRootPathInput(e.target.value)}
                  placeholder={t('onboarding.rootPathPlaceholder', '绝对路径，例如 D:\\ZeroExo')}
                  style={{ width: 360 }}
                />
                <Button size="small" type="primary" onClick={() => void applyRootPath()}>
                  {t('onboarding.switchRoot', '切换到此目录')}
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Button size="small" icon={<FolderOpen size={13} />} onClick={() => void chooseRoot()}>
                {root ? t('onboarding.changeRoot', '重新选择目录') : t('onboarding.chooseRoot', '选择存储目录')}
              </Button>
              <span style={{ fontSize: 12, color: theme.toolbar.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {root ?? t('onboarding.rootNone', '尚未指定（浏览器需要授权一次）')}
              </span>
            </div>
          )}
        </StepCard>

        {/* 2 MCP */}
        <StepCard index={2} title={t('onboarding.stepMcp', '启动 MCP 服务（给 Agent IDE）')} done={Boolean(serverInfo)} theme={theme}>
          <span style={{ fontSize: 12, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
            {serverInfo
              ? t('onboarding.stepMcpHint', '复制下面的配置，粘到 Agent IDE（如 Cursor / Claude Code）的 MCP 设置里；配置里已带 token。')
              : t('onboarding.stepMcpFirstRun', '首次使用：点下面按钮复制一条命令，粘到终端跑一次（需要 Node 18+）。它会自动下载并启动 MCP，成功后本页会自动识别。')}
          </span>
          <div>
            <Button
              size="small"
              type="primary"
              icon={<Copy size={13} />}
              onClick={() => void copy(
                serverInfo
                  ? mcpConfig
                  : buildBootstrapCommand({
                      platform: detectBootstrapPlatform(),
                      downloadUrl: `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}downloads/zeroexo-mcp-server.tgz`,
                    }),
                serverInfo ? 'MCP 配置' : '安装命令',
              )}
            >
              {serverInfo
                ? t('onboarding.copyMcp', '复制 MCP 配置')
                : t('onboarding.copyBootstrap', '一键复制安装命令')}
            </Button>
          </div>
          {mcpStaleTools.length > 0 ? (
            <span style={{ fontSize: 12, color: '#d97706' }}>
              检测到 MCP 服务是旧版本（缺 {mcpStaleTools.length} 个工具，如 {mcpStaleTools[0]}）：重启 IDE 里的 MCP 服务后再生效。
            </span>
          ) : null}
        </StepCard>

        {/* 3 ComfyUI */}
        <StepCard index={3} title={t('onboarding.stepComfy', '安装 ComfyUI 插件并填地址')} done={comfyDone} theme={theme}>
          <span style={{ fontSize: 12, color: theme.toolbar.textMuted, lineHeight: 1.7 }}>
            {t('onboarding.stepComfyHint', '把仓库里的 comfyui-plugin/ComfyUI_ZeroExoNodes 复制到 ComfyUI 的 custom_nodes/ 后重启 ComfyUI；本机填 http://127.0.0.1:8188，云端填 AI Gate 的公网地址。')}
          </span>
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
        </StepCard>
      </div>
    </Modal>
  );
}

/** 主页底部「使用指引」条（代替原来的政策公告位），同时充当「MCP 服务已更新」的自动提示位 */
export function OnboardingNotice({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [staleTools, setStaleTools] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void loadServerInfo()
      .then((info) => { if (alive) setStaleTools(mcpServerMissingTools(info)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
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
        color: staleTools.length > 0 ? '#d97706' : theme.toolbar.textMuted,
        background: theme.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
      }}
    >
      <span>
        {staleTools.length > 0
          ? `MCP 服务已更新：重启 IDE 里的 MCP 服务后新工具才生效（当前缺 ${staleTools.length} 个）。`
          : t('onboarding.notice', '第一次使用？先完成 3 项准备：存储路径、MCP 服务、ComfyUI 插件与地址。')}
      </span>
      <Button size="small" type="link" onClick={onOpen} style={{ paddingInline: 4 }}>
        {t('onboarding.open', '打开使用指引')}
      </Button>
    </div>
  );
}
