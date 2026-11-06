/**
 * CanvasWorkspace - 副本画布工作区（Plan#84，2026-11-06）
 *
 * = 项目的**另一份画布**（不是"新页面"）：与 1 号主画布并排在顶层标签里，× 掉就回 1 号。
 *
 * 为什么还要第二个引擎实例：副本要有自己的 undo 栈、自己的选中态、自己的视口，
 * 又不能和主画布互相踩。按 Spec §7 S1 静态结论用三开关隔离：
 * `enablePersistence:false`（不与主画布抢 `graph:<pid>` 键，落盘由 canvas-store 负责）、
 * `enableKeyboard:false`（不重复注册 window 级快捷键，否则一次 Ctrl+Z 撤两步）、`enableMinimap:false`。
 *
 * 读写全部走 `entities/canvas-store.ts`：副本文件带 size/lastModified 乐观锁；
 * 冲突（MCP 或手改过文件）→ 暂停自动保存并弹**居中**确认框：重载外部版 / 保留本地并覆盖。
 * 1 号主画布永远不走这里（它就是固定槽位，由 editor-page 的主实例渲染）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Dropdown, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { History, Maximize2, Plus, Redo2, Undo2 } from 'lucide-react';
import { AddNodeCommand } from '@zeroexo/core';
import type { GraphModel, NodeRecord } from '@zeroexo/core';
import type { ThemeConfig } from '@zeroexo/shared';
import { CanvasView, NodeDefaultsProvider, PinDefaultsProvider } from '@zeroexo/plugin-render-react';
import { GroupDefaultsProvider } from '@zeroexo/plugin-group';
import { createDefaultEditor } from '@zeroexo/preset-default';
import type { DefaultEditor } from '@zeroexo/preset-default';
import { DirectProvider } from '@zeroexo/plugin-ai-provider';
import { getCanvas, isCanvasConflict, saveCanvas, type CanvasStamp } from '@/entities/canvas-store.js';
import { canConnect } from '@/shared/connection-rules.js';
import { configToGroupDefaults, configToNodeDefaults, configToPinDefaults, loadCanvasConfig } from '@/features/top-bar/index.js';
import { useAiConfigStore, resolveModelRequestConfig } from '@/features/ai-config/use-ai-config-store.js';
import { useCanvasHandlers } from '@/features/canvas-interaction/use-canvas-handlers.js';
import { useDropHandler } from '@/features/canvas-interaction/drop-handler.js';
import type { EditorRefs } from '@/pages/editor/editor-canvas/use-editor-state.js';
import { createCreationExtensions } from '@/features/canvas-nodes/extensions.js';
import { createColorCardExtension } from '@/features/canvas-nodes/color-card/color-card-extension.js';
import { buildNewNodeData, newNodeTitle } from '@/features/canvas-nodes/new-node.js';

export interface CanvasWorkspaceProps {
  projectId: string;
  /** 副本画布 id（'main' 不走这里） */
  cid: string;
  theme: ThemeConfig;
  isDark: boolean;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

/** 副本工作区可选的新建类型（只开生成素材四件；剧创单例槽位全项目唯一，不进这里） */
const CREATABLE: { type: string; labelKey: string; fallback: string }[] = [
  { type: 'text', labelKey: 'nodeTypes.text', fallback: '文本' },
  { type: 'image', labelKey: 'nodeTypes.ai.image', fallback: '图片' },
  { type: 'video', labelKey: 'nodeTypes.ai.video', fallback: '视频' },
  { type: 'audio', labelKey: 'nodeTypes.ai.audio', fallback: '语音' },
];

