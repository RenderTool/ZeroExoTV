/**
 * ComfyUI 后端判定：桥接（/zeroexo/h3/*）优先，其次重写版插件（/zeroexo/v1/*）。
 *
 * 2026-11-07：桥接恢复后必须优先走 direct（完整导演包流程：多参考图 + 延续 + 引导预览）；
 * 只有没装桥接、只装了 ComfyUI_ZeroExoNodes 时才回退 zeroexo（单节点作业协议）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRunConfigFromEndpoint,
  testEndpointConnection,
  useComfyuiEndpointStore,
} from './comfyui-endpoint.js';

const BASE = 'http://127.0.0.1:8188';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function installFetch(handler: (url: string) => Response | null): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    calls.push(url);
    // probeTcp（no-cors favicon）：只要 TCP 层可达就算过
    if (url.endsWith('/favicon.ico')) return jsonResponse({}, 200);
    const res = handler(url);
    if (!res) throw new TypeError('Failed to fetch');
    return res;
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useComfyuiEndpointStore.setState({ connected: false, backend: null, models: [] });
});

describe('testEndpointConnection 后端判定顺序', () => {
  it('桥接在线 → direct（即使 /zeroexo/v1/health 也在线，也不降级到单节点协议）', async () => {
    const calls = installFetch((url) => {
      if (url.endsWith('/zeroexo/h3/health')) return jsonResponse({ ok: true, version: '0.1.0' });
      if (url.endsWith('/zeroexo/v1/health')) return jsonResponse({ ok: true, plugin: 'ComfyUI_ZeroExoNodes' });
      return null;
    });
    const r = await testEndpointConnection(BASE);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.backend).toBe('direct');
    // 先探桥接；命中即返回，不再探 v1
    expect(calls.some((u) => u.endsWith('/zeroexo/h3/health'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/zeroexo/v1/health'))).toBe(false);
  });

  it('没有桥接、只有重写版插件 → zeroexo（回退单节点作业协议）', async () => {
    installFetch((url) => {
      if (url.endsWith('/zeroexo/h3/health')) return jsonResponse({}, 404);
      if (url.endsWith('/zeroexo/v1/health')) {
        return jsonResponse({ ok: true, plugin: 'ComfyUI_ZeroExoNodes', version: '0.1.0' });
      }
      if (url.endsWith('/system_stats')) return null;
      return null;
    });
    const r = await testEndpointConnection(BASE);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.backend).toBe('zeroexo');
  });

  it('两者都没有、但 ComfyUI 原生 /system_stats 在线 → direct（旧插件/同源场景）', async () => {
    installFetch((url) => {
      if (url.endsWith('/zeroexo/h3/health')) return jsonResponse({}, 404);
      if (url.endsWith('/zeroexo/v1/health')) return jsonResponse({}, 404);
      if (url.endsWith('/system_stats')) return jsonResponse({ system: { comfyui_version: '0.43.0' } });
      return null;
    });
    const r = await testEndpointConnection(BASE);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.backend).toBe('direct');
  });
});

describe('getRunConfigFromEndpoint', () => {
  it('zeroexo 后端：不要求模型四件套，直接返回 /zeroexo/v1/jobs 配置', () => {
    useComfyuiEndpointStore.setState({ connected: true, backend: 'zeroexo', address: BASE, models: [] });
    expect(getRunConfigFromEndpoint()).toEqual({ mode: 'zeroexo', baseUrl: BASE });
  });
});
