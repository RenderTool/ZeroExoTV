/**
 * use-storyboard - 分镜生成相关逻辑
 *
 * runAiStoryboard 核心函数
 */

import { useCallback } from 'react';
import { UpdateNodeDataCommand, type Command } from '@zeroexo/core';
import { normalizeShotForUi } from '@/features/canvas-nodes/storyboard/storyboard-utils.js';
// 本地版（Plan#83）：分镜生成属 LLM 任务，按产品定义不再由前端发起（由外部编码工具经 MCP 完成）。
import type { AgentTaskHandlers } from '../agent-client-types.js';
// 保留同名局部变量使模块可加载；调用即抛错，不伪造分镜。
const agentClient = {
  send: async (_task: string, _payload?: unknown, _ctx?: unknown): Promise<{ taskId: string }> => {
    throw new Error('本地版无内置 LLM 链路：分镜生成请经外部工具（MCP）写入 storyboard/EPxx.json');
  },
  cancelTask: async (_taskId: string): Promise<void> => {},
  subscribe: (_taskId: string, _handlers: AgentTaskHandlers): void => {},
  unsubscribe: (): void => {},
};
const appendThinkDelta = (..._args: unknown[]): void => {};
const ensureConversation = async (..._args: unknown[]): Promise<string> => '';
const getSessionProjectId = (): string | null => null;
const useCanvasAgentStore = { getState: (): Record<string, any> => ({ setThinking: () => {}, setIsGenerating: () => {}, setDockOpen: () => {}, setDockTab: () => {}, clearAgentUnread: () => {}, setCurrentPlan: () => {}, setTodoSnapshot: () => {}, setCurrentTaskId: () => {}, setPhase: () => {}, addMessage: () => {} }) };
import i18n from '@/i18n/config';
import { htmlToPlainText } from './helpers.js';
import type { StoryboardHookParams } from './types.js';

/**
 * 运行 AI 分镜生成 - 核心入口
 * 暴露给外层 useEditorInteractions 调用
 */
