/**
 * media-fit - 媒体节点尺寸 fit/校正纯函数(2026-11-04)
 *
 * 背景: 用户实测「导入的图片过大、比例失真,到现在还是错的」。
 * 根因之一: 节点尺寸只在创建时用 payload 元数据算一次,元数据缺失/错误时
 * 永远停在 16:9 fallback,图片加载完成后没有任何回算链路。
 *
 * 本模块是唯一尺寸规则事实源:
 * - fitContainSize:    按真实宽高比把图片 fit 进「最长边有上限、短边有下限」的盒子
 * - aspectMismatch:    判断节点当前比例与图片真实比例是否失配
 * - planOnloadResize:  图片 onload 后的尺寸校正规划(比例失配才纠正,保留用户缩放尺度)
 */

export interface Size {
  width: number;
  height: number;
}

export interface FitOptions {
  /** 最长边上限(超出才缩小;小图不放大) */
  maxLongSide: number;
  /** 短边下限(低于则等比放大) */
  minShortSide: number;
}

/** 有效正尺寸判定 */
function isValidSize(w: number | undefined, h: number | undefined): w is number {
  return typeof w === 'number' && typeof h === 'number' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}

/**
 * 容器等比 fit: 宽高比恒不变、不裁切、不变形。
 * - 大图: 最长边缩小到 maxLongSide
 * - 小图: 保持原始尺寸(不放大,避免 100px 图标被拉成 620px 的「导入过大」)
 * - 短边低于 minShortSide 时等比放大到下限(极端长条图兜底)
 * 入参非法返回 null(调用方自行回退)。
 */
export function fitContainSize(
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  opts: FitOptions,
): Size | null {
  if (!isValidSize(naturalWidth, naturalHeight)) return null;
  const nw = naturalWidth as number;
  const nh = naturalHeight as number;

  // 只缩不放: 最长边超过上限才缩小
  const scale = Math.min(1, opts.maxLongSide / Math.max(nw, nh));
  let width = Math.round(nw * scale);
  let height = Math.round(nh * scale);

  // 下限: 短边不低于 minShortSide,等比放大(保持宽高比)
  const minSide = Math.min(width, height);
  if (minSide < opts.minShortSide) {
    const up = opts.minShortSide / minSide;
    width = Math.round(width * up);
    height = Math.round(height * up);
  }

  return { width, height };
}

/**
 * 比例失配判定: 节点当前宽高比与图片真实宽高比的相对偏差是否超过容差。
 * 任一侧尺寸非法时返回 false(无法判定,不触发校正)。
 */
export function aspectMismatch(
  size: Size | undefined,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  tolerance = 0.01,
): boolean {
  if (!size || !isValidSize(size.width, size.height)) return false;
  if (!isValidSize(naturalWidth, naturalHeight)) return false;
  const nodeRatio = size.width / size.height;
  const naturalRatio = (naturalWidth as number) / (naturalHeight as number);
  return Math.abs(nodeRatio - naturalRatio) / naturalRatio > tolerance;
}

/**
 * 图片 onload 后的尺寸校正规划:
 * - 比例未失配 → null(不动,用户手动 resize 的结果永远保留)
 * - 比例失配 → 以节点当前最长边为上限重新 fit(纠正比例,但保留用户已缩放的尺度)
 */
export function planOnloadResize(
  nodeSize: Size | undefined,
  naturalWidth: number | undefined,
  naturalHeight: number | undefined,
  opts: FitOptions,
): Size | null {
  if (!aspectMismatch(nodeSize, naturalWidth, naturalHeight)) return null;
  const currentLong = nodeSize ? Math.max(nodeSize.width, nodeSize.height) : opts.maxLongSide;
  // 硬上限：调用方可传更小的 maxLongSide（图片节点 320 规则），避免历史 620 宽节点被撑大/停在宽幅容器
  const cappedLong = Math.min(Math.max(currentLong, opts.minShortSide), opts.maxLongSide);
  return fitContainSize(naturalWidth, naturalHeight, {
    maxLongSide: cappedLong,
    minShortSide: opts.minShortSide,
  });
}
