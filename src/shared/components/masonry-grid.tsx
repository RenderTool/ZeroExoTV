/**
 * masonry-grid - 瀑布流网格（2026-11-05 用户定稿）
 *
 * 背景：等高方格 + object-fit:cover 会把竖图裁掉一截（长图看不全）。本模块提供
 * 资产列表 / 素材抽屉 / 开源库共用的瀑布流容器，卡片高度按真实宽高比推导。
 *
 * 实现方式：**CSS 多列（column-count + column-gap）**，不用 JS 分列。
 * 理由：
 * 1) DOM 顺序与源数据顺序完全一致（只是视觉上按列自上而下排布），React 不需要
 *    重排数组、不需要测量高度、不需要绝对定位，重渲染/分页/过滤都不会跳列；
 * 2) 无 JS 布局，滚动时没有额外主线程计算，卡片数增多只是 DOM 节点增多；
 * 3) 列宽由浏览器按容器宽度均分，天然对齐容器右边缘（右侧留白 = 容器右内边距）。
 * 代价（已知退化）：视觉阅读顺序是「列优先」而非「行优先」；Tab 顺序仍严格等于 DOM
 * 顺序（第 1 列自上而下 → 第 2 列 …），不会乱跳，但与行优先的视觉相邻关系不同。
 * 替代方案（JS 最短列插入）必须重排 DOM 或绝对定位，会直接破坏 Tab 顺序，因此不采用。
 *
 * 列数按容器**实际边框盒宽度**（含左右内边距）经 ResizeObserver 实测后取断点，
 * 不写死视口宽度，抽屉窄容器自然降列。
 */

