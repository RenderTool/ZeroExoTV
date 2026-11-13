/**
 * NodeGenerateDock - 吸附在选中节点正下方的生成输入面板(生成器同款 UI)
 *
 * Plan#33 生成器冗余收敛原型:不再依赖画布内独立的生成器节点,
 * 选中 text/image/video/audio 节点时,在节点正下方渲染「生成器同款」输入界面:
 * - 顶栏(navBg): 类型图标 + 类型名 + 折叠按钮
 * - 输入区: contentEditable(对齐 GeneratorPromptEditor 视觉: 透明底/占位符/字数)
 * - 底栏(navBg): 模型 Select + 参数弹层(SettingsPopoverShell) + accent 胶囊生成按钮
 *
 * 行为与底部 PromptPanel 完全一致:onPromptChange / onGenerate / onStop /
 * onConfigChange 全部转发,生成类型由宿主节点类型推导,无需选择。
 *
 * 定位:通过 useViewport 订阅视口,锚点由宿主注入的 getAnchorBounds 提供
 * (与 NodeCapsuleToolbar 同一套世界坐标→屏幕坐标换算),渲染在节点正下方。
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Text, Image, Music, Film, Sparkles, ChevronDown, ChevronUp, Layers, FileText, Aperture, ImageOff,
} from 'lucide-react';
import { useViewport } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { NodeRecord } from '@zeroexo/core';
import { resolveNodeSize } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { DockReferencesSection, getReferenceConfigByMode, type VideoReferenceBounds } from './dock-references-section.js';
import { DockFooterBar } from './dock-footer-bar.js';
import {
  GeneratorPromptEditor,
  type ReferenceItem,
  nodeActionBus,
  deriveIncomingReferences,
  referencesChanged,
  computeReferenceCompatibility,
  resolveAnyThumbUrl,
  GENERATOR_TYPE_META,
  NODE_TYPE_TO_INPUT_TYPE,
} from '@zeroexo/plugin-nodes';
import { apiGet } from '@/services/api-client.js';
import { filterChannelModelsByCapability } from '@/features/ai-config/use-ai-config-store.js';
import type { ModelCapability, ModelChannel } from '@/features/ai-config/use-ai-config-store.js';
import { LOCAL_VIDEO_MODEL_KEY, LOCAL_VIDEO_MODEL_LABEL, LOCAL_IMAGE_MODEL_KEY, LOCAL_IMAGE_MODEL_LABEL, KREA2_MODEL_KEY, KREA2_MODEL_LABEL, MOSS_MODEL_KEY, MOSS_MODEL_LABEL } from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { getModelInputTypes } from '@/features/ai-config/utils/model-utils.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import type { ChannelConstraints } from '@/features/generator-settings/dynamic-param-form.js';
import { useReadOnly } from '@/shared/readonly-context.js';
import type { WorkbenchShotReference } from '@/features/canvas-nodes/storyboard/workbench-types.js';
import { AssetSlotPicker, type AssetSlotKind, type AssetSlotPick } from '@/shared/components/asset-slot-picker.js';

/** 生成模式(宿主节点类型映射;text 模式走文本能力) */
export type GenerationMode = 'text' | 'image' | 'video' | 'audio';

export interface NodeGenerateDockProps {
  nodeId: string;
  nodeType: 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard';
  /** Plan#74 Phase B：生成通道。agent-proxy=投递画布Agent主管(script/storyboard，dock=初始询问)；direct-api=provider直调LLM(image/video/audio/text，默认) */
  generationChannel?: 'direct-api' | 'agent-proxy';
  initialPrompt?: string;
  isRunning: boolean;
  onPromptChange: (nodeId: string, prompt: string) => void;
  onGenerate: (nodeId: string, mode: GenerationMode, prompt: string, refs?: ReferenceItem[]) => void;
  onStop: (nodeId: string) => void;
  /** 生成器节点专用:当前生成模式(从 node.data.generationMode 推导) */
  configMode?: GenerationMode;
  /** 当前节点选用的模型值("channelId::model" 编码) */
  model?: string;
  onConfigChange?: (nodeId: string, patch: Record<string, unknown>) => void;
  /** 契约参数模块:当前模板参数值(存 node.data.paramValues) */
  paramValues?: Record<string, any>;
  /** 图形 store(订阅视口与图变化) */
  store: ReactGraphStore;
  /** 锚点包围盒(世界坐标);null 时回退 node.position + size */
  getAnchorBounds?: () => { x: number; y: number; width: number; height: number } | null;
  /** 回退锚点用节点记录 */
  node?: NodeRecord | Record<string, unknown> | null;
  /** 移动端:保留底部固定定位(避免吸附面板溢出屏幕) */
  isMobile?: boolean;
  /** 内联模式(不 portal 到画布,作为普通流内卡片渲染在宿主面板内容下方,避免依赖画布浮层定位) */
  inline?: boolean;
  /**
   * 卡片圆角(默认 DOCK_CARD_RADIUS=24,画布节点吸附面板保持原样)
   * 2026-08-31 约定:分镜生产台底部提示词栏复用本 dock 时传 0(不要圆角)
   */
  radius?: number;
  /** 初始是否收起(默认 true = 画布节点吸附面板同款「细条」;内嵌常驻面板传 false 直接展开) */
  defaultCollapsed?: boolean;
  /** 容器样式(仅 inline 内嵌模式生效,供宿主按固定高度/最小高度直接布局,无需再包一层 div) */
  style?: CSSProperties;
  /**
   * 适配固定高度容器(内嵌常驻面板,如出片工作台底部提示词区):
   * 参考素材区与底栏(模型/参数/生成)固定可见,仅文本输入区弹性可压缩滚动。
   * 画布节点吸附面板不传(保持内容自适应高度)。
   */
  fitToHeight?: boolean;
  /**
   * 受控参考素材模式(出片工作台):提供后参考区改受控数据——
   * 上传/删除直接写入 items(onChange),不建画布节点、不连线。
   * 数据存 WorkbenchShot.references,随 node.data 云同步,协作可见。
   */
  controlledReferences?: {
    items: WorkbenchShotReference[];
    onChange: (items: WorkbenchShotReference[]) => void;
  };
  /**
   * 受控模式从视频取帧回调（出片工作台：首尾帧槽位旁"从视频取帧"，由宿主实现抽帧+上传）。
   * 传此回调时首帧/尾帧空槽位显示「取帧」小按钮。
   */
  onExtractFrame?: (slot: 'first' | 'last') => void;
  /**
   * Plan#79 T2：参考素材上传接受的文件类型。
   * script/storyboard（agent-proxy）传 TEXT_UPLOAD_ACCEPT —— 图片/视频/音频转剧本·转分镜
   * 链路尚未开发，放开会造成用户误上传后无反馈；其余流派沿用默认。
   */
  accept?: string;
  /**
   * Plan#79 T2：预设标签场景（原节点胶囊动作下沉到提示词 dock）。
   * 传值后 dock 依据自身已连入的上游素材自动生成预设标签：
   * - script：「AI帮我写剧本」「@<上游节点> 转剧本」「导入小说」
   * - storyboard：「AI帮我写分镜」「@<上游节点> 转分镜」
   */
  presetKind?: 'script' | 'storyboard';
}

