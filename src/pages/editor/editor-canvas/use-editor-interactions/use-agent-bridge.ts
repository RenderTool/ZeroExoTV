/**
 * use-agent-bridge - Agent 桥接操作
 *
 * 提取: AI 生成触发、保存节点资产、反向提示词等
 * 从 use-editor-interactions.ts 按功能域拆分
 */

import { useCallback, useEffect } from 'react';
import {
  AddNodeCommand,
  AddEdgeCommand,
  UpdateNodeDataCommand,
  UpdateNodeTitleCommand,
  ResizeNodeCommand,
  type NodeRecord,
} from '@zeroexo/core';
import { AiError, classifyError } from '@zeroexo/plugin-ai-provider';
import type { AiErrorType } from '@zeroexo/plugin-ai-provider';
import { nodeActionBus, setGeneratingPreview, clearGeneratingPreview, type ReferenceItem } from '@zeroexo/plugin-nodes';
import { resolvePlacement } from '@zeroexo/core';
import { modelOptionLabel } from '@/features/ai-config/use-ai-config-store.js';
import { LOCAL_VIDEO_MODEL_KEY, LOCAL_VIDEO_MODEL_LABEL } from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { generateLocalMiniMaxVideo } from '../interactions/local-minimax-video.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { buildNodeAssetInput } from '@/features/asset-picker/services/upload-asset.js';
import { autoLandGenerationOutput } from '@/features/canvas-assets/history-autoland.js';
import { buildTemplateParams, promptTitleSummary, collectInputReferences, formatInputRefs } from './use-ai-generation.js';
import { IMAGE_PROMPT_REVERSE_PRESET, contentToDataUrl } from './helpers.js';
// 本地版（Plan#83）：前端不含 Agent/LLM。原本「节点生成 = 投递 Agent 会话」，
// 现改为：图/音/视频直负本地渠道属 Phase 2 T2.4（未接入，调用即报错）；
// 剧本/分镜类 LLM 产物由外部工具经 MCP 直接读写数据目录。
const sendMessage = async (..._args: unknown[]): Promise<{ taskId: string }> => {
  throw new Error('本地版无内置 Agent 会话：该动作已移到外部工具（MCP）');
};
const useCanvasAgentStore = { getState: (): Record<string, any> => ({ isGenerating: false, messages: [], dockOpen: false, setDockOpen: () => {}, setDockTab: () => {}, toggleDock: () => {}, setInputText: () => {}, addMessage: () => {}, addReference: () => {}, setThinking: () => {}, setIsGenerating: () => {}, setPhase: () => {}, setCurrentTaskId: () => {} }) };
/**
 * 上游素材节点 → @ 引用的完整形状（2026-11-06 类型修复）。
 * 原声明只写了 `kind`，但下方构建/消费用了 nodeId / label / assetId，
 * 造成 10 处 TS2339/TS2353。字段来源见同文件 L140-151：
 * nodeId = 节点 id，label = 标题四级回退（必为 string），
 * assetId = node.data.assetId（可选），contentLength/isEmpty 由 map 派生、不属本类型。
 */
type AgentReference = {
  nodeId: string;
  label: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  assetId?: string;
};
import type { AgentBridgeHookParams, GenerationMode } from './types.js';

/**
 * Plan#79 T1：上游素材节点 → @ 引用标签兜底名（节点无标题时）
 * 只用于气泡/引用清单展示，绝不读取节点正文。
 */
const UPSTREAM_LABEL: Record<string, string> = {
  novel: '小说',
  script: '剧本',
  text: '文本',
  storyboard: '分镜',
};

/**
 * Agent 桥接 / AI 生成相关 hooks
 */
