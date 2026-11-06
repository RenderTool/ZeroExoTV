/**
 * 媒体对象 URL 提供者 — 单元测试（2026-11-05 简化版）
 *
 * 验收契约（对应「CREATE → REVOKE → CREATE 整片空白」事故的根治）：
 * ① 同一 key 多个消费者共享同一 URL，只解析一次存储；组件卸载（release）不 revoke；
 * ② loader 失败返回可读原因（不产生 URL、不缓存失败），文件落盘后可重试成功；
 * ③ invalidate（内容更新 / onError 自愈）：只丢弃缓存并通知订阅者，
 *    绝不 revoke 旧 URL；再次 acquire 重跑 loader 拿新 URL；
 * ④ 同一轮重复 invalidate 合并为一轮，不反复重读磁盘；
 * ⑤ 会话内任何路径都不会 revoke 正在被使用的 URL；唯一 revoke 入口是测试重置。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __configureMediaUrlProviderForTests,
  acquireMediaObjectUrl,
  invalidateMediaObjectUrl,
  releaseMediaObjectUrl,
  subscribeMediaObjectUrl,
} from './media-url-provider.js';

let seq = 0;
const createMock = vi.fn((): string => `blob:test:${++seq}`);
const revokeMock = vi.fn();

beforeEach(() => {
  __configureMediaUrlProviderForTests();
  seq = 0;
  createMock.mockClear();
  revokeMock.mockClear();
  loader.mockClear();
  (URL as unknown as Record<string, unknown>).createObjectURL = createMock;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeMock;
});

const blob = (): Blob => new Blob(['x']);
const loader = vi.fn(async () => ({ blob: blob(), origin: 'orig' }));

describe('media-url-provider（会话级缓存，永不中途 revoke）', () => {
  it('① 同 key 多消费者共享 URL；release 不回收，后续消费者仍复用', async () => {
    loader.mockClear();
    const a = await acquireMediaObjectUrl('k1', loader);
    const b = await acquireMediaObjectUrl('k1', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(b.ok && a.ok && b.url === a.url).toBe(true);

    releaseMediaObjectUrl('k1');
    releaseMediaObjectUrl('k1');
    expect(revokeMock).toHaveBeenCalledTimes(0); // 会话内绝不中途回收

    const c = await acquireMediaObjectUrl('k1', loader);
    expect(c.ok && a.ok && c.url === a.url).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('② loader 失败返回可读原因，不产生 URL；文件出现后可重试成功', async () => {
    const res = await acquireMediaObjectUrl('missing', async () => null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('素材文件缺失');
    expect(createMock).toHaveBeenCalledTimes(0);

    const resErr = await acquireMediaObjectUrl('throws', async () => { throw new Error('io'); });
    expect(resErr.ok).toBe(false);

    // 失败不落缓存：同一 key 文件就绪后再次 acquire 可成功
    const retry = await acquireMediaObjectUrl('missing', loader);
    expect(retry.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('③ invalidate 不 revoke 旧 URL，通知订阅者并重新解析出新 URL', async () => {
    const first = await acquireMediaObjectUrl('k3', loader);
    const notified = vi.fn();
    const unsub = subscribeMediaObjectUrl('k3', notified);

    invalidateMediaObjectUrl('k3');
    await Promise.resolve();
    expect(revokeMock).toHaveBeenCalledTimes(0); // 旧 URL 可能仍在 <img> 上，绝不回收
    expect(notified).toHaveBeenCalledTimes(1);

    const second = await acquireMediaObjectUrl('k3', loader);
    expect(second.ok).toBe(true);
    if (second.ok && first.ok) expect(second.url).not.toBe(first.url);
    expect(loader).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('④ 同一轮重复 invalidate 只生效一次，不反复重读磁盘', async () => {
    await acquireMediaObjectUrl('k3b', loader);
    const notified = vi.fn();
    const unsub = subscribeMediaObjectUrl('k3b', notified);

    invalidateMediaObjectUrl('k3b');
    invalidateMediaObjectUrl('k3b');
    await Promise.resolve();
    expect(notified).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledTimes(0);

    const second = await acquireMediaObjectUrl('k3b', loader);
    expect(second.ok).toBe(true);
    expect(loader).toHaveBeenCalledTimes(2); // 仅重读一次
    unsub();
  });

  it('⑤ 并发 acquire 去重；挂载后立刻卸载也不回收，URL 始终可用', async () => {
    loader.mockClear();
    let resolveLoad!: (v: { blob: Blob; origin: string } | null) => void;
    const slowLoader = vi.fn(
      () => new Promise<{ blob: Blob; origin: string } | null>((r) => { resolveLoad = r; }),
    );
    const p1 = acquireMediaObjectUrl('k4', slowLoader);
    const p2 = acquireMediaObjectUrl('k4', slowLoader);
    releaseMediaObjectUrl('k4'); // 模拟消费者在加载完成前卸载
    resolveLoad({ blob: blob(), origin: 'orig' });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(slowLoader).toHaveBeenCalledTimes(1);
    expect(r1.ok && r2.ok && r1.url === r2.url).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledTimes(0);

    const again = await acquireMediaObjectUrl('k4', slowLoader);
    expect(again.ok && r1.ok && again.url === r1.url).toBe(true);
    expect(slowLoader).toHaveBeenCalledTimes(1);
  });
});
