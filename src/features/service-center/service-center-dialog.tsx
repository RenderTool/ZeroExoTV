/**
 * ServiceCenterDialog - 顶栏唯一「服务」入口
 *
 * 把 ComfyUI 连接、MCP、数据目录、ComfyUI 插件安装收进一个页面，用 Tab 管理；
 * 用户不再面对三个独立按钮。
 */
import { useState } from 'react';
import { App, Button, Modal, Tabs, Typography } from 'antd';
import { CheckCircle2, ExternalLink, FolderOpen, PlugZap } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { activateRoot } from '@/platform/root-flow.js';
import { restoreRoot, rootName } from '@/platform/fs.js';
import { ComfyuiConnectButton } from '@/features/canvas-tabs/comfyui-connect-button.js';
import { McpSettingsDialog } from '@/features/mcp-settings/mcp-settings-dialog.js';
import { useComfyuiEndpointStore } from '@/features/canvas-tabs/comfyui-endpoint.js';

const { Text, Paragraph } = Typography;

export interface ServiceCenterDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ServiceCenterDialog({ open, onClose }: ServiceCenterDialogProps): React.ReactElement {
  const { theme } = useTheme();
  const { message } = App.useApp();
  const ep = useComfyuiEndpointStore();
  const [root, setRoot] = useState<string | null>(() => rootName() ?? null);

  const pickRoot = async (): Promise<void> => {
    const outcome = await activateRoot({ migrate: false });
    if (outcome.status === 'error') message.error(`选择数据目录失败：${outcome.message}`);
    if (outcome.status === 'ok') {
      const name = await restoreRoot(false);
      setRoot(name ?? rootName() ?? null);
      message.success('数据目录已更新');
    }
  };

  const pluginPath = 'ComfyUI/custom_nodes/ComfyUI_ZeroExoNodes';
  const base = import.meta.env.BASE_URL;
  const pluginZipUrl = `${base}downloads/ComfyUI_ZeroExoNodes.zip`;

  const tabItems = [
    {
      key: 'comfyui',
      label: 'ComfyUI',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PlugZap size={18} color={theme.toolbar.accent} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Text strong>{ep.connected ? '已连接 ComfyUI' : '未连接 ComfyUI'}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{ep.address}</Text>
            </div>
          </div>
          <ComfyuiConnectButton inline />
        </div>
      ),
    },
    {
      key: 'mcp',
      label: 'MCP',
      children: <McpSettingsDialog embedded />,
    },
    {
      key: 'data',
      label: '数据目录',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpen size={18} color={theme.toolbar.accent} />
            <Text strong>本机数据目录</Text>
          </div>
          <Text code style={{ fontSize: 12 }}>{root ?? '未选择'}</Text>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
            项目、素材、历史产物、画布副本都保存在这里；换目录不会删除旧目录文件。
          </Paragraph>
          <Button onClick={() => void pickRoot()} data-testid="service-pick-root">选择 / 更换目录</Button>
        </div>
      ),
    },
    {
      key: 'plugin',
      label: 'ComfyUI 插件',
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={18} color={theme.toolbar.accent} />
            <Text strong>ZeroExo ComfyUI 插件</Text>
          </div>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
            云端或本机 ComfyUI 都需要安装本插件，画布才能提交导演台/出片任务。
          </Paragraph>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>1. 下载插件 ZIP。</div>
            <div>2. 解压到 <Text code>{pluginPath}</Text>。</div>
            <div>3. 重启 ComfyUI，确认服务页显示已连接。</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="primary" href={pluginZipUrl} download data-testid="service-download-plugin">
              下载插件 ZIP
            </Button>
            <Button href="https://docs.comfy.org/installation/install_custom_node" target="_blank" icon={<ExternalLink size={13} />}>
              安装说明
            </Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={620}
      centered
      title="服务"
      destroyOnHidden
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      <Tabs items={tabItems} />
    </Modal>
  );
}
