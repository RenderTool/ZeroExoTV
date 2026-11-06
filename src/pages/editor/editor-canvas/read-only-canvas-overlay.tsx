/**
 * ReadOnlyCanvasOverlay - 只读画布遮罩组件
 *
 * 从 editor-page.tsx 提取，职责单一：
 * 只读模式下拦截编辑交互，保留浏览能力（平移/点击选中/双击聚焦）。
 * 鼠标左键拖动 = 平移画布；触摸单指 = 平移；命中节点 = 点击选中/双击聚焦。
 */
import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { DefaultEditor } from '@zeroexo/preset-default';
import type { NodeRecord } from '@zeroexo/core';
import { isVisibleNode } from '@zeroexo/core';

interface ReadOnlyCanvasOverlayProps {
  editor: DefaultEditor | null;
  containerSize: { width: number; height: number };
  getNodeSize: (node: NodeRecord) => { width: number; height: number };
  isReadOnlyViewer: boolean;
  loading: boolean;
}

export function ReadOnlyCanvasOverlay({
  editor,
  containerSize,
  getNodeSize,
  isReadOnlyViewer,
  loading,
}: ReadOnlyCanvasOverlayProps): React.ReactElement | null {
  const { t } = useTranslation();
  const theme = useTheme().theme;
  const readOnlyOverlayRef = useRef<HTMLDivElement | null>(null);
  const readOnlyPanRef = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);
  const readOnlyPendingClickRef = useRef<{ nodeId: string; width: number; height: number; time: number } | null>(null);
  const readOnlyMovedRef = useRef(false);
  const getNodeSizeRef = useRef(getNodeSize);
  getNodeSizeRef.current = getNodeSize;

  const hitTestReadOnlyNode = useCallback((clientX: number, clientY: number, rect: DOMRect): { nodeId: string; width: number; height: number } | null => {
    const store = editor?.store;
    if (!store) return null;
    const vp = store.getViewport();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const nodes = store.getGraph().nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!n) continue;
      // 2026-11-04 幽灵节点治理：只读命中测试跳过墓碑/无效节点
      if (!isVisibleNode(n)) continue;
      const size = getNodeSizeRef.current(n);
      const nx = n.position.x * vp.k + vp.x;
      const ny = n.position.y * vp.k + vp.y;
      const nw = size.width * vp.k;
      const nh = size.height * vp.k;
      if (screenX >= nx && screenX <= nx + nw && screenY >= ny && screenY <= ny + nh) {
        return { nodeId: n.id, width: size.width, height: size.height };
      }
    }
    return null;
  }, [editor]);

  const handleReadOnlyPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    const store = editor?.store;
    if (!store) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = hitTestReadOnlyNode(e.clientX, e.clientY, rect);
    if (hit) {
      const now = Date.now();
      const prev = readOnlyPendingClickRef.current;
      if (prev && prev.nodeId === hit.nodeId && now - prev.time < 400) {
        store.focusOnNode(hit.nodeId, containerSize, hit.width, hit.height, 400, 51);
        readOnlyPendingClickRef.current = null;
      } else {
        store.selectNodes([hit.nodeId], false);
        readOnlyPendingClickRef.current = { nodeId: hit.nodeId, width: hit.width, height: hit.height, time: now };
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const vp = store.getViewport();
    readOnlyPanRef.current = { startX: e.clientX, startY: e.clientY, vpX: vp.x, vpY: vp.y };
    readOnlyMovedRef.current = false;
    readOnlyPendingClickRef.current = null;
    e.currentTarget.style.cursor = 'grabbing';
  }, [editor, containerSize, hitTestReadOnlyNode]);

  const handleReadOnlyPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const p = readOnlyPanRef.current;
    const store = editor?.store;
    if (!p || !store) return;
    if (!readOnlyMovedRef.current) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      readOnlyMovedRef.current = true;
    }
    store.setViewport({
      ...store.getViewport(),
      x: p.vpX + (e.clientX - p.startX),
      y: p.vpY + (e.clientY - p.startY),
    });
  }, [editor]);

  const handleReadOnlyPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (readOnlyPanRef.current && !readOnlyMovedRef.current) {
      editor?.store.clearSelection();
    }
    readOnlyPanRef.current = null;
    readOnlyMovedRef.current = false;
    e.currentTarget.style.cursor = 'grab';
  }, [editor?.store]);

  const handleReadOnlyTouchStart = useCallback((e: React.TouchEvent) => {
    const store = editor?.store;
    if (!store) return;
    if (e.touches.length >= 2) {
      readOnlyPanRef.current = null;
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = hitTestReadOnlyNode(t.clientX, t.clientY, rect);
    if (hit) {
      store.selectNodes([hit.nodeId], false);
      return;
    }
    const vp = store.getViewport();
    readOnlyPanRef.current = { startX: t.clientX, startY: t.clientY, vpX: vp.x, vpY: vp.y };
  }, [editor, hitTestReadOnlyNode]);

  const handleReadOnlyTouchMove = useCallback((e: React.TouchEvent) => {
    const p = readOnlyPanRef.current;
    const store = editor?.store;
    if (!p || !store || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!t) return;
    store.setViewport({
      ...store.getViewport(),
      x: p.vpX + (t.clientX - p.startX),
      y: p.vpY + (t.clientY - p.startY),
    });
  }, [editor]);

  const handleReadOnlyTouchEnd = useCallback(() => {
    readOnlyPanRef.current = null;
  }, []);

  if (!isReadOnlyViewer || loading) return null;

  return (
    <div
      ref={readOnlyOverlayRef}
      style={{ position: 'absolute', inset: 0, zIndex: 45, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={handleReadOnlyPointerDown}
      onPointerMove={handleReadOnlyPointerMove}
      onPointerUp={handleReadOnlyPointerUp}
      onPointerCancel={handleReadOnlyPointerUp}
      onTouchStart={handleReadOnlyTouchStart}
      onTouchMove={handleReadOnlyTouchMove}
      onTouchEnd={handleReadOnlyTouchEnd}
      onTouchCancel={handleReadOnlyTouchEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 12px', borderRadius: 999,
          background: theme.toolbar.panel,
          border: `1px solid ${theme.toolbar.border}`,
          color: theme.toolbar.textMuted, fontSize: 12,
          pointerEvents: 'none',
        }}
      >
        <Eye size={13} />
        {t('collab.readOnlyBadge')}
      </div>
    </div>
  );
}