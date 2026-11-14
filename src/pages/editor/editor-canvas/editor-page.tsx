/**
 * EditorPage - 画布编辑页
 *
 * 装配:CanvasView(含交互回调)+ TopBar/LeftSideToolBar/RightSideToolBar/ToolsDock
 * + MinimapView(右下角)
 * + PromptPanel(选中节点时)/ AssetPicker(我的素材)。
 *
 * 架构调整:
 * - 移除 NodeDetailPanel(所有操作聚合到 ToolsDock)
 * - 移除 NodeHoverToolbar(悬浮节点/组上的工具栏,功能并入 ToolsDock)
 * - 移除 BottomToolbar(模式切换并入 LeftSideToolBar,成组/解组/排列并入 ToolsDock)
 * - 移除 ImageToolSettingsModal(换列/工具勾选配置不再需要)
 * - 移除 LayoutToolbar/ArrangeDropdown 自定义工具栏页面(排列改由 ToolsDock 聚合按钮承担)
 * - 配置弹窗(ConfigDialog,画布样式)由本页直接渲染,TopBar 通过 onOpenSettings 触发
 * - 组重命名通过 externalRenamingGroupId 触发 GroupLayer 的 inline input(聚焦+全选)
 *
 * 交互回调最简委托给 interactionController。
 * 弹窗状态和交互回调已提取到 use-editor-dialogs 和 use-editor-interactions 两个 Hook。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { App, Layout, Tooltip } from 'antd';
import { ClipboardPaste } from 'lucide-react';
import { EDITOR_ICONS } from './icons.js';
import { hasClipboardContent, pasteClipboard } from '@zeroexo/preset-default';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { CanvasView, PinDefaultsProvider, NodeDefaultsProvider, ReactGraphStoreContext } from '@zeroexo/plugin-render-react';
import { MinimapView } from '@zeroexo/plugin-minimap';
import { GroupLayer, GroupDefaultsProvider, getGroupBoundsWithEmptyFallback } from '@zeroexo/plugin-group';
import { useTheme } from '@zeroexo/plugin-theme';
import { fullSync, onProjectDeleted } from '@/services/sync/sync-service.js';
import { useSyncStatus, CLOUD_ENABLED } from '@/services/sync/sync-store.js';
import type { NodeRecord } from '@zeroexo/core';
import { AddNodeCommand, filterVisibleNodes } from '@zeroexo/core';
import { VersionBadge } from '@/features/top-bar/components/version-badge.js';
import { TopBar, ConfigDialog } from '@/features/top-bar/index.js';
import { CanvasMenu } from '@/features/top-bar/components/canvas-menu.js';
import { CanvasOverlays } from '@/features/canvas-interaction/canvas-overlays.js';
import { ConnectionDropMenu } from '@/features/canvas-interaction/connection-drop-menu.js';
import { LeftSideToolBar } from '@/features/left-side-toolbar/index.js';
import { NodeCapsuleToolbar } from '@/features/tools-dock/node-capsule-toolbar.js';
import { GroupStyleDialog } from '@/features/tools-dock/group-style-dialog.js';
import { ContextualShortcutsPanel } from '@/shared/hints/contextual-shortcuts-panel.js';
import { ContentBeacon } from '@/features/canvas-interaction/content-beacon.js';
import { Upload } from 'lucide-react';
import { ReadOnlyProvider } from '@/shared/readonly-context.js';
import { useHintsEnabled } from '@/shared/hints/hints-settings.js';
import { NodeGenerateDock, TEXT_UPLOAD_ACCEPT } from '@/features/tools-dock/node-generate-dock.js';
// 征集 #87:外部资产页(AssetLibraryModal)已移除——资产收编进层级面板资产模式
// 本地版（Plan#83）：collaboration / canvas-agent / dev-performance 三条链路整体摘除，
// 智能侧改由外部 coding 工具经 MCP 直接读写数据目录（见 Plan#83 Phase 4）
import { useAssets, type Asset } from '@/features/asset-picker/index.js';
import { HierarchyPanelSidebar } from '@/features/hierarchy/index.js';
import { CANVAS_TAB_KEY, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { ScriptTabContent } from '@/features/canvas-tabs/script-tab-content.js';
import { StoryboardTabContent } from '@/features/canvas-tabs/storyboard-tab-content.js';
import { SubjectLinkDialogHost } from '@/features/canvas-nodes/storyboard/subject-link-dialog.js';
import { WorkbenchTabContent } from '@/features/canvas-tabs/workbench-tab-content.js';
import { buildDefaultEpisodes } from '@/services/canvas-script.js';
import { ensureScript } from '@/entities/script-store.js';
import { ensureProjectMounts } from '@/entities/slot-containers.js';
import type { ScriptEpisode } from '@/entities/script-store.js';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { navigateToView } from '@/features/canvas-tabs/navigate-to-view.js';
import type { KeyboardPlugin } from '@zeroexo/plugin-keyboard';
import { getProject } from '@zeroexo/plugin-persistence';
import { exportProjects } from '@/pages/home/services/export-projects.js';
import { ConfirmDialog, NodeCreateMenu, AppearanceDialog, ShortcutsDialog, MobileNavDrawer, MobileNavButton, MobileNavFloatingWrapper, LanguageDialog, AssetDetailViewer, LoadingOverlay } from '@/shared/components/index.js';
import { MediaLightbox } from '@/shared/components/media-lightbox.js';
// Plan#84（征集#184）：副本画布挂载层（与 1 号并排的顶层标签激活时渲染另一块画布）
import { CanvasDocumentTabs } from '@/features/canvas-tabs/canvas-document-tabs.js';
import { isImageTabKey } from '@/features/canvas-tabs/canvas-tab-store.js';
import { ImageEditWorkspace } from '@/features/image-editor/image-edit-workspace.js';
import { useCanvasDocumentSwitch, useRestoreCanvasTabs } from '@/features/canvas-tabs/use-canvas-document-switch.js';
import { isOpenCanvasTabKey } from '@/features/canvas-tabs/canvas-tab-store.js';
import type { ContextMenuItem } from '@/shared/components/index.js';
import { useCanvasHandlers } from '@/features/canvas-interaction/use-canvas-handlers.js';
import { useDropHandler } from '@/features/canvas-interaction/drop-handler.js';
import { UploadQueueOverlay } from '@/features/upload-queue/index.js';
import { useUploadQueue } from '@/features/upload-queue/use-upload-queue.js';
import { UploadQueue } from '@zeroexo/plugin-upload-queue';
import { useEditorState } from './use-editor-state.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { CreationSyncBadge } from '@/shared/components/creation/CreationSyncBadge.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { WORKSPACE_SURFACE_STYLE } from '@/shared/components/LAYOUT_CONSTANTS.js';
import { useAiConfigStore } from '@/features/ai-config/use-ai-config-store.js';
import { useEditorDialogs } from './use-editor-dialogs.js';
import { useEditorInteractions } from './use-editor-interactions.js';
import { useMcpImageJobs } from '@/features/mcp-image-jobs/use-mcp-image-jobs.js';

import { useStackToast } from './use-stack-toast.js';
import { ReadOnlyCanvasOverlay } from './read-only-canvas-overlay.js';
import { EmptyCanvasGuide, useIsCanvasEmpty } from './empty-canvas-guide.js';

/** 画布点阵世界间距(2026-11-05 用户要求提高密度：24 → 16) */
const CANVAS_GRID_SIZE = 16;

export interface EditorPageProps {
  canvasId: string;
  onBack: () => void;
  onOpenProject: (id: string) => void;
}

