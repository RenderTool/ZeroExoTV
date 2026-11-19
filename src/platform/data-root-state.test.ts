/**
 * 数据根状态分流回归（C-07 P1）：服务模式但离线 ≠ 目录未授权。
 * 只有把这两件事分开，素材读取失败时的提示才不会把用户赶去重新选目录。
 */
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ expectsService: false }));

vi.mock('./http-fs.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    httpFsReady: Promise.resolve(null),
    httpFs: { online: false, info: null },
    dataRootExpectsService: () => h.expectsService,
  };
});

import { dataRootState, isAuthorized } from './fs.js';

describe('dataRootState', () => {
  it('数据权威在服务端但服务离线 → service-offline（不是 unauthorized）', async () => {
    h.expectsService = true;
    await expect(dataRootState()).resolves.toBe('service-offline');
    await expect(isAuthorized()).resolves.toBe(false);
  });
});
