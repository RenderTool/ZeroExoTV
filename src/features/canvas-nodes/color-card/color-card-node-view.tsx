/**
 * 色卡节点视图（Plan#65）
 *
 * 非编辑态：调色盘卡片视图——顶部圆形调色盘图标 + 水平色条组（hover 展开 + 中央浮现
 * palette 圆钮旋转动画）+ 底部色值条（hover 联动显示当前色值）。点击色块复制色值。
 *
 * 编辑态：胶囊「编辑」按钮广播 color-card:edit 进入——颜色列表编辑器
 * （原生 color input + hex 输入 + 删除 + 添加，上限 12），退出时经命令队列提交。
 * 编辑态拦截指针事件防拖动节点，对齐 text 节点编辑交互。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Check, Copy } from 'lucide-react';
import { App as AntdApp } from 'antd';
import type { NodeRendererProps } from '@zeroexo/core';
import { UpdateNodeDataCommand } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { BaseNodeView, nodeActionBus } from '@zeroexo/plugin-nodes';
import { useTheme } from '@zeroexo/plugin-theme';
import {
  COLOR_CARD_MAX_COLORS,
  normalizeHex,
} from './color-card-types.js';
import type { ColorCardColor } from './color-card-types.js';

export interface ColorCardNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
}

/** 随机生成 hex 色值（添加颜色时的默认值） */
function randomHex(): string {
  const chars = '0123456789ABCDEF';
  let hex = '#';
  for (let i = 0; i < 6; i++) hex += chars[Math.floor(Math.random() * 16)];
  return hex;
}

/** 检测目标是否在节点外壳内（对齐 text 节点：节点外壳内点击不退出编辑） */
function isInsideNodeShell(target: EventTarget | null): boolean {
  return !(target instanceof HTMLElement) || !!target.closest('[data-node-shell]');
}

