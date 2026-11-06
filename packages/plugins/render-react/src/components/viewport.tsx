/**
 * Viewport - 画布视口容器
 * 负责: 视口变换(transform)、背景网格、事件透传
 * 交互逻辑由 interaction 插件通过 props 注入
 */

import React, { useState, useRef, useLayoutEffect } from 'react';
import type { Viewport } from '@zeroexo/core';
import { ContextMenu } from './context-menu.js';
import type { ContextMenuItem } from './context-menu.js';
import type { ReactGraphStore } from '../store.js';

/**
 * 点阵基线(屏幕像素):zoom=1 时的点核半径与淡出半径。
 * 点半径随 zoom 等比缩放,使屏幕上「点面积/点间距」比例恒定——
 * 缩小时不会因为点数变多而显噪,放大时也不会散成孤点。
 */
export const GRID_DOT_CORE_RADIUS = 0.9;
export const GRID_DOT_FADE_RADIUS = 1.1;
const GRID_DOT_MIN_RADIUS = 0.4;
const GRID_DOT_MAX_RADIUS = 1.8;

export interface DotGridMetrics {
  /** 实际屏幕像素间距(世界间距 × zoom) */
  spacing: number;
  /** 点核半径(屏幕像素) */
  dotRadius: number;
  /** 点淡出半径(屏幕像素) */
  fadeRadius: number;
  /** 点不透明度(基色 alpha × zoom 平滑系数,0–1) */
  opacity: number;
  /** 点基色 rgb 三元组(逗号分隔,供 radial-gradient 使用) */
  rgb: string;
}

/** 解析 rgba/rgb 颜色的 rgb 分量与 alpha;非法输入回退点阵默认值 */
function parseDotColor(dotColor: string): { rgb: string; alpha: number } {
  const rgbMatch = dotColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  const rgb = rgbMatch ? `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}` : '245,245,244';
  const alphaMatch = dotColor.match(/([\d.]+)\)\s*$/);
  const alpha = alphaMatch?.[1] ? parseFloat(alphaMatch[1]) : 0.35;
  return { rgb, alpha };
}

/**
 * 点阵度量(纯函数,单测可直接断言)。
 * 缩放规则对所有 zoom 连续生效:spacing=gridSize×k;半径=k×基线并夹在
 * [0.4, 1.8]px;不透明度=基色 alpha×min(1, k)。无档位开关/阈值跳变。
 */
export function computeDotGridMetrics(dotColor: string, gridSize: number, zoom: number): DotGridMetrics {
  const k = zoom > 0 ? zoom : 1;
  const { rgb, alpha } = parseDotColor(dotColor);
  const dotRadius = Math.min(GRID_DOT_MAX_RADIUS, Math.max(GRID_DOT_MIN_RADIUS, GRID_DOT_CORE_RADIUS * k));
  return {
    spacing: gridSize * k,
    dotRadius,
    fadeRadius: dotRadius * (GRID_DOT_FADE_RADIUS / GRID_DOT_CORE_RADIUS),
    opacity: alpha * Math.min(1, k),
    rgb,
  };
}

/** 生成点阵 background-image(与 computeDotGridMetrics 同一套缩放规则) */
export function buildDotGridBackground(dotColor: string, zoom: number): string {
  const { rgb, opacity, dotRadius, fadeRadius } = computeDotGridMetrics(dotColor, 1, zoom);
  return `radial-gradient(circle, rgba(${rgb},${opacity.toFixed(3)}) ${dotRadius.toFixed(2)}px, transparent ${fadeRadius.toFixed(2)}px)`;
}

export interface ViewportProps {
  /** 状态存储(内部订阅 viewport 并直写背景样式,平移缩放零 React reconcile) */
  store: ReactGraphStore;
  /** 容器 ref */
  containerRef?: React.RefObject<HTMLDivElement | null>;
  /** 子节点(通常为 NodeLayer + EdgeLayer) */
  children: React.ReactNode;
  /** 背景网格类型 */
  background?: 'dots' | 'lines' | 'none';
  /** 背景色 */
  background_color?: string;
  /** 网格颜色(向后兼容,dots 和 lines 共用) */
  grid_color?: string;
  /** 点阵网格色(优先于 grid_color,用于 dots 模式) */
  grid_dot_color?: string;
  /** 线条网格色(优先于 grid_color,用于 lines 模式) */
  grid_line_color?: string;
  /** 网格大小(世界坐标) */
  grid_size?: number;
  /** 右键菜单项(覆盖默认的 复制/粘贴/删除; null=不显示内置菜单) */
  contextMenuItems?: ContextMenuItem[] | null;
  /** 自定义事件处理(由 interaction 插件注入) */
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** 拖拽事件(Phase D2:AssetPicker 拖拽到画布生成节点) */
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  /** 自定义样式 */
  style?: React.CSSProperties;
  className?: string;
  /** 交互模式: select=选择(默认光标), pan=平移(手型光标) */
  mode?: 'select' | 'pan';
}

