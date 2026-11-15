/**
 * Broker 出片参数纯函数（唯一实现）。
 *
 * 尺寸口径与前端一致：
 * - 视频：官方 Size Settings Reference（面积 = 系数 × 1024²，×32 对齐）；
 * - Moss / Krea2：百万像素 × 1024²，分别 16 / 32 对齐；
 * - Qwen：最长边 ≤2048、总像素 ≤2048²，32 对齐（与 qwen-limits.ts 同口径）。
 * 帧数：17k+5 吸附（lib/shot-prompt.durationToFrames，fps=24）。
 */

export const PIXELS_PER_MEGAPIXEL = 1024 * 1024;
export const VIDEO_ASPECT: Record<string, number> = {
  "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "21:9": 21 / 9,
};

const round32 = (n: number): number => Math.max(32, Math.round(n / 32) * 32);
const align = (n: number, step: number): number => Math.max(step, Math.round(n / step) * step);

export function clampScale(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(2, Math.max(0.1, v)) : 1;
}

export function resolveVideoSize(aspect: string, scaleFactor: number): { width: number; height: number } {
  const r = VIDEO_ASPECT[aspect] ?? 16 / 9;
  const total = clampScale(scaleFactor) * PIXELS_PER_MEGAPIXEL;
  // 插件 ZeroExoRefVideo 的 width/height 都是 min=64
  return {
    width: Math.max(64, round32(Math.sqrt(total * r))),
    height: Math.max(64, round32(Math.sqrt(total / r))),
  };
}

export const GUIDE_FRAME_OPTIONS = [5, 22, 39, 56] as const;

export function snapGuide(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 22;
  return GUIDE_FRAME_OPTIONS.reduce(
    (best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best),
    GUIDE_FRAME_OPTIONS[0] as number,
  );
}

/** 比例 + 百万像素 → 对齐宽高（moss 16 / krea2 32） */
export function resolveMegapixelSize(
  aspect: string | undefined,
  megapixels: unknown,
  step: 16 | 32,
  fallbackMp = 4,
): { width: number; height: number } {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec((aspect ?? "1:1").trim());
  const rw = m ? Number(m[1]) : 1;
  const rh = m ? Number(m[2]) : 1;
  if (!rw || !rh) return { width: 1024, height: 1024 };
  const mp = Math.max(0.5, Math.min(8, Number.isFinite(Number(megapixels)) ? Number(megapixels) : fallbackMp));
  const ratio = rw / rh;
  const width = Math.sqrt(mp * PIXELS_PER_MEGAPIXEL * ratio);
  return { width: align(width, step), height: align(width / ratio, step) };
}

export const QWEN_MAX_EDGE = 2048;
export const QWEN_MAX_PIXELS = QWEN_MAX_EDGE * QWEN_MAX_EDGE;

function clampQwenEdge(value: number, fallback = 1024): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.max(64, Math.min(QWEN_MAX_EDGE, Math.round(n / 32) * 32));
}

export function clampQwenSize(width: number, height: number): { width: number; height: number } {
  const w0 = Number.isFinite(width) && width > 0 ? width : 1024;
  const h0 = Number.isFinite(height) && height > 0 ? height : 1024;
  const scale = Math.min(1, QWEN_MAX_EDGE / w0, QWEN_MAX_EDGE / h0, Math.sqrt(QWEN_MAX_PIXELS / (w0 * h0)));
  let w = clampQwenEdge(Math.round(w0 * scale));
  let h = clampQwenEdge(Math.round(h0 * scale));
  if (w * h > QWEN_MAX_PIXELS) {
    const down = Math.sqrt(QWEN_MAX_PIXELS / (w * h));
    w = clampQwenEdge(Math.floor(w * down));
    h = clampQwenEdge(Math.floor(h * down));
  }
  return { width: w, height: h };
}
