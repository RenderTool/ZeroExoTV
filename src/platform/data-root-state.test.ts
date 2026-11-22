/**
 * 数据根状态回归（2026-11-22 用户拍板后的唯一口径）。
 *
 * 网页读写本地文件只认浏览器目录授权，状态只有两种：
 * - ok（句柄可用）
 * - unauthorized（没有可用句柄，需要用户点一次 / 首次选目录）
 *
 * 旧的 service-offline（8790 本地数据服务掉线）随服务移除，不再存在。
 */
import { describe, expect, it } from 'vitest';

import { dataRootState, isAuthorized } from './fs.js';

describe('dataRootState', () => {
  it('没有任何目录授权 → unauthorized（不是服务离线）', async () => {
    await expect(dataRootState()).resolves.toBe('unauthorized');
    await expect(isAuthorized()).resolves.toBe(false);
  });
});
