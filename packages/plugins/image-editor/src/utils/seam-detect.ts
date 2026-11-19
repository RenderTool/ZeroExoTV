/**
 * 接缝吸附（2026-11-18 用户口径）
 *
 * 三视图 / 多格概念图的分格之间总有一条「轻微接缝」——很窄的均匀分隔带。
 * 均匀网格切分会直接从主体中间切过去，切出来就是碎片。
 * 这里按列/行的纹理能量找低纹理分隔带，只在期望分割线附近 ±tolerance 内吸附，
 * 找不到接缝就保持原位（不硬猜）。
 */

import { loadImage } from './image-meta.js';

const SAMPLE_MAX = 320;

/** 某一列(axis=x)/行(axis=y)的平均纹理能量：与相邻像素平均色差；接缝带能量接近 0 */
export function axisEnergy(data: Uint8ClampedArray, w: number, h: number, kind: 'x' | 'y'): Float32Array {
  const out = new Float32Array(kind === 'x' ? w : h);
  if (kind === 'x') {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        const j = (y * w + Math.min(w - 1, x + 1)) * 4;
        sum += Math.abs(data[i]! - data[j]!) + Math.abs(data[i + 1]! - data[j + 1]!) + Math.abs(data[i + 2]! - data[j + 2]!);
      }
      out[x] = h > 0 ? sum / h : 0;
    }
  } else {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const j = (Math.min(h - 1, y + 1) * w + x) * 4;
        sum += Math.abs(data[i]! - data[j]!) + Math.abs(data[i + 1]! - data[j + 1]!) + Math.abs(data[i + 2]! - data[j + 2]!);
      }
      out[y] = w > 0 ? sum / w : 0;
    }
  }
  return out;
}

/**
 * 找出 count 条分割线的吸附位置（归一化 0~1）。
 * @param tolerance 期望位置附近允许搜索的半径（相对全图长度）
 */export async function detectSeamBreaks(
  dataUrl: string,
  kind: 'x' | 'y',
  count: number,
  tolerance = 0.12,
): Promise<number[]> {
  if (count < 2) return [];
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) return [];

  // 降采样：接缝检测只看纹理结构，不需要原分辨率（原图 2K 也不卡）
  const scale = Math.min(1, SAMPLE_MAX / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const energy = axisEnergy(data, w, h, kind);
  const total = kind === 'x' ? w : h;

  // 参考能量：全图中位数，用来判断「这一列是否明显比画面其余部分更平」
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const seamLimit = median * 0.5;

  const breaks: number[] = [];
  for (let i = 1; i < count; i++) {
    const expected = i / count;
    const lo = Math.max(1, Math.floor((expected - tolerance) * total));
    const hi = Math.min(total - 2, Math.ceil((expected + tolerance) * total));
    let best = -1;
    let bestScore = Infinity;
    for (let p = lo; p <= hi; p++) {
      // 接缝是窄带：取 p 附近 ±2 像素的最低能量作为该位置的分数
      let local = Infinity;
      for (let d = -2; d <= 2; d++) {
        const q = p + d;
        if (q < 0 || q >= total) continue;
        local = Math.min(local, energy[q]!);
      }
      if (local < bestScore) {
        bestScore = local;
        best = p;
      }
    }
    // 没找到明显接缝 → 保持均匀位置，不硬吸
    if (best < 0 || bestScore > seamLimit) {
      breaks.push(expected);
      continue;
    }
    breaks.push(best / total);
  }
  return breaks;
}

/**
 * 全图接缝带扫描（2026-11-19 用户报障：三视图切成碎片）
 *
 * detectSeamBreaks 只会在「均匀分割线的 ±12%」范围内找接缝：三视图默认 2 列时
 * 期望线在 50%，真实接缝在 33% / 66%，直接被排除掉 → 退回均匀线，一刀从豹子身上切过去。
 * 这里改成不看期望位置，整根轴扫一遍低纹理带：命中 N 条带 = 画面里有 N+1 格，
 * 直接给出「列数/行数 + 分割线」，这就是用户说的「沿那条轻微接缝把完整图片分开」。
 *
 * 判据（宁可少切，不硬猜）：
 * - 纹理能量 < 全图中位数的 0.35（白底/纯色分隔带远低于此）；
 * - 带宽 ≤ 轴的 6%（接缝是窄带，不是大片留白）；
 * - 距两端 ≥ 轴的 4%（贴边留白不算分格）；
 * - 每格宽度 ≥ 轴的 8%（避免把一条细缝拆成碎格）。
 */
export async function detectSeamBands(
  dataUrl: string,
  kind: 'x' | 'y',
): Promise<{ boundaries: number[]; panels: number }> {
  const img = await loadImage(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) return { boundaries: [], panels: 1 };

  const scale = Math.min(1, SAMPLE_MAX / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { boundaries: [], panels: 1 };
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const energy = axisEnergy(data, w, h, kind);
  const total = kind === 'x' ? w : h;

  const sorted = Array.from(energy).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const limit = median * 0.35;
  const edgeMargin = Math.floor(total * 0.04);
  const maxBand = Math.max(2, Math.round(total * 0.06));

  const bands: Array<{ from: number; to: number }> = [];
  let runStart = -1;
  for (let p = 0; p <= total; p++) {
    const isBand = p < total && energy[p]! < limit;
    if (isBand && runStart < 0) runStart = p;
    if (!isBand && runStart >= 0) {
      bands.push({ from: runStart, to: p - 1 });
      runStart = -1;
    }
  }

  // 过滤：窄带、不贴边；中心作为分割线
  const centers = bands
    .filter((b) => (b.to - b.from + 1) <= maxBand)
    .map((b) => (b.from + b.to + 1) / 2)
    .filter((c) => c >= edgeMargin && c <= total - edgeMargin);

  const boundaries: number[] = [];
  const minPanel = total * 0.08;
  let lastEdge = 0;
  for (const c of centers) {
    if (c - lastEdge < minPanel) continue;
    if (total - c < minPanel) continue;
    boundaries.push(Number((c / total).toFixed(4)));
    lastEdge = c;
  }
  return { boundaries, panels: boundaries.length + 1 };
}
