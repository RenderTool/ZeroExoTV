import { beforeEach, describe, expect, it } from "vitest";
import { isImageReviewed, markImageReviewed, resetImageReviewForTest } from "../src/lib/image-review.js";

describe("主体图先看图闸门（2026-11-13）", () => {
  beforeEach(() => resetImageReviewForTest());

  it("read_asset 登记前一律拒绝；登记后仅同一 token 有效", () => {
    expect(isImageReviewed("token-a", "cas:abc.png")).toBe(false);
    markImageReviewed("token-a", "cas:abc.png");
    expect(isImageReviewed("token-a", "cas:abc.png")).toBe(true);
    // 别的连接没看过，不算
    expect(isImageReviewed("token-b", "cas:abc.png")).toBe(false);
    // 空白键不登记
    markImageReviewed("token-a", "   ");
    expect(isImageReviewed("token-a", "   ")).toBe(false);
  });
});
