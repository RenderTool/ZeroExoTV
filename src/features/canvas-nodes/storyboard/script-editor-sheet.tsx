/**
 * ScriptEditorSheet - 画布"剧本节点"独立页面壳
 *
 * 独立页面壳特性:
 * - 不依赖任何创作项目,内容直接写入 node.data,随画布 Yjs 同步。
 * - 单版本维护(移除多版本生成):用户通过多个剧本节点维护独立版本,故无需版本管理。
 * - 移除剧本助手(Agent)面板:画布统一以顶部 Agent 智能处理;仅保留"唤起顶部 Agent 进入剧本模式"入口。
 * - 节点本体 = 只读阅读态:隐藏标签 + 不可编辑;剧集切换位于底部工具栏(与分镜一致)。
 * - 编辑/导入/阅读均通过底部工具栏进入(编辑=全屏)。
 * - episodes / activeEpisodeId 持久化到 node.data,随画布 Yjs 同步。
 *
 * 布局(内容在上、工具栏在下,与分镜节点统一):
 * ┌──────────────────────────────────────────────────────────────┐
 * │  状态栏: [第N集 · 标题] ..... 字数 N                         │
 * ├──────────────────────────────────────────────────────────────┤
 * │  紧凑纸张只读渲染(当前集内容,隐藏标签)                         │
 * │  (重叠 .zx-script-page .zx-page-compact)                     │
 * ├──────────────────────────────────────────────────────────────┤
 * │ [第N集 ▾] | 编辑 | 导入 | 阅读 | 生成分镜                    │
 * └──────────────────────────────────────────────────────────────┘
 * 全屏编辑(底部"编辑"进入):纸张编辑器 + 剧集侧边栏
 */
import { useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ListVideo } from 'lucide-react';
import { Button, App } from 'antd';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { CanvasTabContentBoundary } from '@/features/canvas-tabs/CanvasTabContentBoundary.js';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { getEpisodePageCount } from './hooks/use-episode-manager.js';
import { displayEpisodeTitle, hasCustomEpisodeTitle } from '@/entities/script-store.js';
// 本地版（Plan#83）：剧本「AI 辅写 / 导入」不再投递给内置 Agent（由外部工具经 MCP 直接写 scripts/EPxx.md）
const sendMessage = async (..._args: unknown[]): Promise<{ taskId: string }> => {
  throw new Error('本地版无内置 LLM 链路：剧本生成/改编请由外部工具（MCP）完成');
};
const stopGenerating = (..._args: unknown[]): void => {};
const useCanvasAgentStore = { getState: (): Record<string, any> => ({ isGenerating: false, messages: [], setDockOpen: () => {}, setDockTab: () => {}, setFocusTarget: () => {}, addMessage: () => {} }) };
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown.js';
import { ScriptFullscreenEditor } from './script-fullscreen-editor.js';
import { addAssets } from '@/features/asset-picker/asset-store.js';
import { onAssetCreated } from '@/services/sync/sync-service.js';
import { saveCanvasScript } from '@/services/canvas-script.js';
import { getCurrentCanvasId } from '@/shared/current-canvas-id.js';
import { countScriptChars } from '@/shared/utils/script-count.js';
import { useTranslation } from 'react-i18next';
import type { Episode } from './script-types.js';
import './components/script-viewer.css';

export interface ScriptEditorSheetProps {
  nodeId: string;
  /** 节点标题(用于关联弹窗展示) */
  title?: string;
  /** 全部剧集(持久化到 node.data.episodes) */
  episodes: Episode[];
  /** 当前选中剧集 id(持久化到 node.data.activeEpisodeId) */
  activeEpisodeId: string;
  onEpisodesChange: (episodes: Episode[]) => void;
  onActiveEpisodeChange: (id: string) => void;
  /** 复合更新(同时写入 episodes + activeEpisodeId,避免 stale closure) */
  onEpisodesAndActiveChange: (episodes: Episode[], activeEpisodeId?: string) => void;
  /** 新增剧集(由父组件合并写入,避免 stale closure) */
  onAddEpisode: () => void;
  /** 标签显隐开关(持久化到 node.data,供全屏编辑使用) */
  showLabels: boolean;
  onShowLabelsChange: (next: boolean) => void;
  /** 打开时是否默认全屏（锚点模式下使用，默认 false） */
  defaultFullscreen?: boolean;
}

