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
import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Input, Modal, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Copy, Cpu, Download, FolderOpen, SlidersHorizontal } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import { useTheme } from '@zeroexo/plugin-theme';
import { pickRoot, rootName, currentDataRootPath, switchDataRoot, pickDataRoot, migrateDataRoot, pickDirectoryPath } from '@/platform/fs.js';
import {
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
import { ModelMappingModal } from '@/features/canvas-tabs/model-mapping-modal.js';

const SEEN_KEY = 'zeroexo:onboarding.seen';
/** MCP 自己的安装目录（用户可选，单独一个目录，绝不和资源目录混用） */
const MCP_DIR_KEY = 'zeroexo.mcp.installDir';

/** 默认建议：资源目录的同级目录，避免默认塞进数据根里 */
function defaultMcpDir(dataRoot: string | null): string {
  if (!dataRoot) return '';
  const trimmed = dataRoot.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  const parent = idx > 2 ? trimmed.slice(0, idx) : trimmed;
  return `${parent}\\ZeroExo-MCP`;
}
const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const PLUGIN_DIR = 'ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes';

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* 2026-11-18 用户要求：标题固定一行，明确写 Agent（例如豆包），不能换行 */}
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{index}. {title}</span>
          {done ? <Tag color="success" style={{ marginInlineEnd: 0, flexShrink: 0 }}>已完成</Tag> : null}
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
  const [address, setAddress] = useState(endpoint.address || DEFAULT_COMFYUI);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [installingMcp, setInstallingMcp] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [mcpDir, setMcpDir] = useState<string>('');
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [mcpStaleTools, setMcpStaleTools] = useState<string[]>([]);
  const [modelPageOpen, setModelPageOpen] = useState(false);
  const setConnectedModels = useComfyuiConnectionStore((s) => s.setConnected);

  const pluginZipUrl = `${import.meta.env.BASE_URL}downloads/ComfyUI_ZeroExoNodes.zip`;

  useEffect(() => {
    if (!open) return;
    setRoot(rootName() ?? null);
    setAddress(endpoint.address || DEFAULT_COMFYUI);
    setMcpCopied(false);
    const rootPath = currentDataRootPath();
    let saved: string | null = null;
    try { saved = localStorage.getItem(MCP_DIR_KEY); } catch { saved = null; }
    setMcpDir(saved || defaultMcpDir(rootPath));
    void (async () => {
      try {
        const info = await loadServerInfo();
        setServerInfo(info);
        setMcpStaleTools(mcpServerMissingTools(info));
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
      }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open, serverInfo]);

  /**
   * 安装目录合法性：只有「填了值」才校验；留空不算错误。
   * 2026-11-19 用户口径：目录选择与 MCP 安装无关，也不是安装前置条件；
   * 留空时由复制的接入包让 Agent 自己挑一个合规目录。
   */
  const mcpDirError = (() => {
    const dir = mcpDir.trim();
    if (!dir) return null;
    if (/^c:/i.test(dir)) return '不能装在 C 盘';
    const rootPath = currentDataRootPath();
    if (rootPath) {
      const a = dir.replace(/[\\/]+$/, '').toLowerCase();
      const b = rootPath.replace(/[\\/]+$/, '').toLowerCase();
      if (a === b || a.startsWith(`${b}\\`) || a.startsWith(`${b}/`)) {
        return '不能和资源目录混用，请另选一个独立目录';
      }
    }
    return null;
  })();

  const pickMcpDir = useCallback(async () => {
    try {
      const picked = await pickDirectoryPath();
      if (!picked) return;
      setMcpDir(picked);
      try { localStorage.setItem(MCP_DIR_KEY, picked); } catch { /* 隐私模式忽略 */ }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '选择安装目录失败');
    }
  }, [message]);

  /**
   * 换目录只保留两步（2026-11-17 用户要求）：点一次 → 系统原生目录对话框选目录 →
   * 直接问「取消 / 仅切换 / 迁移并切换」，不再让人手填路径再点「切换到此目录」。
   * 询问框是页面内自绘 Modal（跟随明暗主题），不用 Modal.confirm：
   * confirm 的白底在暗色下不跟随主题，且只有两个按钮位。
   */
  type RootAction = 'cancel' | 'switch' | 'migrate';
  const [rootAsk, setRootAsk] = useState<{ current: string; next: string; projects: number; assets: number } | null>(null);
  const rootAskResolve = useRef<((v: RootAction) => void) | null>(null);
  const askRootAction = useCallback(
    (payload: { current: string; next: string; projects: number; assets: number }): Promise<RootAction> => (
      new Promise<RootAction>((resolve) => {
        rootAskResolve.current = resolve;
        setRootAsk(payload);
      })
    ),
    [],
  );
  const answerRootAsk = useCallback((value: RootAction) => {
    setRootAsk(null);
    const resolve = rootAskResolve.current;
    rootAskResolve.current = null;
    resolve?.(value);
  }, []);

  const chooseRoot = useCallback(async () => {
    try {
      const picked = await pickDataRoot();
      if (picked && picked !== 'offline') {
        const current = currentDataRootPath();
        if (current && current === picked.path) {
          message.info(t('onboarding.rootSame', '新目录与当前目录相同，无需切换'));
          return;
        }
        if (current) {
          const action = await askRootAction({
            current,
            next: picked.path,
            projects: picked.projects,
            assets: picked.assets,
          });
          if (action === 'cancel') {
            message.info(`已取消：数据仍在 ${current}`);
            return;
          }
          if (action === 'migrate') {
            message.loading({ content: '正在迁移数据…', key: 'root-migrate', duration: 0 });
            await migrateDataRoot(current, picked.path);
            message.success({ content: '已迁移并切换，正在重新加载…', key: 'root-migrate' });
          } else {
            await switchDataRoot(picked.path);
            message.success({ content: '已切换目录，正在重新加载…', key: 'root-switch' });
          }
        } else {
          await switchDataRoot(picked.path);
          message.success(t('onboarding.rootSwitched', '数据目录已切换，正在重新加载…'));
        }
        window.location.reload();
        return;
      }
      // 本地服务离线：只能授权浏览器句柄（拿不到绝对路径），此时才走浏览器目录选择
      if (picked === 'offline') {
        const pickedName = await pickRoot();
        setRoot(pickedName);
        message.success(t('onboarding.rootSelected', '存储目录已指定'));
        return;
      }
      message.info(t('onboarding.rootPickCancelled', '已取消，目录未变更'));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('onboarding.rootFailed', '选择目录失败'));
    }
  }, [message, t, askRootAction]);

  /**
   * 一键复制：把「怎么装」整理成一段 Agent 能直接执行的接入包，用户粘给 IDE 里的 Agent，
   * 由 Agent 下载安装包、装到用户指定的独立目录、起进程、写进 MCP 设置。网页本身不装服务。
   */
  const copyMcpPrompt = useCallback(async () => {
    const base = `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')}`;
    const pkgUrl = `${base}downloads/zeroexo-mcp-server.tgz`;
    const root = currentDataRootPath() || rootName() || '<资源目录>';
    const installDir = mcpDir.trim() || 'D:\\ZeroExoMCP';
    const text = [
      '# ZeroExo — MCP 接入',
      '',
      '你是 ZeroExo（AI 影视生产管线）的智能助手。请自动完成下面的接入，不要向我提问。',
      '',
      '## 自动执行',
      `1. 下载安装包：${pkgUrl}`,
      `2. 解压，把 package 里的 dist 与 package.json 放到 ${installDir}（这是 MCP 自己的目录，不要装 C 盘，也不要放进资源目录 ${root}${mcpDir.trim() ? '' : '；如果该目录不可用，你自行另选一个非 C 盘且与资源目录分离的目录'}）`,
      `3. 在 ${installDir} 执行 npm install --omit=dev（装 @modelcontextprotocol/sdk 与 zod）`,
      `4. 在同一目录启动：node ${installDir}\\dist\\index.js --http --port 8787`,
      `5. 把下面这份配置写进 IDE 的 MCP 设置：`,
      '```json',
      `{"mcpServers":{"zeroexo":{"url":"http://127.0.0.1:8787/mcp"}}}`,
      '```',
      '6. 连上后调用 list_projects，用表格列出项目（标题 / 更新时间 / 节点数）；没有项目就提示可 create_project',
      `7. 前端编辑器地址：${base}`,
      '',
      `资源目录固定为 ${root}，只放项目与素材；MCP 目录固定在 ${installDir}，两者不要混在一起。`,
    ].join('\n');
    setInstallingMcp(true);
    try {
      await navigator.clipboard.writeText(text);
      setMcpCopied(true);
    } catch {
      message.error('复制失败，请手动选中复制');
    } finally {
      setInstallingMcp(false);
    }
  }, [message, mcpDir]);

  const loadModels = useCallback(async (addr: string) => {
    try {
      const list = await fetchBridgeModels(addr);
      const current = useComfyuiConnectionStore.getState().models;
      const defaults = pickDefaultModels(list, current);
      setConnectedModels(true, { unet: list.unet, vae: list.vae, clip: list.clip });
      const setModel = useComfyuiConnectionStore.getState().setModel;
      (['unet', 'videoVae', 'audioVae', 'clip'] as const).forEach((slot) => {
        if (defaults[slot]) setModel(slot, defaults[slot]);
      });
    } catch {
      setConnectedModels(true);
    }
  }, [setConnectedModels]);

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
        setTestOk(true);
      } else {
        setTestResult(res.message);
        setTestOk(false);
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : t('onboarding.comfyFailed', '连接失败'));
      setTestOk(false);
    } finally {
      setTesting(false);
    }
  }, [address, t, loadModels]);

  const comfyDone = endpoint.connected;


  return (
    <>
    <Modal
      open={open}
      onCancel={onClose}
      centered
      width={680}
      // 2026-11-17 用户实测：指引弹窗被画布浮层压住、且暗色主题下仍是白底 —— 统一抬层 + 跟随主题色
      zIndex={5000}
      title={t('onboarding.title', '使用指引')}
      styles={{
        root: { background: theme.toolbar.background, color: theme.toolbar.text },
        header: { background: theme.toolbar.background, color: theme.toolbar.text, borderBottom: `1px solid ${theme.toolbar.border}` },
        body: { maxHeight: '72vh', overflowY: 'auto', color: theme.toolbar.text },
        footer: { background: theme.toolbar.background, borderTop: `1px solid ${theme.toolbar.border}` },
      }}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
            {t('onboarding.footerHint', '随时可再打开')}
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
        </StepCard>

        {/* 2 MCP：一键自动安装并启动，用户不用复制命令、不用粘配置 */}
        <StepCard index={2} title={t('onboarding.stepMcp', '接入 Agent（例如豆包）')} done={Boolean(serverInfo)} theme={theme}>
          <span style={hintStyle(theme)}>
            {serverInfo
              ? t('onboarding.stepMcpHint', '点击下方「一键复制」按钮，然后到豆包等 Agent 的对话框粘贴，它会自己装好。')
              : t('onboarding.stepMcpFirstRun', '点击下方「一键复制」按钮，然后到豆包等 Agent 的对话框粘贴，它会自己装好并启动。')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<FolderOpen size={13} />} onClick={() => void pickMcpDir()}>
              {mcpDir
                ? t('onboarding.mcpDirChange', '重新选择')
                : t('onboarding.mcpDirPickOptional', '安装目录（可选）')}
            </Button>
            {/* 2026-11-19 用户反馈：服务未安装时点「选择目录」会报「本地服务离线」，形成
                「先装服务才能选目录 / 先选目录才能装服务」的死循环。这里允许直接手填绝对路径，
                选择目录只在服务在线时用于反查路径，不再作为唯一入口。 */}
            <Input
              size="small"
              value={mcpDir}
              onChange={(e) => {
                const v = e.target.value;
                setMcpDir(v);
                try { localStorage.setItem(MCP_DIR_KEY, v); } catch { /* 隐私模式忽略 */ }
              }}
              placeholder="D:\\ZeroExoMCP"
              style={{ width: 300 }}
              status={mcpDirError ? 'error' : undefined}
              data-testid="onboarding-mcp-dir"
            />
          </div>
          <span style={{ fontSize: 11, color: mcpDirError ? '#dc2626' : theme.toolbar.textMuted, lineHeight: 1.6 }}>
            {mcpDirError
              ? mcpDirError
              : t('onboarding.mcpDirWarn', '别放 C 盘，也别和第一步的资源目录放一起。')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button
              size="small"
              type="primary"
              icon={<Copy size={13} />}
              loading={installingMcp}
              onClick={() => void copyMcpPrompt()}
              data-testid="onboarding-copy-mcp"
            >
              {t('onboarding.mcpCopy', '一键复制')}
            </Button>
            {mcpCopied ? (
              <span style={{ fontSize: 12, color: '#16a34a' }}>{t('onboarding.mcpCopied', '已复制，粘给 Agent 就行')}</span>
            ) : null}
          </div>
          {mcpStaleTools.length > 0 ? (
            <span style={{ fontSize: 12, color: '#d97706' }}>
              检测到 MCP 服务是旧版本（缺 {mcpStaleTools.length} 个工具）：重启 IDE 里的 MCP 服务后再生效。
            </span>
          ) : null}
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
            <span style={{ fontSize: 12, color: testOk ? '#16a34a' : '#dc2626' }}>{testResult}</span>
          ) : null}
          {/* 模型、机器信息、显存策略统一收在「高级」页，这里只留一个入口（与连接面板同一文案） */}
          <div data-onboarding-model-picker style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="small" icon={<SlidersHorizontal size={13} />} onClick={() => setModelPageOpen(true)}>
              {t('director.advancedModels', '高级')}
            </Button>
          </div>
        </StepCard>
      </div>
    </Modal>
    <ModelMappingModal open={modelPageOpen} onClose={() => setModelPageOpen(false)} />
    {rootAsk && (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 5400,
          background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) answerRootAsk('cancel'); }}
      >
        <div
          style={{
            width: 460, maxWidth: '92vw', boxSizing: 'border-box',
            background: theme.toolbar.background, color: theme.toolbar.text,
            borderRadius: 10, border: `1px solid ${theme.toolbar.border}`,
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            padding: '16px 20px 14px',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
            {t('onboarding.rootAskTitle', '切换数据目录')}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div>
              {t('onboarding.rootAskCurrent', '当前目录：')}{rootAsk.current}（{rootAsk.projects} {t('onboarding.rootAskProjects', '个项目')}、{rootAsk.assets} {t('onboarding.rootAskAssets', '条资产')}）
            </div>
            <div>
              {t('onboarding.rootAskNext', '新目录：')}{rootAsk.next}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: theme.toolbar.textMuted }}>
              {t('onboarding.rootAskHint', '迁移 = 把当前数据复制到新目录；仅切换 = 直接从空的新目录开始，旧数据留在原处不动。')}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <Button onClick={() => answerRootAsk('cancel')}>{t('onboarding.rootAskCancel', '取消')}</Button>
            <Button onClick={() => answerRootAsk('switch')}>{t('onboarding.rootAskSwitch', '仅切换目录')}</Button>
            <Button type="primary" onClick={() => answerRootAsk('migrate')}>{t('onboarding.rootAskMigrate', '迁移并切换')}</Button>
          </div>
        </div>
      </div>
    )}
    </>
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
