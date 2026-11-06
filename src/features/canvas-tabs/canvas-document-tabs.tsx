/**
 * CanvasDocumentTabs - 画布级页签条（2026-11-06 用户纠偏）
 *
 * 位置：画布区顶部（固定槽位页签条下方那一行），视觉沿用线上版本的活动页签：
 * 30px 高、透明底、激活态底部 accent 下划线、可横向滚动。
 *
 * 内容：固定「主画布」页签（**始终第一个、不可关闭**）+ 已打开的画布副本页签（可 ×、可拖拽排序）。
 * 只有存在副本时才渲染整条（没有副本就没有第二层页签，不占高度）。
 * 点击页签 = 编辑器切换到对应画布文档（同一套画布界面，见 useCanvasDocumentSwitch）。
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { Image as ImageIcon, X } from 'lucide-react';
import { CANVAS_TAB_ICONS } from './icons.js';
import {
  CANVAS_TAB_KEY,
  openCanvasTabCid,
  useCanvasTabStore,
} from './canvas-tab-store.js';

export function CanvasDocumentTabs(): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const copies = useCanvasTabStore((s) => s.openCanvasTabs);
  const imageTabs = useCanvasTabStore((s) => s.openImageTabs);
  const activeTabKey = useCanvasTabStore((s) => s.activeTabKey);
  const activateTab = useCanvasTabStore((s) => s.activateTab);
  const closeCanvasTab = useCanvasTabStore((s) => s.closeCanvasTab);
  const reorderCanvasTabs = useCanvasTabStore((s) => s.reorderCanvasTabs);
  const closeImageTab = useCanvasTabStore((s) => s.closeImageTab);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (copies.length === 0 && imageTabs.length === 0) return null;

  const activeCid = activeTabKey === CANVAS_TAB_KEY ? 'main' : openCanvasTabCid(activeTabKey);
  const MainIcon = CANVAS_TAB_ICONS.canvas;

  const barStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'stretch',
    gap: 2,
    height: 30,
    flexShrink: 0,
    minWidth: 0,
    padding: '0 6px',
    overflowX: 'auto',
    overflowY: 'hidden',
    overscrollBehavior: 'contain',
    background: 'transparent',
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    padding: '0 10px',
    border: 'none',
    background: active ? `${theme.toolbar.accent}14` : 'transparent',
    color: active ? theme.toolbar.text : theme.toolbar.textMuted,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s',
    fontFamily: 'inherit',
  });

  const underlineStyle = (active: boolean): CSSProperties => ({
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
    background: active ? theme.toolbar.accent : 'transparent',
  });

  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 8px 0', minWidth: 0 }}>
      <div style={barStyle} role="tablist" aria-label={t('canvasCopy.tabBarAriaLabel', '画布页签')}>
        {/* 主画布：固定第一个，不可关闭 */}
        <button
          type="button"
          role="tab"
          aria-selected={activeCid === 'main'}
          data-canvas-doc-tab="main"
          onClick={() => activateTab(CANVAS_TAB_KEY)}
          style={tabStyle(activeCid === 'main')}
          title={t('canvasCopy.mainTag', '主画布')}
        >
          <MainIcon size={12} strokeWidth={activeCid === 'main' ? 2.2 : 1.8} />
          <span>{t('canvasCopy.mainTag', '主画布')}</span>
          <span style={underlineStyle(activeCid === 'main')} />
        </button>

        {/* 画布副本：可关闭、可拖拽排序 */}
        {copies.map((tab, idx) => {
          const active = activeCid === tab.cid;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              draggable
              data-canvas-doc-tab={tab.cid}
              onClick={() => activateTab(tab.key)}
              onDragStart={(e) => {
                setDragIndex(idx);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.key);
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== idx) reorderCanvasTabs(dragIndex, idx);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              style={tabStyle(active)}
              title={tab.title}
            >
              <MainIcon size={12} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={t('canvasTab.close', '关闭页签')}
                data-canvas-doc-close={tab.cid}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, padding: 0, borderRadius: 4,
                  color: 'inherit', cursor: 'pointer', opacity: 0.6, flexShrink: 0,
                }}
                onClick={(e) => { e.stopPropagation(); closeCanvasTab(tab.key); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); closeCanvasTab(tab.key); }
                }}
              >
                <X size={11} />
              </span>
              <span style={underlineStyle(active)} />
            </button>
          );
        })}

        {/* 图片编辑页签（Photoshop 式）：与画布文档同一条文档栏，关闭即回画布 */}
        {imageTabs.length > 0 && (
          <span style={{ alignSelf: 'center', width: 1, height: 16, margin: '0 4px', flexShrink: 0, background: theme.toolbar.border }} />
        )}
        {imageTabs.map((tab) => {
          const active = activeTabKey === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-image-doc-tab={tab.nodeId ?? tab.asset?.assetId}
              onClick={() => activateTab(tab.key)}
              style={tabStyle(active)}
              title={tab.title}
            >
              <ImageIcon size={12} strokeWidth={active ? 2.2 : 1.8} />
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={t('canvasTab.close', '关闭页签')}
                data-image-doc-close={tab.nodeId ?? tab.asset?.assetId}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 16, padding: 0, borderRadius: 4,
                  color: 'inherit', cursor: 'pointer', opacity: 0.6, flexShrink: 0,
                }}
                onClick={(e) => { e.stopPropagation(); closeImageTab(tab.key); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); closeImageTab(tab.key); }
                }}
              >
                <X size={11} />
              </span>
              <span style={underlineStyle(active)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