/** Plan#79 T2：dock 预设标签（标签形态 = 输入区上方的单行胶囊，非下拉非弹层） */
export interface NodeDockPreset {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** 点击后写入输入框的提示词（用户可再编辑，确认后点生成投递 Agent） */
  prompt?: string;
  /** 附加动作（如「导入小说」先弹文件选择）；执行顺序 = 先预填 prompt，再跑 run */
  run?: () => void;
}

// ===== 类型 → 图标/名称(对齐生成器 NODE_TYPE_CONFIG) =====
const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  text: { icon: <Text size={14} />, label: '文本' },
  image: { icon: <Image size={14} />, label: '图片' },
  video: { icon: <Film size={14} />, label: '视频' },
  audio: { icon: <Music size={14} />, label: '音频' },
  generator: { icon: <Sparkles size={14} />, label: '生成器' },
  'stacked-media': { icon: <Layers size={14} />, label: '堆叠' },
  script: { icon: <FileText size={14} />, label: '剧本' },
  storyboard: { icon: <Aperture size={14} />, label: '分镜' },
};

// 堆叠节点可切换的生成类型已移除(约定:堆叠不作为生成目标,下方不显示提示词面板)

function defaultMode(nodeType: NodeGenerateDockProps['nodeType'], configMode?: GenerationMode): GenerationMode {
  if (nodeType === 'generator' || nodeType === 'stacked-media') return configMode ?? 'image';
  if (nodeType === 'text') return 'text';
  if (nodeType === 'script') return 'text';  // 剧本节点走文本生成模式（2026-09-04 方案 D++ 小步实验）
  if (nodeType === 'storyboard') return 'text';  // 分镜节点走文本生成模式（Plan#74 Phase B，实际生成走 agent-proxy）
  if (nodeType === 'video') return 'video';
  if (nodeType === 'audio') return 'audio';
  return 'image';
}

// capability(模型能力) 与生成模式同值,text 模式走文本能力
function modeCapability(mode: GenerationMode): ModelCapability {
  if (mode === 'image' || mode === 'video' || mode === 'audio') return mode;
  return 'text';
}

// StyledSelect 已提取到 ./styled-select.tsx

// ===== 卡片外观 tokens(主页创意简报 AiInputBar variant="elevated" 同款:无边框+圆角卡片) =====
const DOCK_CARD_RADIUS = 24;

/**
 * Plan#79 T2：文本类创作节点（剧本/分镜，agent-proxy）参考素材上传仅接受文本。
 * 依据：图片/视频/音频「转剧本/转分镜」链路尚未开发，上传后无任何产出。
 */
export const TEXT_UPLOAD_ACCEPT = '.txt,.md,.markdown,.doc,.docx';

/**
 * Plan#79 T3：待展开 / 待预填的 dock 意图（模块级，跨 dock 挂载周期）。
 * 场景：空态卡「AI帮我写」触发时尚未选中节点 → dock 还没挂载 → 事件无人接收。
 * 因此事件先落这里，dock 挂载时消费（dock 由 editor-page 以 nodeId 为 key 挂载/重挂载）。
 */
const PENDING_DOCK_EXPAND = new Set<string>();
/** Plan#79 T2：导入小说等异步动作完成后待回填的提示词 */
const PENDING_DOCK_PROMPT = new Map<string, string>();

/**
 * Plan#79 T3：请求展开某节点的提示词 dock。
 * dock 未挂载时（对方刚点按钮、节点尚未选中）事件无人接收 → 先落意图，挂载时消费。
 */
export function requestNodeDockExpand(nodeId: string): void {
  PENDING_DOCK_EXPAND.add(nodeId);
  nodeActionBus.emit('nodeDock:expand', { nodeId });
}

/** Plan#79 T2：请求向某节点 dock 回填提示词（同上：未挂载时暂存） */
export function requestNodeDockPrompt(nodeId: string, text: string): void {
  if (!text.trim()) return;
  PENDING_DOCK_PROMPT.set(nodeId, text.trim());
  nodeActionBus.emit('nodeDock:setPrompt', { nodeId, text: text.trim() });
}

/** NodeGenerateDock 展开态屏幕高度(供聚焦补偿 focusOnNode 使用) */
export const NODE_DOCK_SCREEN_HEIGHT = 240;

// DockReferencesSection + getReferenceConfigByMode 已提取到 ./dock-references-section.tsx

// ===== 输入区(memo 隔离:仅 value/引用变化时重渲染,参考区与底栏不受打字影响) =====
/** 2026-08-31 导出给 WorkbenchPromptDock 复用（输入区 UI 原样复用） */
export const DockInputSection = memo(function DockInputSection({
  value,
  onChange,
  references,
  placeholder,
  mentionTypeFilter,
}: {
  value: string;
  onChange: (value: string) => void;
  references: ReferenceItem[];
  placeholder: string;
  mentionTypeFilter?: (ref: ReferenceItem) => boolean;
}) {
  const { theme } = useTheme();
  // @ 弹窗主题色:亮色白底/暗色 toolbar.panel(不依赖 textColor 亮度推断,暗色主题下 textColor 是亮色会误判)
  const isDark = theme.mode === 'dark';
  const popupBg = isDark ? (theme.toolbar.panel ?? '#26262b') : '#ffffff';
  const popupBorder = isDark ? (theme.toolbar.border ?? 'rgba(255,255,255,0.14)') : '#e7e5e4';
  return (
    <>
      <GeneratorPromptEditor
        value={value}
        onChange={onChange}
        references={references}
        readOnly={false}
        placeholder={placeholder}
        textColor={theme.toolbar.text}
        accentColor={theme.toolbar.accent}
        fontSize={13}
        lineHeight={1.7}
        minHeight={96}
        maxHeight={240}
        mentionTypeFilter={mentionTypeFilter}
        popupBackground={popupBg}
        popupBorderColor={popupBorder}
      />
    </>
  );
});

// ===== NodeGenerateDock =====