import { Children, createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { stableColumnCount } from '@/shared/utils/stable-columns.js';

/** 列间距（与列表页/抽屉原有的 16px 间距一致） */
export const MASONRY_GAP = 16;
/** 容器默认左右内边距（资产库 / 素材抽屉 / 开源库一致） */
export const MASONRY_PADDING_X = 20;
/** 基准单卡宽度：未测量到容器宽度时的回退列宽，也是「目标卡片宽度」的唯一来源 */
export const MASONRY_BASE_CARD_WIDTH = 220;
/** 断点表：容器宽度（含容器左右内边距）→ 列数。960→5 / 1280→7 / 1440→8 / 1920→11 为用户指定值 */
export const MASONRY_BREAKPOINTS: ReadonlyArray<{ minWidth: number; columns: number }> = [
  { minWidth: 1920, columns: 11 },
  { minWidth: 1440, columns: 8 },
  { minWidth: 1280, columns: 7 },
  { minWidth: 960, columns: 5 },
  { minWidth: 768, columns: 4 },
  { minWidth: 560, columns: 3 },
  { minWidth: 360, columns: 2 },
  { minWidth: 0, columns: 1 },
];

/** 超宽屏继续增列时使用的最小卡宽（配合 1920→11 的断点） */
const WIDE_MIN_CARD_WIDTH = 176;

/** 卡片封面高度相对列宽的夹取区间（用户规格：0.75~1.9 倍列宽） */
export const CARD_MIN_HEIGHT_RATIO = 0.75;
export const CARD_MAX_HEIGHT_RATIO = 1.9;

export function masonryColumnsForWidth(width: number): number {
  const w = Math.max(0, width);
  if (w >= 1920) {
    // 1920 起 11 列，再宽按最小卡宽继续增列（不封顶）
    return Math.max(11, Math.floor((w + MASONRY_GAP) / (WIDE_MIN_CARD_WIDTH + MASONRY_GAP)));
  }
  for (const bp of MASONRY_BREAKPOINTS) {
    if (w >= bp.minWidth) return bp.columns;
  }
  return 1;
}

export interface MasonryMetrics {
  /** 列数 */
  columns: number;
  /** 单列卡宽（px，不含列间距） */
  columnWidth: number;
  gap: number;
  /** 实测容器宽度（含左右内边距） */
  containerWidth: number;
  /** 右侧未被卡片占用的留白（px，含容器右内边距） */
  trailingWhitespace: number;
}

export function masonryMetricsForWidth(
  width: number,
  opts: { gap?: number; paddingX?: number; columns?: number } = {},
): MasonryMetrics {
  const gap = opts.gap ?? MASONRY_GAP;
  const paddingX = opts.paddingX ?? MASONRY_PADDING_X;
  const containerWidth = Math.max(0, width);
  const columns = opts.columns && opts.columns > 0 ? opts.columns : masonryColumnsForWidth(containerWidth);
  const contentWidth = Math.max(0, containerWidth - paddingX * 2);
  const columnWidth = Math.max(0, (contentWidth - gap * (columns - 1)) / columns);
  // CSS 多列会把内容宽度均分给每一列，列尾正好落在内容盒右边缘：
  // 右侧留白 = 容器右内边距（+ 亚像素取整余量）
  const used = columnWidth * columns + gap * (columns - 1);
  const trailingWhitespace = Math.max(0, containerWidth - paddingX - used);
  return { columns, columnWidth, gap, containerWidth, trailingWhitespace };
}

export interface CardCoverMetrics {
  /** 封面高度（px） */
  height: number;
  /** 超出上限的极端长图改 contain（能看全，不继续裁） */
  fit: 'cover' | 'contain';
  clamped: 'none' | 'min' | 'max';
  /** 实际参与计算的比例（未知时按 1:1） */
  aspect: number;
}

/**
 * 卡片封面高度：高度 = 列宽 / 宽高比（宽高比 = 图宽/图高），夹在
 * [0.75×列宽, 1.9×列宽]；触上限（竖长图）时 fit 改 contain。
 * 取不到真实比例（aspect 为空/非法）按 1:1 占位，解析到真实尺寸后由调用方平滑过渡一次。
 */
export function cardCoverMetrics(columnWidth: number, aspectRatio?: number | null): CardCoverMetrics {
  const colW = Math.max(1, columnWidth);
  const aspect = aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const raw = colW / aspect;
  const min = colW * CARD_MIN_HEIGHT_RATIO;
  const max = colW * CARD_MAX_HEIGHT_RATIO;
  if (raw > max) return { height: max, fit: 'contain', clamped: 'max', aspect };
  if (raw < min) return { height: min, fit: 'cover', clamped: 'min', aspect };
  return { height: raw, fit: 'cover', clamped: 'none', aspect };
}

/** 封面高度变化的过渡时长（1:1 占位 → 真实比例只过渡一次，不跳变两次） */
export const CARD_COVER_TRANSITION = 'height 260ms ease';

// ===== 列宽上下文（卡片据此算高度） =====

const MasonryContext = createContext<{ columnWidth: number }>({ columnWidth: MASONRY_BASE_CARD_WIDTH });

/** 当前瀑布流列宽（不在 MasonryGrid 内时回退基准卡宽） */
export function useMasonryColumnWidth(): number {
  const { columnWidth } = useContext(MasonryContext);
  // 未测量到容器宽度（隐藏容器/jsdom）时回退基准卡宽，避免卡片高度塌成 0
  return columnWidth > 0 ? columnWidth : MASONRY_BASE_CARD_WIDTH;
}

// ===== 容器 =====

export interface MasonryGridProps {
  children: ReactNode;
  gap?: number;
  /** 容器左右内边距（列宽/右侧留白按它算；默认 20，与资产库/抽屉一致） */
  paddingX?: number;
  paddingTop?: number;
  paddingBottom?: number;
  /** 显式列数（测试或固定列场景）；缺省按实测容器宽度取断点 */
  columns?: number;
  className?: string;
  style?: CSSProperties;
}

export function MasonryGrid({
  children,
  gap = MASONRY_GAP,
  paddingX = MASONRY_PADDING_X,
  paddingTop = 0,
  paddingBottom = 16,
  columns,
  className,
  style,
}: MasonryGridProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** 滞回后的生效列数（0 = 尚未测量）；宽度小幅往返不再翻列 */
  const columnsRef = useRef(0);

  // 首帧前同步量一次（避免先按 1 列渲染再跳列）；之后交给 ResizeObserver 实测
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const el2 = ref.current;
      if (!el2) return;
      const w = el2.getBoundingClientRect().width || el2.clientWidth || 0;
      // 死区 2px（原 0.5）：抽屉展开动画逐帧变宽时不必每帧重算卡片高度
      setWidth((prev) => (Math.abs(prev - w) < 2 ? prev : w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      // jsdom / 老浏览器：退化为窗口尺寸变化
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const metrics = useMemo(() => {
    if (columns && columns > 0) {
      columnsRef.current = columns;
      return masonryMetricsForWidth(width, { gap, paddingX, columns });
    }
    // 滞回列数（见 stable-columns：宽度↔列数卡片高度↔滚动条 构成反馈环，抽屉拖到某些尺寸会持续抖动）
    const stable = stableColumnCount(width, columnsRef.current, masonryColumnsForWidth);
    columnsRef.current = stable;
    return masonryMetricsForWidth(width, { gap, paddingX, columns: stable > 0 ? stable : undefined });
  }, [width, gap, paddingX, columns]);

  // 保持 DOM 顺序不变：按 children 原序包一层断列容器（break-inside:avoid 防止卡片被列切断）。
  // 仅视觉上按列排布，键盘 Tab 顺序 = DOM 顺序，不会乱跳。
  const cells = useMemo(
    () => Children.toArray(children).map((child, index) => (
      <div
        key={(child as { key?: string | null } | null)?.key ?? index}
        data-masonry-cell
        style={{ breakInside: 'avoid', marginBottom: gap, minWidth: 0 }}
      >
        {child}
      </div>
    )),
    [children, gap],
  );

  return (
    <div
      ref={ref}
      className={className}
      data-masonry
      data-masonry-columns={metrics.columns}
      data-masonry-column-width={Math.round(metrics.columnWidth)}
      style={{
        ...style,
        padding: `${paddingTop}px ${paddingX}px ${paddingBottom}px`,
        columnCount: metrics.columns,
        columnGap: gap,
        columnFill: 'balance',
        ['--masonry-col-width' as string]: `${metrics.columnWidth}px`,
      } as CSSProperties}
    >
      <MasonryContext.Provider value={{ columnWidth: metrics.columnWidth }}>
        {cells}
      </MasonryContext.Provider>
    </div>
  );
}