export function CanvasWorkspace({ projectId, cid, theme, isDark }: CanvasWorkspaceProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<DefaultEditor | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const stampRef = useRef<CanvasStamp | null>(null);
  /** 冲突未决 → 暂停自动保存（禁止静默覆盖外部修改） */
  const conflictRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  // ===== 1. 实例创建（每个副本一个，卸载即 cleanup） =====
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const aiProvider = new DirectProvider({
      resolveConfig: (modelValue: string) => resolveModelRequestConfig(useAiConfigStore.getState().config, modelValue),
      isReady: () => useAiConfigStore.getState().config.channels.some((c) => !!c.apiKey),
    });
    const ed = createDefaultEditor({
      container: el,
      storageKey: `zeroexo:canvas:${cid}`,
      enablePersistence: false,
      enableKeyboard: false,
      enableMinimap: false,
      aiProvider,
    });
    ed.plugins.nodes.registerAll([
      ...createCreationExtensions(ed.plugins.connection?.getController() ?? null, () => ed.store),
      createColorCardExtension(ed.plugins.connection?.getController() ?? null),
    ]);
    const nodeRegistry = ed.core.plugins.get<any>('node-registry');
    const cc = ed.plugins.connection?.getController();
    if (nodeRegistry && cc) {
      cc.setExtensionAccessor((nodeId: string) => {
        const node = ed.store.getGraph().nodes.find((n) => n.id === nodeId);
        return node ? nodeRegistry.get(node.type) : undefined;
      });
    }
    cc?.setCompatibilityChecker(canConnect);
    setEditor(ed);
    return () => {
      ed.cleanup();
      setEditor(null);
    };
  }, [cid]);

  // ===== 2. refs / handlers（复用主画布同一套 interaction 逻辑，只换实例） =====
  const refs = useMemo<EditorRefs>(() => ({
    store: editor?.store ?? null,
    commandQueue: editor?.core.commandQueue ?? null,
    interactionController: editor ? editor.plugins.interaction.getController() : null,
    connectionController: editor ? editor.plugins.connection.getController() : null,
    selectionController: editor ? editor.plugins.selection.getController() : null,
    layoutController: editor ? editor.plugins.layout.getController() : null,
    nodesPlugin: editor?.plugins.nodes ?? null,
    groupPlugin: editor?.plugins.group ?? null,
    aiProvider: editor?.plugins.aiProvider ?? null,
    contextMenuController: null,
  }), [editor]);

  const handlers = useCanvasHandlers(refs, containerRef);
  const dropHandlers = useDropHandler({ refs, containerRef });

  const getNodeSize = useCallback((node: NodeRecord) => {
    const ext = editor?.plugins.nodes.all().find((e) => e.type === node.type);
    return {
      width: node.size?.width ?? ext?.defaultSize?.width ?? 260,
      height: node.size?.height ?? ext?.defaultSize?.height ?? 150,
    };
  }, [editor]);

  /** 首次进入把内容拉到视口中央（副本保留原世界坐标，所以这里只做视图 fit，不改坐标） */
  const fitToContent = useCallback((graph: GraphModel) => {
    const store = editor?.store;
    const el = containerRef.current;
    if (!store || !el) return;
    const nodes = graph.nodes.filter((n) => !n._deleted);
    if (nodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const size = getNodeSize(n);
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + size.width);
      maxY = Math.max(maxY, n.position.y + size.height);
    }
    const rect = el.getBoundingClientRect();
    store.focusOnBounds(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      { width: rect.width, height: rect.height },
      0,
      60,
    );
  }, [editor, getNodeSize]);

  /** 在视口中心新建节点（标题与默认 data 走 new-node.ts，与主画布同一形状） */
  const addNodeAtCenter = useCallback((type: string) => {
    const ed = editor;
    if (!ed) return;
    const vp = ed.store.getViewport();
    const k = vp.k > 0 ? vp.k : 1;
    const rect = containerRef.current?.getBoundingClientRect();
    const worldX = ((rect?.width ?? 800) / 2 - vp.x) / k;
    const worldY = ((rect?.height ?? 600) / 2 - vp.y) / k;
    const sameTypeCount = ed.store.getGraph().nodes.filter((n) => n.type === type && !n._deleted).length;
    const nodeTitle = newNodeTitle(type, sameTypeCount, t);
    ed.core.commandQueue.execute(new AddNodeCommand({
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      position: {
        x: Math.round(worldX - 100 + (Math.random() - 0.5) * 80),
        y: Math.round(worldY - 60 + (Math.random() - 0.5) * 80),
      },
      title: nodeTitle,
      data: buildNewNodeData(type, nodeTitle, t),
    } as NodeRecord));
  }, [editor, t]);

  // ===== 3. 冲突处理（先于 flushSave 定义） =====
  const askConflictResolution = useCallback(() => {
    const ed = editor;
    if (!ed) return;
    modal.confirm({
      title: t('canvasCopy.conflictTitle', '这份画布文件已被外部修改'),
      content: t('canvasCopy.conflictBody', '磁盘上的画布与编辑器内内容不一致（MCP 或手动改过文件）。请选择保留哪一份。'),
      // 项目口径：所有确认弹窗屏幕居中
      centered: true,
      okText: t('canvasCopy.conflictReload', '重载外部版本'),
      cancelText: t('canvasCopy.conflictKeepLocal', '保留本地并覆盖'),
      onOk: async () => {
        const got = await getCanvas(projectId, cid);
        if (got) {
          stampRef.current = got.stamp;
          ed.core.commandQueue.replaceState(got.graph);
        }
        conflictRef.current = false;
        message.success(t('canvasCopy.conflictReloaded', '已重载磁盘上的画布'));
      },
      onCancel: async () => {
        await saveCanvas(projectId, cid, { graph: ed.store.getGraph() }, null);
        const got = await getCanvas(projectId, cid);
        stampRef.current = got?.stamp ?? null;
        conflictRef.current = false;
        message.success(t('canvasCopy.conflictOverwritten', '已用编辑器内容覆盖磁盘文件'));
      },
    });
  }, [editor, projectId, cid, modal, message, t]);

  // ===== 4. 载入画布 =====
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    conflictRef.current = false;
    setStatus('loading');
    void (async () => {
      try {
        const got = await getCanvas(projectId, cid);
        if (cancelled) return;
        if (!got) {
          stampRef.current = null;
          setStatus('missing');
          return;
        }
        stampRef.current = got.stamp;
        // replaceState 不进撤销栈（载入不是用户编辑）
        editor.core.commandQueue.replaceState(got.graph);
        setStatus('ready');
        fitToContent(got.graph);
      } catch (err) {
        if (cancelled) return;
        console.error('[CanvasWorkspace] load failed:', err);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [editor, projectId, cid, fitToContent]);

  // ===== 5. 自动保存（graph 变更 → debounce 写盘，带乐观锁） =====
  const flushSave = useCallback(async () => {
    const ed = editor;
    if (!ed || conflictRef.current) return;
    const graph = ed.store.getGraph();
    try {
      const next = await saveCanvas(projectId, cid, { graph }, stampRef.current);
      const got = await getCanvas(projectId, cid);
      stampRef.current = got?.stamp ?? null;
      void next;
    } catch (err) {
      if (isCanvasConflict(err)) {
        conflictRef.current = true;
        askConflictResolution();
        return;
      }
      console.error('[CanvasWorkspace] save failed:', err);
      message.error(t('canvasCopy.saveFailed', '画布保存失败，请重试'));
    }
  }, [editor, projectId, cid, askConflictResolution, message, t]);

  useEffect(() => {
    if (!editor || status !== 'ready') return;
    const store = editor.store;
    const schedule = () => {
      setCanUndo(editor.plugins.history.canUndo());
      setCanRedo(editor.plugins.history.canRedo());
      if (conflictRef.current) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => { void flushSave(); }, 500);
    };
    const unsubGraph = store.subscribeGraph(schedule);
    return () => {
      unsubGraph();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [editor, status, flushSave]);

  // ===== 6. 外观默认（与主画布同一 canvasConfig + theme 注入，避免两套视觉） =====
  const canvasConfig = useMemo(() => loadCanvasConfig(), []);
  const pinDefaults = useMemo(() => ({
    ...configToPinDefaults(canvasConfig),
    color: theme.node.pinDefaultColor,
  }), [canvasConfig, theme]);
  const nodeDefaults = useMemo(() => configToNodeDefaults(canvasConfig, theme), [canvasConfig, theme]);
  const groupDefaults = useMemo(() => configToGroupDefaults(canvasConfig, theme), [canvasConfig, theme]);

  const extensions = useMemo(() => {
    const map = new Map<string, import('@zeroexo/core').NodeTypeExtension>();
    if (editor) for (const ext of editor.plugins.nodes.all()) map.set(ext.type, ext);
    return map;
  }, [editor]);

  const statusText = status === 'ready'
    ? t('canvasCopy.autoSaved', '自动保存到本地目录')
    : status === 'missing'
      ? t('canvasCopy.missing', '画布文件缺失')
      : status === 'error'
        ? t('canvasCopy.error', '画布加载失败')
        : t('common.loading', '加载中…');

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        data-canvas-workspace-toolbar
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', flexShrink: 0,
          borderBottom: `1px solid ${theme.toolbar.border ?? 'rgba(127,127,127,0.25)'}`,
          background: theme.toolbar.panel ?? 'transparent',
        }}
      >
        <Tooltip title={t('canvasCopy.undo', '撤销')}>
          <Button size="small" type="text" icon={<Undo2 size={14} />} disabled={!canUndo} onClick={() => editor?.plugins.history.undo()} />
        </Tooltip>
        <Tooltip title={t('canvasCopy.redo', '重做')}>
          <Button size="small" type="text" icon={<Redo2 size={14} />} disabled={!canRedo} onClick={() => editor?.plugins.history.redo()} />
        </Tooltip>
        <Tooltip title={t('canvasCopy.fit', '适应内容')}>
          <Button
            size="small"
            type="text"
            icon={<Maximize2 size={14} />}
            onClick={() => { if (editor) fitToContent(editor.store.getGraph()); }}
          />
        </Tooltip>
        <Dropdown
          trigger={['click']}
          disabled={status !== 'ready'}
          menu={{
            items: CREATABLE.map((o) => ({ key: o.type, label: t(o.labelKey, o.fallback) })),
            onClick: ({ key }) => addNodeAtCenter(String(key)),
          }}
        >
          <Button size="small" type="text" data-canvas-create-menu icon={<Plus size={14} />} disabled={status !== 'ready'}>
            {t('canvasCopy.newNode', '新建')}
          </Button>
        </Dropdown>
        <span style={{ flex: 1 }} />
        <span data-canvas-workspace-status style={{ fontSize: 11, color: theme.toolbar.textMuted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <History size={12} />
          {statusText}
        </span>
      </div>

      <div
        ref={containerRef}
        data-canvas-workspace
        style={{
          flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', touchAction: 'none',
          backgroundColor: isDark ? '#1b1c1f' : '#f4f4f5',
        }}
      >
        {editor && status !== 'missing' && (
          <PinDefaultsProvider value={pinDefaults}>
            <NodeDefaultsProvider value={nodeDefaults}>
              <GroupDefaultsProvider value={groupDefaults}>
                <CanvasView
                  store={editor.store}
                  extensions={extensions}
                  containerRef={containerRef}
                  backgroundColor={isDark ? '#1b1c1f' : '#f4f4f5'}
                  gridDotColor={theme.canvas?.gridDot}
                  gridLineColor={theme.canvas?.gridLine}
                  edgeColor={theme.edge?.color}
                  edgeSelectedColor={theme.edge?.selectedColor}
                  edgeHoverColor={theme.edge?.hoverColor}
                  commandQueue={editor.core.commandQueue}
                  mode="select"
                  onCanvasPointerDown={handlers.onCanvasPointerDown}
                  onNodePointerDown={handlers.onNodePointerDown}
                  onNodePointerEnter={handlers.onNodePointerEnter}
                  onNodePointerLeave={handlers.onNodePointerLeave}
                  onNodeTouchStart={handlers.onNodeTouchStart}
                  onNodeTouchEnd={handlers.onNodeTouchEnd}
                  onNodeTouchMove={handlers.onNodeTouchMove}
                  onEdgePointerDown={handlers.onEdgePointerDown}
                  onResizeHandlePointerDown={handlers.onResizeHandlePointerDown}
                  onCanvasDrop={dropHandlers.onDrop}
                  onCanvasDragOver={dropHandlers.onDragOver}
                />
              </GroupDefaultsProvider>
            </NodeDefaultsProvider>
          </PinDefaultsProvider>
        )}

        {status === 'loading' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted }}>{t('common.loading', '加载中…')}</span>
          </div>
        )}
        {status === 'missing' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: 24, textAlign: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.toolbar.text }}>{t('canvasCopy.missingTitle', '画布文件缺失')}</span>
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted, maxWidth: 420 }}>
              {t('canvasCopy.missingBody', 'projects/{{pid}}/canvases/{{cid}}.json 不存在（可能被外部删除或移动）。关闭本页签不会影响 1 号画布。', { pid: projectId, cid })}
            </span>
          </div>
        )}
        {status === 'error' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, color: theme.toolbar.danger ?? theme.toolbar.text }}>{t('canvasCopy.error', '画布加载失败')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
