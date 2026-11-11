/** 版本对照（2026-11-11 用户要求）：本地版本 vs 官方最新版。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, fetchLatestVersionManifest, isNewerVersion } from './version.js';

afterEach(() => vi.unstubAllGlobals());

describe('isNewerVersion', () => {
  it('逐段比较：官方更高才算新版本', () => {
    expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true);
    expect(isNewerVersion('0.0.10', '0.0.9')).toBe(false);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.1', undefined)).toBe(false);
  });
});

describe('fetchLatestVersionManifest', () => {
  it('读取同源 version.json（带禁用缓存），返回 app/mcp 版本', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ appVersion: '0.0.1', mcpVersion: '0.0.1', commit: 'abc1234' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const manifest = await fetchLatestVersionManifest();
    expect(manifest).toMatchObject({ appVersion: '0.0.1', mcpVersion: '0.0.1', commit: 'abc1234' });
    const firstCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
    expect(String(firstCall[0])).toContain('version.json');
    expect(firstCall[1].cache).toBe('no-store');
  });

  it('读取失败返回 null，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(fetchLatestVersionManifest()).resolves.toBeNull();
  });

  it('构建注入的本地版本非空', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