export function ScriptEditorSheet({
  nodeId,
  title,
  episodes,
  activeEpisodeId,
  onEpisodesChange,
  onActiveEpisodeChange,
  onEpisodesAndActiveChange,
  onAddEpisode,
  showLabels,
  onShowLabelsChange,
  defaultFullscreen = false,
}: ScriptEditorSheetProps): React.ReactElement {
  const { theme } = useTheme();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  // 空预览背景：与分镜空背景保持一致
  const bgCanvas = isDark ? '#171717' : '#ffffff';

  const activeEpisode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0];

  // 剧集派生统计（Phase 5：页数 / 时长，1 页 ≈ 1 分钟）
  const normalizedEpisodes = useMemo(() => episodes.map((ep, index) => {
    const pageCount = getEpisodePageCount(ep);
    return { ...ep, number: index + 1, pageCount, estimatedDuration: pageCount };
  }), [episodes]);

  // Plan#50:全屏沉浸式编辑改为「画布顶部页签」承载——本地不再持有 fullscreenOpen,
  // 显示与否完全由 tab store 的 activeTabKey 决定(kind:id 幂等,重复打开只激活不新建)
  const myTabKey = buildTabKey('script', nodeId);
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const tabContentHost = useCanvasTabStore((s) => s.contentHost);
  const openTab = useCanvasTabStore((s) => s.openTab);
  const closeTab = useCanvasTabStore((s) => s.closeTab);
  const openScriptTab = useCallback(() => {
    openTab({ kind: 'script', id: nodeId, title });
  }, [openTab, nodeId, title]);

  // 锚点模式（defaultFullscreen）：挂载即打开对应页签（幂等，重复挂载不会新建第二份）
  useEffect(() => {
    if (defaultFullscreen) openScriptTab();
  }, [defaultFullscreen, openScriptTab]);

  // 剧本导入流程已改为 Agent 对话式（不再使用独立 Modal）

  // Plan#55 A1：真实剧本生成分镜已直连 Agent（不再弹选集向导）——associateOpen 已废弃移除

  // 主题
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;

  // 字数统计(无剧集时为空态 0 字,不再统计范文——征集 #148/#150:范文直写已废弃)
  // 2026-11-04：统一走 countScriptChars 纯函数（去标签+解实体+折叠空白），与统计条/编辑器底栏/卡片同口径
  const wordCount = useMemo(
    () => countScriptChars(episodes.length === 0 ? '' : (activeEpisode?.content || '')),
    [episodes.length, activeEpisode],
  );

  // 生成分镜（Plan#55 A1）：真实剧本直连 Agent 生成
  // 征集 #148/#150：范文态已废弃（新节点不再预填范文），旧文档遗留节点同样走真实链路，不再直写模板分镜。
  // 节点语义重构(Plan#33 延伸):不再创建独立生成器节点,分镜节点自身即为生成宿主(空节点+直连剧本)
  // Task5（2026-08-31）：真实剧本不再直接投递固定生成指令，改为打开 Agent 先澄清
  // （风格/集数/平台），收集答案后才执行——无第一版产出。
  // 2026-09-04 语义约定：连点本质 = 看 Agent 当前是否在执行态（isGenerating）。
  // 执行中再次发起 → 不是静默吞/禁用，而是明确告知「必须停止当前任务才能开始新任务」，
  // 提供「停止并重新发起」确认流（stopGenerating 后立即发起，旧任务进度不可恢复）。
  const handleGenerateStoryboard = useCallback(() => {
    // 构建剧本摘要：各集标题 + 每集首段内容（克制注入，避免超大 prompt）
    const scriptPreview = normalizedEpisodes
      .slice(0, 12)
      .map((ep) => {
        const plain = (ep.content ?? '')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/gi, ' ')
          .trim()
          .slice(0, 200);
        return `【第 ${ep.number} 集 ${ep.title ?? ''}】\n${plain || '（本集暂无内容）'}`;
      })
      .join('\n\n');
    // Task5 A方案：open Agent 面板 + 抛澄清问题（不执行生成）。明确告诉 Agent：
    // 在用户给出风格/集数/平台前禁止产出分镜节点/第一版。
    const prompt = [
      '我想基于以下剧本生成分镜，请你先向我澄清几个关键设定，不要立即生成任何分镜：',
      '1. 整体视觉风格（如写实电影 / 动画 / 国风水墨 / 赛博朋克……）',
      '2. 本次生成哪些集（整部逐集 / 仅当前集 / 指定第几集）',
      '3. 目标平台与成片比例（横屏电影 / 竖屏短视频 / 方屏）',
      '',
      '请用选项清单（每个问题 ≤5 项，最可能优先置前）让我拍板；在我完整回答这三项之前，',
      '不要创建分镜节点，也不要产出任何镜头版本。',
      `剧本节点 id=${nodeId}${title ? `（标题：${title}）` : ''}`,
      '',
      '剧本内容摘要（仅导航，完整内容请读节点）：',
      scriptPreview,
    ].join('\n');
    const launch = () => {
      const setAgentState = useCanvasAgentStore.getState();
      setAgentState.setDockOpen(true);
      setAgentState.setDockTab('chat');
      setAgentState.addMessage({
        id: `msg_script_gen_${Date.now()}`,
        role: 'user',
        type: 'text',
        text: prompt,
        timestamp: Date.now(),
      });
      void sendMessage(prompt, { taskType: 'canvas_agent' });
    };
    if (useCanvasAgentStore.getState().isGenerating) {
      modal.confirm({
        title: t('scriptEditor.agentBusyTitle', 'Agent 正在执行任务'),
        // 2026-11-05 用户指令：确认弹窗一律屏幕居中
        centered: true,
        content: t('scriptEditor.agentBusyContent', '停止当前任务后才能发起新的生成。停止后当前任务的进度与结果不可恢复，是否停止并重新发起？'),
        okText: t('scriptEditor.stopAndRestart', '停止并重新发起'),
        okButtonProps: { danger: true },
        cancelText: t('scriptEditor.cancel', '取消'),
        onOk: () => {
          stopGenerating({ allowResume: false });
          launch();
        },
      });
      return;
    }
    launch();
  }, [nodeId, title, normalizedEpisodes, t, modal]);

  /**
   * Plan#72 Phase1 T3：剧本节点「导入小说」统一入口。
   * 打开 Agent 面板 + 注入 upload 上传卡（0 token），并携带 meta.intent='script_import'
   * + 焦点声明（script 节点），供 UploadBlock 上传后构造「改编为剧本」意图消息；
   * 空态「让 Agent 生成」语义 = script_generate（先产剧本再分镜，见 Spec §6.1）。
   */
  const openScriptImportUpload = useCallback(() => {
    // 2026-09-04 语义约定：执行态感知。执行中开始导入同样必须先停止当前任务
    // （上传回执会触发新一轮生成；旧任务不停止则回执被 isGenerating 挡在半空）。
    // 已存在同节点 pending 上传卡时也不重复注入（连点只保留第一张）。
    const launch = () => {
      const setAgentState = useCanvasAgentStore.getState();
      const hasPendingUpload = setAgentState.messages.some(
        (m: { type?: string; meta?: { nodeId?: string }; upload?: { status?: string } }) =>
          m.type === 'upload' && m.meta?.nodeId === nodeId && (m.upload?.status === 'pending' || m.upload?.status === 'uploading'),
      );
      if (hasPendingUpload) return;
      setAgentState.setDockOpen(true);
      setAgentState.setDockTab('chat');
      setAgentState.setFocusTarget({ kind: 'script', nodeId, label: title });
      setAgentState.addMessage({
        id: `msg_script_import_${Date.now()}`,
        role: 'agent',
        type: 'upload',
        text: `请上传剧本素材文件（节点 id=${nodeId}${title ? `，标题：${title}` : ''}）`,
        upload: {
          guideText: '请上传长文本、剧本或故事文本文件，支持 .txt/.md 格式。上传完成后 Agent 将自动开始处理。',
          accept: '.txt,.md',
          multiple: false,
          status: 'pending',
        },
        meta: { intent: 'script_import', nodeId, title },
        timestamp: Date.now(),
      });
    };
    if (useCanvasAgentStore.getState().isGenerating) {
      modal.confirm({
        title: t('scriptEditor.importBusyTitle', 'Agent 正在执行任务'),
        centered: true,
        content: t('scriptEditor.importBusyContent', '停止当前任务后才能开始导入。停止后当前任务的进度与结果不可恢复，是否停止并开始导入？'),
        okText: t('scriptEditor.stopAndImport', '停止并开始导入'),
        okButtonProps: { danger: true },
        cancelText: t('scriptEditor.cancel', '取消'),
        onOk: () => {
          stopGenerating({ allowResume: false });
          launch();
        },
      });
      return;
    }
    launch();
  }, [nodeId, title, t, modal]);

  // ========== 内容变更 ==========

  // ========== 剧集选择 ==========
  // 剧集切换已统一置于底部工具栏 Select(见 render),不再使用上一集/下一集按钮。

  // ========== 胶囊工具栏事件订阅 ==========
  // 编辑/导入/阅读已注册到通用悬浮胶囊(extensions.tsx getScriptTools),
  // 通过 nodeActionBus 广播动作,此处按 nodeId 过滤后执行对应操作。

  useEffect(() => {
    const unsubs = [
      nodeActionBus.on('script:import', (e) => {
        if (e.nodeId !== nodeId) return;
        // Plan#74 Phase D1：导入小说改为直接弹窗落库 + 建 novel 节点（不再走 Agent 解析）。
        // novel 节点作为上游素材源，仅当用户选择「转剧本」时才由 Agent 解析（避免无谓 token）。
        // 文件选择 + uploadAsset + 建节点 + 连线由画布层 use-editor-interactions 处理（e.nodeId = 剧本节点）。
        nodeActionBus.emit('novel:import-from-script', { nodeId });
      }),
      nodeActionBus.on('script:edit', (e) => {
        if (e.nodeId !== nodeId) return;
        // Plan#50:打开顶部页签(幂等:同一剧本重复触发只激活已有页签)
        openTab({ kind: 'script', id: nodeId, title });
      }),
      // Plan#20 T0(征集#13): 胶囊「分镜」按钮请求事件——真实剧本走选集 Modal / AI 链路
      nodeActionBus.on('script:requestGenerateStoryboard', (e: { nodeId: string }) => {
        if (e.nodeId !== nodeId) return;
        handleGenerateStoryboard();
      }),
      // 注意:不订阅 script:generateStoryboard 事件
      // 该事件由 handleGenerateStoryboard/其他入口 emit,use-editor-interactions.ts 处理创建分镜节点,
      // 此处订阅会导致 handleGenerateStoryboard 重新 emit 同一事件触发无限循环。
    ];
    return () => unsubs.forEach((unsub) => unsub?.());
  }, [nodeId, handleGenerateStoryboard, openScriptImportUpload]);

  // ========== 剧集管理 ==========

  const handleAddEpisode = useCallback(() => {
    onAddEpisode();
  }, [onAddEpisode]);

  // ========== 加入资产库 ==========

  const handleSendToAsset = useCallback(async () => {
    if (episodes.length === 0) {
      message.warning(t('storyboard.noScriptContent'));
      return;
    }
    const content = JSON.stringify(episodes.map((ep) => ({
      id: ep.id,
      number: ep.number,
      title: ep.title,
      content: ep.content,
    })));
    const assetTitle = title || t('storyboard.untitledScript');
    try {
      const canvasId = getCurrentCanvasId();
      let asset: { id: string } | null = null;
      if (canvasId) {
        // 本地版（2026-11-02）：一个画布一个剧本 —— 写回本画布绑定的剧本，不新建第二条
        asset = await saveCanvasScript(canvasId, assetTitle, episodes);
      } else {
        const created = await addAssets([{
          title: assetTitle,
          kind: 'script',
          tags: [],
          bytes: new Blob([content]).size,
          mimeType: 'application/json',
          data: { kind: 'script', content },
        }]);
        asset = created[0] ?? null;
        if (asset) onAssetCreated(asset.id);
      }
      if (asset) {
        // FIX-6: 通知画布层打开资产库展示结果（资产库 Modal 每次打开时强制重挂载刷新）
        nodeActionBus.emit('script:assetSaved', { nodeId, assetId: asset.id, title: assetTitle });
        message.success(t('storyboard.addedToAssetLibrary'));
      }
    } catch (err) {
      console.error('send to asset failed:', err);
      message.error(t('storyboard.addToAssetLibraryFailed'));
    }
  }, [episodes, title, message, t]);

  // 加入资产 — 胶囊工具栏事件订阅
  useEffect(() => {
    const unsub = nodeActionBus.on('script:saveAsset', (e) => {
      if (e.nodeId !== nodeId) return;
      handleSendToAsset();
    });
    return () => unsub?.();
  }, [nodeId, handleSendToAsset]);

  // ========== Render ==========

  return (
    <div style={containerStyle()}>

      {/* 顶部状态栏 — 剧集下拉居中,字数靠右;工具全部在底部工具栏 */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: isDark ? '#1b1b1b' : '#fafaf7', flexShrink: 0 }}>
        <div style={{ flex: 1 }} />
        {/* 剧集切换(顶部居中,复用全屏模式按钮式下拉) */}
        {episodes.length > 0 ? (
          <FullscreenDropdown
            onSelect={onActiveEpisodeChange}
            options={normalizedEpisodes.map((ep) => {
              // 2026-11-04：hasCustomEpisodeTitle 统一判定——默认("第N集"及空格变体)/空/脏值(如「第1集2集」)均不拼标题
              const localizedDefault = t('storyboard.episodeLabel', { number: ep.number });
              const customTitle = hasCustomEpisodeTitle(ep.title, ep.number);
              return {
                key: ep.id,
                label: customTitle ? `${localizedDefault} · ${displayEpisodeTitle(ep.title, ep.number)}` : localizedDefault,
                active: ep.id === activeEpisode?.id,
              };
            })}
          >
            <Button size="small" type="text" icon={<ListVideo size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
              {/* 2026-11-04：按钮文本同走 displayEpisodeTitle（空/脏值兜底规范名） */}
              {(() => {
                const cur = normalizedEpisodes.find((ep) => ep.id === activeEpisode?.id);
                return cur ? displayEpisodeTitle(cur.title, cur.number) : t('storyboard.episodeLabel', { number: 1 });
              })()}
            </Button>
          </FullscreenDropdown>
        ) : (
          <span style={{ fontSize: 11, color: mutedColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ListVideo size={14} />
            {t('storyboard.episodeLabel', { number: 1 })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: mutedColor }}>{t('canvasNodes.wordCount', { count: wordCount })}</span>
      </div>

      {/* Plan#50:剧本编辑器改为画布顶部页签内嵌呈现(不再全屏覆盖)——
          仅在页签激活且页签内容层已挂载时,通过 createPortal 渲染到页签挂载点;
          数据(episodes)与所有回调仍留在节点组件内,关闭统一走页签 X(closeTab) */}
      {tabActive && tabContentHost ? createPortal(
      <CanvasTabContentBoundary>
      <ScriptFullscreenEditor
        open
        embedded
        onClose={() => closeTab(myTabKey)}
        title={title}
        episodes={episodes}
        activeEpisodeId={activeEpisodeId}
        onEpisodesChange={onEpisodesChange}
        onActiveEpisodeChange={onActiveEpisodeChange}
        onEpisodesAndActiveChange={onEpisodesAndActiveChange}
        onAddEpisode={handleAddEpisode}
        showLabels={showLabels}
        onShowLabelsChange={onShowLabelsChange}
        onImportClick={() => {
                  // Plan#72 Phase1 T3：统一走 openScriptImportUpload（注入 meta.intent + 焦点）
                  openScriptImportUpload();
                }}
      />
      </CanvasTabContentBoundary>,
      tabContentHost,
      ) : null}

      {/* 主体：只读阅读态(紧凑纸张;剧集切换已移至底部工具栏) */}
      {/* 只读紧凑纸张（空态由 creation-node-view 统一空态卡接管，本组件仅在有内容时渲染） */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, cursor: 'default', display: 'flex' }}>
        <div style={{ position: 'relative', height: '100%', overflow: 'auto', borderRadius: 6, background: bgCanvas }}>
          <div
            className="zx-script-page zx-page-compact zx-page-compact-preview"
            data-theme={isDark ? 'dark' : 'light'}
            style={{ minHeight: '100%' }}
          >
            <ScriptContentView content={activeEpisode?.content || ''} />
          </div>
        </div>
      </div>

      {/* 底部工具操作栏 — 已注释,功能移至胶囊菜单 */}
      {/*
      <div style={footerToolbarStyle(cardBorder)}>
        <Tooltip title="进入全屏编辑">
          <Button size="small" type="text" icon={<Maximize size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={openScriptTab}>
            编辑
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="导入剧本">
          <Button size="small" type="text" icon={<FileUp size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={() => setImportFlowOpen(true)}>
            导入
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="加入资产库">
          <Button size="small" type="text" icon={<FolderOpen size={14} />} style={{ ...fullToolBtnStyle, color: textColor }} onClick={handleSendToAsset}>
            加入资产
          </Button>
        </Tooltip>
        <span style={{ width: 1, height: 16, background: cardBorder, flexShrink: 0 }} />
        <Tooltip title="根据当前剧本生成分镜节点并自动连线">
          <Button size="small" type="primary" icon={<Clapperboard size={14} />} style={{ ...fullToolBtnStyle }} onClick={handleGenerateStoryboard}>
            生成分镜
          </Button>
        </Tooltip>
      </div>
      */}

    </div>
  );
}

// ===== ScriptContentView：剧本只读渲染（兼容 MD 与 HTML 序列化） =====

/**
 * AI 导入的剧本内容多为 Markdown（`# 第一集`、`## 场景`、`**加粗**`），
 * 而结构化编辑器/旧数据存 HTML（`.ql-editor` 序列化）。
 * 这里自动识别：含 HTML 标签则原样渲染，否则按 Markdown 渲染，
 * 保证两种来源都不再显示丑陋的原始标记文本。
 */
function ScriptContentView({ content }: { content: string }): React.ReactElement {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(content);
  if (looksLikeHtml) {
    return (
      <div
        className="ql-editor"
        style={{ minHeight: '100%', boxSizing: 'border-box', cursor: 'default' }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
      />
    );
  }
  return (
    <div
      className="ql-editor zx-script-md"
      style={{ minHeight: '100%', boxSizing: 'border-box', cursor: 'default' }}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

// ===== Styles =====

const containerStyle = (): CSSProperties => ({
  display: 'flex', flexDirection: 'column', flex: 1,
  minHeight: 0, overflow: 'hidden',
});

