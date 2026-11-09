/**
 * comfyui-endpoint 单测（2026-11-05 极简化验收）：
 * - 旧数据迁移：genChannels activeChannel.baseURL → channels[0].baseURL → comfyuiBridge.baseUrl → 默认；
 * - 迁移幂等：新键一旦写入，旧键不再被读取（改旧键不生效）；
 * - 测试连接三态：连通（直连/兼容口）/ 不可达 / 跨域被拒（附 --enable-cors-header 一行原因）；
 * - 运行配置推导：openai 自动取 models[0]；direct 取模型四件套；未连接 → null。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMFYUI_ENDPOINT_STORAGE_KEY,
  getRunConfigFromEndpoint,
  loadComfyuiEndpoint,
  testEndpointConnection,
  useComfyuiEndpointStore,
} from './comfyui-endpoint.js';
import { useComfyuiConnectionStore } from './comfyui-connection.js';

// ===== fetch mock 工具 =====

interface FakeRoute {
  match: (url: string) => boolean;
  status?: number;
  body?: unknown;
  reject?: boolean;
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockFetch(routes: FakeRoute[]) {
  const fn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const r of routes) {
      if (r.match(url)) {
        if (r.reject) throw new TypeError('Failed to fetch');
        return fakeResponse(r.status ?? 200, r.body);
      }
    }
    throw new TypeError('Failed to fetch');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const LOCAL = 'http://127.0.0.1:8188';

function seedLegacyGenChannels(activeId: string | null, channels: unknown): void {
  localStorage.setItem('zeroexo.genChannels', JSON.stringify({ schemaVersion: 1, data: { channels, activeChannelId: activeId } }));
}

function readStoredAddress(): string {
  const raw = JSON.parse(localStorage.getItem(COMFYUI_ENDPOINT_STORAGE_KEY) ?? '{}') as {
    data?: { address?: string };
  };
  return raw.data?.address ?? '';
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useComfyuiEndpointStore.setState({
    address: 'http://127.0.0.1:8188',
    connected: false,
    backend: null,
    models: [],
  });
});

describe('旧数据迁移（单地址化）', () => {
  it('优先取旧 genChannels activeChannel 的 baseURL，其余字段（名称/密钥/模型标识）丢弃', () => {
    seedLegacyGenChannels('c1', [
      { id: 'c1', name: '中转', baseURL: 'https://relay.example.com', apiKey: 'sk-x', model: 'video-1', imageModel: 'img-1' },
      { id: 'c2', name: '云', baseURL: 'https://cloud.example.com', apiKey: '', model: '', imageModel: '' },
    ]);
    const prefs = loadComfyuiEndpoint();
    expect(prefs.address).toBe('https://relay.example.com');
    // 迁移结果立即写回新键
    expect(readStoredAddress()).toBe('https://relay.example.com');
    // 新结构里没有渠道/密钥/模型字段
    const raw = JSON.parse(localStorage.getItem(COMFYUI_ENDPOINT_STORAGE_KEY)!) as { data: unknown };
    expect(Object.keys(raw.data as Record<string, unknown>)).toEqual(['address']);
  });

  it('activeChannelId 失效时回落 channels[0].baseURL', () => {
    seedLegacyGenChannels(null, [{ id: 'c1', name: '云', baseURL: 'https://cloud.example.com', apiKey: '', model: '', imageModel: '' }]);
    expect(loadComfyuiEndpoint().address).toBe('https://cloud.example.com');
  });

  it('无渠道数据时回落旧直连 comfyuiBridge 的 baseUrl', () => {
    localStorage.setItem('zeroexo.comfyuiBridge', JSON.stringify({ schemaVersion: 1, data: { baseUrl: 'http://192.168.1.5:8188', token: 't', models: { unet: 'u' } } }));
    expect(loadComfyuiEndpoint().address).toBe('http://192.168.1.5:8188');
  });

  it('全新安装（无任何旧键）→ 默认本机地址', () => {
    expect(loadComfyuiEndpoint().address).toBe('http://127.0.0.1:8188');
  });

  it('迁移幂等：新键写入后，旧键再怎么改都不会影响后续读取', () => {
    seedLegacyGenChannels('c1', [{ id: 'c1', name: '中转', baseURL: 'https://relay.example.com', apiKey: '', model: '', imageModel: '' }]);
    expect(loadComfyuiEndpoint().address).toBe('https://relay.example.com');
    // 篡改旧键 + 读取第二次 → 仍取新键（不重跑迁移）
    localStorage.removeItem('zeroexo.genChannels');
    expect(loadComfyuiEndpoint().address).toBe('https://relay.example.com');
  });
});

describe('测试连接三态（自动判定后端类型）', () => {
  it('连通 · 直连：/system_stats 返回 ComfyUI 结构', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), body: { system: { comfyui_version: '0.3.50' }, devices: [] } },
    ]);
    const r = await testEndpointConnection(LOCAL);
    expect(r).toMatchObject({ kind: 'ok', backend: 'direct', address: LOCAL, version: '0.3.50' });
  });

  it('连通 · 兼容口：/system_stats 不通但 /v1/models 200，回显模型清单', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), status: 404, body: {} },
      { match: (u) => u.endsWith('/v1/models'), body: { data: [{ id: 'video-1' }, { id: 'img-1' }] } },
    ]);
    const r = await testEndpointConnection('https://relay.example.com');
    expect(r).toMatchObject({ kind: 'ok', backend: 'openai' });
    expect(r.kind === 'ok' && r.models).toEqual(['video-1', 'img-1']);
  });

  it('不可达：TCP 层连不上（probeTcp 失败）', async () => {
    mockFetch([{ match: (u) => u.endsWith('/favicon.ico'), reject: true }]);
    const r = await testEndpointConnection('http://127.0.0.1:9999');
    expect(r.kind === 'fail' && r.failure).toBe('unreachable');
    expect(r.kind === 'fail' && r.message).toContain('不可达');
  });

  it('跨域被拒：提示明确要求加 --enable-cors-header 并说明 403 根因（不能说「无需」）', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), reject: true },
      { match: (u) => u.endsWith('/v1/models'), reject: true },
    ]);
    const r = await testEndpointConnection(LOCAL);
    expect(r.kind === 'fail' && r.failure).toBe('cors');
    expect(r.kind === 'fail' && r.message).toContain('--enable-cors-header');
    // 旧文案写「无需 --enable-cors-header」也能通过 toContain，必须显式排除这个反话
    expect(r.kind === 'fail' && r.message).not.toContain('无需 --enable-cors-header');
    expect(r.kind === 'fail' && r.message).toContain('403');
  });

  it('rejected：有响应但既非 ComfyUI 也非兼容口（如 401 要求密钥）', async () => {
    mockFetch([
      { match: (u) => u.endsWith('/favicon.ico'), body: {} },
      { match: (u) => u.endsWith('/system_stats'), status: 404, body: {} },
      { match: (u) => u.endsWith('/v1/models'), status: 401, body: {} },
    ]);
    const r = await testEndpointConnection('https://auth-relay.example.com');
    expect(r.kind === 'fail' && r.failure).toBe('rejected');
    expect(r.kind === 'fail' && r.message).toContain('API Key');
  });
});

describe('运行配置推导（导演台运行按钮直接用这个地址）', () => {
  it('未连接 → null', () => {
    expect(getRunConfigFromEndpoint()).toBeNull();
  });

  it('兼容口：自动取 models[0] 作 model，apiKey 为空', () => {
    useComfyuiEndpointStore.setState({ address: 'https://relay.example.com', connected: true, backend: 'openai', models: ['video-1', 'img-1'] });
    const cfg = getRunConfigFromEndpoint();
    expect(cfg).toEqual({ mode: 'openai', channel: { baseURL: 'https://relay.example.com', apiKey: '', model: 'video-1' } });
  });

  it('兼容口但清单为空 → 运行不可用（null）', () => {
    useComfyuiEndpointStore.setState({ address: 'https://relay.example.com', connected: true, backend: 'openai', models: [] });
    expect(getRunConfigFromEndpoint()).toBeNull();
  });

  it('直连：模型四件套来自 comfyui-connection（测试通过时自动抓取）', () => {
    useComfyuiEndpointStore.setState({ address: LOCAL, connected: true, backend: 'direct', models: [] });
    useComfyuiConnectionStore.setState({
      connected: true,
      availableModels: {
        unet: ['minimax_h3_v1.safetensors'],
        vae: ['video_vae.safetensors', 'audio_vae.safetensors'],
        clip: ['minimax_h3_clip.safetensors'],
      },
      models: { unet: '', videoVae: '', audioVae: '', clip: '' },
    });
    const cfg = getRunConfigFromEndpoint();
    expect(cfg && cfg.mode).toBe('direct');
    if (cfg && cfg.mode === 'direct') {
      expect(cfg.baseUrl).toBe(LOCAL);
      expect(cfg.models).toMatchObject({
        unet: 'minimax_h3_v1.safetensors',
        videoVae: 'video_vae.safetensors',
        audioVae: 'audio_vae.safetensors',
        clip: 'minimax_h3_clip.safetensors',
        clipType: 'minimax',
      });
    }
  });
});
