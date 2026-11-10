/**
 * ImageEditWorkspace - 图片编辑独立页签（2026-11-06 用户定稿：像 Photoshop 一样编辑该图）
 *
 * 结构：顶部工具栏（裁剪 / 分割 / 局部遮罩 + 返回画布）+ 编辑工作区（左侧画布舞台 / 右侧属性面板，
 * 由各编辑器 inline 布局提供）。编辑器内容体复用插件包 `inline` 模式，不写第二套 UI。
 *
 * 两种来源：
 * - `node`：编辑画布上的图片节点，输出落在该节点右侧（与旧逻辑一致）；
 * - `asset`：抽屉素材/历史产出直接编辑，**不先把资产加成画布节点**；确认输出时才在
 *   视口中心附近创建结果节点（"编辑结果落在画布"）。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Tooltip } from 'antd';
import { ArrowLeft, Brush, Grid2x2, Paintbrush, Scissors } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { CropDialog, SplitDialog, MaskEditDialog, PaintDialog } from '@zeroexo/plugin-image-editor';
import type { CropRect, SplitParams } from '@zeroexo/plugin-image-editor';
import { applyCrop, applyMaskEdit, applyPaint, applySplit } from './image-edit-actions.js';
import { generateLocalQwenImage } from '@/pages/editor/editor-canvas/interactions/local-qwen-image.js';
import { QWEN_DEFAULT_STEPS } from '@/features/canvas-tabs/qwen-limits.js';
import { useTaskQueueStore } from '@/features/task-center/task-queue-store.js';

export type ImageEditTool = 'crop' | 'split' | 'maskEdit' | 'paint';

export interface ImageEditNodeSource {
  kind: 'node';
  node: NodeRecord;
}

export interface ImageEditAssetSource {
  kind: 'asset';
  assetId: string;
  title: string;
  storageKey?: string;
  content?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export type ImageEditSource = ImageEditNodeSource | ImageEditAssetSource;

export interface ImageEditWorkspaceProps {
  source: ImageEditSource;
  /** 进入页签时默认工具（点哪个入口就进哪个） */
  initialMode?: ImageEditTool;
  theme: ThemeConfig;
  commandQueue: CommandQueue;
  /** 关闭页签并回到画布 */
  onClose: () => void;
  /** 资产来源：输出节点落点（视口中心的世界坐标）；缺省回退画布原点 */
  getInsertOrigin?: () => { x: number; y: number };
  onNodesCreated?: (nodeIds: string[]) => void;
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}

const TOOLS: { id: ImageEditTool; labelKey: string; fallback: string; icon: React.ReactNode }[] = [
  { id: 'crop', labelKey: 'imageEditor.toolCrop', fallback: '裁剪', icon: <Scissors size={14} /> },
  { id: 'split', labelKey: 'imageEditor.toolSplit', fallback: '分割', icon: <Grid2x2 size={14} /> },
  { id: 'maskEdit', labelKey: 'imageEditor.toolMask', fallback: '局部', icon: <Brush size={14} /> },
  { id: 'paint', labelKey: 'imageEditor.toolPaint', fallback: '涂抹', icon: <Paintbrush size={14} /> },
];

