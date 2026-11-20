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
import { Button, Checkbox, InputNumber, Modal, Select, Tabs, Tag, Tooltip, Typography, message } from 'antd';
import { Copy, RefreshCw } from 'lucide-react';
import { DEFAULT_LORA_NAME, MAX_LORAS, type LoraRow } from '@/entities/director-lora.js';
import { fetchBridgeModels } from './comfyui-bridge-client.js';
import { getDirectorLoras, setDirectorLoras } from './director-lora-bridge.js';
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

/**
 * 图片模型族（2026-11-21 用户口径）：图片不是「一套模型」，Qwen-Image / Krea2 / Moss
 * 各自的主模型、文本编码器、VAE 完全不同，必须按族逐项列出——包括本机没下载的，
 * 并且每行都能复制官方文件名，用户才知道该下哪一个。
 * 期望文件名来源：插件 templates/{qwen_image_t2i,qwen_image_edit,krea2_t2i,moss_image_t2i}.json
 */
interface ImageModelLine {
  label: string;
  expected: string;
  source: 'unet' | 'vae' | 'clip';
  test: RegExp;
}

interface ImageFamily {
  key: string;
  label: string;
  note: string;
  models: ImageModelLine[];
}

const IMAGE_FAMILIES: ImageFamily[] = [
  {
    key: 'qwen',
    label: 'Qwen-Image（文生图 / 改图）',
    note: '改图与纯文生图共用这一套；两个文本编码器都要有',
    models: [
      { label: '主模型', expected: 'qwen_image_2.1_int8_convrot.safetensors', source: 'unet', test: /qwen_image_.*\.safetensors$/i },
      { label: 'VAE', expected: 'qwen_image_2.1_vae_bf16.safetensors', source: 'vae', test: /qwen_image_2\.1_vae/i },
      { label: '文本编码器（Qwen3-VL 8B）', expected: 'qwen3vl_8b_int8_convrot.safetensors', source: 'clip', test: /qwen3vl_8b/i },
      { label: '文本编码器（Qwen3.5 PE）', expected: 'qwen3.5_qwen_image_2.1_pe_i2i.int8_convrot.safetensors', source: 'clip', test: /qwen3\.5_qwen_image/i },
    ],
  },
  {
    key: 'krea2',
    label: 'Krea2（文生图）',
    note: '纯文生图，不支持参考图；VAE 复用 qwen_image_vae',
    models: [
      { label: '主模型', expected: 'krea2_turbo_bf16.safetensors', source: 'unet', test: /krea2/i },
      { label: '文本编码器', expected: 'qwen3vl_4b_fp8_scaled.safetensors', source: 'clip', test: /qwen3vl_4b_fp8/i },
      { label: 'VAE', expected: 'qwen_image_vae.safetensors', source: 'vae', test: /^qwen_image_vae\.safetensors$/i },
    ],
  },
  {
    key: 'moss',
    label: 'Moss Image（文生图）',
    note: 'Flux2 latent，宽高按 16 对齐',
    models: [
      { label: '主模型', expected: 'moss_image_sft_int8_convrot.safetensors', source: 'unet', test: /moss_image/i },
      { label: '文本编码器', expected: 'qwen3.5_9b_w4a8_gptq.safetensors', source: 'clip', test: /qwen3\.5_9b_w4a8/i },
      { label: 'VAE', expected: 'flux2-vae_small.safetensors', source: 'vae', test: /flux2-vae_small/i },
    ],
  },
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

/**
 * 模型名复制按钮（2026-11-21 用户要求「这些模型要支持复制」）：
 * 客户经常要把文件名贴给 ComfyUI 或下载脚本，逐字符手抄太容易错。
 */
function CopyNameButton({ name, size = 12 }: { name: string; size?: number }): JSX.Element {
  return (
    <Tooltip title={`复制：${name}`}>
      <Button
        type="text"
        size="small"
        data-testid="copy-model-name"
        aria-label={`复制模型名 ${name}`}
        style={{ padding: '0 4px', height: 20, flexShrink: 0, color: 'inherit', opacity: 0.65 }}
        icon={<Copy size={size} />}
        onClick={() => {
          void navigator.clipboard
            .writeText(name)
            .then(() => message.success(`已复制：${name}`))
            .catch(() => message.error('复制失败，请手动选中文件名'));
        }}
      />
    </Tooltip>
  );
}

export interface ModelMappingPanelProps {
  /** 面板可见（顶栏「连接配置」浮层打开时才刷新清单） */
  visible?: boolean;
}

/**
 * 2026-11-20 五调（用户定稿）：「模型映射」整页内容合并进顶栏「连接配置」浮层，
 * 不再是独立弹窗；这里只导出内嵌面板本体。
 */
export function ModelMappingPanel({ visible = true }: ModelMappingPanelProps): JSX.Element {
  const ep = useComfyuiEndpointStore();
  const conn = useComfyuiConnectionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('video');
  /** LoRA 已选（顺序即串联顺序）：面板可见时从导演台桥同步，改动即时写回项目 params.loras */
  const [loraRows, setLoraRows] = useState<LoraRow[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    if (!ep.address) return;
    setRefreshing(true);
    try {
      const state = useComfyuiConnectionStore.getState();
      const res = await fetchBridgeModels(ep.address.replace(/\/+$/, ''), state.token || undefined);
      if (res.ok) state.setConnected(true, { unet: res.unet, vae: res.vae, clip: res.clip, lora: res.lora ?? [] });
    } catch {
      /* 拉取失败保持原清单 */
    } finally {
      setRefreshing(false);
    }
  }, [ep.address]);

  useEffect(() => {
    if (visible && conn.availableModels.unet.length === 0) void reload();
  }, [visible, conn.availableModels.unet.length, reload]);

  // LoRA 清单也要在面板打开时是新的（旧插件不返回就保持空，由页面提示升级）
  useEffect(() => {
    if (!visible) return;
    setLoraRows(getDirectorLoras());
    void reload();
  }, [visible, reload]);

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
    if (!visible) return;
    for (const slot of Object.keys(SLOT_LABEL) as VideoSlot[]) {
      if (conn.models[slot]) continue;
      const prefer = pickPreferredModel(slot, listFor(slot), totalGb);
      if (prefer) conn.setModel(slot, prefer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, available.unet.length, available.vae.length, available.clip.length, totalGb]);

  const machine = ep.machine;

  const machineBlock = (
    <div data-testid="comfyui-machine-info" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
          data-testid="comfyui-vram-mode"
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
      <Text type="secondary" data-testid="comfyui-vram-summary" style={{ fontSize: 11 }}>
        {ep.vramMode === 'low'
          ? '低显存：按低挡位跑，速度慢但不容易 OOM'
          : ep.vramMode === 'high'
            ? '高显存：显存紧张时不回退，OOM 直接报错'
            : '自动：按显存挡位自动选择，显存不足时逐级回退'}
      </Text>
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
            {conn.models[slot] ? <CopyNameButton name={conn.models[slot]!} /> : null}
          </div>
        );
      })}
      <Text type="secondary" style={{ fontSize: 11 }}>
        默认按显存自动选推荐高精度模型，不可用时依次回退（24G 以上 → 24G → 8G）；没有可回退的模型时请手动选择。
      </Text>
    </div>
  );

  const imagePane = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {IMAGE_FAMILIES.map((family) => (
        <div key={family.key} data-image-family={family.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <Text strong style={{ fontSize: 12 }}>{family.label}</Text>
            <Text type="secondary" style={{ fontSize: 10 }}>{family.note}</Text>
          </div>
          {family.models.map((need) => {
            const source = need.source === 'unet' ? available.unet : need.source === 'clip' ? available.clip : available.vae;
            const found = source.find((n) => need.test.test(n));
            return (
              <div key={`${family.key}-${need.label}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Text style={{ width: 132, fontSize: 12 }}>{need.label}</Text>
                <Text style={{ flex: 1, fontSize: 12, color: found ? 'var(--ant-color-text-secondary)' : '#d97706' }} ellipsis>
                  {found ?? `${need.expected}（本机未下载）`}
                </Text>
                <Tag color={found ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>{found ? '已就绪' : '未下载'}</Tag>
                {/* 没下载也要能复制官方文件名，用户才知道该去下什么 */}
                <CopyNameButton name={found ?? need.expected} />
              </div>
            );
          })}
        </div>
      ))}
      <Text type="secondary" style={{ fontSize: 11 }}>
        图片模型按族各自成套，维度和文本编码器不能混用（拿 SD 系的 CLIP/VAE 去跑 Qwen-Image 会在采样前的条件拼接处直接报
        tensor size 不匹配）。缺哪个就先下载，没下载时对应族不可用。
      </Text>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {(available.lora.includes(DEFAULT_LORA_NAME)
          ? available.lora
          : [DEFAULT_LORA_NAME, ...available.lora]
        ).map((name) => {
          const order = loraRows.findIndex((r) => r.name === name);
          const checked = order >= 0;
          const isDefault = name === DEFAULT_LORA_NAME;
          const missing = isDefault && !available.lora.includes(name);
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Checkbox
                checked={checked}
                disabled={missing || (!checked && loraRows.length >= MAX_LORAS)}
                onChange={() => toggleLora(name)}
              />
              <Text style={{ flex: 1, fontSize: 12, color: missing ? '#d97706' : undefined }} ellipsis>{name}</Text>
              {isDefault ? (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>默认推荐</Tag>
              ) : null}
              {missing ? (
                <Tag style={{ marginInlineEnd: 0 }}>本机未下载</Tag>
              ) : null}
              <CopyNameButton name={name} />
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
        })}
        </div>
      )}
      <Text type="secondary" style={{ fontSize: 11 }}>
        LoRA 是可选项：不勾就完全不加 LoRA。勾选即串联，顺序就是下发顺序；勾完即保存（本项目 + 本机设置）。清单里的「默认推荐」只是建议，不勾不会自动启用。
      </Text>
      <div data-testid="lora-recommend" style={{ marginTop: 6, fontSize: 11, color: 'rgba(128,128,128,0.95)' }}>
        推荐：{DEFAULT_LORA_NAME}
        <span style={{ marginLeft: 6 }}>（8 步 turbo，出片快、8G 显存友好；不需要就别勾）</span>
      </div>
    </div>
  );

  return (
    <div data-testid="model-mapping-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
      {machineBlock}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        size="small"
        style={{ marginTop: 6 }}
        items={[
          { key: 'video', label: '视频', children: videoPane },
          { key: 'lora', label: 'LoRA', children: loraPane },
          { key: 'image', label: '图片', children: imagePane },
          { key: 'text', label: '文本', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
          { key: 'voice', label: '语音', children: <Text type="secondary" style={{ fontSize: 12 }}>后续支持</Text> },
        ]}
      />
    </div>
  );
}

/**
 * 弹窗形态只留给「使用指引」（onboarding-guide）里的内嵌打开；
 * 顶栏「连接配置」浮层用的是内嵌的 `ModelMappingPanel`，内容同一份。
 */
export interface ModelMappingModalProps {
  open: boolean;
  onClose: () => void;
}

export function ModelMappingModal({ open, onClose }: ModelMappingModalProps): JSX.Element {
  return (
    <Modal open={open} onCancel={onClose} footer={null} centered width={640} title="模型映射" destroyOnHidden>
      <ModelMappingPanel visible={open} />
    </Modal>
  );
}