export function useStoryboardHooks(
  params: StoryboardHookParams,
  nodeAbortControllersRef: React.MutableRefObject<Map<string, Map<string, { taskId: string }>>>,
  cancelledStoryboardsRef: React.MutableRefObject<Set<string>>,
) {
  const { refs, t, message } = params;

  const runAiStoryboard = useCallback(
    (
      _store: any,
      q: { execute: (cmd: Command) => void; getState: () => { nodes: Array<any> } },
      scriptNode: any,
      storyboardId: string,
      episodeId?: string,
      _createSubjects?: boolean,
      _autoExtractSubjects = true,
    ) => {
      const scriptData = (scriptNode.data ?? {}) as { episodes?: Array<{ id: string; content?: string }>; activeEpisodeId?: string };
      const episodes = scriptData.episodes ?? [];
      const resolvedEpisodeId = episodeId || (scriptData.activeEpisodeId ?? '') || undefined;
      const targetEp = episodes.find((e) => e.id === resolvedEpisodeId) ?? episodes.find((e) => e.id === scriptData.activeEpisodeId) ?? episodes[0];
      const scriptText = htmlToPlainText(targetEp?.content ?? '');
      const epKey = resolvedEpisodeId ?? targetEp?.id ?? '_legacy';

      // 读-改-写:UpdateNodeDataCommand 是浅合并
      const setEpData = (patch: { shotsByEpisode?: unknown; statusByEpisode?: unknown; progressByEpisode?: unknown }) => {
        const graph = q.getState();
        const node = graph.nodes.find((n: any) => n.id === storyboardId);
        const cur = (node?.data ?? {}) as Record<string, unknown>;
        const base: Record<string, unknown> = { sourceScriptId: scriptNode.id };
        if (episodeId) base.activeEpisodeId = episodeId;
        const merged: Record<string, unknown> = { ...base };
        if (patch.shotsByEpisode !== undefined) {
          merged.shotsByEpisode = { ...((cur.shotsByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.shotsByEpisode };
        }
        if (patch.statusByEpisode !== undefined) {
          merged.statusByEpisode = { ...((cur.statusByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.statusByEpisode };
        }
        if (patch.progressByEpisode !== undefined) {
          merged.progressByEpisode = { ...((cur.progressByEpisode as Record<string, unknown>) ?? {}), [epKey]: patch.progressByEpisode };
        }
        q.execute(new UpdateNodeDataCommand(storyboardId, merged));
      };

      if (!targetEp || !scriptText) {
        setEpData({ statusByEpisode: 'ready' });
        return;
      }
      setEpData({ statusByEpisode: 'generating', progressByEpisode: 0 });
      q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'generating' }));

      // 停止控制双层 Map: nodeId → (epKey → ctlInfo)
      let nodeCtlMap = nodeAbortControllersRef.current.get(storyboardId);
      if (!nodeCtlMap) {
        nodeCtlMap = new Map();
        nodeAbortControllersRef.current.set(storyboardId, nodeCtlMap);
      }
      // BUG 修复：生成中重复点击会发起多个并发任务 → 如果该集正在生成，直接忽略重复点击
      if (nodeCtlMap.has(epKey)) {
        // 已经有任务在运行，不重复发起
        return;
      }
      const ctlInfo = { taskId: '' };
      nodeCtlMap.set(epKey, ctlInfo);

      const sbGraphNode = _store.getGraph().nodes.find((n: any) => n.id === storyboardId);
      const sbNodeData = (sbGraphNode?.data ?? {}) as Record<string, unknown>;
      const pmItems = (Array.isArray(sbNodeData.productionItems) ? sbNodeData.productionItems : []) as Array<{ name?: string; kind?: string; aliases?: string[]; consistency?: string }>;
      const existingSubjects = pmItems
        .map((it: { name?: string; kind?: string; aliases?: string[]; consistency?: string }) => ({ name: it.name ?? '', kind: it.kind ?? 'character', aliases: it.aliases ?? [], description: it.consistency ?? '' }))
        .filter((s: { name: string }) => s.name.trim());

      // 初始化 canvas-agent thinking store
      // 2026-09-03 修复：必须同时 setIsGenerating(true) 并清空消息流，
      // 否则 ConversationTab 的实时思考树（条件 isGenerating && thinking.active）不会渲染，
      // 表现为「打开 Agent 面板却一片空白、只剩节点骨架」。
      // 征集 #149/#151 修正：不再 clearMessages/clearThinking（否则中断/历史消息被抹掉，
      // 刷新后无法忠实还原会话）；清思考树改为仅新开一轮 thinking 上下文。
      const agentStore = useCanvasAgentStore.getState();
      agentStore.setThinking({ active: true });
      agentStore.setIsGenerating(true);
      agentStore.setDockOpen(true);
      agentStore.setDockTab('chat');
      agentStore.clearAgentUnread();
      agentStore.setCurrentPlan(null);
      agentStore.setTodoSnapshot(null);

      // 征集 #149：任务必须携带 projectId/conversationId（缺 projectId 时子任务 save_shots
      // 无法写库 → 全部块失败）；并随 input 附带节点溯源供编排器落库/回写定位。
      void (async () => {
        const projectId = getSessionProjectId() ?? undefined;
        const conversationId = await ensureConversation(projectId);
        return agentClient.send('storyboard_generate', {
          scriptText,
          episodeId: targetEp.id,
          scriptNodeId: scriptNode.id,
          storyboardNodeId: storyboardId,
          ...(existingSubjects.length > 0 ? { subjects: existingSubjects } : {}),
        }, { conversationId, projectId });
      })().then(({ taskId }) => {
          ctlInfo.taskId = taskId;
          useCanvasAgentStore.getState().setCurrentTaskId(taskId);
          agentClient.subscribe(taskId, {
            onProgress: (progress) => {
              setEpData({ progressByEpisode: Math.max(0, Math.min(100, progress)) });
            },
            onThinkingDelta: (delta, scope) => {
              appendThinkDelta(delta, scope);
            },
            onPhase: (phase, label) => {
              useCanvasAgentStore.getState().setPhase(phase, label);
            },
            onDone: (output) => {
              const result = (output as any)?.output ?? output;
              const shots = Array.isArray(result?.shots) ? result.shots.map(normalizeShotForUi) : result?.shots;
              const failed = result?.blocks?.failed;
              if (!Array.isArray(shots)) {
                console.error('分镜任务返回异常:', output);
                setEpData({ statusByEpisode: 'error' });
                q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
                const badStore = useCanvasAgentStore.getState();
                badStore.setThinking({ active: false });
                badStore.setIsGenerating(false);
                badStore.setCurrentTaskId(null);
                badStore.setPhase(null);
                return;
              }
              setEpData({ shotsByEpisode: shots, statusByEpisode: 'ready', progressByEpisode: 100 });
              const finishStore = useCanvasAgentStore.getState();
              finishStore.setThinking({ active: false });
              finishStore.setIsGenerating(false);
              finishStore.setCurrentTaskId(null);
              finishStore.setPhase(null);

              let aiSubjects = Array.isArray(result?.subjects) ? result.subjects : undefined;
              if (!Array.isArray(aiSubjects) || aiSubjects.length === 0) {
                const subjectNames = new Set<string>();
                for (const s of (shots as Array<{ entities?: Array<string | { mention?: string }> }>)) {
                  for (const e of s.entities ?? []) {
                    const name = (typeof e === 'string' ? e : e?.mention ?? '').trim();
                    if (name) subjectNames.add(name);
                  }
                }
                aiSubjects = [...subjectNames].map((name) => ({ name, kind: 'character' as const, aliases: [], description: '' }));
              }
              // ===== BUG 修复 2026-09-02：aiSubjects 同步为 productionItems 占位卡 =====
              // 需求：AI 生成的主体出现在全屏和节点卡片（productionItems 驱动的卡片网格）
              // 幂等：以名称匹配，已存在同名条目则跳过
              const curSbGraph = q.getState();
              const curSbNode2 = curSbGraph.nodes.find((n: any) => n.id === storyboardId);
              const curSbData2 = (curSbNode2?.data ?? {}) as Record<string, unknown>;
              const curPmItems = Array.isArray(curSbData2.productionItems) ? curSbData2.productionItems as Array<{ name: string; kind: string; aliases?: string[]; consistency?: string }> : [];
              const existingPmNames = new Set(curPmItems.map((it) => (it.name ?? '').trim()).filter(Boolean));
              const pmAdditions: Array<{ name: string; kind: string; aliases: string[]; consistency: string; note: string }> = [];
              for (const sub of (aiSubjects ?? [])) {
                if (!sub || !sub.name || !sub.name.trim()) continue;
                if (existingPmNames.has(sub.name.trim())) continue;
                pmAdditions.push({
                  name: sub.name.trim(),
                  kind: sub.kind || 'character',
                  aliases: sub.aliases ?? [],
                  consistency: (sub.description ?? '').slice(0, 200),
                  note: '由 AI 分镜生成自动同步（占位卡）',
                });
                existingPmNames.add(sub.name.trim());
              }
              if (pmAdditions.length > 0) {
                const newItems = [...curPmItems.map((it) => ({
                  id: (it as any).id ?? `pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name: it.name,
                  kind: it.kind,
                  aliases: it.aliases ?? [],
                  consistency: it.consistency ?? '',
                  note: (it as any).note ?? '',
                  episodeIds: (it as any).episodeIds ?? [],
                  images: (it as any).images ?? [],
                  coverKey: (it as any).coverKey ?? null,
                  voice: (it as any).voice,
                })), ...pmAdditions.map((a) => ({
                  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name: a.name,
                  kind: a.kind as any,
                  aliases: a.aliases,
                  consistency: a.consistency,
                  note: a.note,
                  episodeIds: [] as string[],
                  images: [] as any[],
                  coverKey: null as string | null,
                  voice: undefined as any,
                }))];
                q.execute(new UpdateNodeDataCommand(storyboardId, { productionItems: newItems } as any));
              }

              q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'ready', aiSubjects }));

              const aiTree = Array.isArray(result?.subjectTree) ? result.subjectTree : undefined;
              if (aiTree && aiTree.length > 0) {
                // BUG 修复 2026-09-02：去除 !Array.isArray(curSbData.subjectTree) 守卫，
                // 允许重跑时更新 subjectTree（用户重新生成后，AI 可能返回新的主体树）
                q.execute(new UpdateNodeDataCommand(storyboardId, {
                  subjectTree: aiTree,
                  subjectAiIndex: JSON.parse(JSON.stringify(aiTree)),
                  ...(result?.colorCard ? { colorCard: result.colorCard } : {}),
                }));
              }

              if (Array.isArray(failed) && failed.length > 0) {
                message.warning(i18n.t('editor.storyboardPartialFailed', { failed: failed.length, total: result?.blocks?.total ?? 0 }));
              }
            },
            onError: (error) => {
              console.error('生成分镜失败:', error);
              const errStore = useCanvasAgentStore.getState();
              errStore.setThinking({ active: false });
              errStore.setIsGenerating(false);
              errStore.setCurrentTaskId(null);
              errStore.setPhase(null);
              if (cancelledStoryboardsRef.current.has(storyboardId)) {
                cancelledStoryboardsRef.current.delete(storyboardId);
                return;
              }
              setEpData({ statusByEpisode: 'error' });
              q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
            },
            onClose: () => {
              nodeCtlMap.delete(epKey);
            },
          });
        })
        .catch((err: any) => {
          console.error('提交分镜任务失败:', err);
          const errStore = useCanvasAgentStore.getState();
          errStore.setThinking({ active: false });
          errStore.setIsGenerating(false);
          errStore.setCurrentTaskId(null);
          errStore.setPhase(null);
          setEpData({ statusByEpisode: 'error' });
          q.execute(new UpdateNodeDataCommand(storyboardId, { status: 'error' }));
          nodeCtlMap.delete(epKey);
        });
    },
    [refs, t, message, nodeAbortControllersRef, cancelledStoryboardsRef],
  );

  return { runAiStoryboard };
}