export function ColorCardNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  commandQueue,
  invK,
  connectionController,
  externalRenaming,
  onRenameFinish,
}: ColorCardNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<Record<string, unknown>>;
  const rawColors = data.colors;
  const colors: ColorCardColor[] = Array.isArray(rawColors)
    ? rawColors.filter(
        (c): c is ColorCardColor =>
          !!c && typeof c === 'object' && typeof (c as ColorCardColor).value === 'string',
      )
    : [];

  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message } = AntdApp.useApp();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ColorCardColor[]>(colors);
  const draftRef = useRef<ColorCardColor[]>(colors);
  const startRef = useRef<ColorCardColor[]>([]);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [selectedColorIndex, setSelectedColorIndex] = useState(-1);

  const nodeColor = theme.node.fill;

  // 进入编辑态：快照初始数据（颜色为空时补一个默认色便于添加）
  const enterEdit = useCallback(() => {
    startRef.current = colors.map((c) => ({ ...c }));
    const next = colors.length > 0 ? colors.map((c) => ({ ...c })) : [{ value: '#CCCCCC' }];
    draftRef.current = next;
    setDraft(next);
    setIsEditing(true);
  }, [colors]);

  // 退出编辑态：草稿与快照不同才提交（normalize hex 后比较）
  const exitEdit = useCallback(() => {
    setIsEditing(false);
    const next = draftRef.current.map((c) => ({
      value: normalizeHex(c.value) || c.value.trim(),
      name: c.name && c.name.trim() ? c.name.trim() : undefined,
    }));
    const start = startRef.current.map((c) => ({
      value: normalizeHex(c.value) || c.value.trim(),
      name: c.name && c.name.trim() ? c.name.trim() : undefined,
    }));
    if (JSON.stringify(next) === JSON.stringify(start)) return;
    if (commandQueue) {
      commandQueue.execute(new UpdateNodeDataCommand(node.id, { colors: next }));
    } else {
      updateNode({ data: { ...data, colors: next } });
    }
  }, [commandQueue, node.id, updateNode, data]);

  // 订阅胶囊「编辑」工具广播
  useEffect(() => {
    return nodeActionBus.on('color-card:edit', (e) => {
      if (e.nodeId === node.id) enterEdit();
    });
  }, [node.id, enterEdit]);

  // 编辑态：点击节点外部退出（capture 阶段；节点外壳内不退出）
  useEffect(() => {
    if (!isEditing) return;
    const onMouseDown = (e: MouseEvent): void => {
      if (editorRef.current?.contains(e.target as Node)) return;
      if (isInsideNodeShell(e.target)) return;
      // 点击原生颜色选择器（<input type="color">）不退出编辑模式，避免系统色板弹窗导致失焦退出
      if (e.target instanceof HTMLInputElement && e.target.type === 'color') return;
      exitEdit();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [isEditing, exitEdit]);

  // 编辑态：Escape 退出
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing, exitEdit]);

  // 复制色值（clipboard API + textarea 兜底）
  const copyColor = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    message.success(t('colorCard.copySuccess'));
  }, [message, t]);

  // ===== 编辑态草稿操作 =====
  const setColorValue = useCallback((index: number, value: string) => {
    setDraft((prev) => {
      const next = prev.map((c, i) => (i === index ? { ...c, value } : c));
      draftRef.current = next;
      return next;
    });
  }, []);

  const removeColor = useCallback((index: number) => {
    setDraft((prev) => {
      const next = prev.filter((_, i) => i !== index);
      draftRef.current = next;
      return next;
    });
  }, []);

  const addColor = useCallback(() => {
    setDraft((prev) => {
      if (prev.length >= COLOR_CARD_MAX_COLORS) return prev;
      const next = [...prev, { value: randomHex() }];
      draftRef.current = next;
      return next;
    });
  }, []);

  // 2026-09-02 验收反馈：去掉色卡上所有图标（含 titleIcon），去掉圆角按钮样式

  const activeColor = hoverIndex >= 0 && colors[hoverIndex] ? colors[hoverIndex] : colors[0];
  const selectedColor = selectedColorIndex >= 0 && colors[selectedColorIndex] ? colors[selectedColorIndex] : null;
  const bottomLabel = colors.length === 0
    ? t('colorCard.emptyHint')
    : (activeColor?.name ?? activeColor?.value ?? '');

  // ===== 编辑态：颜色列表编辑器 =====
  const editorBody = (
    <div
      ref={editorRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: nodeColor,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* 顶栏：标题 + 完成 */}
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          borderBottom: `1px solid ${theme.toolbar.border}55`,
        }}
      >
        <span style={{ fontSize: 11, color: theme.toolbar.textMuted }}>
          {t('colorCard.editColors')}
          <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
            {draft.length}/{COLOR_CARD_MAX_COLORS}
          </span>
        </span>
        <button
          type="button"
          onClick={exitEdit}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            borderRadius: 6,
            border: 'none',
            background: theme.toolbar.accent,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Check size={12} />
          {t('colorCard.done')}
        </button>
      </div>
      {/* 颜色列表 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 8,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {draft.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: theme.toolbar.textMuted,
            }}
          >
            {t('colorCard.emptyEditorHint')}
          </div>
        ) : (
          draft.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color"
                value={normalizeHex(c.value) || '#CCCCCC'}
                onChange={(e) => setColorValue(i, e.target.value)}
                style={{
                  width: 36,
                  height: 28,
                  padding: 0,
                  border: `1px solid ${theme.toolbar.border}`,
                  borderRadius: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
              <input
                type="text"
                value={c.value}
                onChange={(e) => setColorValue(i, e.target.value)}
                onBlur={() => {
                  const normalized = normalizeHex(c.value);
                  if (normalized) setColorValue(i, normalized);
                }}
                placeholder="#FFFFFF"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 28,
                  padding: '0 8px',
                  borderRadius: 6,
                  border: `1px solid ${theme.toolbar.border}`,
                  background: 'transparent',
                  color: theme.toolbar.text,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => removeColor(i)}
                title={t('colorCard.delete')}
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: theme.toolbar.textMuted,
                  cursor: 'pointer',
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>
      {/* 底栏：添加颜色 */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTop: `1px solid ${theme.toolbar.border}55`,
        }}
      >
        <button
          type="button"
          onClick={addColor}
          disabled={draft.length >= COLOR_CARD_MAX_COLORS}
          title={draft.length >= COLOR_CARD_MAX_COLORS ? t('colorCard.colorLimit') : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 12px',
            borderRadius: 6,
            border: `1px dashed ${theme.toolbar.border}`,
            background: 'transparent',
            color: draft.length >= COLOR_CARD_MAX_COLORS ? theme.toolbar.textMuted : theme.toolbar.text,
            fontSize: 11,
            cursor: draft.length >= COLOR_CARD_MAX_COLORS ? 'not-allowed' : 'pointer',
            opacity: draft.length >= COLOR_CARD_MAX_COLORS ? 0.6 : 1,
          }}
        >
          <Plus size={12} />
          {t('colorCard.addColor')}
        </button>
      </div>
    </div>
  );

  // ===== 非编辑态：调色盘卡片视图 =====
  // 2026-09-02 验收反馈：去掉顶部圆形调色盘图标，色条组直接占满内容区
  const cardBody = (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        padding: '12px 10px 0',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* 色条组 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 3,
          width: '100%',
        }}
      >
        {colors.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: theme.toolbar.textMuted,
              border: `1px dashed ${theme.toolbar.border}`,
              borderRadius: 8,
            }}
          >
            {t('colorCard.doubleClickToEdit')}
          </div>
        ) : (
          colors.map((c, i) => {
            const active = hoverIndex === i;
            return (
              <div
                key={i}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => { setHoverIndex(-1); }}
                onClick={() => setSelectedColorIndex(prev => prev === i ? -1 : i)}
                title={`${c.name ? c.name + ' ' : ''}${c.value}`}
                style={{
                  flexGrow: active ? 3 : 1,
                  flexBasis: 0,
                  background: normalizeHex(c.value) || '#CCCCCC',
                  borderRadius: 0,
                  cursor: 'pointer',
                  position: 'relative',
                  minWidth: 0,
                  overflow: 'hidden',
                  transition: 'flex-grow 0.25s ease, flex-basis 0.25s ease',
                  zIndex: active ? 3 : 1,
                  outline: selectedColorIndex === i ? `2px solid ${theme.toolbar.accent}` : 'none',
                  outlineOffset: -2,
                }}
              >
                {/* 2026-09-02 验收反馈：去掉 hover 中央图标 */}
              </div>
            );
          })
        )}
      </div>
      {/* 底部色值条 - 选中时显示复制图标 */}
      <div
        style={{
          height: 26,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 550,
          fontFamily: 'Roboto, sans-serif',
          color: theme.toolbar.text,
          userSelect: 'none',
          gap: 6,
        }}
      >
        {selectedColor ? (
          <>
            <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {selectedColor.value}
            </span>
            <Copy
              size={12}
              style={{ cursor: 'pointer', color: theme.toolbar.textMuted, flexShrink: 0 }}
              onClick={(e) => { e.stopPropagation(); copyColor(selectedColor.value); }}
            />
          </>
        ) : (
          <span>{bottomLabel}</span>
        )}
      </div>
    </div>
  );

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? t('nodes.colorCardTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
    >
      {isEditing ? editorBody : cardBody}
    </BaseNodeView>
  );
}
