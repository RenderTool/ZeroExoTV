/**
 * NodeImageEditor - 图片节点的**节点内编辑**面板（裁剪 / 分割 / 局部遮罩）
 *
 * 不是居中弹窗、也不是独立页签：面板以节点为锚点展开（覆盖节点当前屏幕矩形并适度外扩），
 * 编辑对象一直在画布上，确认后产物照旧落成子节点/节点数据。
 *
 * 设计口径：
 * - 编辑器内容体复用插件包内联模式（`inline`），不复制第二套 UI；
 * - 编辑期间铺一层很淡的遮罩接住指针事件，避免误改画布选择（画布不解绑）；
 * - Esc / 关闭按钮退出；产物写入失败给可读提示，不静默。
 */

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button } from 'antd';
import { X } from 'lucide-react';
import type { ThemeConfig } from '@zeroexo/shared';
import type { CommandQueue, NodeRecord } from '@zeroexo/core';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { CropDialog, SplitDialog, MaskEditDialog } from '@zeroexo/plugin-image-editor';
import type { CropRect, SplitParams } from '@zeroexo/plugin-image-editor';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { applyCrop, applySplit } from './image-edit-actions.js';

/** 节点当前屏幕矩形（left/top 为视口坐标，width/height 已乘缩放） */
export interface ImageNodeEditAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ImageNodeEditMode = 'crop' | 'split' | 'maskEdit';

export interface ImageNodeEditState {
  node: NodeRecord;
  mode: ImageNodeEditMode;
  anchor: ImageNodeEditAnchor;
}

export interface NodeImageEditorProps {
  state: ImageNodeEditState;
  theme: ThemeConfig;
  commandQueue: CommandQueue;
  onClose: () => void;
  /** 分割后自动成组（复用编辑器页同一回调） */
  onNodesCreated?: (nodeIds: string[]) => void;
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}

const MODE_TITLE: Record<ImageNodeEditMode, string> = {
  crop: '裁剪',
  split: '分割',
  maskEdit: '局部遮罩',
};

/** 面板矩形：以节点矩形为锚点外扩到可工作的尺寸，并夹在视口内 */
function resolvePanelRect(anchor: ImageNodeEditAnchor): { left: number; top: number; width: number; height: number } {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  const width = Math.min(Math.max(anchor.width, 720), Math.min(960, vw - 32));
  const height = Math.min(Math.max(anchor.height, 520), Math.min(720, vh - 32));
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  return {
    left: Math.min(Math.max(centerX - width / 2, 16), Math.max(16, vw - width - 16)),
    // 顶部至少让出顶栏（54px），编辑时仍能看见页面标题与页签，不像独立页面
    top: Math.min(Math.max(centerY - height / 2, 72), Math.max(72, vh - height - 16)),
    width,
    height,
  };
}

export function NodeImageEditor({
  state,
  theme,
  commandQueue,
  onClose,
  onNodesCreated,
  onGetNodeTitle,
}: NodeImageEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { node, mode, anchor } = state;
  const rawDataUrl = (node.data as { content?: string } | undefined)?.content ?? '';
  const storageKey = (node.data as { storageKey?: string } | undefined)?.storageKey;
  const dataUrl = useHydratedContent(storageKey, rawDataUrl);

  // Esc 退出；编辑期间拦住 Delete/Backspace，避免把正在编辑的节点删掉
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (!inField && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const rect = resolvePanelRect(anchor);

  const panelStyle: CSSProperties = {
    position: 'fixed',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    zIndex: Z_INDEX.FULLSCREEN_MODAL,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 12,
    overflow: 'hidden',
    border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)'}`,
    background: theme.toolbar.editorSurface,
    boxShadow: '0 18px 48px rgba(0,0,0,0.32)',
    color: theme.toolbar.text,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 12px',
    borderBottom: `1px solid ${theme.toolbar.border}`,
    flexShrink: 0,
  };

  const bodyStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
  };

  const handleCrop = async (crop: CropRect): Promise<void> => {
    if (!dataUrl) return;
    try {
      await applyCrop({ node, commandQueue, dataUrl, rect: crop, onGetNodeTitle });
      onClose();
    } catch (err) {
      console.error('[NodeImageEditor] crop failed:', err);
      message.error(t('imageEditor.cropFailed', '裁剪失败，请重试'));
    }
  };

  const handleSplit = async (params: SplitParams): Promise<void> => {
    if (!dataUrl) return;
    try {
      await applySplit({ node, commandQueue, dataUrl, params, onNodesCreated, onGetNodeTitle });
      onClose();
    } catch (err) {
      console.error('[NodeImageEditor] split failed:', err);
      message.error(t('imageEditor.splitFailed', '分割失败，请重试'));
    }
  };

  const editor = !dataUrl ? (
    <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 13 }}>
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
        onClose();
      }}
    />
  );

  return (
    <>
      {/* 淡遮罩：接住指针事件，避免编辑期间误改画布选择（不改变画布状态） */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: Z_INDEX.FULLSCREEN_MODAL - 1, background: 'rgba(0,0,0,0.18)' }}
        onPointerDown={(e) => { e.stopPropagation(); }}
        onMouseDown={(e) => { e.stopPropagation(); }}
      />
      <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{MODE_TITLE[mode]}</span>
            <span style={{ fontSize: 11, color: theme.toolbar.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('imageEditor.nodeEditHint', '节点内编辑 · Esc 退出')}
            </span>
          </div>
          <Button
            size="small"
            type="text"
            icon={<X size={14} />}
            aria-label={t('common.close', '关闭')}
            onClick={onClose}
          />
        </div>
        <div style={bodyStyle}>{editor}</div>
      </div>
    </>
  );
}
