/**
 * ImageDialogRenderer - 图片相关**只读/参数型**浮层（查看大图 / 详情 / 放大 / 多角度）
 *
 * 编辑类操作（裁剪 / 分割 / 局部遮罩）已改为**节点内编辑**（见 NodeImageEditor），
 * 不再走居中弹窗；本渲染器只保留仍需浮层的非就地操作。
 *
 * 支持的 type:
 * - upscale: 放大对话框(UpscaleDialog)
 * - angle: 多角度对话框(AngleDialog)
 * - superResolve: AI 超分(暂未实现,显示提示)
 * - view: 查看大图(大图预览 Modal)
 * - info: 节点信息(显示节点元数据 Modal)
 * - edit: 节点详情(同 info,显示节点数据)
 *
 * 非对话框动作(saveAsset/reversePrompt/replace)由 editor-page 的 openImageDialog 直接处理,
 * 不经过此组件。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { NodeRecord, CommandQueue } from '@zeroexo/core';
import { UpdateNodeDataCommand, ResizeNodeCommand } from '@zeroexo/core';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { UpscaleDialog, AngleDialog, upscaleDataUrl } from '@zeroexo/plugin-image-editor';
import type { UpscaleParams, AngleParams } from '@zeroexo/plugin-image-editor';
import { Modal } from '@/shared/components/index.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';

export interface ImageDialogState {
  node: NodeRecord;
  type: string;
}

export interface ImageDialogRendererProps {
  state: ImageDialogState;
  commandQueue: CommandQueue;
  theme: ThemeConfig;
  onClose: () => void;
}

export function ImageDialogRenderer({
  state,
  commandQueue,
  theme,
  onClose,
}: ImageDialogRendererProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { node, type } = state;
  const rawDataUrl = (node.data as { content?: string } | undefined)?.content ?? '';
  const storageKey = (node.data as { storageKey?: string } | undefined)?.storageKey;

  // 使用 useHydratedContent 确保获取正确的图片 URL(修复刷新后 blob URL 失效)
  const dataUrl = useHydratedContent(storageKey, rawDataUrl);

  if (!dataUrl) {
    return (
      <Modal open title={t('imageEditor.title')} theme={theme} onClose={onClose} width={400}>
        <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 13 }}>
          {t('imageEditor.noContent')}
        </div>
      </Modal>
    );
  }

  switch (type) {
    case 'upscale':
      return (
        <UpscaleDialog
          dataUrl={dataUrl}
          open
          onClose={onClose}
          onConfirm={async (params: UpscaleParams) => {
            onClose();
            try {
              const upscaled = await upscaleDataUrl(dataUrl, params);
              // 上传放大后的图片,获取 storageKey + 真实尺寸
              const img = await uploadImage(upscaled);
              commandQueue.execute(
                new UpdateNodeDataCommand(node.id, {
                  content: img.url,
                  storageKey: img.storageKey,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  mimeType: img.mimeType,
                  bytes: img.bytes,
                }),
              );
              // 同步调整节点尺寸为放大后图片比例(完全无边框)
              const currentWidth = node.size?.width ?? 340;
              const ratio = img.height / img.width;
              const newHeight = Math.round(currentWidth * ratio);
              commandQueue.execute(
                new ResizeNodeCommand(node.id, {
                  x: node.position.x,
                  y: node.position.y,
                  width: node.size?.width ?? 340,
                  height: node.size?.height ?? 240,
                }, {
                  x: node.position.x,
                  y: node.position.y,
                  width: currentWidth,
                  height: newHeight,
                }),
              );
            } catch (err) {
              console.error('Upscale failed:', err);
            }
          }}
        />
      );

    case 'angle':
      return (
        <AngleDialog
          dataUrl={dataUrl}
          open
          onClose={onClose}
          onConfirm={(_params: AngleParams) => {
            onClose();
            // angle 需要 AI 后端,暂不处理
          }}
        />
      );

    case 'superResolve':
      // AI 超分暂未实现(显示"暂未实现"提示)
      return (
        <Modal open title={t('imageEditor.superResolve')} theme={theme} onClose={onClose} width={400}>
          <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 14 }}>
            {t('common.notImplemented')}
          </div>
        </Modal>
      );

    case 'view':
      // 查看大图:全屏可缩放/平移的图片浏览器
      return (
        <Modal open title={t('imageEditor.viewTitle')} theme={theme} onClose={onClose} width={Math.min(window.innerWidth - 48, 1400)}>
          <ZoomableImageView src={dataUrl} theme={theme} />
        </Modal>
      );

    case 'info':
    case 'edit':
      // 节点信息/详情:显示节点元数据
      return (
        <NodeInfoModal node={node} theme={theme} onClose={onClose} />
      );

    default:
      return null;
  }
}

// ===== 节点信息 Modal =====

interface NodeInfoModalProps {
  node: NodeRecord;
  theme: ThemeConfig;
  onClose: () => void;
}

function NodeInfoModal({ node, theme, onClose }: NodeInfoModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [view, setView] = useState<'info' | 'json'>('info');

  const data = node.data as Record<string, unknown> | null;
  const infoItems: Array<{ label: string; value: string }> = [
    { label: 'ID', value: node.id },
    { label: t('imageEditor.nodeType'), value: node.type },
    ...(node.size ? [{ label: t('imageEditor.nodeSize'), value: `${node.size.width} × ${node.size.height}` }] : []),
    ...(node.position ? [{ label: t('imageEditor.nodePosition'), value: `(${Math.round(node.position.x)}, ${Math.round(node.position.y)})` }] : []),
    ...(data?.['prompt'] ? [{ label: t('imageEditor.prompt'), value: String(data['prompt']) }] : []),
    ...(data?.['model'] ? [{ label: t('imageEditor.model'), value: String(data['model']) }] : []),
    ...(data?.['status'] ? [{ label: t('imageEditor.status'), value: String(data['status']) }] : []),
    ...(data?.['naturalWidth'] && data?.['naturalHeight']
      ? [{ label: t('imageEditor.dimensions'), value: `${data['naturalWidth']} × ${data['naturalHeight']}` }]
      : []),
    ...(data?.['mimeType'] ? [{ label: t('imageEditor.mimeType'), value: String(data['mimeType']) }] : []),
    ...(data?.['bytes'] ? [{ label: t('imageEditor.fileSize'), value: formatBytes(Number(data['bytes'])) }] : []),
  ];

  const labelStyle: CSSProperties = {
    fontSize: 11, color: theme.toolbar.textMuted, fontWeight: 500, minWidth: 80, flexShrink: 0,
  };
  const valueStyle: CSSProperties = {
    fontSize: 12, color: theme.toolbar.text, wordBreak: 'break-all',
  };
  const rowStyle: CSSProperties = {
    display: 'flex', gap: 12, padding: '8px 0',
    borderBottom: `1px solid ${theme.toolbar.border}`,
  };

  return (
    <Modal
      open
      title={t('imageEditor.nodeInfo')}
      theme={theme}
      onClose={onClose}
      width={520}
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={view === 'info' ? tabActiveStyle(theme) : tabStyle(theme)}
            onClick={() => setView('info')}
          >
            {t('imageEditor.infoTab')}
          </button>
          <button
            type="button"
            style={view === 'json' ? tabActiveStyle(theme) : tabStyle(theme)}
            onClick={() => setView('json')}
          >
            JSON
          </button>
        </div>
      }
    >
      {view === 'info' ? (
        <div style={{ padding: '4px 0', minHeight: 300, maxHeight: 400, overflow: 'auto' }}>
          {infoItems.map((item) => (
            <div key={item.label} style={rowStyle}>
              <span style={labelStyle}>{item.label}</span>
              <span style={valueStyle}>{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <pre style={{
          fontSize: 11, lineHeight: 1.6, color: theme.toolbar.text,
          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          padding: 12, borderRadius: 8, overflow: 'auto', minHeight: 300, maxHeight: 400,
          border: `1px solid ${theme.toolbar.border}`, margin: 0, boxSizing: 'border-box',
        }}>
          {JSON.stringify(node, null, 2)}
        </pre>
      )}
    </Modal>
  );
}

// ===== 辅助样式 =====

function tabStyle(theme: ThemeConfig): CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 500,
    border: `1px solid ${theme.toolbar.border}`, borderRadius: 6,
    background: 'transparent', color: theme.toolbar.textMuted,
    cursor: 'pointer', transition: 'all 0.12s',
  };
}

function tabActiveStyle(theme: ThemeConfig): CSSProperties {
  return {
    ...tabStyle(theme),
    background: theme.toolbar.accent, color: '#fff', borderColor: theme.toolbar.accent,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ===== 可缩放图片浏览器(查看大图) — 统一图片查看框架 =====

interface ZoomableImageViewProps {
  src: string;
  theme: ThemeConfig;
}

function ZoomableImageView({ src, theme }: ZoomableImageViewProps): React.ReactElement {
  const panZoom = useImagePanZoom();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: `1px solid ${theme.toolbar.border}`,
        flexShrink: 0,
      }}>
        <ZoomToolbar panZoom={panZoom} style={{ background: 'transparent', padding: 0 }} />
      </div>
      {/* 图片舞台 */}
      <ImageViewerStage
        src={src}
        alt="preview"
        panZoom={panZoom}
        resetOnDoubleClick
        containerStyle={{
          flex: 1,
          minHeight: 0,
          background: theme.mode === 'dark' ? '#0a0a12' : '#f0f0f4',
        }}
      />
    </div>
  );
}