export function Viewport_({
  store,
  containerRef,
  children,
  background = 'lines',
  background_color = '#1a1a2e',
  grid_color = '#16213e',
  grid_dot_color,
  grid_line_color,
  grid_size = 16,
  contextMenuItems,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onContextMenu,
  onDrop,
  onDragOver,
  style,
  className,
  mode = 'select',
}: ViewportProps): React.ReactElement {
  const bgRef = useRef<HTMLDivElement | null>(null);

  // 背景网格直写 DOM:订阅 viewport,在回调里直接写 background-position/size,
  // 不触发 React 重渲染(背景 gridBackground 是纯计算,无状态依赖)。
  useLayoutEffect(() => {
    const dotColor = grid_dot_color ?? grid_color;
    const lineColor = grid_line_color ?? grid_color;
    const apply = (vp: Viewport): void => {
      const el = bgRef.current;
      if (!el) return;
      const k = vp.k > 0 ? vp.k : 1;
      let bgImage = 'none';
      if (background !== 'none') {
        if (background === 'dots') {
          bgImage = buildDotGridBackground(dotColor, k);
        } else {
          bgImage = `linear-gradient(to right, ${lineColor} 1px, transparent 1px), linear-gradient(to bottom, ${lineColor} 1px, transparent 1px)`;
        }
      }
      const gridSize = grid_size * k;
      el.style.backgroundImage = bgImage;
      if (background !== 'none') {
        el.style.backgroundSize = `${gridSize}px ${gridSize}px`;
        el.style.backgroundPosition = `${vp.x % gridSize}px ${vp.y % gridSize}px`;
      }
    };
    apply(store.getViewport());
    return store.subscribeViewport(() => apply(store.getViewport()));
  }, [store, background, background_color, grid_color, grid_dot_color, grid_line_color, grid_size]);

  // 根据交互模式切换光标: pan 模式手型(平移), select 模式默认(框选/选中)
  const cursor = mode === 'pan' ? 'grab' : 'default';

  // ===== 右键菜单(新 ContextMenu 组件) =====
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number } | null>(null);
  const defaultCtxMenuItems: ContextMenuItem[] = [
    { key: 'copy', label: '复制', onClick: () => {} },
    { key: 'paste', label: '粘贴', onClick: () => {} },
    { key: 'divider-1', divider: true, label: '', onClick: () => {} },
    { key: 'delete', label: '删除', danger: true, onClick: () => {} },
  ];
  // null = 外部管理菜单(如 NodeCreateMenu),不显示内置菜单
  // undefined = 使用默认菜单项
  // [] = 空菜单(不显示任何项)
  const ctxMenuItems = contextMenuItems === undefined ? defaultCtxMenuItems : (contextMenuItems ?? []);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // 先调用外部 handler,让其更新 contextMenuItems 状态
    onContextMenu?.(e);
    // 始终设置菜单位置。外部 handler 通过 contextMenuItems prop 控制内容:
    // null → 空白区域(由 NodeCreateMenu 处理),ctxMenuItems=[] → ContextMenu 空列表→ 不显示;
    // 数组 → 自定义菜单项,容器显示菜单。
    // React 18 自动批处理,setCtxMenuPos 与外部 setContextMenuItems 在同一事件循环内合并渲染,
    // 因此下一帧 ctxMenuItems 已是最新值,无闪帧、无空菜单闪烁。
    // 注意:不依赖 ctxMenuItems 变量做守卫判断,因为它来自当前渲染闭包,不是外部 handler 更新后的值。
    setCtxMenuPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <ContextMenu items={ctxMenuItems} position={ctxMenuPos} onClose={() => setCtxMenuPos(null)}>
      <div
        ref={(el) => {
          bgRef.current = el;
          if (containerRef) {
            (containerRef as { current: HTMLDivElement | null }).current = el;
          }
        }}
        data-canvas-viewport
        data-canvas-mode={mode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={handleContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          borderRadius: 12,
          backgroundColor: background_color,
          // backgroundImage/Size/Position 由 useLayoutEffect 订阅 viewport 直写 DOM
          touchAction: 'none',
          cursor,
          userSelect: 'none',
          contain: 'layout style paint',
          ...style,
        }}
        className={className}
      >
        {children}
      </div>
    </ContextMenu>
  );
}
