/**
 * comfyui-auto-connect 单测：挂载自动探测 + 静默（成功/失败都不产生 toast）
 *
 * 用 mock 的 testEndpointConnection 与 antd message 断言：自动连接只更新状态，
 * 绝不弹 success/info/warning/error。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  testConnection: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('antd', () => ({ message: hoisted.toast }));
vi.mock('./comfyui-endpoint.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./comfyui-endpoint.js')>();
  return {
    ...original,
    testEndpointConnection: (...args: unknown[]) => hoisted.testConnection(...args),
  };
});

import {
  __resetComfyuiAutoConnectForTests,
  useComfyuiAutoConnect,
  useComfyuiAutoConnectStore,
} from './comfyui-auto-connect';
import { useComfyuiEndpointStore } from './comfyui-endpoint';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/zeroexo/h3/models')) {
      return new Response(JSON.stringify({ unet: ['u'], vae: ['v'], clip: ['c'], audio_vae: ['a'] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
  useComfyuiEndpointStore.setState({ address: 'http://127.0.0.1:8188', connected: false, backend: null, models: [] });
  __resetComfyuiAutoConnectForTests();
});

afterEach(() => {
  __resetComfyuiAutoConnectForTests();
  hoisted.testConnection.mockReset();
  for (const fn of Object.values(hoisted.toast)) fn.mockReset();
  vi.unstubAllGlobals();
});

describe('静默自动连接', () => {
  it('挂载即自动探一次；成功只更新状态，不产生任何 toast', async () => {
    hoisted.testConnection.mockResolvedValue({
      kind: 'ok', backend: 'direct', address: 'http://127.0.0.1:8188', models: [],
    });
    renderHook(() => useComfyuiAutoConnect({}));

    await waitFor(() => expect(useComfyuiAutoConnectStore.getState().status).toBe('connected'));
    expect(hoisted.testConnection).toHaveBeenCalledTimes(1);
    expect(useComfyuiEndpointStore.getState().connected).toBe(true);
    expect(useComfyuiEndpointStore.getState().backend).toBe('direct');
    for (const fn of Object.values(hoisted.toast)) expect(fn).not.toHaveBeenCalled();
  });

  it('失败只在状态里留可读原因，不产生任何 toast / message.error', async () => {
    hoisted.testConnection.mockResolvedValue({
      kind: 'fail', failure: 'unreachable', message: '不可达：无法连接 http://127.0.0.1:8188',
    });
    renderHook(() => useComfyuiAutoConnect({}));

    await waitFor(() => expect(useComfyuiAutoConnectStore.getState().status).toBe('failed'));
    expect(useComfyuiAutoConnectStore.getState().failureMessage).toContain('不可达');
    for (const fn of Object.values(hoisted.toast)) expect(fn).not.toHaveBeenCalled();
  });

  it('生成中（disabled）不自动探测', async () => {
    hoisted.testConnection.mockResolvedValue({ kind: 'ok', backend: 'direct', address: 'http://x', models: [] });
    renderHook(() => useComfyuiAutoConnect({ disabled: true }));
    await Promise.resolve();
    expect(hoisted.testConnection).not.toHaveBeenCalled();
  });
});
