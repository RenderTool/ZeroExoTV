/**
 * model-mapping-modal — 模型映射（唯一入口）
 *
 * 2026-11-18 用户口径：机器信息、显存策略、模型清单不要散在「使用指引」和「ComfyUI 连接」两处，
 * 统一到一个页面：连接面板 / 指引都只留一个「高级」按钮打开它。
 * 页内用标签分「视频 / LoRA / 图片 / 文本 / 语音」：视频可逐槽位选（下拉就是本机真实清单，命中字典才标推荐），
 * LoRA 页只负责「获取清单 + 刷新」（启用哪几条与强度属于项目参数，在导演台参数面板里选），
 * 图片是固定工作流，只显示「已就绪 / 未下载」；文本、语音后续支持。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, InputNumber, Modal, Select, Tabs, Tag, Typography, message } from 'antd';
import { RefreshCw } from 'lucide-react';
import { MAX_LORAS, type LoraRow } from '@/entities/director-lora.js';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { hasDirectorLoraSink, getDirectorLoras, setDirectorLoras } from './director-lora-bridge.js';
import { useComfyuiConnectionStore } from './comfyui-connection.js';
import { useComfyuiEndpointStore, type ComfyuiVramMode } from './comfyui-endpoint.js';

const { Text } = Typography;

/**
 * 推荐字典：文件名 → 挡位（8G / 24G / 24G 以上）。
 * 只用来给「当前选中的」文件名贴一个推荐标记，下拉内容永远是本机真实清单。
 */
const RECOMMENDED: Record<'unet' | 'videoVae' | 'audioVae' | 'clip', Record<string, string>> = {
  unet: {
    'minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors': '48G 及以下推荐',
    'minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors': '8G 推荐',
    'minimax_h3_hybrid_fl2va_ref2va_b30-49-bf16.safetensors': '需 ≥80G 显存',
    'minimax_h3_hybrid_fl2va_ref2va_b25-49-bf16.safetensors': '需 ≥48G 显存',
    'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors': '24G 以上推荐',
  },
  videoVae: { 'minimax_h3_video_vae_int8_convrot.safetensors': '8G 推荐' },
  audioVae: { 'minimax_h3_audio_vae_fp32.safetensors': '通用' },
  clip: {
    // 8G 机器同样跑 32B int8；8B 是生图模型的编码器，H3 不认
    'qwen3vl_32b_minimax_h3_int8_convrot.safetensors': '48G 及以下推荐',
    'qwen3vl_32b_minimax_h3_bf16.safetensors': '需 ≥80G 显存',
  },
};

type VideoSlot = keyof typeof RECOMMENDED;

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

/**
 * 2026-11-19 用户口径：云端显存足够时应优先用推荐高精度模型，
 * 不可用时按挡位逐级回退（24G以上 → 24G → 8G），都没有才让用户自己选。
 */
const TIER_ORDER = ['24G 以上推荐', '24G 推荐', '8G 及以上推荐', '8G 推荐'] as const;

function tierAllowed(tier: string, totalGb: number | null): boolean {
  if (totalGb == null) return false;
  if (tier === '24G 以上推荐') return totalGb >= 24;
  if (tier === '24G 推荐') return totalGb >= 20;
  if (tier === '8G 及以上推荐' || tier === '8G 推荐') return totalGb >= 8;
  return false;
}

