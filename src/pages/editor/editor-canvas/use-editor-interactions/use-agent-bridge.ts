/**
 * use-agent-bridge - Agent 桥接操作
 *
 * 提取: AI 生成触发、保存节点资产、反向提示词等
 * 从 use-editor-interactions.ts 按功能域拆分
 */

import { useCallback, useEffect, useRef } from 'react';
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
import { nodeActionBus, setGeneratingPreview, clearGeneratingPreview, setGeneratingProgress, clearGeneratingProgress, fitMediaSize, type ReferenceItem } from '@zeroexo/plugin-nodes';
import { useTaskQueueStore } from '@/features/task-center/task-queue-store.js';
import { resolvePlacement } from '@zeroexo/core';
import { modelOptionLabel } from '@/features/ai-config/use-ai-config-store.js';
import { LOCAL_VIDEO_MODEL_KEY, LOCAL_VIDEO_MODEL_LABEL, LOCAL_IMAGE_MODEL_KEY, LOCAL_IMAGE_MODEL_LABEL, KREA2_MODEL_KEY, KREA2_MODEL_LABEL, MOSS_MODEL_KEY, MOSS_MODEL_LABEL } from '@/features/canvas-tabs/zeroexo-jobs-client.js';
import { cancelLocalJob, generateLocalMiniMaxVideo } from '../interactions/local-minimax-video.js';
import { generateLocalQwenImage } from '../interactions/local-qwen-image.js';
import { generateKrea2Image } from '../interactions/local-krea2-image.js';
import { generateMossImage } from '../interactions/local-moss-image.js';
import { canvasDocNodeKey, getCurrentCanvasDocId } from '@/shared/current-canvas-doc.js';
import { resolveMediaUrl } from '@/platform/media.js';
import { buildNodeAssetInput } from '@/features/asset-picker/services/upload-asset.js';
import { autoLandGenerationOutput } from '@/features/canvas-assets/history-autoland.js';
import { buildGenerationChain } from '@/features/sub-canvas/generation-chain.js';
import type { GenerationChainInput } from '@/features/sub-canvas/generation-chain.js';
import { buildTemplateParams, promptTitleSummary, collectInputReferences, compileReferenceImages, formatInputRefs, resolveLocalVideoRequest } from './use-ai-generation.js';
import { IMAGE_PROMPT_REVERSE_PRESET, contentToDataUrl, fitImageNodeSize, resolveRequestedImageSize } from './helpers.js';
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
/**
 * 生成结果命名（画布手动生成与 MCP 代理生成口径统一）：
 * 节点已有自定义标题就保留，否则用本次提示词摘要；摘要也不足时退到兜底名。
 */
