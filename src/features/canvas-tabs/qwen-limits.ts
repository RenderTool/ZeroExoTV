/**
 * Qwen-Image-2.1 官方限制（2026-11-09 核对 ComfyUI 官方教程）：
 * - 原生 2K：最长边 2048，最大 2048×2048（约 4MP）；
 * - 图像编辑的画布由 image_1 尺寸/分辨率预算决定，不要超过 2K 训练尺寸。
 * UI 与本地作业提交共用这一份限制，避免只在一处夹取。
 */
export const QWEN_MAX_EDGE = 2048;
export const QWEN_MAX_PIXELS = QWEN_MAX_EDGE * QWEN_MAX_EDGE;

/** 默认采样步数（2026-11-10 用户拍板：图片 25 步，视频仍是 8 步，两者不要混用） */
export const QWEN_DEFAULT_STEPS = 25;

/** 夹取到 64..2048，并按 16 对齐（ComfyUI latent 步长 16） */
export function clampQwenEdge(value: number, fallback = 1024): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.max(64, Math.min(QWEN_MAX_EDGE, Math.round(n / 32) * 32));
}

/** 同时夹最长边与总像素（按原比例缩放，禁止单边夹取把 16:9 拉成 4:3） */
export function clampQwenSize(width: number, height: number): { width: number; height: number } {
  const w0 = Number.isFinite(width) && width > 0 ? width : 1024;
  const h0 = Number.isFinite(height) && height > 0 ? height : 1024;
  const scale = Math.min(
    1,
    QWEN_MAX_EDGE / w0,
    QWEN_MAX_EDGE / h0,
    Math.sqrt(QWEN_MAX_PIXELS / (w0 * h0)),
  );
  let w = clampQwenEdge(Math.round(w0 * scale));
  let h = clampQwenEdge(Math.round(h0 * scale));
  if (w * h > QWEN_MAX_PIXELS) {
    const down = Math.sqrt(QWEN_MAX_PIXELS / (w * h));
    w = clampQwenEdge(Math.floor(w * down));
    h = clampQwenEdge(Math.floor(h * down));
  }
  return { width: w, height: h };
}
