/**
 * comfyui-connect-button — 顶栏右上角「ComfyUI」唯一入口（2026-11-05 全局化）
 *
 * 约定：无论线上还是线下的 ComfyUI 都只填一个地址，且只在顶栏这一处配置；
 * 导演台等其他功能一律从 comfyui-endpoint 读同一个地址，不再重复输入。
 * 入口形态：右上角图标组内的 32×32 文本按钮（PlugZap 16px + 右下角状态点），
 * Tooltip 显示状态词与地址；状态点：未连接灰 / 连接中蓝 / 已连接绿 / 失败红。面板只剩：
 * - 一个输入框：ComfyUI 地址（本机 http://127.0.0.1:8188，线上地址也填这里）；
 * - 两个按钮：测试连接 / 保存；一个「工作流配置」入口；
 * - 一个状态点 + 短词（已连接 · 直连 / 已连接 · 兼容口），不展示长篇判定细节。
 *
 * 旧概念全部移除：多渠道管理、渠道名称、Base URL（OpenAI 兼容）字样、API Key、
 * 视频/图片模型标识、常驻的 --enable-cors-header 说明。CORS 提示只在测试失败且
 * 判定为跨域时出现一行（testEndpointConnection 的 message），不常驻面板。
 *
 * 后端类型自动判定（comfyui-endpoint.testEndpointConnection）：
 * 优先探测直连（/system_stats），不通再按 OpenAI 兼容口（/v1/models）。
 * 直连测试通过后自动抓取 /zeroexo/h3/models 并按 minimax_h3 规则挑选模型四件套
 * （存于 comfyui-connection，不再在界面暴露下拉）；桥接插件缺失时给一行短提示。
 * 保存/测试通过后，导演台运行按钮直接用这个地址（getRunConfigFromEndpoint），
 * 不存在渠道选择环节。
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Divider, Input, Popover, Space, Tooltip, Typography } from 'antd';
import { WorkflowConfigDialog } from '@/features/comfyui-workflows/index.js';
import { TopBarIcon, topBarButtonStyle } from '@/shared/components/topbar-icon-button.js';
import {
  applyConnectionResult,
  notifyManualConnectionResult,
  requestComfyuiAutoProbe,
  retryComfyuiConnection,
  useComfyuiAutoConnect,
  useComfyuiAutoConnectStore,
} from './comfyui-auto-connect.js';
import {
  testEndpointConnection,
  useComfyuiEndpointStore,
  type EndpointTestResult,
} from './comfyui-endpoint.js';

const { Text } = Typography;

export function ComfyuiConnectButton({ autoProbeDisabled = false }: { autoProbeDisabled?: boolean }): JSX.Element {
  const { t } = useTranslation();
  const ep = useComfyuiEndpointStore();
  const autoState = useComfyuiAutoConnectStore();
  const [open, setOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const [draft, setDraft] = useState(ep.address);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null);
  /** 直连测试通过但桥接插件 /zeroexo/h3/* 未响应（一行短提示，测试后出现） */
  const [bridgeWarn, setBridgeWarn] = useState(false);

  // 自动连接：进入导演台即静默探一次（失败只在面板留一行原因，不弹窗）
  useComfyuiAutoConnect({ disabled: autoProbeDisabled });

  const patchDraft = useCallback((value: string) => {
    setDraft(value);
    setTestResult(null); // 地址变动 → 上次测试结果作废
    setBridgeWarn(false);
  }, []);

  const runTest = useCallback(async () => {
    const address = draft.trim();
    if (!address) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testEndpointConnection(address);
      setTestResult(r);
      // 手动测试同样静默落状态（无 toast）；同时回报给调度器更新退避/失败计数
      notifyManualConnectionResult(r);
      const applied = await applyConnectionResult(r);
      setBridgeWarn(applied.bridgeMissing);
    } finally {
      setTesting(false);
    }
  }, [draft]);

  const save = useCallback(() => {
    if (!draft.trim()) return;
    ep.applyAddress(draft);
  }, [draft, ep]);

  const statusWord = !ep.connected
    ? null
    : ep.backend === 'direct'
      ? t('director.endpointStatusDirect')
      : t('director.endpointStatusOpenai');

  const connectionState = ep.connected
    ? 'connected'
    : testing || autoState.status === 'probing'
      ? 'connecting'
      : autoState.status === 'failed'
        ? 'failed'
        : 'disconnected';
  const stateLabel =
    connectionState === 'connected'
      ? statusWord ?? t('director.endpointStatusDirect')
      : connectionState === 'connecting'
        ? t('director.comfyStatusConnecting', '连接中')
        : connectionState === 'failed'
          ? t('director.comfyStatusFailed', '连接失败')
          : t('director.comfyStatusDisconnected', '未连接');
  const stateDotColor =
    connectionState === 'connected'
      ? '#52c41a'
      : connectionState === 'connecting'
        ? '#1677ff'
        : connectionState === 'failed'
          ? '#ff4d4f'
          : '#bfbfbf';
  const triggerTooltip = `${stateLabel} · ${ep.address || '未填写地址'}`;

  const content = (
    <div data-testid="comfyui-endpoint-panel" style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Input
        data-testid="comfyui-address-input"
        value={draft}
        onChange={(e) => patchDraft(e.target.value)}
        placeholder="http://127.0.0.1:8188"
        allowClear
      />
      <Space>
        <Button data-testid="comfyui-test-btn" size="small" type="primary" loading={testing} onClick={() => void runTest()}>
          {t('director.comfyTest')}
        </Button>
        <Button data-testid="comfyui-save-btn" size="small" onClick={save}>
          {t('director.endpointSave')}
        </Button>
        {ep.connected && (
          <span data-testid="comfyui-status">
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#52c41a',
                boxShadow: '0 0 4px #52c41a',
                marginRight: 4,
              }}
            />
            <Text type="success" style={{ fontSize: 12 }}>{statusWord}</Text>
          </span>
        )}
      </Space>
      {testResult?.kind === 'ok' && (
        <Text type="success" style={{ fontSize: 12 }} data-testid="comfyui-test-ok">
          {testResult.backend === 'direct'
            ? t('director.endpointStatusDirect')
            : t('director.endpointStatusOpenai')}
        </Text>
      )}
      {testResult?.kind === 'fail' && (
        <Text type="danger" style={{ fontSize: 12 }} data-testid="comfyui-test-fail">
          {testResult.message}
        </Text>
      )}
      {bridgeWarn && (
        <Text type="warning" style={{ fontSize: 12 }}>
          {t('director.comfyBridgeMissing')}
        </Text>
      )}
      {/* 自动连接失败：不弹窗，只在面板留一行可读原因 + 「重试」（手动永远放行） */}
      {!testResult && autoState.failureMessage && (
        <div data-testid="comfyui-auto-fail" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Text type="warning" style={{ fontSize: 12, flex: 1 }}>
            {autoState.failureMessage}
          </Text>
          <Button
            type="link"
            size="small"
            data-testid="comfyui-auto-retry"
            style={{ padding: 0, fontSize: 12 }}
            onClick={() => retryComfyuiConnection()}
          >
            {t('director.autoConnectRetry')}
          </Button>
        </div>
      )}
      {!testResult && autoState.autoStopped && (
        <Text type="secondary" style={{ fontSize: 12 }} data-testid="comfyui-auto-stopped">
          {t('director.autoConnectStopped')}
        </Text>
      )}
      <Divider style={{ margin: '2px 0' }} />
      <Button
        size="small"
        data-testid="comfyui-workflows-btn"
        onClick={() => {
          setOpen(false);
          setWorkflowsOpen(true);
        }}
      >
        工作流配置
      </Button>
    </div>
  );

  return (
    <>
    <Popover
      content={content}
      title={t('director.comfyTitle')}
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setDraft(useComfyuiEndpointStore.getState().address);
          setTestResult(null);
          setBridgeWarn(false);
          requestComfyuiAutoProbe('panel'); // 打开面板自动探一次（受 60s/退避/停用约束）
        }
      }}
      placement="bottomRight"
    >
      <Tooltip title={triggerTooltip} placement="bottom">
        <Button
          type="text"
          aria-label={`ComfyUI ${stateLabel}`}
          data-testid="comfyui-connect-trigger"
          data-connection-state={connectionState}
          style={{
            ...topBarButtonStyle,
            color: 'inherit',
            position: 'relative',
          }}
        >
          <TopBarIcon action="comfyui" />
          <span
            aria-hidden
            data-testid="comfyui-connect-dot"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: stateDotColor,
              boxShadow: connectionState === 'disconnected' ? 'none' : `0 0 4px ${stateDotColor}`,
            }}
          />
        </Button>
      </Tooltip>
    </Popover>
    <WorkflowConfigDialog open={workflowsOpen} onClose={() => setWorkflowsOpen(false)} />
    </>
  );
}