function resolveGenerationTitle(
  nodeData: Record<string, unknown> | undefined,
  prompt: string,
  fallback = '',
): string {
  const prevSummary = promptTitleSummary(String(nodeData?.prompt ?? ''));
  const current = typeof nodeData?.title === 'string' ? nodeData.title : '';
  if (current && current !== prevSummary) return current;
  return promptTitleSummary(prompt) || current || fallback;
}

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

  /**
   * 刷新续接（2026-11-10 用户要求）：画布重开后，`status=loading` 且带 `localJob` 的节点
   * 用原 clientId 重新连 /ws（ComfyUI 按提交时的 sid 定向推送，所以能继续收到预览与步进），
   * 同时继续轮询作业状态，完成后把产物写回节点。
   */
  const resumedJobsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const store = refs.store;
    const queue = refs.commandQueue;
    if (!store || !queue) return;
    const scan = (): void => {
      for (const raw of store.getGraph().nodes) {
        const node = raw as NodeRecord;
        const data = (node.data ?? {}) as Record<string, unknown>;
        const job = data.localJob as { jobId?: string; clientId?: string; base?: string; kind?: string; model?: string } | undefined;
        if (!job?.jobId || !job.clientId) continue;
        const key = canvasDocNodeKey(node.id);
        if (resumedJobsRef.current.has(key)) continue;
        if (data.status !== 'loading') {
          // 作业已结束/被取消：清掉残留身份，避免下次刷新又接一次
          queue.execute(new UpdateNodeDataCommand(node.id, { localJob: undefined } as Record<string, unknown>));
          continue;
        }
        resumedJobsRef.current.add(key);
        const docId = getCurrentCanvasDocId();
        const pv = (data.paramValues ?? {}) as Record<string, unknown>;
        const nodeId = node.id;
        const finish = (patch: Record<string, unknown>): void => {
          queue.execute(new UpdateNodeDataCommand(nodeId, { ...patch, localJob: undefined } as Record<string, unknown>));
        };
        const onPreview = (url: string): void => setGeneratingPreview(nodeId, url, docId);
        const onStep = (p: { step: number; totalSteps: number }): void =>
          setGeneratingProgress(nodeId, { step: p.step, totalSteps: p.totalSteps }, docId);
        const fail = (err: unknown): void => {
          finish({
            status: 'error',
            errorDetails: err instanceof Error ? err.message : String(err),
            errorType: 'NETWORK_ERROR',
          });
        };
        const resume = { jobId: job.jobId, clientId: job.clientId };
        if (job.kind === 'video') {
          const localVideo = resolveLocalVideoRequest(data, {}, undefined, 5);
          void generateLocalMiniMaxVideo({
            prompt: String(data.prompt ?? ''),
            size: localVideo.size,
            seconds: localVideo.seconds,
            params: localVideo.params,
            nodeId,
            resume,
            onPreview: (frame) => {
              if (frame.image) onPreview(frame.image);
              if (frame.step != null || frame.totalSteps != null) onStep({ step: frame.step ?? 0, totalSteps: frame.totalSteps ?? 0 });
            },
            onProgress: (info) => setGeneratingProgress(nodeId, {
              phaseLabel: info.phaseLabel, overallValue: info.overallValue, overallMax: info.overallMax,
            }, docId),
          }).then((result) => {
            const url = URL.createObjectURL(result.blob);
            finish({
              content: url, status: 'success', naturalWidth: result.width, naturalHeight: result.height,
              durationMs: result.durationMs, mimeType: result.mimeType, bytes: result.bytes,
              generationId: result.generationId, guide: result.guide, errorDetails: undefined, errorType: undefined,
            });
            void autoLandGenerationOutput({
              nodeId, kind: 'video', title: (data.title as string) || '',
              content: url, width: result.width, height: result.height, durationMs: result.durationMs,
              bytes: result.bytes, mimeType: result.mimeType, jobId: result.generationId,
              model: (data.model as string) ?? undefined, prompt: String(data.prompt ?? ''), guide: result.guide,
              params: { ...localVideo.params, width: result.width, height: result.height },
              chain: buildGenerationChain(refs.store!.getGraph() as never, nodeId, {
                prompt: String(data.prompt ?? ''),
                model: (data.model as string) ?? undefined,
                params: { ...localVideo.params, width: result.width, height: result.height },
              }),
            }).catch(() => undefined);
          }).catch(fail);
        } else {
          const isKrea2 = job.model === KREA2_MODEL_KEY;
          const isMoss = job.model === MOSS_MODEL_KEY;
          const run = isMoss
            ? generateMossImage({
                prompt: String(data.prompt ?? ''), aspect: pv.aspect as string | undefined, params: pv,
                nodeId, resume, onPreview, onProgress: onStep,
              })
            : isKrea2
            ? generateKrea2Image({
                prompt: String(data.prompt ?? ''), aspect: pv.aspect as string | undefined, params: pv,
                nodeId, resume, onPreview, onProgress: onStep,
              })
            : generateLocalQwenImage({ prompt: String(data.prompt ?? ''), params: pv, nodeId, resume, onPreview, onProgress: onStep });
          void run.then((result) => {
            const url = URL.createObjectURL(result.blob);
            const resultPv = { ...pv, width: result.width, height: result.height, size: `${result.width}x${result.height}` };
            finish({
              content: url, status: 'success', naturalWidth: result.width, naturalHeight: result.height,
              mimeType: result.mimeType, bytes: result.bytes, generationId: result.generationId,
              title: promptTitleSummary(String(data.prompt ?? '')) || (data.title as string) || '',
              paramValues: resultPv,
              errorDetails: undefined, errorType: undefined,
            });
            void refs.persistence?.save().catch(() => undefined);
            void autoLandGenerationOutput({
              nodeId, kind: 'image', title: promptTitleSummary(String(data.prompt ?? '')) || (data.title as string) || '',
              content: url, width: result.width, height: result.height, bytes: result.bytes,
              mimeType: result.mimeType, jobId: result.generationId,
              model: isMoss ? MOSS_MODEL_KEY : isKrea2 ? KREA2_MODEL_KEY : LOCAL_IMAGE_MODEL_KEY, prompt: String(data.prompt ?? ''),
              params: resultPv,
              chain: buildGenerationChain(refs.store!.getGraph() as never, nodeId, {
                prompt: String(data.prompt ?? ''),
                model: isMoss ? MOSS_MODEL_KEY : isKrea2 ? KREA2_MODEL_KEY : LOCAL_IMAGE_MODEL_KEY,
                params: resultPv,
              }),
            }).then((landed) => {
              if (landed?.storageKey) {
                finish({ storageKey: landed.storageKey } as Record<string, unknown>);
                void refs.persistence?.save().catch(() => undefined);
              }
            }).catch(() => undefined);
          }).catch(fail);
        }
      }
    };
    scan();
    // 图可能异步装载：后续每次图变化都再扫一遍（resumedJobsRef 防重复）
    const unsub = store.subscribeGraph(scan);
    return () => { unsub?.(); };
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
      existingNodes: refs.store!.getGraph().nodes.filter((n: any) => !n._deleted),
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

      // 2026-11-18 用户口径（同级副本生成，非下游链式）：
      // 节点已有结果时点「生成」= 在**正下方**新建一个同级节点，拷贝当前节点的提示词/参数/
      // 内联参考图，并把「当前节点的上游输入边」原样复制到新节点，再由新节点发起生成。
      // 绝不建「当前节点 → 新节点」的下游边：那是编辑链路，用户要的是同参数再生成一份。
      if (mode !== 'text') {
        const target = refs.store!.getGraph().nodes.find((n: any) => n.id === nodeId) as NodeRecord | undefined;
        const tdata = (target?.data ?? {}) as Record<string, any>;
        const hasResult = Boolean(tdata.storageKey) || (typeof tdata.content === 'string' && tdata.content !== '' && tdata.status === 'success');
        if (target && hasResult) {
          const newNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const size = { width: target.size?.width ?? 340, height: target.size?.height ?? 260 };
          const graphNodes = refs.store!.getGraph().nodes.filter((n: any) => !n._deleted) as Array<{
            id?: string; position?: { x: number; y: number }; size?: { width?: number; height?: number };
          }>;
          const collides = (x: number, y: number): boolean => graphNodes.some((n) => {
            const nx = n.position?.x ?? 0;
            const ny = n.position?.y ?? 0;
            const nw = n.size?.width ?? 240;
            const nh = n.size?.height ?? 200;
            return x < nx + nw + 24 && x + size.width + 24 > nx && y < ny + nh + 24 && y + size.height + 24 > ny;
          });
          let px = target.position.x;
          let py = target.position.y + (target.size?.height ?? 260) + 48;
          for (let i = 0; i < 12 && collides(px, py); i += 1) py += size.height + 48;
          const inherited: Record<string, unknown> = { ...tdata };
          for (const k of ['content', 'storageKey', 'naturalWidth', 'naturalHeight', 'bytes', 'mimeType', 'durationMs', 'generationId', 'guide', 'localJob', 'errorDetails', 'errorType']) delete inherited[k];
          inherited.status = 'idle';
          // 参数要连尺寸一起继承：源节点可能只存了产物、paramValues 里没有显式 width/height，
          // 此时用产物真实宽高补齐，避免新节点再落到展示框尺寸（348→352 的事故）。
          const inheritedPv = { ...((tdata.paramValues ?? {}) as Record<string, unknown>) };
          const sourceOutW = Number(tdata.naturalWidth);
          const sourceOutH = Number(tdata.naturalHeight);
          const hasExplicitSize = Number(inheritedPv.width) > 0 && Number(inheritedPv.height) > 0;
          if (!hasExplicitSize && sourceOutW > 0 && sourceOutH > 0) {
            inheritedPv.width = sourceOutW;
            inheritedPv.height = sourceOutH;
            inheritedPv.size = `${sourceOutW}x${sourceOutH}`;
            if (typeof inheritedPv.sizeMode !== 'string') inheritedPv.sizeMode = 'custom';
          }
          inherited.paramValues = inheritedPv;
          refs.commandQueue.execute(new AddNodeCommand({
            id: newNodeId,
            type: target.type,
            position: { x: px, y: py },
            size,
            data: inherited,
          } as never));
          // 复制上游输入边（参考图/参考视频）到新节点，而不是把当前节点接成下游
          const upstreamEdges = (refs.store!.getGraph().edges as unknown as Array<{
            source: { nodeId: string; pinId?: string };
            target: { nodeId: string; pinId?: string };
            _deleted?: boolean;
          }>).filter((e) => !e._deleted && e.target?.nodeId === nodeId);
          upstreamEdges.forEach((e, index) => {
            refs.commandQueue!.execute(new AddEdgeCommand({
              id: `edge-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
              source: { nodeId: e.source.nodeId, pinId: e.source.pinId ?? 'output' },
              target: { nodeId: newNodeId, pinId: e.target.pinId ?? 'prompt' },
            }));
          });
          refs.store.setSelection({ selectedNodeIds: new Set([newNodeId]), selectedEdgeIds: new Set() });
          // 新节点没有结果，第二轮按普通流程原地生成；参考输入已由复制过来的上游边带上
          void handlePromptGenerate(newNodeId, mode, prompt, mentionedRefs);
          return;
        }
      }
      // 生成任务归属在发起时固化：之后切画布文档（主↔副本）不得把状态/预览写进另一份文档
      const jobDocId = getCurrentCanvasDocId();
      const jobKey = canvasDocNodeKey(nodeId, jobDocId);
      const prevCtl = nodeAbortControllersRef.current.get(jobKey);
      if (prevCtl) prevCtl.abort();
      const ctl = new AbortController();
      nodeAbortControllersRef.current.set(jobKey, ctl);

      const nodeRec = refs.store!.getGraph().nodes.find((n: any) => n.id === nodeId);
      const nodeData = (nodeRec?.data ?? {}) as Record<string, any>;

      const applyResult = (patch: Record<string, unknown>, mediaSize?: { width: number; height: number; fallbackWidth: number; fallbackHeight: number }): void => {
        const cq = refs.commandQueue;
        const storeNow = refs.store;
        if (!cq || !storeNow) return;
        // 文档已切走：结果只留历史资产，不得回写当前（另一份）画布的同 id 节点
        if (getCurrentCanvasDocId() !== jobDocId) return;
        cq.execute(new UpdateNodeDataCommand(nodeId, patch));
        if (!mediaSize) return;
        const { width, height, fallbackWidth, fallbackHeight } = mediaSize;
        if (!width || !height) return;
        const graph = storeNow.getGraph();
        const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
        if (!node) return;
        const currentWidth = node.size?.width ?? fallbackWidth;
        const ratio = height / width;
        const oldRect = { x: node.position.x, y: node.position.y, width: node.size?.width ?? fallbackWidth, height: node.size?.height ?? fallbackHeight };
        if (mode === 'image') {
          // 图片：宽高同时按原图比例重算（Krea2/Qwen 返回后不能再停在旧比例，否则 contain 出黑边）
          const fitted = fitImageNodeSize(currentWidth, width, height);
          cq.execute(new ResizeNodeCommand(nodeId, oldRect, { ...oldRect, ...fitted }));
          return;
        }
        const newHeight = Math.round(currentWidth * ratio);
        cq.execute(new ResizeNodeCommand(nodeId, oldRect, { ...oldRect, height: newHeight }));
      };

      const modelValue = (nodeData?.model as string) ?? '';
      // 本机 H3ZeroExo：视频节点不经过外部 provider（否则没 API Key 就报「请先配置 API Key」）
      const isLocalVideoModel = mode === 'video' && (modelValue === LOCAL_VIDEO_MODEL_KEY
        || modelValue.startsWith('zeroexo:minimax')
        || (!modelValue && mode === 'video'));
      const isLocalImageModel = mode === 'image' && (modelValue === LOCAL_IMAGE_MODEL_KEY
        || modelValue.startsWith('zeroexo:qwen')
        // 没有模型值时按本机链路走：本项目没有云端图片渠道，落到 provider 只会报「请求失败」
        || (!modelValue && mode === 'image'));
      // Krea2 只有线上 ComfyUI 有底模 + RES4LYF 采样器
      const isKrea2Model = mode === 'image' && modelValue === KREA2_MODEL_KEY;
      const isMossModel = mode === 'image' && modelValue === MOSS_MODEL_KEY;
      const taskLabel = isLocalVideoModel ? LOCAL_VIDEO_MODEL_LABEL
        : isMossModel ? MOSS_MODEL_LABEL
        : isKrea2Model ? KREA2_MODEL_LABEL
          : isLocalImageModel ? LOCAL_IMAGE_MODEL_LABEL
            : (modelValue ? modelOptionLabel(aiConfig, modelValue) : undefined);
      refs.commandQueue.execute(new UpdateNodeDataCommand(nodeId, {
        prompt, status: 'loading', errorDetails: undefined, errorType: undefined, taskLabel,
      } as any));
      clearGeneratingPreview(nodeId, jobDocId);
      clearGeneratingProgress(nodeId, jobDocId);
      // 右下角任务队列（2026-11-10）：画布发起的生成统一登记
      const taskQueue = useTaskQueueStore.getState();
      const taskTitle = promptTitleSummary(prompt) || String(nodeData?.title ?? '') || t('taskQueue.untitled', '未命名任务');
      // 结果命名：节点已有自定义标题（人工起的名字，如「女主-三视图」）就沿用，
      // 只有「没有标题」或「标题还是上次的提示词摘要」时才用本次提示词摘要，避免生成一次把名字冲掉。
      const generationTitle = resolveGenerationTitle(nodeData, prompt, t('taskQueue.untitled', '未命名任务'));
      taskQueue.start({ id: jobKey, kind: mode, title: taskTitle });

      // 参数一确定比例就定了：发起前先把节点改成目标比例，生成中预览不会按旧比例裁切/留黑边
      if (mode === 'image') {
        const target = resolveRequestedImageSize(nodeData?.paramValues as Record<string, unknown>, {
          // 节点框尺寸不参与生图比例：有产物按产物真实宽高，没有产物按面板默认 4:3（1024×768）。
          width: Number(nodeData?.naturalWidth) || 1024,
          height: Number(nodeData?.naturalHeight) || 768,
        });
        const curW = Number(nodeData?.width) || 0;
        const curH = Number(nodeData?.height) || 0;
        if (curW > 0 && curH > 0 && Math.abs(curW / curH - target.width / target.height) > 0.02) {
          const fit = fitMediaSize(target.width, target.height);
          const x = Number(nodeData?.x) || 0;
          const y = Number(nodeData?.y) || 0;
          refs.commandQueue.execute(new ResizeNodeCommand(
            nodeId,
            { x, y, width: curW, height: curH },
            { x, y, width: fit.width, height: fit.height },
          ));
        }
      }

      try {
        const { refImages, refVideos, refAudios, effectivePrompt } = await collectInputReferences(mentionedRefs, prompt);
        // 首个连入的图片节点 = 本次生成的参考来源，落库时记进 generation，供「查看提示词」还原链路
        let chainSourceNodeId: string | undefined;
        let chainSourceStorageKey: string | undefined;
        // 本次真正提交的输入槽位（1 = @图片1）：顺序与 refImages 一致，历史链据此精确还原上游
        const refInputs: GenerationChainInput[] = [];

        // 连线自动参考图收集
        {
          const graph = refs.store!.getGraph();
          for (const edge of graph.edges) {
            if (edge.target?.nodeId !== nodeId) continue;
            const sourceNode = graph.nodes.find((n: any) => n.id === edge.source?.nodeId);
            if (!sourceNode) continue;
            if (sourceNode.type === 'stacked-media') {
              const cards = ((sourceNode.data as { cards?: Array<{ sourceType: string; data?: Record<string, unknown> }> })?.cards) ?? [];
              for (const card of cards) {
                if (card.sourceType !== 'image') continue;
                const cardData = card.data ?? {};
                const key = typeof cardData.storageKey === 'string' ? cardData.storageKey : '';
                const keyUrl = key ? await resolveMediaUrl(key).catch(() => '') : '';
                const candidates = [keyUrl, cardData.content as string].filter(Boolean) as string[];
                for (const candidate of candidates) {
                  try {
                    const srcUrl = await contentToDataUrl(candidate);
                    if (srcUrl && !refImages.includes(srcUrl)) {
                      refImages.push(srcUrl);
                      refInputs.push({ slot: refImages.length, nodeId: sourceNode.id, storageKey: key || undefined });
                      break;
                    }
                  } catch { /* skip */ }
                }
              }
            } else if (sourceNode.type === 'image') {
              const srcData = sourceNode.data as Record<string, unknown> ?? {};
              const key = typeof srcData.storageKey === 'string' ? srcData.storageKey : '';
              const keyUrl = key ? await resolveMediaUrl(key).catch(() => '') : '';
              const candidates = [keyUrl, srcData.content as string].filter(Boolean) as string[];
              for (const candidate of candidates) {
                try {
                  const srcUrl = await contentToDataUrl(candidate);
                  if (srcUrl && !refImages.includes(srcUrl)) {
                    refImages.push(srcUrl);
                    refInputs.push({ slot: refImages.length, nodeId: sourceNode.id, storageKey: key || undefined });
                    if (!chainSourceNodeId) { chainSourceNodeId = sourceNode.id; chainSourceStorageKey = key || undefined; }
                    break;
                  }
                } catch { /* skip */ }
              }
            }
          }
        }

        const { params, fallback } = buildTemplateParams(mode, nodeData as Record<string, unknown>);
        const inputRefs = formatInputRefs(mentionedRefs);

        if (mode === 'image') {
          const data = nodeData;
          const sizeStr = fallback.size ? `${fallback.size.width}x${fallback.size.height}` : undefined;
          if (isLocalImageModel || isKrea2Model || isMossModel) {
            const pv = (nodeData.paramValues ?? {}) as Record<string, unknown>;
            const modelKey = isMossModel ? MOSS_MODEL_KEY : isKrea2Model ? KREA2_MODEL_KEY : LOCAL_IMAGE_MODEL_KEY;
            // 发起阶段统一编译一次可用输入：按槽位顺序去重、按模型能力截断。
            // 连线不拦（画布允许自由连），但真正提交时必须是一次编译后的稳定顺序；
            // krea2 / moss 是纯文生图，参考图不参与，编译结果为空，不会出现「传了但模型没看到」的错觉。
            const compiled = compileReferenceImages(refImages, isLocalImageModel ? 16 : 0);
            if (compiled.skipped > 0) {
              // 有被丢掉的输入就记在节点上，供「查看提示词」溯源看到真实提交情况
              refs.commandQueue?.execute(new UpdateNodeDataCommand(nodeId, {
                inputReport: { used: compiled.images.length, skipped: compiled.skipped, model: modelKey },
              } as Record<string, unknown>));
            }
            // 用户实测 2026-11-17：选了 1:1 却出宽幅图 → 本地链路拿的是 nodeData.width/height（旧值），
            // 必须先把参数面板里的 size / aspect 换算成真实提交尺寸，再交给生成器。
            // 2026-11-18：节点框尺寸（如 348×348 展示框）绝不能再当出图尺寸；
            // 无显式参数时：有产物按产物真实宽高，没有产物按面板默认 4:3（1024×768）。
            const outputW = Number(nodeData.naturalWidth);
            const outputH = Number(nodeData.naturalHeight);
            const sizeFallback = outputW > 0 && outputH > 0
              ? { width: outputW, height: outputH }
              : { width: 1024, height: 768 };
            const reqSize = resolveRequestedImageSize(pv, sizeFallback);
            // 本机链路：先用参考图垫底显示，随后被 ComfyUI 推送的采样预览帧替换（首帧不空白）
            if (isLocalImageModel && refImages.length > 0) setGeneratingPreview(nodeId, refImages[0]!, jobDocId);
            // 作业身份写进节点：刷新后据此续接预览/进度（否则刷新即丢）
            const persistJob = (job: { jobId: string; clientId: string; base: string }): void => {
              refs.commandQueue?.execute(new UpdateNodeDataCommand(nodeId, {
                localJob: { ...job, kind: 'image', model: modelKey, startedAt: Date.now() },
              } as Record<string, unknown>));
            };
            const callbacks = {
              nodeId,
              onPreview: (dataUrl: string) => setGeneratingPreview(nodeId, dataUrl, jobDocId),
              onProgress: (p: { step: number; totalSteps: number }) => {
                setGeneratingProgress(nodeId, { step: p.step, totalSteps: p.totalSteps }, jobDocId);
                useTaskQueueStore.getState().update(jobKey, { progress: { step: p.step, totalSteps: p.totalSteps } });
              },
              onJobSubmitted: persistJob,
              signal: ctl.signal,
            };
            const runLocal = () => (isMossModel
              ? generateMossImage({ prompt: effectivePrompt, aspect: pv.aspect as string | undefined, params: pv, ...callbacks })
              : isKrea2Model
              ? generateKrea2Image({ prompt: effectivePrompt, aspect: pv.aspect as string | undefined, params: pv, ...callbacks })
              : generateLocalQwenImage({
                  prompt: effectivePrompt,
                  referenceImages: compiled.images.length > 0 ? compiled.images : undefined,
                  width: reqSize.width,
                  height: reqSize.height,
                  params: pv,
                  ...callbacks,
                })
            );
            // 2026-11-17 用户实测「图生图要点一次重试才生效」：首次点击失败多为空闲连接被网关关掉
            // （浏览器对 POST 不重试）。这里对网络类失败自动重试一次，用户点一次就能出图。
            const result = await runLocal().catch(async (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              if (err instanceof Error && err.name === 'AbortError') throw err;
              if (!/failed to fetch|network|load failed|fetch failed/i.test(msg)) throw err;
              await new Promise((r) => setTimeout(r, 800));
              return runLocal();
            }).catch((err: unknown) => {
              if (err instanceof Error && err.name === 'AbortError') throw err;
              throw new AiError('NETWORK_ERROR', err instanceof Error ? err.message : String(err));
            });
            const url = URL.createObjectURL(result.blob);
            // 出图完成把真实尺寸回写 paramValues：面板显示与下一次生成都以这次结果为准，
            // 不再出现「面板 4:3、实际 1:1」或「再点一次又变尺寸」。
            const resultPv = {
              ...((nodeData.paramValues ?? {}) as Record<string, unknown>),
              width: result.width,
              height: result.height,
              size: `${result.width}x${result.height}`,
            };
            applyResult({
              content: url, status: 'success',
              naturalWidth: result.width, naturalHeight: result.height,
              title: generationTitle,
              mimeType: result.mimeType, bytes: result.bytes, generationId: result.generationId,
              errorDetails: undefined, errorType: undefined, localJob: undefined,
              paramValues: resultPv,
            } as any, { width: result.width, height: result.height, fallbackWidth: 340, fallbackHeight: 240 });
            // 生成结果立即落盘：刷新发生在防抖保存前也不会丢掉节点新图
            void refs.persistence?.save().catch(() => undefined);
            nodeActionBus.emit('canvas:history:created', {
              kind: 'image',
              title: generationTitle,
              generationId: result.generationId,
              prompt: effectivePrompt,
              nodeId,
            });
            void autoLandGenerationOutput({
              nodeId, kind: 'image', title: generationTitle,
              content: url, width: result.width, height: result.height, bytes: result.bytes, mimeType: result.mimeType,
              jobId: result.generationId, model: modelKey, prompt: effectivePrompt,
              sourceNodeId: chainSourceNodeId, sourceStorageKey: chainSourceStorageKey,
              params: { ...resultPv },
              chain: buildGenerationChain(refs.store!.getGraph() as never, nodeId, {
                prompt: effectivePrompt,
                model: modelKey,
                params: { ...resultPv },
                inputs: refInputs,
              }),
            }).then((landed) => {
              if (landed?.storageKey) {
                applyResult({ storageKey: landed.storageKey } as Record<string, unknown>);
                void refs.persistence?.save().catch(() => undefined);
              }
            }).catch((err) => console.warn('[history] 图片产出落库失败:', err));
            return;
          }
          const results = refImages.length > 0
            ? await provider.editImage({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', params, size: sizeStr, quality: fallback.quality!, count: fallback.count!, referenceImages: refImages, inputs: inputRefs, signal: ctl.signal })
            : await provider.generateImage({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', params, size: sizeStr, quality: fallback.quality!, count: fallback.count!, inputs: inputRefs, signal: ctl.signal });
          const first = results[0];
          if (!first) throw new Error(t('nodes.noImageReturned'));
          applyResult({ content: first.dataUrl, status: 'success', naturalWidth: first.width, naturalHeight: first.height, mimeType: first.mimeType, bytes: first.bytes, generationId: first.generationId, errorDetails: undefined, errorType: undefined } as any, { width: first.width, height: first.height, fallbackWidth: 340, fallbackHeight: 240 });
          // Plan#69: 产物已由后端自动落 Asset 素材库,事件仅通知抽屉刷新产出历史(不再传 blob/dataUrl)
          nodeActionBus.emit('canvas:history:created', {
            kind: 'image',
            title: generationTitle,
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
            params: { ...(nodeData?.paramValues as Record<string, unknown> ?? {}), width: first.width, height: first.height },
            chain: buildGenerationChain(refs.store!.getGraph() as never, nodeId, {
              prompt: effectivePrompt,
              model: (nodeData?.model as string) ?? undefined,
              params: { ...(nodeData?.paramValues as Record<string, unknown> ?? {}), width: first.width, height: first.height },
            }),
          }).then((landed) => {
            // 写回 CAS storageKey：刷新后节点仍能按 key 重新解析图片（否则只剩会话级 dataURL）
            if (landed?.storageKey) applyResult({ storageKey: landed.storageKey } as Record<string, unknown>);
          }).catch((err) => console.warn('[history] 图片产出落库失败:', err));
        } else if (mode === 'text') {
          const data = nodeData;
          const text = await provider.generateText({ prompt: effectivePrompt, model: (data?.model as string) ?? 'gpt-4o', referenceImages: refImages.length > 0 ? refImages : undefined, signal: ctl.signal });
          applyResult({ content: text, status: 'success', errorDetails: undefined, errorType: undefined } as any);
        } else if (mode === 'video') {
          const data = nodeData;
          // 本机 H3 参数面板把比例/系数/尺寸/步数/种子/时长写在 paramValues，
          // 模板参数只有 1024×1024 兜底 → 不合并会恒生成 1:1 并丢参数。
          const localVideo = isLocalVideoModel
            ? resolveLocalVideoRequest(nodeData as Record<string, unknown>, params, fallback.size, fallback.seconds ?? 5)
            : null;
          const sizeStr = localVideo?.size ?? (fallback.size ? `${fallback.size.width}x${fallback.size.height}` : undefined);
          // 本机链路：先用参考图垫底显示，随后被引擎推送的采样帧替换（首帧预览不空白）
          if (isLocalVideoModel && refImages.length > 0) setGeneratingPreview(nodeId, refImages[0]!, jobDocId);
          const result = isLocalVideoModel
            ? await generateLocalMiniMaxVideo({
                prompt: effectivePrompt,
                referenceImages: refImages.length > 0 ? refImages : undefined,
                size: sizeStr,
                seconds: localVideo?.seconds ?? fallback.seconds ?? 5,
                params: localVideo?.params ?? params,
                nodeId,
                onPreview: (frame) => {
                  if (frame.image) setGeneratingPreview(nodeId, frame.image, jobDocId);
                  if (frame.step != null || frame.totalSteps != null) {
                    setGeneratingProgress(nodeId, { step: frame.step, totalSteps: frame.totalSteps }, jobDocId);
                  }
                },
                onProgress: (info) => {
                  setGeneratingProgress(nodeId, {
                    phaseLabel: info.phaseLabel,
                    overallValue: info.overallValue,
                    overallMax: info.overallMax,
                  }, jobDocId);
                  // 导演台式总进度 → 队列里显示阶段文案
                  if (info.phaseLabel || info.overallMax) {
                    useTaskQueueStore.getState().update(jobKey, {
                      phase: info.phaseLabel,
                      ...(info.overallMax && info.overallValue !== undefined
                        ? { progress: { step: info.overallValue, totalSteps: info.overallMax } }
                        : {}),
                    });
                  }
                },
                // 作业身份写进节点：刷新后据此续接预览/进度（否则刷新即丢）
                onJobSubmitted: (job) => {
                  refs.commandQueue?.execute(new UpdateNodeDataCommand(nodeId, {
                    localJob: { ...job, kind: 'video', model: LOCAL_VIDEO_MODEL_KEY, startedAt: Date.now() },
                  } as Record<string, unknown>));
                },
                signal: ctl.signal,
              }).catch((err: unknown) => {
                // 本机链路失败按网络错误呈现，不再归到「服务商/API Key」
                if (err instanceof Error && err.name === 'AbortError') throw err;
                throw new AiError('NETWORK_ERROR', err instanceof Error ? err.message : String(err));
              })
            : await provider.generateVideo({ prompt: effectivePrompt, model: (data?.model as string) ?? 'sora-2', params, size: sizeStr, seconds: fallback.seconds ?? 5, vquality: String(fallback.vquality ?? 5), generateAudio: fallback.generateAudio ?? true, watermark: false, returnLastFrame: params.returnLastFrame as boolean ?? true, referenceImages: refImages.length > 0 ? refImages : undefined, referenceVideos: refVideos.length > 0 ? refVideos : undefined, referenceAudios: refAudios.length > 0 ? refAudios : undefined, inputs: inputRefs, signal: ctl.signal });
          const url = URL.createObjectURL(result.blob);
          // 本机链路带 guide；外部渠道 provider 结果无此字段（union 收窄）
          const resultGuide = (result as { guide?: { id: string; path?: string; frames?: number; sha256?: string } }).guide;
          const guideMeta = resultGuide
            ? { id: resultGuide.id, path: resultGuide.path, frames: resultGuide.frames, sha256: resultGuide.sha256 }
            : undefined;
          applyResult({ content: url, status: 'success', naturalWidth: result.width, naturalHeight: result.height, durationMs: result.durationMs, mimeType: result.mimeType, bytes: result.bytes, generationId: result.generationId, guide: guideMeta, errorDetails: undefined, errorType: undefined, localJob: undefined } as any, { width: result.width, height: result.height, fallbackWidth: 420, fallbackHeight: 236 });
          // Plan#69: 产物已由后端自动落 Asset 素材库,事件仅通知抽屉刷新产出历史(不再传 blob URL)
          nodeActionBus.emit('canvas:history:created', {
            kind: 'video',
            title: generationTitle,
            assetId: result.assetId,
            generationId: result.generationId,
            prompt: effectivePrompt,
            nodeId,
            duration: result.durationMs,
          });
          // 本地版（2026-11-04）：无云端资产库 → 前端把产物经 CAS 落成项目资产（历史分组数据底座，失败静默）
          void autoLandGenerationOutput({
            nodeId, kind: 'video', title: generationTitle,
            content: url, width: result.width, height: result.height, durationMs: result.durationMs, bytes: result.bytes, mimeType: result.mimeType,
            jobId: result.generationId, model: (nodeData?.model as string) ?? undefined, prompt: effectivePrompt,
            guide: guideMeta,
            params: { ...(nodeData?.paramValues as Record<string, unknown> ?? {}), width: result.width, height: result.height },
            chain: buildGenerationChain(refs.store!.getGraph() as never, nodeId, {
              prompt: effectivePrompt,
              model: (nodeData?.model as string) ?? undefined,
              params: { ...(nodeData?.paramValues as Record<string, unknown> ?? {}), width: result.width, height: result.height },
            }),
          }).then((landed) => {
            // 写回 CAS storageKey：刷新后节点仍能按 key 重新解析/下载视频（否则只剩会话级 blob 地址）
            if (landed?.storageKey) applyResult({ storageKey: landed.storageKey } as Record<string, unknown>);
            // 引导已缓存到本地（media/guides）：把 localKey 写回节点，云端清盘后仍可下载/发送
            if (landed?.guide) applyResult({ guide: landed.guide } as Record<string, unknown>);
          }).catch((err) => console.warn('[history] 视频产出落库失败:', err));
          if (result.lastFrameUrl) {
            const graph = refs.store!.getGraph();
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
            title: generationTitle,
            assetId: result.assetId,
            generationId: result.generationId,
            prompt: effectivePrompt,
            nodeId,
            duration: result.durationMs,
          });
        }

        // 只在标题还不是这个名字时才改名：人工起的名字（如「女主-三视图」）生成后保持不动
        const currentTitle = String(nodeData?.title ?? '');
        if (generationTitle && generationTitle !== currentTitle) {
          refs.commandQueue.execute(new UpdateNodeTitleCommand(nodeId, generationTitle));
        }
        nodeFailureCountRef.current.delete(nodeId);
        useTaskQueueStore.getState().finish(jobKey, 'success');
      } catch (err) {
        // 文档已切走：不要把「已失败/已取消」写到当前另一份画布的同 id 节点上
        if (getCurrentCanvasDocId() !== jobDocId) return;
        if (ctl.signal.aborted) {
          useTaskQueueStore.getState().finish(jobKey, 'cancelled');
          refs.commandQueue?.execute(new UpdateNodeDataCommand(nodeId, { status: 'idle', errorDetails: undefined, errorType: undefined, localJob: undefined } as never));
          return;
        }
        const errorType: AiErrorType = err instanceof AiError ? err.errorType : classifyError(err);
        const msg = err instanceof Error ? err.message : String(err);
        useTaskQueueStore.getState().finish(jobKey, 'error', msg);
        refs.commandQueue?.execute(new UpdateNodeDataCommand(nodeId, { status: 'error', errorDetails: msg, errorType, localJob: undefined } as never));
      } finally {
        clearGeneratingPreview(nodeId, jobDocId);
        if (nodeAbortControllersRef.current.get(jobKey) === ctl) nodeAbortControllersRef.current.delete(jobKey);
      }
    },
    [refs.aiProvider, refs.commandQueue, refs.store, aiConfig, t],
  );

  /** 停止生成 */
  const handlePromptStop = useCallback((nodeId: string): void => {
    // 本机作业：立即发 /zeroexo/v1/jobs/{id}/cancel，不等 abort 传播（ComfyUI 侧要马上停）
    void cancelLocalJob(nodeId);
    const ctl = nodeAbortControllersRef.current.get(canvasDocNodeKey(nodeId));
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