export function EditorPage({ canvasId, onBack, onOpenProject }: EditorPageProps): React.ReactElement {
  const { state, actions, refs, containerRef, cloudUpdateAvailable, clearCloudUpdateAvailable } = useEditorState(canvasId);
    // 快捷键注册表(键盘插件实例;供快捷键弹窗自动映射,未安装插件时为 undefined)
    const keyboardShortcuts = state.editor?.core.plugins.get<KeyboardPlugin>('keyboard')?.listShortcuts();
  const { theme } = useTheme();
  const { message, modal } = App.useApp();
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { status } = useSyncStatus();
  const { isAuthenticated, logout } = useAuth();
  // 教育提示全局开关(设置弹窗控制,localStorage 持久化)
  const hintsEnabled = useHintsEnabled();
  // 空画布引导态(2026-11-04):响应式订阅 graph,空态时 CanvasView 背景交给引导层绘制
  const canvasEmpty = useIsCanvasEmpty(state.editor?.store ?? null);
  // 移动端语言弹窗(由 MobileNavDrawer 触发)
  const [mobileLanguageOpen, setMobileLanguageOpen] = useState(false);
  // AI 渠道配置(用于生成中按钮展示"模型(渠道)"任务信息)
  const aiConfig = useAiConfigStore((state) => state.config);

  // 右键菜单 + 重命名状态(保留在 main 组件,因为与 JSX 渲染直接耦合)
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[] | null | undefined>(undefined);
  // 空白区域节点创建菜单(使用通用 NodeCreateMenu 组件)
  const [nodeCreateMenuPos, setNodeCreateMenuPos] = useState<{ x: number; y: number } | null>(null);
  // 组重命名:由 toolbar 的"重命名"按钮设置 groupId,GroupLayer 消费后进入 inline edit 态
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  // 普通节点重命名:由 toolbar 的"重命名"按钮设置 nodeId,CanvasView 消费后进入 inline edit 态
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  // 上传菜单触发用的隐藏 file input ref(加号菜单 / 空白右键菜单共用)
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 弹窗状态管理
  const dialogs = useEditorDialogs({
    canvasId, onBack, onOpenProject,
    onProjectDeleted,
    setRenamingGroupId,
    refs, state, actions, message, t, isMobile,
  });

  // Plan#50:顶部页签——activeTabKey 决定画布显隐;setTabContentHost 注册页签内容层挂载点
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const openImageTabs = useCanvasTabStore((s) => s.openImageTabs);
  const closeImageTab = useCanvasTabStore((s) => s.closeImageTab);
  // 图片编辑独立页签（Photoshop 式）：节点来源 image:<nodeId>、资产来源 image:asset:<id>
  const editingImageTab = isImageTabKey(activeTabKey)
    ? (openImageTabs.find((tb) => tb.key === activeTabKey) ?? null)
    : null;
  const editingImageNode = editingImageTab?.nodeId && state.editor
    ? state.editor.store.getNode(editingImageTab.nodeId)
    : null;
  const editingImageSource = editingImageTab
    ? (editingImageTab.nodeId
      ? (editingImageNode ? { kind: 'node' as const, node: editingImageNode } : null)
      : (editingImageTab.asset ? { kind: 'asset' as const, ...editingImageTab.asset, title: editingImageTab.title } : null))
    : null;
  const setTabContentHost = useCanvasTabStore((s) => s.setContentHost);
  const setCanvasHost = useCanvasTabStore((s) => s.setCanvasHost);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  // 画布级页签 = 同一编辑器切换文档：主画布（.lf）+ 副本（projects/<pid>/canvases/*.json）。
  // 不再为副本创建第二个引擎实例，视图/工具栏/交互与主画布完全同一套。
  useRestoreCanvasTabs(canvasId);
  useCanvasDocumentSwitch({ projectId: canvasId, editor: state.editor });
  // 2026-11-04 单例槽位改造：四个固定页签（剧本/分镜/出片/画布）= 流水线槽位视图。
  // 分镜/出片槽位绑定由 use-editor-interactions 的图订阅解析写入；剧本绑定见下方 effect。
  const slotBindings = useCanvasTabStore((s) => s.slotBindings);
  // 2026-11-02（本地版）：剧本页签内容改由页面层 ScriptTabContent 承载（不再来自抽屉 portal），
  // 故剧本页签打开时不再需要强制挂载资产抽屉。
  // 2026-08-31 根治「缩放浏览器窗口 → 页签内容看不见」:
  // 页签内容由节点组件 createPortal 到页签内容层,而画布有视口裁剪(culling)——
  // 窗口 resize 改变 cullRect 后承载页签的节点可能被判为视口外 → 节点组件卸载
  // → portal 出去的编辑器一起销毁(页签还在,内容空白)。
  // 前几轮只修了「抽屉卸载」(2026-08-29)与「响应式分支切换」(2026-08-30),
  // 没触及 culling,所以换个触发路径就复发。这里把槽位绑定的节点加入裁剪白名单。
  const tabPinnedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    // 分镜/出片槽位节点承载页签内容（portal），必须豁免裁剪
    if (slotBindings.storyboard) ids.add(slotBindings.storyboard);
    if (slotBindings.workbench) ids.add(slotBindings.workbench);
    return ids;
  }, [slotBindings.storyboard, slotBindings.workbench]);

  // 2026-11-04 剧本实体化：唯一事实源 = projects/<id>/entities/script.json（唯一写者 script-store）。
  // 2026-11-04 硬约束：项目进入即默认挂载「一个剧本 + 一个主体库 + 一个导演台」的
  // 项目级实体/容器（entities/*.json），**绝不写 graph、绝不产生画布节点**；
  // 挂载幂等（已存在原样返回），重复触发不会覆盖用户内容。
  const ensureScriptEntity = useCallback(async (): Promise<boolean> => {
    try {
      const eps: ScriptEpisode[] = buildDefaultEpisodes()
        .map((e) => ({ ...e, status: 'draft' }));
      await ensureScript(canvasId, {
        title: t('canvasNodes.stage.script', '剧本'),
        episodes: eps,
      });
      await ensureProjectMounts(canvasId);
      useCanvasTabStore.getState().setSlotBindings({ script: canvasId });
      return true;
    } catch (err) {
      console.error('[editor-page] ensure project mounts failed:', err);
      message.error(t('canvasTab.scriptProvisionFailed', '剧本打开失败，请重试'));
      return false;
    }
  }, [canvasId, message, t]);

  // 打开项目时：默认挂载项目级容器（剧本实体 + 主体库/导演台容器），并默认激活「剧本」页签。
  // 取值顺序（2026-11-04 硬约束）：首次进入=剧本；同会话内用户切换页签不被覆盖
  // （按 canvasId 去重，只在该项目首次进入时执行一次）；activeTabKey 不持久化，无跨会话记忆。
  const entryMountedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.editor) return;
    if (entryMountedRef.current === canvasId) return;
    entryMountedRef.current = canvasId;
    void (async () => {
      const ok = await ensureScriptEntity();
      if (ok) useCanvasTabStore.getState().activateProjectEntry(canvasId);
    })();
  }, [canvasId, state.editor, ensureScriptEntity]);

  // 2026-11-04 硬约束：画布中不得出现任何分镜、出片节点。
  // 页签激活 = 纯读指针切换，任何链路都不创建节点/写图（空态里的「初始化」按钮也已移除）；
  // 主体库/导演台 = 项目级容器（entities/*.json），无载体节点时由页级
  // StoryboardTabContent/WorkbenchTabContent 渲染空态。
  // Plan#50 T13 回归修复:ref 必须稳定——内联箭头会在每次渲染触发 ref(null)+ref(el),
  // 经 setContentHost 反写 store 造成「null→el→null→el」无限渲染循环,表现为关闭页签后再打开剧本失败
  const handleTabHostRef = useCallback((el: HTMLElement | null) => {
    setTabContentHost(el);
  }, [setTabContentHost]);
  // 2026-08-30 征集 #110: 画布容器注册到全局 store,供节点内浮层(主体库复用 NodeGenerateDock)portal 定位
  const handleCanvasHostRef = useCallback((el: HTMLElement | null) => {
    setCanvasHost(el);
  }, [setCanvasHost]);
  // containerRef 由 useEditorState 创建（RefObject，.current 只读），用 effect 同步到 store
  useEffect(() => {
    handleCanvasHostRef(containerRef.current);
  }, [containerRef, handleCanvasHostRef]);

  // ===== Plan#51 页签联动已随 Plan 移除(2026-08-29),逻辑注释保留 =====
  // const handlePlanSendToAgent = useCallback((payload) => { void sendMessage(payload.text); }, [sendMessage]);

  /* [2026-08-29 Plan 已移除:发送到画布逻辑保留注释]
  // 发送到画布：素材副本列 → 视频产物空节点 → 连线 → 聚焦，然后切回画布页签
  const handlePlanSendToCanvas = useCallback((payload: { shotId: string; images: string[]; prompt: string; title: string }) => {
    const { shotId, images, prompt, title } = payload;
    const bridge = getCanvasOpBridge();
    const store = bridge?.getStore();
    if (!bridge || !store) return;

    const vp = store.getViewport() as { x?: number; y?: number } | undefined;
    const baseX = typeof vp?.x === 'number' ? vp.x : 0;
    const baseY = typeof vp?.y === 'number' ? vp.y : 0;
    const productId = `plan-${shotId}`;

    const ops: AgentCanvasOp[] = [];
    images.forEach((storageKey, i) => {
      const srcId = `${productId}-src${i}`;
      ops.push({
        op: 'add_node',
        args: {
          id: srcId,
          type: 'image',
          position: { x: baseX, y: baseY + i * 170 },
          size: { width: 200, height: 150 },
          title: `图${i + 1}`,
          data: {
            content: getResourceUrl(storageKey, 'preview'),
            storageKey,
            title: `图${i + 1}`,
          },
        },
      });
      ops.push({
        op: 'add_edge',
        args: {
          source: { nodeId: srcId, pinId: 'output' },
          target: { nodeId: productId, pinId: 'input' },
        },
      });
    });

    ops.push({
      op: 'add_node',
      args: {
        id: productId,
        type: 'video',
        position: { x: baseX + 340, y: baseY },
        size: { width: 260, height: 170 },
        title,
        data: {
          // 空 media 节点 = 生成器态（NodeGenerateDock 读取以下字段预填/展示）
          content: '',
          prompt,
          status: 'idle',
          generationMode: 'video',
          referenceImages: images,
          channelId: '',
          model: '',
          params: {},
          title,
        },
      },
    });

    // executeCanvasOp 内部串行队列，逐条执行后自动 flush
    for (const op of ops) void executeCanvasOp(op);
    // 切回画布页签，让用户看到刚落地的链
    activateTab(CANVAS_TAB_KEY);
  }, [activateTab]);
  ===== Plan 发送逻辑注释结束 ===== */

  // 2026-08-29 修复「节点选中后切换页签会错位穿透」:
  // 画布在页签激活时仍保持挂载(Plan#50 要求,display:none 会破坏 ResizeObserver/视口),
  // 选中框/浮动工具条等画布内部浮层因此依然渲染,且部分 z-index 高于页签内容层 → 浮在页签之上。
  // 离开画布页签时主动清除选中态,从源头去掉这些浮层。
  useEffect(() => {
    if (activeTabKey === CANVAS_TAB_KEY) return;
    const store = state.editor?.store;
    if (!store) return;
    const { selectedNodeIds, selectedEdgeIds } = store.getSelection();
    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;
    store.clearSelection();
  }, [activeTabKey, state.editor]);

  // 2026-08-29 修复:canvas-tab-store 是全局单例,离开画布(本组件卸载)时 tabs 不会自动清空;
  // 残留的旧页签 activeTabKey 指向已不存在的节点,重新进入画布后「页签还在但内容为空」。
  // 卸载时清空全部页签(回退画布页签),下次进入干净重来。
  useEffect(() => {
    return () => {
      useCanvasTabStore.getState().closeAllTabs();
    };
  }, []);

  // 参与者：发起者关闭协作(room_closed) → 弹出"协作已失效"提示，确认后返回主页
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ canvasId?: string } | undefined>).detail;
      if (!detail || detail.canvasId !== canvasId) return;
      modal.confirm({
        title: t('collab.roomClosedByOwnerTitle'),
        content: t('collab.roomClosedByOwnerContent'),
        okText: t('collab.backToHome'),
        cancelButtonProps: { style: { display: 'none' } },
        centered: true,
        onOk: () => onBack(),
      });
    };
    window.addEventListener('zeroexo:collab-room-expired', handler);
    return () => window.removeEventListener('zeroexo:collab-room-expired', handler);
  }, [canvasId, modal, onBack, t]);

  // 被踢出：发起者移出成员(member_left + kicked) → 弹窗提示，确认后返回主页
  // modal 遮罩同时阻断画布交互；返回后 useCanvasSync 卸载断开 Yjs WS
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ canvasId?: string } | undefined>).detail;
      if (!detail || detail.canvasId !== canvasId) return;
      modal.confirm({
        title: t('collab.kickedByOwnerTitle'),
        content: t('collab.kickedByOwnerContent'),
        okText: t('collab.backToHome'),
        cancelButtonProps: { style: { display: 'none' } },
        centered: true,
        onOk: () => onBack(),
      });
    };
    window.addEventListener('zeroexo:collab-kicked', handler);
    return () => window.removeEventListener('zeroexo:collab-kicked', handler);
  }, [canvasId, modal, onBack, t]);

  // 被封禁：发起者封禁成员(member_updated + banned) → 弹窗提示，确认后返回主页
  // 与踢出同等级：封禁是禁止重新加入的最高权限处置，当前会话必须立刻退出
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ canvasId?: string } | undefined>).detail;
      if (!detail || detail.canvasId !== canvasId) return;
      modal.confirm({
        title: t('collab.bannedByOwnerTitle'),
        content: t('collab.bannedByOwnerContent'),
        okText: t('collab.backToHome'),
        cancelButtonProps: { style: { display: 'none' } },
        centered: true,
        onOk: () => onBack(),
      });
    };
    window.addEventListener('zeroexo:collab-banned', handler);
    return () => window.removeEventListener('zeroexo:collab-banned', handler);
  }, [canvasId, modal, onBack, t]);

  // 本地版（Plan#83）：无协作成员、无审核制、无只读 viewer 概念，画布永远可写
  const isReadOnlyViewer = false;

  // 只读模式拦截编辑类快捷键（2026-08-25 系统性只读防护）：键盘事件走 window 级监听，
  // 画布遮罩拦不住（Delete 删除 / Ctrl+D 原位复制 / Ctrl+Z 撤销 / Ctrl+C/V 复制粘贴均会改画布数据）。
  // capture 阶段抢在 keyboard 插件分发前拦截；输入框内放行（搜索框等浏览输入不受影响）。
  useEffect(() => {
    if (!isReadOnlyViewer) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (el && (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const blocked =
        e.key === 'Delete' || e.key === 'Backspace' ||
        (mod && ['z', 'y', 'd', 'c', 'x', 'v'].includes(k));
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isReadOnlyViewer]);

  // 本地版无协作成员：标题等元数据始终可编辑；Agent 操作桥随 canvas-agent 一并移除
  const isCollabGuest = false;

  // 素材库（addAsset 供交互层上传资源使用）
  const { addAsset } = useAssets();

  // 交互层的「存入我的资产」入口：必须 await 真实完成，失败抛出。
  // 此前写成 `async (input) => { void addAsset(input); }` → 立即 resolve，
  // 成功提示与抽屉打开都跑在素材真正入库之前（抽屉里看不到新素材），且失败被静默吞掉。
  // useCallback 稳定引用，避免下游 useCallback/useEffect 依赖每次渲染失效。
  const saveAssetToStore = useCallback(async (input: any): Promise<Asset | null> => {
    const asset = await addAsset(input);
    if (!asset) throw new Error('addAsset failed');
    return asset;
  }, [addAsset]);

  // 交互回调
  const interactions = useEditorInteractions({
    refs, state: { ...state, contextMenuItems }, actions, t, aiConfig,
    addAssetToStore: saveAssetToStore,
    canvasConfig: dialogs.canvasConfig,
    containerRef,
    setRenamingNodeId,
    setNodeCreateMenuPos,
    nodeCreateMenuPos,
    setContextMenuItems,
    setConnectionDrop: dialogs.setConnectionDrop,
    setDetailNode: dialogs.setDetailNode,
    setAssetPickerOpen: dialogs.setAssetPickerOpen,
    setReplaceNodeId: dialogs.setReplaceNodeId,
    replaceNodeId: dialogs.replaceNodeId,
    setReplaceAccept: dialogs.setReplaceAccept,
    replaceInputRef: dialogs.replaceInputRef,
    setGroupStyleDialog: dialogs.setGroupStyleDialog,
    onRenameGroup: dialogs.onRenameGroup,
  });

  // 空白右键「重置视图」:全图适配(fit-content)。左栏缩放菜单 fitScreen 仅是 100% 复位,
  // 此处才是真正「看到全部内容」;空图回退世界原点 (0,0) k=1(Plan#21 候选 B)
  // 本地版（Plan#83）：Agent 桥接层所需的 state/refs/dialogs refs 与 dock 开关状态已随整条链路移除

  const handleResetView = useCallback(() => {
    const store = state.editor?.store;
    if (!store) return;
    const graph = store.getGraph();
    // 2026-11-04 幽灵节点治理：重置视图只统计可见节点（墓碑不参与 bounds/空态）
    const visibleNodes = filterVisibleNodes(graph.nodes);
    if (visibleNodes.length === 0) {
      store.setViewport({ x: 0, y: 0, k: 1 });
      return;
    }
    // 全图 union:组用 getGroupBoundsWithEmptyFallback(含空组回退),普通节点 position+size(与多选聚焦同源)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      if (n.type === 'group') {
        const b = getGroupBoundsWithEmptyFallback(visibleNodes, n.id, interactions.getNodeSize);
        if (!b) continue;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      } else {
        const size = interactions.getNodeSize(n);
        minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + size.width); maxY = Math.max(maxY, n.position.y + size.height);
      }
    }
    if (!Number.isFinite(minX)) {
      store.setViewport({ x: 0, y: 0, k: 1 });
      return;
    }
    store.focusOnBounds(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      state.containerSize,
      400,
      51,
    );
  }, [state.editor, state.containerSize, interactions]);

  // 征集 #92:右下角 ZoomToolbar 及其适配器已移除——缩放回归底部工具条

  // 从 persistence 加载画布标题
  useEffect(() => {
    void (async () => {
      const project = await getProject(canvasId);
      if (project?.title) {
        dialogs.setTitle(project.title);
        dialogs.setTitleDraft(project.title);
        return;
      }
      // 本地版无协作参与者取标题路径：本地无元数据即保持默认标题
    })();
  }, [canvasId]);

  // ===== Helper Lines(对齐辅助线) 已按需求关闭绘制 =====
  useEffect(() => {
    const ctrl = refs.interactionController;
    if (!ctrl) return;
    // 关闭辅助线:不注册回调,避免绘制
    ctrl.setHelperLinesCallback(null);
    return () => ctrl.setHelperLinesCallback(null);
  }, [refs.interactionController]);

  // 画布拖拽落点处理(AssetPicker 素材 + 外部文件)
  const uploadQueueRef = useRef<UploadQueue | null>(null);
  if (!uploadQueueRef.current) {
    uploadQueueRef.current = new UploadQueue({ concurrency: 5, maxRetries: 2 });
  }
  const commandQueue = refs.commandQueue;
  // MCP 图片作业：网页在线时消费 .lf/.../image-jobs，把 MCP 生成的图落到当前实时画布
  useMcpImageJobs({ projectId: canvasId, commandQueue, store: refs.store });
  const { processFiles } = useUploadQueue(commandQueue, uploadQueueRef.current);
  // 组件卸载时重置队列
  useEffect(() => {
    return () => {
      uploadQueueRef.current?.reset();
    };
  }, []);
  // 上传菜单触发:隐藏 file input onChange → 调 processFiles(复用已有上传队列 + 自动建节点)
  const handleUploadFromInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void processFiles(Array.from(files), undefined, (nodes) => {
        // 上传完成后聚焦到上传的节点
        const store = refs.store;
        if (!store) return;
        if (nodes.length === 1) {
          const node = nodes[0];
          if (!node) return;
          const cs = containerRef.current
            ? { width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight };
          store.focusOnNode(node.id, cs, node.size?.width, node.size?.height, 400, 51);
        } else if (nodes.length > 1) {
          // 批量上传:计算所有节点的包围盒并聚焦
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const n of nodes) {
            const nx = n.position.x + (n.size?.width ?? 200);
            const ny = n.position.y + (n.size?.height ?? 100);
            if (n.position.x < minX) minX = n.position.x;
            if (n.position.y < minY) minY = n.position.y;
            if (nx > maxX) maxX = nx;
            if (ny > maxY) maxY = ny;
          }
          const cs = containerRef.current
            ? { width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }
            : { width: window.innerWidth, height: window.innerHeight };
          store.focusOnBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, cs, 400, 51);
        }
      });
    }
    // 重置 value,下次选相同文件也能触发 change
    e.target.value = '';
  }, [processFiles, refs.store, containerRef]);
  const dropHandlers = useDropHandler({
    refs,
    containerRef,
    processFiles,
    onError: (msg) => message.error(msg),
  });

  // 选中节点数据
  const selectedNodeData = state.selectedNodeData;
  const isPromptRunning = selectedNodeData?.status === 'loading';
  // 节点生成面板三态判定(Plan#33 延伸 + 2026-08-25 生成节点语义拍板):
  // - media 节点(text/image/video/audio)有实质内容(content/storageKey)且无上游 = 素材节点态 → 隐藏生成面板
  // - media 节点无内容 = 空节点/生成器态 → 显示生成面板;生成中(loading)强制保持面板(停止按钮)
  // - 只要选中节点有上游边连入(含生成成功后)= 生成节点态 → 始终显示面板,直到用户断开全部上游才降级为素材节点
  // - generator 等非 media 类型恒显示面板(节点自身语义即生成器)
  const selectedNodeIsMedia = state.selectedNodeType === 'image' || state.selectedNodeType === 'video' || state.selectedNodeType === 'audio' || state.selectedNodeType === 'text';
  const selectedNodeHasContent = !!selectedNodeData?.content || !!selectedNodeData?.storageKey;
  const selectedHasIncoming = !!state.selectedNodeId && !!state.editor
    && state.editor.store.getGraph().edges.some((e) => e.target.nodeId === state.selectedNodeId);
  // 图片节点生成完成后仍保留提示词/参数面板：用户要能回看、排查、微调后重生成；
  // 视频/音频/文本素材节点仍按原规则隐藏。
  const nodeDockVisible = !selectedNodeIsMedia
    || !selectedNodeHasContent
    || isPromptRunning
    || selectedHasIncoming
    || state.selectedNodeType === 'image';
  const handlers = useCanvasHandlers(refs, containerRef);

  // ===== 只读浏览手势 — 已提取到 ReadOnlyCanvasOverlay =====

  // 双击节点缩放
  const handleNodeDoubleClick = useCallback((nodeId: string, width: number, height: number) => {
    const store = state.editor?.store;
    if (!store?.focusOnNode) return;
    store.focusOnNode(nodeId, state.containerSize, width, height, 400, 51);
  }, [state.editor?.store, state.containerSize]);

  // 出片工作台页签联动打开资产抽屉（订阅页签 store）
  const hierarchyOpenRef = useRef(dialogs.setIsHierarchyOpen);
  useEffect(() => {
    hierarchyOpenRef.current = dialogs.setIsHierarchyOpen;
  });
  useEffect(() => {
    const unsub = useCanvasTabStore.subscribe((state, prevState) => {
      if (state.activeTabKey?.startsWith('workbench:') && state.activeTabKey !== prevState.activeTabKey) {
        hierarchyOpenRef.current(true);
      }
    });
    return unsub;
  }, []);
  // 上一个/下一个节点导航(nodeActionBus 事件)
  useEffect(() => {
    const unsubscribe = nodeActionBus.on('navigate', (event) => {
      const { nodeId } = event;
      if (!nodeId || !state.editor?.store) return;
      const graph = state.editor.store.getGraph();
      const targetNode = graph.nodes.find((n) => n.id === nodeId);
      if (!targetNode) return;
      const size = interactions.getNodeSize(targetNode as any);
      state.editor.store.focusOnNode(nodeId, state.containerSize, size.width, size.height, 400, 51);
    });
    return unsubscribe;
  }, [state.editor, state.containerSize, interactions]);

  // 堆叠卡片跨类型替换提示(征集#9 增强拍板):node-view 无法访问 message,经 nodeActionBus 通知(message 为顶层 useApp 实例)
  useEffect(() => {
    const unsubscribe = nodeActionBus.on('stackReplaceTypeChanged', (event) => {
      const { type } = event;
      if (type === 'image' || type === 'video' || type === 'audio') {
        message.info(t('nodes.stackReplaceTypeChanged', { type: t(`toolbar.${type}`) }));
      }
    });
    return unsubscribe;
  }, [t, message]);

  // 堆叠收纳/合并提示 — 已提取到 useStackToast
  useStackToast(t, message);

  /**
   * 主体 ↔ 画布（2026-11-12 起只保留状态级入口）：
   * - subject:sendStateToCanvas：状态卡「画布生成」→ 建 320×320 图片节点，
   *   只挂提示词与参考图 key，status 保持 idle，**不发起 API**；
   * - canvas:subject:open：点主体节点里的某张资产 → 切回主体库并选中该主体/状态。
   * 旧的主体级全局「发送到画布」（subject:sendToCanvas → stacked-media）已下线。
   */
  useEffect(() => {
    const unsubSendState = nodeActionBus.on('subject:sendStateToCanvas', (event) => {
      const store = refs.store;
      const cq = refs.commandQueue;
      if (!store || !cq) return;
      const detail = event as { name?: string; prompt?: string; storageKey?: string; referenceStorageKey?: string };
      const referenceKey = detail.referenceStorageKey ?? detail.storageKey;
      const vp = store.getViewport();
      const el = containerRef.current;
      const viewW = el?.clientWidth ?? 800;
      const viewH = el?.clientHeight ?? 600;
      const k = vp.k > 0 ? vp.k : 1;
      // 2026-11-13 用户指令：主体「画布生成」建 16:9 节点，参数预设 16:9 · 2K，并跳到画布
      const size = { width: 360, height: 203 };
      const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      cq.execute(new AddNodeCommand({
        id: nodeId,
        type: 'image',
        position: {
          x: (viewW / 2 - vp.x) / k - size.width / 2,
          y: (viewH / 2 - vp.y) / k - size.height / 2,
        },
        size,
        title: detail.name || '主体状态',
        data: {
          prompt: detail.prompt ?? '',
          content: '',
          status: 'idle',
          params: {
            aspectRatio: '16:9',
            resolution: '2k',
            // 标准 2K（16:9）= 2048×1152；Qwen 最长边也卡 2048，不再用 2816 的电商档
            size: { width: 2048, height: 1152 },
          },
          ...(referenceKey ? { referenceStorageKey: referenceKey } : {}),
        },
      } as NodeRecord));
      store.setSelection({ selectedNodeIds: new Set([nodeId]), selectedEdgeIds: new Set() });
      store.focusOnNode?.(nodeId, { width: viewW, height: viewH });
      navigateToView('canvas', { nodeId });
      // 切页签后再居一次：隐藏态拿到的容器尺寸可能为 0，等画布真正可见再校正
      requestAnimationFrame(() => {
        const el2 = containerRef.current;
        store.focusOnNode?.(nodeId, { width: el2?.clientWidth || viewW, height: el2?.clientHeight || viewH });
      });
      message.success('已添加到画布');
    });
    const unsubSendMedia = nodeActionBus.on('subject:sendMediaToCanvas', (event) => {
      const store = refs.store;
      const cq = refs.commandQueue;
      if (!store || !cq) return;
      const detail = event as { name?: string; storageKey?: string };
      const storageKey = detail.storageKey;
      if (!storageKey) return;
      const vp = store.getViewport();
      const el = containerRef.current;
      const viewW = el?.clientWidth ?? 800;
      const viewH = el?.clientHeight ?? 600;
      const k = vp.k > 0 ? vp.k : 1;
      const size = { width: 320, height: 320 };
      const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      cq.execute(new AddNodeCommand({
        id: nodeId,
        type: 'image',
        position: {
          x: (viewW / 2 - vp.x) / k - size.width / 2,
          y: (viewH / 2 - vp.y) / k - size.height / 2,
        },
        size,
        title: detail.name || '主体图片',
        data: {
          content: getResourceUrl(storageKey, 'preview') ?? storageKey,
          storageKey,
          status: 'idle',
        },
      } as NodeRecord));
      store.setSelection({ selectedNodeIds: new Set([nodeId]), selectedEdgeIds: new Set() });
      store.focusOnNode?.(nodeId, { width: viewW, height: viewH });
      navigateToView('canvas', { nodeId });
      message.success('已发送到画布');
    });
    const unsubOpen = nodeActionBus.on('canvas:subject:open', (event) => {
      const detail = event as { rootId?: string; stateId?: string };
      if (!detail.rootId) return;
      navigateToView('subject', { rootId: detail.rootId, stateId: detail.stateId });
    });
    return () => { unsubSendState(); unsubSendMedia(); unsubOpen(); };
  }, [refs.store, refs.commandQueue]);

  return (
    <ReadOnlyProvider value={isReadOnlyViewer}>
    <Layout style={layoutStyle(theme)}>
      {/* 版本号：统一放画布左下角（2026-11-12 用户要求） */}
      <div style={{ position: 'fixed', left: 12, bottom: 10, zIndex: 20 }}>
        <VersionBadge theme={theme} />
      </div>
      <div style={mainRowStyle}>
      <div style={mainColStyle}>
      <div style={headerStyle}>
        <TopBar
          title={dialogs.title}
          titleDraft={dialogs.titleDraft}
          isTitleEditing={dialogs.isTitleEditing}
          titleEditable={!isCollabGuest}
          onTitleDraftChange={dialogs.setTitleDraft}
          onStartTitleEditing={() => {
            if (isCollabGuest) return; // 参与者标题只读(元数据归房主)
            dialogs.setTitleDraft(dialogs.title); dialogs.setIsTitleEditing(true);
          }}
          onFinishTitleEditing={dialogs.handleFinishTitleEditing}
          onCancelTitleEditing={() => dialogs.setIsTitleEditing(false)}
          gridStyle={dialogs.background}
          onGridStyleChange={dialogs.setBackground}
          onOpenSettings={dialogs.onOpenSettings}
          keyboardShortcuts={keyboardShortcuts}
          isMobile={isMobile}
          onMobileNavOpen={() => dialogs.setMobileNavOpen(true)}
          isHierarchyOpen={dialogs.isHierarchyOpen}
          onToggleHierarchy={dialogs.toggleHierarchy}
          canvasMenu={
            <CanvasMenu
              theme={theme}
              onHome={onBack}
              onNewProject={() => void dialogs.handleNewProject()}
              onExportProject={() => {
                void (async () => {
                  try {
                    const project = await getProject(canvasId);
                    await exportProjects([canvasId], project?.title || 'zeroexo-project');
                    message.success(t('home.exportStarted', '已开始下载项目包'));
                  } catch {
                    message.error(t('home.exportFailed'));
                  }
                })();
              }}
              onCopyProject={() => void dialogs.handleCopyProject()}
              onDeleteProject={() => void dialogs.handleMenuDeleteProject()}
            />
          }
          syncBadge={!state.loading && CLOUD_ENABLED ? (
            <>
              <CreationSyncBadge
                status={status === 'syncing' ? 'saving' : status === 'error' ? 'error' : status === 'inactive' ? 'unsaved' : 'idle'}
                lastSavedAt={null}
                theme={theme}
                compact
              />
              {cloudUpdateAvailable && (
                <Tooltip title={t('editor.cloudUpdateTooltip')}>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await fullSync();
                          clearCloudUpdateAvailable();
                        } catch (err) {
                          console.error('[EditorPage] sync failed:', err);
                        }
                      })();
                    }}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: '#ef4444', border: 'none',
                      cursor: 'pointer', flexShrink: 0, padding: 0,
                    }}
                    aria-label={t('editor.cloudUpdateAvailable')}
                  />
                </Tooltip>
              )}
            </>
          ) : undefined}
        />
      </div>

      <Layout.Content style={contentLayoutStyle}>
        <div style={flexContainerStyle}>
          {/* 桌面端:资产抽屉(2026-08-29 约定)放在 Content 行内(Nav 下方),展开仅推开画布内容,
              不再整行推走 TopBar;HierarchyPanelSidebar 非 overlay 模式 flexShrink:0 占位推开右侧画布 */}
          {/* 2026-08-30 修复「资产抽屉打开状态下缩放窗口 → 剧本/分镜页签内容消失」:
              PC 抽屉与移动抽屉原为两个互斥 JSX 分支,useIsMobile 在 resize 翻转时
              抽屉组件被卸载重建,抽屉内 portal 出的编辑器内容随之销毁(页签在、内容空)。
              2026-08-29 的 hasScriptTabOpen 修复只覆盖「抽屉关闭」,未覆盖「响应式断点切换」。
              现合并为单一实例:包裹层用 style 切换(display:contents ↔ fixed),组件永不卸载。 */}
          {!state.loading && (dialogs.isHierarchyOpen || dialogs.isHierarchyClosing) && state.editor && refs.groupPlugin ? (
            <div
              style={
                isMobile
                  // 覆盖模式:fixed 全视口盖住顶栏 CanvasTabBar,避免资产抽屉分类 Tab
                  // 与画布页签条同时可见形成双重页签(征集 #95 / 2026-08-29 修正)
                  ? { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: HIERARCHY_OVERLAY_Z }
                  // 非覆盖模式:display:contents 不产生盒子,抽屉直接作为 flex item 占位推开画布,
                  // 布局行为与原先无包裹层时完全一致
                  : { display: 'contents' }
              }
            >
            <HierarchyPanelSidebar
              overlay={isMobile}
              // 2026-08-29 修复「资产面板关闭后剧本页签内容消失」:
              // 剧本编辑器由抽屉内 AssetLibraryPage 用 createPortal 挂到页签内容层,
              // 抽屉一卸载 portal 内容即消失(页签还在全局 store,于是「页签在、内容空」)。
              // 剧本页签开着时保持抽屉挂载但收起(closing=true → 宽度 0 不可见),内容得以保留。
              closing={dialogs.isHierarchyClosing || !dialogs.isHierarchyOpen}
              store={state.editor.store}
              groupPlugin={refs.groupPlugin}
              theme={theme}
              onSendToCanvas={dialogs.handleAssetInsert}
              onClose={dialogs.toggleHierarchy}
              onFocusNode={(nodeId) => {
                // Plan#50 T13:非画布页签激活时,点击层级节点先切回画布页签再聚焦(否则聚焦发生在被覆盖的画布上)
                activateTab(CANVAS_TAB_KEY);
                const store = state.editor?.store;
                if (!store?.focusOnNode) return;
                const graph = store.getGraph();
                const selection = store.getSelection();
                // 多选聚焦：使用所有选中节点的联合边界
                const selectedIds = Array.from(selection.selectedNodeIds).filter((id) => {
                  const n = graph.nodes.find((nd) => nd.id === id);
                  return n && n.type !== 'group';
                });
                if (selectedIds.length > 1) {
                  // 计算联合边界
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  for (const id of selectedIds) {
                    const node = graph.nodes.find((n) => n.id === id);
                    if (!node) continue;
                    if (node.type === 'group') {
                      const b = getGroupBoundsWithEmptyFallback(graph.nodes, id, interactions.getNodeSize);
                      if (b) {
                        minX = Math.min(minX, b.x);
                        minY = Math.min(minY, b.y);
                        maxX = Math.max(maxX, b.x + b.width);
                        maxY = Math.max(maxY, b.y + b.height);
                      }
                    } else {
                      const size = interactions.getNodeSize(node as any);
                      minX = Math.min(minX, node.position.x);
                      minY = Math.min(minY, node.position.y);
                      maxX = Math.max(maxX, node.position.x + size.width);
                      maxY = Math.max(maxY, node.position.y + size.height);
                    }
                  }
                  if (Number.isFinite(minX)) {
                    const unionW = maxX - minX;
                    const unionH = maxY - minY;
                    store.focusOnBounds(
                      { x: minX, y: minY, width: unionW, height: unionH },
                      state.containerSize,
                      400,
                      51,
                    );
                    return;
                  }
                }
                // 单节点聚焦
                const targetNode = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
                if (!targetNode) return;
                // 组节点使用 bounds 聚焦(含空组回退,避免聚焦到组 position 0,0 世界原点)
                if (targetNode.type === 'group') {
                  const bounds = getGroupBoundsWithEmptyFallback(graph.nodes, nodeId, interactions.getNodeSize);
                  if (bounds) {
                    // 画布结构定位：聚焦到组并固定 100%，避免只平移导致附近相似节点看不出变化
                    store.focusOnBounds(bounds, state.containerSize, 400, 51, 0.82, 1);
                    return;
                  }
                }
                // 普通节点聚焦：1 = 100%，不再按“适合屏幕”缩放
                const size = interactions.getNodeSize(targetNode as any);
                store.focusOnNode(nodeId, state.containerSize, size.width, size.height, 400, 51, 0.82, 1);
              }}
            />
            </div>
          ) : null}
          {/* 2026-11-04 单例槽位改造（推翻 2026-09-01 "页签随画布走"）：
              四个固定页签已挪回 TopBar 水平居中，画布列不再自渲染页签行 */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 画布级页签条（主画布固定 + 副本可关闭）：挂在画布区顶部，与线上版本活动页签同款。
              只在画布模块激活时出现；剧本/导演台页签时隐藏。 */}
          {(activeTabKey === CANVAS_TAB_KEY || isOpenCanvasTabKey(activeTabKey) || isImageTabKey(activeTabKey)) && <CanvasDocumentTabs />}
          {/* 画布区域(flex-1 自适应)
              Plan#50:页签激活时画布保持挂载与渲染(不可 display:none——CanvasView/ResizeObserver
              依赖可见尺寸,隐藏会导致视口/缩放异常),由覆盖层在画布之上承载页签内容 */}
          {/* 2026-08-29 修复穿透:页签激活时画布仍挂载(Plan#50 要求),但必须停止接收指针事件,
              否则画布层会截获本该属于页签内容的点击/拖拽(表现为「穿透」) */}
          <div ref={containerRef} style={{
            ...canvasAreaStyle,
            backgroundColor: theme.mode === 'dark' ? '#202020' : '#f0f0f0ff',
            pointerEvents: activeTabKey === CANVAS_TAB_KEY || isOpenCanvasTabKey(activeTabKey) ? 'auto' : 'none',
          }}>
            {/* 只读保护遮罩 — 已提取到 ReadOnlyCanvasOverlay */}
            <ReadOnlyCanvasOverlay
              editor={state.editor}
              containerSize={state.containerSize}
              getNodeSize={interactions.getNodeSize}
              isReadOnlyViewer={isReadOnlyViewer}
              loading={state.loading}
            />
            {state.loading ? (
              <LoadingOverlay background={theme.canvas.background} logoSize={48} onBackToHome={onBack} />
            ) : state.editor ? (
          <>
          <PinDefaultsProvider value={interactions.pinDefaults}>
          <NodeDefaultsProvider value={interactions.nodeDefaultsValue}>
          <GroupDefaultsProvider value={interactions.groupDefaultsValue}>
          <CanvasView
            store={state.editor.store}
            extensions={state.extensions}
            containerRef={containerRef}
            background={canvasEmpty ? 'none' : dialogs.background}
            backgroundColor={theme.mode === 'dark' ? '#202020' : '#f0f0f0ff'}
            gridDotColor={theme.canvas.gridDot}
            gridLineColor={theme.canvas.gridLine}
            gridSize={CANVAS_GRID_SIZE}
            edgeColor={theme.edge.color}
            edgeSelectedColor={theme.edge.selectedColor}
            edgeHoverColor={theme.edge.hoverColor}
            mode={state.interactionMode}
            commandQueue={refs.commandQueue!}
            forceShowPins={interactions.forceShowPins}
            connectionHoverNodeId={interactions.connectionHoverNodeId}
            hoveredNodeId={interactions.hoveredNodeId}
            externalRenaming={renamingNodeId}
            onRenameFinish={() => setRenamingNodeId(null)}
            onCanvasPointerDown={handlers.onCanvasPointerDown}
            onNodePointerDown={handlers.onNodePointerDown}
            onNodePointerEnter={handlers.onNodePointerEnter}
            onNodePointerLeave={handlers.onNodePointerLeave}
            onNodeTouchStart={handlers.onNodeTouchStart}
            onNodeTouchEnd={handlers.onNodeTouchEnd}
            onNodeTouchMove={handlers.onNodeTouchMove}
            onEdgePointerDown={handlers.onEdgePointerDown}
            onResizeHandlePointerDown={handlers.onResizeHandlePointerDown}
            onCutEdge={interactions.handleCutEdge}
            onCanvasContextMenu={interactions.handleCanvasContextMenu}
            contextMenuItems={contextMenuItems}
            onCanvasDrop={dropHandlers.onDrop}
            onCanvasDragOver={dropHandlers.onDragOver}
            
            onNodeDoubleClick={handleNodeDoubleClick}
            pinnedNodeIds={tabPinnedNodeIds}
            belowNodesLayer={
              refs.groupPlugin ? (
                <GroupLayer
                  store={state.editor.store}
                  controller={refs.groupPlugin.getController()}
                  getNodeSize={interactions.getNodeSize}
                  forceShowPins={interactions.forceShowPins}
                  onGroupPinPointerDown={handlers.onGroupPinPointerDown}
                  onGroupPinPointerEnter={handlers.onGroupPinPointerEnter}
                  onGroupPinPointerLeave={handlers.onGroupPinPointerLeave}
                  externalRenamingGroupId={renamingGroupId}
                  onRenameFinish={() => setRenamingGroupId(null)}
                  showHints={hintsEnabled}
                  onGroupDoubleClick={(groupId) => {
                    const store = state.editor?.store;
                    if (!store?.focusOnNode) return;
                    const graph = store.getGraph();
                    const targetNode = graph.nodes.find((n) => n.id === groupId);
                    if (!targetNode) return;
                    const bounds = getGroupBoundsWithEmptyFallback(graph.nodes, groupId, interactions.getNodeSize);
                    if (bounds) {
                      store.focusOnBounds(bounds, state.containerSize, 400, 51);
                    }
                  }}
                />
              ) : null
            }
          >
            {refs.selectionController && refs.connectionController ? (
              <CanvasOverlays
                store={state.editor.store}
                selectionController={refs.selectionController}
                connectionController={refs.connectionController}
              />
            ) : null}
            {/* 本地版（Plan#83）：协作光标层 / Agent 操作光标层随两条链路一并移除 */}
          </CanvasView>
          </GroupDefaultsProvider>
          </NodeDefaultsProvider>
          </PinDefaultsProvider>
          {/* 空画布引导态(2026-11-04):点阵网格(随视口)+中心辉光+居中提示,纯视觉层 */}
          <EmptyCanvasGuide store={state.editor.store} gridSize={CANVAS_GRID_SIZE} />
          {/* 画布节点数(内容信标 + 情境面板共用) */}
          {(() => {
            const canvasHasNodes = !!state.editor && filterVisibleNodes(state.editor.store.getGraph().nodes).length > 0;
            return (
            <>
            {/* 本地版：画布空态引导已下线，零节点时直接显示空画布 */}
            {/* 内容信标(征集#45):远离内容区时画布四周显示游戏任务指示点,点击回到内容丰富区 */}
            {!state.loading && state.editor && canvasHasNodes && (
              <ContentBeacon store={state.editor.store} containerSize={state.containerSize} />
            )}
            {/* 情境化快捷键面板(游戏式 Contextual Controls,随上下文动态显隐) */}
            {!state.loading && (
            <ContextualShortcutsPanel
              isGroupPreviewing={state.isGroupPreviewing}
              singleSelected={state.selectedCount === 1}
              singleSelectedInGroup={state.selectedInGroup}
              createMenuOpen={!!nodeCreateMenuPos}
              isStackedMedia={false}
              stackHasCards={false}
              hasIncomingPreviews={false}
              isStackableMedia={false}
              selectedNodeType={state.selectedNodeType as string | null}
              canvasHasNodes={canvasHasNodes}
              transient={refs.interactionController}
              keyboardShortcuts={keyboardShortcuts}
            />
            )}
            </>
            );
          })()}
          {/* Plan#20 T12a/T12b: 合并/拆分主体 Modal(事件驱动,useEditorInteractions 渲染) */}
          {interactions.subjectModals}
          {nodeCreateMenuPos ? (
            <NodeCreateMenu
              position={nodeCreateMenuPos}
              onSelect={interactions.handleNodeCreateMenuSelect}
              onClose={() => setNodeCreateMenuPos(null)}
              theme={theme}
              extraItems={[
                { key: 'upload', label: '上传素材', icon: <Upload size={14} />, onClick: () => fileInputRef.current?.click() },
                { key: 'reset-view', label: t('toolbar.resetView'), icon: <EDITOR_ICONS.resetView size={14} />, onClick: handleResetView },
                ...(hasClipboardContent() && state.editor
                  ? [{ key: 'paste', label: t('editor.paste'), icon: <ClipboardPaste size={14} />, onClick: () => {
                    pasteClipboard(state.editor!.store, state.editor!.core.commandQueue);
                  }}]
                  : []),
              ]}
            />
          ) : null}
        </>
        ) : null}

        {!state.loading && activeTabKey === CANVAS_TAB_KEY && (
        <LeftSideToolBar
          scale={state.scale}
          onScaleChange={actions.setScale}
          isMiniMapOpen={dialogs.isMiniMapOpen}
          onToggleMiniMap={() => dialogs.setIsMiniMapOpen((v: boolean) => !v)}
          onClear={dialogs.handleClearCanvasClick}
          interactionMode={state.interactionMode}
          onToggleInteractionMode={actions.toggleInteractionMode}
          isMobile={isMobile}
          onAddNode={actions.addNode}
          onUpload={() => fileInputRef.current?.click()}
        />
        )}

        {/* 跟随节点的悬浮白色胶囊工具栏(通用组件) */}
        {!state.loading && state.editor && interactions.toolContext ? (
          <NodeCapsuleToolbar
            nodeId={state.isGroupPreviewing ? null : state.selectedNodeId}
            store={state.editor.store}
            getExtension={interactions.getExtension}
            toolContext={interactions.toolContext}
            getGroupTools={interactions.getGroupTools}
            selectedCount={state.selectedCount}
            showMoveOut={state.selectedInGroup}
            onMoveOutGroup={interactions.handleMoveOutGroup}
            // Plan#84 入口 A2：框选多节点（未先成组）也能直接另存为画布副本
            onCreateCanvasCopy={() => { void interactions.handleCreateCanvasCopy(); }}
            isPreview={state.isGroupPreviewing}
            isMixedSelection={state.isMixedSelection}
            getAnchorBounds={interactions.getAnchorBounds}
            node={state.isGroupPreviewing ? interactions.previewGroupNode : undefined}
            onGroup={actions.groupSelected}
            onArrangeSmart={() => interactions.handleArrange('smart')}
            onArrangeGrid={() => interactions.handleArrange('grid')}
            onArrangeHorizontal={() => interactions.handleArrange('horizontal')}
            onArrangeVertical={() => interactions.handleArrange('vertical')}
            onAlign={(type: string) => interactions.handleAlign(type as any)}
            onUnifySizes={(type: string) => interactions.handleUnifySizes(type as any)}
            onSort={(type: string) => refs.layoutController?.sortSelection(type as any)}
            onStackSelected={interactions.handleStackSelected}
            /**
             * usePureIcon - 纯图标模式开关
             * false（默认）: icon + 文本标签
             * true: 仅显示 icon，隐藏文本标签
             * 后续如需切换纯 icon 模式，使用此 prop 传入 true 即可。
             */
            // usePureIcon={false}
          />
        ) : null}

        {/* 本地版（Plan#83）：dev-performance 面板与 AI 链路抽屉随该目录一并移除 */}

        {/* BUG5: RightSideToolBar 已移除 — 节点创建功能并入 LeftSideToolBar 加号菜单 */}

        {/* 2026-08-30:移动端抽屉分支已删除——与 PC 抽屉合并为单一实例(见上方 Content 行内抽屉)。
            原因:两个互斥分支会在 useIsMobile 翻转时卸载重建抽屉,导致其 portal 出的
            剧本/分镜编辑器内容消失。现在由同一实例的 overlay={isMobile} + 包裹层 style 切换承担。 */}

        {/* 小地图(桌面端右下角 / 移动端左下角上移,isMiniMapOpen 时显示) */}
        {/* 只读时 zIndex 提到 46 > 遮罩 45：小地图点击跳转是无害浏览导航，viewer 可用 */}
        {!state.loading && dialogs.isMiniMapOpen && state.editor && refs.nodesPlugin ? (
          <div style={isReadOnlyViewer ? { ...(isMobile ? mobileMinimapWrapStyle : minimapWrapStyle), zIndex: 46 } : (isMobile ? mobileMinimapWrapStyle : minimapWrapStyle)}>
            <MinimapView
              store={state.editor.store}
              registry={refs.nodesPlugin.getRegistry()}
              viewportSize={state.containerSize}
              onViewportChange={(vp) => state.editor?.store.setViewport(vp)}
              nodeFilter={interactions.minimapNodeFilter}
            />
          </div>
        ) : null}

        {/* 节点生成面板(吸附在选中节点正下方,生成器同款 UI)
            三态:media 资源态(有内容)隐藏,空节点/生成器态/生成中显示
            2026-09-04 方案 D++ 小步实验：script 节点加入 dock（text 可作上游输入）
            Plan#74 Phase B：storyboard 也加入 dock；script/storyboard 走 agent-proxy（点生成=投递Agent，无LLM设置） */}
        {!state.loading && state.editor && state.selectedNodeId && state.selectedNodeType && state.selectedNodeType !== 'workbench' && nodeDockVisible ? (
          <NodeGenerateDock
            key={state.selectedNodeId}
            nodeId={state.selectedNodeId}
            nodeType={state.selectedNodeType as 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard'}
            generationChannel={(state.selectedNodeType === 'script' || state.selectedNodeType === 'storyboard') ? 'agent-proxy' : 'direct-api'}
            accept={(state.selectedNodeType === 'script' || state.selectedNodeType === 'storyboard') ? TEXT_UPLOAD_ACCEPT : undefined}
            presetKind={state.selectedNodeType === 'script' ? 'script' : state.selectedNodeType === 'storyboard' ? 'storyboard' : undefined}
            store={state.editor.store}
            getAnchorBounds={interactions.getAnchorBounds}
            node={state.selectedNodeData}
            isMobile={isMobile}
            isRunning={isPromptRunning}
            initialPrompt={(selectedNodeData?.prompt as string) ?? ''}
            onPromptChange={interactions.handlePromptChange}
            onGenerate={interactions.handlePromptGenerate}
            onStop={interactions.handlePromptStop}
            configMode={interactions.selectedConfigMode}
            model={(selectedNodeData?.model as string) ?? ''}
            onConfigChange={interactions.handleNodeConfigChange}
            paramValues={(selectedNodeData?.paramValues as Record<string, any>) ?? {}}
            // 2026-11-13 用户要求：任何情况下画布提示词面板都不能默认隐藏（选中即可见/可编辑）
            defaultCollapsed={false}
          />
        ) : null}

        {/* 图片编辑独立页签（Photoshop 式）：覆盖画布区，自带工具栏；关闭/输出后回画布 */}
        {editingImageTab && (
          <div
            data-image-edit-host
            style={{
              position: 'absolute', inset: 0, zIndex: TAB_CONTENT_Z,
              pointerEvents: 'auto', overflow: 'hidden', background: theme.canvas.background,
            }}
          >
            {editingImageSource ? (
              <ImageEditWorkspace
                source={editingImageSource}
                initialMode={editingImageTab.mode}
                theme={theme}
                commandQueue={state.editor!.core.commandQueue}
                onClose={() => closeImageTab(activeTabKey)}
                getInsertOrigin={() => {
                  // 资产来源：输出节点落在当前视口中心（世界坐标）附近
                  const vp = refs.store?.getViewport();
                  const el = containerRef.current;
                  const viewW = el?.clientWidth ?? 800;
                  const viewH = el?.clientHeight ?? 600;
                  const k = vp?.k && vp.k > 0 ? vp.k : 1;
                  return {
                    x: (viewW / 2 - (vp?.x ?? 0)) / k - 180,
                    y: (viewH / 2 - (vp?.y ?? 0)) / k - 120,
                  };
                }}
                onNodesCreated={(nodeIds: string[]) => {
                  const firstId = nodeIds[0];
                  if (!refs.store || !firstId) return;
                  // 2026-11-08：三种工具统一「完成反馈」——选中结果节点 + 视口对准，
                  // 关闭页签回画布后用户立刻看得到刚生成的是哪张、在哪儿。
                  refs.store.setSelection({ selectedNodeIds: new Set(nodeIds), selectedEdgeIds: new Set() });
                  const el = containerRef.current;
                  refs.store.focusOnNode?.(firstId, {
                    width: el?.clientWidth ?? 800,
                    height: el?.clientHeight ?? 600,
                  });
                  // 切图多块：沿用成组预览确认
                  if (nodeIds.length >= 2 && refs.groupPlugin) {
                    const ctrl = refs.groupPlugin.getController();
                    if (ctrl.isPreviewing()) ctrl.confirmPreview(t('groupTools.defaultGroupName'));
                  }
                }}
                onGetNodeTitle={(type: string, batchIndex = 0, baseCount?: number) => {
                  if (!refs.store) return '';
                  const graph = refs.store.getGraph();
                  // 2026-11-04 幽灵节点治理：编号只统计可见节点（墓碑不占号）
                  const sameTypeCount = baseCount ?? filterVisibleNodes(graph.nodes).filter((n) => n.type === type).length;
                  const baseNameKey =
                    type === 'text' ? 'nodeTypes.text'
                      : type === 'image' ? 'nodeTypes.ai.image'
                        : type === 'video' ? 'nodeTypes.ai.video'
                          : type === 'audio' ? 'nodeTypes.ai.audio'
                            : 'nodes.generatorTitle';
                  return `${t(baseNameKey)}${sameTypeCount + 1 + batchIndex}`;
                }}
              />
            ) : (
              <div style={{ padding: 48, textAlign: 'center', fontSize: 13, color: theme.toolbar.textMuted }}>
                {t('imageEditor.nodeMissing', '图片节点已不存在')}
              </div>
            )}
          </div>
        )}

        {/* Plan#50:页签内容层挂载点——节点组件(剧本等)通过 createPortal 把子编辑器渲染到这里,
            数据/回调仍留在节点组件内;覆盖在画布之上,画布保持挂载渲染避免视口/WebGL 异常。
            2026-09-03 修改:去掉原左侧 1px 分隔线(不再需要区分画布区域)。
            2026-08-29 修复穿透:zIndex 30 低于画布内部浮层(只读遮罩 45 / 小地图 40 等),
            导致这些浮层盖在页签内容之上;提高到 100 确保页签内容位于最上层。 */}
        {activeTabKey !== CANVAS_TAB_KEY && !isOpenCanvasTabKey(activeTabKey) && !isImageTabKey(activeTabKey) && (
          <div
            ref={handleTabHostRef}
            style={{
              position: 'absolute', inset: 0, zIndex: TAB_CONTENT_Z,
              // 2026-08-29 修复:画布容器在页签激活时 pointer-events:none 会继承到本层,
              // 导致页签内剧本/分镜编辑器整体无法交互——显式恢复 auto
              pointerEvents: 'auto',
              overflow: 'hidden',
              background: theme.canvas.background,
            }}
          >
            {/* 本地版（2026-11-02）：剧本页签内容直接渲染（剧本=项目自带资产，不落画布节点）。
                2026-11-04 架构修复：主体库/导演台页签内容同为独立页面组件——直接读图数据，
                无载体节点时渲染空态，不再依赖"画布上存在节点 portal 注入"才能打开；
                Provider 让页级组件与节点组件共享同一 ReactGraphStore。 */}
            {state.editor ? (
              <ReactGraphStoreContext.Provider value={state.editor.store}>
                <ScriptTabContent onReinitScript={() => { void ensureScriptEntity(); }} />
                <StoryboardTabContent />
                <WorkbenchTabContent />
              </ReactGraphStoreContext.Provider>
            ) : null}
          </div>
        )}

        {/* 征集 #92 T26 验收修正二:画布底部「保存状态条」(CreationSyncBadge + 云端红点)已迁至顶栏标题旁(TopBar syncBadge) */}

        {/* 征集 #92:右下角独立 ZoomToolbar 移除——缩放百分比回归底部工具条 */}

        {/* 节点胶囊「详情」：媒体节点统一走主页资产同款查看器（MediaLightbox，图片/视频/文本）；
            非媒体节点（剧本/生成器/组等）保留节点详情面板 */}
        {dialogs.detailNode && (() => {
          const n = dialogs.detailNode as unknown as {
            id: string;
            type?: string;
            title?: string;
            data?: { kind?: string; storageKey?: string; url?: string; content?: string; title?: string };
          };
          const d = n.data ?? {};
          // 画布节点的 kind 在 node.type 上，data.kind 只是兼容字段；缺一不可，否则会掉回旧详情面板
          const nodeType = n.type;
          const kind: 'image' | 'video' | 'text' | null =
            d.kind === 'image' || d.kind === 'video' || d.kind === 'text'
              ? d.kind
              : nodeType === 'image' || nodeType === 'video' || nodeType === 'text'
                ? nodeType
                : null;
          const rawContent = typeof d.content === 'string' ? d.content : undefined;
          const directUrl = d.url ?? (rawContent && /^(blob:|data:|https?:)/.test(rawContent) ? rawContent : undefined);
          const hasMedia = !!kind && !!(d.storageKey || directUrl || (kind === 'text' && rawContent));
          if (kind && hasMedia) {
            return (
              <MediaLightbox
                items={[{
                  id: n.id,
                  title: n.title ?? d.title ?? '画布节点',
                  kind,
                  storageKey: d.storageKey,
                  url: directUrl,
                  content: kind === 'text' ? rawContent : undefined,
                  source: '画布节点',
                }]}
                index={0}
                onIndexChange={() => undefined}
                onClose={() => dialogs.setDetailNode(null)}
              />
            );
          }
          return <AssetDetailViewer node={dialogs.detailNode} onClose={() => dialogs.setDetailNode(null)} />;
        })()}

        {/* 本地版无协作审核待审：该 Modal 随 collaboration 移除 */}
        </div>
          </div>
      </div>
      </Layout.Content>
      </div>
      {/* 本地版（Plan#83）：Agent Dock / 画布上下文 Provider 整体移除——
          画布读写由外部 coding 工具经 MCP 直接操作数据目录完成 */}
      </div>

      {/* 设置弹窗(画布样式) */}
      <ConfigDialog
        open={dialogs.settingsOpen}
        onClose={() => dialogs.setSettingsOpen(false)}
        theme={theme}
        config={dialogs.canvasConfig}
        onConfirm={dialogs.onCanvasConfigConfirm}
      />

      {/* 画布资产 → 主体状态关联弹层(2026-11-04 主体库改造):
          挂在应用树内以获得 antd App 上下文(message 3 秒可撤销轻提示)与主题 */}
      <SubjectLinkDialogHost />



      {/* P2.1 ② replace 图片/视频/音频:隐藏文件输入(由 replace 工具触发 click) */}
      <input
        ref={dialogs.replaceInputRef}
        type="file"
        accept={dialogs.replaceAccept}
        style={{ display: 'none' }}
        onChange={interactions.handleReplaceFileChange}
      />

      {/* 组样式设置弹窗(背景色+透明度+圆角) */}
      {dialogs.groupStyleDialog && refs.groupPlugin ? (
        <GroupStyleDialog
          currentBgColor={dialogs.groupStyleDialog.currentBgColor}
          currentOpacity={dialogs.groupStyleDialog.currentOpacity}
          currentRadius={dialogs.groupStyleDialog.currentRadius}
          theme={theme}
          onClose={() => dialogs.setGroupStyleDialog(null)}
          onApply={(bgColor: string | undefined, opacity: number | undefined, radius: number | undefined) => {
            const ctrl = refs.groupPlugin!.getController();
            ctrl.setGroupBackground(dialogs.groupStyleDialog!.groupId, bgColor || undefined);
            ctrl.setNodeAppearance(dialogs.groupStyleDialog!.groupId, { opacity: typeof opacity === 'number' ? opacity : undefined });
            ctrl.setGroupBorderRadius(dialogs.groupStyleDialog!.groupId, typeof radius === 'number' ? radius : undefined);
          }}
        />
      ) : null}

      {/* 连线释放菜单(从 Pin 拖拽到空白区域松手时弹出) */}
      {dialogs.connectionDrop && refs.commandQueue ? (
        <ConnectionDropMenu
          commandQueue={refs.commandQueue}
          source={dialogs.connectionDrop.source}
          screenX={dialogs.connectionDrop.screenX}
          screenY={dialogs.connectionDrop.screenY}
          worldX={dialogs.connectionDrop.worldX}
          worldY={dialogs.connectionDrop.worldY}
          theme={theme}
          onClose={() => dialogs.setConnectionDrop(null)}
          connectionController={refs.connectionController}
        />
      ) : null}

      {/* P1.3 数据安全核心组:确认弹窗 */}
      {/* #4 删除当前画布 */}
      <ConfirmDialog
        open={dialogs.confirmDeleteProject}
        title={t('confirm.deleteCanvasTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmDeleteProject(false)}
        onConfirm={() => void dialogs.doDeleteProject()}
      >
        {t('confirm.deleteCanvasMessage')}
      </ConfirmDialog>

      {/* #5 清空画布 */}
      <ConfirmDialog
        open={dialogs.confirmClearCanvas}
        title={t('confirm.clearCanvasTitle')}
        confirmLabel={t('toolbar.clear')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmClearCanvas(false)}
        onConfirm={dialogs.doClearCanvas}
      >
        {t('confirm.clearCanvasMessage')}
      </ConfirmDialog>

      {/* #7 删除组 */}
      <ConfirmDialog
        open={dialogs.confirmDeleteGroupId !== null}
        title={t('confirm.deleteGroupTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => dialogs.setConfirmDeleteGroupId(null)}
        onConfirm={() => {
          if (dialogs.confirmDeleteGroupId && refs.groupPlugin) {
            refs.groupPlugin.getController().deleteSceneNode(dialogs.confirmDeleteGroupId);
          }
          dialogs.setConfirmDeleteGroupId(null);
        }}
      >
        {t('confirm.deleteGroupMessage')}
      </ConfirmDialog>

      {/* 批量上传队列覆盖层——仅云端/同步模式挂载（本地模式不渲染、不驻留组件） */}
      {CLOUD_ENABLED && <UploadQueueOverlay onRetryFailed={processFiles} />}

      {/* 上传菜单触发用的隐藏 file input —— 加号菜单 / 空白右键菜单「上传素材」共用 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.txt,.json,.md,.csv"
        style={{ display: 'none' }}
        onChange={handleUploadFromInput}
      />

      {/* 2026-11-04 本地版移除「历史版本」：版本历史抽屉（含保存/回退）已下线 */}

      {/* 移动端统一浮动导航按钮(与主页/创作/画布列表保持位置一致) */}
      {isMobile && (
        <MobileNavFloatingWrapper>
          <MobileNavButton onClick={() => dialogs.setMobileNavOpen(true)} />
        </MobileNavFloatingWrapper>
      )}

      {/* 移动端统一导航抽屉(与主页/创作/画布列表共享框架) */}
      {isMobile && (
        <MobileNavDrawer
          theme={theme}
          open={dialogs.mobileNavOpen}
          onClose={() => dialogs.setMobileNavOpen(false)}
          projectActions={dialogs.mobileNavProjectActions}
          onProjectAction={dialogs.handleMobileProjectAction}
          onOpenShortcuts={() => dialogs.setMobileShortcutsOpen(true)}
          onOpenSettings={() => dialogs.onOpenSettings()}
          onOpenAppearance={() => dialogs.setMobileAppearanceOpen(true)}
          onOpenLanguage={() => setMobileLanguageOpen(true)}
          isAuthenticated={isAuthenticated}
          onLogout={async () => {
            await logout();
            onBack();
          }}
        />
      )}

      {/* 移动端换肤弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && dialogs.mobileAppearanceOpen ? (
        <AppearanceDialog
          theme={theme}
          currentMode={theme.mode}
          gridStyle={dialogs.background}
          onGridStyleChange={dialogs.setBackground}
          onClose={() => dialogs.setMobileAppearanceOpen(false)}
        />
      ) : null}

      {/* 移动端语言弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && mobileLanguageOpen ? (
        <LanguageDialog
          theme={theme}
          currentLang={(i18n.language as any) || 'zh'}
          onClose={() => setMobileLanguageOpen(false)}
        />
      ) : null}

      {/* 移动端快捷键弹窗(由 MobileNavDrawer 触发) */}
      {isMobile && dialogs.mobileShortcutsOpen ? (
        <ShortcutsDialog
          theme={theme}
          onClose={() => dialogs.setMobileShortcutsOpen(false)}
          isMobile={isMobile}
          shortcuts={keyboardShortcuts}
        />
      ) : null}
    </Layout>
    </ReadOnlyProvider>
  );
}

function layoutStyle(theme: ReturnType<typeof useTheme>['theme']): CSSProperties {
  // R3: 根 Layout 是 AppLayout Content(flex) 的 flex item,必须显式撑满——
  // 否则宽度收缩到内容 max-content(画布节点为绝对定位不参与计算),
  // AgentDock 脱离视口右缘,右侧露出大片空白
  return { position: 'relative', height: '100%', width: '100%', flex: 1, overflow: 'hidden', background: theme.canvas.background };
}
const headerStyle: CSSProperties = { minHeight: 45, background: 'transparent', padding: 0, lineHeight: '45px', position: 'relative', zIndex: 100 };
/**
 * 资产抽屉覆盖模式（移动端 fixed 包裹层）层级。
 * 需高于顶栏 CanvasTabBar（headerStyle zIndex 100）以盖住页签条、避免双重页签；
 * 2026-08-31 修复：须高于出片工作台全屏（Z_INDEX.FULLSCREEN=30000），否则移动端抽屉被出片遮挡。
 */
const HIERARCHY_OVERLAY_Z = Z_INDEX.DRAWER_OVERLAY;
/**
 * 画布页签内容层层级：必须 **高于** HIERARCHY_OVERLAY_Z，
 * 否则移动端抽屉会盖住剧本/分镜编辑器内容（视觉上等同「内容消失」）。
 * 同时需高于画布内浮层：只读遮罩 45 / 小地图 40（2026-08-29 修复）。
 */
const TAB_CONTENT_Z = 310;
const contentLayoutStyle: CSSProperties = { position: 'relative', overflow: 'hidden' };
const flexContainerStyle: CSSProperties = { display: 'flex', width: '100%', height: '100%', overflow: 'hidden' };
// 顶层行布局:右列(TopBar + 内容)。PC 资产抽屉已移入 Content 行内(2026-08-29),
// 展开只推开画布内容,不再把顶部 NAV 一起推走
const mainRowStyle: CSSProperties = { display: 'flex', flex: 1, width: '100%', height: '100%', minWidth: 0, minHeight: 0, overflow: 'hidden' };
const mainColStyle: CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 };
// 画布区域: touchAction none 关键——移动端单指拖节点/平移时禁止浏览器原生滚动
// （2026-08-25 修复：拖节点时页面跟着滚动；只读遮罩已带 none，编辑态补齐）
// 2026-09-03 修改：画布左右保留 10px 留白，关闭资产抽屉后画布不与内容区边缘贴死
const canvasAreaStyle: CSSProperties = { flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden', touchAction: 'none', margin: '0 10px', ...WORKSPACE_SURFACE_STYLE };
// BUG3b: 小地图移到右下角,避免被左侧工具栏(LeftSideToolBar)遮挡
const minimapWrapStyle: CSSProperties = {
  position: 'absolute', right: 20, bottom: 20, zIndex: 40,
  width: 240, height: 160,
  borderRadius: 12, overflow: 'hidden',
  border: `1px solid rgba(255,255,255,0.1)`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};
// 移动端:小地图放左下角并上移,避开底部横向工具栏
// zIndex 提高到 250,确保显示在 LeftSideToolBar(zIndex 200)之上
const mobileMinimapWrapStyle: CSSProperties = {
  position: 'absolute', left: 12, bottom: 'calc(max(12px, env(safe-area-inset-bottom)) + 72px)', zIndex: 250,
  width: 200, height: 140,
  borderRadius: 12, overflow: 'hidden',
  border: `1px solid rgba(255,255,255,0.1)`,
  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
};

