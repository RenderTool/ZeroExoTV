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

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Tooltip } from 'antd';
import { ArrowLeft, Brush, Grid2x2, Scissors } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { CropDialog, SplitDialog, MaskEditDialog } from '@zeroexo/plugin-image-editor';
import type { CropRect, SplitParams } from '@zeroexo/plugin-image-editor';
import { applyCrop, applySplit } from './image-edit-actions.js';

export type ImageEditTool = 'crop' | 'split' | 'maskEdit';

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
  { id: 'maskEdit', labelKey: 'imageEditor.toolMask', fallback: '局部遮罩', icon: <Brush size={14} /> },
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
      <Button size="small" type="text" icon={<ArrowLeft size={14} />} onClick={onClose}>
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
        {title}
      </span>
    </div>
  ), [mode, onClose, t, theme, title]);

  const handleCrop = async (crop: CropRect): Promise<void> => {
    if (!dataUrl) return;
    try {
      await applyCrop({ node: resolveEditNode(), commandQueue, dataUrl, rect: crop, onGetNodeTitle });
      onClose();
    } catch (err) {
      console.error('[ImageEditWorkspace] crop failed:', err);
      message.error(t('imageEditor.cropFailed', '裁剪失败，请重试'));
    }
  };

  const handleSplit = async (params: SplitParams): Promise<void> => {
    if (!dataUrl) return;
    try {
      await applySplit({ node: resolveEditNode(), commandQueue, dataUrl, params, onNodesCreated, onGetNodeTitle });
      onClose();
    } catch (err) {
      console.error('[ImageEditWorkspace] split failed:', err);
      message.error(t('imageEditor.splitFailed', '分割失败，请重试'));
    }
  };

  const editor = !dataUrl ? (
    <div style={{ padding: 48, textAlign: 'center', fontSize: 13, color: theme.toolbar.textMuted }}>
      {t('imageEditor.noContent', '图片内容尚未就绪')}
    </div>
  ) : mode === 'crop' ? (
    <CropDialog dataUrl={dataUrl} open inline theme={theme} onClose={onClose} onConfirm={(crop) => void handleCrop(crop)} />
  ) : mode === 'split' ? (
    <SplitDialog dataUrl={dataUrl} open inline theme={theme} onClose={onClose} onConfirm={(params) => void handleSplit(params)} />
  ) : (
    <MaskEditDialog
      dataUrl={dataUrl}
      open
      inline
      theme={theme}
      onClose={onClose}
      onConfirm={() => {
        // 局部修改需要生成后端；未接入前明确告知，不假装成功
        message.info(t('imageEditor.maskBackendPending', '局部修改需要接入生成后端，本次未提交'));
      }}
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
