/**
 * Qwen-Image-2.1 官方限制（2026-11-09 核对 ComfyUI 官方教程）：
 * - 原生 2K：最长边 2048，最大 2048×2048（约 4MP）；
 * - 图像编辑的画布由 image_1 尺寸/分辨率预算决定，不要超过 2K 训练尺寸。
 * UI 与本地作业提交共用这一份限制，避免只在一处夹取。
 */
export const QWEN_MAX_EDGE = 2048;
export const QWEN_MAX_PIXELS = QWEN_MAX_EDGE * QWEN_MAX_EDGE;

/** 夹取到 64..2048，并按 16 对齐（ComfyUI latent 步长 16） */
export function clampQwenEdge(value: number, fallback = 1024): number {
  const n = Number.isFinite(value) ? value : fallback;
  return Math.max(64, Math.min(QWEN_MAX_EDGE, Math.round(n / 16) * 16));
}

/** 同时夹最长边与总像素（超 4MP 时按比例缩到 4MP 内） */
export function clampQwenSize(width: number, height: number): { width: number; height: number } {
  let w = clampQwenEdge(width);
  let h = clampQwenEdge(height);
  if (w * h > QWEN_MAX_PIXELS) {
    const scale = Math.sqrt(QWEN_MAX_PIXELS / (w * h));
    w = clampQwenEdge(Math.floor(w * scale));
    h = clampQwenEdge(Math.floor(h * scale));
  }
  return { width: w, height: h };
}
