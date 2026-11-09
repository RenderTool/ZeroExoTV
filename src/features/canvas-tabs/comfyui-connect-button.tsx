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
import { Button, Input, Popover, Select, Space, Tooltip, Typography } from 'antd';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { pickDefaultModels, useComfyuiConnectionStore } from './comfyui-connection.js';
import { TopBarIcon, topBarButtonStyle } from '@/shared/components/topbar-icon-button.js';
import {
  applyConnectionResult,
  notifyManualConnectionResult,
  requestComfyuiAutoProbe,
  retryComfyuiConnection,
  useComfyuiAutoConnect,
  useComfyuiAutoConnectStore,
} from './comfyui-auto-connect.js';
import { resolveUseLowVram } from './vram-mode.js';
import {
  testEndpointConnection,
  useComfyuiEndpointStore,
  type ComfyuiVramMode,
  type EndpointTestResult,
} from './comfyui-endpoint.js';

const { Text } = Typography;

export function ComfyuiConnectButton({ autoProbeDisabled = false, inline = false }: { autoProbeDisabled?: boolean; inline?: boolean }): JSX.Element {
  const { t } = useTranslation();
  const ep = useComfyuiEndpointStore();
  const autoState = useComfyuiAutoConnectStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(ep.address);
  const [testing, setTesting] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const modelSel = useComfyuiConnectionStore((s) => s.models);
  const availableModels = useComfyuiConnectionStore((s) => s.availableModels);
  const setModel = useComfyuiConnectionStore((s) => s.setModel);
  const setConnectedModels = useComfyuiConnectionStore((s) => s.setConnected);
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

  const reloadModels = useCallback(async () => {
    if (!ep.address) return;
    setRefreshingModels(true);
    try {
      const models = await fetchBridgeModels(ep.address);
      const defaults = pickDefaultModels(models, modelSel);
      setConnectedModels(true, { unet: models.unet, vae: models.vae, clip: models.clip });
      for (const slot of ['unet', 'videoVae', 'audioVae', 'clip'] as const) {
        setModel(slot, defaults[slot]);
      }
    } catch {
      setConnectedModels(true);
    } finally {
      setRefreshingModels(false);
    }
  }, [ep.address, modelSel, setConnectedModels, setModel]);

  const statusWord = !ep.connected
    ? null
    : ep.backend === 'direct'
      ? t('director.endpointStatusDirect')
      : ep.backend === 'zeroexo'
        ? t('director.endpointStatusZeroexo', '已连接 · 插件')
        : t('director.endpointStatusOpenai');

  const machine = ep.machine ?? (testResult?.kind === 'ok' ? testResult.machine : undefined);
  const autoLow = resolveUseLowVram(machine, 'auto');
  const effectiveLow = resolveUseLowVram(machine, ep.vramMode);
  const gb = (bytes?: number): string =>
    typeof bytes === 'number' && Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : '—';
  const vramTotal = machine?.vramTotalBytes;
  const vramModeOptions: Array<{ value: ComfyuiVramMode; label: string }> = [
    { value: 'auto', label: t('director.vramAuto', '自动') },
    { value: 'low', label: t('director.vramLow', '低显存') },
    { value: 'high', label: t('director.vramHigh', '高显存') },
  ];
  const vramSummary = !machine
    ? t('director.vramUnknown', '未读取到机器显存，自动按低显存保守运行')
    : ep.vramMode === 'auto'
      ? autoLow
        ? t('director.vramAutoLow', '自动：低显存（检测到 {{vram}}）', { vram: gb(vramTotal) })
        : t('director.vramAutoHigh', '自动：高显存（检测到 {{vram}}）', { vram: gb(vramTotal) })
      : effectiveLow
        ? t('director.vramForcedLow', '手动：强制低显存')
        : t('director.vramForcedHigh', '手动：强制高显存');

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
        {ep.connected && testResult?.kind !== 'ok' && (
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
            : testResult.backend === 'zeroexo'
              ? t('director.endpointStatusZeroexo', '已连接 · 插件')
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
      {(testResult?.kind === 'ok' || ep.connected) && (
        <div data-testid="comfyui-machine-info" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: '1px solid rgba(128,128,128,0.18)' }}>
          <Text strong style={{ fontSize: 12 }}>
            {t('director.machineInfo', '连接机器')}
          </Text>
          {machine ? (
            <div data-testid="comfyui-machine-specs" style={{ fontSize: 11, color: 'var(--ant-color-text-secondary, #888)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span data-testid="comfyui-gpu-name">{machine.gpuName ?? 'GPU'} {machine.gpuType ? `· ${machine.gpuType}` : ''}</span>
              <span data-testid="comfyui-vram">
                {t('director.vramTotal', '显存')} {gb(machine.vramTotalBytes)}
                {typeof machine.vramFreeBytes === 'number' ? `（${t('director.vramFree', '空闲')} ${gb(machine.vramFreeBytes)}）` : ''}
              </span>
              {typeof machine.ramTotalBytes === 'number' && (
                <span>{t('director.ramTotal', '内存')} {gb(machine.ramTotalBytes)}</span>
              )}
              {machine.comfyuiVersion && <span>ComfyUI {machine.comfyuiVersion}</span>}
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }} data-testid="comfyui-machine-missing">
              {t('director.machineUnknown', '未读取到机器信息（/system_stats 被拦截或旧版 ComfyUI）')}
            </Text>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t('director.vramStrategy', '显存策略')}</Text>
            <Select
              data-testid="comfyui-vram-mode"
              size="small"
              value={ep.vramMode}
              options={vramModeOptions}
              onChange={(mode) => ep.setVramMode(mode)}
              style={{ flex: 1 }}
              popupMatchSelectWidth={false}
            />
          </div>
          <Text type={ep.vramMode === 'auto' ? 'secondary' : 'warning'} style={{ fontSize: 11 }} data-testid="comfyui-vram-summary">
            {vramSummary}
          </Text>
          {ep.vramMode === 'high' && autoLow && (
            <Text type="danger" style={{ fontSize: 11 }} data-testid="comfyui-vram-risk">
              {t('director.vramHighRisk', '检测到的显存低于 16GB，强制高显存可能 OOM；后果由你自行承担')}
            </Text>
          )}
        </div>
      )}
      {(ep.connected || availableModels.unet.length > 0 || availableModels.vae.length > 0) && (
        <div
          data-testid="comfyui-model-config"
          style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(128,128,128,0.18)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text strong style={{ fontSize: 12 }}>{t('director.modelConfig', '模型配置')}</Text>
            <Button
              type="link"
              size="small"
              loading={refreshingModels}
              style={{ padding: 0, fontSize: 11 }}
              onClick={() => void reloadModels()}
            >
              {t('director.modelRefresh', '刷新列表')}
            </Button>
          </div>
          {([
            ['unet', t('director.modelUnet', '视频主模型'), availableModels.unet],
            ['videoVae', t('director.modelVideoVae', '视频 VAE'), availableModels.vae],
            ['audioVae', t('director.modelAudioVae', '音频 VAE'), availableModels.vae],
            ['clip', t('director.modelClip', '文本编码器'), availableModels.clip],
          ] as const).map(([slot, label, options]) => (
            <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ width: 76, flexShrink: 0, fontSize: 11 }}>{label}</Text>
              <Select
                size="small"
                data-testid={`comfyui-model-${slot}`}
                value={modelSel[slot] || undefined}
                placeholder={options.length ? t('director.modelPick', '选择模型') : t('director.modelEmpty', '连接后读取列表')}
                options={options.map((name) => ({ value: name, label: name }))}
                onChange={(value) => setModel(slot, value)}
                showSearch
                optionFilterProp="label"
                style={{ flex: 1, minWidth: 0 }}
                popupMatchSelectWidth={false}
              />
            </div>
          ))}
          {availableModels.unet.length === 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('director.modelListHint', '点「刷新列表」从当前 ComfyUI 读取 diffusion_models / vae / text_encoders。')}
            </Text>
          )}
        </div>
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
    </div>
  );

  if (inline) return content;

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
    </>
  );
}
