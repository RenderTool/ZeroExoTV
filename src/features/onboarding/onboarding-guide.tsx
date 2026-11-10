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
import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Copy, Cpu, FolderOpen, Plug } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, rootName } from '@/platform/fs.js';
import {
  buildStartCommands,
  buildStdioConfig,
  ensureIdeToken,
  loadServerInfo,
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
  // 步骤 3：ComfyUI
  const [address, setAddress] = useState(endpoint.address || DEFAULT_COMFYUI);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(rootName() ?? null);
    void (async () => {
      try {
        const info = await loadServerInfo();
        setServerInfo(info);
        if (info) setMcpToken(await ensureIdeToken());
      } catch {
        setServerInfo(null);
      }
    })();
    setAddress(endpoint.address || DEFAULT_COMFYUI);
  }, [open, endpoint.address]);

  const chooseRoot = useCallback(async () => {
    try {
      await pickRoot();
      setRoot(rootName() ?? null);
      message.success(t('onboarding.rootSelected', '存储路径已指定'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('onboarding.rootFailed', '选择目录失败'));
    }
  }, [message, t]);

  const mcpConfig = serverInfo && mcpToken
    ? buildStdioConfig({ serverEntry: serverInfo.serverEntry, dataRoot: serverInfo.dataRoot }, mcpToken)
    : '';
  const startCommand = buildStartCommands(serverInfo).stdio;

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) {
      message.warning(t('onboarding.mcpNotReady', 'MCP 服务信息还没有生成：先在设置里启动一次 MCP 服务'));
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<FolderOpen size={13} />} onClick={() => void chooseRoot()}>
              {root ? t('onboarding.changeRoot', '重新选择目录') : t('onboarding.chooseRoot', '选择存储目录')}
            </Button>
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {root ?? t('onboarding.rootNone', '尚未指定（浏览器需要授权一次）')}
            </span>
          </div>
        </StepCard>

        {/* 2 MCP */}
        <StepCard index={2} title={t('onboarding.stepMcp', '启动 MCP 服务（给 Agent IDE）')} done={false} theme={theme}>
          <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>
            {t('onboarding.stepMcpHint', '复制下面的配置，粘到 Agent IDE（如 Cursor / Claude Code）的 MCP 设置里；配置里已带 token。')}
          </span>
          <pre style={{
            margin: 0, padding: 10, borderRadius: 8, maxHeight: 150, overflow: 'auto', fontSize: 11, lineHeight: 1.5,
            background: theme.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(15,23,42,0.05)',
            border: `1px solid ${theme.toolbar.border}`, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
{startCommand || t('onboarding.startCmdPlaceholder', '（先启动一次 MCP 服务后这里会给出命令）')}
          </pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="small" type="primary" icon={<Copy size={13} />} onClick={() => void copy(mcpConfig, 'MCP 配置')}>
              {t('onboarding.copyMcp', '一键复制配置')}
            </Button>
            <Button size="small" icon={<Plug size={13} />} onClick={() => void copy(startCommand, '启动命令')}>
              {t('onboarding.copyStartCmd', '复制启动命令')}
            </Button>
          </div>
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

/** 主页底部「使用指引」条（代替原来的政策公告位） */
export function OnboardingNotice({ onOpen }: { onOpen: () => void }): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
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
      <span>{t('onboarding.notice', '第一次使用？先完成 3 项准备：存储路径、MCP 服务、ComfyUI 插件与地址。')}</span>
      <Button size="small" type="link" onClick={onOpen} style={{ paddingInline: 4 }}>
        {t('onboarding.open', '打开使用指引')}
      </Button>
    </div>
  );
}
