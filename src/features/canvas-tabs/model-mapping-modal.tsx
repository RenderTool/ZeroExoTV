/**
 * model-mapping-modal — 模型映射（唯一入口）
 *
 * 2026-11-18 用户口径：机器信息、显存策略、模型清单不要散在「使用指引」和「ComfyUI 连接」两处，
 * 统一到一个页面：连接面板 / 指引都只留一个「高级」按钮打开它。
 * 页内用标签分「视频 / 图片 / 文本 / 语音」：视频可逐槽位选（下拉就是本机真实清单，命中字典才标推荐），
 * 图片是固定工作流，只显示「已就绪 / 未下载」；文本、语音后续支持。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Select, Tabs, Tag, Typography } from 'antd';
import { RefreshCw } from 'lucide-react';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { useComfyuiConnectionStore } from './comfyui-connection.js';
import { useComfyuiEndpointStore, type ComfyuiVramMode } from './comfyui-endpoint.js';
import { isModelOverBudget, modelTier, pickPreferredModel, type ModelSlot } from './model-recommendations.js';

const { Text } = Typography;

type VideoSlot = ModelSlot;

const SLOT_LABEL: Record<VideoSlot, string> = {
  unet: '视频主模型',
  videoVae: '视频 VAE',
  audioVae: '音频 VAE',
  clip: '文本编码器',
};

const SLOT_FILTER: Record<VideoSlot, RegExp> = {
  unet: /minimax_h3|fasth3/i,
  videoVae: /video_vae/i,
  audioVae: /audio_vae/i,
  clip: /qwen3vl/i,
};

/** 图片工作流用的模型：模板里写死，这里只判断本机有没有 */
const IMAGE_NEEDS: Array<{ key: string; label: string; test: RegExp }> = [
  { key: 'unet', label: '图片主模型', test: /qwen_image|moss|krea2/i },
  { key: 'vae', label: '图片 VAE', test: /qwen_image/i },
  { key: 'clip', label: '图片文本编码器', test: /qwen3\.5|qwen_image/i },
];

