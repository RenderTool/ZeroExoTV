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
import { App, AutoComplete, Button, Collapse, Input, Modal, Tag } from 'antd';
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
import { fetchBridgeModels } from '@/features/canvas-tabs/comfyui-bridge-client.js';
import { pickDefaultModels, useComfyuiConnectionStore } from '@/features/canvas-tabs/comfyui-connection.js';
import { applyConnectionResult } from '@/features/canvas-tabs/comfyui-auto-connect.js';

const SEEN_KEY = 'zeroexo:onboarding.seen';
const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const PLUGIN_DIR = 'ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes';

/** 每个槽位只推荐一个；连接后拿云端列表逐项核对是否有这个文件 */
const RECOMMENDED_MODELS = {
  unet: 'minimax_h3_hybrid_fl2va_ref2va_b15-49-int8.safetensors',
  videoVae: 'minimax_h3_video_vae_fp16.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
} as const;

/** 机器档位 → 推荐用法（只讲能不能做，不讲量化术语） */
const MODEL_RECOMMENDATIONS: Array<{ vram: string; local: string; cloud: string }> = [
  { vram: '8 GB', local: '只做图片：QwenImage2.1 / Krea2 / MossImage。视频用云端。', cloud: 'H3 云端' },
  { vram: '12–16 GB', local: '图片都能用；视频只做短片段、低分辨率。', cloud: 'H3 云端' },
  { vram: '24 GB', local: '图片都能用；视频可做完整片段，模型选带「推荐」的。', cloud: 'H3 云端 / 2K' },
  { vram: '32 GB+', local: '视频可做完整片段；本地仍然出不了 2K。', cloud: '2K' },
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

/** 模型名可下拉选，也可手动输入（云端/第三方命名不一致时兜底） */
function ModelNamePicker({
  value, options, placeholder, onCommit, slot,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  onCommit: (value: string) => void;
  slot: string;
}): React.ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = (): void => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  };
  return (
    <AutoComplete
      value={draft}
      options={options}
      data-onboarding-model={slot}
      placeholder={placeholder}
      onChange={(next) => setDraft(next)}
      onSelect={(next: string) => { setDraft(next); onCommit(next); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      showSearch
      filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      style={{ flex: 1, minWidth: 0 }}
    />
  );
}

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
  const [refreshingModels, setRefreshingModels] = useState(false);
  const models = useComfyuiConnectionStore((s) => s.models);
  const availableModels = useComfyuiConnectionStore((s) => s.availableModels);
  const setModel = useComfyuiConnectionStore((s) => s.setModel);
  const setConnectedModels = useComfyuiConnectionStore((s) => s.setConnected);

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

  const loadModels = useCallback(async (addr: string) => {
    setRefreshingModels(true);
    try {
      const list = await fetchBridgeModels(addr);
      const current = useComfyuiConnectionStore.getState().models;
      const defaults = pickDefaultModels(list, current);
      setConnectedModels(true, list);
      (['unet', 'videoVae', 'audioVae', 'clip'] as const).forEach((slot) => {
        if (defaults[slot]) setModel(slot, defaults[slot]);
      });
    } catch {
      setConnectedModels(true);
    } finally {
      setRefreshingModels(false);
    }
  }, [setConnectedModels, setModel]);

  useEffect(() => {
    if (open && endpoint.connected && endpoint.address) void loadModels(endpoint.address);
  }, [open, endpoint.connected, endpoint.address, loadModels]);

  const testComfy = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testEndpointConnection(address);
      if (res.kind === 'ok') {
        // 关键：同时写 endpoint 与 comfyui-connection 两个 store，
        // 否则导演台/画布只认 connection.connected，会继续提示“尚未连接”。
        const applied = await applyConnectionResult(res);
        const backendLabel = res.backend === 'zeroexo'
          ? t('onboarding.backendZeroexo', 'ZeroExo 插件')
          : res.backend === 'direct'
            ? t('onboarding.backendDirect', '直连桥接')
            : t('onboarding.backendOpenAI', 'OpenAI 兼容口');
        setTestResult(`${t('onboarding.comfyOk', '已连接')}：${backendLabel}${applied.bridgeMissing ? '（模型列表读取失败，可点刷新）' : ''}`);
      } else {
        setTestResult(res.message);
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : t('onboarding.comfyFailed', '连接失败'));
    } finally {
      setTesting(false);
    }
  }, [address, t, loadModels]);

  const comfyDone = endpoint.connected;
  const advanceRoot = currentDataRootPath();

  /** 只列 MiniMax H3 对应版本；云端/第三方仓库的普通 VAE 不混进来 */
  const isCompatModel = (slot: string, name: string): boolean => {
    if (slot === 'unet') return /minimax_h3|fasth3/i.test(name);
    if (slot === 'videoVae') return /minimax_h3.*video_vae|h3.*video_vae|video_vae.*h3/i.test(name);
    if (slot === 'audioVae') return /minimax_h3.*audio_vae|h3.*audio_vae|audio_vae.*h3/i.test(name);
    if (slot === 'clip') return /qwen3vl.*minimax_h3|qwen3vl.*h3|h3.*qwen3vl/i.test(name);
    return true;
  };
  /** 模型四件套：只给当前 ComfyUI 实际返回的文件名，推荐项加后缀，用户仍可自由改选 */
  const modelSlots: Array<{ slot: 'unet' | 'videoVae' | 'audioVae' | 'clip'; label: string; list: string[] }> = [
    { slot: 'unet', label: t('onboarding.modelUnet', '视频主模型'), list: availableModels.unet.filter((n) => isCompatModel('unet', n)) },
    { slot: 'videoVae', label: t('onboarding.modelVideoVae', '视频 VAE'), list: availableModels.vae.filter((n) => isCompatModel('videoVae', n)) },
    { slot: 'audioVae', label: t('onboarding.modelAudioVae', '音频 VAE'), list: availableModels.vae.filter((n) => isCompatModel('audioVae', n)) },
    { slot: 'clip', label: t('onboarding.modelClip', '文本编码器'), list: availableModels.clip.filter((n) => isCompatModel('clip', n)) },
  ];
  const vaeListEmpty = (availableModels.vae.length > 0
    && (!modelSlots.find((s) => s.slot === 'videoVae')?.list.length
      || !modelSlots.find((s) => s.slot === 'audioVae')?.list.length));
  const currentVaeUnsupported = (Boolean(models.videoVae) && !isCompatModel('videoVae', models.videoVae))
    || (Boolean(models.audioVae) && !isCompatModel('audioVae', models.audioVae));
  const cloudListFor = (slot: keyof typeof RECOMMENDED_MODELS): string[] => (
    slot === 'unet' ? availableModels.unet : slot === 'clip' ? availableModels.clip : availableModels.vae
  );
  /** 云端是否真的有推荐的这个文件（未连接 = 未核对） */
  const recommendedState = (slot: keyof typeof RECOMMENDED_MODELS): 'available' | 'missing' | 'unknown' => {
    const list = cloudListFor(slot);
    if (list.length === 0) return 'unknown';
    return list.includes(RECOMMENDED_MODELS[slot]) ? 'available' : 'missing';
  };
  const modelOptionLabel = (slot: keyof typeof RECOMMENDED_MODELS, name: string): string => (
    name === RECOMMENDED_MODELS[slot] ? `${name}（推荐·云端已有）` : name
  );

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
          {/* 模型四件套：推荐归推荐，选择权留给用户；列表来自当前 ComfyUI */}
          <div data-onboarding-model-picker style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{t('onboarding.modelPickTitle', '模型选择')}</span>
              <Button
                type="link"
                size="small"
                loading={refreshingModels}
                onClick={() => void loadModels(address)}
                style={{ padding: 0, fontSize: 11, height: 'auto' }}
              >
                {t('onboarding.modelRefresh', '刷新列表')}
              </Button>
            </div>
            {modelSlots.map(({ slot, label, list }) => {
              const recState = recommendedState(slot);
              return (
                <div key={slot} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 76, flexShrink: 0, fontSize: 11, color: theme.toolbar.textMuted }}>{label}</span>
                    <ModelNamePicker
                      slot={slot}
                      value={models[slot] || ''}
                      options={list.map((name) => ({ value: name, label: modelOptionLabel(slot, name) }))}
                      placeholder={list.length ? t('onboarding.modelPick', '选择或输入模型名') : t('onboarding.modelEmpty', '连接后读取列表，也可手动输入')}
                      onCommit={(value) => setModel(slot, value)}
                    />
                  </div>
                  <div style={{ paddingLeft: 84, fontSize: 10.5, lineHeight: 1.5, color: theme.toolbar.textMuted }}>
                    {t('onboarding.recommendPrefix', '推荐：')}{RECOMMENDED_MODELS[slot]}{' '}
                    {recState === 'available' ? (
                      <span style={{ color: '#16a34a' }}>{t('onboarding.recAvailable', '云端已有')}</span>
                    ) : recState === 'missing' ? (
                      <span style={{ color: '#d97706' }}>{t('onboarding.recMissing', '云端缺少，请换同槽位其它 h3 版本')}</span>
                    ) : (
                      <span>{t('onboarding.recUnknown', '连接后核对')}</span>
                    )}
                  </div>
                </div>
              );
            })}
            <span style={hintStyle(theme)}>
              {t('onboarding.modelPickHint', '每个槽位只选一个。推荐项会标出云端是否已有；缺少就换同槽位其它 h3 版本，或手动输入模型名。视频/音频 VAE 必须是 MiniMax H3 专用版本，第三方量化只要文件名带 h3 也可以。')}
            </span>
            {(vaeListEmpty || currentVaeUnsupported) ? (
              <span data-onboarding-vae-warning style={{ fontSize: 11, lineHeight: 1.65, color: '#d97706' }}>
                {t('onboarding.vaeWarning', '当前连接里没有可用的 MiniMax H3 视频/音频 VAE（或当前选中的不是 H3 版本）。请更换为文件名带 h3 的兼容版本；第三方量化版也可以，但不要选 LTX/Wan 的普通 VAE。')}
              </span>
            ) : null}
          </div>
          {/* 机器档位 → 推荐用法（只讲能不能做，不讲量化术语） */}
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
              {t('onboarding.modelGuideHint', '不知道怎么选就选带「推荐」的那一项，其他版本不用管。8GB 机器先做图片，视频走云端。')}
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
