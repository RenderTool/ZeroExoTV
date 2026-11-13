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
import { CheckCircle2, Circle, Cpu, Download, FolderOpen } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, rootName, currentDataRootPath, switchDataRoot } from '@/platform/fs.js';
import { McpSettingsDialog } from '@/features/mcp-settings/mcp-settings-dialog.js';
import {
  testEndpointConnection,
  useComfyuiEndpointStore,
} from '@/features/canvas-tabs/comfyui-endpoint.js';
import { ComfyuiConnectButton } from '@/features/canvas-tabs/comfyui-connect-button.js';

const SEEN_KEY = 'zeroexo:onboarding.seen';
const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const PLUGIN_DIR = 'ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes';

/** 页面内直接列出的生成模型（写死当前支持的四类，不引额外接口） */
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

  const pluginZipUrl = `${import.meta.env.BASE_URL}downloads/ComfyUI_ZeroExoNodes.zip`;

  useEffect(() => {
    if (!open) return;
    setRoot(rootName() ?? null);
    setRootPathInput(currentDataRootPath() ?? '');
    setAddress(endpoint.address || DEFAULT_COMFYUI);
  }, [open, endpoint.address]);

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

        {/* 2 MCP：直接复用唯一 MCP 设置面板（首屏配置 + 高级密钥已收在组件内部） */}
        <StepCard index={2} title={t('onboarding.stepMcp', '接入 MCP（给 Agent IDE）')} done={false} theme={theme}>
          <span style={hintStyle(theme)}>
            {t('onboarding.stepMcpHint', '复制配置，粘到 Agent IDE 的 MCP 设置里。')}
          </span>
          <McpSettingsDialog embedded />
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
            <ComfyuiConnectButton inline />
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
