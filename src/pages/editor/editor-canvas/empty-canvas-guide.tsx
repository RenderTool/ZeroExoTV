/**
 * EmptyCanvasGuide - 空画布引导态（2026-11-04）
 *
 * 纯视觉层，不读不写 graph 以外的任何数据（只订阅 graph/viewport 做显隐与网格位移）。
 * 三层结构（全部 pointerEvents: none，不拦截任何画布交互）：
 * 1. 点阵网格 —— CSS radial-gradient 重复平铺，订阅 viewport 直写
 *    background-size/position（与 Viewport_ 同手法，零 React reconcile），
 *    随画布平移/缩放一起移动；CSS mask 让点向四周渐隐。
 *    选择 CSS 而非 canvas 绘制的理由：与 Viewport_ 既有网格同构、无需 rAF 循环、
 *    缩放时由同一订阅回调驱动，实现与维护成本最低。
 * 2. 中心辉光 —— 中性冷/暖灰纯明度渐变（2026-11-04 修改：去品牌红），
 *    4 stop 柔和衰减 + 极弱垂直明度层，中心到边缘无可见接缝，无图片资源。
 * 3. 居中提示 —— 文案走 i18n（editor.emptyGuide*），图标 + 左右两段文字。
 *
 * 显隐：graph.nodes 中无可见节点（排除 _deleted 墓碑）时渲染；
 * 有节点后 opacity 淡出 300ms 再卸载。网格（Viewport_ 的用户网格设置）不受影响。
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { MousePointerClick } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { buildDotGridBackground, useGraph, type ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { Viewport } from '@zeroexo/core';

export interface EmptyCanvasGuideProps {
  /** 状态存储（只读订阅 graph/viewport） */
  store: ReactGraphStore;
  /** 网格间距（世界坐标，与 editor-page 的 gridSize 一致） */
  gridSize?: number;
}

const FADE_OUT_MS = 300;

/**
 * 画布是否为空的响应式订阅（供装配方切换 CanvasView 背景等）。
 * 只读订阅 graph，不写任何数据；返回布尔原始值，无引用抖动。
 */
export function useIsCanvasEmpty(store: ReactGraphStore | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribeGraph(onChange) : () => {}),
    [store],
  );
  const getSnapshot = useCallback(
    () =>
      store
        ? store.getGraph().nodes.filter((n) => !(n as { _deleted?: boolean })._deleted).length === 0
        : false,
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function EmptyCanvasGuide({ store, gridSize = 16 }: EmptyCanvasGuideProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { theme, mode } = useTheme();
  const graph = useGraph(store);
  // 空态判据与 canvas-view.tsx 一致：排除 _deleted 墓碑节点
  const isEmpty = graph.nodes.filter((n) => !(n as { _deleted?: boolean })._deleted).length === 0;

  // 有节点后淡出再卸载（卸载延迟 = 过渡时长）
  const [mounted, setMounted] = useState(isEmpty);
  useEffect(() => {
    if (isEmpty) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), FADE_OUT_MS);
    return () => window.clearTimeout(id);
  }, [isEmpty]);

  // 点阵网格：订阅 viewport 直写 DOM（平移/缩放零重渲染）
  const dotsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const apply = (vp: Viewport): void => {
      const el = dotsRef.current;
      if (!el) return;
      const k = vp.k > 0 ? vp.k : 1;
      const size = gridSize * k;
      // 与 Viewport_ 共用同一缩放规则：点半径/不透明度随 k 连续变化，无档位跳变
      el.style.backgroundImage = buildDotGridBackground(theme.canvas.gridDot, k);
      el.style.backgroundSize = `${size}px ${size}px`;
      el.style.backgroundPosition = `${vp.x % size}px ${vp.y % size}px`;
    };
    apply(store.getViewport());
    return store.subscribeViewport(() => apply(store.getViewport()));
  }, [store, gridSize, theme.canvas.gridDot]);

  if (!mounted) return null;

  // 辉光（2026-11-04 修改：彻底去品牌红 accent/#e94560）：
  // 深色=中性冷白(slate-200 226,232,240)，浅色=中性暖灰(68,64,60)；
  // 4 stop 柔和衰减（0→35%→70%→100%），大椭圆 720×520 避免小半径色斑；
  // 叠极弱垂直明度层，让中心到边缘过渡无可见接缝。
  const glowRgb = mode === 'dark' ? '226,232,240' : '68,64,60';
  const glowRadial =
    mode === 'dark'
      ? `radial-gradient(ellipse 720px 520px at center, rgba(${glowRgb},0.10) 0%, rgba(${glowRgb},0.055) 35%, rgba(${glowRgb},0.02) 70%, rgba(${glowRgb},0) 100%)`
      : `radial-gradient(ellipse 720px 520px at center, rgba(${glowRgb},0.05) 0%, rgba(${glowRgb},0.028) 35%, rgba(${glowRgb},0.01) 70%, rgba(${glowRgb},0) 100%)`;
  const glowVertical =
    mode === 'dark'
      ? `linear-gradient(to bottom, rgba(${glowRgb},0.02) 0%, rgba(${glowRgb},0) 28%, rgba(${glowRgb},0) 72%, rgba(0,0,0,0.04) 100%)`
      : `linear-gradient(to bottom, rgba(${glowRgb},0.012) 0%, rgba(${glowRgb},0) 28%, rgba(${glowRgb},0) 72%, rgba(${glowRgb},0.025) 100%)`;

  return (
    <div
      data-empty-canvas-guide
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        pointerEvents: 'none',
        opacity: isEmpty ? 1 : 0,
        transition: `opacity ${FADE_OUT_MS}ms ease`,
      }}
    >
      {/* 点阵网格（随视口变换，mask 向四周渐隐） */}
      <div
        ref={dotsRef}
        data-empty-canvas-guide-dots
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: buildDotGridBackground(theme.canvas.gridDot, 1),
          WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at center, black 25%, transparent 78%)',
          maskImage: 'radial-gradient(ellipse 75% 65% at center, black 25%, transparent 78%)',
        }}
      />
      {/* 中心辉光（径向 4 stop）+ 极弱垂直明度层（分层避免 cssstyle 简写解析问题） */}
      <div
        data-empty-canvas-guide-glow
        style={{
          position: 'absolute',
          inset: 0,
          background: glowRadial,
        }}
      />
      <div
        data-empty-canvas-guide-glow-vertical
        style={{
          position: 'absolute',
          inset: 0,
          background: glowVertical,
        }}
      />
      {/* 居中提示 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: theme.toolbar.textMuted,
            fontSize: 13,
            letterSpacing: 0.5,
          }}
        >
          <span>{t('editor.emptyGuideAction')}</span>
          <MousePointerClick size={14} strokeWidth={1.8} />
          <span>{t('editor.emptyGuideCreate')}</span>
        </div>
        <div style={{ color: theme.toolbar.textMuted, fontSize: 12, opacity: 0.7, letterSpacing: 0.5 }}>
          {t('editor.emptyGuideDrop')}
        </div>
      </div>
    </div>
  );
}
