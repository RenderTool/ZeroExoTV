/**
 * ImageEditWorkspace - 图片编辑独立页签（2026-11-06 用户定稿：像 Photoshop 一样编辑该图）
 *
 * 结构：顶部工具栏（裁剪 / 分割 / 局部遮罩 + 返回画布）+ 中间编辑舞台。
 * 编辑器内容体复用插件包 `inline` 模式（与浮层同一份 UI，不写第二套）；
 * 确认后产物照旧落回画布（裁剪/分割生成子节点 + 连线），随后关闭页签返回画布。
 *
 * 为什么改成独立页签（用户口径）：编辑有完整工作区与自己的工具栏，不挤压节点尺寸，
 * 节点本身永远不会因为编辑而改变大小或状态。
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

export interface ImageEditWorkspaceProps {
  node: NodeRecord;
  /** 进入页签时默认工具（点胶囊哪个按钮就进哪个） */
  initialMode?: ImageEditTool;
  theme: ThemeConfig;
  commandQueue: CommandQueue;
  /** 关闭页签并回到画布 */
  onClose: () => void;
  onNodesCreated?: (nodeIds: string[]) => void;
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}

const TOOLS: { id: ImageEditTool; labelKey: string; fallback: string; icon: React.ReactNode }[] = [
  { id: 'crop', labelKey: 'imageEditor.toolCrop', fallback: '裁剪', icon: <Scissors size={14} /> },
  { id: 'split', labelKey: 'imageEditor.toolSplit', fallback: '分割', icon: <Grid2x2 size={14} /> },
  { id: 'maskEdit', labelKey: 'imageEditor.toolMask', fallback: '局部遮罩', icon: <Brush size={14} /> },
];

export function ImageEditWorkspace({
  node,
  initialMode = 'crop',
  theme,
  commandQueue,
  onClose,
  onNodesCreated,
  onGetNodeTitle,
}: ImageEditWorkspaceProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [mode, setMode] = useState<ImageEditTool>(initialMode);

  const rawDataUrl = (node.data as { content?: string } | undefined)?.content ?? '';
  const storageKey = (node.data as { storageKey?: string } | undefined)?.storageKey;
  const dataUrl = useHydratedContent(storageKey, rawDataUrl);

  const title = node.title || (node.data as { title?: string } | undefined)?.title || t('imageEditor.tabTitle', '图片编辑');

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
      await applyCrop({ node, commandQueue, dataUrl, rect: crop, onGetNodeTitle });
      onClose();
    } catch (err) {
      console.error('[ImageEditWorkspace] crop failed:', err);
      message.error(t('imageEditor.cropFailed', '裁剪失败，请重试'));
    }
  };

  const handleSplit = async (params: SplitParams): Promise<void> => {
    if (!dataUrl) return;
    try {
      await applySplit({ node, commandQueue, dataUrl, params, onNodesCreated, onGetNodeTitle });
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
      <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'stretch', padding: 16, overflow: 'auto' }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 1080, display: 'flex', flexDirection: 'column' }}>
          {editor}
        </div>
      </div>
    </div>
  );
}