export function NodeGenerateDock({
  nodeId,
  nodeType,
  initialPrompt = '',
  isRunning,
  onPromptChange,
  onGenerate,
  onStop,
  configMode,
  model,
  onConfigChange,
  paramValues,
  store,
  getAnchorBounds,
  node,
  isMobile = false,
  inline = false,
  radius = DOCK_CARD_RADIUS,
  defaultCollapsed = true,
  style,
  fitToHeight = false,
  controlledReferences,
  onExtractFrame,
  generationChannel = 'direct-api',
  accept,
  presetKind,
}: NodeGenerateDockProps): React.ReactElement | null {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  // 生成类型由宿主节点类型推导(堆叠不作为生成目标,见下方 return null)
  const mode: GenerationMode = defaultMode(nodeType, configMode);
  const [prompt, setPrompt] = useState(initialPrompt.trim());
  // 默认收起(用户验收反馈:选中节点即弹大面板碍眼):点顶栏细条展开,展开态右上角按钮收起;
  // 聚焦补偿 NODE_DOCK_SCREEN_HEIGHT 仅预留空间,收起态下无副作用。
  // Plan#79 T3：挂载时消费「待展开」意图（空态卡点击时 dock 可能尚未挂载）
  const [collapsed, setCollapsed] = useState(() => {
    if (PENDING_DOCK_EXPAND.has(nodeId)) {
      PENDING_DOCK_EXPAND.delete(nodeId);
      return false;
    }
    return defaultCollapsed;
  });

  // 订阅视口(锚点换算依赖 viewport scale/offset;图变化由 getAnchorBounds 回调驱动)
  const viewport = useViewport(store);

  // 拖拽期间隐藏(tA9):移动节点时吸附面板每帧跟随重算消耗大,改为拖动期间整体隐藏,
  // 移动结束(setDragOffsets 清空)再显示 —— 剔除移动时的大量计算消耗
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (!store.subscribeDragOffsets) return;
    return store.subscribeDragOffsets(() => {
      const offsets = store.getDragOffsets();
      setIsDragging(!!offsets && offsets.size > 0);
    });
  }, [store]);

  // ===== 渠道/模型选项(与生成器一致:后端加载 + 按能力筛选) =====
  const [channels, setChannels] = useState<ModelChannel[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: Array<{
      id: string; name: string; provider: string; baseUrl: string;
      apiFormat: string; modelIcons?: Record<string, string>;
      models: Array<{ name: string; capabilities?: string[] }>;
    }> }>('/ai/channels')
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        setChannels(items.map((item) => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          baseUrl: item.baseUrl,
          apiKey: '',
          apiFormat: (item.apiFormat as 'openai' | 'gemini') || 'openai',
          models: Array.isArray(item.models) ? item.models.map((m) => m.name) : [],
          modelConfigs: Array.isArray(item.models) ? item.models.map((m) => ({
            name: m.name,
            capabilities: m.capabilities ?? [],
          })) : undefined,
          modelIcons: item.modelIcons || {},
        })));
      })
      .catch(() => { if (!cancelled) setChannels([]); });
    return () => { cancelled = true; };
  }, []);

  // 当前 ComfyUI 地址：Krea2 只在线上地址露出（本机没有 krea2 底模 / RES4LYF 采样器）

  const modelOptions = useMemo(() => {
    const encoded = filterChannelModelsByCapability(channels, modeCapability(mode));
    const options = encoded.map((enc) => {
      const parts = enc.split('::');
      const modelName = parts[1] ?? enc;
      const ch = channels.find((c) => c.id === parts[0]);
      const iconKey = ch?.modelIcons?.[modelName] || ch?.provider || undefined;
      return { value: enc, label: ch ? `${modelName}(${ch.name})` : modelName, iconKey };
    });
    // 本机 MiniMax H3：不是 AI 渠道，作为视频节点常驻选项（未连接 ComfyUI 时点生成会提示先连接）
    if (mode === 'video') {
      options.push({ value: LOCAL_VIDEO_MODEL_KEY, label: LOCAL_VIDEO_MODEL_LABEL, iconKey: 'zeroexo' });
    }
    // 本机 Qwen Image 2.1：图像编辑/文生图，作为图片节点常驻选项
    if (mode === 'image') {
      options.push({ value: LOCAL_IMAGE_MODEL_KEY, label: LOCAL_IMAGE_MODEL_LABEL, iconKey: 'zeroexo' });
      // 2026-11-11 用户要求：Krea2 / Moss 始终出现在图片节点下拉（本机也可能装了底模，
      // 云端/反代更常见）；缺模型时由生成错误明确提示，不再按地址静默隐藏。
      options.push({ value: KREA2_MODEL_KEY, label: KREA2_MODEL_LABEL, iconKey: 'zeroexo' });
      options.push({ value: MOSS_MODEL_KEY, label: MOSS_MODEL_LABEL, iconKey: 'zeroexo' });
    }
    return options;
  }, [channels, mode]);

  // ===== 连入参考素材(复用生成器 deriveIncomingReferences 归一化) =====
  const [graphVersion, setGraphVersion] = useState(0);
  useEffect(() => {
    const unsub = store.subscribeGraph(() => setGraphVersion((v) => v + 1));
    return unsub;
  }, [store]);

  // Plan#79 T3：外部入口（空态卡「AI帮我写」/预设标签）触发展开。
  // 形态不变：dock 仍是吸附在节点正下方的悬浮面板，展开态 = 点击顶栏细条的同款结果。
  useEffect(() => {
    const unsubExpand = nodeActionBus.on('nodeDock:expand', (event: any) => {
      const target = event?.nodeId as string | undefined;
      if (target && target !== nodeId) return;
      setCollapsed(false);
    });
    // Plan#79 T2：异步动作完成后回填提示词（如「导入小说」落库 → 预填 "@小说名 帮我把这个小说转成剧本"）
    // dock 尚未挂载时先落 PENDING，挂载后由下方 reset effect 消费，避免提示词丢失
    const unsubSetPrompt = nodeActionBus.on('nodeDock:setPrompt', (event: any) => {
      const target = event?.nodeId as string | undefined;
      if (target && target !== nodeId) return;
      const text = typeof event?.text === 'string' ? event.text : '';
      if (!text.trim()) return;
      PENDING_DOCK_PROMPT.set(nodeId, text.trim());
      setCollapsed(false);
      setPrompt(text.trim());
      promptRef.current = text.trim();
      onPromptChange(nodeId, text.trim());
    });
    return () => { unsubExpand(); unsubSetPrompt(); };
  }, [nodeId, onPromptChange]);

  const incomingNodesRaw = useMemo(() => {
    const graph = store.getGraph();
    const incoming = graph.edges
      .filter((e) => e.target.nodeId === nodeId)
      .flatMap((e) => {
        const srcNode = graph.nodes.find((n) => n.id === e.source.nodeId);
        if (!srcNode) return [];
        const d = (srcNode.data ?? {}) as Record<string, unknown>;
        // 堆叠节点保持整体条目(不展开成卡片:展开会导致 @ 列表 20+ 条目截断选不到;
        // 整体语义 = 堆叠所有卡片作为整体参考素材,与 stacked-media 输出契约一致)
        if (srcNode.type === 'stacked-media') {
          const cards = (d.cards as Array<{ id: string; sourceType: string; title?: string; data?: Record<string, unknown> }> | undefined) ?? [];
          return [{
            id: srcNode.id,
            type: 'stacked-media',
            content: undefined,
            storageKey: undefined,
            title: `${srcNode.title || srcNode.id.slice(0, 8)}(${cards.length})`,
          }];
        }
        return [{
          id: srcNode.id,
          type: srcNode.type,
          content: typeof d.content === 'string' ? d.content : undefined,
          storageKey: typeof d.storageKey === 'string' ? d.storageKey : undefined,
          title: (srcNode.title || (typeof d.title === 'string' ? d.title : undefined) || srcNode.type) as string,
        }];
      });
    return deriveIncomingReferences(incoming);
  }, [store, nodeId, graphVersion]);

  // 稳定化引用(隔离 graphVersion 高频变化导致的无意义重渲染)
  const incomingNodesRef = useRef(incomingNodesRaw);
  const [incomingNodes, setIncomingNodes] = useState(incomingNodesRaw);
  useEffect(() => {
    const prev = incomingNodesRef.current;
    if (!referencesChanged(prev, incomingNodesRaw)) return;
    incomingNodesRef.current = incomingNodesRaw;
    setIncomingNodes(incomingNodesRaw);
  }, [incomingNodesRaw]);

  // 当前模型支持的输入类型(兼容性计算,与生成器一致)
  const currentModelValue = model ?? '';
  const hasImageReference = useMemo(
    () => incomingNodes.some((n) => n.type === 'image' || n.type === 'stacked-media'),
    [incomingNodes],
  );
  const supportedInputTypes = useMemo(() => {
    if (!currentModelValue) return ['text'];
    // 本机 MiniMax H3：参考生视频（文本 + 一张参考图），与插件节点单参考槽一致
    if (currentModelValue === LOCAL_VIDEO_MODEL_KEY) return ['text', 'image'];
    // 本机 Qwen Image 2.1：图像编辑（文本 + 参考图）
    if (currentModelValue === LOCAL_IMAGE_MODEL_KEY) return ['text', 'image'];
    // Krea2 文生图：只有文本输入（模型没有参考图槽）
    if (currentModelValue === KREA2_MODEL_KEY || currentModelValue === MOSS_MODEL_KEY) return ['text'];
    return getModelInputTypes(channels, currentModelValue);
  }, [channels, currentModelValue]);

  // 参考素材区是否出现：纯文生图模型（Krea2）只吃文本，不给「上传参考图」的假入口
  const supportsReferenceInput = supportedInputTypes.some((t) => t !== 'text');

  // 纯文生图模型不接收图片：把已有的图片连线明确断开（而不是留一条看似有效的线）
  const supportedInputKey = supportedInputTypes.join(',');
  useEffect(() => {
    if (!currentModelValue || mode !== 'image' || supportedInputTypes.includes('image')) return;
    for (const n of incomingNodes) {
      if (n.type === 'image') {
        nodeActionBus.emit('nodeDock:removeConnection', { nodeId, sourceNodeId: n.id });
      }
    }
  }, [currentModelValue, mode, supportedInputKey, incomingNodes, nodeId]);

  // ===== 参考素材统一选择页（2026-11-13）=====
  const [assetPickerAnchor, setAssetPickerAnchor] = useState<HTMLElement | null>(null);
  const pickerKinds = useMemo<AssetSlotKind[]>(
    () => (['image', 'video', 'audio'] as const).filter((k) => supportedInputTypes.includes(k)),
    [supportedInputTypes],
  );
  /** 该节点接受哪些媒体类型，就只列哪类画布节点；纯文本入口仍走文件框 */
  const canOpenPicker = supportsReferenceInput
    && pickerKinds.length > 0
    && !controlledReferences
    && !(accept && !/(image|video|audio)/.test(accept));
  const pickerCanvasNodes = useMemo(() => {
    const graph = store.getGraph();
    return graph.nodes
      .filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio')
      .map((n) => {
        const d = (n.data ?? {}) as Record<string, unknown>;
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          storageKey: typeof d.storageKey === 'string' ? d.storageKey : undefined,
          url: typeof d.url === 'string' ? d.url : undefined,
          content: typeof d.content === 'string' ? d.content : undefined,
        };
      });
    // graphVersion 变化时重建（订阅 store 的图版本）
  }, [store, graphVersion]);
  const handleSlotPick = useCallback((pick: AssetSlotPick) => {
    if (pick.fromNodeId) {
      // 画布已有节点：直接连过去，不复制第二个节点
      nodeActionBus.emit('nodeDock:connectReferenceNode', { nodeId, sourceNodeId: pick.fromNodeId });
    } else {
      nodeActionBus.emit('nodeDock:addReferenceNode', {
        nodeId,
        kind: pick.kind,
        title: pick.title,
        storageKey: pick.storageKey,
        content: '',
      });
    }
    setAssetPickerAnchor(null);
  }, [nodeId]);

  // 每个连入节点与当前模型的兼容性(蓝勾/红叉)
  const nodeCompatibility = useMemo(() => {
    return computeReferenceCompatibility(incomingNodes, {
      hasModelSelected: !!currentModelValue,
      supportedInputTypes,
      generationMode: mode,
    });
  }, [incomingNodes, supportedInputTypes, currentModelValue, mode]);

  // 连入参考素材缩略图(异步解析 storageKey → thumb 级 URL,与生成器 refUrlMap 同链)
  // 堆叠整体条目无图;展开卡片(id 为 `${nodeId}::${cardId}`)也在此解析,供 @ 列表展示
  const [refUrlMap, setRefUrlMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(incomingNodes.map(async (n) => {
        if ((n.type === 'image' || n.type === 'video') && n.storageKey) {
          try {
            const u = await resolveAnyThumbUrl(n.storageKey);
            if (u) next[n.id] = u;
            else if (typeof n.content === 'string' && (n.content.startsWith('data:') || n.content.startsWith('http'))) {
              next[n.id] = n.content;
            }
          } catch { /* 无缩略图回退内容直链 */ }
        } else if ((n.type === 'image' || n.type === 'video') && typeof n.content === 'string'
          && (n.content.startsWith('data:') || n.content.startsWith('http'))) {
          // 没有 storageKey 但有内联内容（刚生成/外部拖入）：直接用作槽位缩略图，避免空槽黑块
          next[n.id] = n.content;
        } else if (n.type === 'stacked-media') {
          // 堆叠:展开解析各卡片缩略图(@ 列表与参考区展示用)
          const graph = store.getGraph();
          const src = graph.nodes.find((g) => g.id === n.id);
          const cards = ((src?.data as { cards?: Array<{ id: string; sourceType: string; data?: Record<string, unknown> }> } | undefined)?.cards) ?? [];
          for (const card of cards) {
            const key = `${n.id}::${card.id}`;
            const st = typeof card.data?.storageKey === 'string' ? card.data.storageKey : undefined;
            if (st) {
              try {
                const u = await resolveAnyThumbUrl(st);
                if (u) { next[key] = u; continue; }
              } catch { /* 回退 content 直链 */ }
            }
            const ct = typeof card.data?.content === 'string' ? card.data.content : undefined;
            if (ct && (card.sourceType === 'image' || card.sourceType === 'video')) next[key] = ct;
          }
        }
      }));
      if (!cancelled) setRefUrlMap(next);
    })();
    return () => { cancelled = true; };
  }, [incomingNodes, store]);

  // @ 引用列表(与生成器 GeneratorPromptEditor 的 references 契约一致)
  // 堆叠在此展开为具体卡片条目:只有明确 @ 到支持类型的卡片才会作为 API 资产源输入;
  // 参考列表区(DockReferencesSection)仍显示堆叠整体图标,两者分离
  const references: ReferenceItem[] = useMemo(() => {
    const graph = store.getGraph();
    const out: ReferenceItem[] = [];
    for (const n of incomingNodes) {
      if (n.type === 'stacked-media') {
        const src = graph.nodes.find((g) => g.id === n.id);
        const cards = ((src?.data as { cards?: Array<{ id: string; sourceType: string; title?: string; data?: Record<string, unknown> }> } | undefined)?.cards) ?? [];
        for (const card of cards) {
          out.push({
            id: `${n.id}::${card.id}`,
            type: (card.sourceType as ReferenceItem['type']) ?? 'text',
            name: card.title || card.sourceType || src?.title || n.id.slice(0, 8),
            url: refUrlMap[`${n.id}::${card.id}`] || (typeof card.data?.content === 'string' ? card.data.content : undefined),
            asset: {
              content: typeof card.data?.content === 'string' ? card.data.content : undefined,
              storageKey: typeof card.data?.storageKey === 'string' ? card.data.storageKey : undefined,
            },
          });
        }
      } else {
        out.push({
          id: n.id,
          type: (n.type as ReferenceItem['type']) ?? 'text',
          name: n.title || n.id.slice(0, 8),
          url: refUrlMap[n.id] || (n.type === 'image' ? n.content : undefined) || undefined,
          asset: { content: n.content, storageKey: n.storageKey },
        });
      }
    }
    return out;
  }, [incomingNodes, refUrlMap, store]);

  /**
   * @ 图片：除了连入素材，画布上所有图片节点也应能 @。
   * 这些图片只在“被 @ 到”时才作为输入源，避免没连线的图被静默塞进生成。
   */
  const canvasMentionRefs: ReferenceItem[] = useMemo(() => {
    const graph = store.getGraph();
    const incomingIds = new Set(incomingNodes.map((n) => n.id));
    return graph.nodes
      .filter((n) => n.type === 'image' && n.id !== nodeId && !incomingIds.has(n.id))
      .map((n) => {
        const d = (n.data ?? {}) as Record<string, unknown>;
        return {
          id: n.id,
          type: 'image' as const,
          name: n.title || (typeof d.title === 'string' ? d.title : undefined) || n.id.slice(0, 8),
          url: refUrlMap[n.id] || (typeof d.content === 'string' ? d.content : undefined),
          asset: {
            content: typeof d.content === 'string' ? d.content : undefined,
            storageKey: typeof d.storageKey === 'string' ? d.storageKey : undefined,
          },
        };
      });
  }, [incomingNodes, nodeId, refUrlMap, store, graphVersion]);

  const mentionReferences = useMemo(
    () => [...references, ...canvasMentionRefs],
    [references, canvasMentionRefs],
  );

  // ===== Plan#79 T2：预设标签（原胶囊动作下沉）=====
  // 上游名取自已连入的参考素材（堆叠内部卡片以 `::` 分隔，此处只认整体连入的节点），
  // 与用户输入同源：@看到的节点名 = 生成时投递给 Agent 的引用名。
  const presetList = useMemo<NodeDockPreset[]>(() => {
    if (!presetKind) return [];
    const upstream = references.find((r) => !r.id.includes('::'));
    const atUp = upstream ? `@${upstream.name} ` : '';
    if (presetKind === 'script') {
      return [
        { key: 'write-script', label: 'AI帮我写剧本', prompt: '帮我写剧本' },
        {
          key: 'novel-to-script',
          label: upstream ? `@${upstream.name} 转剧本` : '转剧本',
          prompt: `${atUp}帮我把这个长文本转成剧本`,
        },
        {
          key: 'import-novel',
          label: '导入小说',
          // 先弹文件选择 → 落库建 novel 节点并自动连线 → 完成后由 novel 导入链路回写预设提示词
          run: () => nodeActionBus.emit('novel:import-from-script', { nodeId }),
        },
      ];
    }
    return [
      { key: 'write-storyboard', label: 'AI帮我写分镜', prompt: '帮我写分镜' },
      {
        key: 'script-to-storyboard',
        label: upstream ? `@${upstream.name} 转分镜` : '转分镜',
        prompt: `${atUp}帮我把这个内容转成分镜`,
      },
    ];
  }, [presetKind, references, nodeId]);

  // ===== 受控参考素材模式(出片工作台):数据存 WorkbenchShot.references,不建画布节点 =====
  const controlledItems = controlledReferences?.items ?? [];

  // 受控模式展示数据:把 references 转成参考区需要的节点形状(无画布连线)
  const displayIncomingNodes = useMemo(() => {
    if (!controlledReferences) return incomingNodes;
    return controlledItems.map((r) => ({
      id: r.id,
      type: r.kind,
      title: r.title ?? (r.kind === 'image' ? '图片' : r.kind),
      content: r.url,
      storageKey: r.storageKey,
    }));
  }, [controlledReferences, controlledItems, incomingNodes]);

  // 受控模式缩略图:直接用 items 的 url(无需异步解析)
  const displayRefUrlMap = useMemo(() => {
    if (!controlledReferences) return refUrlMap;
    const m: Record<string, string> = {};
    for (const r of controlledItems) {
      if (r.url) m[r.id] = r.url;
    }
    return m;
  }, [controlledReferences, controlledItems, refUrlMap]);

  // 受控模式全部视为兼容(无模型兼容性校验)
  const displayNodeCompatibility = controlledReferences ? {} : nodeCompatibility;

  // 断开连入节点连线 / 受控模式下移除 references 条目
  const handleRemoveIncoming = useCallback((sourceNodeId: string) => {
    if (controlledReferences) {
      controlledReferences.onChange(controlledItems.filter((r) => r.id !== sourceNodeId));
      return;
    }
    nodeActionBus.emit('nodeDock:removeConnection', { nodeId, sourceNodeId });
  }, [nodeId, controlledReferences, controlledItems]);

  // @ 引用类型过滤:按当前生成类型过滤支持媒体;文本/剧本等恒可作为提示参考
  const mentionTypeFilter = useCallback((r: ReferenceItem): boolean => {
    const inputType = NODE_TYPE_TO_INPUT_TYPE[r.type] ?? 'text';
    if (inputType === 'text') return true;
    return (GENERATOR_TYPE_META[mode]?.supportedInputs ?? []).includes(inputType);
  }, [mode]);

  // nodeId 切换时以该节点已保存的 prompt 为初始值;
  // 不依赖 initialPrompt 变化:编辑期间的父级回写(存储/云同步)不得重置正在编辑的输入,
  // 否则 value 被旧纯文本覆盖 → GeneratorPromptEditor 初始化会重写 innerText 摧毁 @badge
  useEffect(() => {
    // Plan#79 T2：优先消费待回填的提示词（如「导入小说」完成后预填）
    const pending = PENDING_DOCK_PROMPT.get(nodeId);
    if (pending) {
      PENDING_DOCK_PROMPT.delete(nodeId);
      setPrompt(pending);
      promptRef.current = pending;
      return;
    }
    // 重置为节点已保存的 prompt(trim 掉边界空白,避免未生成仅编辑时残留尾部换行产生空行)
    setPrompt(initialPrompt.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // prompt 最新值 ref(保证 submit 闭包稳定,不随逐字输入重建 → 底栏 memo 生效)
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  const updatePrompt = useCallback(
    (value: string) => {
      setPrompt(value);
      onPromptChange(nodeId, value);
    },
    [onPromptChange, nodeId],
  );

  /** 提示词库预设：空输入直接填入；已有内容则追加，避免覆盖用户正在写的提示词 */
  const appendPromptPreset = useCallback(
    (body: string) => {
      const current = promptRef.current.trim();
      updatePrompt(current ? `${current}\n\n${body}` : body);
    },
    [updatePrompt],
  );

  // 契约参数模块:增量 patch 直传,由 handleNodeConfigChange 基于 graph 最新 paramValues 合并,
  // 避免组件层旧闭包合并导致一次点击连发的多个 patch 互相覆盖(分辨率/宽高比联动曾丢更新)
  const handleParamValuesChange = useCallback(
    (patch: Record<string, any>) => {
      onConfigChange?.(nodeId, { paramValues: patch });
    },
    [onConfigChange, nodeId],
  );

  // 模型未选择且渠道已加载出可用模型时,自动选中第一个:
  // 左侧模型下拉会显示 options[0] 但值仍为空 → 参数面板匹配不到模板显示"无自定义参数",
  // 用户以为坏了;自动选中后参数面板随模型立即刷新
  useEffect(() => {
    if (!model && modelOptions.length > 0 && modelOptions[0]) {
      onConfigChange?.(nodeId, { model: modelOptions[0].value });
    }
  }, [model, modelOptions, nodeId, onConfigChange]);

  // 视频参考模式:仅视频模式且参数中显式选择了模式时才切换参考区
  // (图片节点永远多模态;视频未在参数面板选择模式时也保持多模态,避免误入首尾帧)
  const currentVideoMode = mode === 'video' && typeof paramValues?.mode === 'string'
    ? paramValues.mode
    : 'multi-modal-reference';
  // 参考素材上限(从模板约束回调读取,与后端 channelConstraints.bounds 对齐)
  const [refBounds, setRefBounds] = useState<VideoReferenceBounds>({});
  const handleConstraintsReady = useCallback((constraints?: ChannelConstraints) => {
    setRefBounds({
      maxReferenceImages: constraints?.bounds?.maxReferenceImages,
      maxReferenceVideos: constraints?.bounds?.maxReferenceVideos,
      maxReferenceAudios: constraints?.bounds?.maxReferenceAudios,
    });
  }, []);

  // 首尾帧模式判断(受控上传时分配槽位)
  const refConfig = getReferenceConfigByMode(currentVideoMode, refBounds);
  const isFirstLastMode = refConfig.isFirstLastFrameMode;

  // 受控上传:上传 → 写入 references(首尾帧模式图片按槽位填入)
  const handleControlledUpload = useCallback(async (file: File) => {
    if (!controlledReferences) return;
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      // 类型收窄:uploadAsset 的 data 是 text/script/plan/image/video/audio 联合,按 kind 分别取字段
      let refKind: WorkbenchShotReference['kind'] = 'text';
      let storageKey: string | undefined;
      let url: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (d.kind === 'image') {
        refKind = 'image';
        storageKey = d.storageKey;
        url = d.dataUrl;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'video') {
        refKind = 'video';
        storageKey = d.storageKey;
        url = d.url;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'audio') {
        refKind = 'audio';
        storageKey = d.storageKey;
        url = d.url;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: refKind,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        storageKey,
        url,
        width,
        height,
      };
      if (isFirstLastMode && ref.kind === 'image') {
        const images = controlledItems.filter((r) => r.kind === 'image');
        if (images.length >= 2) return; // 首尾帧槽位已满
        ref.slot = images.some((r) => r.slot === 'first') ? 'last' : 'first';
      }
      controlledReferences.onChange([...controlledItems, ref]);
    } catch {
      // 上传失败静默(不打断当前编辑)
    }
  }, [controlledReferences, controlledItems, isFirstLastMode]);

  const submit = useCallback(() => {
    const text = promptRef.current.trim();
    if (!text || isRunning) return;
    // 输入源 = 全部连入素材(非堆叠节点自动作为 API 输入源,符合用户习惯:连线即输入,无需逐个 @)
    // + @ 到的堆叠内部卡片(堆叠整体不发送,内部资源需显式 @ 才会作为输入源)
    const mentionedStacked = references.filter((r) => r.id.includes('::') && text.includes(`@${r.name}`));
    const nonStacked = references.filter((r) => !r.id.includes('::'));
    // 画布上的图片可 @，但只有真的 @ 到才作为输入源（不连线不自动塞）
    const mentionedCanvas = canvasMentionRefs.filter((r) => text.includes(`@${r.name}`));
    onGenerate(nodeId, mode, text, [...nonStacked, ...mentionedCanvas, ...mentionedStacked]);
    setPrompt('');
    promptRef.current = '';
  }, [isRunning, onGenerate, nodeId, mode, references, canvasMentionRefs]);

  const handleAction = useCallback(() => {
    if (isRunning) onStop(nodeId);
    else submit();
  }, [isRunning, onStop, nodeId, submit]);

  const typeMeta = TYPE_META[nodeType] ?? TYPE_META.generator!;

  // 堆叠内部卡片未 @ 引用 → 该卡片不发送(仅提示,不禁用生成;非堆叠连入素材自动作为输入源)
  // 注意:必须在任何条件 return 之前调用(React Hooks 顺序铁律)
  const stackedRefs = useMemo(() => references.filter((r) => r.id.includes('::')), [references]);
  const hasMentionedStacked = useMemo(
    () => stackedRefs.some((r) => prompt.includes(`@${r.name}`)),
    [stackedRefs, prompt],
  );
  const mentionRequired = stackedRefs.length > 0 && !hasMentionedStacked;

  // 只读模式整体隐藏（2026-08-25 系统性只读防护）：提示词输入/生成按钮是核心编辑入口，
  // portal 浮层逃逸画布遮罩，必须组件级拦截
  if (readOnly) return null;

  // 堆叠节点:资源浏览器语义,不作为生成目标(约定:下方不显示提示词面板,
  // 堆叠只作为上游参考输入,具体卡片经 @ 在生成节点面板中引用)
  if (nodeType === 'stacked-media') return null;

  // ===== 吸附定位(世界坐标 → 屏幕坐标,对齐 NodeCapsuleToolbar) =====
  const liveBounds = getAnchorBounds ? getAnchorBounds() : null;
  const fallbackNode = node as NodeRecord | null | undefined;
  const size = resolveNodeSize(fallbackNode ?? {}, undefined);
  // Plan#79 防御：position 可能尚未就绪（节点刚创建 / 宿主演化中），可选链读到底并兜底 0，
  // 否则 `position.x` 抛 TypeError 会整棵 React 子树崩掉（实测：点「AI帮我写」立刻选中时触发）。
  const boundsX = liveBounds?.x ?? fallbackNode?.position?.x ?? 0;
  const boundsY = liveBounds?.y ?? fallbackNode?.position?.y ?? 0;
  const boundsW = liveBounds?.width ?? size.width;
  const boundsH = liveBounds?.height ?? size.height;
  const vp = viewport ?? { x: 0, y: 0, k: 1 };
  const centerX = boundsX * vp.k + vp.x + (boundsW * vp.k) / 2;
  const bottomY = (boundsY + boundsH) * vp.k + vp.y + 8;

  // ===== 卡片配色(主页创意简报 AiInputBar variant="elevated" 同款;
  //      修复:去除分区分层色块,整体单色自然融合) =====
  const isDark = theme.mode === 'dark';
  const cardStyle: CSSProperties = {
    width: '100%',
    position: 'relative',
    borderRadius: radius,
    background: theme.toolbar.panel ?? (isDark ? '#1e1e20' : '#fafaf7'),
    border: `1px solid ${theme.toolbar.border}`,
    transition: 'all .25s',
    color: theme.toolbar.text,
  };
  // 内部分区:不加色块背景(整体单色),仅用间距自然分隔
  const sectionStyle: CSSProperties = {
    margin: '0 10px',
    padding: '10px 14px',
  };
  const hasText = prompt.trim().length > 0;

  // 拖动中隐藏(移动结束恢复):剔除移动时每帧跟随计算消耗
  if (isDragging) return null;

  // ===== 展开/收起(2026-08-31 约定:收纳要有过渡,不能硬切) =====
  // 折叠细条与展开内容始终同在 DOM:细条 height→0 + 淡出,内容用 grid-template-rows 0fr→1fr 过渡
  // (0fr↔1fr 是唯一能对「内容自适应高度」做平滑过渡的写法;max-height 猜值要么卡顿要么截断)。
  // 折叠态内容 overflow hidden + pointerEvents none:不可点、不可聚焦,但不卸载 → 再次展开无白屏。
  const COLLAPSE_EASE = '0.28s cubic-bezier(0.22, 1, 0.36, 1)';
  const COLLAPSED_BAR_HEIGHT = 34;

  return (
    <div
      style={inline ? {
        position: 'relative', width: '100%', maxWidth: '100%', zIndex: 'auto' as unknown as number,
        ...style,
        // fitToHeight(出片工作台底部 dock)：折叠时收起为细条并吸附到底部，而不是贴顶部
        ...(fitToHeight
          ? {
              display: 'flex',
              flexDirection: 'column',
              transition: `height ${COLLAPSE_EASE}`,
              ...(collapsed ? { height: COLLAPSED_BAR_HEIGHT, flexShrink: 0, marginTop: 'auto' } : {}),
            }
          : {}),
      } : isMobile ? mobileWrapStyle : {
        position: 'absolute', left: centerX, top: bottomY, transform: 'translateX(-50%)',
        zIndex: 48, width: collapsed ? 220 : 720, maxWidth: 'calc(100vw - 24px)',
        transition: `width ${COLLAPSE_EASE}`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* 无边框卡片(主页创意简报 elevated 同款:整体单色 + 柔和阴影) */}
      <div style={{ ...cardStyle, height: fitToHeight ? '100%' : undefined, display: fitToHeight ? 'flex' : undefined, flexDirection: fitToHeight ? 'column' : undefined, overflow: 'hidden', transition: `box-shadow ${COLLAPSE_EASE}, background ${COLLAPSE_EASE}, border-radius ${COLLAPSE_EASE}` }}>
        {/* 折叠细条(展开时高度收为 0 并淡出) */}
        <div
          style={{
            height: collapsed ? COLLAPSED_BAR_HEIGHT : 0,
            opacity: collapsed ? 1 : 0,
            transform: collapsed ? 'translateY(0)' : 'translateY(-6px)',
            transition: `height ${COLLAPSE_EASE}, opacity 0.18s ease, transform ${COLLAPSE_EASE}`,
            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            padding: '0 14px', boxSizing: 'border-box', overflow: 'hidden',
            color: theme.toolbar.text, fontSize: 12, cursor: 'pointer', userSelect: 'none',
            pointerEvents: collapsed ? 'auto' : 'none',
          }}
          onClick={(e) => { e.stopPropagation(); setCollapsed(false); }}
          title={t('nodeDock.expand', '展开生成面板')}
        >
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>{typeMeta.icon}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {typeMeta.label} · {t('nodeDock.generate', '生成')}
          </span>
          <ChevronUp size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
        </div>

        {/* 展开内容(折叠时 grid rows 收为 0fr) */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: collapsed ? '0fr' : '1fr',
            opacity: collapsed ? 0 : 1,
            transform: collapsed ? 'translateY(-4px)' : 'translateY(0)',
            transition: `grid-template-rows ${COLLAPSE_EASE}, opacity 0.2s ease, transform ${COLLAPSE_EASE}`,
            pointerEvents: collapsed ? 'none' : 'auto',
            flex: fitToHeight ? 1 : undefined,
            minHeight: fitToHeight ? 0 : undefined,
          }}
          aria-hidden={collapsed}
        >
        <div style={fitToHeight
          ? { overflow: 'hidden', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }
          : { overflow: 'hidden', minHeight: 0, position: 'relative' }}>
      {/* 收起按钮(右上角小图标,替代原标题行折叠入口,节省空间) */}
      <button
        type="button"
        title={t('nodeDock.collapse', '收起')}
        onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, border: 'none', borderRadius: 8,
          background: 'transparent', color: theme.toolbar.text, cursor: 'pointer',
          padding: 0, transition: 'opacity 0.12s',
          opacity: 0.45,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45'; }}
      >
        <ChevronDown size={13} />
      </button>

      {/* 参考素材区(单色融入;memo 隔离;按 paramValues.mode 智能切换首尾帧/多模态)
          Krea2 等纯文生图模型没有参考图输入：不渲染上传/槽位区，避免误导用户「可以垫图」 */}
      {supportsReferenceInput ? (
        <div style={{ ...sectionStyle, flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DockReferencesSection
            nodeId={nodeId}
            incomingNodes={displayIncomingNodes}
            refUrlMap={displayRefUrlMap}
            nodeCompatibility={displayNodeCompatibility}
            onRemoveIncoming={handleRemoveIncoming}
            mode={currentVideoMode}
            bounds={refBounds}
            onUpload={controlledReferences ? handleControlledUpload : undefined}
            onExtractFrame={onExtractFrame}
            accept={accept}
            onOpenPicker={canOpenPicker ? (anchor) => setAssetPickerAnchor(anchor) : undefined}
          />
        </div>
      ) : (
        <div
          data-no-reference-input=""
          style={{ ...sectionStyle, flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 6, color: theme.toolbar.textMuted, fontSize: 12 }}
        >
          <ImageOff size={14} />
          {t('nodeDock.textOnlyModel', '该模型只支持文生图，不支持参考图（连入的素材不会作为输入）')}
        </div>
      )}

      {/* Plan#79 T2：预设标签行（原节点胶囊动作下沉到提示词面板，点击 = 预填提示词）
          形态：输入区上方单行胶囊，可横向换行；非下拉、非模态 */}
      {presetList.length > 0 ? (
        <div style={{ ...sectionStyle, paddingTop: 0, flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {presetList.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.prompt ?? p.label}
              onClick={(e) => {
                e.stopPropagation();
                if (typeof p.prompt === 'string' && p.prompt.trim()) updatePrompt(p.prompt.trim());
                p.run?.();
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
                padding: '4px 10px', borderRadius: 14,
                border: `1px solid ${theme.toolbar.border}`, background: 'transparent',
                color: theme.toolbar.textMuted ?? theme.toolbar.text, fontSize: 12, lineHeight: 1.4,
                cursor: 'pointer', transition: 'background-color 0.12s, color 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.05)'; e.currentTarget.style.color = theme.toolbar.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = theme.toolbar.textMuted ?? theme.toolbar.text; }}
            >
              {p.icon}
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 输入区(生成器同款 @ 引用 contentEditable;memo 隔离)
          fitToHeight:唯一可压缩的区域——超高时内部滚动,参考区与底栏始终可见;
          scrollbar-gutter stable:滚动条占位,避免字数统计被滚动条遮挡 */}
      <div style={{ ...sectionStyle, flex: fitToHeight ? 1 : undefined, minHeight: fitToHeight ? 0 : undefined, overflowY: fitToHeight ? 'auto' : undefined, scrollbarGutter: fitToHeight ? 'stable' : undefined, display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
        <DockInputSection
          value={prompt}
          onChange={updatePrompt}
          references={mentionReferences}
          placeholder={t('nodeDock.placeholder', '输入提示词... 连入的素材会自动作为输入源(堆叠节点需 @ 内部资源)')}
          mentionTypeFilter={mentionTypeFilter}
        />
      </div>

      {/* 底栏(卡片内操作行;memo 隔离 + hasText 布尔化) */}
      <div style={{ ...sectionStyle, margin: '0 10px 10px', flexShrink: fitToHeight ? 0 : undefined, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DockFooterBar
          nodeId={nodeId}
          mode={mode}
          model={model ?? ''}
          modelOptions={modelOptions}
          paramValues={paramValues ?? {}}
          hasImageReference={hasImageReference}
          isRunning={isRunning}
          hasText={hasText}
          textLength={prompt.length}
          interruptible={mode === 'text'
            || (model ?? '').startsWith('zeroexo:')
            || model === LOCAL_VIDEO_MODEL_KEY
            || model === LOCAL_IMAGE_MODEL_KEY
            || model === KREA2_MODEL_KEY || model === MOSS_MODEL_KEY}
          onAction={handleAction}
          onConfigChange={onConfigChange}
          onParamValuesChange={handleParamValuesChange}
          onPromptPreset={appendPromptPreset}
          onConstraintsReady={handleConstraintsReady}
          mentionRequired={mentionRequired}
          dropUp={inline}
          hideModelSelect={generationChannel === 'agent-proxy'}
        />
      </div>
        </div>
        </div>
      </div>
      {assetPickerAnchor && canOpenPicker && (
        <AssetSlotPicker
          open
          onClose={() => setAssetPickerAnchor(null)}
          theme={theme}
          anchorEl={assetPickerAnchor}
          acceptKinds={pickerKinds}
          canvasNodes={pickerCanvasNodes}
          tabs={['canvas', 'asset', 'subject']}
          initialTab="canvas"
          onPick={handleSlotPick}
        />
      )}
    </div>
  );
}

// 移动端:保留底部固定定位(原 mobilePromptPanelWrapStyle 行为)
const mobileWrapStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 60px)',
  left: 12, right: 12,
  zIndex: 48,
};
