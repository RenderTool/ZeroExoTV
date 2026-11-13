/**
 * image-review — 主体图「先看图、再挂图」闸门（2026-11-13 事故后加）
 *
 * 背景：Agent 只拿到 storageKey 就 set_subject_image，既不读图也不看图；结果把
 * 六人模特合集、别的角色图挂成主体状态图（用户：图 2 根本不是一个人）。
 *
 * 事实：MCP 的 read_asset 会把图片以原生 image 内容块返回，多模态模型能真正看到。
 * 所以在 read_asset 返回图片时登记「这张图被看过」，set_subject_image 真实写入前
 * 必须命中登记；没看过就不许挂。仅进程内记忆（重启后重看一遍成本很低），1 小时过期。
 */

const REVIEW_TTL_MS = 60 * 60 * 1000;

/** key = `${tokenId}\u0000${storageKey}` → 看过的时刻 */
const reviewedAt = new Map<string, number>();

function keyOf(tokenId: string, storageKey: string): string {
  return `${tokenId}\u0000${storageKey.trim()}`;
}

/** read_asset 成功返回图片内容块时登记 */
export function markImageReviewed(tokenId: string, storageKey: string): void {
  if (!tokenId || !storageKey.trim()) return;
  reviewedAt.set(keyOf(tokenId, storageKey), Date.now());
}

/** set_subject_image 写入前校验：本次会话里真的读过这张图 */
export function isImageReviewed(tokenId: string, storageKey: string): boolean {
  const key = keyOf(tokenId, storageKey);
  const at = reviewedAt.get(key);
  if (!at) return false;
  if (Date.now() - at > REVIEW_TTL_MS) {
    reviewedAt.delete(key);
    return false;
  }
  return true;
}

/** 仅测试用：清空登记 */
export function resetImageReviewForTest(): void {
  reviewedAt.clear();
}
