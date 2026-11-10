/**
 * 首次使用指引的「只弹一次」契约（2026-11-10 用户要求）：
 * 首次启动自动弹，关掉后写标记，之后不再自动弹；主页底部入口仍可手动打开。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isOnboardingDone, markOnboardingDone } from './onboarding-guide.js';

describe('onboarding seen 标记', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('没看过 → 需要弹；写过标记 → 不再自动弹', () => {
    expect(isOnboardingDone()).toBe(false);
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
  });
});