export function ImageEditWorkspace({
  source,
  initialMode = 'crop',
  theme,
  commandQueue,
  onClose,
  getInsertOrigin,
  onNodesCreated,
  onGetNodeTitle,
}: ImageEditWorkspaceProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [mode, setMode] = useState<ImageEditTool>(initialMode);
  /** 已确认输出：避免编辑器确认后回调 onClose 被误判成「放弃编辑」 */
  const completedRef = useRef(false);

  const nodeSource = source.kind === 'node' ? source : null;
  const assetSource = source.kind === 'asset' ? source : null;
  const node = nodeSource?.node ?? null;
  const nodeData = (node?.data ?? {}) as { content?: string; storageKey?: string; title?: string };
  const storageKey = nodeSource ? nodeData.storageKey : assetSource?.storageKey;
  const rawDataUrl = nodeSource ? (nodeData.content ?? '') : (assetSource?.content ?? '');
  const dataUrl = useHydratedContent(storageKey, rawDataUrl);
  const title = nodeSource
    ? (nodeSource.node.title || nodeData.title || t('imageEditor.tabTitle', '图片编辑'))
    : (assetSource?.title ?? t('imageEditor.tabTitle', '图片编辑'));

  /**
   * 资产来源：结果节点标题前带上被编辑的资产名。
   * 页签关闭后画布上仍能一眼认出这张结果来自哪张图（不靠通名「AI 图片 N」猜）。
   */
  const resultTitle = (type: string, batchIndex?: number, baseCount?: number): string => {
    const base = onGetNodeTitle?.(type, batchIndex, baseCount) ?? '';
    return assetSource ? `${assetSource.title} · ${base}` : base;
  };

  /** 放弃：与「完成」明确区分，关闭后画布不留任何节点 */
  const abandonEdit = useCallback(() => {
    if (!completedRef.current) {
      message.info(t('imageEditor.editAbandoned', {
        title,
        defaultValue: '「{{title}}」的编辑已放弃，未生成结果',
      }));
    }
    onClose();
  }, [message, t, onClose, title]);

  /** 完成：选中并聚焦结果节点 + 成功提示，再关闭页签回画布 */
  const completeEdit = (ids: string[]): void => {
    completedRef.current = true;
    if (ids.length > 0) onNodesCreated?.(ids);
    message.success(t('imageEditor.editDone', {
      title,
      defaultValue: '「{{title}}」编辑完成，结果已放到画布并选中',
    }));
    onClose();
  };

  /** 输出用的源节点：资产来源在确认时才用视口中心生成一个虚拟原点，不往画布写源节点 */
  const resolveEditNode = (): NodeRecord => {
    if (node) return node;
    const origin = getInsertOrigin?.() ?? { x: 0, y: 0 };
    const width = 360;
    const asset = source as ImageEditAssetSource;
    const ratio = asset.naturalWidth && asset.naturalHeight ? asset.naturalHeight / asset.naturalWidth : 0.6;
    const height = Math.max(160, Math.round(width * ratio));
    return {
      id: `asset-edit-${asset.assetId}`,
      type: 'image',
      title: asset.title,
      position: origin,
      size: { width, height },
      data: { prompt: '' },
    } as unknown as NodeRecord;
  };

  const toolBar = useMemo(() => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 44,
        padding: '0 12px',
        borderBottom: `1px solid ${theme.toolbar.border}`,
        flexShrink: 0,
        background: theme.toolbar.background,
      }}
    >
      <Button size="small" type="text" icon={<ArrowLeft size={14} />} onClick={abandonEdit}>
        {t('imageEditor.backToCanvas', '返回画布')}
      </Button>
      <span style={{ width: 1, height: 20, background: theme.toolbar.border, margin: '0 4px' }} />
      {TOOLS.map((tool) => (
        <Tooltip key={tool.id} title={t(tool.labelKey, tool.fallback)}>
          <Button
            size="small"
            type={mode === tool.id ? 'primary' : 'text'}
            icon={tool.icon}
            data-image-edit-tool={tool.id}
            onClick={() => setMode(tool.id)}
          >
            {t(tool.labelKey, tool.fallback)}
          </Button>
        </Tooltip>
      ))}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: theme.toolbar.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
        {t('imageEditor.tabEditing', '编辑')} · {title}
      </span>
    </div>
  ), [mode, t, theme, title, abandonEdit]);

  const handleCrop = async (crop: CropRect): Promise<void> => {
    if (!dataUrl) return;
    try {
      const ids = await applyCrop({ node: resolveEditNode(), commandQueue, dataUrl, rect: crop, onGetNodeTitle: resultTitle });
      completeEdit(ids);
    } catch (err) {
      console.error('[ImageEditWorkspace] crop failed:', err);
      message.error(t('imageEditor.cropFailed', '裁剪失败，请重试'));
    }
  };

  const handleSplit = async (params: SplitParams): Promise<void> => {
    if (!dataUrl) return;
    try {
      const ids = await applySplit({ node: resolveEditNode(), commandQueue, dataUrl, params, onGetNodeTitle: resultTitle });
      completeEdit(ids);
    } catch (err) {
      console.error('[ImageEditWorkspace] split failed:', err);
      message.error(err instanceof Error && err.message ? err.message : t('imageEditor.splitFailed', '分割失败，请重试'));
    }
  };

  // 手动涂抹：用户只是想在图上画颜色（补色块/标记），不走 AI，直接合成落成新图片节点
  const handlePaint = async (payload: { blob: Blob }): Promise<void> => {
    if (!dataUrl) return;
    try {
      const ids = await applyPaint({ node: resolveEditNode(), commandQueue, blob: payload.blob, onGetNodeTitle: resultTitle });
      completeEdit(ids);
    } catch (err) {
      console.error('[ImageEditWorkspace] paint failed:', err);
      message.error(t('imageEditor.paintFailed', '涂抹保存失败，请重试'));
    }
  };

  // 局部遮罩：本机 Qwen Image 2.1 图像编辑（有遮罩 → 服务端走遮罩模板）
  const handleMaskEdit = async (payload: { prompt: string; maskDataUrl: string }): Promise<void> => {
    if (!dataUrl) return;
    const taskId = `image-edit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    useTaskQueueStore.getState().start({ id: taskId, kind: 'image', title: '图片编辑 · 局部修改' });
    const hide = message.loading(t('imageEditor.maskGenerating', '局部修改生成中…'), 0);
    try {
      const result = await generateLocalQwenImage({
        prompt: payload.prompt,
        referenceImages: [dataUrl],
        maskDataUrl: payload.maskDataUrl,
        params: { steps: QWEN_DEFAULT_STEPS, cfg: 1, denoise: 1, use_llm_enhance: false, sizeMode: 'source' },
        onProgress: (p) => useTaskQueueStore.getState().update(taskId, { progress: { step: p.step, totalSteps: p.totalSteps } }),
      });
      const ids = await applyMaskEdit({
        node: resolveEditNode(),
        commandQueue,
        blob: result.blob,
        prompt: payload.prompt,
        onGetNodeTitle: resultTitle,
      });
      completeEdit(ids);
      useTaskQueueStore.getState().finish(taskId, 'success');
    } catch (err) {
      console.error('[ImageEditWorkspace] mask edit failed:', err);
      useTaskQueueStore.getState().finish(taskId, 'error', err instanceof Error ? err.message : String(err));
      message.error(err instanceof Error && err.message ? err.message : t('imageEditor.maskFailed', '局部修改失败，请重试'));
    } finally {
      hide();
    }
  };

  const editor = !dataUrl ? (
    <div style={{ padding: 48, textAlign: 'center', fontSize: 13, color: theme.toolbar.textMuted }}>
      {t('imageEditor.noContent', '图片内容尚未就绪')}
    </div>
  ) : mode === 'crop' ? (
    <CropDialog dataUrl={dataUrl} open inline theme={theme} onClose={abandonEdit} onConfirm={(crop) => void handleCrop(crop)} />
  ) : mode === 'split' ? (
    <SplitDialog dataUrl={dataUrl} open inline theme={theme} onClose={abandonEdit} onConfirm={(params) => void handleSplit(params)} />
  ) : mode === 'paint' ? (
    <PaintDialog
      dataUrl={dataUrl}
      open
      inline
      theme={theme}
      onClose={abandonEdit}
      onConfirm={(payload) => { void handlePaint(payload); }}
    />
  ) : (
    <MaskEditDialog
      dataUrl={dataUrl}
      open
      inline
      theme={theme}
      onClose={abandonEdit}
      onConfirm={(payload) => { void handleMaskEdit(payload); }}
    />
  );

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: theme.canvas.background, color: theme.toolbar.text }}>
      {toolBar}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 16 }}>
        {editor}
      </div>
    </div>
  );
}