export function useAgentBridgeHooks(
  params: AgentBridgeHookParams,
  nodeAbortControllersRef: React.MutableRefObject<Map<string, any>>,
  nodeFailureCountRef: React.MutableRefObject<Map<string, number>>,
) {
  const { refs, aiConfig, addAssetToStore, t } = params;

  // 清理旧数据：早期走外部渠道失败把「请先配置 API Key」写进 node.data，改成本机后仍会显示旧错误。
  useEffect(() => {
    const store = refs.store;
    const queue = refs.commandQueue;
    if (!store || !queue) return;
    const clean = (): void => {
      for (const node of store.getGraph().nodes) {
        const data = (node.data ?? {}) as Record<string, unknown>;
        if (data.status !== 'error') continue;
        const details = typeof data.errorDetails === 'string' ? data.errorDetails : '';
        if (!details.includes('请先配置 API Key') && !details.includes('AI 渠道检查 API Key') && !details.includes('连续多次失败')) continue;
        queue.execute(new UpdateNodeDataCommand(node.id, {
          status: 'idle', errorDetails: '', errorType: undefined,
        } as Record<string, unknown>));
      }
    };
    clean();
    return store.subscribeGraph(clean);
  }, [refs.store, refs.commandQueue]);

  /** 保存节点到素材库 */
  const handleSaveNodeAsset = useCallback(async (node: NodeRecord) => {
    // buildNodeAssetInput 异步变体：novel 长文本需先 resolveTextContent 取回正文再生成资产（Plan#74 Phase D）
    const input = await buildNodeAssetInput(node);
    if (!input) return;
    try {
      await addAssetToStore(input);
      // 列表刷新与滚动定位由 asset-store 内在发出的 assets:created 驱动，此处不手动开会话（Plan#74）
    } catch (err) {
      console.error('saveAsset failed:', err);
    }
  }, [addAssetToStore]);

  /** 反向提示词: 创建文本节点 + 连线图片→文本 + 调用AI反推 */
  const handleReversePrompt = useCallback(async (node: NodeRecord) => {
    if (!refs.commandQueue || !refs.store) return;
    const content = (node.data as { content?: string } | null)?.content ?? '';
    if (!content) return;

    const textNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const textPos = resolvePlacement({
      anchor: node,
      size: { width: 280, height: 120 },
      existingNodes: refs.store.getGraph().nodes.filter((n: any) => !n._deleted),
    });
    refs.commandQueue.execute(new AddNodeCommand({
      id: textNodeId,
      type: 'text',
      position: textPos,
      size: { width: 280, height: 120 },
      data: { text: t('imageEditor.reversePromptLoading'), status: 'loading' },
    } as any));
    refs.commandQueue.execute(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: { nodeId: node.id, pinId: 'image' },
      target: { nodeId: textNodeId, pinId: 'input' },
    }));
    refs.store.setSelection({ selectedNodeIds: new Set([textNodeId]), selectedEdgeIds: new Set() });

    const provider = refs.aiProvider;
    if (!provider) {
      refs.commandQueue.execute(new UpdateNodeDataCommand(textNodeId, { text: t('imageEditor.reversePromptFailed'), status: 'error' }));
      return;
    }

    try {
      const dataUrl = await contentToDataUrl(content);
      const result = await provider.generateText({
        prompt: IMAGE_PROMPT_REVERSE_PRESET,
        model: 'gpt-4o',
        referenceImages: [dataUrl],
      });
      refs.commandQueue.execute(new UpdateNodeDataCommand(textNodeId, { text: result, status: 'success' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      refs.commandQueue.execute(new UpdateNodeDataCommand(textNodeId, { text: `${t('imageEditor.reversePromptFailed')}: ${msg}`, status: 'error' }));
    }
  }, [refs, t]);

  /** AI 生成提示词 */
  const handlePromptGenerate = useCallback(
    async (nodeId: string, mode: GenerationMode, prompt: string, mentionedRefs?: ReferenceItem[]): Promise<void> => {
      // Plan#74 Phase B：script/storyboard 节点走 agent-proxy —— dock 点生成 = 投递画布 Agent 主管，
      // 与用户在 Agent 面板 @该节点发消息完全一致（同一 sendMessage 链路，走思考树，不产节点内骨架）。
      // dock = 初始询问：提示词投递主管后，主管按需询问更多明细（Plan#72 §3.1 主管=节点API）。
      // image/video/audio/text 保留 direct-api（下方 provider 直调 LLM，必须选模型）。
      const agentProxyNode = refs.store?.getGraph().nodes.find((n: any) => n.id === nodeId);
      const agentProxyType = agentProxyNode?.type;
      if (agentProxyType === 'script' || agentProxyType === 'storyboard') {
        // Plan#79 T1（硬约束 2026-09-07：生成 = @节点投递，严禁把上游正文内联进气泡/prompt）
        // 理由：一是几百万字小说内敛到气泡本身就是灾难；二是 C3 已打通 @ + assetId → read_asset_content
        // 直读链路，Agent 无需一次性吃全文。此处与 ComposerInput.handleSend 的 @ 引用投递形态完全对齐。
        const graph = refs.store?.getGraph();
        // Plan#80 Phase B：LLM @引用只投递活跃节点（过滤 _deleted=true 的墓碑节点）
        const upstreamRefs: AgentReference[] = [];
        const seenUpstream = new Set<string>();
        const nodeMap = new Map<string, any>();
        if (graph) {
          const activeNodes = graph.nodes.filter((n: any) => !n._deleted);
          for (const n of activeNodes) nodeMap.set(n.id, n);
          for (const edge of graph.edges) {
            if (edge.target?.nodeId !== nodeId) continue;
            const srcId = edge.source?.nodeId;
            if (!srcId || seenUpstream.has(srcId)) continue;
            const src = nodeMap.get(srcId);
            if (!src) continue;
            const srcData = (src.data ?? {}) as Record<string, any>;
            const assetId = typeof srcData.assetId === 'string' ? srcData.assetId : undefined;
            const label = (src.title as string)
              || (typeof srcData.title === 'string' ? srcData.title : '')
              || UPSTREAM_LABEL[src.type as string]
              || src.id.slice(0, 8);
            seenUpstream.add(srcId);
            upstreamRefs.push({ nodeId: src.id, kind: 'text', label, assetId });
          }
        }

        // Plan#79 T1.5（0-token 快车道特例）：全空上游 → 直接友好回复，不进 LLM 思考链
        const EMPTY_CONTENT_THRESHOLD = 10;
        const agentState = useCanvasAgentStore.getState();
        const refsWithStatus = upstreamRefs.map((ref) => {
          const n = nodeMap.get(ref.nodeId);
          const data = (n?.data ?? {}) as { content?: string; episodes?: unknown[]; shots?: unknown[] };
          // 多类型内容检测：script/storyboard 看 episodes，text 看 content，其他看 storageKey
          let contentLength = 0;
          if (typeof data.content === 'string') contentLength = data.content.trim().length;
          else if (Array.isArray(data.episodes)) contentLength = data.episodes.length;
          else if (Array.isArray(data.shots)) contentLength = data.shots.length;
          return { ...ref, contentLength, isEmpty: contentLength < EMPTY_CONTENT_THRESHOLD };
        });
        const allEmpty = refsWithStatus.length > 0 && refsWithStatus.every((r) => r.isEmpty);
        const userText = prompt.trim()
          || (agentProxyType === 'script' ? '请基于上游节点内容生成剧本' : '请基于上游节点内容生成分镜');
        const nodeTitle = (agentProxyNode?.title as string)
          || (typeof agentProxyNode?.data === 'object' && agentProxyNode?.data
            ? (agentProxyNode.data as Record<string, unknown>).title as string
          : '') || '';
        if (allEmpty) {
          const labelList = refsWithStatus.map((r) => r.label).join('、');
          // Plan#79 T1.5：全空上游 → 注入 [全空标注] + 仍调 sendMessage（保消息流完整），LLM 秒回"请先填入"
          agentState.setDockOpen(true);
          agentState.setDockTab('chat');
          agentState.setFocusTarget({ kind: agentProxyType as 'script' | 'storyboard', nodeId, label: labelList || nodeId });
          agentState.addMessage({
            id: `msg_empty_${Date.now()}`,
            role: 'user',
            type: 'text',
            text: `${prompt.trim() || '请基于上游节点内容生成'} ${upstreamRefs.map((r) => `@${r.label}`).join(' ')}`.trim(),
            timestamp: Date.now(),
          });
          // 跳过常规 userText/refSuffix 构造，直接投递带全空标注的 prompt
          const emptyFinal = `[用户当前关注：${agentProxyType}${nodeTitle ? ` ${nodeTitle}` : ''}]\n\n${userText || prompt.trim()}\n[注意：当前无任何实质内容——上游节点均为空白，请直接告诉用户先填入内容再试，不要推理或编造]`;
          void sendMessage(emptyFinal, { taskType: 'canvas_agent', focusNodeId: nodeId });
          return; // 已处理，不走常规流程
        }
        // 部分空 → finalPrompt 注入空节点标注，仍走正常 LLM
        const emptyIds = refsWithStatus.filter((r) => r.isEmpty).map((r) => r.nodeId);

        // ① 打开 Agent 面板（未打开则打开 + 切到对话页签 + 声明关注点）
        agentState.setDockOpen(true);
        agentState.setDockTab('chat');
        agentState.setFocusTarget({ kind: agentProxyType as 'script' | 'storyboard', nodeId, label: nodeTitle || nodeId });

        // ② 用户气泡 = @上游节点 + 用户 dock 描述（只带节点名，不带正文）
        const mentionPrefix = upstreamRefs.map((r) => `@${r.label}`).join(' ');
        agentState.addMessage({
          id: `msg_user_${Date.now()}`,
          role: 'user',
          type: 'text',
          text: mentionPrefix ? `${mentionPrefix} ${userText}` : userText,
          timestamp: Date.now(),
        });

        // ③ 投递主管：引用清单带 assetId → 主管免猜测即可 read_asset_content 分段读取
        const refSuffix = upstreamRefs.length > 0
          ? `\n[用户 @ 引用的画布节点] ${upstreamRefs
            .map((r) => `${r.label}(id=${r.nodeId}${r.assetId ? `, assetId=${r.assetId}` : ''})`)
            .join('、')}`
          : '';
        const emptyMarker = emptyIds.length > 0 ? `\n[注意：以下节点当前为空，忽略其内容：${emptyIds.join(', ')}]` : '';
        const finalPrompt = `[用户当前关注：${agentProxyType}${nodeTitle ? ` ${nodeTitle}` : ''}]\n\n${userText}${refSuffix}${emptyMarker}`;
        void sendMessage(finalPrompt, { taskType: 'canvas_agent', focusNodeId: nodeId });
        return;
      }
      const provider = refs.aiProvider;
      if (!provider || !refs.commandQueue || !refs.store) return;
      const prevCtl = nodeAbortControllersRef.current.get(nodeId);
      if (prevCtl) prevCtl.abort();
      const ctl = new AbortController();
      nodeAbortControllersRef.current.set(nodeId, ctl);

      const nodeRec = refs.store.getGraph().nodes.find((n: any) => n.id === nodeId);
      const nodeData = (nodeRec?.data ?? {}) as Record<string, any>;

      const applyResult = (patch: Record<string, unknown>, mediaSize?: { width: number; height: number; fallbackWidth: number; fallbackHeight: number }): void => {
        const cq = refs.commandQueue;
        const storeNow = refs.store;
        if (!cq || !storeNow) return;
        cq.execute(new UpdateNodeDataCommand(nodeId, patch));
        if (!mediaSize) return;
        const { width, height, fallbackWidth, fallbackHeight } = mediaSize;
        if (!width || !height) return;
        const graph = storeNow.getGraph();
        const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
        if (!node) return;
        const currentWidth = node.size?.width ?? fallbackWidth;
        const ratio = height / width;
        const newHeight = Math.round(currentWidth * ratio);
        const oldRect = { x: node.position.x, y: node.position.y, width: node.size?.width ?? fallbackWidth, height: node.size?.height ?? fallbackHeight };
        cq.execute(new ResizeNodeCommand(nodeId, oldRect, { ...oldRect, height: newHeight }));
      };

      const modelValue = (nodeData?.model as string) ?? '';
      // 本机 H3ZeroExo：视频节点不经过外部 provider（否则没 API Key 就报「请先配置 API Key」）
      const isLocalVideoModel = modelValue === LOCAL_VIDEO_MODEL_KEY
        || modelValue.startsWith('zeroexo:')
        || (!modelValue && mode === 'video');
      const taskLabel = isLocalVideoModel ? LOCAL_VIDEO_MODEL_LABEL : (modelValue ? modelOptionLabel(aiConfig, modelValue) : undefined);
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, {
        prompt, status: 'loading', errorDetails: undefined, errorType: undefined, taskLabel,
      } as any));
      clearGeneratingPreview(nodeId);

      try {
        const { refImages, refVideos, refAudios, effectivePrompt } = await collectInputReferences(mentionedRefs, prompt);

        // 连线自动参考图收集
        {
          const graph = refs.store.getGraph();
          for (const edge of graph.edges) {
            if (edge.target?.nodeId !== nodeId) continue;
            const sourceNode = graph.nodes.find((n: any) => n.id === edge.source?.nodeId);
            if (!sourceNode) continue;
            if (sourceNode.type === 'stacked-media') {
              const cards = ((sourceNode.data as { cards?: Array<{ sourceType: string; data?: Record<string, unknown> }> })?.cards) ?? [];
              for (const card of cards) {
                if (card.sourceType !== 'image') continue;
                const cardData = card.data ?? {};
                const cardRaw = (cardData.content as string) || (typeof cardData.storageKey === 'string' ? getResourceUrl(cardData.storageKey, 'full') : undefined);
                if (!cardRaw) continue;
                try { const srcUrl = await contentToDataUrl(cardRaw); if (srcUrl && !refImages.includes(srcUrl)) refImages.push(srcUrl); } catch { /* skip */ }
              }
            } else if (sourceNode.type === 'image') {
              const srcData = sourceNode.data as Record<string, unknown> ?? {};
              const srcContent = (srcData.content as string) || (typeof srcData.storageKey === 'string' ? getResourceUrl(srcData.storageKey, 'full') : undefined);
              if (!srcContent) continue;
              try { const srcUrl = await contentToDataUrl(srcContent); if (srcUrl && !refImages.includes(srcUrl)) refImages.push(srcUrl); } catch { /* skip */ }
            }
          }
        }

        const { params, fallback } = buildTemplateParams(mode, nodeData as Record<string, unknown>);
        const inputRefs = formatInputRefs(mentionedRefs);

        if (mode === 'image') {
          const data = nodeData;
          const sizeStr = fallback.size ? `${fallback.size.width}x${fallback.size.height}` : undefined;
          const results = refImages.length > 0
            ? await provider.editImage({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', params, size: sizeStr, quality: fallback.quality!, count: fallback.count!, referenceImages: refImages, inputs: inputRefs, signal: ctl.signal })
            : await provider.generateImage({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', params, size: sizeStr, quality: fallback.quality!, count: fallback.count!, inputs: inputRefs, signal: ctl.signal });
          const first = results[0];
          if (!first) throw new Error(t('nodes.noImageReturned'));
          applyResult({ content: first.dataUrl, status: 'success', naturalWidth: first.width, naturalHeight: first.height, mimeType: first.mimeType, bytes: first.bytes, generationId: first.generationId, errorDetails: undefined, errorType: undefined } as any, { width: first.width, height: first.height, fallbackWidth: 340, fallbackHeight: 240 });
          // Plan#69: 产物已由后端自动落 Asset 素材库,事件仅通知抽屉刷新产出历史(不再传 blob/dataUrl)
          nodeActionBus.emit('canvas:history:created', {
            kind: 'image',
            title: promptTitleSummary(prompt) || nodeData?.title || '',
            assetId: first.assetId,
            generationId: first.generationId,
            prompt: effectivePrompt,
            nodeId,
          });
          // 本地版（2026-11-04）：无云端资产库 → 前端把产物经 CAS 落成项目资产（历史分组数据底座，失败静默）
          void autoLandGenerationOutput({
            nodeId, kind: 'image', title: promptTitleSummary(prompt) || (nodeData?.title as string) || '',
            content: first.dataUrl, width: first.width, height: first.height, bytes: first.bytes, mimeType: first.mimeType,
            jobId: first.generationId, model: (nodeData?.model as string) ?? undefined, prompt: effectivePrompt,
          }).catch((err) => console.warn('[history] 图片产出落库失败:', err));
        } else if (mode === 'text') {
          const data = nodeData;
          const text = await provider.generateText({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', referenceImages: refImages.length > 0 ? refImages : undefined, signal: ctl.signal });
          applyResult({ content: text, status: 'success', errorDetails: undefined, errorType: undefined } as any);
        } else if (mode === 'video') {
          const data = nodeData;
          const sizeStr = fallback.size ? `${fallback.size.width}x${fallback.size.height}` : undefined;
          // 本机链路：先用参考图垫底显示，随后被引擎推送的采样帧替换（首帧预览不空白）
          if (isLocalVideoModel && refImages.length > 0) setGeneratingPreview(nodeId, refImages[0]!);
          const result = isLocalVideoModel
            ? await generateLocalMiniMaxVideo({
                prompt: effectivePrompt,
                referenceImages: refImages.length > 0 ? refImages : undefined,
                size: sizeStr,
                seconds: fallback.seconds ?? 5,
                params,
                nodeId,
                onPreview: (frame) => {
                  if (frame.image) setGeneratingPreview(nodeId, frame.image);
                },
                signal: ctl.signal,
              }).catch((err: unknown) => {
                // 本机链路失败按网络错误呈现，不再归到「服务商/API Key」
                if (err instanceof Error && err.name === 'AbortError') throw err;
                throw new AiError('NETWORK_ERROR', err instanceof Error ? err.message : String(err));
              })
            : await provider.generateVideo({ prompt: effectivePrompt, model: (data?.model as string) ?? 'sora-2', params, size: sizeStr, seconds: fallback.seconds ?? 5, vquality: String(fallback.vquality ?? 5), generateAudio: fallback.generateAudio ?? true, watermark: false, returnLastFrame: params.returnLastFrame as boolean ?? true, referenceImages: refImages.length > 0 ? refImages : undefined, referenceVideos: refVideos.length > 0 ? refVideos : undefined, referenceAudios: refAudios.length > 0 ? refAudios : undefined, inputs: inputRefs, signal: ctl.signal });
          const url = URL.createObjectURL(result.blob);
          applyResult({ content: url, status: 'success', naturalWidth: result.width, naturalHeight: result.height, durationMs: result.durationMs, mimeType: result.mimeType, bytes: result.bytes, generationId: result.generationId, errorDetails: undefined, errorType: undefined } as any, { width: result.width, height: result.height, fallbackWidth: 420, fallbackHeight: 236 });
          // Plan#69: 产物已由后端自动落 Asset 素材库,事件仅通知抽屉刷新产出历史(不再传 blob URL)
          nodeActionBus.emit('canvas:history:created', {
            kind: 'video',
            title: promptTitleSummary(prompt) || nodeData?.title || '',
            assetId: result.assetId,
            generationId: result.generationId,
            prompt: effectivePrompt,
            nodeId,
            duration: result.durationMs,
          });
          // 本地版（2026-11-04）：无云端资产库 → 前端把产物经 CAS 落成项目资产（历史分组数据底座，失败静默）
          void autoLandGenerationOutput({
            nodeId, kind: 'video', title: promptTitleSummary(prompt) || (nodeData?.title as string) || '',
            content: url, width: result.width, height: result.height, durationMs: result.durationMs, bytes: result.bytes, mimeType: result.mimeType,
            jobId: result.generationId, model: (nodeData?.model as string) ?? undefined, prompt: effectivePrompt,
          }).catch((err) => console.warn('[history] 视频产出落库失败:', err));
          if (result.lastFrameUrl) {
            const graph = refs.store.getGraph();
            const videoNode = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
            if (videoNode) {
              const lastFrameId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const vSize = videoNode.size ?? { width: 420, height: 236 };
              refs.commandQueue.execute(new AddNodeCommand({ id: lastFrameId, type: 'image', position: { x: videoNode.position.x, y: videoNode.position.y + (vSize.height ?? 236) + 24 }, title: '尾帧', data: { content: result.lastFrameUrl, status: 'success', prompt: `${prompt}\n[尾帧]`, model: (data?.model as string) ?? '' } } as any));
            }
          }
        } else if (mode === 'audio') {
          const data = nodeData;
          const result = await provider.generateAudio({ prompt: effectivePrompt, model: (data?.model as string) ?? 'tts-1', params, voice: fallback.voice!, format: fallback.format!, speed: fallback.speed!, instructions: fallback.instructions, inputs: inputRefs, signal: ctl.signal });
          const url = URL.createObjectURL(result.blob);
          applyResult({ content: url, status: 'success', durationMs: result.durationMs, mimeType: result.mimeType, bytes: result.bytes, generationId: result.generationId, errorDetails: undefined, errorType: undefined } as any);
          // Plan#69: 产物已由后端自动落 Asset 素材库,事件仅通知抽屉刷新产出历史(不再传 blob URL)
          nodeActionBus.emit('canvas:history:created', {
            kind: 'audio',
            title: promptTitleSummary(prompt) || nodeData?.title || '',
            assetId: result.assetId,
            generationId: result.generationId,
            prompt: effectivePrompt,
            nodeId,
            duration: result.durationMs,
          });
        }

        const titleSummary = promptTitleSummary(prompt);
        if (titleSummary) refs.commandQueue.execute(new UpdateNodeTitleCommand(nodeId, titleSummary));
        nodeFailureCountRef.current.delete(nodeId);
      } catch (err) {
        if (ctl.signal.aborted) {
          refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, { status: 'idle', errorDetails: undefined, errorType: undefined } as any));
          return;
        }
        const errorType: AiErrorType = err instanceof AiError ? err.errorType : classifyError(err);
        const msg = err instanceof Error ? err.message : String(err);
        refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, { status: 'error', errorDetails: msg, errorType } as any));
      } finally {
        clearGeneratingPreview(nodeId);
        if (nodeAbortControllersRef.current.get(nodeId) === ctl) nodeAbortControllersRef.current.delete(nodeId);
      }
    },
    [refs.aiProvider, refs.commandQueue, refs.store, aiConfig, t],
  );

  /** 停止生成 */
  const handlePromptStop = useCallback((nodeId: string): void => {
    const ctl = nodeAbortControllersRef.current.get(nodeId);
    if (ctl) ctl.abort();
    if (refs.commandQueue) {
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, { status: 'idle' } as any));
    }
  }, [refs.commandQueue]);

  return {
    handleSaveNodeAsset,
    handleReversePrompt,
    handlePromptGenerate,
    handlePromptStop,
  };
}