function gb(bytes?: number): string {
  if (typeof bytes !== 'number' || bytes <= 0) return '—';
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export interface ModelMappingModalProps {
  open: boolean;
  onClose: () => void;
}

export function ModelMappingModal({ open, onClose }: ModelMappingModalProps): JSX.Element {
  const ep = useComfyuiEndpointStore();
  const conn = useComfyuiConnectionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('video');

  const reload = useCallback(async (): Promise<void> => {
    if (!ep.address) return;
    setRefreshing(true);
    try {
      const res = await fetchBridgeModels(ep.address.replace(/\/+$/, ''), conn.token || undefined);
      if (res.ok) conn.setConnected(true, { unet: res.unet, vae: res.vae, clip: res.clip });
    } catch {
      /* 拉取失败保持原清单 */
    } finally {
      setRefreshing(false);
    }
  }, [conn, ep.address]);

  useEffect(() => {
    if (open && conn.availableModels.unet.length === 0) void reload();
  }, [open, conn.availableModels.unet.length, reload]);

  const available = conn.availableModels;
  const listFor = (slot: VideoSlot): string[] => {
    const source = slot === 'unet' ? available.unet : slot === 'clip' ? available.clip : available.vae;
    const filtered = source.filter((n) => SLOT_FILTER[slot].test(n));
    return filtered.length > 0 ? filtered : source;
  };

  const totalGb = typeof ep.machine?.vramTotalBytes === 'number' && ep.machine.vramTotalBytes > 0
    ? ep.machine.vramTotalBytes / 1024 ** 3
    : null;

  // 未手动选过：按显存档位自动落到最合适的推荐模型；已经选过但超出显存允许范围的（比如之前在 48G 卡上选了 48G 的 bf16 文本编码器），自动降档，不留在必炸的配置上。
  useEffect(() => {
    if (!open) return;
    for (const slot of Object.keys(SLOT_LABEL) as VideoSlot[]) {
      const current = conn.models[slot];
      if (current && !isModelOverBudget(slot, current, totalGb)) continue;
      const prefer = pickPreferredModel(slot, listFor(slot), totalGb);
      if (prefer && prefer !== current) conn.setModel(slot, prefer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, available.unet.length, available.vae.length, available.clip.length, totalGb]);

  const machine = ep.machine;

  const machineBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {machine ? (
          <Text style={{ fontSize: 12 }}>
            {machine.gpuName ?? 'GPU'}
            {typeof machine.vramTotalBytes === 'number' ? ` · 显存 ${gb(machine.vramTotalBytes)}` : ''}
            {typeof machine.vramFreeBytes === 'number' ? `（空闲 ${gb(machine.vramFreeBytes)}）` : ''}
            {typeof machine.ramTotalBytes === 'number' ? ` · 内存 ${gb(machine.ramTotalBytes)}` : ''}
            {machine.comfyuiVersion ? ` · ComfyUI ${machine.comfyuiVersion}` : ''}
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>未读取到机器信息</Text>
        )}
        <Text style={{ fontSize: 12 }}>显存策略</Text>
        <Select<ComfyuiVramMode>
          size="small"
          style={{ width: 110 }}
          value={ep.vramMode}
          onChange={(mode) => ep.setVramMode(mode)}
          options={[
            { value: 'auto', label: '自动' },
            { value: 'low', label: '低显存' },
            { value: 'high', label: '高显存' },
          ]}
        />
        <Button size="small" icon={<RefreshCw size={12} />} loading={refreshing} onClick={() => void reload()}>
          刷新列表
        </Button>
      </div>
    </div>
  );

  const videoPane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(Object.keys(SLOT_LABEL) as VideoSlot[]).map((slot) => {
        const options = listFor(slot);
        const selected = conn.models[slot];
        const tier = modelTier(slot, selected);
        const over = isModelOverBudget(slot, selected, totalGb);
        return (
          <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 88, fontSize: 12 }}>{SLOT_LABEL[slot]}</Text>
            <Select
              size="small"
              style={{ flex: 1 }}
              value={selected || undefined}
              placeholder={options.length ? '选择本机已有的模型' : '本机没有可用模型'}
              disabled={options.length === 0}
              onChange={(value) => conn.setModel(slot, value)}
              options={options.map((name) => {
                const need = modelTier(slot, name);
                const tooBig = totalGb != null && need != null && need.minGb > totalGb;
                return {
                  value: name,
                  label: tooBig ? `${name}（需 ≥${need.minGb}G 显存）` : name,
                };
              })}
            />
            {tier ? (
              <Tag color={over ? 'red' : 'green'} style={{ marginInlineEnd: 0 }}>
                {over ? `需 ≥${tier.minGb}G 显存` : tier.label}
              </Tag>
            ) : null}
          </div>
        );
      })}
      <Text type="secondary" style={{ fontSize: 11 }}>
        默认按显存档位自动选（每个模型有自己的显存下限，超限会自动降档）；32B 文本编码器 bf16 单文件 48G，
        只有 ≥80G 显存才允许选择，48G 及以下请用 int8_convrot。
      </Text>
    </div>
  );

  const imagePane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {IMAGE_NEEDS.map((need) => {
        const source = need.key === 'unet' ? available.unet : need.key === 'clip' ? available.clip : available.vae;
        const found = source.find((n) => need.test.test(n));
        return (
          <div key={need.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 108, fontSize: 12 }}>{need.label}</Text>
            <Text style={{ flex: 1, fontSize: 12, color: 'var(--ant-color-text-secondary)' }} ellipsis>
              {found ?? '未下载'}
            </Text>
            <Tag color={found ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>{found ? '已就绪' : '未下载'}</Tag>
          </div>
        );
      })}
      <Text type="secondary" style={{ fontSize: 11 }}>图片按工作流固定使用上面的模型；缺哪个就先下载，没下载时对应功能静默不可用。</Text>
    </div>
  );

  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={640} title="模型映射" destroyOnHidden>
      {machineBlock}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        style={{ marginTop: 8 }}
        items={[
          { key: 'video', label: '视频', children: videoPane },
          { key: 'image', label: '图片', children: imagePane },
          { key: 'text', label: '文本', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
          { key: 'voice', label: '语音', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
        ]}
      />
    </Modal>
  );
}