/** 按显存挡位从高到低，挑本机真实存在的第一个推荐模型 */
function pickPreferredModel(slot: VideoSlot, options: string[], totalGb: number | null): string | undefined {
  const table = RECOMMENDED[slot] as Record<string, string>;
  for (const tier of TIER_ORDER) {
    if (!tierAllowed(tier, totalGb)) continue;
    const hit = options.find((name) => table[name] === tier);
    if (hit) return hit;
  }
  return undefined;
}

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
  /** LoRA 已选（顺序即串联顺序）：弹窗打开时从导演台桥同步，改动即时写回项目 params.loras */
  const [loraRows, setLoraRows] = useState<LoraRow[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    if (!ep.address) return;
    setRefreshing(true);
    try {
      const res = await fetchBridgeModels(ep.address.replace(/\/+$/, ''), conn.token || undefined);
      if (res.ok) conn.setConnected(true, { unet: res.unet, vae: res.vae, clip: res.clip, lora: res.lora ?? [] });
    } catch {
      /* 拉取失败保持原清单 */
    } finally {
      setRefreshing(false);
    }
  }, [conn, ep.address]);

  useEffect(() => {
    if (open && conn.availableModels.unet.length === 0) void reload();
  }, [open, conn.availableModels.unet.length, reload]);

  // LoRA 清单也要在打开时是新的（旧插件不返回就保持空，由页面提示升级）
  useEffect(() => {
    if (!open) return;
    setLoraRows(getDirectorLoras());
    void reload();
  }, [open, reload]);

  const available = conn.availableModels;
  const listFor = (slot: VideoSlot): string[] => {
    const source = slot === 'unet' ? available.unet : slot === 'clip' ? available.clip : available.vae;
    const filtered = source.filter((n) => SLOT_FILTER[slot].test(n));
    return filtered.length > 0 ? filtered : source;
  };

  const totalGb = typeof ep.machine?.vramTotalBytes === 'number' && ep.machine.vramTotalBytes > 0
    ? ep.machine.vramTotalBytes / 1024 ** 3
    : null;

  // 未手动选过：按显存挡位自动落到最合适的推荐模型；没有推荐可回退时保持空，让用户自己选。
  useEffect(() => {
    if (!open) return;
    for (const slot of Object.keys(SLOT_LABEL) as VideoSlot[]) {
      if (conn.models[slot]) continue;
      const prefer = pickPreferredModel(slot, listFor(slot), totalGb);
      if (prefer) conn.setModel(slot, prefer);
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
        const tier = RECOMMENDED[slot][conn.models[slot] || ''];
        return (
          <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 88, fontSize: 12 }}>{SLOT_LABEL[slot]}</Text>
            <Select
              size="small"
              style={{ flex: 1 }}
              value={conn.models[slot] || undefined}
              placeholder={options.length ? '选择本机已有的模型' : '本机没有可用模型'}
              disabled={options.length === 0}
              onChange={(value) => conn.setModel(slot, value)}
              options={options.map((name) => ({ value: name, label: name }))}
            />
            {tier ? <Tag color="green" style={{ marginInlineEnd: 0 }}>{tier}</Tag> : null}
          </div>
        );
      })}
      <Text type="secondary" style={{ fontSize: 11 }}>
        默认按显存自动选推荐高精度模型，不可用时依次回退（24G 以上 → 24G → 8G）；没有可回退的模型时请手动选择。
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

  /**
   * LoRA 清单页（2026-11-20 用户定稿）：LoRA 单独一个 Tab，就放在这里。
   * 清单来自插件 `/models` 的 `lora` 字段（旧插件 0.1.2 不返回 → 明确说要升级，不伪造清单）；
   * 勾选 + 强度 + 顺序即「启用哪几条、各自强度、串联顺序」，属于项目参数，
   * 通过 director-lora-bridge 写回导演台的 `sharedParams.params.loras`（payload / 插件只认这份）。
   */
  const toggleLora = (name: string): void => {
    const exists = loraRows.some((r) => r.name === name);
    let next = loraRows;
    if (exists) {
      next = loraRows.filter((r) => r.name !== name);
    } else {
      if (loraRows.length >= MAX_LORAS) {
        message.warning(`最多串 ${MAX_LORAS} 条 LoRA，再选会明显吃显存和耗时`);
        return;
      }
      next = [...loraRows, { name, strength: 1 }];
    }
    setLoraRows(next);
    setDirectorLoras(next);
  };

  const setLoraStrength = (name: string, v: number | null): void => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const clamped = Math.min(2, Math.max(0, v));
    const next = loraRows.map((r) => (r.name === name ? { ...r, strength: clamped } : r));
    setLoraRows(next);
    setDirectorLoras(next);
  };

  const loraPane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 12 }}>LoRA 清单（{available.lora.length} 个 · 已选 {loraRows.length}/{MAX_LORAS}）</Text>
        <Button size="small" icon={<RefreshCw size={12} />} loading={refreshing} onClick={() => void reload()}>
          刷新列表
        </Button>
        {loraRows.length > 0 ? (
          <Button
            size="small"
            onClick={() => { setLoraRows([]); setDirectorLoras([]); }}
          >
            清空
          </Button>
        ) : null}
      </div>
      {available.lora.length === 0 ? (
        <Text type="warning" style={{ fontSize: 12 }}>
          云端插件没有返回 LoRA 清单：旧版插件（0.1.2）的 /models 不含 lora。升级到 0.1.3 后，这里会列出云端 models/loras 下的全部文件。
        </Text>
      ) : (
        available.lora.map((name) => {
          const order = loraRows.findIndex((r) => r.name === name);
          const checked = order >= 0;
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Checkbox
                checked={checked}
                disabled={!checked && loraRows.length >= MAX_LORAS}
                onChange={() => toggleLora(name)}
              />
              <Text style={{ flex: 1, fontSize: 12 }} ellipsis>{name}</Text>
              {checked ? <Tag color="green" style={{ marginInlineEnd: 0 }}>第 {order + 1} 条</Tag> : null}
              <InputNumber
                size="small"
                min={0}
                max={2}
                step={0.05}
                precision={2}
                disabled={!checked}
                value={checked ? loraRows[order]!.strength : 1}
                onChange={(v) => setLoraStrength(name, v)}
                style={{ width: 78 }}
              />
            </div>
          );
        })
      )}
      <Text type="secondary" style={{ fontSize: 11 }}>
        勾选哪几条、各自强度、串联顺序就是实际下发顺序（ComfyUI 里就是多个 LoraLoaderModelOnly 逐节改 MODEL，显存和耗时都会涨）。{hasDirectorLoraSink() ? '' : '当前没有打开导演台，改动无法写入项目。'}
      </Text>
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
          { key: 'lora', label: 'LoRA', children: loraPane },
          { key: 'image', label: '图片', children: imagePane },
          { key: 'text', label: '文本', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
          { key: 'voice', label: '语音', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
        ]}
      />
    </Modal>
  );
}
